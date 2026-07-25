# src/patens/server/models.py
from typing import List, Optional
from pydantic import BaseModel


class IngestPayload(BaseModel):
    type: str
    url: str
    title: str
    content: str
    media: Optional[str] = None


class IngestResponse(BaseModel):
    status: str
    id: int
    smart_clipboard: Optional[str] = None


class SearchResultItem(BaseModel):
    id: Optional[int] = None
    url: str
    title: str
    content: str
    # Database columns
    created_at: Optional[str] = None
    timestamp: Optional[str] = None
    # Vector and Re-ranking metrics
    distance: Optional[float] = None
    hybrid_score: Optional[float] = None


class SearchResponse(BaseModel):
    status: str
    results: List[SearchResultItem]


class ConnectionState(BaseModel):
    ide_connected: bool = False
