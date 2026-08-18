# src/patens/server/api.py
import base64
import os
import time
import logging
import sys
import uuid
from collections import deque
from pathlib import Path
from datetime import datetime, timezone, timedelta
import threading
from typing import Callable, Union, Any, Dict, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastembed import TextEmbedding

from patens.server import config
from patens.server.models import IngestResponse, IngestPayload, ConnectionState
from patens.server.state import app_state
from patens.server.routers.pdf_router import router as pdf_router

logger = logging.getLogger(__name__)
recent_activity: deque = deque(maxlen=200)


def get_assets_dir() -> Path:
    """
    Resolves the assets directory across development, PyInstaller onedir (_internal),
    onefile temp directories, Inno Setup installations, and repository root.
    """
    candidates = []

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.extend([
            exe_dir / "assets",
            exe_dir / "_internal" / "assets",
        ])
        meipass_raw = getattr(sys, "_MEIPASS", None)
        if meipass_raw:
            meipass = Path(meipass_raw)
            candidates.extend([
                meipass / "assets",
                meipass / "patens" / "server" / "assets",
                meipass / "_internal" / "assets",
            ])
        candidates.append(Path.cwd() / "assets")
    else:
        current_file = Path(__file__).resolve()
        for parent in current_file.parents:
            candidates.append(parent / "assets")
        candidates.append(current_file.parent / "assets")
        candidates.append(Path.cwd() / "assets")

    valid_dirs = [c for c in candidates if c and c.exists() and c.is_dir()]

    # Prioritize candidate directory that contains files
    for candidate in valid_dirs:
        try:
            if any(candidate.iterdir()):
                logger.info("Resolved active assets directory: %s", candidate)
                return candidate
        except Exception:
            continue

    if valid_dirs:
        logger.info("Resolved assets directory: %s", valid_dirs[0])
        return valid_dirs[0]

    fallback = Path(__file__).resolve().parent / "assets"
    fallback.mkdir(parents=True, exist_ok=True)
    logger.warning("Assets directory not found. Using fallback: %s", fallback)
    return fallback


def get_template_html(filename: str) -> str:
    """
    Resolves HTML templates across frozen PyInstaller binaries and dev environments.
    """
    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        meipass_raw = getattr(sys, "_MEIPASS", None)
        if meipass_raw:
            meipass = Path(meipass_raw)
            candidates.extend([
                meipass / "patens" / "server" / "templates",
                meipass / "templates",
            ])
        candidates.extend([
            exe_dir / "_internal" / "patens" / "server" / "templates",
            exe_dir / "patens" / "server" / "templates",
            exe_dir / "templates",
        ])
    else:
        current_file = Path(__file__).resolve()
        candidates.append(current_file.parent / "templates")
        for parent in current_file.parents:
            candidates.append(parent / "src" / "patens" / "server" / "templates")
            candidates.append(parent / "templates")

    for candidate in candidates:
        file_path = candidate / filename
        if file_path.exists() and file_path.is_file():
            try:
                return file_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.error("Failed to read template %s from %s: %s", filename, file_path, e)

    return f"<h1>Error: Could not load {filename}</h1>"


def save_base64_image(media_string: str, image_dir: Union[str, Path]) -> str:
    header, encoded = media_string.split(",", 1) if "," in media_string else ("", media_string)
    unique_id = uuid.uuid4().hex[:8]
    filename = f"image_{int(time.time())}_{unique_id}.png"
    filepath = Path(image_dir) / filename
    try:
        image_data = base64.b64decode(encoded)
        filepath.write_bytes(image_data)
        return str(filepath)
    except Exception as e:
        logger.error("Failed to decode or write base64 image: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to process image payload")


def normalize_db_record(row: Any, reference_time: datetime) -> Dict[str, Any]:
    if isinstance(row, dict):
        res = row.copy()
    elif hasattr(row, "keys"):
        res = {k: row[k] for k in row.keys()}
    else:
        res = dict(row)

    raw_timestamp = res.get("timestamp") or res.get("created_at")
    iso_val = None
    if raw_timestamp:
        try:
            created_str = str(raw_timestamp).replace("Z", "+00:00")
            if " " in created_str and "T" not in created_str:
                created_str = created_str.replace(" ", "T")
            created_dt = datetime.fromisoformat(created_str)
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
            iso_val = created_dt.isoformat()
        except Exception:
            iso_val = reference_time.isoformat()
    else:
        iso_val = reference_time.isoformat()

    res["timestamp"] = iso_val
    res["created_at"] = iso_val
    return res


