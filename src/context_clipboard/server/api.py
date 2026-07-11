# src/context_clipboard/server/api.py
import base64
import os
import time
import logging

from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from context_clipboard.server import config
from context_clipboard.server.ui_templates import SETTINGS_HTML
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


# --- Routing ---
def create_router(db_manager, embedder_model, image_dir: str) -> APIRouter:
    """Constructs the API endpoints with dependency injection."""
    router = APIRouter()

    @router.get("/search", response_model=SearchResponse)
    async def search_context(q: str, limit: int = 10, offset: int = 0):
        try:
            query_vector = list(embedder_model.embed([q]))[0].tolist()
            results = db_manager.search_similar(q, query_vector, limit=limit, offset=offset)
            return {"status": "success", "results": results}
        except Exception as e:
            logger.error(f"Search error: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal server error during search")

    @router.get("/latest", response_model=SearchResponse)
    async def latest_context(limit: int = 1):
        try:
            results = db_manager.get_latest(limit)
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
            logger.info(f"Receiving {payload.type} from: {payload.url}")

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

            logger.info(f"Successfully saved context ID: {content_id}")
            return {"status": "success", "id": content_id}

        except Exception as e:
            logger.error(f"Error during ingest: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to ingest context")

    @router.get("/settings", response_class=HTMLResponse)
    async def settings_page():
        """Serves the intuitive and reliable Settings UI."""
        return HTMLResponse(content=SETTINGS_HTML)

    @router.get("/api/config")
    async def get_config():
        """Returns the current hotkey configuration."""
        return {
            "capture": config.HOTKEY_CAPTURE,
            "palette": config.HOTKEY_PALETTE
        }

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
