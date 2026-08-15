# src/patens/server/database.py
import sqlite3
import logging
import math
import re
from contextlib import closing
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any, Union

import sqlite_vec
from sqlite_vec import serialize_float32

logger = logging.getLogger(__name__)


def normalize_doc_key(url: Optional[str], title: Optional[str]) -> str:
    """Normalizes document key by stripping URL hash anchors and trailing slashes."""
    if url and url.strip():
        clean_url = url.split('#')[0].rstrip('/')
        return clean_url
    return (title or "Untitled Document").strip()


def split_into_paragraphs(text: str) -> List[str]:
    """Splits text into clean, distinct paragraph blocks."""
    if not text:
        return []
    blocks = re.split(r'\n\s*\n+', text.strip())
    return [b.strip() for b in blocks if b.strip()]


class DatabaseManager:
    """Handles SQLite & Vector operations with Document-level aggregation and granular clips."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=20.0)
        conn.row_factory = sqlite3.Row
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return conn

    def _init_db(self) -> None:
        with closing(self._get_connection()) as db:
            with db:
                db.execute("""
                    CREATE TABLE IF NOT EXISTS snippets
                    (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        url         TEXT,
                        title       TEXT,
                        content     TEXT,
                        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                        is_volatile BOOLEAN  DEFAULT 0
                    )
                """)
                db.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_snippets USING vec0(
                        embedding float[384],
                        content_id INTEGER
                    )
                """)
                db.execute("CREATE INDEX IF NOT EXISTS idx_snippets_url ON snippets(url)")
                db.execute("CREATE INDEX IF NOT EXISTS idx_snippets_created ON snippets(created_at)")

                try:
                    db.execute("ALTER TABLE snippets ADD COLUMN is_volatile BOOLEAN DEFAULT 0")
                except Exception:
                    pass
        logger.info("Database initialized with Document clustering indexes.")

    def insert_snippet(
        self,
        url: str,
        title: str,
        content: str,
        embedding: List[float],
        is_volatile: bool = False
    ) -> int:
        clean_content = (content or "").strip()
        if not clean_content:
            return 0

        try:
            with closing(self._get_connection()) as db:
                with db:
                    cursor = db.cursor()
                    cursor.execute("SELECT id FROM snippets WHERE content = ? LIMIT 1", (clean_content,))
                    existing_row = cursor.fetchone()

                    if existing_row:
                        existing_id = existing_row[0]
                        cursor.execute("UPDATE snippets SET created_at = CURRENT_TIMESTAMP WHERE id = ?", (existing_id,))
                        logger.info(
                            f"🔍 [TRACE 2: DB DEDUPLICATED] ID={existing_id} | URL={url} | ContentLen={len(clean_content)}"
                        )
                        return existing_id

                    cursor.execute(
                        "INSERT INTO snippets (url, title, content, is_volatile) VALUES (?, ?, ?, ?)",
                        (url, title, clean_content, 1 if is_volatile else 0)
                    )
                    content_id = cursor.lastrowid
                    cursor.execute(
                        "INSERT INTO vec_snippets (embedding, content_id) VALUES (?, ?)",
                        (serialize_float32(embedding), content_id)
                    )

                    logger.info(
                        f"🔍 [TRACE 2: DB INSERTED NEW] ID={content_id} | URL={url} | ContentLen={len(clean_content)}"
                    )
                    return content_id
        except Exception as e:
            logger.error("Error inserting snippet: %s", e, exc_info=True)
            return 0

    def update_snippet(
        self,
        snippet_id: int,
        content: str,
        embedding: Optional[List[float]] = None
    ) -> bool:
        clean_content = (content or "").strip()
        if not clean_content:
            return False

        try:
            with closing(self._get_connection()) as db:
                with db:
                    cursor = db.cursor()
                    cursor.execute(
                        "UPDATE snippets SET content = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (clean_content, snippet_id)
                    )
                    if cursor.rowcount == 0:
                        return False

                    if embedding is not None:
                        try:
                            cursor.execute("DELETE FROM vec_snippets WHERE content_id = ?", (snippet_id,))
                        except Exception:
                            pass
                        cursor.execute(
                            "INSERT INTO vec_snippets (embedding, content_id) VALUES (?, ?)",
                            (serialize_float32(embedding), snippet_id)
                        )
                    return True
        except Exception as e:
            logger.error("Error updating snippet %s: %s", snippet_id, e, exc_info=True)
            return False

    def get_by_id(self, content_id: int) -> Optional[Dict[str, Any]]:
        try:
            with closing(self._get_connection()) as db:
                sql = "SELECT id, title, url, content, created_at, is_volatile FROM snippets WHERE id = ?"
                result = db.execute(sql, (content_id,)).fetchone()

            if result:
                return {
                    "id": result["id"],
                    "title": result["title"],
                    "url": result["url"],
                    "content": result["content"],
                    "created_at": result["created_at"],
                    "is_volatile": result["is_volatile"] if result["is_volatile"] is not None else 0
                }
            return None
        except Exception as e:
            logger.error("Error fetching snippet by id %s: %s", content_id, e, exc_info=True)
            return None

    def get_recent_snippets(self, hours: int = 24) -> List[Dict[str, Any]]:
        try:
            with closing(self._get_connection()) as db:
                cursor = db.execute("""
                    SELECT id, title, url, content, created_at, is_volatile
                    FROM snippets
                    WHERE created_at >= datetime('now', ?)
                    ORDER BY id ASC
                """, (f'-{hours} hours',))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error("Error fetching recent snippets: %s", e, exc_info=True)
            return []

    def _assemble_documents_from_rows(self, rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
        """Groups raw database rows into complete, normalized Document structures."""
        doc_groups: Dict[str, List[sqlite3.Row]] = {}
        for r in rows:
            key = normalize_doc_key(r["url"], r["title"])
            if key not in doc_groups:
                doc_groups[key] = []
            doc_groups[key].append(r)

        documents = []
        for key, snips in doc_groups.items():
            if not snips:
                continue

            snips.sort(key=lambda s: s["id"])
            raw_ids = [s["id"] for s in snips]
            latest_snip = max(snips, key=lambda s: s["created_at"])

            clips = []
            if len(snips) > 1:
                for idx, s in enumerate(snips):
                    text = s["content"].strip()
                    if text:
                        clips.append({
                            "id": s["id"],
                            "url": s["url"] or "",
                            "title": f"Paragraph #{idx + 1}",
                            "content": text,
                            "created_at": s["created_at"],
                            "tokens": math.ceil(len(text) / 4)
                        })
            else:
                paragraphs = split_into_paragraphs(snips[0]["content"])
                if len(paragraphs) > 1:
                    for idx, p in enumerate(paragraphs):
                        clips.append({
                            "id": snips[0]["id"],
                            "url": snips[0]["url"] or "",
                            "title": f"Paragraph #{idx + 1}",
                            "content": p,
                            "created_at": snips[0]["created_at"],
                            "tokens": math.ceil(len(p) / 4)
                        })
                else:
                    clips.append({
                        "id": snips[0]["id"],
                        "url": snips[0]["url"] or "",
                        "title": snips[0]["title"] or "Paragraph #1",
                        "content": snips[0]["content"],
                        "created_at": snips[0]["created_at"],
                        "tokens": math.ceil(len(snips[0]["content"]) / 4)
                    })

            full_content = "\n\n".join(c["content"].strip() for c in clips if c["content"].strip())

            documents.append({
                "id": snips[0]["id"],
                "url": snips[0]["url"] or "",
                "title": snips[0]["title"] or "Untitled Document",
                "content": full_content,
                "created_at": latest_snip["created_at"],
                "is_volatile": any(s["is_volatile"] for s in snips),
                "clip_count": len(clips),
                "raw_ids": raw_ids,
                "tokens": math.ceil(len(full_content) / 4),
                "clips": clips
            })

        documents.sort(key=lambda d: d["created_at"], reverse=True)
        return documents

    def get_documents(
        self,
        limit: int = 20,
        offset: int = 0,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        url_filter: str = ""
    ) -> List[Dict[str, Any]]:
        extra_sql = ""
        params = []

        if start_time:
            extra_sql += " AND created_at >= ?"
            params.append(start_time)
        if end_time:
            extra_sql += " AND created_at < ?"
            params.append(end_time)
        if url_filter:
            extra_sql += " AND url LIKE ?"
            params.append(f"%{url_filter}%")

        try:
            with closing(self._get_connection()) as db:
                snippet_sql = f"""
                    SELECT id, url, title, content, created_at, is_volatile
                    FROM snippets
                    WHERE 1=1 {extra_sql}
                    ORDER BY created_at DESC, id ASC
                """
                rows = db.execute(snippet_sql, params).fetchall()

            all_docs = self._assemble_documents_from_rows(rows)
            return all_docs[offset: offset + limit]
        except Exception as e:
            logger.error("Error in get_documents: %s", e, exc_info=True)
            return []

    def get_latest(
        self,
        limit: int = 10,
        offset: int = 0,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        url_filter: str = ""
    ) -> List[Dict[str, Any]]:
        return self.get_documents(
            limit=limit,
            offset=offset,
            start_time=start_time,
            end_time=end_time,
            url_filter=url_filter
        )

    def search_documents(
        self,
        query_text: str,
        query_vector: List[float],
        limit: int = 20,
        offset: int = 0,
        threshold: float = 1.35,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        url_filter: str = "",
        prioritize_volatile: bool = False
    ) -> List[Dict[str, Any]]:
        try:
            terms = [t for t in query_text.strip().split() if len(t) > 1]
            if not terms and query_text.strip():
                terms = [query_text.strip()]

            extra_sql = ""
            params = []
            if start_time:
                extra_sql += " AND s.created_at >= ?"
                params.append(start_time)
            if end_time:
                extra_sql += " AND s.created_at < ?"
                params.append(end_time)
            if url_filter:
                extra_sql += " AND s.url LIKE ?"
                params.append(f"%{url_filter}%")

            fetch_k = max(200, (offset + limit) * 20)

            with closing(self._get_connection()) as db:
                kw_results = []
                if terms:
                    where_clauses = ["(title LIKE ? OR content LIKE ?)"] * len(terms)
                    kw_params = [val for term in terms for val in (f"%{term}%", f"%{term}%")]
                    kw_sql = f"""
                        SELECT id, url, title, created_at, is_volatile, 0.0 as distance
                        FROM snippets
                        WHERE {" AND ".join(where_clauses)} {extra_sql.replace('s.', '')}
                        LIMIT {fetch_k}
                    """
                    kw_results = db.execute(kw_sql, kw_params + params).fetchall()

                vec_sql = f"""
                    SELECT s.id, s.url, s.title, s.created_at, s.is_volatile, v.distance
                    FROM snippets s
                    INNER JOIN vec_snippets v ON s.id = v.content_id
                    WHERE v.embedding MATCH ? AND v.k = {fetch_k} {extra_sql}
                    ORDER BY v.distance ASC
                """
                vec_results = db.execute(vec_sql, [serialize_float32(query_vector)] + params).fetchall()

            doc_scores: Dict[str, float] = {}
            now = datetime.now(timezone.utc)

            for r in list(kw_results) + list(vec_results):
                dist = r["distance"]
                if dist > threshold:
                    continue
                key = normalize_doc_key(r["url"], r["title"])
                sim = 1.0 / (1.0 + dist)
                try:
                    dt = datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    age_days = max(0.0, (now - dt).total_seconds() / 86400.0)
                    recency = math.exp(-0.08 * age_days)
                except Exception:
                    recency = 0.5

                score = (sim * 0.7) + (recency * 0.3)
                if prioritize_volatile and r["is_volatile"]:
                    score += 10.0

                if key not in doc_scores or score > doc_scores[key]:
                    doc_scores[key] = score

            if not doc_scores:
                return []

            sorted_keys = sorted(doc_scores.keys(), key=lambda k: doc_scores[k], reverse=True)
            target_keys = set(sorted_keys[offset: offset + limit])

            with closing(self._get_connection()) as db:
                snippet_sql = f"""
                    SELECT id, url, title, content, created_at, is_volatile
                    FROM snippets
                    WHERE 1=1 {extra_sql.replace('s.', '')}
                    ORDER BY id ASC
                """
                all_rows = db.execute(snippet_sql, params).fetchall()

            matched_rows = [r for r in all_rows if normalize_doc_key(r["url"], r["title"]) in target_keys]
            documents = self._assemble_documents_from_rows(matched_rows)

            for doc in documents:
                key = normalize_doc_key(doc["url"], doc["title"])
                doc["hybrid_score"] = doc_scores.get(key, 0.5)

            documents.sort(key=lambda d: d.get("hybrid_score", 0), reverse=True)
            return documents
        except Exception as e:
            logger.error("Error in search_documents: %s", e, exc_info=True)
            return []

    def search_similar(
        self,
        query_text: str,
        query_vector: List[float],
        limit: int = 10,
        offset: int = 0,
        threshold: float = 1.35,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        url_filter: str = "",
        prioritize_volatile: bool = False
    ) -> List[Dict[str, Any]]:
        return self.search_documents(
            query_text=query_text,
            query_vector=query_vector,
            limit=limit,
            offset=offset,
            threshold=threshold,
            start_time=start_time,
            end_time=end_time,
            url_filter=url_filter,
            prioritize_volatile=prioritize_volatile
        )

    def delete_snippet(self, snippet_id: Union[int, str, List[Union[int, str]]]) -> bool:
        if not snippet_id:
            return False

        raw_ids = snippet_id if isinstance(snippet_id, (list, tuple, set)) else [snippet_id]
        target_ids = []
        for sid in raw_ids:
            clean_str = str(sid).split('_')[0].strip()
            if clean_str.isdigit():
                target_ids.append(int(clean_str))
            elif clean_str:
                target_ids.append(clean_str)

        target_ids = list(set(target_ids))
        if not target_ids:
            return False

        try:
            with closing(self._get_connection()) as db:
                with db:
                    placeholders = ",".join("?" for _ in target_ids)
                    try:
                        db.execute(f"DELETE FROM vec_snippets WHERE content_id IN ({placeholders})", target_ids)
                    except Exception as ve:
                        logger.warning("Vector delete note: %s", ve)

                    cursor = db.execute(f"DELETE FROM snippets WHERE id IN ({placeholders})", target_ids)
                    return cursor.rowcount > 0
        except Exception as e:
            logger.error("Error deleting snippets %s: %s", target_ids, e, exc_info=True)
            return False

    def clear_history(self) -> None:
        try:
            with closing(self._get_connection()) as db:
                with db:
                    db.execute("DELETE FROM snippets")
                    db.execute("DELETE FROM vec_snippets")
            logger.warning("Database history completely cleared.")
        except Exception as e:
            logger.error("Error clearing database history: %s", e, exc_info=True)

    def purge_old_volatile(self, hours: int = 4) -> int:
        try:
            with closing(self._get_connection()) as db:
                with db:
                    rows = db.execute(
                        "SELECT id FROM snippets WHERE is_volatile = 1 AND created_at < datetime('now', ?)",
                        (f'-{hours} hours',)
                    ).fetchall()

                    ids_to_delete = [r["id"] for r in rows]
                    if not ids_to_delete:
                        return 0

                    placeholders = ",".join("?" for _ in ids_to_delete)
                    db.execute(f"DELETE FROM vec_snippets WHERE content_id IN ({placeholders})", ids_to_delete)
                    db.execute(f"DELETE FROM snippets WHERE id IN ({placeholders})", ids_to_delete)
                    return len(ids_to_delete)
        except Exception as e:
            logger.error("Error purging volatile records: %s", e, exc_info=True)
            return 0