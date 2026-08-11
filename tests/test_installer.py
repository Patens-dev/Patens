import os
import sys
import json
import platform
from pathlib import Path
import pytest
from unittest.mock import MagicMock, patch

from patens import installer


# =====================================================================
# 1. UNIT TESTS: GET IDE PATHS (CROSS-PLATFORM)
# =====================================================================

@pytest.mark.parametrize("system_name,expected_roaming,expected_local", [
    (
        "Windows",
        Path("C:/MockAppData/Roaming"),
        Path("C:/MockAppData/Local"),
    ),
    (
        "Darwin",
        Path.home() / "Library" / "Application Support",
        Path.home() / "Library" / "Application Support",
    ),
    (
        "Linux",
        Path.home() / ".config",
        Path.home() / ".local" / "share",
    ),
])
def test_get_ide_paths_cross_platform(monkeypatch, system_name, expected_roaming, expected_local):
    """Verifies correct path resolution across Windows, macOS, and Linux."""
    monkeypatch.setattr(platform, "system", lambda: system_name)

    if system_name == "Windows":
        monkeypatch.setenv("APPDATA", "C:\\MockAppData\\Roaming")
        monkeypatch.setenv("LOCALAPPDATA", "C:\\MockAppData\\Local")

    paths = installer.get_ide_paths()

    assert paths["VS Code"] == expected_roaming / "Code" / "User" / "mcp.json"
    assert paths["Cursor"] == Path.home() / ".cursor" / "mcp.json"
    assert paths["JetBrains"] == expected_local / "github-copilot" / "intellij" / "mcp.json"
    assert paths["Claude Desktop"] == expected_roaming / "Claude" / "claude_desktop_config.json"


# =====================================================================
# 2. UNIT TESTS: JSON COMMENT STRIPPER
# =====================================================================

def test_strip_json_comments_plain_json():
    """Test that valid JSON without comments remains untouched."""
    raw = '{"key": "value", "number": 123}'
    cleaned = installer.strip_json_comments(raw)
    assert json.loads(cleaned) == {"key": "value", "number": 123}


def test_strip_json_comments_single_line():
    """Test removing single-line // comments."""
    raw = """
    {
        // This is a comment
        "name": "Patens", // inline comment
        "active": true
    }
    """
    cleaned = installer.strip_json_comments(raw)
    assert json.loads(cleaned) == {"name": "Patens", "active": True}


def test_strip_json_comments_block():
    """Test removing multi-line /* ... */ comments."""
    raw = """
    {
        /* Multi-line block comment
           spanning across lines */
        "mcp": true
    }
    """
    cleaned = installer.strip_json_comments(raw)
    assert json.loads(cleaned) == {"mcp": True}


def test_strip_json_comments_inside_string_literals():
    """Ensures // and /* */ inside string values (like URLs) are NOT removed."""
    raw = '{"url": "https://example.com/api//v1", "note": "/* keep me */"}'
    cleaned = installer.strip_json_comments(raw)
    parsed = json.loads(cleaned)
    assert parsed["url"] == "https://example.com/api//v1"
    assert parsed["note"] == "/* keep me */"


def test_strip_json_comments_escaped_quotes():
    """Tests handling of escaped quotes inside string literals."""
    raw = r'{"escaped": "quoted \" // string", /* comment */ "a": 1}'
    cleaned = installer.strip_json_comments(raw)
    parsed = json.loads(cleaned)
    assert parsed["escaped"] == 'quoted " // string'
    assert parsed["a"] == 1


# =====================================================================
# 3. INTEGRATION TESTS: INSTALL TO IDES
# =====================================================================

@pytest.fixture
def mock_ide_environment(tmp_path, monkeypatch):
    """
    Constructs a isolated temporary filesystem representing IDE config paths
    to ensure tests NEVER touch real user configuration files.
    """
    vscode_dir = tmp_path / "Code" / "User"
    cursor_dir = tmp_path / ".cursor"
    jetbrains_dir = tmp_path / "github-copilot" / "intellij"

    vscode_dir.mkdir(parents=True, exist_ok=True)
    cursor_dir.mkdir(parents=True, exist_ok=True)
    # Intentionally leave JetBrains directory missing to test directory existence check

    mock_paths = {
        "VS Code": vscode_dir / "mcp.json",
        "Cursor": cursor_dir / "mcp.json",
        "JetBrains": jetbrains_dir / "mcp.json",
    }

    monkeypatch.setattr(installer, "get_ide_paths", lambda: mock_paths)
    return mock_paths


