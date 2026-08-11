import base64
import os
import time
import logging
import math
import sys
from collections import deque
from pathlib import Path
from datetime import datetime, timezone, timedelta
import threading
from typing import Callable, Union, Any, Dict, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastembed import TextEmbedding

from patens.server import config
from patens.server.models import IngestResponse, IngestPayload, SearchResponse, ConnectionState
from patens.server.state import app_state

logger = logging.getLogger(__name__)

# Activity buffer storing up to 200 recent incoming actions
recent_activity: deque = deque(maxlen=200)


# =====================================================================
# UTILITY HELPER FUNCTIONS
# =====================================================================

def save_base64_image(media_string: str, image_dir: Union[str, Path]) -> str:
    """Extracts and saves base64 image data securely to disk.

    Args:
        media_string: Data URI or base64-encoded string.
        image_dir: Target directory path where image will be written.

    Returns:
        Absolute filepath to saved image.
    """
    logger.debug("Processing base64 image payload...")
    header, encoded = media_string.split(",", 1) if "," in media_string else ("", media_string)
    filename = f"image_{int(time.time())}.png"
    filepath = Path(image_dir) / filename

    try:
        image_data = base64.b64decode(encoded)
        filepath.write_bytes(image_data)
        logger.info("Successfully saved base64 image to %s (%d bytes)", filepath, len(image_data))
        return str(filepath)
    except Exception as e:
        logger.error("Failed to decode or write base64 image to disk: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process image payload",
        )


def get_template_html(filename: str) -> str:
    """Dynamically locates and reads HTML templates for Dev and PyInstaller environments."""
    if getattr(sys, "frozen", False):
        base_dir = Path(sys._MEIPASS) / "patens" / "server" / "templates"
    else:
        base_dir = Path(__file__).resolve().parent / "templates"

    file_path = base_dir / filename
    logger.debug("Attempting to load template from %s", file_path)

    try:
        content = file_path.read_text(encoding="utf-8")
        logger.debug("Successfully loaded template: %s", filename)
        return content
    except Exception as e:
        logger.error("Failed to load template '%s' from %s: %s", filename, file_path, e, exc_info=True)
        return f"<h1>Error: Could not load {filename}</h1><p>{e}</p>"


def normalize_db_record(row: Any, reference_time: datetime) -> Dict[str, Any]:
    """Safely converts SQLite rows to dictionaries and normalizes all UTC timestamps."""
    # 1. Safe Dict Conversion
    if isinstance(row, dict):
        res = row.copy()
    else:
        try:
            res = dict(row)
        except Exception:
            res = {k: row[k] for k in row.keys()}

    # 2. Timestamp Normalization
    raw_timestamp = res.get("timestamp") or res.get("created_at")
    try:
        if raw_timestamp:
            created_str = str(raw_timestamp).replace("Z", "+00:00")
            if " " in created_str and "T" not in created_str:
                created_str = created_str.replace(" ", "T")
            created_dt = datetime.fromisoformat(created_str)
        else:
            logger.warning("Missing timestamp in DB row ID=%s; falling back to reference time.", res.get("id"))
            created_dt = reference_time

        if created_dt.tzinfo is None:
            created_dt = created_dt.replace(tzinfo=timezone.utc)

        res["timestamp"] = created_dt.isoformat()
    except (ValueError, TypeError) as e:
        logger.warning(
            "Failed parsing timestamp '%s' for row ID=%s: %s. Using reference time.",
            raw_timestamp, res.get("id"), e
        )
        res["timestamp"] = reference_time.isoformat()

    return res


# =====================================================================
# ROUTER FACTORY
# =====================================================================

