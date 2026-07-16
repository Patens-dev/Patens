# src/context_clipboard/server/api.py
import base64
import os
import time
import logging
import math
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
import threading
from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from context_clipboard.server import config
from context_clipboard.server.models import IngestResponse, IngestPayload, SearchResponse

logger = logging.getLogger(__name__)


# --- Utility Functions ---
def save_base64_image(media_string: str, image_dir: str) -> str:
    """Extracts and saves base64 image data to disk."""
    header, encoded = media_string.split(",", 1) if "," in media_string else ("", media_string)
    filename = f"image_{int(time.time())}.png"
    filepath = os.path.join(image_dir, filename)

    try:
        with open(filepath, "wb") as fh:
            fh.write(base64.b64decode(encoded))
        return filepath
    except Exception as e:
        logger.error(f"Failed to save image to disk: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to process image payload")


def get_template_html(filename: str) -> str:
    """Dynamically locates and reads HTML templates in both Dev and EXE environments."""
    if getattr(sys, 'frozen', False):
        # We are running inside the PyInstaller .exe bundle
        base_dir = Path(sys._MEIPASS) / "context_clipboard" / "server" / "templates"
    else:
        # We are running from raw Python source code
        base_dir = Path(__file__).parent / "templates"

    file_path = base_dir / filename

    try:
        return file_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to load template {filename}: {str(e)}")
        return f"<h1>Error: Could not load {filename}</h1><p>{str(e)}</p>"


