import sqlite3
import pytest
from contextlib import closing
from patens.server.database import DatabaseManager

# Standard 384-dimensional vector used by FastEmbed (bge-small-en-v1.5)
DUMMY_VECTOR = [0.1] * 384
DUMMY_VECTOR_ALT = [0.9] * 384


# =====================================================================
# FIXTURES
# =====================================================================

@pytest.fixture
def db_path(tmp_path):
    """Creates a temporary database file path for hermetic test execution."""
    return str(tmp_path / "test_patens.db")


@pytest.fixture
def db_manager(db_path):
    """Instantiates a fresh DatabaseManager with initialized tables."""
    return DatabaseManager(db_path)


# =====================================================================
# 1. INITIALIZATION & MIGRATIONS
# =====================================================================

def test_init_db_creates_schema(db_manager):
    """Verifies that relational and virtual vector tables are created successfully."""
    with sqlite3.connect(db_manager.db_path) as conn:
        cursor = conn.cursor()

        # Check snippets table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='snippets'")
        assert cursor.fetchone() is not None

        # Check vec_snippets virtual table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_snippets'")
        assert cursor.fetchone() is not None


def test_init_db_idempotent_migration(db_path):
    """Verifies re-running initialization on an existing database does not fail."""
    db1 = DatabaseManager(db_path)
    db2 = DatabaseManager(db_path)  # Trigger second init pass
    assert db1.db_path == db2.db_path


# =====================================================================
# 2. INGESTION & DEDUPLICATION
# =====================================================================

def test_insert_snippet_brand_new(db_manager):
    """Tests inserting a new snippet writes to both text and vector tables."""
    snippet_id = db_manager.insert_snippet(
        url="https://patens.dev",
        title="Patens Home",
        content="Patens local AI context engine.",
        embedding=DUMMY_VECTOR,
        is_volatile=False
    )
    assert isinstance(snippet_id, int)
    assert snippet_id > 0

    record = db_manager.get_by_id(snippet_id)
    assert record is not None
    assert record["title"] == "Patens Home"
    assert record["content"] == "Patens local AI context engine."
    assert record["is_volatile"] == 0


def test_insert_snippet_deduplication(db_manager):
    """Tests that inserting identical content updates timestamp instead of creating duplicate records."""
    id1 = db_manager.insert_snippet(
        url="https://example.com/1",
        title="Title 1",
        content="Exact Duplicate Content",
        embedding=DUMMY_VECTOR
    )

    id2 = db_manager.insert_snippet(
        url="https://example.com/2",
        title="Title 2",
        content="Exact Duplicate Content",
        embedding=DUMMY_VECTOR
    )

    assert id1 == id2

    # Confirm only 1 row exists in DB
    latest = db_manager.get_latest(limit=10)
    assert len(latest) == 1


# =====================================================================
# 3. RETRIEVAL & QUERYING
# =====================================================================

def test_get_by_id_existing_and_missing(db_manager):
    """Tests retrieving records by exact primary key."""
    sid = db_manager.insert_snippet("https://a.com", "Test", "Content", DUMMY_VECTOR)

    found = db_manager.get_by_id(sid)
    assert found is not None
    assert found["id"] == sid

    missing = db_manager.get_by_id(99999)
    assert missing is None


def test_get_latest_pagination_and_filters(db_manager):
    """Tests pagination (limit/offset) and URL filtering on get_latest."""
    db_manager.insert_snippet("https://github.com/1", "GH 1", "Content 1", DUMMY_VECTOR)
    db_manager.insert_snippet("https://github.com/2", "GH 2", "Content 2", DUMMY_VECTOR)
    db_manager.insert_snippet("https://docs.python.org", "Py Docs", "Content 3", DUMMY_VECTOR)

    # Limit and offset
    page1 = db_manager.get_latest(limit=2, offset=0)
    page2 = db_manager.get_latest(limit=2, offset=2)
    assert len(page1) == 2
    assert len(page2) == 1

    # URL filter
    gh_only = db_manager.get_latest(url_filter="github.com")
    assert len(gh_only) == 2
    assert all("github.com" in item["url"] for item in gh_only)


def test_get_recent_snippets_time_window(db_manager):
    """Tests fetching snippets within a specific hour window."""
    sid = db_manager.insert_snippet("https://recent.com", "Recent", "Fresh snippet", DUMMY_VECTOR)

    # Artificially age a snippet in SQLite to 48 hours ago
    with sqlite3.connect(db_manager.db_path) as conn:
        conn.execute(
            "UPDATE snippets SET created_at = datetime('now', '-48 hours') WHERE id = ?",
            (sid,)
        )

    # Fresh snippet
    db_manager.insert_snippet("https://fresh.com", "Fresh", "Brand new snippet", DUMMY_VECTOR)

    recent_24h = db_manager.get_recent_snippets(hours=24)
    assert len(recent_24h) == 1
    assert recent_24h[0]["title"] == "Fresh"


# =====================================================================
# 4. HYBRID & VECTOR SEARCH
# =====================================================================

