# src/context_clipboard/main.py
import sys
import webbrowser
import threading
import time
from pathlib import Path

from context_clipboard.server import unified_server
from context_clipboard import installer


def main():
    if "--mcp" in sys.argv:
        # Run the MCP server layer directly
        unified_server.run_mcp()
    else:
        # Pass the exe path to your clean installer module
        current_exe = Path(sys.executable) if getattr(sys, 'frozen', False) else Path(__file__).absolute()
        installer.install_to_ides(current_exe)

        # Launch the FastAPI app thread
        api_thread = threading.Thread(target=unified_server.run_fastapi, daemon=True)
        api_thread.start()

        print("\n🎉 Context Clipboard Initialized!")
        time.sleep(1.5)
        webbrowser.open("http://localhost:8000/settings")

        input("\nPress ENTER to stop the background server.")


if __name__ == "__main__":
    main()