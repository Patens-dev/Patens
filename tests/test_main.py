import sys
import os
import socket
import signal
import pytest
from unittest.mock import MagicMock, patch, call

# Target module under test
from patens import main


# =====================================================================
# FIXTURES
# =====================================================================

@pytest.fixture(autouse=True)
def reset_main_state():
    """Resets sys.argv before each test."""
    original_argv = sys.argv.copy()
    yield
    sys.argv = original_argv


@pytest.fixture
def mock_dependencies(mocker):
    """Mocks all external module calls and long-running services for main()."""
    mock_server = mocker.patch("patens.server.unified_server")
    mock_installer = mocker.patch("patens.main.installer")
    mock_logger = mocker.patch("patens.main.logger")
    mock_resolve_port = mocker.patch("patens.main.resolve_available_port", return_value=8000)

    # Mock threading.Thread to avoid launching actual background threads
    mock_thread_cls = mocker.patch("patens.main.threading.Thread")
    mock_thread_inst = MagicMock()
    mock_thread_cls.return_value = mock_thread_inst

    return {
        "server": mock_server,
        "installer": mock_installer,
        "logger": mock_logger,
        "resolve_port": mock_resolve_port,
        "thread": mock_thread_inst,
    }


# =====================================================================
# UNIT TESTS: UTF-8 STREAM CONFIGURATION
# =====================================================================

