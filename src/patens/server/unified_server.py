import re
import json
import sys
import time
import threading
import logging
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any

import uvicorn
from fastmcp import FastMCP
from fastembed import TextEmbedding

from patens.server.config import (
    setup_logging, DB_PATH, IMAGE_DIR, MODEL_NAME, API_HOST, API_PORT, ROOT_MARKERS
)
from patens.server.database import DatabaseManager
from patens.server.api import create_app
from patens.server.state import app_state

# Initialize global logging configuration
setup_logging()
logger = logging.getLogger(__name__)

logger.info("=== Unified Server Initializing ===")

try:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    logger.debug("Ensured image directory exists at: %s", IMAGE_DIR)
except Exception as e:
    logger.error("Failed to create image directory %s: %s", IMAGE_DIR, e, exc_info=True)

# Global event and thread lock for dynamic workspace context synchronization
workspace_sync_event = threading.Event()
_context_lock = threading.Lock()
_sync_thread_started = False

# Initialize Core Database
logger.debug("Initializing database manager at: %s", DB_PATH)
db_manager = DatabaseManager(str(DB_PATH))

# Lazy-loaded FastEmbed Singleton
_embedder_instance: Optional[TextEmbedding] = None


def resolve_model_cache_dir() -> Optional[Path]:
    """
    Locates the FastEmbed model cache directory across execution environments.
    Checks PyInstaller bundle directory (sys._MEIPASS) first, then local workspace.
    """
    if getattr(sys, "frozen", False):
        # PyInstaller unpacks data to sys._MEIPASS at runtime
        bundle_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        cached_dir = bundle_dir / "fastembed_cache"
        if cached_dir.exists():
            return cached_dir
    else:
        # Development environment check
        dev_cached_dir = Path.cwd().resolve() / "fastembed_cache"
        if dev_cached_dir.exists():
            return dev_cached_dir

    return None


def get_embedder() -> TextEmbedding:
    global _embedder_instance
    if _embedder_instance is not None:
        return _embedder_instance

    start_time = time.perf_counter()
    cache_dir = resolve_model_cache_dir()

    if cache_dir:
        logger.info("Found local FastEmbed cache at: %s", cache_dir)
        try:
            _embedder_instance = TextEmbedding(
                model_name=MODEL_NAME,
                cache_dir=str(cache_dir),
                local_files_only=True
            )
            logger.info("Successfully initialized FastEmbed in OFFLINE mode.")
        except Exception as e:
            logger.warning("Failed to load local FastEmbed cache (%s). Falling back to online load...", e)
            _embedder_instance = TextEmbedding(model_name=MODEL_NAME)
    else:
        logger.info("No local cache found. Loading FastEmbed model online...")
        _embedder_instance = TextEmbedding(model_name=MODEL_NAME)

    elapsed = time.perf_counter() - start_time
    logger.info("FastEmbed model loaded in %.2f seconds.", elapsed)
    return _embedder_instance


def trigger_workspace_sync():
    """Signals the background sync thread to immediately re-evaluate workspace files."""
    logger.debug("Workspace sync trigger requested.")
    workspace_sync_event.set()


# Initialize API and MCP Server instances
fastapi_app = create_app(
    db_manager=db_manager,
    embedder_model=get_embedder,
    image_dir=str(IMAGE_DIR),
    on_sync_trigger=trigger_workspace_sync)

mcp = FastMCP("Patens")

# =====================================================================
# THREAD-SAFE WORKSPACE CONTEXT ENGINE
# =====================================================================

# Default initial workspace root
_WORKSPACE_ROOT = Path.cwd().resolve()
_CONTEXT_DIR = _WORKSPACE_ROOT / "_context"


def get_context_dir() -> Path:
    """Thread-safe getter for the active _context folder."""
    with _context_lock:
        return _CONTEXT_DIR


def set_context_dir(new_context_dir: Path) -> None:
    """Thread-safe setter for redirecting the _context folder."""
    global _CONTEXT_DIR
    with _context_lock:
        old_dir = _CONTEXT_DIR
        _CONTEXT_DIR = new_context_dir
        logger.info("Active context directory changed from '%s' to '%s'", old_dir, new_context_dir)


