import json
import os
import sys
import time
import threading
import logging
import urllib.request
import urllib.error
from pathlib import Path

import uvicorn
from fastmcp import FastMCP
from fastembed import TextEmbedding

from patens.server.config import (
    setup_logging, DB_PATH, IMAGE_DIR, MODEL_NAME, API_HOST, API_PORT
)
from patens.server.database import DatabaseManager
from patens.server.api import create_app

setup_logging()
logger = logging.getLogger(__name__)

logger.info("=== Unified Server Starting Up ===")
os.makedirs(IMAGE_DIR, exist_ok=True)

# Global event for waking the sync thread instantly
workspace_sync_event = threading.Event()

# Initialize Core Services (Database & AI)
db_manager = DatabaseManager(str(DB_PATH))

logger.info("Loading FastEmbed model...")
embedder = TextEmbedding(model_name=MODEL_NAME)
logger.info("Model loaded successfully.")

# Initialize the API and MCP Server instances
fastapi_app = create_app(db_manager, embedder, str(IMAGE_DIR))
mcp = FastMCP("Patens")

# =====================================================================
# ZERO-FRICTION WORKSPACE SYNC ENGINE
# =====================================================================

# When an IDE launches an MCP server, it sets the Working Directory to the project root
WORKSPACE_ROOT = Path(os.getcwd())
CONTEXT_DIR = WORKSPACE_ROOT / "_context"


def is_valid_workspace(path: Path) -> bool:
    """Safeguard: Prevents polluting System32, Home, Root, or the EXE directory."""
    abs_str = str(path.absolute()).lower()

    # 1. Block Home directory and Root drive
    if path == Path.home() or abs_str in [os.path.abspath(os.sep).lower(), "c:\\", "c:/"]:
        return False

    # 2. Block system directories
    system_dirs = ["system32", "windows", "program files", "program files (x86)", "appdata"]
    if any(sys_dir in abs_str for sys_dir in system_dirs):
        return False

    # 3. CRITICAL FIX: Block the directory where the .exe actually lives!
    exe_dir = str(Path(sys.executable).parent.absolute()).lower()
    if abs_str == exe_dir:
        return False

    return True


