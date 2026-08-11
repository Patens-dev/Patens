import logging
import sys
import io
import socket
import ctypes
import threading

from patens.server import unified_server
from patens import installer
from patens.server.config import setup_logging

logger = logging.getLogger(__name__)

# Global variable to hold the socket open
_instance_lock = None


def configure_utf8_streams():
    """Forces UTF-8 encoding for Windows stdout/stderr safely without breaking PyTest stream capture."""
    if sys.platform == "win32":
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        elif hasattr(sys.stdout, "buffer"):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def enforce_single_api_instance():
    """Binds to a hidden local port. If it fails, another Patens API is already running."""
    global _instance_lock
    _instance_lock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Port 61234 is arbitrary. It just acts as a system-wide lock.
        _instance_lock.bind(('127.0.0.1', 61234))
    except OSError:
        logger.info("[Patens] Another API instance is already running. Exiting cleanly.")
        sys.exit(0)


def hide_console_window():
    if sys.platform == "win32":
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)


def main():
    is_debug = "--debug" in sys.argv

    if "--mcp" in sys.argv:
        # IDEs handle MCP instance lifecycles natively
        unified_server.run_mcp()
    else:
        # 🛠️ Guarantee only ONE background API server exists
        enforce_single_api_instance()

        installer.install_to_ides(is_debug=is_debug)

        api_thread = threading.Thread(target=unified_server.run_fastapi, daemon=True)
        api_thread.start()

        logger.info("\n[Patens] Server running successfully!")

        try:
            if sys.stdin and sys.stdin.isatty():
                input("\nPress ENTER to stop the server.\n")
            else:
                while api_thread.is_alive():
                    api_thread.join(timeout=2.0)
        except (KeyboardInterrupt, EOFError):
            pass


if __name__ == "__main__":
    configure_utf8_streams()
    setup_logging()

    if "--debug" not in sys.argv:
        hide_console_window()

    main()