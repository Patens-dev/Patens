import sys
import json
import time
import urllib.error
from pathlib import Path
import pytest
from unittest.mock import MagicMock, patch, call, ANY

from patens.server import unified_server
from patens.server.state import app_state


# Exception used to break out of infinite daemon loop during unit testing
class StopDaemonLoop(Exception):
    pass


# =====================================================================
# FIXTURES
# =====================================================================

@pytest.fixture(autouse=True)
def reset_server_state(tmp_path, monkeypatch):
    """Resets all global singletons, events, locks, and app_state before each test."""
    unified_server._embedder_instance = None
    unified_server._sync_thread_started = False
    unified_server.workspace_sync_event.clear()
    app_state.ide_connected = False

    # Point default context directory to a safe temporary path
    safe_workspace = tmp_path / "safe_mock_project"
    safe_workspace.mkdir(parents=True, exist_ok=True)
    unified_server.set_context_dir(safe_workspace / "_context")

    yield

    unified_server._embedder_instance = None
    unified_server._sync_thread_started = False
    unified_server.workspace_sync_event.clear()
    app_state.ide_connected = False


@pytest.fixture
def mock_embedder():
    """Provides a mocked TextEmbedding instance that returns fixed dummy vectors."""
    mock_vec = MagicMock()
    mock_vec.tolist.return_value = [0.1] * 384
    mock_inst = MagicMock()
    mock_inst.embed.return_value = [mock_vec]
    return mock_inst

# =====================================================================
# 1. UNIT TESTS: EMBEDDER & CACHE RESOLUTION
# =====================================================================

def test_resolve_model_cache_dir_frozen(monkeypatch, tmp_path):
    """Tests model cache directory resolution in PyInstaller frozen EXE mode."""
    bundle_dir = tmp_path / "meipass_bundle"
    cache_dir = bundle_dir / "fastembed_cache"
    cache_dir.mkdir(parents=True)

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(bundle_dir), raising=False)

    resolved = unified_server.resolve_model_cache_dir()
    assert resolved == cache_dir


def test_resolve_model_cache_dir_dev_environment(monkeypatch, tmp_path):
    """Tests model cache directory resolution in local Python development mode."""
    dev_cache = tmp_path / "fastembed_cache"
    dev_cache.mkdir(parents=True)

    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(Path, "cwd", lambda: tmp_path)

    resolved = unified_server.resolve_model_cache_dir()
    assert resolved == dev_cache


def test_resolve_model_cache_dir_not_found(monkeypatch, tmp_path):
    """Tests that resolve_model_cache_dir returns None if cache directory does not exist."""
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(Path, "cwd", lambda: tmp_path)

    assert unified_server.resolve_model_cache_dir() is None


def test_get_embedder_singleton(mocker, mock_embedder):
    """Tests that get_embedder initializes FastEmbed once and returns the singleton."""
    mock_tf_cls = mocker.patch("patens.server.unified_server.TextEmbedding", return_value=mock_embedder)
    mocker.patch("patens.server.unified_server.resolve_model_cache_dir", return_value=None)

    embedder1 = unified_server.get_embedder()
    embedder2 = unified_server.get_embedder()

    assert embedder1 is mock_embedder
    assert embedder2 is mock_embedder
    assert mock_tf_cls.call_count == 1


def test_get_embedder_offline_cache_fallback_on_error(mocker, mock_embedder, tmp_path):
    """Tests fallback to online load when local cache initialization fails."""
    mocker.patch("patens.server.unified_server.resolve_model_cache_dir", return_value=tmp_path)

    # First call with local_files_only fails, second call succeeds
    mock_tf_cls = mocker.patch(
        "patens.server.unified_server.TextEmbedding",
        side_effect=[RuntimeError("Corrupt local cache"), mock_embedder]
    )

    embedder = unified_server.get_embedder()

    assert embedder is mock_embedder
    assert mock_tf_cls.call_count == 2
    mock_tf_cls.assert_has_calls([
        call(model_name=unified_server.MODEL_NAME, cache_dir=str(tmp_path), local_files_only=True),
        call(model_name=unified_server.MODEL_NAME)
    ])


# =====================================================================
# 2. UNIT TESTS: WORKSPACE VALIDATION & CONTEXT DIR THREAD-SAFETY
# =====================================================================

def test_get_and_set_context_dir(tmp_path):
    """Tests thread-safe getting and setting of active context directory."""
    new_dir = tmp_path / "new_workspace" / "_context"
    unified_server.set_context_dir(new_dir)
    assert unified_server.get_context_dir() == new_dir


