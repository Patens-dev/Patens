# src/context_clipboard/main.py
import sys
import webbrowser
import threading
import time

from context_clipboard.server import unified_server
from context_clipboard import installer


def main():
    is_debug = "--debug" in sys.argv

    if "--mcp" in sys.argv:
        # Run the MCP server layer directly
        unified_server.run_mcp()
    else:
        # Automatically detect environment and inject correct paths into IDEs
        installer.install_to_ides(is_debug=is_debug)

        # Launch the FastAPI app thread
        api_thread = threading.Thread(target=unified_server.run_fastapi, daemon=True)
        api_thread.start()

        print("\n🎉 Context Clipboard Initialized!")
        time.sleep(1.5)
        webbrowser.open("http://localhost:8000/welcome")

        input("\nPress ENTER to stop the background server.")


if __name__ == "__main__":
    main()