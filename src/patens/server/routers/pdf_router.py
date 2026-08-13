import hashlib
from typing import Any, Dict, List
import requests
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, HttpUrl

from patens.server.services.pdf_converter import FastPDFSpatialIndexer, PDFConverterService

router = APIRouter(prefix="/pdf", tags=["PDF Processing"])
spatial_indexer = FastPDFSpatialIndexer()
html_converter = PDFConverterService()

# In-Memory Cache Dicts { hash_string: result_data }
_html_conversion_cache: Dict[str, str] = {}
_spatial_index_cache: Dict[str, List[Dict[str, Any]]] = {}


class PdfUrlRequest(BaseModel):
    url: HttpUrl
    title: str = "PDF Document"


def _compute_url_checksum(url: str) -> str:
    """Generates an MD5 checksum hash for a given URL string."""
    return hashlib.md5(url.strip().encode("utf-8")).hexdigest()


# ==========================================
# 1. URL CONVERSION & INDEXING ENDPOINTS
# ==========================================

@router.post("/convert-url", response_class=HTMLResponse)
async def convert_pdf_url_to_html(payload: PdfUrlRequest):
    """Fetches PDF and converts to HTML. Uses MD5 checksum caching to avoid redundant conversions."""
    url_str = str(payload.url)
    checksum = _compute_url_checksum(url_str)

    #  1. Return cached HTML if available
    if checksum in _html_conversion_cache:
        return HTMLResponse(content=_html_conversion_cache[checksum], status_code=200)

    try:
        res = requests.get(url_str, timeout=15)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Unable to fetch PDF from URL.")

        html_content = html_converter.convert_pdf_to_html(
            pdf_input=res.content, document_title=payload.title
        )

        #  2. Store in server cache before returning
        _html_conversion_cache[checksum] = html_content
        return HTMLResponse(content=html_content, status_code=200)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF conversion failed: {str(e)}")


@router.post("/spatial-index-url", response_model=List[Dict[str, Any]])
async def get_pdf_spatial_index_url(payload: PdfUrlRequest) -> List[Dict[str, Any]]:
    """Fetches PDF and returns spatial index metadata. Uses MD5 checksum caching."""
    url_str = str(payload.url)
    checksum = _compute_url_checksum(url_str)

    if checksum in _spatial_index_cache:
        return _spatial_index_cache[checksum]

    try:
        res = requests.get(url_str, timeout=15)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Unable to fetch PDF from URL.")

        spatial_data = spatial_indexer.extract_spatial_index(pdf_input=res.content)
        _spatial_index_cache[checksum] = spatial_data
        return spatial_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate spatial index: {str(e)}")


# ==========================================
# 2. FILE UPLOAD ENDPOINTS (Checksum on file bytes)
# ==========================================

@router.post("/convert-file", response_class=HTMLResponse)
async def convert_pdf_file_to_html(file: UploadFile = File(...)):
    """Uploads a PDF file and converts it to Patens HTML with byte checksum caching."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        content = await file.read()
        checksum = hashlib.md5(content).hexdigest()

        if checksum in _html_conversion_cache:
            return HTMLResponse(content=_html_conversion_cache[checksum], status_code=200)

        html_content = html_converter.convert_pdf_to_html(
            pdf_input=content, document_title=file.filename
        )
        _html_conversion_cache[checksum] = html_content
        return HTMLResponse(content=html_content, status_code=200)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF file processing failed: {str(e)}")