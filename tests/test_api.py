import sys
import os
import base64
import datetime
from pathlib import Path
import pytest
from unittest.mock import MagicMock, patch, ANY
from fastapi import status
from fastapi.testclient import TestClient

from patens.server import api
from patens.server.state import app_state


# =====================================================================
# FIXTURES
# =====================================================================

@pytest.fixture(autouse=True)
def reset_globals():
    """Resets in-memory activity logs and global connection state between tests."""
    api.recent_activity.clear()
    app_state.ide_connected = False
    yield
    api.recent_activity.clear()
    app_state.ide_connected = False


@pytest.fixture
def mock_db_manager():
    """Mocks DatabaseManager operations."""
    db = MagicMock()
    db.insert_snippet.return_value = 1
    db.delete_snippet.return_value = True
    db.get_latest.return_value = [
        {
            "id": 1,
            "url": "https://example.com",
            "title": "Example",
            "content": "Test snippet content",
            "created_at": "2026-08-09 10:00:00",
            "is_volatile": 0,
        }
    ]
    db.search_similar.return_value = [
        {
            "id": 1,
            "url": "https://example.com",
            "title": "Example Search",
            "content": "Matched query content",
            "created_at": "2026-08-09 10:00:00",
            "is_volatile": 0,
            "distance": 0.2,
        }
    ]
    return db


@pytest.fixture
def mock_embedder():
    """Mocks FastEmbed instance with numpy-like .tolist() behavior."""
    vector_mock = MagicMock()
    vector_mock.tolist.return_value = [0.1] * 384
    embedder = MagicMock()
    embedder.embed.return_value = [vector_mock]
    embedder.return_value = embedder  # Ensure calling the mock as a factory returns itself
    return embedder


@pytest.fixture
def mock_sync_trigger():
    """Mock callback for workspace file sync triggers."""
    return MagicMock()


@pytest.fixture
def client(mock_db_manager, mock_embedder, tmp_path, mock_sync_trigger):
    """Initializes FastAPI TestClient with mocked dependencies."""
    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path),
        on_sync_trigger=mock_sync_trigger,
    )
    return TestClient(app)


# =====================================================================
# 1. UNIT TESTS: UTILITY HELPERS
# =====================================================================

def test_save_base64_image_success(tmp_path):
    """Tests decoding and writing base64 image data to disk."""
    raw_bytes = b"fake-image-bytes"
    b64_string = f"data:image/png;base64,{base64.b64encode(raw_bytes).decode('utf-8')}"

    saved_path = api.save_base64_image(b64_string, tmp_path)

    assert Path(saved_path).exists()
    assert Path(saved_path).read_bytes() == raw_bytes


def test_save_base64_image_without_header_prefix(tmp_path):
    """Tests saving base64 string without data URI scheme header prefix."""
    raw_bytes = b"headerless-image-bytes"
    b64_string = base64.b64encode(raw_bytes).decode("utf-8")

    saved_path = api.save_base64_image(b64_string, tmp_path)

    assert Path(saved_path).exists()
    assert Path(saved_path).read_bytes() == raw_bytes


def test_save_base64_image_invalid_payload(tmp_path):
    """Tests HTTP 500 raising when invalid base64 string is provided."""
    with pytest.raises(api.HTTPException) as exc_info:
        api.save_base64_image("invalid_base64_$$$", tmp_path)
    assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


def test_save_base64_image_write_error(mocker, tmp_path):
    """Tests HTTP 500 when file write operation fails."""
    mocker.patch.object(Path, "write_bytes", side_effect=OSError("Disk write failure"))
    b64_string = f"data:image/png;base64,{base64.b64encode(b'bytes').decode('utf-8')}"

    with pytest.raises(api.HTTPException) as exc_info:
        api.save_base64_image(b64_string, tmp_path)
    assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


def test_get_template_html_dev_and_frozen(monkeypatch, tmp_path):
    """Tests HTML template loading in both dev and PyInstaller frozen modes."""
    # Dev Mode Test
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    dev_templates_dir = tmp_path / "templates"
    dev_templates_dir.mkdir(parents=True, exist_ok=True)
    (dev_templates_dir / "test.html").write_text("<h1>Hello World</h1>", encoding="utf-8")
    monkeypatch.setattr(api, "__file__", str(tmp_path / "api.py"))

    content = api.get_template_html("test.html")
    assert "<h1>Hello World</h1>" in content

    # PyInstaller Frozen Mode Test
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

    frozen_dir = tmp_path / "patens" / "server" / "templates"
    frozen_dir.mkdir(parents=True, exist_ok=True)
    (frozen_dir / "test_frozen.html").write_text("<h1>Frozen HTML</h1>", encoding="utf-8")

    assert "<h1>Frozen HTML</h1>" in api.get_template_html("test_frozen.html")


