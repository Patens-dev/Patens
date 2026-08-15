import hashlib
import logging
import os
import urllib.parse
import urllib.request
from typing import Any, Dict, List
import requests
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator

from patens.server.services.pdf_converter import FastPDFSpatialIndexer, PDFConverterService

logger = logging.getLogger("patens.server.routers.pdf_router")

router = APIRouter(prefix="/pdf", tags=["PDF Processing"])
spatial_indexer = FastPDFSpatialIndexer()
html_converter = PDFConverterService()

_html_conversion_cache: Dict[str, str] = {}
_spatial_index_cache: Dict[str, List[Dict[str, Any]]] = {}


class PdfUrlRequest(BaseModel):
    url: str = Field(..., description="HTTP/HTTPS URL or local file:// path")
    title: str = "PDF Document"

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: str) -> str:
        v_clean = (v or "").strip()
        if not (
            v_clean.startswith("http://")
            or v_clean.startswith("https://")
            or v_clean.startswith("file://")
        ):
            raise ValueError("URL must start with http://, https://, or file://")
        return v_clean


def _compute_url_checksum(url: str) -> str:
    return hashlib.md5(url.strip().encode("utf-8")).hexdigest()


def _fetch_pdf_content(url_str: str) -> bytes:
    url_str = url_str.strip()

    # Case A: Local File Path
    if url_str.startswith("file://"):
        try:
            parsed = urllib.parse.urlparse(url_str)
            file_path = urllib.request.url2pathname(parsed.path)

            if not os.path.exists(file_path):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Local PDF file not found on disk: {file_path}",
                )

            with open(file_path, "rb") as f:
                return f.read()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unable to fetch PDF from URL: Failed to read local PDF file: {e}",
            )

    # Case B: Web PDF with browser headers
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/127.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua": '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

    try:
        res = requests.get(url_str, headers=headers, timeout=60, allow_redirects=True)
        if res.status_code != 200:
            logger.error("Remote server returned %d when fetching %s", res.status_code, url_str)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unable to fetch PDF from URL: Remote server returned HTTP {res.status_code}",
            )
        return res.content
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logger.error("Network error fetching PDF from %s: %s", url_str, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF conversion failed: Network error fetching PDF from URL: {e}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to fetch PDF from URL: {e}",
        )


# ==========================================
# ENDPOINTS
# ==========================================

@router.post("/convert-url", response_class=HTMLResponse)
async def convert_pdf_url_to_html(payload: PdfUrlRequest):
    try:
        url_str = payload.url
        checksum = _compute_url_checksum(url_str)

        if checksum in _html_conversion_cache:
            return HTMLResponse(content=_html_conversion_cache[checksum], status_code=200)

        content = _fetch_pdf_content(url_str)
        html_content = html_converter.convert_pdf_to_html(
            pdf_input=content, document_title=payload.title
        )

        _html_conversion_cache[checksum] = html_content
        return HTMLResponse(content=html_content, status_code=200)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("PDF conversion failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF conversion failed: {e}",
        )


@router.post("/convert-file", response_class=HTMLResponse)
async def convert_pdf_file_to_html(file: UploadFile = File(...)):
    """Converts a raw uploaded PDF stream to HTML."""
    if not (file.filename and file.filename.lower().endswith(".pdf")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are supported (.pdf)",
        )
    try:
        content = await file.read()
        checksum = hashlib.md5(content).hexdigest()

        if checksum in _html_conversion_cache:
            return HTMLResponse(content=_html_conversion_cache[checksum], status_code=200)

        html_content = html_converter.convert_pdf_to_html(
            pdf_input=content, document_title=file.filename or "Document.pdf"
        )
        _html_conversion_cache[checksum] = html_content
        return HTMLResponse(content=html_content, status_code=200)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("PDF file upload processing failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF file processing failed: {str(e)}",
        )


@router.post("/spatial-index-url", response_model=List[Dict[str, Any]])
async def get_pdf_spatial_index_url(payload: PdfUrlRequest) -> List[Dict[str, Any]]:
    try:
        url_str = payload.url
        checksum = _compute_url_checksum(url_str)

        if checksum in _spatial_index_cache:
            return _spatial_index_cache[checksum]

        content = _fetch_pdf_content(url_str)
        spatial_data = spatial_indexer.extract_spatial_index(pdf_input=content)
        _spatial_index_cache[checksum] = spatial_data
        return spatial_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to generate spatial index: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate spatial index: {e}",
        )