def test_configure_utf8_streams_win32_reconfigure(mocker):
    """Test stdout/stderr reconfigure on Windows when reconfigure method exists."""
    mocker.patch.object(sys, "platform", "win32")
    mocker.patch.object(sys.stdout, "reconfigure", create=True)
    mocker.patch.object(sys.stderr, "reconfigure", create=True)

    main.configure_utf8_streams()

    sys.stdout.reconfigure.assert_called_once_with(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure.assert_called_once_with(encoding="utf-8", errors="replace")


def test_configure_utf8_streams_win32_fallback_buffer(mocker):
    """Test TextIOWrapper fallback when stdout has no reconfigure attribute."""
    mocker.patch.object(sys, "platform", "win32")
    mock_stdout = MagicMock(spec=["buffer"])
    mock_stderr = MagicMock(spec=["buffer"])
    mocker.patch.object(sys, "stdout", mock_stdout)
    mocker.patch.object(sys, "stderr", mock_stderr)
    mock_text_io = mocker.patch("io.TextIOWrapper")

    main.configure_utf8_streams()

    assert mock_text_io.call_count == 2


def test_configure_utf8_streams_non_windows(mocker):
    """Test configure_utf8_streams does nothing on non-Windows platforms."""
    mocker.patch.object(sys, "platform", "linux")
    mock_stdout = MagicMock()
    mocker.patch.object(sys, "stdout", mock_stdout)

    main.configure_utf8_streams()

    mock_stdout.reconfigure.assert_not_called()


# =====================================================================
# UNIT TESTS: PLATFORM SPECIFICS (WINDOWS CONSOLE HIDING)
# =====================================================================

def test_hide_console_window_win32(mocker):
    """Test that ctypes ShowWindow is invoked on Windows when HWND exists."""
    mocker.patch.object(sys, "platform", "win32")

    mock_kernel32 = MagicMock()
    mock_user32 = MagicMock()
    mock_kernel32.GetConsoleWindow.return_value = 12345  # Valid HWND handle

    mocker.patch("ctypes.windll", create=True, kernel32=mock_kernel32, user32=mock_user32)

    main.hide_console_window()

    mock_kernel32.GetConsoleWindow.assert_called_once()
    mock_user32.ShowWindow.assert_called_once_with(12345, 0)


def test_hide_console_window_win32_no_hwnd(mocker):
    """Test that ShowWindow is skipped if GetConsoleWindow returns NULL (0)."""
    mocker.patch.object(sys, "platform", "win32")

    mock_kernel32 = MagicMock()
    mock_user32 = MagicMock()
    mock_kernel32.GetConsoleWindow.return_value = 0  # No console window

    mocker.patch("ctypes.windll", create=True, kernel32=mock_kernel32, user32=mock_user32)

    main.hide_console_window()

    mock_kernel32.GetConsoleWindow.assert_called_once()
    mock_user32.ShowWindow.assert_not_called()


def test_hide_console_window_non_windows(mocker):
    """Test that hide_console_window does nothing on Linux/macOS."""
    mocker.patch.object(sys, "platform", "linux")
    mock_ctypes = mocker.patch("patens.main.ctypes")

    main.hide_console_window()

    mock_ctypes.windll.assert_not_called()


# =====================================================================
# UNIT TESTS: PROCESS & PORT RESOLUTION UTILITIES
# =====================================================================

def test_get_pid_listening_on_port_win32(mocker):
    """Test querying listening PID on Windows via netstat."""
    mocker.patch.object(sys, "platform", "win32")
    netstat_output = "  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       1234\n"
    mocker.patch("subprocess.run", return_value=MagicMock(stdout=netstat_output))

    pid = main.get_pid_listening_on_port(8000)
    assert pid == 1234


def test_get_pid_listening_on_port_posix(mocker):
    """Test querying listening PID on POSIX via lsof."""
    mocker.patch.object(sys, "platform", "linux")
    mocker.patch("subprocess.run", return_value=MagicMock(stdout="5678\n"))

    pid = main.get_pid_listening_on_port(8000)
    assert pid == 5678


def test_get_pid_listening_on_port_not_found(mocker):
    """Test returning None when no process is listening on the port."""
    mocker.patch.object(sys, "platform", "linux")
    mocker.patch("subprocess.run", return_value=MagicMock(stdout=""))

    pid = main.get_pid_listening_on_port(8000)
    assert pid is None


def test_get_pid_listening_on_port_handles_exception(mocker):
    """Test graceful exception handling when subprocess fails."""
    mocker.patch("subprocess.run", side_effect=OSError("Command failed"))
    mock_logger = mocker.patch("patens.main.logger")

    pid = main.get_pid_listening_on_port(8000)
    assert pid is None
    mock_logger.warning.assert_called_once()


def test_kill_process_by_pid_self_prevention(mocker):
    """Test that killing current process PID is prevented."""
    mocker.patch("os.getpid", return_value=9999)
    mock_sub = mocker.patch("subprocess.run")
    mock_kill = mocker.patch("os.kill")

    main.kill_process_by_pid(9999)

    mock_sub.assert_not_called()
    mock_kill.assert_not_called()


def test_kill_process_by_pid_win32(mocker):
    """Test terminating process on Windows using taskkill."""
    mocker.patch.object(sys, "platform", "win32")
    mocker.patch("os.getpid", return_value=1000)
    mock_sub = mocker.patch("subprocess.run")

    main.kill_process_by_pid(2000)

    mock_sub.assert_called_once_with(["taskkill", "/F", "/PID", "2000"], capture_output=True)


def test_kill_process_by_pid_posix(mocker):
    """Test terminating process on POSIX using os.kill SIGKILL."""
    mocker.patch.object(sys, "platform", "linux")
    mocker.patch("os.getpid", return_value=1000)
    mock_kill = mocker.patch("os.kill")

    # signal.SIGKILL is absent on Windows Python interpreters; fallback to POSIX signal 9
    sig_kill = getattr(signal, "SIGKILL", 9)
    mocker.patch.object(signal, "SIGKILL", sig_kill, create=True)

    main.kill_process_by_pid(2000)

    mock_kill.assert_called_once_with(2000, sig_kill)


def test_kill_process_by_pid_handles_exception(mocker):
    """Test exception handling during process termination."""
    mocker.patch.object(sys, "platform", "linux")
    mocker.patch("os.getpid", return_value=1000)
    mocker.patch("os.kill", side_effect=OSError("Permission denied"))
    mock_logger = mocker.patch("patens.main.logger")

    main.kill_process_by_pid(2000)

    mock_logger.warning.assert_called_once()


def test_resolve_available_port_free(mocker):
    """Test resolve_available_port returns port immediately when port is free."""
    mock_socket = MagicMock()
    mock_socket.connect_ex.return_value = 1  # Non-zero means connection failed / port free
    mock_socket_ctx = MagicMock(__enter__=MagicMock(return_value=mock_socket), __exit__=MagicMock())
    mocker.patch("socket.socket", return_value=mock_socket_ctx)

    port = main.resolve_available_port(8000, "127.0.0.1")

    assert port == 8000


def test_resolve_available_port_reclaims_patens_instance(mocker):
    """Test resolve_available_port kills old Patens process and reuses port."""
    mock_socket = MagicMock()
    mock_socket.connect_ex.return_value = 0  # Port is occupied
    mock_socket_ctx = MagicMock(__enter__=MagicMock(return_value=mock_socket), __exit__=MagicMock())
    mocker.patch("socket.socket", return_value=mock_socket_ctx)

    # Mock HTTP probe returning Patens signature
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = b'{"pid": 4321, "python_path": "/usr/bin/python"}'
    mock_resp_ctx = MagicMock(__enter__=MagicMock(return_value=mock_resp), __exit__=MagicMock())
    mocker.patch("urllib.request.urlopen", return_value=mock_resp_ctx)

    mock_kill = mocker.patch("patens.main.kill_process_by_pid")
    mocker.patch("time.sleep")

    port = main.resolve_available_port(8000, "127.0.0.1")

    assert port == 8000
    mock_kill.assert_called_once_with(4321)


def test_resolve_available_port_occupied_by_other_app(mocker):
    """Test resolve_available_port increments port when occupied by a non-Patens app."""
    # First port 8000 is occupied (connect_ex=0), second port 8001 is free (connect_ex=1)
    mock_socket1 = MagicMock()
    mock_socket1.connect_ex.return_value = 0
    mock_socket2 = MagicMock()
    mock_socket2.connect_ex.return_value = 1

    mock_ctx1 = MagicMock(__enter__=MagicMock(return_value=mock_socket1), __exit__=MagicMock())
    mock_ctx2 = MagicMock(__enter__=MagicMock(return_value=mock_socket2), __exit__=MagicMock())

    mocker.patch("socket.socket", side_effect=[mock_ctx1, mock_ctx2])

    # HTTP probe fails (non-Patens application)
    mocker.patch("urllib.request.urlopen", side_effect=OSError("Connection refused"))

    port = main.resolve_available_port(8000, "127.0.0.1")

    assert port == 8001


def test_resolve_available_port_patens_instance_without_pid_in_json(mocker):
    """Test reclaim when Patens HTTP response is missing PID in JSON, falling back to get_pid_listening_on_port."""
    mock_socket = MagicMock()
    mock_socket.connect_ex.return_value = 0  # Port occupied
    mock_socket_ctx = MagicMock(__enter__=MagicMock(return_value=mock_socket), __exit__=MagicMock())
    mocker.patch("socket.socket", return_value=mock_socket_ctx)

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = b'{"module_path": "/app/patens"}'
    mock_resp_ctx = MagicMock(__enter__=MagicMock(return_value=mock_resp), __exit__=MagicMock())
    mocker.patch("urllib.request.urlopen", return_value=mock_resp_ctx)

    mocker.patch("patens.main.get_pid_listening_on_port", return_value=7890)
    mock_kill = mocker.patch("patens.main.kill_process_by_pid")
    mocker.patch("time.sleep")

    port = main.resolve_available_port(8000, "127.0.0.1")

    assert port == 8000
    mock_kill.assert_called_once_with(7890)


# =====================================================================
# INTEGRATION TESTS: MAIN EXECUTION FLOWS
# =====================================================================

def test_main_mcp_mode(mock_dependencies):
    """Test that --mcp flag routes execution to run_mcp and skips server setup."""
    sys.argv = ["main.py", "--mcp"]

    main.main()

    mock_dependencies["server"].run_mcp.assert_called_once()
    mock_dependencies["resolve_port"].assert_not_called()
    mock_dependencies["installer"].install_to_ides.assert_not_called()


def test_main_interactive_mode_enter_pressed(mock_dependencies, mocker):
    """Test default server mode in interactive TTY waiting for ENTER press."""
    sys.argv = ["main.py"]

    # Mock TTY environment
    mocker.patch("sys.stdin.isatty", return_value=True)
    mock_input = mocker.patch("builtins.input", return_value="")

    main.main()

    mock_dependencies["resolve_port"].assert_called_once()
    mock_dependencies["installer"].install_to_ides.assert_called_once_with(is_debug=False)
    mock_dependencies["thread"].start.assert_called_once()
    mock_input.assert_called_once()


def test_main_non_interactive_mode_join_loop(mock_dependencies, mocker):
    """Test non-interactive daemon execution (e.g. GUI background mode)."""
    sys.argv = ["main.py"]
    mocker.patch("sys.stdin.isatty", return_value=False)

    # Simulate thread being alive once, then dying on second check to exit loop
    mock_thread = mock_dependencies["thread"]
    mock_thread.is_alive.side_effect = [True, False]

    main.main()

    mock_thread.join.assert_called_once_with(timeout=2.0)


def test_main_debug_flag_propagation(mock_dependencies, mocker):
    """Test that --debug flag passes is_debug=True to IDE installer."""
    sys.argv = ["main.py", "--debug"]
    mocker.patch("sys.stdin.isatty", return_value=True)
    mocker.patch("builtins.input", return_value="")

    main.main()

    mock_dependencies["installer"].install_to_ides.assert_called_once_with(is_debug=True)


@pytest.mark.parametrize("exception_cls", [KeyboardInterrupt, EOFError])
def test_main_graceful_interrupt_handling(exception_cls, mock_dependencies, mocker):
    """Test that Ctrl+C or EOF cleanly exits main without bubbling unhandled exceptions."""
    sys.argv = ["main.py"]
    mocker.patch("sys.stdin.isatty", return_value=True)
    mocker.patch("builtins.input", side_effect=exception_cls)

    try:
        main.main()
    except exception_cls:
        pytest.fail(f"main() did not catch {exception_cls.__name__} cleanly.")