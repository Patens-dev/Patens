# src/context_clipboard/main.py
import sys
import webbrowser
import threading
import time
import ctypes

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


def hide_console_window():
    """
    Hides the terminal window on Windows to prevent intimidating users,
    while keeping the stdio pipes alive so MCP can still talk to the IDE.
    """
    if sys.platform == "win32":
        # Get the internal Windows handle for the current console window
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            # 0 corresponds to SW_HIDE in the Windows API
            ctypes.windll.user32.ShowWindow(hwnd, 0)


# --- Add this near the very beginning of your main block ---
if __name__ == "__main__":
    # Hide the console immediately, UNLESS we are debugging
    if "--debug" not in sys.argv:
        hide_console_window()
    main()
