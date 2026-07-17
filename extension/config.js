console.log("[Context Clipboard] Initialization started...");

const CONFIG = {
    API_BASE: 'http://localhost:8000',
    BATCH_SIZE: 10,
    MIN_TEXT_LENGTH: 15,
    VALID_TAGS: ['P', 'PRE', 'BLOCKQUOTE', 'LI', 'CODE', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'IMG'],
    CONTAINER_TAGS: ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'BODY', 'UL', 'OL'],
    READABLE_TAGS: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TD']
};

// Global UI State
let cartOpen = false;
let paletteOpen = false;

// Editor & Palette State
let activeInputElement = null;
let savedRange = null;
let savedInputState = null;
let stagedItems = [];
let currentResults = [];

// Multi-Select State
let selectedIndex = 0;
let selectionAnchor = 0;
let selectedIndices = new Set([0]);

// Infinite Scroll State
let currentQuery = '';
let currentOffset = 0;
let isFetching = false;
let hasMore = true;

// Dynamic Hotkey Config (Defaults)
let currentHotkeys = {
    capture: {ctrl: true, shift: true, alt: false, meta: false},
    palette: {ctrl: true, shift: true, alt: false, meta: false, key: " "},
    stageAll: {ctrl: true, shift: true, alt: false, meta: false, key: "a"}
};