def test_get_template_html_missing_template():
    """Tests graceful fallback error string when HTML template is missing."""
    content = api.get_template_html("non_existent_file.html")
    assert "<h1>Error: Could not load non_existent_file.html</h1>" in content


def test_normalize_db_record():
    """Tests normalising SQLite row timestamps into UTC ISO format."""
    now = datetime.datetime.now(datetime.timezone.utc)
    raw_row = {"id": 1, "title": "Test", "created_at": "2026-08-09 12:00:00"}

    normalized = api.normalize_db_record(raw_row, now)
    assert normalized["timestamp"] == "2026-08-09T12:00:00+00:00"

    # Test fallback for missing timestamp
    missing_row = {"id": 2, "title": "No Date"}
    normalized_missing = api.normalize_db_record(missing_row, now)
    assert normalized_missing["timestamp"] == now.isoformat()


def test_normalize_db_record_non_dict_row_mapping():
    """Tests normalizing SQLite Row or custom mapping objects."""
    class CustomRow:
        def __init__(self, data):
            self._data = data

        def keys(self):
            return self._data.keys()

        def __getitem__(self, item):
            return self._data[item]

    now = datetime.datetime.now(datetime.timezone.utc)
    custom_row = CustomRow({"id": 10, "title": "Row Mapping", "timestamp": "2026-08-09 15:30:00"})

    normalized = api.normalize_db_record(custom_row, now)
    assert normalized["id"] == 10
    assert normalized["timestamp"] == "2026-08-09T15:30:00+00:00"


def test_normalize_db_record_corrupt_timestamp_fallback():
    """Tests fallback to reference time when timestamp parsing fails."""
    now = datetime.datetime.now(datetime.timezone.utc)
    corrupt_row = {"id": 15, "timestamp": "invalid-timestamp-format"}

    normalized = api.normalize_db_record(corrupt_row, now)
    assert normalized["timestamp"] == now.isoformat()


def test_normalize_db_record_timestamp_field_variations():
    """Tests handling timestamps with space, ISO format, and naive datetime timezone assignment."""
    now = datetime.datetime.now(datetime.timezone.utc)

    # Space separated naive timestamp
    row1 = {"id": 1, "created_at": "2026-08-09 10:00:00"}
    assert api.normalize_db_record(row1, now)["timestamp"] == "2026-08-09T10:00:00+00:00"

    # ISO format with Z
    row2 = {"id": 2, "timestamp": "2026-08-09T10:00:00Z"}
    assert api.normalize_db_record(row2, now)["timestamp"] == "2026-08-09T10:00:00+00:00"


# =====================================================================
# 2. ENDPOINT TESTS: UI & SECURITY
# =====================================================================

def test_ui_endpoints(client, mocker):
    """Tests UI route rendering."""
    mocker.patch("patens.server.api.get_template_html", return_value="<html>UI</html>")

    assert client.get("/settings").status_code == 200
    assert client.get("/welcome").status_code == 200
    assert client.get("/dashboard").status_code == 200


def test_get_image_valid_serving(client, tmp_path):
    """Tests serving an image that exists inside the allowed directory."""
    img_file = tmp_path / "image_123.png"
    img_file.write_bytes(b"png-data")

    response = client.get(f"/image?path={img_file}")
    assert response.status_code == 200
    assert response.content == b"png-data"


def test_get_image_path_traversal_blocked(client, tmp_path):
    """Tests security check blocking path traversal attempts outside image_dir."""
    forbidden_file = tmp_path.parent / "secret.txt"
    forbidden_file.write_text("secret")

    response = client.get(f"/image?path={forbidden_file}")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "Access denied" in response.json()["detail"]


def test_get_image_not_found(client, tmp_path):
    """Tests 404 response for non-existent image within allowed directory."""
    missing_file = tmp_path / "missing.png"
    response = client.get(f"/image?path={missing_file}")
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_get_image_directory_path_returns_404(client, tmp_path):
    """Tests that requesting a directory path returns HTTP 404."""
    sub_dir = tmp_path / "subdir"
    sub_dir.mkdir()

    response = client.get(f"/image?path={sub_dir}")
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_get_image_relative_to_value_error(client, mocker, tmp_path):
    """Tests handling ValueError during relative path calculation blocking access."""
    mocker.patch.object(Path, "is_relative_to", side_effect=ValueError("Path mismatch"))
    img_file = tmp_path / "image.png"
    img_file.write_bytes(b"data")

    response = client.get(f"/image?path={img_file}")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "Access denied" in response.json()["detail"]