def test_install_to_ides_creates_new_config(mock_ide_environment):
    """Tests injecting Patens config into existing directories with no existing config file."""
    installer.install_to_ides(is_debug=False)

    vscode_file = mock_ide_environment["VS Code"]
    cursor_file = mock_ide_environment["Cursor"]
    jetbrains_file = mock_ide_environment["JetBrains"]

    # VS Code should use 'servers' schema key
    assert vscode_file.exists()
    vscode_data = json.loads(vscode_file.read_text(encoding="utf-8"))
    assert "patens" in vscode_data["servers"]
    assert vscode_data["servers"]["patens"]["type"] == "stdio"
    assert "--mcp" in vscode_data["servers"]["patens"]["args"]

    # Cursor should use 'mcpServers' schema key
    assert cursor_file.exists()
    cursor_data = json.loads(cursor_file.read_text(encoding="utf-8"))
    assert "patens" in cursor_data["mcpServers"]

    # JetBrains folder didn't exist -> should be cleanly skipped
    assert not jetbrains_file.exists()


def test_install_to_ides_updates_existing_json_with_comments_and_creates_backup(mock_ide_environment):
    """Tests modifying existing config containing comments, ensuring backup .bak file is created."""
    vscode_file = mock_ide_environment["VS Code"]
    initial_content = """
    {
        // Existing custom user server
        "servers": {
            "custom-server": {
                "command": "node",
                "args": ["server.js"]
            }
        }
    }
    """
    vscode_file.write_text(initial_content, encoding="utf-8")

    installer.install_to_ides(is_debug=False)

    # Verify backup was created
    backup_file = vscode_file.with_suffix(".json.bak")
    assert backup_file.exists()
    assert backup_file.read_text(encoding="utf-8") == initial_content

    # Verify updated JSON retains old server and includes patens
    data = json.loads(vscode_file.read_text(encoding="utf-8"))
    assert "custom-server" in data["servers"]
    assert "patens" in data["servers"]


def test_install_to_ides_source_vs_frozen_mode(mock_ide_environment, monkeypatch):
    """Tests execution command differences between PyInstaller EXE mode and raw Python Source mode."""
    # 1. Test Python Source mode (sys.frozen = False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(sys, "executable", "/usr/bin/python3")
    monkeypatch.setattr(sys, "argv", ["/app/main.py"])

    installer.install_to_ides(is_debug=True)

    vscode_data = json.loads(mock_ide_environment["VS Code"].read_text())
    patens_cfg = vscode_data["servers"]["patens"]

    assert patens_cfg["command"] == str(Path("/usr/bin/python3").absolute())
    assert patens_cfg["args"] == [str(Path("/app/main.py").absolute()), "--mcp", "--debug"]

    # 2. Test Compiled EXE mode (sys.frozen = True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", "/app/Patens.exe")

    installer.install_to_ides(is_debug=False)

    cursor_data = json.loads(mock_ide_environment["Cursor"].read_text())
    patens_exe_cfg = cursor_data["mcpServers"]["patens"]

    assert patens_exe_cfg["command"] == str(Path("/app/Patens.exe").absolute())
    assert patens_exe_cfg["args"] == ["--mcp"]


def test_install_to_ides_handles_malformed_json_gracefully(mock_ide_environment, capsys):
    """Tests that corrupt/invalid existing JSON files are skipped without crashing execution."""
    vscode_file = mock_ide_environment["VS Code"]
    vscode_file.write_text("{ corrupt json syntax ... ", encoding="utf-8")

    # Should skip VS Code but successfully process Cursor
    installer.install_to_ides()

    captured = capsys.readouterr().out
    assert "[Warning] Skipped [ VS Code ]" in captured
    assert mock_ide_environment["Cursor"].exists()


def test_install_to_ides_handles_invalid_root_key_type(mock_ide_environment, capsys):
    """Tests skipping an IDE if 'servers' key exists but is not a dictionary."""
    vscode_file = mock_ide_environment["VS Code"]
    vscode_file.write_text('{"servers": "not-a-dictionary"}', encoding="utf-8")

    installer.install_to_ides()

    captured = capsys.readouterr().out
    assert "exists but is not a standard dictionary" in captured


def test_install_to_ides_atomic_write_error_cleanup(mock_ide_environment, monkeypatch, capsys):
    """Tests that temporary files are cleaned up if an exception occurs during the atomic write phase."""
    vscode_file = mock_ide_environment["VS Code"]

    # Force failure during atomic replacement
    def mock_replace(src, dst):
        raise PermissionError("Access Denied")

    monkeypatch.setattr(os, "replace", mock_replace)

    installer.install_to_ides()

    captured = capsys.readouterr().out
    assert "[Error] Failed to write to [ VS Code ]" in captured

    # Verify temporary files were unlinked/cleaned up
    temp_files = list(vscode_file.parent.glob("tmp*"))
    assert len(temp_files) == 0