# --- Routing ---
def create_router(db_manager, embedder_model, image_dir: str) -> APIRouter:
    """Constructs the API endpoints with dependency injection."""
    router = APIRouter()

    @router.get("/search", response_model=SearchResponse)
    async def search_context(
            q: str = "", limit: int = 10, offset: int = 0,
            time_filter: str = "all", tz_offset: int = 0
    ):
        try:
            start_utc_str = None
            end_utc_str = None

            # 1. Translate UI Local Boundaries to Database UTC Boundaries
            if time_filter != "all":
                user_tz = timezone(timedelta(minutes=-tz_offset))  # Convert JS offset to Python TZ
                now_local = datetime.now(user_tz)

                if time_filter == "2h":
                    start_utc = (now_local - timedelta(hours=2)).astimezone(timezone.utc)
                    start_utc_str = start_utc.strftime("%Y-%m-%d %H:%M:%S")
                elif time_filter == "today":
                    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_utc_str = start_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                elif time_filter == "yesterday":
                    start_local = (now_local - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    end_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
                    start_utc_str = start_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    end_utc_str = end_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

            fetch_limit = max(50, offset + limit * 2)
            now = datetime.now(timezone.utc)

            # 2. Incredible UX Feature: If search is empty but a filter is clicked, just browse the timeline!
            if not q.strip():
                raw_results = db_manager.get_latest(limit=fetch_limit, offset=0, start_time=start_utc_str,
                                                    end_time=end_utc_str)
            else:
                query_vector = list(embedder_model.embed([q]))[0].tolist()
                raw_results = db_manager.search_similar(q, query_vector, limit=fetch_limit, offset=0,
                                                        start_time=start_utc_str, end_time=end_utc_str)

            # 3. Apply Time-Decay Scoring
            for r in raw_results:
                distance = r.get("distance", 0.5)
                base_similarity = 1.0 / (1.0 + distance)

                try:
                    created_str = str(r.get("timestamp") or r.get("created_at") or now.isoformat()).replace("Z",
                                                                                                            "+00:00")
                    if " " in created_str and "T" not in created_str:
                        created_str = created_str.replace(" ", "T")
                    created_dt = datetime.fromisoformat(created_str)
                    if created_dt.tzinfo is None:
                        created_dt = created_dt.replace(tzinfo=timezone.utc)
                    age_days = (now - created_dt).total_seconds() / 86400.0
                    r["timestamp"] = created_dt.isoformat()
                except (ValueError, TypeError):
                    age_days = 0
                    r["timestamp"] = now.isoformat()

                time_bonus = math.exp(-0.1 * max(0, age_days))
                r["hybrid_score"] = (base_similarity * 0.7) + (time_bonus * 0.3)

            raw_results.sort(key=lambda x: x.get("hybrid_score", 0), reverse=True)
            paginated_results = raw_results[offset: offset + limit]

            return {"status": "success", "results": paginated_results}

        except Exception as e:
            logger.error(f"Search error: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal server error during search")

    @router.get("/latest", response_model=SearchResponse)
    async def latest_context(limit: int = 1):
        logger.info(f"[LATEST INPUT] Fetching {limit} most recent items")
        try:
            results = db_manager.get_latest(limit)
            now = datetime.now(timezone.utc)

            # Ensure the timestamp is explicitly formatted for the strict Pydantic model
            for r in results:
                # Parse timestamp safely
                try:
                    created_str = r.get("timestamp") or r.get("created_at") or now.isoformat()

                    # 1. Ensure JS strings have proper timezone offsets
                    created_str = str(created_str).replace("Z", "+00:00")

                    # 2. Convert SQLite's space into a valid ISO 'T'
                    if " " in created_str and "T" not in created_str:
                        created_str = created_str.replace(" ", "T")

                    created_dt = datetime.fromisoformat(created_str)

                    # Ensure datetime is timezone-aware
                    if created_dt.tzinfo is None:
                        created_dt = created_dt.replace(tzinfo=timezone.utc)

                    # 3. Calculate age_days for the hybrid scoring
                    age_days = (now - created_dt).total_seconds() / 86400.0

                    r["timestamp"] = created_dt.isoformat()
                except (ValueError, TypeError):
                    age_days = 0
                    r["timestamp"] = now.isoformat()
            # --- LOG OUTPUT ---
            output_summary = [f"[ID:{res.get('id')} | Title:'{res.get('title', '')[:20]}']" for res in results]
            logger.info(f"[LATEST OUTPUT] Returned {len(results)} results: {', '.join(output_summary)}")

            return {"status": "success", "results": results}

        except Exception as e:
            logger.error(f"Latest fetch error: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to fetch latest context")

    @router.get("/image", response_class=FileResponse)
    async def get_image(path: str):
        """Allows the browser extension to securely fetch local images."""
        if os.path.exists(path) and os.path.isfile(path):
            return FileResponse(path)

        logger.warning(f"Image not found at path: {path}")
        raise HTTPException(status_code=404, detail="Image not found")

    @router.post("/ingest", response_model=IngestResponse)
    async def ingest_context(payload: IngestPayload):
        try:
            logger.info(f"[INGEST INPUT] Receiving {payload.type} from: {payload.url}")

            # Generate AI embeddings from the payload content
            embedding = list(embedder_model.embed([payload.content]))[0].tolist()
            final_content = payload.content

            # Handle image uploads
            if payload.type == "image" and payload.media:
                filepath = save_base64_image(payload.media, image_dir)
                final_content = f"{payload.content}\n\n[Local Image Path: {filepath}]"
                logger.info(f"Saved image to {filepath}")

            # Save to database
            content_id = db_manager.insert_snippet(
                url=payload.url,
                title=payload.title,
                content=final_content,
                embedding=embedding
            )

            logger.info(f"[INGEST OUTPUT] Successfully saved context ID: {content_id}")
            return {"status": "success", "id": content_id}

        except Exception as e:
            logger.error(f"Error during ingest: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to ingest context")

    @router.get("/settings", response_class=HTMLResponse)
    async def settings_page():
        """Serves the intuitive and reliable Settings UI."""
        html_content = get_template_html("settings.html")
        return HTMLResponse(content=html_content)

    @router.get("/welcome", response_class=HTMLResponse)
    async def welcome_page():
        """Serves the intuitive onboarding flow for first-time users."""
        html_content = get_template_html("welcome.html")
        return HTMLResponse(content=html_content)

    @router.get("/api/config")
    async def get_config():
        """Returns the current hotkey configuration."""
        return {
            "capture": config.HOTKEY_CAPTURE,
            "palette": config.HOTKEY_PALETTE
        }

    @router.post("/api/shutdown")
    async def shutdown_server(request: Request):
        """Aggressively hunts and kills all Context Clipboard instances."""
        data = await request.json()
        force_global = data.get("force_global", True)

        def execute_kill():
            time.sleep(1)  # Allow FastAPI to return the 200 OK response first

            if force_global:
                import subprocess, platform
                system = platform.system()
                try:
                    if system == "Windows":
                        subprocess.run(["taskkill", "/f", "/im", "ContextClipboard.exe"], capture_output=True)
                    else:
                        subprocess.run(["pkill", "-f", "ContextClipboard"], capture_output=True)
                except Exception as e:
                    logger.error(f"Failed to execute global kill: {e}")

            # Failsafe: Force-kill the current Python process if system commands missed it
            os._exit(0)

        threading.Thread(target=execute_kill).start()

        return {"status": "success", "message": "Server instances destroyed."}

    @router.post("/api/config")
    async def save_config(request: Request):
        """Saves new hotkeys from the UI to the YAML file."""
        data = await request.json()
        config.HOTKEY_CAPTURE = data.get("capture")
        config.HOTKEY_PALETTE = data.get("palette")

        success = config.update_hotkeys_config(config.HOTKEY_CAPTURE, config.HOTKEY_PALETTE)
        if not success:
            logger.error("Failed to write updated config to disk.")
            raise HTTPException(status_code=500, detail="Failed to save configuration")

        return {"status": "success"}

    return router


# --- Application Factory ---
def create_app(db_manager, embedder_model, image_dir: str) -> FastAPI:
    """Factory function to create and configure the FastAPI application."""
    app = FastAPI(title="Context Clipboard API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Initialize and mount the router
    api_router = create_router(db_manager, embedder_model, image_dir)
    app.include_router(api_router)

    return app
