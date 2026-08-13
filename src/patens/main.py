import logging
import sys
import io
import socket
import ctypes
import threading
import os
import signal
import subprocess
import time
import urllib.request
import json
from typing import Optional

from patens.server.config import setup_logging, API_HOST, API_PORT
from patens import installer

logger = logging.getLogger(__name__)


def configure_utf8_streams():
    """Forces UTF-8 encoding for Windows stdout/stderr safely without breaking PyTest stream capture."""
    if sys.platform == "win32":
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        elif hasattr(sys.stdout, "buffer"):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def hide_console_window():
    if sys.platform == "win32":
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)


def get_pid_listening_on_port(port: int) -> Optional[int]:
    """Finds PID listening on a given port on Windows/Linux/macOS in pure Python."""
    try:
        if sys.platform == "win32":
            res = subprocess.run(["netstat", "-ano"], capture_output=True, text=True)
            for line in res.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.strip().split()
                    if len(parts) >= 5 and parts[-1].isdigit():
                        return int(parts[-1])
        else:
            res = subprocess.run(["lsof", "-t", f"-i:{port}"], capture_output=True, text=True)
            pid_str = res.stdout.strip().splitlines()[0] if res.stdout.strip() else ""
            if pid_str.isdigit():
                return int(pid_str)
    except Exception as e:
        logger.warning("[Patens] Could not query PID for port %d: %s", port, e)
    return None


def kill_process_by_pid(pid: int):
    """Terminates a process forcefully across OS platforms."""
    if pid == os.getpid():
        return  # Prevent process self-termination

    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
        else:
            os.kill(pid, signal.SIGKILL)
        logger.info("[Patens] Terminated old process (PID: %d)", pid)
    except Exception as e:
        logger.warning("[Patens] Failed to kill process %d: %s", pid, e)


def resolve_available_port(start_port: int = API_PORT, host: str = API_HOST) -> int:
    """
    Finds a usable port.
    - If free: Returns port.
    - If occupied by Patens: Kills old Patens process and reuses port.
    - If occupied by another app: Iterates to start_port + 1, + 2, etc.
    """
    port = start_port
    max_attempts = 50

    for _ in range(max_attempts):
        # 1. Test socket connection
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            is_occupied = s.connect_ex((host, port)) == 0

        if not is_occupied:
            return port

        # 2. Port is taken. Check if it's an existing Patens instance
        logger.info("[Patens] Port %d is occupied. Probing owner...", port)
        is_patens_instance = False
        target_pid = None

        try:
            url = f"http://{host}:{port}/api/v1/config/system"
            req = urllib.request.Request(url, headers={"User-Agent": "Patens-Launcher"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if "python_path" in data or "module_path" in data or "pid" in data:
                        is_patens_instance = True
                        target_pid = data.get("pid")
        except Exception:
            pass  # Not responding to HTTP or not a Patens server

        if is_patens_instance or target_pid is not None:
            logger.info("[Patens] Port %d is occupied by an old Patens instance. Reclaiming...", port)
            if not target_pid:
                target_pid = get_pid_listening_on_port(port)

            if target_pid:
                kill_process_by_pid(target_pid)
                time.sleep(1.0)  # Pause to let OS release the socket
                return port

        # 3. Port is occupied by another non-Patens application
        logger.info("[Patens] Port %d is in use by another application. Trying port %d...", port, port + 1)
        port += 1

    return port


def main():
    is_debug = "--debug" in sys.argv

    if "--mcp" in sys.argv:
        from patens.server import unified_server
        unified_server.run_mcp()
    else:
        # 🛠️ Resolve port and kill old instance BEFORE importing unified_server
        active_port = resolve_available_port(API_PORT, API_HOST)

        # Deferred import ensures clean server initialization
        from patens.server import unified_server

        installer.install_to_ides(is_debug=is_debug)

        api_thread = threading.Thread(
            target=unified_server.run_fastapi,
            args=(active_port,),
            daemon=True
        )
        api_thread.start()

        logger.info("\n[Patens] Server running successfully on port %d!", active_port)

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