def create_routers(
    db_manager: Any,
    embedder_model: Union[TextEmbedding, Callable[[], TextEmbedding]],
    image_dir: str,
    on_sync_trigger: Optional[Callable[[], None]] = None,
) -> APIRouter:
    ui_router = APIRouter(tags=["UI"])
    v1_router = APIRouter(prefix="/api/v1", tags=["API v1"])
    internal_router = APIRouter(prefix="/api/internal", tags=["Internal"])
    main_router = APIRouter()

    v1_router.include_router(pdf_router)

    def get_connection_state() -> ConnectionState:
        return app_state

    def get_embedder_instance() -> Any:
        if hasattr(embedder_model, "embed"):
            return embedder_model
        if callable(embedder_model):
            return embedder_model()
        return embedder_model

    def trigger_workspace_sync():
        if on_sync_trigger and callable(on_sync_trigger):
            on_sync_trigger()

    @ui_router.get("/settings", response_class=HTMLResponse)
    async def settings_page():
        return HTMLResponse(content=get_template_html("settings.html"))

    @ui_router.get("/welcome", response_class=HTMLResponse)
    async def welcome_page():
        return HTMLResponse(content=get_template_html("welcome.html"))

    @ui_router.get("/dashboard", response_class=HTMLResponse)
    async def dashboard():
        return HTMLResponse(content=get_template_html("dashboard.html"))

    @ui_router.get("/image")
    async def get_image(path: str):
        try:
            target_path = Path(path).resolve()
            base_dir = Path(image_dir).resolve()
            try:
                if not target_path.is_relative_to(base_dir):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
            except ValueError:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

            if not target_path.exists() or not target_path.is_file():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

            return FileResponse(target_path)
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error serving image: %s", e)
            raise HTTPException(status_code=500, detail="Internal server error")

    @v1_router.get("/config/system")
    def get_system_config():
        return {
            "status": "running",
            "pid": os.getpid(),
            "python_path": sys.executable,
            "module_path": "patens.server",
            "db_path": str(getattr(config, "DB_PATH", ""))
        }

    @v1_router.get("/config/hotkeys")
    def get_hotkey_config():
        return {
            "capture": config.HOTKEY_CAPTURE,
            "palette": config.HOTKEY_PALETTE,
        }

    @v1_router.post("/config/hotkeys")
    async def save_hotkey_config(request: Request):
        data = await request.json()
        config.HOTKEY_CAPTURE = data.get("capture")
        config.HOTKEY_PALETTE = data.get("palette")
        if not config.update_hotkeys_config(config.HOTKEY_CAPTURE, config.HOTKEY_PALETTE):
            raise HTTPException(status_code=500, detail="Failed to save configuration")
        return {"status": "success"}

    @v1_router.post("/ingest", response_model=IngestResponse)
    async def ingest_context(payload: IngestPayload):
        try:
            embedder = get_embedder_instance()
            raw_embedding = list(embedder.embed([payload.content]))[0]
            embedding = raw_embedding.tolist() if hasattr(raw_embedding, "tolist") else list(raw_embedding)
            final_content = payload.content

            if payload.type == "image" and payload.media:
                filepath = save_base64_image(payload.media, image_dir)
                final_content = f"{payload.content}\n\n[Local Image Path: {filepath}]"

            content_id = db_manager.insert_snippet(
                url=payload.url,
                title=payload.title,
                content=final_content,
                embedding=embedding,
            )

            tokens = len(final_content) // 4
            trigger_workspace_sync()

            smart_clipboard = (
                f"> 📎 **Context Saved:** {payload.title}\n"
                f"> 📏 **Size:** ~{tokens} tokens\n"
                f"> 📂 Available instantly in your IDE in the `_context/` folder."
            )
            return {"status": "success", "id": content_id, "smart_clipboard": smart_clipboard}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Ingest failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to ingest context")

    @v1_router.api_route("/delete", methods=["DELETE", "GET", "POST"])
    async def delete_context(ids: str = "", request: Request = None):
        id_list = [i.strip() for i in ids.split(",") if i.strip()] if ids else []
        if request:
            try:
                q_ids = request.query_params.get("ids", "")
                if q_ids:
                    id_list.extend([i.strip() for i in q_ids.split(",") if i.strip()])
                if "application/json" in request.headers.get("content-type", ""):
                    body = await request.json()
                    if isinstance(body, dict):
                        b_ids = body.get("ids", [])
                        if isinstance(b_ids, list):
                            id_list.extend([str(i).strip() for i in b_ids])
                        elif isinstance(b_ids, str):
                            id_list.extend([i.strip() for i in b_ids.split(",")])
                    elif isinstance(body, list):
                        id_list.extend([str(i).strip() for i in body])
            except Exception:
                pass

        id_list = list(dict.fromkeys(filter(None, id_list)))
        if not id_list:
            return {"status": "success", "deleted": 0}

        deleted_count = 0
        for snippet_id in id_list:
            try:
                target_id = int(snippet_id) if str(snippet_id).isdigit() else snippet_id
                res = db_manager.delete_snippet(target_id)
                if res:
                    deleted_count += 1
            except Exception as e:
                logger.warning("Failed to delete snippet %s: %s", snippet_id, e)

        if deleted_count > 0:
            trigger_workspace_sync()
        return {"status": "success", "deleted": deleted_count}

    @v1_router.get("/search")
    async def search_context(
        q: str = "",
        limit: int = 20,
        offset: int = 0,
        time_filter: str = "all",
        tz_offset: int = 0,
        url_filter: str = "",
    ):
        logger.info(
            "Search requested | query='%s' limit=%d offset=%d time_filter='%s' url_filter='%s'",
            q, limit, offset, time_filter, url_filter
        )
        try:
            start_utc_str, end_utc_str = None, None
            if time_filter in ("2h", "today", "yesterday"):
                user_tz = timezone(timedelta(minutes=-tz_offset))
                now_local = datetime.now(user_tz)
                if time_filter == "2h":
                    start_utc_str = (now_local - timedelta(hours=2)).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                elif time_filter == "today":
                    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_utc_str = start_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                elif time_filter == "yesterday":
                    start_local = (now_local - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    end_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_utc_str = start_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    end_utc_str = end_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

            now = datetime.now(timezone.utc)

            if not q.strip():
                if hasattr(db_manager, "get_latest"):
                    documents = db_manager.get_latest(
                        limit=limit,
                        offset=offset,
                        start_time=start_utc_str,
                        end_time=end_utc_str,
                        url_filter=url_filter
                    )
                else:
                    documents = db_manager.get_documents(
                        limit=limit,
                        offset=offset,
                        start_time=start_utc_str,
                        end_time=end_utc_str,
                        url_filter=url_filter
                    )
            else:
                embedder = get_embedder_instance()
                raw_vector = list(embedder.embed([q]))[0]
                query_vector = raw_vector.tolist() if hasattr(raw_vector, "tolist") else list(raw_vector)

                if hasattr(db_manager, "search_similar"):
                    try:
                        documents = db_manager.search_similar(
                            query_text=q,
                            query_vector=query_vector,
                            limit=limit,
                            offset=offset,
                            start_time=start_utc_str,
                            end_time=end_utc_str,
                            url_filter=url_filter
                        )
                    except TypeError:
                        documents = db_manager.search_similar(
                            q,
                            query_vector,
                            limit=limit,
                            offset=offset,
                            start_time=start_utc_str,
                            end_time=end_utc_str,
                            url_filter=url_filter
                        )
                else:
                    documents = db_manager.search_documents(
                        query_text=q,
                        query_vector=query_vector,
                        limit=limit,
                        offset=offset,
                        start_time=start_utc_str,
                        end_time=end_utc_str,
                        url_filter=url_filter
                    )

            safe_results = [normalize_db_record(doc, now) for doc in (documents or [])]
            logger.info("Returning %d aggregated document(s) for query='%s'", len(safe_results), q)
            return {"status": "success", "results": safe_results}

        except HTTPException:
            raise
        except Exception as e:
            logger.error("Search execution error: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="Internal server error during search")

    @v1_router.get("/latest")
    async def latest_context(limit: int = 10):
        try:
            now = datetime.now(timezone.utc)
            if hasattr(db_manager, "get_latest"):
                documents = db_manager.get_latest(limit=limit, offset=0)
            else:
                documents = db_manager.get_documents(limit=limit, offset=0)
            safe_results = [normalize_db_record(doc, now) for doc in (documents or [])]
            return {"status": "success", "results": safe_results}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Failed to fetch latest context: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to fetch latest context")

    @internal_router.get("/mcp-status")
    def get_mcp_status(state: ConnectionState = Depends(get_connection_state)):
        return {"connected": state.ide_connected}

    @internal_router.post("/ide-connected")
    def mark_ide_connected(state: ConnectionState = Depends(get_connection_state)):
        state.ide_connected = True
        return {"status": "ok"}

    @internal_router.post("/activity")
    async def record_activity(request: Request, state: ConnectionState = Depends(get_connection_state)):
        body = await request.json()
        recent_activity.appendleft(body)
        state.ide_connected = True
        return {"ok": True}

    @internal_router.get("/activity-data")
    def get_activity_data():
        return {"activities": list(recent_activity)}

    @internal_router.get("/assets-debug")
    def debug_assets():
        assets_path = get_assets_dir()
        files = [f.name for f in assets_path.iterdir()] if assets_path.exists() else []
        return {
            "resolved_path": str(assets_path),
            "exists": assets_path.exists(),
            "is_frozen": getattr(sys, "frozen", False),
            "meipass": getattr(sys, "_MEIPASS", None),
            "executable_dir": str(Path(sys.executable).resolve().parent),
            "files": files
        }

    @internal_router.post("/shutdown")
    async def shutdown_server(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        force_global = body.get("force_global", True) if isinstance(body, dict) else True

        def execute_kill():
            time.sleep(1)
            if force_global:
                import subprocess, platform
                try:
                    if platform.system() == "Windows":
                        subprocess.run(["taskkill", "/f", "/im", "Patens.exe"], capture_output=True)
                    else:
                        subprocess.run(["pkill", "-f", "Patens"], capture_output=True)
                except Exception as e:
                    logger.error("Failed to execute process kill: %s", e)
            os._exit(0)

        threading.Thread(target=execute_kill, daemon=True).start()
        return {"status": "success", "message": "Server instances destroyed."}

    main_router.include_router(ui_router)
    main_router.include_router(v1_router)
    main_router.include_router(internal_router)
    return main_router


def create_app(
    db_manager: Any,
    embedder_model: Union[TextEmbedding, Callable[[], TextEmbedding]],
    image_dir: str,
    on_sync_trigger: Optional[Callable[[], None]] = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            if hasattr(db_manager, "get_latest"):
                latest_items = db_manager.get_latest(limit=1)
            elif hasattr(db_manager, "get_documents"):
                latest_items = db_manager.get_documents(limit=1)
            else:
                latest_items = []

            if not latest_items:
                def delayed_open():
                    time.sleep(1.5)
                    import webbrowser
                    host = getattr(config, "API_HOST", "127.0.0.1")
                    port = getattr(config, "API_PORT", 8000)
                    webbrowser.open(f"http://{host}:{port}/welcome")

                threading.Thread(target=delayed_open, daemon=True).start()
        except Exception as e:
            logger.error("Lifespan database check failed: %s", e)

        yield

    app = FastAPI(title="Patens Unified API", version="1.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount static assets directory
    assets_dir = get_assets_dir()
    logger.info("Serving static assets from: %s", assets_dir)
    app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    routers = create_routers(
        db_manager=db_manager,
        embedder_model=embedder_model,
        image_dir=image_dir,
        on_sync_trigger=on_sync_trigger
    )
    app.include_router(routers)
    return app