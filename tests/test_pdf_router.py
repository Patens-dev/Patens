import hashlib
from typing import Any, Dict, List
import pytest
from unittest.mock import MagicMock, patch
from fastapi import FastAPI, status
from fastapi.testclient import TestClient
import requests

from patens.server.routers.pdf_router import (
    router,
    _html_conversion_cache,
    _spatial_index_cache,
    _compute_url_checksum,
)


# =====================================================================
# FIXTURES
# =====================================================================

@pytest.fixture(autouse=True)
def clear_caches():
    """Resets in-memory URL and file conversion caches between tests."""
    _html_conversion_cache.clear()
    _spatial_index_cache.clear()
    yield
    _html_conversion_cache.clear()
    _spatial_index_cache.clear()


@pytest.fixture
def client():
    """Initializes FastAPI TestClient with pdf_router attached."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# =====================================================================
# 1. UNIT TESTS: UTILITY HELPER
# =====================================================================

def test_compute_url_checksum():
    """Tests MD5 checksum calculation for URL strings including whitespace stripping."""
    raw_url = "  https://example.com/document.pdf  "
    expected_hash = hashlib.md5("https://example.com/document.pdf".encode("utf-8")).hexdigest()

    checksum = _compute_url_checksum(raw_url)
    assert checksum == expected_hash


# =====================================================================
# 2. ENDPOINT TESTS: /pdf/convert-url
# =====================================================================

def test_convert_pdf_url_to_html_success(client, mocker):
    """Tests successful fetching and converting remote PDF to HTML."""
    mock_pdf_bytes = b"%PDF-1.4 dummy pdf bytes"
    mock_html = "<html><body>Converted PDF</body></html>"

    # Mock external HTTP request
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = mock_pdf_bytes
    mock_get = mocker.patch("requests.get", return_value=mock_response)

    # Mock HTML converter service
    mock_convert = mocker.patch(
        "patens.server.routers.pdf_router.html_converter.convert_pdf_to_html",
        return_value=mock_html
    )

    payload = {"url": "https://example.com/sample.pdf", "title": "Sample PDF"}
    response = client.post("/pdf/convert-url", json=payload)

    assert response.status_code == 200
    assert response.text == mock_html
    assert response.headers["content-type"].startswith("text/html")

    mock_get.assert_called_once_with("https://example.com/sample.pdf", timeout=15)
    mock_convert.assert_called_once_with(pdf_input=mock_pdf_bytes, document_title="Sample PDF")

    # Verify result was stored in server cache
    checksum = _compute_url_checksum("https://example.com/sample.pdf")
    assert _html_conversion_cache[checksum] == mock_html


def test_convert_pdf_url_to_html_cache_hit(client, mocker):
    """Tests returning cached HTML without re-fetching remote URL or re-converting."""
    url = "https://example.com/cached.pdf"
    checksum = _compute_url_checksum(url)
    cached_html = "<html>Cached HTML</html>"
    _html_conversion_cache[checksum] = cached_html

    mock_get = mocker.patch("requests.get")
    mock_convert = mocker.patch("patens.server.routers.pdf_router.html_converter.convert_pdf_to_html")

    response = client.post("/pdf/convert-url", json={"url": url, "title": "Cached Title"})

    assert response.status_code == 200
    assert response.text == cached_html
    mock_get.assert_not_called()
    mock_convert.assert_not_called()


def test_convert_pdf_url_to_html_fetch_failed_http_400(client, mocker):
    """Tests HTTP 400 response when remote URL returns a non-200 status code."""
    mock_response = MagicMock()
    mock_response.status_code = 404
    mocker.patch("requests.get", return_value=mock_response)

    response = client.post("/pdf/convert-url", json={"url": "https://example.com/notfound.pdf"})

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "Unable to fetch PDF from URL" in response.json()["detail"]


def test_convert_pdf_url_to_html_network_exception_http_500(client, mocker):
    """Tests HTTP 500 handling when requests.get raises a network exception."""
    mocker.patch("requests.get", side_effect=requests.RequestException("Connection timeout"))

    response = client.post("/pdf/convert-url", json={"url": "https://example.com/timeout.pdf"})

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "PDF conversion failed" in response.json()["detail"]


def test_convert_pdf_url_to_html_invalid_url_validation(client):
    """Tests Pydantic HttpUrl validation failure returning 422."""
    response = client.post("/pdf/convert-url", json={"url": "invalid-url-string"})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# =====================================================================
# 3. ENDPOINT TESTS: /pdf/spatial-index-url
# =====================================================================

def test_get_pdf_spatial_index_url_success(client, mocker):
    """Tests fetching PDF and returning spatial index structure."""
    mock_pdf_bytes = b"%PDF-1.4 spatial test"
    mock_spatial_data = [
        {
            "page_num": 1,
            "width": 595.0,
            "height": 842.0,
            "text_nodes": [{"id": "p1_t0", "text": "Header"}],
            "figure_nodes": []
        }
    ]

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = mock_pdf_bytes
    mock_get = mocker.patch("requests.get", return_value=mock_response)

    mock_indexer = mocker.patch(
        "patens.server.routers.pdf_router.spatial_indexer.extract_spatial_index",
        return_value=mock_spatial_data
    )

    url = "https://example.com/spatial.pdf"
    response = client.post("/pdf/spatial-index-url", json={"url": url})

    assert response.status_code == 200
    assert response.json() == mock_spatial_data

    mock_get.assert_called_once_with(url, timeout=15)
    mock_indexer.assert_called_once_with(pdf_input=mock_pdf_bytes)

    # Verify cached
    checksum = _compute_url_checksum(url)
    assert _spatial_index_cache[checksum] == mock_spatial_data


def test_get_pdf_spatial_index_url_cache_hit(client, mocker):
    """Tests spatial index endpoint using cache on subsequent identical requests."""
    url = "https://example.com/spatial_cached.pdf"
    checksum = _compute_url_checksum(url)
    cached_data = [{"page_num": 1, "width": 100.0, "height": 100.0, "text_nodes": [], "figure_nodes": []}]
    _spatial_index_cache[checksum] = cached_data

    mock_get = mocker.patch("requests.get")
    mock_indexer = mocker.patch("patens.server.routers.pdf_router.spatial_indexer.extract_spatial_index")

    response = client.post("/pdf/spatial-index-url", json={"url": url})

    assert response.status_code == 200
    assert response.json() == cached_data
    mock_get.assert_not_called()
    mock_indexer.assert_not_called()


def test_get_pdf_spatial_index_url_fetch_failed_http_400(client, mocker):
    """Tests HTTP 400 when URL fetch returns non-200 code for spatial index."""
    mock_response = MagicMock()
    mock_response.status_code = 403
    mocker.patch("requests.get", return_value=mock_response)

    response = client.post("/pdf/spatial-index-url", json={"url": "https://example.com/forbidden.pdf"})

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "Unable to fetch PDF from URL" in response.json()["detail"]


def test_get_pdf_spatial_index_url_exception_http_500(client, mocker):
    """Tests HTTP 500 when spatial extraction raises an unhandled exception."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"pdf-data"
    mocker.patch("requests.get", return_value=mock_response)

    mocker.patch(
        "patens.server.routers.pdf_router.spatial_indexer.extract_spatial_index",
        side_effect=Exception("Extraction crashed")
    )

    response = client.post("/pdf/spatial-index-url", json={"url": "https://example.com/crash.pdf"})

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "Failed to generate spatial index" in response.json()["detail"]