def sync_workspace_files_loop():
    """Background daemon that automatically mirrors recent DB clips to the local workspace."""
    last_db_state = None
    has_warned_invalid = False

    while True:
        # 1. Dynamically check the CURRENT parent directory of CONTEXT_DIR
        current_workspace = CONTEXT_DIR.parent

        if not is_valid_workspace(current_workspace):
            if not has_warned_invalid:
                logger.warning(
                    f"Server workspace is currently invalid or global ({current_workspace}). Physical _context files paused."
                )
                has_warned_invalid = True

            # PAUSE execution, but DO NOT RETURN! Keep the thread alive.
            workspace_sync_event.wait(timeout=3)
            workspace_sync_event.clear()
            continue

        # Reset the warning flag once a valid workspace is mounted
        has_warned_invalid = False

        try:
            os.makedirs(CONTEXT_DIR, exist_ok=True)

            gitignore_path = CONTEXT_DIR / ".gitignore"
            if not gitignore_path.exists():
                gitignore_path.write_text("*\n", encoding="utf-8")

            recent_clips = db_manager.get_recent_snippets(hours=24)

            # Include CONTEXT_DIR in state check so changing workspace forces a redraw
            current_db_state = f"{CONTEXT_DIR}:" + "".join(
                str(c.get("id", "")) for c in recent_clips
            )

            if current_db_state != last_db_state:
                last_db_state = current_db_state
            # --- THE INTELLIGENT MERGE ENGINE ---
            grouped_clips = {}

            # Process in reverse (oldest first) so the markdown file reads chronologically
            for clip in reversed(recent_clips):
                # Group by URL (or title if URL is missing)
                key = clip.get('url') or clip.get('title') or str(clip.get('id'))

                if key not in grouped_clips:
                    grouped_clips[key] = {
                        'title': clip.get('title') or f"Saved_Snippet_{clip.get('id', 'Unknown')}",
                        'url': clip.get('url', 'Unknown'),
                        'created_at': clip.get('created_at', 'Unknown'),
                        'content': clip.get('content', ''),
                        'clip_count': 1
                    }
                else:
                    # Append the new highlight to the existing context document
                    grouped_clips[key][
                        'content'] += f"\n\n---\n> **➕ Added on:** {clip.get('created_at', 'Unknown')}\n\n" + clip.get(
                        'content', '')
                    # Update the master timestamp to reflect the most recent addition
                    grouped_clips[key]['created_at'] = clip.get('created_at', 'Unknown')
                    grouped_clips[key]['clip_count'] += 1
            # ------------------------------------

            active_filenames = {".gitignore"}

            index_content = "# 🧠 Patens Master Index\n\n"
            index_content += "> **⚠️ SYSTEM PROMPT FOR AI:**\n"
            index_content += "> **DO NOT guess or hallucinate.** You MUST use your file-reading tool to open and read the specific `.md` files linked below to get the actual context.\n"
            index_content += "> **DO NOT rely on your training data.** Read the physical file.\n\n"

            # Iterate through the MERGED clips
            for idx, (key, g_clip) in enumerate(grouped_clips.items(), 1):
                raw_title = str(g_clip['title'])
                tokens = len(g_clip['content']) // 4

                clean_title = __import__('re').sub(r'[^a-zA-Z0-9]', '_', raw_title).strip('_')
                clean_title = __import__('re').sub(r'_+', '_', clean_title)[:35]
                if not clean_title:
                    clean_title = f"Snippet_{idx}"

                # Filename automatically updates as token count grows
                filename = f"{clean_title}_{tokens}t.md"
                filepath = CONTEXT_DIR / filename
                active_filenames.add(filename)

                index_content += f"{idx}. **[{filename}]({filename})**\n"
                index_content += f"   - **Source:** {g_clip['url']}\n"
                index_content += f"   - **Size:** ~{tokens} tokens\n"
                if g_clip['clip_count'] > 1:
                    index_content += f"   - **Merged:** {g_clip['clip_count']} separate clips\n"
                index_content += "\n"

                content_md = (
                    f"<!-- Auto-synced by Patens.dev -->\n"
                    f"# {raw_title}\n"
                    f"**Source:** {g_clip['url']}\n"
                    f"**Last Updated:** {g_clip['created_at']}\n"
                    f"**Total Clips Merged:** {g_clip['clip_count']}\n\n"
                    f"---\n\n"
                    f"{g_clip['content']}"
                )

                if not filepath.exists() or filepath.read_text(encoding='utf-8') != content_md:
                    filepath.write_text(content_md, encoding='utf-8')

            # Save the Master Index file
            index_filename = "00_Context_Index.md"
            index_filepath = CONTEXT_DIR / index_filename
            active_filenames.add(index_filename)

            if not index_filepath.exists() or index_filepath.read_text(encoding='utf-8') != index_content:
                index_filepath.write_text(index_content, encoding='utf-8')

            # Prune engine: If a file grows (e.g., _50t.md becomes _120t.md),
            # the old smaller file is automatically deleted here because it's no longer in active_filenames.
            for file in CONTEXT_DIR.iterdir():
                if file.is_file() and file.name not in active_filenames:
                    file.unlink()



        except Exception as e:
            logger.error(f"Workspace sync thread error: {e}")

        workspace_sync_event.wait(timeout=3)

        workspace_sync_event.clear()


# =====================================================================
# MCP TOOLS (Letting the AI manage its own memory)
# =====================================================================

def notify_ide_activity(event: str = "tool_call", **meta):
    def _ping():
        try:
            payload = json.dumps({"event": event, "ts": time.time(), **meta}).encode()
            req = urllib.request.Request(
                f"http://{API_HOST}:{API_PORT}/api/internal/activity",
                data=payload, headers={"Content-Type": "application/json"}, method="POST",
            )
            urllib.request.urlopen(req, timeout=1.0)
        except Exception:
            pass

    threading.Thread(target=_ping, daemon=True).start()


