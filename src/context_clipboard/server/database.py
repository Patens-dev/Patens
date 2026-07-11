# src/context_clipboard/server/database.py
import sqlite3
import logging
from contextlib import closing
from typing import List, Dict, Optional, Any

import sqlite_vec
from sqlite_vec import serialize_float32

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Handles all SQLite and Vector database operations."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """
        Creates a new SQLite connection with the vector extension loaded.
        Uses Row factory for dict-like column access by name.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Enables column access via r["title"]
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        return conn

    def _init_db(self) -> None:
        """Initializes tables if they do not exist."""
        with closing(self._get_connection()) as db:
            with db:  # Manages the transaction (auto-commit/rollback)
                db.execute("""
                           CREATE TABLE IF NOT EXISTS snippets
                           (
                               id         INTEGER PRIMARY KEY AUTOINCREMENT,
                               url        TEXT,
                               title      TEXT,
                               content    TEXT,
                               created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                           )
                           """)
                db.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_snippets USING vec0(
                        embedding float[384],
                        content_id INTEGER
                    )
                """)
        logger.info("Database initialized successfully.")

    def insert_snippet(self, url: str, title: str, content: str, embedding: List[float]) -> int:
        """Inserts text and its vector embedding into the database."""
        with closing(self._get_connection()) as db:
            with db:
                cursor = db.cursor()
                cursor.execute(
                    "INSERT INTO snippets (url, title, content) VALUES (?, ?, ?)",
                    (url, title, content)
                )
                content_id = cursor.lastrowid

                cursor.execute(
                    "INSERT INTO vec_snippets (embedding, content_id) VALUES (?, ?)",
                    (serialize_float32(embedding), content_id)
                )
                return content_id

    def search_similar(self, query_text: str, query_vector: List[float],
                       limit: int = 10, offset: int = 0, threshold: float = 1.15) -> List[Dict[str, Any]]:
        """Performs a Hybrid Search (Keyword + Vector) with strict pagination."""

        # 1. KEYWORD SEARCH PREPARATION
        terms = [t for t in query_text.strip().split() if len(t) > 1]
        if not terms and query_text.strip():
            terms = [query_text.strip()]

        kw_results = []
        vec_results = []

        with closing(self._get_connection()) as db:
            # Execute Lexical Match
            if terms:
                where_clauses = ["(title LIKE ? OR content LIKE ?)"] * len(terms)
                params = [val for term in terms for val in (f"%{term}%", f"%{term}%")]

                where_sql = " AND ".join(where_clauses)
                kw_sql = f"""
                    SELECT id, title, url, content, created_at
                    FROM snippets
                    WHERE {where_sql}
                    ORDER BY id DESC
                    LIMIT 50
                """
                kw_results = db.execute(kw_sql, params).fetchall()

            # Execute Vector Semantic Match
            vec_sql = """
                      SELECT s.id, s.title, s.url, s.content, s.created_at, v.distance
                      FROM snippets s
                               INNER JOIN vec_snippets v ON s.id = v.content_id
                      WHERE v.embedding MATCH ? AND v.k = 50 \
                      """
            vec_results = db.execute(vec_sql, [serialize_float32(query_vector)]).fetchall()

        # 2. MERGE & DEDUPLICATE
        seen_ids = set()
        final_results = []

        # A. Add exact keyword matches FIRST (Priority)
        for r in kw_results:
            if r["id"] not in seen_ids:
                final_results.append({
                    "id": r["id"],
                    "title": r["title"],
                    "url": r["url"],
                    "content": r["content"],
                    "created_at": r["created_at"],
                    "distance": 0.0,  # Perfect score
                })
                seen_ids.add(r["id"])

        # B. Add semantic matches SECOND (Only if they pass the strict threshold)
        valid_vec = sorted([r for r in vec_results if r["distance"] <= threshold], key=lambda x: x["distance"])
        for r in valid_vec:
            if r["id"] not in seen_ids:
                final_results.append({
                    "id": r["id"],
                    "title": r["title"],
                    "url": r["url"],
                    "content": r["content"],
                    "created_at": r["created_at"],
                    "distance": r["distance"],
                })
                seen_ids.add(r["id"])

        # 3. PAGINATE
        return final_results[offset: offset + limit]

    def get_latest(self, limit: int = 1) -> List[Dict[str, Any]]:
        """Fetches the most recently saved snippets chronologically."""
        with closing(self._get_connection()) as db:
            sql = """
                  SELECT id, title, url, content, created_at
                  FROM snippets
                  ORDER BY id DESC
                  LIMIT ? \
                  """
            results = db.execute(sql, (limit,)).fetchall()

        return [
            {
                "id": r["id"],
                "title": r["title"],
                "url": r["url"],
                "content": r["content"],
                "created_at": r["created_at"]
            }
            for r in results
        ]

    def get_by_id(self, content_id: int) -> Optional[Dict[str, Any]]:
        """Fetches a specific snippet by its exact database ID."""
        with closing(self._get_connection()) as db:
            sql = """
                  SELECT id, title, url, content, created_at
                  FROM snippets
                  WHERE id = ? \
                  """
            result = db.execute(sql, (content_id,)).fetchone()

        if result:
            return {
                "id": result["id"],
                "title": result["title"],
                "url": result["url"],
                "content": result["content"],
                "created_at": result["created_at"]
            }
        return None

    def delete_snippet(self, content_id: int) -> bool:
        """Deletes a bad or unwanted memory from both tables."""
        with closing(self._get_connection()) as db:
            with db:
                cursor = db.cursor()

                # Remove from standard relational table
                cursor.execute("DELETE FROM snippets WHERE id = ?", (content_id,))
                if cursor.rowcount == 0:
                    return False  # Nothing was deleted

                # Remove from vector index
                cursor.execute("DELETE FROM vec_snippets WHERE content_id = ?", (content_id,))
                logger.info(f"Deleted snippet ID: {content_id}")
                return True

    def clear_history(self) -> None:
        """DANGER: Completely wipes the memory database."""
        with closing(self._get_connection()) as db:
            with db:
                db.execute("DELETE FROM snippets")
                db.execute("DELETE FROM vec_snippets")
        logger.warning("Database history completely cleared.")