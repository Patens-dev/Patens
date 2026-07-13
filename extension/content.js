console.log("[Context Clipboard] Initialization started...");

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================

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

// Infinite Scroll State
// Infinite Scroll State
let currentQuery = '';
let currentOffset = 0;
let isFetching = false;
let hasMore = true;
let currentTimeFilter = 'all'; // <-- ADD THIS HERE TO MAKE IT GLOBAL

// Dynamic Hotkey Config (Defaults)
let currentHotkeys = {
    capture: {ctrl: true, shift: true, alt: false, meta: false},
    palette: {ctrl: true, shift: true, alt: false, meta: false, key: " "}
};


// ==========================================
// 2. UTILITY HELPERS
// ==========================================

/** Fast hashing function (DJB2) for deduplication */
function fastHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0;
}

/** Truncates title to 5 words max for clean UI scanning */
function truncateTitle(title) {
    if (!title) return 'Untitled';
    const words = title.trim().split(/\s+/);
    return words.length <= 5 ? title : `${words.slice(0, 5).join(' ')}...`;
}

/** Smart absolute local date formatter */
function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = Math.max(0, now - date);

    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear();

    const timeOpts = {hour: 'numeric', minute: '2-digit'};
    const timeStr = date.toLocaleTimeString(undefined, timeOpts);

    if (isToday) {
        if (diffMs < 60000) return `Just now`;
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
        return `Today at ${timeStr}`;
    }

    if (isYesterday) {
        return `Yesterday at ${timeStr}`;
    }

    const dateOpts = {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'};
    if (date.getFullYear() !== now.getFullYear()) dateOpts.year = 'numeric';

    return date.toLocaleDateString(undefined, dateOpts);
}

/** Converts images to Base64 strings safely with Canvas fallback */
async function getBase64Image(imgElement) {
    if (imgElement.src.startsWith('data:')) return imgElement.src;

    try {
        const response = await fetch(imgElement.src);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.warn("[Context Clipboard] CORS blocked image fetch, using Canvas fallback.");
        const canvas = document.createElement("canvas");
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        canvas.getContext("2d").drawImage(imgElement, 0, 0);
        return canvas.toDataURL("image/png");
    }
}

/** Strict Image Finder: Prevents hijacking large container clicks */
function findUnderlyingImage(targetElement) {
    if (!targetElement || targetElement.nodeType !== Node.ELEMENT_NODE) return null;
    if (targetElement.tagName === 'IMG') return targetElement;

    const tightWrappers = ['PICTURE', 'FIGURE', 'A'];
    if (tightWrappers.includes(targetElement.tagName)) {
        return targetElement.querySelector('img');
    }
    return null;
}

/** Checks if the current keyboard event strictly matches the config */
function checkModifiers(e, configObj) {
    return (e.ctrlKey === configObj.ctrl) &&
        (e.shiftKey === configObj.shift) &&
        (e.altKey === configObj.alt) &&
        (e.metaKey === configObj.meta);
}


// ==========================================
// 3. STORAGE & NOTIFICATIONS
// ==========================================

/** Unified UI notification spawner */
function showFloatingNotification(message, color, x, y) {
    const popup = document.createElement('div');
    popup.className = 'cc-duplicate-warning';
    popup.innerText = message;
    popup.style.background = color;
    popup.style.left = `${x + 15}px`;
    popup.style.top = `${y + 15}px`;

    document.body.appendChild(popup);

    setTimeout(() => {
        popup.classList.add('cc-duplicate-fade');
        setTimeout(() => popup.remove(), 300);
    }, 1500);
}

/** Safely saves an array of elements to Chrome Storage */
async function saveBulkToCartDirectly(itemsToSave, eventX, eventY) {
    const result = await chrome.storage.local.get(['contextCart']);
    let cart = result.contextCart || [];
    let addedCount = 0;
    let duplicateCount = 0;

    itemsToSave.forEach(item => {
        const contentToHash = item.isImage ? item.base64Data : item.text;
        const itemHash = fastHash(contentToHash).toString();

        if (!cart.some(cartItem => cartItem.hash === itemHash)) {
            cart.push({
                id: Date.now().toString() + Math.random().toString().slice(2, 6),
                hash: itemHash,
                type: item.isImage ? 'image' : 'text',
                url: window.location.href,
                title: item.title,
                content: item.text,
                media: item.base64Data
            });
            addedCount++;

            if (item.element) {
                item.element.classList.add('cc-added-flash');
                setTimeout(() => item.element.classList.remove('cc-added-flash'), 600);
            }
        } else {
            duplicateCount++;
        }
    });

    if (addedCount > 0) await chrome.storage.local.set({contextCart: cart});

    // Handle feedback UI
    if (addedCount > 0 && duplicateCount === 0) {
        showFloatingNotification(`✨ Saved ${addedCount} items`, '#10b981', eventX, eventY);
    } else if (addedCount > 0 && duplicateCount > 0) {
        showFloatingNotification(`✨ Saved ${addedCount} items (${duplicateCount} duplicates)`, '#f59e0b', eventX, eventY);
    } else if (addedCount === 0) {
        showFloatingNotification(`Already in cart`, '#ff5252', eventX, eventY);
    }
}