def is_valid_workspace(path: Path) -> bool:
    """Safeguard: Prevents polluting System32, Home, Root, or the binary EXE directory."""
    try:
        abs_path = path.resolve()
        parts = [p.lower() for p in abs_path.parts]
        home_path = Path.home().resolve()
        home_str = str(home_path).lower()

        # 1. Block Home directory and Root drive
        if str(abs_path).lower() == home_str or abs_path.parent == abs_path:
            logger.debug("Workspace path '%s' rejected: Is home or root directory.", abs_path)
            return False

        # 2. Block critical system directories
        system_dirs = {"system32", "windows", "program files", "program files (x86)"}
        if any(sys_dir in parts for sys_dir in system_dirs):
            logger.debug("Workspace path '%s' rejected: Contains system directory.", abs_path)
            return False

        # Block AppData config folders, but allow temporary working dirs (e.g. AppData/Local/Temp)
        if "appdata" in parts:
            last_appdata_idx = len(parts) - 1 - parts[::-1].index("appdata")
            if "temp" not in parts[last_appdata_idx:]:
                logger.debug("Workspace path '%s' rejected: Resides in AppData configuration directory.", abs_path)
                return False

        # 3. Block directory where executable/python lives
        exe_dir = str(Path(sys.executable).parent.resolve()).lower()
        if str(abs_path).lower() == exe_dir:
            logger.debug("Workspace path '%s' rejected: Matches Python/Executable directory.", abs_path)
            return False

        return True
    except Exception as e:
        logger.warning("Error validating workspace path '%s': %s", path, e)
        return False


def sync_workspace_files_loop():
    """Background daemon that mirrors recent DB clips into local workspace .md files."""
    logger.info("Starting workspace sync daemon loop...")
    last_db_state: Optional[str] = None
    has_warned_invalid = False

    while True:
        context_dir = get_context_dir()
        current_workspace = context_dir.parent

        # 1. Validate Target Workspace
        if not is_valid_workspace(current_workspace):
            if not has_warned_invalid:
                logger.warning(
                    "Target workspace '%s' is invalid or unsafe. Physical context sync paused.",
                    current_workspace
                )
                has_warned_invalid = True

            workspace_sync_event.wait(timeout=3)
            workspace_sync_event.clear()
            continue

        has_warned_invalid = False

        try:
            context_dir.mkdir(parents=True, exist_ok=True)

            gitignore_path = context_dir / ".gitignore"
            if not gitignore_path.exists():
                logger.debug("Creating .gitignore in context directory: %s", gitignore_path)
                gitignore_path.write_text("*\n", encoding="utf-8")

            recent_clips = db_manager.get_recent_snippets(hours=24)
            logger.debug("Fetched %d recent snippets from DB for workspace sync", len(recent_clips))

            # 2. State Check: Skip computation and I/O if state hasn't changed
            current_db_state = f"{context_dir}:" + "".join(str(c.get("id", "")) for c in recent_clips)

            if current_db_state == last_db_state:
                logger.debug("No state change detected in workspace sync. Sleeping.")
                workspace_sync_event.wait(timeout=3)
                workspace_sync_event.clear()
                continue

            logger.info("Workspace state changed. Synchronizing context files in: %s", context_dir)
            last_db_state = current_db_state

            # 3. Group and Merge Clips Chronologically
            grouped_clips: Dict[str, Dict[str, Any]] = {}

            for clip in reversed(recent_clips):
                key = clip.get("url") or clip.get("title") or str(clip.get("id"))

                if key not in grouped_clips:
                    grouped_clips[key] = {
                        "title": clip.get("title") or f"Saved_Snippet_{clip.get('id', 'Unknown')}",
                        "url": clip.get("url", "Unknown"),
                        "created_at": clip.get("created_at", "Unknown"),
                        "content": clip.get("content", ""),
                        "clip_count": 1,
                    }
                else:
                    grouped_clips[key]["content"] += (
                            f"\n\n---\n> **➕ Added on:** {clip.get('created_at', 'Unknown')}\n\n"
                            + clip.get("content", "")
                    )
                    grouped_clips[key]["created_at"] = clip.get("created_at", "Unknown")
                    grouped_clips[key]["clip_count"] += 1

            # 4. Generate Master Index and Markdown Documents
            active_filenames = {".gitignore"}

            index_content = "# 🧠 Patens Master Index\n\n"
            index_content += "> **⚠️ SYSTEM PROMPT FOR AI:**\n"
            index_content += "> **DO NOT guess or hallucinate.** You MUST use your file-reading tool to open and read the specific `.md` files linked below.\n"
            index_content += "> **DO NOT rely on your training data.** Read the physical file.\n\n"

            for idx, (_, g_clip) in enumerate(grouped_clips.items(), 1):
                raw_title = str(g_clip["title"])
                tokens = len(g_clip["content"]) // 4

                clean_title = re.sub(r"[^a-zA-Z0-9]", "_", raw_title).strip("_")
                clean_title = re.sub(r"_+", "_", clean_title)[:35]
                if not clean_title:
                    clean_title = f"Snippet_{idx}"

                filename = f"{clean_title}_{tokens}t.md"
                filepath = context_dir / filename
                active_filenames.add(filename)

                index_content += f"{idx}. **[{filename}]({filename})**\n"
                index_content += f"   - **Source:** {g_clip['url']}\n"
                index_content += f"   - **Size:** ~{tokens} tokens\n"
                if g_clip["clip_count"] > 1:
                    index_content += f"   - **Merged:** {g_clip['clip_count']} separate clips\n"
                index_content += "\n"

                content_md = (
                    f"<!-- Auto-synced by Patens -->\n"
                    f"# {raw_title}\n"
                    f"**Source:** {g_clip['url']}\n"
                    f"**Last Updated:** {g_clip['created_at']}\n"
                    f"**Total Clips Merged:** {g_clip['clip_count']}\n\n"
                    f"---\n\n"
                    f"{g_clip['content']}"
                )

                if not filepath.exists() or filepath.read_text(encoding="utf-8") != content_md:
                    logger.debug("Writing/Updating synced file: %s", filepath)
                    filepath.write_text(content_md, encoding="utf-8")

            # Write Master Index
            index_filename = "00_Context_Index.md"
            index_filepath = context_dir / index_filename
            active_filenames.add(index_filename)

            if not index_filepath.exists() or index_filepath.read_text(encoding="utf-8") != index_content:
                logger.debug("Updating context index file: %s", index_filepath)
                index_filepath.write_text(index_content, encoding="utf-8")

            # 5. Prune Stale Files (Unlink files deleted from DB)
            for file in context_dir.iterdir():
                if file.is_file() and file.name not in active_filenames:
                    logger.info("Pruning deleted/stale context file from local workspace: %s", file.name)
                    try:
                        file.unlink(missing_ok=True)
                    except Exception as pe:
                        logger.error("Failed to prune context file %s: %s", file.name, pe)

        except Exception as e:
            logger.error("Workspace sync thread encountered an error: %s", e, exc_info=True)

        workspace_sync_event.wait(timeout=3)
        workspace_sync_event.clear()


