import sys
import socket
import pytest
from unittest.mock import MagicMock, patch, call

# Target module under test
from patens import main


# =====================================================================
# FIXTURES
# =====================================================================

@pytest.fixture(autouse=True)
def reset_main_state():
    """Resets global module state and sys.argv before each test."""
    main._instance_lock = None
    original_argv = sys.argv.copy()
    yield
    sys.argv = original_argv
    main._instance_lock = None


@pytest.fixture
def mock_dependencies(mocker):
    """Mocks all external module calls and long-running services."""
    mock_server = mocker.patch("patens.main.unified_server")
    mock_installer = mocker.patch("patens.main.installer")
    mock_logger = mocker.patch("patens.main.logger")

    # Mock threading.Thread to avoid launching actual background threads
    mock_thread_cls = mocker.patch("patens.main.threading.Thread")
    mock_thread_inst = MagicMock()
    mock_thread_cls.return_value = mock_thread_inst

    return {
        "server": mock_server,
        "installer": mock_installer,
        "logger": mock_logger,
        "thread": mock_thread_inst,
    }


# =====================================================================
# UNIT TESTS: SYSTEM INSTANCE LOCKING
# =====================================================================

def test_enforce_single_api_instance_success(mocker):
    """Test successful socket binding when no other instance is running."""
    mock_socket_cls = mocker.patch("patens.main.socket.socket")
    mock_socket_inst = MagicMock()
    mock_socket_cls.return_value = mock_socket_inst

    main.enforce_single_api_instance()

    mock_socket_cls.assert_called_once_with(socket.AF_INET, socket.SOCK_DGRAM)
    mock_socket_inst.bind.assert_called_once_with(("127.0.0.1", 61234))
    assert main._instance_lock == mock_socket_inst


def test_enforce_single_api_instance_already_running(mocker):
    """Test that sys.exit(0) is called cleanly when socket port is already bound."""
    mock_socket_cls = mocker.patch("patens.main.socket.socket")
    mock_socket_inst = MagicMock()
    mock_socket_inst.bind.side_effect = OSError("Address already in use")
    mock_socket_cls.return_value = mock_socket_inst

    mock_exit = mocker.patch("patens.main.sys.exit")

    main.enforce_single_api_instance()

    mock_exit.assert_called_once_with(0)


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
# INTEGRATION TESTS: MAIN EXECUTION FLOWS
# =====================================================================

def test_main_mcp_mode(mock_dependencies, mocker):
    """Test that --mcp flag routes execution to run_mcp and skips server setup."""
    sys.argv = ["main.py", "--mcp"]
    mock_enforce = mocker.patch("patens.main.enforce_single_api_instance")

    main.main()

    mock_dependencies["server"].run_mcp.assert_called_once()
    mock_enforce.assert_not_called()
    mock_dependencies["installer"].install_to_ides.assert_not_called()


def test_main_interactive_mode_enter_pressed(mock_dependencies, mocker):
    """Test default server mode in interactive TTY waiting for ENTER press."""
    sys.argv = ["main.py"]
    mock_enforce = mocker.patch("patens.main.enforce_single_api_instance")

    # Mock TTY environment
    mocker.patch("sys.stdin.isatty", return_value=True)
    mock_input = mocker.patch("builtins.input", return_value="")

    main.main()

    mock_enforce.assert_called_once()
    mock_dependencies["installer"].install_to_ides.assert_called_once_with(is_debug=False)
    mock_dependencies["thread"].start.assert_called_once()
    mock_input.assert_called_once()


def test_main_non_interactive_mode_join_loop(mock_dependencies, mocker):
    """Test non-interactive daemon execution (e.g. GUI background mode)."""
    sys.argv = ["main.py"]
    mocker.patch("patens.main.enforce_single_api_instance")
    mocker.patch("sys.stdin.isatty", return_value=False)

    # Simulate thread being alive once, then dying on second check to exit loop
    mock_thread = mock_dependencies["thread"]
    mock_thread.is_alive.side_effect = [True, False]

    main.main()

    mock_thread.join.assert_called_once_with(timeout=2.0)


def test_main_debug_flag_propagation(mock_dependencies, mocker):
    """Test that --debug flag passes is_debug=True to IDE installer."""
    sys.argv = ["main.py", "--debug"]
    mocker.patch("patens.main.enforce_single_api_instance")
    mocker.patch("sys.stdin.isatty", return_value=True)
    mocker.patch("builtins.input", return_value="")

    main.main()

    mock_dependencies["installer"].install_to_ides.assert_called_once_with(is_debug=True)


@pytest.mark.parametrize("exception_cls", [KeyboardInterrupt, EOFError])
def test_main_graceful_interrupt_handling(exception_cls, mock_dependencies, mocker):
    """Test that Ctrl+C or EOF cleanly exits main without bubbling unhandled exceptions."""
    sys.argv = ["main.py"]
    mocker.patch("patens.main.enforce_single_api_instance")
    mocker.patch("sys.stdin.isatty", return_value=True)
    mocker.patch("builtins.input", side_effect=exception_cls)

    try:
        main.main()
    except exception_cls:
        pytest.fail(f"main() did not catch {exception_cls.__name__} cleanly.")