def create_routers(
        db_manager: Any,
        embedder_model: Union[TextEmbedding, Callable[[], TextEmbedding]],
        image_dir: str,
        on_sync_trigger: Optional[Callable[[], None]] = None,
) -> APIRouter:
    """Constructs API endpoints divided into logical, versioned routers."""
    ui_router = APIRouter(tags=["UI"])
    v1_router = APIRouter(prefix="/api/v1", tags=["API v1"])
    internal_router = APIRouter(prefix="/api/internal", tags=["Internal"])
    main_router = APIRouter()

    def get_connection_state() -> ConnectionState:
        return app_state

    def get_embedder_instance() -> TextEmbedding:
        """Resolves embedder gracefully whether it's an instance or a lazy factory."""
        if callable(embedder_model):
            logger.debug("Resolving embedder model using lazy factory...")
            return embedder_model()
        return embedder_model

    def trigger_workspace_sync():
        """Notifies the background sync engine if callback is present."""
        if on_sync_trigger and callable(on_sync_trigger):
            on_sync_trigger()

    # ---------------------------------------------------------
    # UI & STATIC ROUTES (Root level)
    # ---------------------------------------------------------
    @ui_router.get("/settings", response_class=HTMLResponse)
    async def settings_page():
        logger.debug("UI requested: /settings")
        return HTMLResponse(content=get_template_html("settings.html"))

    @ui_router.get("/welcome", response_class=HTMLResponse)
    async def welcome_page():
        logger.debug("UI requested: /welcome")
        return HTMLResponse(content=get_template_html("welcome.html"))

    # Under UI Router section:
    @ui_router.get("/dashboard", response_class=HTMLResponse)
    async def dashboard():
        return HTMLResponse(content=get_template_html("dashboard.html"))

    @ui_router.get("/image", response_class=FileResponse)
    async def get_image(path: str):
        logger.debug("Image retrieval requested for path: %s", path)
        target_path = Path(path).resolve()
        base_dir = Path(image_dir).resolve()

        # Path traversal guard: ensure image resides inside the configured image directory
        if not str(target_path).startswith(str(base_dir)):
            logger.warning("Path traversal attempt blocked for path: %s", path)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        if target_path.is_file():
            return FileResponse(str(target_path))

        logger.warning("Requested image path not found on disk: %s", path)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    # ---------------------------------------------------------
    # PUBLIC API v1 (Browser Extension Data)
    # ---------------------------------------------------------
    @v1_router.get("/config/system")
    def get_system_config():
        """System health and environment information."""
        logger.debug("System configuration requested")
        return {
            "status": "running",
            "python_path": sys.executable,
            "module_path": "patens.server",
        }

    @v1_router.get("/config/hotkeys")
    def get_hotkey_config():
        """User preferences for browser hotkeys."""
        logger.debug("Hotkey configuration requested")
        return {
            "capture": config.HOTKEY_CAPTURE,
            "palette": config.HOTKEY_PALETTE,
        }

    @v1_router.post("/config/hotkeys")
    async def save_hotkey_config(request: Request):
        data = await request.json()
        capture = data.get("capture")
        palette = data.get("palette")

        logger.info("Updating hotkey configuration...")
        config.HOTKEY_CAPTURE = capture
        config.HOTKEY_PALETTE = palette

        if not config.update_hotkeys_config(capture, palette):
            logger.error("Failed to write updated hotkey configuration to disk")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save configuration",
            )

        logger.info("Hotkey configuration updated successfully")
        return {"status": "success"}

    @v1_router.post("/ingest", response_model=IngestResponse)
    async def ingest_context(payload: IngestPayload):
        try:
            logger.info("Ingesting payload [type=%s] from URL: %s", payload.type, payload.url)

            embedder = get_embedder_instance()
            embedding = list(embedder.embed([payload.content]))[0].tolist()
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
            logger.info("Snippet ingested successfully (ID=%s, ~%d tokens)", content_id, tokens)

            # Trigger immediate workspace sync so .md file materializes instantly
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
            logger.error("Ingest failed unexpectedly: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to ingest context",
            )

    @v1_router.get("/delete")
    @v1_router.delete("/delete")
    async def delete_context(ids: str = ""):
        """Deletes items from memory by ID or comma-separated IDs and triggers context file pruning."""
        if not ids:
            return {"status": "success", "deleted": 0}

        id_list = [i.strip() for i in ids.split(",") if i.strip()]
        logger.info("Delete context requested for %d ID(s): %s", len(id_list), id_list)

        deleted_count = 0
        for item_id in id_list:
            try:
                # Try integer ID conversion first
                target_id = int(item_id) if item_id.isdigit() else item_id
                if db_manager.delete_snippet(target_id):
                    deleted_count += 1
            except Exception as e:
                logger.error("Error deleting snippet ID %s: %s", item_id, e)

        logger.info("Successfully deleted %d snippet(s) from DB.", deleted_count)

        if deleted_count > 0:
            # Instantly purge deleted files from local _context/ folder
            trigger_workspace_sync()

        return {"status": "success", "deleted": deleted_count}

    @v1_router.get("/search", response_model=SearchResponse)
    async def search_context(
            q: str = "",
            limit: int = 10,
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

            # Time Boundary Translation
            if time_filter != "all":
                user_tz = timezone(timedelta(minutes=-tz_offset))
                now_local = datetime.now(user_tz)

                if time_filter == "2h":
                    start_utc_str = (now_local - timedelta(hours=2)).astimezone(timezone.utc).strftime(
                        "%Y-%m-%d %H:%M:%S")
                elif time_filter == "today":
                    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_utc_str = start_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                elif time_filter == "yesterday":
                    start_local = (now_local - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    end_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_utc_str = start_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    end_utc_str = end_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                else:
                    logger.warning("Unrecognized time_filter value received: '%s'", time_filter)

            fetch_limit = max(50, offset + limit * 2)
            now = datetime.now(timezone.utc)

            # Database Fetch
            if not q.strip():
                logger.debug("Executing non-vector recent items query")
                raw_results = db_manager.get_latest(
                    limit=fetch_limit,
                    offset=0,
                    start_time=start_utc_str,
                    end_time=end_utc_str,
                    url_filter=url_filter,
                )
            else:
                logger.debug("Executing vector similarity search")
                embedder = get_embedder_instance()
                query_vector = list(embedder.embed([q]))[0].tolist()
                raw_results = db_manager.search_similar(
                    q,
                    query_vector,
                    limit=fetch_limit,
                    offset=0,
                    start_time=start_utc_str,
                    end_time=end_utc_str,
                    url_filter=url_filter,
                )

            # Normalization & Scoring
            safe_results = [normalize_db_record(r, now) for r in raw_results]

            for r in safe_results:
                distance = r.get("distance", 0.5)
                base_similarity = 1.0 / (1.0 + distance)

                created_dt = datetime.fromisoformat(r["timestamp"])
                age_days = max(0.0, (now - created_dt).total_seconds() / 86400.0)

                time_bonus = math.exp(-0.1 * age_days)
                r["hybrid_score"] = (base_similarity * 0.7) + (time_bonus * 0.3)

            safe_results.sort(key=lambda x: x.get("hybrid_score", 0), reverse=True)
            logger.info("Search returned %d matched items (returning slice [%d:%d])", len(safe_results), offset,
                        offset + limit)

            return {"status": "success", "results": safe_results[offset: offset + limit]}

        except Exception as e:
            logger.error("Error encountered during search execution: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error during search",
            )

    @v1_router.get("/latest", response_model=SearchResponse)
    async def latest_context(limit: int = 1):
        logger.debug("Fetching latest %d entries", limit)
        try:
            now = datetime.now(timezone.utc)
            raw_results = db_manager.get_latest(limit)
            safe_results = [normalize_db_record(r, now) for r in raw_results]

            return {"status": "success", "results": safe_results}
        except Exception as e:
            logger.error("Failed to fetch latest context: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch latest context",
            )

    # ---------------------------------------------------------
    # INTERNAL API (IDE to Daemon IPC)
    # ---------------------------------------------------------
    @internal_router.get("/mcp-status")
    def get_mcp_status(state: ConnectionState = Depends(get_connection_state)):
        logger.debug("MCP Connection status query: %s", state.ide_connected)
        return {"connected": state.ide_connected}

    @internal_router.post("/ide-connected")
    def mark_ide_connected(state: ConnectionState = Depends(get_connection_state)):
        logger.info("IDE client successfully connected")
        state.ide_connected = True
        return {"status": "ok"}

    @internal_router.post("/activity")
    async def record_activity(request: Request, state: ConnectionState = Depends(get_connection_state)):
        body = await request.json()
        logger.debug("Recording internal activity: %s", body)
        recent_activity.appendleft(body)

        state.ide_connected = True

        return {"ok": True}

    @internal_router.get("/activity-data")
    def get_activity_data():
        return {"activities": list(recent_activity)}

    @internal_router.post("/shutdown")
    async def shutdown_server(request: Request):
        data = await request.json()
        force_global = data.get("force_global", True)
        logger.warning("Shutdown initiated (force_global=%s)", force_global)

        def execute_kill():
            time.sleep(1)  # Allow HTTP 200 OK response to flush back to caller
            if force_global:
                import subprocess
                import platform

                sys_platform = platform.system()
                logger.info("Executing global kill process for platform: %s", sys_platform)
                try:
                    if sys_platform == "Windows":
                        subprocess.run(["taskkill", "/f", "/im", "Patens.exe"], capture_output=True)
                    else:
                        subprocess.run(["pkill", "-f", "Patens"], capture_output=True)
                except Exception as e:
                    logger.error("Failed to execute global process kill: %s", e, exc_info=True)
            logger.info("Exiting application process...")
            os._exit(0)

        threading.Thread(target=execute_kill, daemon=True).start()
        return {"status": "success", "message": "Server instances destroyed."}

    # Aggregate all defined routers
    main_router.include_router(ui_router)
    main_router.include_router(v1_router)
    main_router.include_router(internal_router)

    return main_router


# =====================================================================
# APP INSTANTIATION
# =====================================================================

def create_app(
        db_manager: Any,
        embedder_model: Union[TextEmbedding, Callable[[], TextEmbedding]],
        image_dir: str,
        on_sync_trigger: Optional[Callable[[], None]] = None,
) -> FastAPI:
    """Factory function to create and configure the FastAPI application."""
    logger.info("Initializing Patens Unified API Server...")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            if not db_manager.get_latest(limit=1):
                logger.info("Empty database detected (First Run). Opening welcome page in browser.")
                import webbrowser

                def delayed_open():
                    time.sleep(1.5)  # Give Uvicorn time to bind to the port
                    host = getattr(config, "API_HOST", "127.0.0.1")
                    port = getattr(config, "API_PORT", 8000)
                    webbrowser.open(f"http://{host}:{port}/welcome")

                threading.Thread(target=delayed_open, daemon=True).start()
        except Exception as e:
            logger.error("Failed to auto-open welcome page: %s", e)

        yield  # Application runs during this yield

        # --- SHUTDOWN LOGIC ---
        logger.info("Patens Unified API Server shutting down...")

    # Attach the lifespan to the FastAPI instance
    app = FastAPI(title="Patens Unified API", version="1.0.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    routers = create_routers(
        db_manager=db_manager,
        embedder_model=embedder_model,
        image_dir=image_dir,
        on_sync_trigger=on_sync_trigger
    )
    app.include_router(routers)

    logger.info("Patens Unified API initialized successfully")
    return app