def test_search_similar_hybrid_deduplication(db_manager):
    """Tests hybrid search merging lexical matches and vector matches without duplicate entries."""
    db_manager.insert_snippet(
        url="https://patens.dev",
        title="FastAPI Integration",
        content="Building high performance web services with FastAPI.",
        embedding=DUMMY_VECTOR
    )

    # Search for "FastAPI" both lexically and semantically
    results = db_manager.search_similar(
        query_text="FastAPI",
        query_vector=DUMMY_VECTOR,
        limit=10,
        threshold=2.0
    )

    assert len(results) == 1
    assert results[0]["title"] == "FastAPI Integration"


def test_search_similar_threshold_filtering(db_manager):
    """Tests that vector search excludes results with distance exceeding the threshold."""
    db_manager.insert_snippet(
        url="https://a.com",
        title="Distant Item",
        content="Unrelated text content.",
        embedding=DUMMY_VECTOR_ALT
    )

    # Search with a very strict vector distance threshold
    results = db_manager.search_similar(
        query_text="xyz_no_match_text",
        query_vector=DUMMY_VECTOR,
        threshold=0.001
    )

    assert len(results) == 0


def test_search_similar_prioritize_volatile(db_manager):
    """Tests prioritizing volatile snippets created within the last 60 minutes."""
    s1 = db_manager.insert_snippet("https://a.com", "Standard", "Common text item", DUMMY_VECTOR, is_volatile=False)
    s2 = db_manager.insert_snippet("https://b.com", "Volatile", "Common text item 2", DUMMY_VECTOR, is_volatile=True)

    results = db_manager.search_similar(
        query_text="Common",
        query_vector=DUMMY_VECTOR,
        prioritize_volatile=True
    )

    assert len(results) == 2
    assert results[0]["id"] == s2  # Volatile item boosted to top


# =====================================================================
# 5. UPDATES, DELETIONS & PURGING
# =====================================================================

def test_update_snippet_success_and_failure(db_manager):
    """Tests updating both text content and vector index for an existing snippet."""
    sid = db_manager.insert_snippet("https://a.com", "Title", "Old Content", DUMMY_VECTOR)

    success = db_manager.update_snippet(sid, "New Updated Content", DUMMY_VECTOR_ALT)
    assert success is True

    updated = db_manager.get_by_id(sid)
    assert updated["content"] == "New Updated Content"

    # Test update non-existent ID
    fail = db_manager.update_snippet(99999, "Content", DUMMY_VECTOR)
    assert fail is False


def test_delete_snippet_cascades_vector(db_manager):
    """Tests that deleting a snippet removes records from both snippets and vec_snippets tables."""
    sid = db_manager.insert_snippet("https://a.com", "Title", "Content", DUMMY_VECTOR)

    deleted = db_manager.delete_snippet(sid)
    assert deleted is True

    # Verify primary table deletion
    assert db_manager.get_by_id(sid) is None

    # Verify vector virtual table deletion (using _get_connection to load sqlite_vec extension)
    with closing(db_manager._get_connection()) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vec_snippets WHERE content_id = ?", (sid,))
        assert cursor.fetchone() is None


def test_clear_history(db_manager):
    """Tests wiping all data from relational and vector tables."""
    db_manager.insert_snippet("https://a.com", "T1", "C1", DUMMY_VECTOR)
    db_manager.insert_snippet("https://b.com", "T2", "C2", DUMMY_VECTOR)

    db_manager.clear_history()

    assert len(db_manager.get_latest()) == 0


def test_purge_old_volatile(db_manager):
    """Tests purging volatile records older than specified hours while preserving persistent records."""
    # 1. Old Volatile (Should be purged)
    v1 = db_manager.insert_snippet("https://a.com", "Old Volatile", "V1", DUMMY_VECTOR, is_volatile=True)
    with sqlite3.connect(db_manager.db_path) as conn:
        conn.execute("UPDATE snippets SET created_at = datetime('now', '-6 hours') WHERE id = ?", (v1,))

    # 2. Fresh Volatile (Should be kept)
    v2 = db_manager.insert_snippet("https://b.com", "Fresh Volatile", "V2", DUMMY_VECTOR, is_volatile=True)

    # 3. Old Non-Volatile (Should be kept)
    p1 = db_manager.insert_snippet("https://c.com", "Old Persistent", "P1", DUMMY_VECTOR, is_volatile=False)
    with sqlite3.connect(db_manager.db_path) as conn:
        conn.execute("UPDATE snippets SET created_at = datetime('now', '-6 hours') WHERE id = ?", (p1,))

    purged_count = db_manager.purge_old_volatile(hours=4)

    assert purged_count == 1
    assert db_manager.get_by_id(v1) is None
    assert db_manager.get_by_id(v2) is not None
    assert db_manager.get_by_id(p1) is not None


# =====================================================================
# 6. ERROR HANDLING & RESILIENCE
# =====================================================================

def test_exception_handling_on_corrupt_db_path(db_manager, mocker):
    """Tests graceful failure handling when SQL execution fails on DB operations."""
    # Simulate database connection / operational failure during method execution
    mocker.patch.object(db_manager, "_get_connection", side_effect=sqlite3.OperationalError("Simulated DB Error"))

    # Should catch exception, log error, and return False / [] instead of crashing
    assert db_manager.update_snippet(1, "Content", DUMMY_VECTOR) is False
    assert db_manager.get_recent_snippets() == []
    assert db_manager.delete_snippet(1) is False
    assert db_manager.purge_old_volatile() == 0