def test_is_valid_workspace_rejections(tmp_path):
    """Tests path safety safeguards blocking Home, System, Root, AppData, or EXE directories."""
    home_dir = Path.home()
    root_dir = Path(home_dir.anchor)
    exe_dir = Path(sys.executable).parent.resolve()

    assert not unified_server.is_valid_workspace(home_dir)
    assert not unified_server.is_valid_workspace(root_dir)
    assert not unified_server.is_valid_workspace(exe_dir)

    # Test system directories (Windows / Linux)
    mock_system32 = tmp_path / "System32"
    mock_system32.mkdir()
    assert not unified_server.is_valid_workspace(mock_system32)

    # Test non-temp AppData directory rejection
    mock_appdata = tmp_path / "AppData" / "Roaming"
    mock_appdata.mkdir(parents=True)
    assert not unified_server.is_valid_workspace(mock_appdata)

def test_is_valid_workspace_success(tmp_path):
    """Tests that a normal project directory passes workspace validation."""
    valid_project = tmp_path / "my_cool_project"
    valid_project.mkdir()
    assert unified_server.is_valid_workspace(valid_project)


# =====================================================================
# 3. INTEGRATION TESTS: WORKSPACE SYNC DAEMON & FILE MIRRORING
# =====================================================================

def test_sync_workspace_files_loop_creates_md_files_and_index(tmp_path, mocker):
    """Tests that background sync creates .gitignore, master index, and markdown files from DB."""
    project_dir = tmp_path / "active_project"
    project_dir.mkdir()
    context_dir = project_dir / "_context"
    unified_server.set_context_dir(context_dir)

    mocker.patch("patens.server.unified_server.is_valid_workspace", return_value=True)

    mock_snippets = [
        {
            "id": 101,
            "url": "https://github.com/Patens-dev/Patens",
            "title": "Patens Repository",
            "content": "Patens is a local memory layer for AI.",
            "created_at": "2026-08-09 10:00:00"
        }
    ]
    mocker.patch.object(unified_server.db_manager, "get_recent_snippets", return_value=mock_snippets)

    # Force daemon loop to run exactly 1 iteration and break
    mocker.patch.object(unified_server.workspace_sync_event, "wait", side_effect=StopDaemonLoop)

    with pytest.raises(StopDaemonLoop):
        unified_server.sync_workspace_files_loop()

    assert context_dir.exists()
    assert (context_dir / ".gitignore").read_text(encoding="utf-8") == "*\n"

    # Verify Master Index creation
    index_file = context_dir / "00_Context_Index.md"
    assert index_file.exists()
    assert "Patens Master Index" in index_file.read_text(encoding="utf-8")

    # Verify Markdown snippet file creation
    synced_md_files = [f for f in context_dir.glob("*.md") if f.name != "00_Context_Index.md"]
    assert len(synced_md_files) == 1
    assert "Patens_Repository" in synced_md_files[0].name
    assert "Patens is a local memory layer for AI." in synced_md_files[0].read_text(encoding="utf-8")


def test_sync_workspace_files_loop_prunes_deleted_stale_files(tmp_path, mocker):
    """Tests that files deleted from DB are unlinked from the local _context directory."""
    project_dir = tmp_path / "active_project"
    project_dir.mkdir()
    context_dir = project_dir / "_context"
    context_dir.mkdir()

    # Pre-create a stale markdown file on disk
    stale_file = context_dir / "Deleted_Snippet_25t.md"
    stale_file.write_text("Old content to be pruned", encoding="utf-8")

    unified_server.set_context_dir(context_dir)

    mocker.patch("patens.server.unified_server.is_valid_workspace", return_value=True)
    mocker.patch.object(unified_server.db_manager, "get_recent_snippets", return_value=[])

    mocker.patch.object(unified_server.workspace_sync_event, "wait", side_effect=StopDaemonLoop)

    with pytest.raises(StopDaemonLoop):
        unified_server.sync_workspace_files_loop()

    # Verify stale file was unlinked
    assert not stale_file.exists()


# =====================================================================
# 4. UNIT TESTS: FASTMCP TOOLS
# =====================================================================

def test_mcp_tool_query_browser_context(mocker, mock_embedder):
    """Tests FastMCP query_browser_context tool searching database and returning formatted text."""
    mocker.patch("patens.server.unified_server.get_embedder", return_value=mock_embedder)

    mock_results = [
        {
            "id": 1,
            "title": "FastAPI Docs",
            "url": "https://fastapi.tiangolo.com",
            "content": "FastAPI is a modern web framework."
        }
    ]
    mocker.patch.object(unified_server.db_manager, "search_similar", return_value=mock_results)

    result_text = unified_server.query_browser_context("FastAPI", limit=1)

    assert "Found relevant web context" in result_text
    assert "FastAPI Docs" in result_text
    assert "https://fastapi.tiangolo.com" in result_text
    assert app_state.ide_connected is True


def test_mcp_tool_forget_memory(mocker):
    """Tests FastMCP forget_memory tool deleting a snippet and triggering workspace sync."""
    mocker.patch.object(unified_server.db_manager, "delete_snippet", return_value=True)
    mock_trigger = mocker.patch("patens.server.unified_server.trigger_workspace_sync")

    res = unified_server.forget_memory(42)

    assert "Successfully deleted memory ID 42." in res
    unified_server.db_manager.delete_snippet.assert_called_once_with(42)
    mock_trigger.assert_called_once()


