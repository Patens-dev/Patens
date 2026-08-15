# tests/test_api.py
import base64
import datetime
from pathlib import Path
from unittest.mock import MagicMock, ANY
import pytest
from fastapi import status
from starlette.testclient import TestClient

from patens.server import api, config
from patens.server.state import app_state


# =====================================================================
# Fixtures
# =====================================================================

@pytest.fixture
def mock_db_manager():
    db = MagicMock()
    # Default return payloads for search and latest endpoints
    db.get_latest.return_value = [
        {
            "id": 1,
            "url": "https://example.com",
            "title": "Test Title",
            "content": "Test content",
            "created_at": "2026-08-09 12:00:00",
        }
    ]
    db.search_similar.return_value = [
        {
            "id": 1,
            "url": "https://example.com",
            "title": "Test Title",
            "content": "Test content",
            "created_at": "2026-08-09 12:00:00",
        }
    ]
    # SQLite lastrowid is an integer
    db.insert_snippet.return_value = 123
    db.delete_snippet.return_value = True
    return db


@pytest.fixture
def mock_embedder():
    embedder = MagicMock()
    embedder.embed.return_value = [[0.1, 0.2, 0.3]]
    return embedder


@pytest.fixture
def mock_sync_trigger():
    return MagicMock()


@pytest.fixture
def client(mock_db_manager, mock_embedder, mock_sync_trigger, tmp_path):
    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path),
        on_sync_trigger=mock_sync_trigger,
    )
    with TestClient(app) as test_client:
        # Reset mocks so lifespan startup queries don't pollute assertion counts
        mock_db_manager.reset_mock()
        mock_embedder.reset_mock()
        mock_sync_trigger.reset_mock()
        yield test_client


# =====================================================================
# Helper & Normalization Unit Tests
# =====================================================================

def test_get_template_html_missing_template():
    """Tests graceful fallback error string when HTML template is missing."""
    content = api.get_template_html("non_existent_file.html")
    assert "<h1>Error: Could not load non_existent_file.html</h1>" in content


def test_get_template_html_existing(mocker):
    """Tests loading existing HTML template content."""
    mocker.patch.object(Path, "read_text", return_value="<html><body>Dashboard</body></html>")
    content = api.get_template_html("dashboard.html")
    assert "<html><body>Dashboard</body></html>" in content


def test_normalize_db_record():
    """Tests normalising SQLite row timestamps into UTC ISO format."""
    now = datetime.datetime.now(datetime.timezone.utc)
    raw_row = {"id": 1, "title": "Test", "created_at": "2026-08-09 12:00:00"}

    normalized = api.normalize_db_record(raw_row, now)
    assert normalized["timestamp"] == "2026-08-09T12:00:00+00:00"
    assert normalized["created_at"] == "2026-08-09T12:00:00+00:00"


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

    row1 = {"id": 1, "created_at": "2026-08-09 10:00:00"}
    assert api.normalize_db_record(row1, now)["timestamp"] == "2026-08-09T10:00:00+00:00"

    row2 = {"id": 2, "timestamp": "2026-08-09T10:00:00Z"}
    assert api.normalize_db_record(row2, now)["timestamp"] == "2026-08-09T10:00:00+00:00"

    row3 = {"id": 3}
    assert api.normalize_db_record(row3, now)["timestamp"] == now.isoformat()


def test_save_base64_image_success(tmp_path):
    """Tests saving valid base64 image data to target image directory."""
    raw_bytes = b"fake-png-binary-stream"
    b64_data = f"data:image/png;base64,{base64.b64encode(raw_bytes).decode('utf-8')}"

    filepath = api.save_base64_image(b64_data, tmp_path)
    assert Path(filepath).exists()
    assert Path(filepath).read_bytes() == raw_bytes


