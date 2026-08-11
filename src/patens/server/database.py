# src/patens/server/database.py
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
        """Inserts text/vector into the DB, or updates the timestamp if it already exists."""
        with closing(self._get_connection()) as db:
            with db:
                cursor = db.cursor()

                # 1. Check if this exact content already exists in the database
                cursor.execute("SELECT id FROM snippets WHERE content = ? LIMIT 1", (content,))
                existing_row = cursor.fetchone()

                if existing_row:
                    # 2a. DEDUPLICATION: It exists! Just update the timestamp to 'now'
                    content_id = existing_row[0]
                    cursor.execute(
                        "UPDATE snippets SET created_at = CURRENT_TIMESTAMP, is_volatile = ? WHERE id = ?",
                        (is_volatile, content_id)
                    )
                    logger.info("Duplicate context detected. Updated timestamp for snippet ID=%s", content_id)
                    return content_id

                # 2b. BRAND NEW: Insert the text and its vector embedding
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
            extra_sql += " AND s.created_at >= ?"
            extra_params.append(start_time)
        if end_time:
            extra_sql += " AND s.created_at < ?"
            extra_params.append(end_time)

        if url_filter:
            extra_sql += " AND s.url LIKE ?"
            extra_params.append(f"%{url_filter}%")

        with closing(self._get_connection()) as db:
            # Execute Lexical Match
            if terms:
                where_clauses = ["(title LIKE ? OR content LIKE ?)"] * len(terms)
                params = [val for term in terms for val in (f"%{term}%", f"%{term}%")]

                kw_extra_sql = extra_sql.replace('s.', '')

                kw_sql = f"""
                    SELECT id, title, url, content, created_at, is_volatile
                    FROM snippets
                    WHERE {" AND ".join(where_clauses)} {kw_extra_sql}
                    ORDER BY created_at DESC LIMIT 50
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
                final_results.append({"id": r["id"], "title": r["title"], "url": r["url"], "content": r["content"],
                                      "created_at": r["created_at"], "is_volatile": dict(r).get("is_volatile", 0),
                                      "distance": 0.0})
                seen_ids.add(r["id"])

        valid_vec = sorted([r for r in vec_results if r["distance"] <= threshold], key=lambda x: x["distance"])
        for r in valid_vec:
            if r["id"] not in seen_ids:
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

            if url_filter:
                sql += " AND url LIKE ?"
                params.append(f"%{url_filter}%")

            sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])

            results = db.execute(sql, params).fetchall()

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
                  WHERE id = ?
                  """
            result = db.execute(sql, (content_id,)).fetchone()

        if result:
            return {
                "id": result["id"],
                "title": result["title"],
                "url": result["url"],
                "content": result["content"],
                "created_at": result["created_at"],
                "is_volatile": dict(result).get("is_volatile", 0)
            }
        return None

    def update_snippet(self, snippet_id: int, new_content: str, new_embedding: List[float]) -> bool:
        """Updates the content and vector embedding of an existing snippet."""
        try:
            with closing(self._get_connection()) as db:
                with db:
                    cursor = db.execute(
                        "UPDATE snippets SET content = ? WHERE id = ?",
                        (new_content, snippet_id)
                    )
                    db.execute(
                        "UPDATE vec_snippets SET embedding = ? WHERE content_id = ?",
                        (serialize_float32(new_embedding), snippet_id)
                    )
                    return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Error updating snippet {snippet_id}: {e}")
            return False

    def get_recent_snippets(self, hours: int = 24) -> list:
        """Retrieves snippets saved within the last X hours to populate the .context folder."""
        try:
            with closing(self._get_connection()) as db:
                cursor = db.execute("""
                               SELECT id, title, url, content, created_at
                               FROM snippets
                               WHERE created_at >= datetime('now', ?)
                               ORDER BY created_at DESC
                               """, (f'-{hours} hours',))
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error fetching recent snippets: {e}")
            return []

    def delete_snippet(self, snippet_id: int) -> bool:
        """Deletes a snippet and its corresponding vector embedding from the database by ID."""
        try:
            with closing(self._get_connection()) as db:
                with db:
                    # 1. Delete associated vector embedding
                    db.execute("DELETE FROM vec_snippets WHERE content_id = ?", (snippet_id,))
                    # 2. Delete primary snippet record
                    cursor = db.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
                    deleted = cursor.rowcount > 0
                    if deleted:
                        logger.info(f"Successfully deleted snippet ID={snippet_id} from DB and vector index.")
                    return deleted
        except Exception as e:
            logger.error(f"Error deleting snippet {snippet_id}: {e}")
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
        Purges is_volatile=True records older than the specified hours and cleans vector index.
        Returns the number of records deleted.
        """
        try:
            with closing(self._get_connection()) as db:
                with db:
                    # Find IDs to purge
                    rows = db.execute(
                        "SELECT id FROM snippets WHERE is_volatile = 1 AND created_at < datetime('now', ?)",
                        (f'-{hours} hours',)
                    ).fetchall()

                    ids_to_delete = [r["id"] for r in rows]
                    if not ids_to_delete:
                        return 0

                    for sid in ids_to_delete:
                        db.execute("DELETE FROM vec_snippets WHERE content_id = ?", (sid,))
                        db.execute("DELETE FROM snippets WHERE id = ?", (sid,))

                    deleted_count = len(ids_to_delete)
                    logger.info(f"Purged {deleted_count} volatile records older than {hours} hours.")
                    return deleted_count
        except Exception as e:
            logger.error(f"Error purging old volatile records: {e}")
            return 0