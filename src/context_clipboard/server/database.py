import sqlite3
import logging
from typing import List, Dict, Optional

import sqlite_vec
from sqlite_vec import serialize_float32

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Handles all SQLite and Vector database operations."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Creates a new SQLite connection with the vector extension loaded."""
        db = sqlite3.connect(self.db_path)
        db.enable_load_extension(True)
        sqlite_vec.load(db)
        db.enable_load_extension(False)
        return db

    def _init_db(self):
        """Initializes tables if they do not exist."""
        with self._get_connection() as db:
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
            db.commit()
        logger.info("Database initialized successfully.")

    def insert_snippet(self, url: str, title: str, content: str, embedding: List[float]) -> int:
        """Inserts text and its vector embedding into the database."""
        with self._get_connection() as db:
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
            db.commit()
            return content_id

    def search_similar(self, query_text: str, query_vector: List[float], limit: int = 10, offset: int = 0,
                       threshold: float = 1.15) -> List[Dict]:
        """Performs a Hybrid Search (Keyword + Vector) with strict pagination."""
        with self._get_connection() as db:
            # 1. KEYWORD SEARCH (Lexical Match)
            # Break query into words so "zack rocha" matches "zack de la rocha"
            terms = [t for t in query_text.strip().split() if len(t) > 1]
            if not terms and query_text.strip():
                terms = [query_text.strip()]

            kw_results = []
            if terms:
                where_clauses = []
                params = []
                for term in terms:
                    where_clauses.append("(title LIKE ? OR content LIKE ?)")
                    params.extend([f"%{term}%", f"%{term}%"])

                where_sql = " AND ".join(where_clauses)
                kw_sql = f"""
                      SELECT id, title, url, content
                      FROM snippets
                      WHERE {where_sql}
                      ORDER BY id DESC
                      LIMIT 50
                      """
                kw_results = db.execute(kw_sql, params).fetchall()

            # 2. VECTOR SEARCH (Semantic Match)
            # Fetch a pool of 50 to filter down
            vec_sql = """
                      SELECT s.id, s.title, s.url, s.content, v.distance
                      FROM snippets s
                               INNER JOIN vec_snippets v ON s.id = v.content_id
                      WHERE v.embedding MATCH ? AND v.k = 50 \
                      """
            vec_results = db.execute(vec_sql, [serialize_float32(query_vector)]).fetchall()

        # 3. MERGE & DEDUPLICATE
        seen_ids = set()
        final_results = []

        # A. Add exact keyword matches FIRST (They get priority)
        for r in kw_results:
            if r[0] not in seen_ids:
                final_results.append({
                    "title": r[1],
                    "url": r[2],
                    "content": r[3],
                    "distance": 0.0,  # Perfect score
                })
                seen_ids.add(r[0])

        # B. Add semantic matches SECOND (Only if they pass the strict threshold filter)
        valid_vec = sorted([r for r in vec_results if r[4] <= threshold], key=lambda x: x[4])
        for r in valid_vec:
            if r[0] not in seen_ids:
                final_results.append({
                    "title": r[1],
                    "url": r[2],
                    "content": r[3],
                    "distance": r[4],
                })
                seen_ids.add(r[0])

        # 4. PAGINATE
        return final_results[offset: offset + limit]

    def get_latest(self, limit: int = 1) -> List[Dict]:
        """Fetches the most recently saved snippets chronologically."""
        with self._get_connection() as db:
            sql = """
                  SELECT title, url, content, created_at
                  FROM snippets
                  ORDER BY id DESC
                  LIMIT ? \
                  """
            results = db.execute(sql, (limit,)).fetchall()

        return [
            {"title": r[0], "url": r[1], "content": r[2], "created_at": r[3]}
            for r in results
        ]

    # --- NEW: MISSING QUERIES ADDED BELOW ---

    def get_by_id(self, content_id: int) -> Optional[Dict]:
        """Fetches a specific snippet by its exact database ID."""
        with self._get_connection() as db:
            sql = """
                  SELECT title, url, content, created_at
                  FROM snippets
                  WHERE id = ? \
                  """
            result = db.execute(sql, (content_id,)).fetchone()

        if result:
            return {"title": result[0], "url": result[1], "content": result[2], "created_at": result[3]}
        return None

    def delete_snippet(self, content_id: int) -> bool:
        """Deletes a bad or unwanted memory from both tables."""
        with self._get_connection() as db:
            cursor = db.cursor()

            # Remove from standard relational table
            cursor.execute("DELETE FROM snippets WHERE id = ?", (content_id,))
            if cursor.rowcount == 0:
                return False  # Nothing was deleted

            # Remove from vector index
            cursor.execute("DELETE FROM vec_snippets WHERE content_id = ?", (content_id,))
            db.commit()
            logger.info(f"Deleted snippet ID: {content_id}")
            return True

    def clear_history(self) -> None:
        """DANGER: Completely wipes the memory database."""
        with self._get_connection() as db:
            db.execute("DELETE FROM snippets")
            db.execute("DELETE FROM vec_snippets")
            db.commit()
        logger.warning("Database history completely cleared.")