# =====================================================================
# 3. ENDPOINT TESTS: API v1 (CONFIG & INGESTION)
# =====================================================================

def test_get_system_config(client):
    """Tests retrieving system configuration info."""
    res = client.get("/api/v1/config/system")
    assert res.status_code == 200
    assert res.json()["status"] == "running"


def test_get_and_save_hotkey_config(client, mocker):
    """Tests hotkey preference reading and updating."""
    mocker.patch("patens.server.config.update_hotkeys_config", return_value=True)

    get_res = client.get("/api/v1/config/hotkeys")
    assert get_res.status_code == 200

    post_res = client.post("/api/v1/config/hotkeys", json={
        "capture": {"ctrl": True, "shift": True},
        "palette": {"ctrl": True, "space": True}
    })
    assert post_res.status_code == 200
    assert post_res.json()["status"] == "success"


def test_save_hotkey_config_failure(client, mocker):
    """Tests HTTP 500 when updating hotkey configuration file fails."""
    mocker.patch("patens.server.config.update_hotkeys_config", return_value=False)

    post_res = client.post("/api/v1/config/hotkeys", json={
        "capture": {"ctrl": True},
        "palette": {"ctrl": True}
    })
    assert post_res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "Failed to save configuration" in post_res.json()["detail"]


def test_ingest_context_text_payload(client, mock_db_manager, mock_sync_trigger):
    """Tests ingesting text content and triggering workspace sync."""
    payload = {
        "type": "text",
        "url": "https://patens.dev",
        "title": "Patens Docs",
        "content": "Local memory for AI"
    }
    response = client.post("/api/v1/ingest", json=payload)

    assert response.status_code == 200
    assert response.json()["status"] == "success"
    mock_db_manager.insert_snippet.assert_called_once()
    mock_sync_trigger.assert_called_once()


def test_ingest_context_image_payload(client, mock_db_manager, tmp_path, mock_sync_trigger):
    """Tests ingesting image payload with base64 media string."""
    raw_bytes = b"test-image"
    b64_img = f"data:image/png;base64,{base64.b64encode(raw_bytes).decode('utf-8')}"

    payload = {
        "type": "image",
        "url": "https://example.com/page",
        "title": "Screenshot",
        "content": "Image description",
        "media": b64_img
    }
    response = client.post("/api/v1/ingest", json=payload)

    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify that 'Local Image Path' was appended to the snippet content stored in DB
    mock_db_manager.insert_snippet.assert_called_once()
    inserted_content = mock_db_manager.insert_snippet.call_args.kwargs["content"]
    assert "Local Image Path" in inserted_content
    mock_sync_trigger.assert_called_once()


def test_ingest_context_lazy_embedder_factory(mock_db_manager, mock_embedder, tmp_path, mock_sync_trigger):
    """Tests resolving embedder when passed as a lazy callable factory."""
    lazy_factory = MagicMock(return_value=mock_embedder)

    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=lazy_factory,
        image_dir=str(tmp_path),
        on_sync_trigger=mock_sync_trigger
    )
    test_client = TestClient(app)

    res = test_client.post("/api/v1/ingest", json={
        "type": "text",
        "url": "https://example.com",
        "title": "Title",
        "content": "Content"
    })
    assert res.status_code == 200
    lazy_factory.assert_called_once()


def test_ingest_context_unexpected_exception(client, mock_db_manager):
    """Tests HTTP 500 response when database insertion fails unexpectedly."""
    mock_db_manager.insert_snippet.side_effect = Exception("Database connection lost")

    payload = {
        "type": "text",
        "url": "https://example.com",
        "title": "Title",
        "content": "Content"
    }
    response = client.post("/api/v1/ingest", json=payload)
    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "Failed to ingest context" in response.json()["detail"]


def test_ingest_context_http_exception_pass_through(client, mocker):
    """Tests that HTTPExceptions raised during ingestion process pass through without double wrapping."""
    mocker.patch("patens.server.api.save_base64_image", side_effect=api.HTTPException(status_code=400, detail="Invalid image"))

    payload = {
        "type": "image",
        "url": "https://example.com",
        "title": "Title",
        "content": "Content",
        "media": "data:image/png;base64,invalid"
    }
    response = client.post("/api/v1/ingest", json=payload)
    assert response.status_code == 400
    assert "Invalid image" in response.json()["detail"]


# =====================================================================
# 4. ENDPOINT TESTS: DELETE & SEARCH
# =====================================================================