def test_save_base64_image_invalid(tmp_path, mocker):
    """Tests exception handling and HTTPException 500 when base64 writing fails."""
    mocker.patch.object(Path, "write_bytes", side_effect=IOError("Disk write failed"))
    with pytest.raises(api.HTTPException) as exc_info:
        api.save_base64_image("data:image/png;base64,YWJj", tmp_path)
    assert exc_info.value.status_code == 500


# =====================================================================
# Static & Image Serving Tests
# =====================================================================

def test_get_image_valid_serving(client, tmp_path):
    """Tests serving an image that exists inside the allowed directory."""
    img_file = tmp_path / "image_123.png"
    img_file.write_bytes(b"png-data")

    response = client.get(f"/image?path={img_file}")
    assert response.status_code == 200
    assert response.content == b"png-data"


def test_get_image_not_found(client, tmp_path):
    """Tests 404 status when requested image does not exist."""
    missing_file = tmp_path / "missing.png"
    response = client.get(f"/image?path={missing_file}")
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_get_image_path_traversal_blocked(client, tmp_path):
    """Tests security check blocking path traversal attempts outside image_dir."""
    forbidden_file = tmp_path.parent / "secret.txt"
    forbidden_file.write_text("secret")

    response = client.get(f"/image?path={forbidden_file}")
    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_get_image_relative_to_value_error(client, mocker, tmp_path):
    """Tests handling ValueError during relative path calculation blocking access."""
    mocker.patch.object(Path, "is_relative_to", side_effect=ValueError("Path mismatch"))
    img_file = tmp_path / "image.png"
    img_file.write_bytes(b"data")

    response = client.get(f"/image?path={img_file}")
    assert response.status_code == status.HTTP_403_FORBIDDEN


# =====================================================================
# UI Template Routes
# =====================================================================

def test_ui_templates_serve_html(client, mocker):
    """Tests GET /settings, /welcome, and /dashboard render HTML response."""
    mocker.patch("patens.server.api.get_template_html", return_value="<div>Rendered Template</div>")

    for route in ["/settings", "/welcome", "/dashboard"]:
        res = client.get(route)
        assert res.status_code == 200
        assert "<div>Rendered Template</div>" in res.text


# =====================================================================
# Config & Ingest Endpoints
# =====================================================================

def test_get_system_config(client):
    """Tests GET /api/v1/config/system returns running status and metadata."""
    res = client.get("/api/v1/config/system")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "running"
    assert "pid" in data
    assert "python_path" in data


def test_hotkey_configuration_flow(client, mocker):
    """Tests GET and POST /api/v1/config/hotkeys."""
    mocker.patch.object(config, "update_hotkeys_config", return_value=True)

    get_res = client.get("/api/v1/config/hotkeys")
    assert get_res.status_code == 200

    post_res = client.post(
        "/api/v1/config/hotkeys",
        json={
            "capture": {"ctrl": True, "shift": True, "key": "c"},
            "palette": {"ctrl": True, "shift": True, "key": "k"},
        },
    )
    assert post_res.status_code == 200
    assert post_res.json()["status"] == "success"


def test_hotkey_config_save_failure_raises_500(client, mocker):
    """Tests POST /api/v1/config/hotkeys raises 500 when saving fails."""
    mocker.patch.object(config, "update_hotkeys_config", return_value=False)
    res = client.post("/api/v1/config/hotkeys", json={"capture": {}, "palette": {}})
    assert res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