# =====================================================================
# MCP TOOLS
# =====================================================================

def notify_ide_activity(event: str = "tool_call", **meta):
    """Pings backend telemetry asynchronously when an IDE executes a tool."""

    # Instantly flag MCP connection active in global app state
    app_state.ide_connected = True

    def _ping():
        url = f"http://{API_HOST}:{API_PORT}/api/internal/activity"
        try:
            payload = json.dumps({"event": event, "ts": time.time(), **meta}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                logger.debug("IDE activity ping sent successfully (status: %d)", resp.status)
        except Exception as e:
            logger.debug("Failed sending activity telemetry ping to %s: %s", url, e)

    threading.Thread(target=_ping, daemon=True).start()


@mcp.tool()
def query_browser_context(search_query: str, limit: int = 3) -> str:
    """
    CRITICAL: Use this tool ANYTIME the user mentions "saved context", "memory", "clips", or "clipboard".
    Searches the global SQLite vector memory for saved web snippets.
    """
    logger.info("MCP Tool Called: query_browser_context (query='%s', limit=%d)", search_query, limit)
    try:
        embedder = get_embedder()
        query_vector = list(embedder.embed([search_query]))[0].tolist()
        results = db_manager.search_similar(search_query, query_vector, limit)

        if not results:
            logger.info("No matching browser context found for query: '%s'", search_query)
            return "No matching browser context found."

        logger.info("Found %d relevant web context entries", len(results))

        output = "Found relevant web context:\n\n"
        for r in results:
            output += f"### [ID: {r.get('id', 'unknown')}] Source: {r.get('title', 'Untitled')}\nURL: {r.get('url', '')}\n\n```text\n{r.get('content', '')}\n```\n\n"

        notify_ide_activity(
            tool="query_browser_context",
            query=search_query,
            result_count=len(results),
            approx_tokens=sum(len(r.get("content", "")) for r in results) // 4,
        )
        return output
    except Exception as e:
        logger.error("Error executing query_browser_context: %s", e, exc_info=True)
        return f"Error querying browser context: {e}"


@mcp.tool()
def forget_memory(memory_id: int) -> str:
    """Deletes outdated or deprecated context from memory and purges synced local files."""
    logger.info("MCP Tool Called: forget_memory (ID=%d)", memory_id)
    notify_ide_activity(tool="forget_memory", memory_id=memory_id)

    try:
        success = db_manager.delete_snippet(memory_id)
        if success:
            logger.info("Memory ID %d deleted successfully.", memory_id)
            trigger_workspace_sync()
            return f"Successfully deleted memory ID {memory_id}."

        logger.warning("Failed to delete memory ID %d (Not found or DB error)", memory_id)
        return f"Failed to delete memory ID {memory_id}."
    except Exception as e:
        logger.error("Error executing forget_memory for ID %d: %s", memory_id, e, exc_info=True)
        return f"Error executing delete request: {e}"


@mcp.tool()
def memorize_ide_insight(title: str, insight: str) -> str:
    """Saves an important conclusion or architectural decision into permanent vector memory."""
    logger.info("MCP Tool Called: memorize_ide_insight (title='%s')", title)
    notify_ide_activity(tool="memorize_ide_insight", title=title)

    try:
        embedder = get_embedder()
        embedding = list(embedder.embed([insight]))[0].tolist()
        internal_url = f"ide://chat-resolution/{int(time.time())}"

        snippet_id = db_manager.insert_snippet(
            url=internal_url, title=title, content=insight, embedding=embedding
        )
        logger.info("Insight successfully saved to DB with ID: %s", snippet_id)

        trigger_workspace_sync()
        return f"Success! The insight '{title}' has been permanently saved."
    except Exception as e:
        logger.error("Error executing memorize_ide_insight: %s", e, exc_info=True)
        return f"Error saving insight: {e}"


@mcp.tool()
def mount_workspace_context(absolute_project_path: str) -> str:
    """
    Redirects the context sync engine to write the _context folder into the project root.
    Automatically resolves subdirectories up to the Git root or project manifest root.
    """
    logger.info("MCP Tool Called: mount_workspace_context (path='%s')", absolute_project_path)
    notify_ide_activity(tool="mount_workspace_context", path=absolute_project_path)

    given_path = Path(absolute_project_path).resolve()
    if given_path.is_file():
        given_path = given_path.parent

    if not given_path.exists() or not given_path.is_dir():
        logger.warning("Mount failed: Path '%s' is not a valid directory", absolute_project_path)
        return f"Failed: Could not verify '{absolute_project_path}' as a valid directory."

    project_root = given_path
    curr = given_path

    # Walk up parent directories while staying within a valid/safe workspace
    while curr != curr.parent and is_valid_workspace(curr):
        # 1. Top Priority: Actual Git repository root
        if (curr / ".git").exists():
            project_root = curr
            logger.info("Resolved Git repository root at: '%s'", project_root)
            break

        # 2. Secondary Priority: Project configuration or manifest files
        if any((curr / marker).exists() for marker in ROOT_MARKERS):
            project_root = curr
            logger.info("Resolved project root via manifest marker at: '%s'", project_root)
            break  # <-- STOP traversal once project root marker is found

        curr = curr.parent

    target_context_dir = project_root / "_context"
    set_context_dir(target_context_dir)

    trigger_workspace_sync()
    return f"Done! Patens context has been successfully mounted to {target_context_dir}. Context files will sync and update shortly."


# =====================================================================
# INITIALIZATION RUNNERS
# =====================================================================

def start_sync_daemon():
    """Ensures the background workspace sync thread is only started once per process."""
    global _sync_thread_started
    if not _sync_thread_started:
        _sync_thread_started = True
        logger.info("Initializing background workspace sync thread...")
        sync_thread = threading.Thread(target=sync_workspace_files_loop, daemon=True)
        sync_thread.start()
    else:
        logger.debug("Sync daemon thread already running.")


def run_mcp():
    """Runs the MCP server over stdio for IDE integration."""
    logger.info("Starting stdio MCP server runner...")
    start_sync_daemon()
    try:
        mcp.run()
    except Exception as e:
        logger.critical("Fatal error in MCP server execution: %s", e, exc_info=True)


def run_fastapi(port: Optional[int] = None):
    """Launches the background FastAPI server for browser integration."""
    target_port = port or API_PORT
    logger.info("Starting FastAPI Uvicorn runner on %s:%s", API_HOST, target_port)
    start_sync_daemon()

    try:
        uvicorn.run(
            fastapi_app,
            host=API_HOST,
            port=target_port,
            log_level="error",  # Silence non-critical logs on standard output
            access_log=False,  # Prevents console/I/O congestion
        )
    except Exception as e:
        logger.critical("Fatal error running Uvicorn FastAPI server: %s", e, exc_info=True)