// ==========================================
// 4. BROWSER EVENT LISTENERS
// ==========================================

// --- SYNC CONFIG & STORAGE ---
chrome.storage.local.get(['hotkeys'], (res) => {
    if (res.hotkeys) currentHotkeys = res.hotkeys;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.hotkeys) currentHotkeys = changes.hotkeys.newValue;
    if (changes.contextCart) renderUI();
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "open_palette") togglePalette();
});

// --- COMMAND PALETTE HOTKEY ---
window.addEventListener('keydown', (e) => {
    const isHotkeyMatch = checkModifiers(e, currentHotkeys.palette) &&
        e.key.toLowerCase() === currentHotkeys.palette.key.toLowerCase();

    if (isHotkeyMatch) {
        e.preventDefault();
        e.stopPropagation();
        togglePalette();
    }
}, true);

// --- HYPERLINK SHIELD ---
document.body.addEventListener('click', (e) => {
    if (checkModifiers(e, currentHotkeys.capture)) {
        const isLink = e.target.closest('a');
        const isValidTag = CONFIG.VALID_TAGS.includes(e.target.tagName) || e.target.closest(CONFIG.VALID_TAGS.join(','));

        if (isLink || isValidTag) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
}, true);

// --- HOVER HIGHLIGHTS ---
document.body.addEventListener('mouseover', (e) => {
    if (checkModifiers(e, currentHotkeys.capture) && e.target && CONFIG.VALID_TAGS.includes(e.target.tagName)) {
        e.target.classList.add('cc-highlight-hover');
    }
});
document.body.addEventListener('mouseout', (e) => {
    if (e.target && e.target.classList.contains('cc-highlight-hover')) {
        e.target.classList.remove('cc-highlight-hover');
    }
});

// --- CAPTURE CLICK LISTENER ---
document.body.addEventListener('mousedown', async (e) => {
    // Ignore internal UI clicks
    if (e.target.closest('.cc-cart-btn') || e.target.closest('.cc-cart-modal') || e.target.id === 'cc-search-overlay') return;

    if (checkModifiers(e, currentHotkeys.capture) && e.target) {
        e.preventDefault();
        e.stopPropagation();

        const textSelection = window.getSelection().toString().trim();
        const targetImg = findUnderlyingImage(e.target);
        let itemsToSave = [];

        if (textSelection) {
            // 1. Explicit Text Selection
            itemsToSave.push({text: textSelection, title: document.title, isImage: false, element: e.target});
        } else if (targetImg) {
            // 2. Explicit Image Click
            const base64Data = await getBase64Image(targetImg);
            itemsToSave.push({
                text: targetImg.alt || targetImg.title || `Image snippet from ${document.title}`,
                title: document.title,
                isImage: true,
                base64Data: base64Data,
                element: targetImg
            });
        } else {
            // 3. Smart Container Parsing
            const tagName = e.target.tagName;
            const isCustomElement = tagName.includes('-');
            const isEditable = e.target.isContentEditable;

            if (CONFIG.CONTAINER_TAGS.includes(tagName) || isCustomElement || isEditable) {
                const allReadable = Array.from(e.target.querySelectorAll(CONFIG.READABLE_TAGS.join(',')));
                const topLevelReadable = allReadable.filter(el => !allReadable.some(parent => parent.contains(el) && parent !== el));

                if (topLevelReadable.length > 0) {
                    topLevelReadable.forEach(child => {
                        const childText = child.innerText.trim();
                        if (childText.length > CONFIG.MIN_TEXT_LENGTH) {
                            itemsToSave.push({text: childText, title: document.title, isImage: false, element: child});
                        }
                    });
                } else {
                    const text = e.target.innerText.trim();
                    if (text.length > CONFIG.MIN_TEXT_LENGTH) {
                        itemsToSave.push({text, title: document.title, isImage: false, element: e.target});
                    }
                }
            } else if (CONFIG.READABLE_TAGS.includes(tagName) || tagName === 'SPAN') {
                const text = e.target.innerText.trim();
                if (text.length > CONFIG.MIN_TEXT_LENGTH) {
                    itemsToSave.push({text, title: document.title, isImage: false, element: e.target});
                }
            }
        }

        if (itemsToSave.length > 0) saveBulkToCartDirectly(itemsToSave, e.clientX, e.clientY);
    }
}, true);

// --- MANUAL TEXT SELECTION TOOLTIP ---
document.addEventListener('mouseup', (e) => {
    if (e.target.closest('.cc-selection-tooltip') || e.target.closest('.cc-palette-overlay') || e.target.closest('.cc-cart-modal')) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    document.getElementById('cc-selection-tooltip')?.remove();

    if (text.length > 0 && !e.ctrlKey && !e.shiftKey) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const tooltip = document.createElement('div');

        tooltip.id = 'cc-selection-tooltip';
        tooltip.className = 'cc-selection-tooltip';
        tooltip.innerHTML = '✨ Save Context';
        tooltip.style.top = `${window.scrollY + rect.top - 45}px`;
        tooltip.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 60}px`;

        tooltip.onmousedown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            // Route through bulk saver to utilize DRY principle
            saveBulkToCartDirectly([{
                text,
                title: `Manual Selection: ${document.title}`,
                isImage: false,
                element: null
            }], ev.clientX, ev.clientY);

            tooltip.innerHTML = '✓ Saved';
            tooltip.style.background = '#10b981';

            setTimeout(() => {
                tooltip.remove();
                selection.removeAllRanges();
            }, 800);
        };

        document.body.appendChild(tooltip);
    }
});


// ==========================================
// 5. CART MODAL UI
// ==========================================

function renderUI() {
    chrome.storage.local.get(['contextCart'], (result) => {
        const cart = result.contextCart || [];
        let btn = document.getElementById('cc-cart-btn');

        if (cart.length > 0) {
            if (!btn) {
                btn = document.createElement('div');
                btn.id = 'cc-cart-btn';
                btn.className = 'cc-cart-btn';
                btn.innerHTML = `📦<div class="cc-cart-badge" id="cc-badge"></div>`;
                btn.onclick = toggleModal;
                document.body.appendChild(btn);
            }
            document.getElementById('cc-badge').innerText = cart.length;
        } else {
            if (btn) btn.remove();
            if (cartOpen) toggleModal();
        }

        if (cartOpen) renderModalContents(cart);
    });
}

function toggleModal() {
    let modal = document.getElementById('cc-cart-modal');
    if (cartOpen && modal) {
        modal.remove();
        cartOpen = false;
    } else {
        modal = document.createElement('div');
        modal.id = 'cc-cart-modal';
        modal.className = 'cc-cart-modal';
        document.body.appendChild(modal);
        cartOpen = true;
        renderUI();
    }
}

function renderModalContents(cart) {
    const modal = document.getElementById('cc-cart-modal');
    if (!modal) return;

    let itemsHTML = cart.map(item => `
        <div class="cc-cart-item" data-id="${item.id}">
            <div class="cc-item-remove" data-id="${item.id}">✕</div>
            <div class="cc-item-source">${item.title}</div>
            <div class="cc-item-text">${item.content.replace(/</g, '&lt;')}</div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div class="cc-cart-header">
            <span>Context Cart</span>
            <span style="cursor:pointer" onclick="document.getElementById('cc-cart-btn').click()">_</span>
        </div>
        <div class="cc-cart-items">${itemsHTML}</div>
        <div class="cc-cart-footer">
            <button class="cc-send-btn" id="cc-send-all">✨ Send All to Local Memory</button>
        </div>
    `;

    // Tooltip rendering logic
    let tooltip = document.getElementById('cc-cart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'cc-cart-tooltip';
        tooltip.className = 'cc-cart-tooltip';
        document.body.appendChild(tooltip);
    }

    modal.querySelectorAll('.cc-cart-item').forEach(itemEl => {
        const itemId = itemEl.getAttribute('data-id');
        const itemData = cart.find(i => i.id === itemId);

        itemEl.addEventListener('mouseenter', () => {
            if (itemData.type === 'image') {
                tooltip.innerHTML = `<img src="${itemData.media}" alt="Preview" />`;
            } else {
                const safeText = itemData.content.replace(/</g, '&lt;');
                tooltip.innerHTML = safeText.length > 256
                    ? `${safeText.substring(0, 256)}<span style="color:#8ab4f8">...</span>`
                    : safeText;
            }

            const modalRect = modal.getBoundingClientRect();
            const itemRect = itemEl.getBoundingClientRect();
            tooltip.style.right = `${window.innerWidth - modalRect.left + 15}px`;

            let topPosition = itemRect.top;
            if (topPosition + 250 > window.innerHeight) topPosition = window.innerHeight - 260;

            tooltip.style.top = `${topPosition}px`;
            tooltip.classList.add('cc-tooltip-visible');
        });

        itemEl.addEventListener('mouseleave', () => tooltip.classList.remove('cc-tooltip-visible'));
    });

    // Event Listeners for UI interaction
    modal.querySelectorAll('.cc-item-remove').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const idToRemove = btn.getAttribute('data-id');
            const updatedCart = cart.filter(item => item.id !== idToRemove);
            tooltip.classList.remove('cc-tooltip-visible');
            chrome.storage.local.set({contextCart: updatedCart});
        };
    });

    modal.querySelector('#cc-send-all').onclick = (e) => {
        const btn = e.target;
        btn.innerText = "Sending...";
        btn.disabled = true;

        chrome.runtime.sendMessage({action: "ingest_batch", payload: cart}, (response) => {
            if (response?.success) {
                btn.innerText = "✓ Saved!";
                btn.style.background = "#006400";
                tooltip.classList.remove('cc-tooltip-visible');
                setTimeout(() => chrome.storage.local.set({contextCart: []}), 1000);
            } else {
                btn.innerText = "❌ Failed to send";
                btn.style.background = "#8B0000";
                btn.disabled = false;
            }
        });
    };
}


// ==========================================
// 6. COMMAND PALETTE UI
// ==========================================

function togglePalette() {
    let palette = document.getElementById('cc-palette');

    // Close logic
    if (paletteOpen && palette) {
        palette.remove();
        paletteOpen = false;
        stagedItems = [];
        if (activeInputElement) activeInputElement.focus();
        return;
    }

    // Capture cursor state before opening
    activeInputElement = document.activeElement;
    savedRange = null;
    savedInputState = null;

    if (activeInputElement) {
        if (activeInputElement.tagName === 'TEXTAREA' || activeInputElement.tagName === 'INPUT') {
            savedInputState = {start: activeInputElement.selectionStart, end: activeInputElement.selectionEnd};
        } else if (activeInputElement.isContentEditable) {
            const sel = window.getSelection();
            if (sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
        }
    }

    palette = document.createElement('div');
    palette.id = 'cc-palette';
    palette.className = 'cc-palette-overlay';
    palette.innerHTML = `
        <div class="cc-palette-container">
            <input type="text" id="cc-palette-input" placeholder="Search memory..." autocomplete="off" />
            <div class="cc-search-filters" id="cc-search-filters">
                <button class="cc-filter-btn active" data-time="all">Any time</button>
                <button class="cc-filter-btn" data-time="2h">Last 2 Hours</button>
                <button class="cc-filter-btn" data-time="today">Today</button>
                <button class="cc-filter-btn" data-time="yesterday">Yesterday</button>
            </div>
            <div id="cc-palette-results" class="cc-palette-results"></div>
            <div id="cc-staging-container" class="cc-staging-container" style="display: none;">
                <div class="cc-staging-header">Staged for Injection</div>
                <div id="cc-staging-list" class="cc-staging-list"></div>
                <button id="cc-inject-all-btn" class="cc-inject-all-btn">Paste Items</button>
            </div>
            <div class="cc-palette-hint">
                <span class="cc-hotkey-pill">Enter</span> Paste Top Result 
                <span class="cc-hotkey-pill">Tab</span> Add to Stage 
                <span class="cc-hotkey-pill" style="border-color:#8ab4f8; color:#8ab4f8">Shift + Enter</span> Paste All Results
            </div>
        </div>
    `;

    document.body.appendChild(palette);
    paletteOpen = true;

    const input = document.getElementById('cc-palette-input');
    const resultsContainer = document.getElementById('cc-palette-results');
    let timeout = null;
    input.focus();

    // -- Event Listeners --
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        currentQuery = e.target.value.trim();

        timeout = setTimeout(() => {
            currentOffset = 0;
            hasMore = true;
            currentResults = [];
            resultsContainer.innerHTML = '';
            if (currentQuery) fetchBatch();
        }, 300);
    });

    resultsContainer.addEventListener('scroll', () => {
        if (!isFetching && hasMore && resultsContainer.scrollTop + resultsContainer.clientHeight >= resultsContainer.scrollHeight - 20) {
            fetchBatch();
        }
    });
    activeInputElement = document.activeElement;
    savedRange = null;
    savedInputState = null;

    // NEW: Reset states so it doesn't get stuck on old filters if you close/reopen
    currentTimeFilter = 'all';
    currentQuery = '';

    // 1. Filter Click Listener
    document.getElementById('cc-search-filters').addEventListener('click', (e) => {
        if (e.target.classList.contains('cc-filter-btn')) {
            document.querySelectorAll('.cc-filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeFilter = e.target.getAttribute('data-time');

            // Re-trigger search instantly
            currentOffset = 0;
            hasMore = true;
            currentResults = [];
            resultsContainer.innerHTML = '';
            fetchBatch();
        }
    });

    // 2. Fetch Trigger Patch (Run instantly on load so timeline populates)
    fetchBatch();

    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        currentQuery = e.target.value; // Removed .trim() so they can empty it

        timeout = setTimeout(() => {
            currentOffset = 0;
            hasMore = true;
            currentResults = [];
            resultsContainer.innerHTML = '';
            fetchBatch(); // Always run fetchBatch, even if query is empty
        }, 300);
    });
    // Keyboard Navigation & Shortcuts
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') return togglePalette();

        if (e.key === 'Tab') {
            e.preventDefault();
            if (currentResults.length > 0) {
                addToStage(currentResults[0]);
                input.value = '';
                resultsContainer.innerHTML = '';
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();

            // Bulk Injection
            if (e.shiftKey) {
                if (currentResults.length > 0) injectContextsToAI([...currentResults]);
                return;
            }

            // Standard Injection
            if (stagedItems.length > 0) {
                injectContextsToAI([...stagedItems]);
                return;
            }

            if (!input.value.trim()) {
                input.placeholder = "Fetching latest...";
                try {
                    const res = await fetch(`${CONFIG.API_BASE}/latest?limit=1`);
                    const data = await res.json();
                    if (data.results?.length) injectContextsToAI([data.results[0]]);
                } catch (err) {
                    input.placeholder = "Error fetching latest.";
                }
            } else if (currentResults.length > 0) {
                injectContextsToAI([currentResults[0]]);
            }
        }
    });

    document.getElementById('cc-inject-all-btn').addEventListener('click', () => {
        if (stagedItems.length > 0) injectContextsToAI([...stagedItems]);
    });

    palette.addEventListener('click', (e) => {
        if (e.target.id === 'cc-palette') togglePalette();
    });
}

// ==========================================
// 7. PALETTE DATA FETCHING & RENDERING
// ==========================================

async function fetchBatch() {
    if (isFetching || !hasMore) return;
    isFetching = true;

    const container = document.getElementById('cc-palette-results');
    let spinner = document.getElementById('cc-search-spinner');

    if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'cc-loading-spinner';
        spinner.id = 'cc-search-spinner';
        spinner.innerText = 'Loading memories...';
        container.appendChild(spinner);
    }

    try {
        // Grabs your browser's exact timezone offset (EEST)
        const tzOffset = new Date().getTimezoneOffset();

        const url = `${CONFIG.API_BASE}/search?q=${encodeURIComponent(currentQuery.trim())}&limit=${CONFIG.BATCH_SIZE}&offset=${currentOffset}&time_filter=${currentTimeFilter}&tz_offset=${tzOffset}`;

        const res = await fetch(url);
        const data = await res.json();
        const fetchedResults = data.results || [];

        document.getElementById('cc-search-spinner')?.remove();

        const uniqueNewResults = fetchedResults.filter(newRes =>
            !currentResults.some(existingRes => existingRes.content === newRes.content)
        );

        currentOffset += CONFIG.BATCH_SIZE;

        if (fetchedResults.length < CONFIG.BATCH_SIZE || (fetchedResults.length > 0 && uniqueNewResults.length === 0)) {
            hasMore = false;
        }

        if (currentResults.length === 0 && uniqueNewResults.length === 0) {
            container.innerHTML = '<div class="cc-palette-empty">No closely matching memories found.</div>';
        } else if (uniqueNewResults.length > 0) {
            const startIndex = currentResults.length;
            currentResults.push(...uniqueNewResults);
            appendResultsToDOM(uniqueNewResults, startIndex);
        }

        if (!hasMore && currentResults.length > 0 && !document.querySelector('.cc-end-of-results')) {
            const endMsg = document.createElement('div');
            endMsg.className = 'cc-end-of-results';
            endMsg.innerText = 'No more results available in context db';
            container.appendChild(endMsg);
        }
    } catch (err) {
        console.error(err);
        document.getElementById('cc-search-spinner')?.remove();
        if (currentResults.length === 0) {
            container.innerHTML = '<div class="cc-palette-error">Local server disconnected.</div>';
        }
    }

    isFetching = false;
}

function appendResultsToDOM(newResults, startIndex) {
    const container = document.getElementById('cc-palette-results');

    const html = newResults.map((r, i) => {
        const hasImage = r.content.includes('[Local Image Path:');
        const cleanPreview = r.content.replace(/\[Local Image Path:.*?\]/g, '').trim();
        const displayTitle = truncateTitle(r.title);
        const displayDate = formatDateTime(r.created_at || r.timestamp);
        const safeTooltipText = (r.title || '').replace(/"/g, '&quot;');

        const badgeHTML = hasImage
            ? `<span class="cc-badge cc-badge-image">🖼️ Image</span>`
            : `<span class="cc-badge cc-badge-text">📝 Text</span>`;

        return `
            <div class="cc-palette-item" data-index="${startIndex + i}">
                <button class="cc-add-to-stage-btn" title="Add to bundle (Tab)">+</button>
                <div class="cc-item-clickable">
                    <div class="cc-palette-title-row">
                        <div class="cc-palette-title" title="${safeTooltipText}">${displayTitle}</div>
                        <div class="cc-item-meta">
                            ${badgeHTML}
                            <span class="cc-item-time">${displayDate}</span>
                        </div>
                    </div>
                    <div class="cc-palette-preview">${cleanPreview.substring(0, 100)}...</div>
                </div>
            </div>
        `;
    }).join('');

    container.insertAdjacentHTML('beforeend', html);

    const allItems = container.querySelectorAll('.cc-palette-item');
    for (let i = startIndex; i < allItems.length; i++) {
        const item = allItems[i];
        const data = currentResults[i];

        item.querySelector('.cc-item-clickable').addEventListener('click', () => {
            stagedItems.length > 0 ? addToStage(data) : injectContextsToAI([data]);
        });

        item.querySelector('.cc-add-to-stage-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            addToStage(data);
        });
    }
}


// ==========================================
// 8. STAGING & DRAG AND DROP
// ==========================================

function addToStage(data) {
    if (!stagedItems.some(i => i.content === data.content)) {
        stagedItems.push(data);
        renderStagingArea();
    }
}

function renderStagingArea() {
    const container = document.getElementById('cc-staging-container');
    const list = document.getElementById('cc-staging-list');
    const btn = document.getElementById('cc-inject-all-btn');

    if (stagedItems.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    btn.innerText = `✨ Paste ${stagedItems.length} Item${stagedItems.length > 1 ? 's' : ''} (Enter)`;

    list.innerHTML = stagedItems.map((item, index) => {
        let cleanText = item.content.replace(/\[Local Image Path:.*?\]/g, '').trim();
        if (cleanText.length > 60) cleanText = `${cleanText.substring(0, 60)}...`;

        return `
            <div class="cc-staged-item" draggable="true" data-index="${index}">
                <div class="cc-staged-drag-handle">⠿</div>
                <div class="cc-staged-text" style="pointer-events:none">
                    <span class="cc-staged-title">${item.title}</span>
                    <span class="cc-staged-preview"> — ${cleanText}</span>
                </div>
                <span class="cc-staged-remove" data-index="${index}" style="cursor:pointer;" title="Remove">✕</span>
            </div>
        `;
    }).join('');

    // Remove Listeners
    list.querySelectorAll('.cc-staged-remove').forEach(rm => {
        rm.addEventListener('click', (e) => {
            stagedItems.splice(parseInt(e.target.getAttribute('data-index')), 1);
            renderStagingArea();
        });
    });

    // Drag and Drop Logic
    let dragStartIndex;
    list.querySelectorAll('.cc-staged-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragStartIndex = parseInt(e.target.getAttribute('data-index'));
            e.target.classList.add('dragging');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        });

        item.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('drag-over'));

        item.addEventListener('drop', (e) => {
            e.currentTarget.classList.remove('drag-over');
            const dragEndIndex = parseInt(e.currentTarget.getAttribute('data-index'));

            const draggedItem = stagedItems[dragStartIndex];
            stagedItems.splice(dragStartIndex, 1);
            stagedItems.splice(dragEndIndex, 0, draggedItem);
            renderStagingArea();
        });

        item.addEventListener('dragend', (e) => {
            e.target.classList.remove('dragging');
            list.querySelectorAll('.cc-staged-item').forEach(el => el.classList.remove('drag-over'));
        });
    });
}


// ==========================================
// 9. INJECTION ENGINE (Dual-Payload Bypass)
// ==========================================

async function injectContextsToAI(dataArray) {
    if (!dataArray || dataArray.length === 0) return;

    const originalPlaceholder = activeInputElement ? activeInputElement.placeholder : "";
    if (activeInputElement) activeInputElement.placeholder = `Injecting ${dataArray.length} items. Please wait...`;

    togglePalette();

    if (!activeInputElement) return;

    // Restore exact cursor position
    try {
        if (activeInputElement.tagName === 'TEXTAREA' || activeInputElement.tagName === 'INPUT') {
            if (savedInputState) activeInputElement.setSelectionRange(savedInputState.start, savedInputState.end);
        } else if (activeInputElement.isContentEditable) {
            if (savedRange) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange);
            }
        }
    } catch (e) {
        console.warn("[Context Clipboard] Cursor restore failed:", e);
    }

    const imgRegex = /\[Local Image Path:\s*(.*?)\]/g;
    let combinedText = "";
    const filesToPaste = [];
    const imagePromises = [];

    // Compile Text & Queue Images
    dataArray.forEach((data, i) => {
        const cleanText = (data.content || "").replace(imgRegex, '').trim();
        combinedText += `\n--- Context ${i + 1}: ${data.title || 'Untitled'} ---\n${cleanText}\n`;

        const matches = [...(data.content || "").matchAll(imgRegex)];
        matches.forEach(match => {
            if (match && match[1]) {
                const imgPromise = fetch(`${CONFIG.API_BASE}/image?path=${encodeURIComponent(match[1])}`)
                    .then(res => res.ok ? res.blob() : null)
                    .then(blob => {
                        if (blob) filesToPaste.push(new File([blob], `context_img_${i}_${Date.now()}.png`, {type: blob.type}));
                    })
                    .catch(err => console.error("Image fetch error:", err));
                imagePromises.push(imgPromise);
            }
        });
    });

    combinedText = combinedText.trim();
    if (imagePromises.length > 0) await Promise.all(imagePromises);

    // PASTE EVENT 1: TEXT ONLY
    const dtText = new DataTransfer();
    dtText.setData('text/plain', combinedText);
    const safeHtml = combinedText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    dtText.setData('text/html', `<div>${safeHtml}</div>`);

    const pasteEventText = new ClipboardEvent('paste', {
        clipboardData: dtText,
        bubbles: true,
        cancelable: true
    });
    activeInputElement.dispatchEvent(pasteEventText);

    // PASTE EVENT 2: IMAGES ONLY (Delayed to prevent Editor UI lockup)
    setTimeout(() => {
        const currentBoxContent = activeInputElement.value || activeInputElement.innerText || "";
        const uniqueSnippet = combinedText.substring(0, 30);

        // Text Fallback check if native event was rejected
        if (!currentBoxContent.includes(uniqueSnippet)) {
            console.warn("[Context Clipboard] Native text paste rejected, falling back to execCommand.");
            document.execCommand('insertText', false, combinedText);
        }

        // Fire Image Paste
        if (filesToPaste.length > 0) {
            const dtImages = new DataTransfer();
            filesToPaste.forEach(file => dtImages.items.add(file));

            const pasteEventImages = new ClipboardEvent('paste', {
                clipboardData: dtImages,
                bubbles: true,
                cancelable: true
            });
            activeInputElement.dispatchEvent(pasteEventImages);
        }

        if (activeInputElement) activeInputElement.placeholder = originalPlaceholder;

    }, 150);
}

// Run setup on load
renderUI();