def test_ingest_context_text(client, mock_db_manager, mock_sync_trigger):
    """Tests standard text payload ingestion and smart clipboard generation."""
    payload = {
        "type": "text",
        "url": "https://patens.dev",
        "title": "Patens Architecture",
        "content": "Deep context capture layer for AI tools.",
    }
    res = client.post("/api/v1/ingest", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["id"] == 123
    assert "smart_clipboard" in data
    mock_db_manager.insert_snippet.assert_called_once()
    mock_sync_trigger.assert_called_once()


def test_ingest_context_image_payload(client, mock_db_manager, mocker):
    """Tests image context ingestion with base64 decoding."""
    mocker.patch("patens.server.api.save_base64_image", return_value="/tmp/image.png")
    payload = {
        "type": "image",
        "url": "https://example.com/diagram",
        "title": "System Architecture Diagram",
        "content": "Architecture flowchart",
        "media": "data:image/png;base64,YWJj",
    }
    res = client.post("/api/v1/ingest", json=payload)
    assert res.status_code == 200
    assert mock_db_manager.insert_snippet.called


def test_ingest_context_http_exception_pass_through(client, mocker):
    """Tests that HTTPExceptions raised during ingestion process pass through without double wrapping."""
    mocker.patch(
        "patens.server.api.save_base64_image",
        side_effect=api.HTTPException(status_code=400, detail="Invalid image"),
    )

    payload = {
        "type": "image",
        "url": "https://example.com",
        "title": "Title",
        "content": "Content",
        "media": "data:image/png;base64,invalid",
    }
    response = client.post("/api/v1/ingest", json=payload)
    assert response.status_code == 400


# =====================================================================
# Deletion Endpoints
# =====================================================================

def test_delete_context_single_and_multiple_ids(client, mock_db_manager, mock_sync_trigger):
    """Tests snippet deletion by single/multiple IDs and workspace sync trigger."""
    res_empty = client.delete("/api/v1/delete?ids=")
    assert res_empty.json()["deleted"] == 0

    res = client.delete("/api/v1/delete?ids=1,2,3")
    assert res.status_code == 200
    assert res.json()["deleted"] == 3
    assert mock_db_manager.delete_snippet.call_count == 3
    mock_sync_trigger.assert_called()


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


def test_delete_context_json_body_variations(client, mock_db_manager):
    """Tests deletion via POST/DELETE with JSON body (list and dict schemas)."""
    res1 = client.post("/api/v1/delete", json=["10", "11"])
    assert res1.status_code == 200
    assert res1.json()["deleted"] == 2

    res2 = client.post("/api/v1/delete", json={"ids": ["20", "21"]})
    assert res2.status_code == 200
    assert res2.json()["deleted"] == 2

    res3 = client.post("/api/v1/delete", json={"ids": "30,31"})
    assert res3.status_code == 200
    assert res3.json()["deleted"] == 2


# =====================================================================
# Search & Latest Endpoints
# =====================================================================

def test_search_context_non_vector_recent(client, mock_db_manager):
    """Tests empty search query fetching latest non-vector entries."""
    res = client.get("/api/v1/search?q=")
    assert res.status_code == 200
    assert len(res.json()["results"]) > 0


def test_search_context_vector_semantic_search(client, mock_db_manager, mock_embedder):
    """Tests vector similarity search execution and hybrid score sorting."""
    res = client.get("/api/v1/search?q=FastAPI&time_filter=2h")
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 1


@pytest.mark.parametrize("time_filter", ["today", "yesterday", "all"])
def test_search_context_time_filters(client, mock_db_manager, time_filter):
    """Tests search with time filters."""
    res = client.get(f"/api/v1/search?q=test&time_filter={time_filter}&tz_offset=120")
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
        url_filter="example.com",
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
            "distance": 0.1 * i,
        }
        for i in range(1, 6)
    ]
    mock_db_manager.get_latest.return_value = rows[:2]

    res = client.get("/api/v1/search?q=&limit=2&offset=1")
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 2


def test_search_context_db_exception_raises_500(client, mock_db_manager):
    """Tests HTTP 500 when database search raises an error."""
    mock_db_manager.get_latest.side_effect = Exception("Search failed")

    res = client.get("/api/v1/search?q=")
    assert res.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