# =====================================================================
# 4. ENDPOINT TESTS: /pdf/convert-file
# =====================================================================

def test_convert_pdf_file_to_html_success(client, mocker):
    """Tests uploading a PDF file and converting to HTML with byte checksum caching."""
    pdf_bytes = b"%PDF-1.4 file upload bytes"
    mock_html = "<html>Uploaded File Content</html>"

    mock_convert = mocker.patch(
        "patens.server.routers.pdf_router.html_converter.convert_pdf_to_html",
        return_value=mock_html
    )

    files = {"file": ("document.pdf", pdf_bytes, "application/pdf")}
    response = client.post("/pdf/convert-file", files=files)

    assert response.status_code == 200
    assert response.text == mock_html
    mock_convert.assert_called_once_with(pdf_input=pdf_bytes, document_title="document.pdf")

    # Verify byte MD5 cached
    checksum = hashlib.md5(pdf_bytes).hexdigest()
    assert _html_conversion_cache[checksum] == mock_html


def test_convert_pdf_file_to_html_cache_hit(client, mocker):
    """Tests uploading the same PDF file bytes twice uses cache on second request."""
    pdf_bytes = b"%PDF-1.4 duplicate upload bytes"
    checksum = hashlib.md5(pdf_bytes).hexdigest()
    _html_conversion_cache[checksum] = "<html>Cached File HTML</html>"

    mock_convert = mocker.patch("patens.server.routers.pdf_router.html_converter.convert_pdf_to_html")

    files = {"file": ("another_doc.pdf", pdf_bytes, "application/pdf")}
    response = client.post("/pdf/convert-file", files=files)

    assert response.status_code == 200
    assert response.text == "<html>Cached File HTML</html>"
    mock_convert.assert_not_called()


def test_convert_pdf_file_to_html_rejects_non_pdf_extension(client):
    """Tests rejecting file uploads that do not end in .pdf extension."""
    files = {"file": ("malicious.exe", b"not-a-pdf", "application/octet-stream")}
    response = client.post("/pdf/convert-file", files=files)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "Only PDF files are supported" in response.json()["detail"]


def test_convert_pdf_file_to_html_processing_failure_http_500(client, mocker):
    """Tests HTTP 500 when file conversion service fails."""
    mocker.patch(
        "patens.server.routers.pdf_router.html_converter.convert_pdf_to_html",
        side_effect=Exception("PDF parsing error")
    )

    files = {"file": ("corrupted.pdf", b"corrupted bytes", "application/pdf")}
    response = client.post("/pdf/convert-file", files=files)

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "PDF file processing failed" in response.json()["detail"]