def test_delete_context_single_and_multiple_ids(client, mock_db_manager, mock_sync_trigger):
    """Tests snippet deletion by single/multiple IDs and workspace sync trigger."""
    # Delete empty string
    res_empty = client.delete("/api/v1/delete?ids=")
    assert res_empty.json()["deleted"] == 0

    # Delete multiple IDs
    res = client.delete("/api/v1/delete?ids=1,2,3")
    assert res.status_code == 200
    assert res.json()["deleted"] == 3
    assert mock_db_manager.delete_snippet.call_count == 3
    mock_sync_trigger.assert_called_once()


def test_delete_context_non_digit_string_id(client, mock_db_manager):
    """Tests deletion when passing non-digit UUID string IDs."""
    res = client.delete("/api/v1/delete?ids=uuid-1234-abcd")
    assert res.status_code == 200
    assert res.json()["deleted"] == 1
    mock_db_manager.delete_snippet.assert_called_once_with("uuid-1234-abcd")


def test_delete_context_handles_db_exception(client, mock_db_manager):
    """Tests handling deletion exceptions gracefully for individual snippet IDs."""
    mock_db_manager.delete_snippet.side_effect = [Exception("DB error"), True]

    res = client.delete("/api/v1/delete?ids=1,2")
    assert res.status_code == 200
    assert res.json()["deleted"] == 1


def test_delete_context_zero_deleted_skips_sync_trigger(client, mock_db_manager, mock_sync_trigger):
    """Tests that workspace sync is not triggered if no snippets were actually deleted."""
    mock_db_manager.delete_snippet.return_value = False

    res = client.delete("/api/v1/delete?ids=99")
    assert res.status_code == 200
    assert res.json()["deleted"] == 0
    mock_sync_trigger.assert_not_called()


def test_search_context_non_vector_recent(client, mock_db_manager):
    """Tests empty search query fetching latest non-vector entries."""
    res = client.get("/api/v1/search?q=")
    assert res.status_code == 200
    assert len(res.json()["results"]) > 0
    mock_db_manager.get_latest.assert_called_once()


def test_search_context_vector_semantic_search(client, mock_db_manager, mock_embedder):
    """Tests vector similarity search execution and hybrid score sorting."""
    res = client.get("/api/v1/search?q=FastAPI&time_filter=2h")

    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 1
    assert "hybrid_score" in results[0]
    mock_embedder.embed.assert_called_once_with(["FastAPI"])
    mock_db_manager.search_similar.assert_called_once()


@pytest.mark.parametrize("time_filter", ["2h", "today", "yesterday", "all"])
def test_search_context_time_filters(client, time_filter):
    """Tests various time boundary filter translations."""
    res = client.get(f"/api/v1/search?q=query&time_filter={time_filter}&tz_offset=0")
    assert res.status_code == 200


def test_search_context_unrecognized_time_filter(client, mock_db_manager):
    """Tests search with an unrecognized time_filter value defaulting to all time."""
    res = client.get("/api/v1/search?q=test&time_filter=unknown_filter")
    assert res.status_code == 200
    mock_db_manager.search_similar.assert_called_once()


def test_search_context_with_url_filter(client, mock_db_manager):
    """Tests search with url_filter parameter."""
    res = client.get("/api/v1/search?q=&url_filter=example.com")
    assert res.status_code == 200
    mock_db_manager.get_latest.assert_called_once_with(
        limit=ANY,
        offset=0,
        start_time=None,
        end_time=None,
        url_filter="example.com"
    )


def test_search_context_pagination_offset_limit(client, mock_db_manager):
    """Tests offset and limit pagination slicing on search results."""
    rows = [
        {
            "id": i,
            "url": "https://example.com",
            "title": f"Title {i}",
            "content": f"Content {i}",
            "created_at": "2026-08-09 10:00:00",
            "distance": 0.1 * i
        } for i in range(1, 6)
    ]
    mock_db_manager.get_latest.return_value = rows

    res = client.get("/api/v1/search?q=&limit=2&offset=1")
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 2


def test_search_context_db_exception_raises_500(client, mock_db_manager):
    """Tests HTTP 500 when database search raises an error."""
    mock_db_manager.get_latest.side_effect = Exception("Search failed")

    res = client.get("/api/v1/search?q=")
    assert res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "Internal server error during search" in res.json()["detail"]


def test_get_latest_context(client, mock_db_manager):
    """Tests fetching latest entries via /latest endpoint."""
    res = client.get("/api/v1/latest?limit=1")
    assert res.status_code == 200
    assert len(res.json()["results"]) == 1


def test_latest_context_db_exception_raises_500(client, mock_db_manager):
    """Tests HTTP 500 when fetching latest entries fails."""
    mock_db_manager.get_latest.side_effect = Exception("DB query failed")

    res = client.get("/api/v1/latest")
    assert res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "Failed to fetch latest context" in res.json()["detail"]