def test_search_context_get_documents_fallback(mock_embedder, tmp_path):
    """Tests search endpoint fallback when db_manager only implements get_documents and search_documents."""
    fallback_db = MagicMock(spec=["get_documents", "search_documents", "insert_snippet", "delete_snippet"])
    fallback_db.get_documents.return_value = [
        {"id": 99, "url": "https://fallback.com", "title": "Doc Fallback", "created_at": "2026-08-09 12:00:00"}
    ]
    fallback_db.search_documents.return_value = [
        {"id": 100, "url": "https://fallback.com", "title": "Vector Fallback", "created_at": "2026-08-09 12:00:00"}
    ]

    app = api.create_app(db_manager=fallback_db, embedder_model=mock_embedder, image_dir=str(tmp_path))
    with TestClient(app) as test_client:
        res1 = test_client.get("/api/v1/search?q=")
        assert res1.status_code == 200
        assert res1.json()["results"][0]["id"] == 99

        res2 = test_client.get("/api/v1/search?q=query")
        assert res2.status_code == 200
        assert res2.json()["results"][0]["id"] == 100


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


# =====================================================================
# Internal & MCP Routes
# =====================================================================

def test_mcp_status_and_ide_connected(client):
    """Tests GET /api/internal/mcp-status and POST /api/internal/ide-connected."""
    app_state.ide_connected = False

    res1 = client.get("/api/internal/mcp-status")
    assert res1.status_code == 200
    assert res1.json()["connected"] is False

    res2 = client.post("/api/internal/ide-connected")
    assert res2.status_code == 200
    assert res2.json()["status"] == "ok"
    assert app_state.ide_connected is True


def test_activity_tracking_and_retrieval(client):
    """Tests recording and retrieving IDE/model activity records."""
    client.post("/api/internal/activity", json={"action": "paste", "source": "chrome", "chars": 120})

    res = client.get("/api/internal/activity-data")
    assert res.status_code == 200
    activities = res.json()["activities"]
    assert len(activities) > 0
    assert activities[0]["action"] == "paste"


# =====================================================================
# Shutdown & Lifespan Tests
# =====================================================================

def test_shutdown_server(client, mocker):
    """Tests process shutdown trigger execution without killing test process."""
    mocker.patch("time.sleep")
    mocker.patch("os._exit")
    mocker.patch("subprocess.run")

    res = client.post("/api/internal/shutdown", json={"force_global": True})
    assert res.status_code == 200
    assert "Server instances destroyed." in res.json()["message"]


def test_shutdown_server_non_global(client, mocker):
    """Tests server shutdown with force_global=False skipping process kill commands."""
    mocker.patch("time.sleep")
    mock_subprocess = mocker.patch("subprocess.run")
    mocker.patch("os._exit")

    res = client.post("/api/internal/shutdown", json={"force_global": False})
    assert res.status_code == 200
    mock_subprocess.assert_not_called()


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


def test_lifespan_first_run_opens_welcome_page(mock_db_manager, mock_embedder, tmp_path, mocker):
    """Tests that first run (empty database) triggers browser auto-open."""
    mock_db_manager.get_latest.return_value = []
    mock_browser = mocker.patch("webbrowser.open")
    mocker.patch("time.sleep")

    def run_thread_inline(target, daemon=None):
        mock_thread = MagicMock()
        mock_thread.start.side_effect = target
        return mock_thread

    mocker.patch("threading.Thread", side_effect=run_thread_inline)

    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path),
    )

    with TestClient(app):
        pass

    mock_browser.assert_called_once()


def test_lifespan_db_error_handled_gracefully(mock_db_manager, mock_embedder, tmp_path, mocker):
    """Tests that startup continues cleanly when checking DB status in lifespan fails."""
    mock_db_manager.get_latest.side_effect = Exception("DB error during startup")
    mock_logger = mocker.patch("patens.server.api.logger")

    app = api.create_app(
        db_manager=mock_db_manager,
        embedder_model=mock_embedder,
        image_dir=str(tmp_path),
    )

    with TestClient(app):
        pass

    mock_logger.error.assert_called_once()