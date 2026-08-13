// ==========================================
// 1. NAMESPACE & CONFIGURATION
// ==========================================
window.Patens = window.Patens || {};

Patens.Config = {
    // Explicit 127.0.0.1 prevents IPv6 resolution failures in Chrome/Edge
    API_BASE: 'http://127.0.0.1:8000',
    BATCH_SIZE: 10,
    MIN_TEXT_LENGTH: 15,
    VALID_TAGS: ['P', 'PRE', 'BLOCKQUOTE', 'LI', 'CODE', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'IMG'],
    CONTAINER_TAGS: ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'BODY', 'UL', 'OL'],
    READABLE_TAGS: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TD']
};

// ==========================================
// 2. CENTRALIZED STATE MANAGEMENT
// ==========================================
Patens.State = Patens.State || {};

Patens.State.ui = Patens.State.ui || {
    cartOpen: false,
    paletteOpen: false,
};

Patens.State.palette = Patens.State.palette || {
    currentQuery: '',
    currentOffset: 0,
    isFetching: false,
    hasMore: true,
    currentResults: [],
    stagedItems: [],
    selectedIndex: 0,
    selectionAnchor: 0,
    selectedIndices: new Set([0])
};

Patens.State.editor = Patens.State.editor || {
    activeInputElement: null,
    savedRange: null,
    savedInputState: null,
};

Patens.State.hotkeys = Patens.State.hotkeys || {
    capture: { ctrl: true, shift: true, alt: false, meta: false },
    palette: { ctrl: true, shift: true, alt: false, meta: false, key: " " },
    stageAll: { ctrl: true, shift: true, alt: false, meta: false, key: "a" }
};