@mcp.tool()
def query_browser_context(search_query: str, limit: int = 3) -> str:
    """
    CRITICAL: Use this tool ANYTIME the user mentions "saved context", "memory", "clips", "clipboard".
    Searches the user's global SQLite memory for older clips not in the active workspace.
    """
    logger.info(f"Semantic search requested for: '{search_query}'")
    query_vector = list(embedder.embed([search_query]))[0].tolist()
    results = db_manager.search_similar(search_query, query_vector, limit)

    if not results:
        return "No matching browser context found."

    output = "Found relevant web context:\n\n"
    for r in results:
        output += f"### [ID: {r.get('id', 'unknown')}] Source: {r['title']}\nURL: {r['url']}\n\n```text\n{r['content']}\n```\n\n"
    notify_ide_activity(
        tool="query_browser_context",
        query=search_query,
        result_count=len(results),
        approx_tokens=sum(len(r['content']) for r in results) // 4
    )
    return output


@mcp.tool()
def forget_memory(memory_id: int) -> str:
    """
    CRITICAL: Use this tool to delete outdated, incorrect, or deprecated context from the user's memory.
    The background sync engine will automatically delete the local .md file from the IDE.
    """
    logger.info(f"Forget memory requested for ID: {memory_id}")
    notify_ide_activity()
    success = db_manager.delete_snippet(memory_id)
    if success:
        workspace_sync_event.set()  # Wakes the thread instantly
        return f"Successfully deleted memory ID {memory_id}..."
    return f"Failed to delete memory ID {memory_id}."


@mcp.tool()
def memorize_ide_insight(title: str, insight: str) -> str:
    """
    Saves an important conclusion, bug fix, or architectural decision from this IDE conversation
    into the user's permanent vector memory database.
    """
    logger.info(f"Saving IDE insight to memory: '{title}'")
    notify_ide_activity()
    embedding = list(embedder.embed([insight]))[0].tolist()
    internal_url = f"ide://chat-resolution/{int(time.time())}"

    content_id = db_manager.insert_snippet(
        url=internal_url, title=title, content=insight, embedding=embedding
    )
    workspace_sync_event.set()
    return f"Success! The insight '{title}' has been permanently saved..."


@mcp.tool()
def mount_workspace_context(absolute_project_path: str) -> str:
    """
    CRITICAL: Use this tool anytime the user asks you to "sync files", "mount context", or if you cannot find the _context folder.
    Extract the absolute path of the user's currently open IDE workspace and pass it as the argument.
    """
    global CONTEXT_DIR
    logger.info(f"AI requested to mount context to: {absolute_project_path}")

    project_path = Path(absolute_project_path)

    if not project_path.exists() or not project_path.is_dir():
        return f"Failed: Could not verify '{absolute_project_path}' as a valid directory."

    CONTEXT_DIR = project_path / "_context"

    # Trigger an immediate write so the files appear instantly
    logger.info(f"Context successfully redirected to {CONTEXT_DIR}")
    workspace_sync_event.set()
    return f"Success! The context engine has been redirected. The _context folder and index file will appear in {CONTEXT_DIR} within 3 seconds. You can then read them."


# =====================================================================
# RUNNERS
# =====================================================================

def run_mcp():
    """Runs the MCP server over stdio for IDE integration."""
    logger.info("Initializing stdio MCP server for the IDE...")

    # Auto-start the sync engine. The `is_valid_workspace` check keeps it safe!
    sync_thread = threading.Thread(target=sync_workspace_files_loop, daemon=True)
    sync_thread.start()

    mcp.run()


def run_fastapi():
    """Launches the background API server for the Chrome extension."""
    logger.info(f"Starting FastAPI server on {API_HOST}:{API_PORT}")

    # Start the sync engine in the active terminal so the user can see logs!
    sync_thread = threading.Thread(target=sync_workspace_files_loop, daemon=True)
    sync_thread.start()

    uvicorn.run(fastapi_app, host=API_HOST, port=API_PORT, log_level="warning")