# =====================================================================
# 5. ENDPOINT TESTS: INTERNAL IPC & SHUTDOWN
# =====================================================================

def test_mcp_status_and_ide_connected(client):
    """Tests query and update of internal IDE connection state."""
    assert client.get("/api/internal/mcp-status").json()["connected"] is False

    assert client.post("/api/internal/ide-connected").json()["status"] == "ok"
    assert client.get("/api/internal/mcp-status").json()["connected"] is True


def test_record_activity(client):
    """Tests recording internal IDE activity and updating connection state."""
    payload = {"tool": "query_browser_context", "query": "FastAPI"}
    res = client.post("/api/internal/activity", json=payload)

    assert res.status_code == 200
    assert app_state.ide_connected is True

    data_res = client.get("/api/internal/activity-data")
    assert len(data_res.json()["activities"]) == 1
    assert data_res.json()["activities"][0]["tool"] == "query_browser_context"


def test_shutdown_server(client, mocker):
    """Tests process shutdown trigger execution without killing test process."""
    mocker.patch("time.sleep")
    mocker.patch("os._exit")
    mocker.patch("subprocess.run")

    res = client.post("/api/internal/shutdown", json={"force_global": True})
    assert res.status_code == 200
    assert "Server instances destroyed" in res.json()["message"]


def test_shutdown_server_non_global(client, mocker):
    """Tests server shutdown with force_global=False skipping process kill commands."""
    mocker.patch("time.sleep")
    mock_subprocess = mocker.patch("subprocess.run")
    mocker.patch("os._exit")

    res = client.post("/api/internal/shutdown", json={"force_global": False})
    assert res.status_code == 200
    mock_subprocess.assert_not_called()


def test_shutdown_server_posix_platform_kill(client, mocker):
    """Tests global process termination command on non-Windows platforms."""
    mocker.patch("time.sleep")
    mocker.patch("platform.system", return_value="Linux")
    mock_subprocess = mocker.patch("subprocess.run")
    mocker.patch("os._exit")

    res = client.post("/api/internal/shutdown", json={"force_global": True})
    assert res.status_code == 200
    mock_subprocess.assert_called_once_with(["pkill", "-f", "Patens"], capture_output=True)


def test_shutdown_server_subprocess_failure_logged(client, mocker):
    """Tests graceful exception logging when process kill command fails during shutdown."""
    mocker.patch("time.sleep")
    mocker.patch("platform.system", return_value="Windows")
    mocker.patch("subprocess.run", side_effect=Exception("Taskkill failed"))
    mock_logger = mocker.patch("patens.server.api.logger")
    mocker.patch("os._exit")

    res = client.post("/api/internal/shutdown", json={"force_global": True})
    assert res.status_code == 200
    mock_logger.error.assert_called_once()


# =====================================================================
# 6. LIFESPAN TESTS
# =====================================================================

def test_lifespan_first_run_opens_welcome_page(mock_db_manager, mock_embedder, tmp_path, mocker):
    """Tests that first run (empty database) triggers browser auto-open."""
    mock_db_manager.get_latest.return_value = []  # Empty DB
    mock_browser = mocker.patch("webbrowser.open")
    mocker.patch("time.sleep")  # Eliminate the 1.5s delay inside delayed_open

    # Run the thread target synchronously for deterministic execution
    def run_thread_inline(target, daemon=None):
        mock_thread = MagicMock()
        mock_thread.start.side_effect = target
        return mock_thread

    mocker.patch("threading.Thread", side_effect=run_thread_inline)

    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path)
    )

    with TestClient(app):
        pass  # Enters and exits lifespan context

    mock_browser.assert_called_once()


def test_lifespan_non_empty_db_skips_welcome_page(mock_db_manager, mock_embedder, tmp_path, mocker):
    """Tests that welcome page is not opened when database contains entries on startup."""
    mock_db_manager.get_latest.return_value = [{"id": 1}]
    mock_browser = mocker.patch("webbrowser.open")

    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path)
    )

    with TestClient(app):
        pass

    mock_browser.assert_not_called()


def test_lifespan_db_error_handled_gracefully(mock_db_manager, mock_embedder, tmp_path, mocker):
    """Tests that startup continues cleanly when checking DB status in lifespan fails."""
    mock_db_manager.get_latest.side_effect = Exception("DB error during startup")
    mock_logger = mocker.patch("patens.server.api.logger")

    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path)
    )

    with TestClient(app):
        pass

    mock_logger.error.assert_called_once()