def test_mcp_tool_memorize_ide_insight(mocker, mock_embedder):
    """Tests FastMCP memorize_ide_insight tool embedding insight and writing to DB."""
    mocker.patch("patens.server.unified_server.get_embedder", return_value=mock_embedder)
    mocker.patch.object(unified_server.db_manager, "insert_snippet", return_value=99)
    mock_trigger = mocker.patch("patens.server.unified_server.trigger_workspace_sync")

    res = unified_server.memorize_ide_insight("Architecture Decision", "Use FastEmbed for vector search")

    assert "Success! The insight 'Architecture Decision' has been permanently saved." in res
    unified_server.db_manager.insert_snippet.assert_called_once_with(
        url=ANY,
        title="Architecture Decision",
        content="Use FastEmbed for vector search",
        embedding=[0.1] * 384
    )
    mock_trigger.assert_called_once()


def test_mcp_tool_mount_workspace_context_resolves_git_root(tmp_path, mocker):
    """Tests mounting workspace context traversing upward to find .git repository root."""
    git_root = tmp_path / "my_git_repo"
    git_root.mkdir()
    (git_root / ".git").mkdir()

    subfolder = git_root / "src" / "subpackage"
    subfolder.mkdir(parents=True)

    mocker.patch("patens.server.unified_server.is_valid_workspace", return_value=True)
    mock_trigger = mocker.patch("patens.server.unified_server.trigger_workspace_sync")

    res = unified_server.mount_workspace_context(str(subfolder))

    expected_context_dir = git_root / "_context"
    assert str(expected_context_dir) in res
    assert unified_server.get_context_dir() == expected_context_dir
    mock_trigger.assert_called_once()


def test_mcp_tool_mount_workspace_context_resolves_manifest_root(tmp_path, mocker):
    """Tests mounting workspace traversing upward to find package.json manifest root when .git is absent."""
    manifest_root = tmp_path / "node_project"
    manifest_root.mkdir()
    (manifest_root / "package.json").write_text("{}", encoding="utf-8")

    subfolder = manifest_root / "src" / "components"
    subfolder.mkdir(parents=True)

    mocker.patch("patens.server.unified_server.is_valid_workspace", return_value=True)

    res = unified_server.mount_workspace_context(str(subfolder))

    expected_context_dir = manifest_root / "_context"
    assert str(expected_context_dir) in res
    assert unified_server.get_context_dir() == expected_context_dir


def test_mcp_tool_mount_workspace_context_invalid_path():
    """Tests error response when passing a non-existent path to mount_workspace_context."""
    res = unified_server.mount_workspace_context("/non/existent/path/xyz")
    assert "Failed: Could not verify" in res


# =====================================================================
# 5. UNIT TESTS: TELEMETRY & SERVICE RUNNERS
# =====================================================================

def test_notify_ide_activity(mocker):
    """Tests that notify_ide_activity sets ide_connected=True and fires HTTP activity ping."""
    mock_urlopen = mocker.patch("urllib.request.urlopen")

    unified_server.notify_ide_activity(event="test_event", custom_key="value")

    # Give daemon thread time to execute urllib ping
    time.sleep(0.1)

    assert app_state.ide_connected is True
    mock_urlopen.assert_called_once()


def test_start_sync_daemon(mocker):
    """Tests that start_sync_daemon starts background sync thread once."""
    mock_thread_cls = mocker.patch("threading.Thread")
    mock_thread_inst = MagicMock()
    mock_thread_cls.return_value = mock_thread_inst

    unified_server.start_sync_daemon()
    unified_server.start_sync_daemon()  # Second call should be ignored

    mock_thread_cls.assert_called_once_with(target=unified_server.sync_workspace_files_loop, daemon=True)
    mock_thread_inst.start.assert_called_once()


def test_run_mcp(mocker):
    """Tests stdio MCP runner startup."""
    mocker.patch("patens.server.unified_server.start_sync_daemon")
    mocker.patch.object(unified_server.mcp, "run")

    unified_server.run_mcp()

    unified_server.start_sync_daemon.assert_called_once()
    unified_server.mcp.run.assert_called_once()


def test_run_fastapi(mocker):
    """Tests Uvicorn FastAPI runner startup."""
    mocker.patch("patens.server.unified_server.start_sync_daemon")
    mock_uvicorn = mocker.patch("uvicorn.run")

    unified_server.run_fastapi()

    unified_server.start_sync_daemon.assert_called_once()
    mock_uvicorn.assert_called_once_with(
        unified_server.fastapi_app,
        host=unified_server.API_HOST,
        port=unified_server.API_PORT,
        log_level="error",
        access_log=False
    )