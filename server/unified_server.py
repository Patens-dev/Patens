import os
import time
import threading
import logging
import uvicorn
from fastmcp import FastMCP
from sentence_transformers import SentenceTransformer

# Import our modular components
from config import (
    setup_logging, DB_PATH, IMAGE_DIR, MODEL_NAME, API_HOST, API_PORT
)
from database import DatabaseManager
from api import create_app

setup_logging()
logger = logging.getLogger(__name__)

logger.info("=== Unified Server Starting Up ===")
os.makedirs(IMAGE_DIR, exist_ok=True)

# Initialize Core Services (Database & AI)
db_manager = DatabaseManager(str(DB_PATH))

logger.info("Loading SentenceTransformer model...")
embedder = SentenceTransformer(MODEL_NAME)
logger.info("Model loaded successfully.")

# Initialize the API and MCP Server instances
fastapi_app = create_app(db_manager, embedder, str(IMAGE_DIR))
mcp = FastMCP("ContextClipboard")


@mcp.tool()
def query_browser_context(search_query: str, limit: int = 3) -> str:
    """
    CRITICAL: Use this tool ANYTIME the user mentions "saved context", "memory", "clips", "clipboard", or asks "Do I have anything saved about...".
    This tool searches the user's private SQLite vector database of saved web snippets, documentation, and chat resolutions.
    Do NOT write scripts, generate code, or guess the answer if the user asks what they have saved. ALWAYS call this tool first.
    Example triggers: "Do I have any context saved about React?", "Search my memory for Stripe API", "Check my clips for useEffect".
    """
    logger.info(f"Semantic search requested for: '{search_query}'")
    query_vector = embedder.encode(search_query).tolist()

    # Note the new `search_query` argument passed here!
    results = db_manager.search_similar(search_query, query_vector, limit)

    if not results:
        return "No matching browser context found."

    output = "Found relevant web context:\n\n"
    for r in results:
        output += f"### Source: {r['title']}\nURL: {r['url']}\n\n```text\n{r['content']}\n```\n\n"
    return output


@mcp.tool()
def memorize_ide_insight(title: str, insight: str) -> str:
    """
    Saves an important conclusion, bug fix, or architectural decision from this IDE conversation
    into the user's permanent vector memory database.
    """
    logger.info(f"Saving IDE insight to memory: '{title}'")

    embedding = embedder.encode(insight).tolist()
    internal_url = f"ide://chat-resolution/{int(time.time())}"

    content_id = db_manager.insert_snippet(
        url=internal_url,
        title=title,
        content=insight,
        embedding=embedding
    )

    return f"Success! The insight '{title}' has been permanently saved to the user's memory (ID: {content_id}). It will now be available in future chats."


@mcp.tool()
def get_latest_browser_context(limit: int = 1) -> str:
    """
    CRITICAL: Retrieve the absolute most recently saved context clips from the browser chronologically.
    USE THIS TOOL IMMEDIATELY when the user says "what did I just save", "use the last snippet", "based on the latest clip", or "look at the last piece of info".
    Do NOT attempt to write a script to find this information. Call this tool.
    """
    logger.info(f"Latest context tool requested (limit={limit})")
    results = db_manager.get_latest(limit)

    if not results:
        return "Your clipboard is empty. No context has been saved yet."

    output = "Here is the most recently saved browser context:\n\n"
    for r in results:
        output += f"### Source: {r['title']}\nSaved at: {r['created_at']}\nURL: {r['url']}\n\n```text\n{r['content']}\n```\n\n"
    return output


@mcp.resource("clipboard://latest")
def get_latest_resource() -> str:
    """
    Exposes the most recent browser clip as a virtual file.
    Users can just type @clipboard://latest in their IDE to instantly attach the context.
    """
    logger.info("Resource requested: clipboard://latest")
    results = db_manager.get_latest(1)

    if not results:
        return "No clipboard history found."

    r = results[0]
    return f"--- {r['title']} ---\nSource: {r['url']}\n\n{r['content']}"


@mcp.prompt()
def review_latest_clip() -> str:
    """
    Creates a native slash command in the IDE.
    When selected, it pre-fills the chat with the latest browser context and a review instruction.
    """
    logger.info("Prompt requested: review_latest_clip")
    results = db_manager.get_latest(1)

    if not results:
        return "Please review my code."

    r = results[0]
    return f"""I just saved this snippet from the web regarding '{r['title']}':

```text
{r['content']}
```

Please analyze my current open file and tell me how I can apply this snippet to my code."""


@mcp.prompt()
def memorize_chat() -> str:
    """
    Creates a slash command to instantly summarize and save the current conversation.
    """
    logger.info("Prompt requested: memorize_chat")
    return """Please analyze our entire conversation up to this point. 

1. Identify the core problem we were trying to solve.
2. Summarize the final solution, including any key code snippets, architectural decisions, or bugs we fixed.
3. Call the `memorize_ide_insight` tool to save this summary into my permanent memory database. 

Format the title as "Chat Resolution: [Topic]"."""


def run_fastapi():
    """Runs the FastAPI server in a background thread."""
    logger.info(f"Starting background FastAPI on {API_HOST}:{API_PORT}...")
    uvicorn.run(fastapi_app, host=API_HOST, port=API_PORT, log_level="error")


if __name__ == "__main__":
    api_thread = threading.Thread(target=run_fastapi, daemon=True)
    api_thread.start()

    logger.info("Initializing stdio MCP server for the IDE...")
    mcp.run()
