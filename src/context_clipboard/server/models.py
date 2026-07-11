from typing import Optional, List, Dict, Any

from pydantic import BaseModel


class IngestPayload(BaseModel):
    url: str
    title: str
    content: str
    type: str = "text"
    media: Optional[str] = None


class SearchResponse(BaseModel):
    status: str
    results: List[Dict[str, Any]]


class IngestResponse(BaseModel):
    status: str
    id: int
