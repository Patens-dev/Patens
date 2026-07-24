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
                # Add is_volatile column if it doesn't exist (for migrations)
                try:
                    db.execute("ALTER TABLE snippets ADD COLUMN is_volatile BOOLEAN DEFAULT 0")
                except:
                    pass  # Column already exists
        logger.info("Database initialized successfully.")

    def insert_snippet(self, url: str, title: str, content: str, embedding: List[float],
                       is_volatile: bool = False) -> int:
        """Inserts text and its vector embedding into the database."""
        with closing(self._get_connection()) as db:
            with db:
                cursor = db.cursor()
                cursor.execute(
                    "INSERT INTO snippets (url, title, content, is_volatile) VALUES (?, ?, ?, ?)",
                    (url, title, content, is_volatile)
                )
                content_id = cursor.lastrowid

                cursor.execute(
                    "INSERT INTO vec_snippets (embedding, content_id) VALUES (?, ?)",
                    (serialize_float32(embedding), content_id)
                )
                return content_id

    def search_similar(self, query_text: str, query_vector: List[float],
                       limit: int = 10, offset: int = 0, threshold: float = 1.15,
                       start_time: str = None, end_time: str = None,
                       url_filter: str = "", prioritize_volatile: bool = False) -> List[Dict[str, Any]]:

        terms = [t for t in query_text.strip().split() if len(t) > 1]
        if not terms and query_text.strip():
            terms = [query_text.strip()]

        kw_results = []
        vec_results = []

        # --- Dynamic Constraints (Time & URL) ---
        extra_sql = ""
        extra_params = []

        if start_time:
            extra_sql += " AND s.created_at >= ?" if "s." in extra_sql or True else " AND created_at >= ?"  # force s. for uniform logic
            extra_params.append(start_time)
        if end_time:
            extra_sql += " AND s.created_at < ?"
            extra_params.append(end_time)

        # NEW: Filter by URL token (e.g. from:github.com)
        if url_filter:
            extra_sql += " AND s.url LIKE ?"
            extra_params.append(f"%{url_filter}%")

        with closing(self._get_connection()) as db:
            # Execute Lexical Match
            if terms:
                where_clauses = ["(title LIKE ? OR content LIKE ?)"] * len(terms)
                params = [val for term in terms for val in (f"%{term}%", f"%{term}%")]

                # Replace 's.' for lexical query since it doesn't use table alias 's'
                kw_extra_sql = extra_sql.replace('s.', '')

                kw_sql = f"""
                    SELECT id, title, url, content, created_at, is_volatile
                    FROM snippets
                    WHERE {" AND ".join(where_clauses)} {kw_extra_sql}
                    ORDER BY id DESC LIMIT 50
                """
                kw_results = db.execute(kw_sql, params + extra_params).fetchall()

            # Execute Vector Semantic Match
            vec_sql = f"""
                      SELECT s.id, s.title, s.url, s.content, s.created_at, s.is_volatile, v.distance
                      FROM snippets s
                      INNER JOIN vec_snippets v ON s.id = v.content_id
                      WHERE v.embedding MATCH ? AND v.k = 50 {extra_sql}
                      """
            vec_params = [serialize_float32(query_vector)] + extra_params
            vec_results = db.execute(vec_sql, vec_params).fetchall()

        # Merge & Deduplicate
        seen_ids = set()
        final_results = []

        for r in kw_results:
            if r["id"] not in seen_ids:
                # FIX: dict(r).get() prevents the sqlite3.Row crash
                final_results.append({"id": r["id"], "title": r["title"], "url": r["url"], "content": r["content"],
                                      "created_at": r["created_at"], "is_volatile": dict(r).get("is_volatile", 0),
                                      "distance": 0.0})
                seen_ids.add(r["id"])

        valid_vec = sorted([r for r in vec_results if r["distance"] <= threshold], key=lambda x: x["distance"])
        for r in valid_vec:
            if r["id"] not in seen_ids:
                # FIX: dict(r).get() prevents the sqlite3.Row crash
                final_results.append({"id": r["id"], "title": r["title"], "url": r["url"], "content": r["content"],
                                      "created_at": r["created_at"], "is_volatile": dict(r).get("is_volatile", 0),
                                      "distance": r["distance"]})
                seen_ids.add(r["id"])

        # Sort to prioritize volatile docs from last 60 minutes if requested
        if prioritize_volatile:
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            sixty_mins_ago = now - timedelta(minutes=60)

            volatile_recent = []
            other = []

            for r in final_results:
                try:
                    created_str = str(r.get("created_at", "")).replace("Z", "+00:00")
                    if " " in created_str and "T" not in created_str:
                        created_str = created_str.replace(" ", "T")
                    created_dt = datetime.fromisoformat(created_str)
                    if created_dt.tzinfo is None:
                        created_dt = created_dt.replace(tzinfo=timezone.utc)

                    if r.get("is_volatile") and created_dt >= sixty_mins_ago:
                        volatile_recent.append(r)
                    else:
                        other.append(r)
                except:
                    other.append(r)

            final_results = volatile_recent + other

        return final_results[offset: offset + limit]

    def get_latest(self, limit: int = 10, offset: int = 0, start_time: str = None,
                   end_time: str = None, url_filter: str = "") -> List[Dict[str, Any]]:
        """Fetches recent snippets with optional time and URL boundaries."""
        with closing(self._get_connection()) as db:
            sql = "SELECT id, title, url, content, created_at, is_volatile FROM snippets WHERE 1=1"
            params = []

            if start_time:
                sql += " AND created_at >= ?"
                params.append(start_time)
            if end_time:
                sql += " AND created_at < ?"
                params.append(end_time)

            # NEW: Filter by URL token (e.g. from:github.com)
            if url_filter:
                sql += " AND url LIKE ?"
                params.append(f"%{url_filter}%")

            sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])

            results = db.execute(sql, params).fetchall()

        # FIX: dict(r).get() prevents the sqlite3.Row crash
        return [
            {"id": r["id"], "title": r["title"], "url": r["url"], "content": r["content"],
             "created_at": r["created_at"], "is_volatile": dict(r).get("is_volatile", 0), "distance": 0.0}
            for r in results
        ]

    def get_by_id(self, content_id: int) -> Optional[Dict[str, Any]]:
        """Fetches a specific snippet by its exact database ID."""
        with closing(self._get_connection()) as db:
            sql = """
                  SELECT id, title, url, content, created_at, is_volatile
                  FROM snippets
                  WHERE id = ? \
                  """
            result = db.execute(sql, (content_id,)).fetchone()

        if result:
            # FIX: dict(result).get() prevents the sqlite3.Row crash
            return {
                "id": result["id"],
                "title": result["title"],
                "url": result["url"],
                "content": result["content"],
                "created_at": result["created_at"],
                "is_volatile": dict(result).get("is_volatile", 0)
            }
        return None

    def update_snippet(self, snippet_id: int, new_content: str, new_embedding: list) -> bool:
        """Updates the content and vector embedding of an existing snippet."""
        try:
            # Serialize the vector depending on how your DB handles it (e.g., JSON or raw bytes)
            import json
            embedding_json = json.dumps(new_embedding)

            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE snippets SET content = ?, embedding = ? WHERE id = ?",
                    (new_content, embedding_json, snippet_id)
                )
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Error updating snippet {snippet_id}: {e}")
            return False

    def get_recent_snippets(self, hours: int = 24) -> list:
        """Retrieves snippets saved within the last X hours to populate the .context folder."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("""
                               SELECT id, title, url, content, created_at
                               FROM snippets
                               WHERE created_at >= datetime('now', ?)
                               ORDER BY created_at DESC
                               """, (f'-{hours} hours',))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            self.logger.error(f"Error fetching recent snippets: {e}")
            return []

    def delete_snippet(self, snippet_id: int) -> bool:
        """Allows the AI to delete a snippet from the database by ID."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            self.logger.error(f"Error deleting snippet {snippet_id}: {e}")
            return False

    def clear_history(self) -> None:
        """DANGER: Completely wipes the memory database."""
        with closing(self._get_connection()) as db:
            with db:
                db.execute("DELETE FROM snippets")
                db.execute("DELETE FROM vec_snippets")
        logger.warning("Database history completely cleared.")

    def purge_old_volatile(self, hours: int = 4) -> int:
        """
        Purges is_volatile=True records older than the specified hours.
        Returns the number of records deleted.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                # Delete snippets older than X hours where is_volatile = 1
                cursor.execute(
                    """
                    DELETE
                    FROM snippets
                    WHERE is_volatile = 1
                      AND created_at < datetime('now', ?)
                    """,
                    (f'-{hours} hours',)
                )
                deleted_count = cursor.rowcount
                conn.commit()

                if deleted_count > 0:
                    logger.info(f"Purged {deleted_count} volatile records older than {hours} hours.")

                return deleted_count
        except Exception as e:
            logger.error(f"Error purging old volatile records: {e}")
            return 0