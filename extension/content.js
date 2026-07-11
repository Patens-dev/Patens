console.log("[Context Clipboard] Shopping Cart initialized.");

const validTags = ['P', 'PRE', 'BLOCKQUOTE', 'LI', 'CODE', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'IMG'];
let cartOpen = false; // Removed the broken isCtrlHeld variable!

// Extremely fast hashing function (DJB2)
function fastHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash >>> 0; // Force positive integer representation
}

// Spawns a tiny floating div near the cursor
function showDuplicateWarning(x, y) {
    const warning = document.createElement('div');
    warning.className = 'cc-duplicate-warning';
    warning.innerText = "Already in cart";
    warning.style.left = `${x + 15}px`;
    warning.style.top = `${y + 15}px`;
    document.body.appendChild(warning);

    setTimeout(() => {
        warning.classList.add('cc-duplicate-fade');
        setTimeout(() => warning.remove(), 300);
    }, 1200);
}

// Add this helper function at the top of your script
function findUnderlyingImage(targetElement) {
    if (!targetElement || targetElement.nodeType !== Node.ELEMENT_NODE) return null;

    if (targetElement.tagName === 'IMG') return targetElement;

    const nestedImg = targetElement.querySelector('img');
    if (nestedImg) return nestedImg;

    const parent = targetElement.parentElement;
    if (parent) {
        const siblingImages = parent.querySelectorAll('img');
        if (siblingImages.length === 1) return siblingImages[0];
    }

    const wrapper = targetElement.closest('a, picture, figure');
    if (wrapper) {
        const wrappedImg = wrapper.querySelector('img');
        if (wrappedImg) return wrappedImg;
    }

    return null;
}

// Helper: Converts images to Base64 strings safely
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
        console.warn("CORS blocked fetch, using Canvas fallback...");
        const canvas = document.createElement("canvas");
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgElement, 0, 0);
        return canvas.toDataURL("image/png");
    }
}

// --------------------------------------------------------
// THE HYPERLINK SHIELD (Updated for Ctrl+Shift+Click)
// --------------------------------------------------------
document.body.addEventListener('click', (e) => {
    // Only intercept if BOTH Ctrl and Shift are held down
    if (e.ctrlKey && e.shiftKey) {
        const isLink = e.target.closest('a');
        const isValidTag = validTags.includes(e.target.tagName) || e.target.closest(validTags.join(','));

        if (isLink || isValidTag) {
            e.preventDefault();
            e.stopPropagation();
            console.log("[Context Clipboard] Captured context via Ctrl+Shift+Click.");
        }
    }
}, true);


// --------------------------------------------------------
// HOVER EFFECTS (Now requires Ctrl + Shift)
// --------------------------------------------------------
document.body.addEventListener('mousedown', async (e) => {
    if (e.target.closest('.cc-cart-btn') || e.target.closest('.cc-cart-modal') || e.target.id === 'cc-search-overlay') return;

    const isShortcutPressed = e.ctrlKey && e.shiftKey;

    if (isShortcutPressed && e.target && validTags.includes(e.target.tagName)) {
        e.preventDefault();
        e.stopPropagation();

        let selectedText = "";
        let isImage = false;
        let base64Data = null;

        const textSelection = window.getSelection().toString().trim();
        const targetImg = findUnderlyingImage(e.target);

        if (targetImg && textSelection === "") {
            isImage = true;
            selectedText = targetImg.alt || targetImg.title || "Image snippet from " + document.title;
            base64Data = await getBase64Image(targetImg);
        } else {
            selectedText = textSelection || e.target.innerText;
        }

        if (!selectedText && !isImage) return;

        // 1. Generate a unique hash for the content
        const contentToHash = isImage ? base64Data : selectedText;
        const itemHash = fastHash(contentToHash).toString();

        // 2. Fetch cart and check for duplicates BEFORE showing visual feedback
        chrome.storage.local.get(['contextCart'], (result) => {
            const cart = result.contextCart || [];

            // Check if hash already exists in cart
            if (cart.some(item => item.hash === itemHash)) {
                showDuplicateWarning(e.clientX, e.clientY);
                return; // Stop execution
            }

            // 3. Not a duplicate -> Apply visual flash
            if (isImage) {
                targetImg.classList.add('cc-added-flash');
                setTimeout(() => targetImg.classList.remove('cc-added-flash'), 600);
            } else {
                e.target.classList.remove('cc-highlight-hover');
                e.target.classList.add('cc-added-flash');
                setTimeout(() => e.target.classList.remove('cc-added-flash'), 600);
            }

            // 4. Save to cart
            const newItem = {
                id: Date.now().toString(),
                hash: itemHash,  // Save hash for future duplicate checks
                type: isImage ? 'image' : 'text',
                url: window.location.href,
                title: document.title,
                content: selectedText,
                media: base64Data
            };

            cart.push(newItem);
            chrome.storage.local.set({contextCart: cart});
        });
    }
}, true);
document.body.addEventListener('mouseover', (e) => {
    // Only highlight if both keys are held while moving the mouse
    if (e.ctrlKey && e.shiftKey && e.target && validTags.includes(e.target.tagName)) {
        e.target.classList.add('cc-highlight-hover');
    }
});
document.body.addEventListener('mouseout', (e) => {
    if (e.target && e.target.classList.contains('cc-highlight-hover')) {
        e.target.classList.remove('cc-highlight-hover');
    }
});

// --------------------------------------------------------
// UI RENDERING ENGINE (Cross-Tab Synced)
// --------------------------------------------------------

function renderUI() {
    chrome.storage.local.get(['contextCart'], (result) => {
        const cart = result.contextCart || [];

        // 1. Render/Update Floating Button
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
        } else if (btn) {
            btn.remove();
            if (cartOpen) toggleModal(); // Close modal if empty
        }

        // 2. Update Modal if Open
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
        renderUI(); // Populates the newly opened modal
    }
}

// --- UPDATED MODAL RENDERING (Replace your existing renderModalContents function) ---

function renderModalContents(cart) {
    const modal = document.getElementById('cc-cart-modal');
    if (!modal) return;

    let itemsHTML = cart.map(item => `
    <div class="cc-cart-item" data-id="${item.id}">
      <div class="cc-item-remove" data-id="${item.id}">✕</div>
      <div class="cc-item-source">${item.title}</div>
      <div class="cc-item-text">${item.content}</div>
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

    // 1. Tooltip Setup
    let tooltip = document.getElementById('cc-cart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'cc-cart-tooltip';
        tooltip.className = 'cc-cart-tooltip';
        document.body.appendChild(tooltip);
    }

    // 2. Attach Hover Listeners for Preview
    modal.querySelectorAll('.cc-cart-item').forEach(itemEl => {
        const itemId = itemEl.getAttribute('data-id');
        const itemData = cart.find(i => i.id === itemId);

        itemEl.addEventListener('mouseenter', () => {
            if (itemData.type === 'image') {
                tooltip.innerHTML = `<img src="${itemData.media}" alt="Preview" />`;
            } else {
                // Truncate at 256 characters for clean rendering
                const text = itemData.content.length > 256
                    ? itemData.content.substring(0, 256) + '<span style="color:#8ab4f8">...</span>'
                    : itemData.content;
                tooltip.innerHTML = text;
            }

            // Position tooltip to the left of the modal
            const modalRect = modal.getBoundingClientRect();
            const itemRect = itemEl.getBoundingClientRect();

            tooltip.style.right = `${window.innerWidth - modalRect.left + 15}px`;

            // Try to align with the item, but prevent it from going off the bottom of the screen
            let topPosition = itemRect.top;
            if (topPosition + 250 > window.innerHeight) {
                topPosition = window.innerHeight - 260; // clamp
            }
            tooltip.style.top = `${topPosition}px`;
            tooltip.classList.add('cc-tooltip-visible');
        });

        itemEl.addEventListener('mouseleave', () => {
            tooltip.classList.remove('cc-tooltip-visible');
        });
    });

    // 3. Attach Delete Listeners
    modal.querySelectorAll('.cc-item-remove').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation(); // Prevent triggering other clicks
            const idToRemove = btn.getAttribute('data-id');
            const updatedCart = cart.filter(item => item.id !== idToRemove);
            tooltip.classList.remove('cc-tooltip-visible'); // Hide tooltip if deleting
            chrome.storage.local.set({contextCart: updatedCart});
        };
    });

    // 4. Attach Send Logic
    modal.querySelector('#cc-send-all').onclick = (e) => {
        const btn = e.target;
        btn.innerText = "Sending...";
        btn.disabled = true;

        chrome.runtime.sendMessage({action: "ingest_batch", payload: cart}, (response) => {
            if (response && response.success) {
                btn.innerText = "✓ Saved!";
                btn.style.background = "#006400";
                tooltip.classList.remove('cc-tooltip-visible');
                setTimeout(() => {
                    chrome.storage.local.set({contextCart: []});
                }, 1000);
            } else {
                btn.innerText = "❌ Failed to send";
                btn.style.background = "#8B0000";
                btn.disabled = false;
            }
        });
    };
}

// --------------------------------------------------------
// COMMAND PALETTE (Search, Multi-Select, Infinite Scroll)
// --------------------------------------------------------
let paletteOpen = false;
let activeInputElement = null;
let stagedItems = [];
let currentResults = []; // Global cache for keyboard navigation

// Infinite Scroll State
let currentQuery = '';
let currentOffset = 0;
let isFetching = false;
let hasMore = true;
const BATCH_SIZE = 10;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "open_palette") togglePalette();
});

function togglePalette() {
    let palette = document.getElementById('cc-palette');

    if (paletteOpen && palette) {
        palette.remove();
        paletteOpen = false;
        stagedItems = [];
        if (activeInputElement) activeInputElement.focus();
        return;
    }

    activeInputElement = document.activeElement;

    palette = document.createElement('div');
    palette.id = 'cc-palette';
    palette.className = 'cc-palette-overlay';

    palette.innerHTML = `
        <div class="cc-palette-container">
            <input type="text" id="cc-palette-input" placeholder="Search memory... (Enter to paste, Tab to stage)" autocomplete="off" />
            <div id="cc-palette-results" class="cc-palette-results"></div>
            <div id="cc-staging-container" class="cc-staging-container" style="display: none;">
                <div class="cc-staging-header">Staged for Injection</div>
                <div id="cc-staging-list" class="cc-staging-list"></div>
                <button id="cc-inject-all-btn" class="cc-inject-all-btn">Paste Items</button>
            </div>
        </div>
    `;

    document.body.appendChild(palette);
    paletteOpen = true;

    const input = document.getElementById('cc-palette-input');
    const resultsContainer = document.getElementById('cc-palette-results');

    input.focus();
    let timeout = null;

    // 1. Core Search Input Listener
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        currentQuery = e.target.value.trim();

        timeout = setTimeout(() => {
            // Reset infinite scroll state on new query
            currentOffset = 0;
            hasMore = true;
            currentResults = [];
            resultsContainer.innerHTML = '';

            if (!currentQuery) return;
            fetchBatch();
        }, 300);
    });

// 2. Infinite Scroll Event Listener (Now guarded against spam)
    resultsContainer.addEventListener('scroll', () => {
        // Only check if we are NOT currently fetching, and we STILL have more items
        if (!isFetching && hasMore && resultsContainer.scrollTop + resultsContainer.clientHeight >= resultsContainer.scrollHeight - 20) {
            fetchBatch();
        }
    });

    // Keyboard Navigation
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') togglePalette();

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
            if (stagedItems.length > 0) {
                injectContextsToAI(stagedItems);
                return;
            }
            if (!input.value.trim()) {
                input.placeholder = "Fetching latest...";
                try {
                    const res = await fetch(`http://localhost:8000/latest?limit=1`);
                    const data = await res.json();
                    if (data.results && data.results.length > 0) injectContextsToAI([data.results[0]]);
                } catch (err) {
                    input.placeholder = "Error fetching latest.";
                }
            } else if (currentResults.length > 0) {
                injectContextsToAI([currentResults[0]]);
            }
        }
    });

    document.getElementById('cc-inject-all-btn').addEventListener('click', () => {
        if (stagedItems.length > 0) injectContextsToAI(stagedItems);
    });

    palette.addEventListener('click', (e) => {
        if (e.target.id === 'cc-palette') togglePalette();
    });
}

// 3. The Fetch Engine
// 3. The Fetch Engine (Patched for the infinite loop)
async function fetchBatch() {
    if (isFetching || !hasMore) return;
    isFetching = true;

    const container = document.getElementById('cc-palette-results');

    // Add loading spinner securely
    let spinner = document.getElementById('cc-search-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'cc-loading-spinner';
        spinner.id = 'cc-search-spinner';
        spinner.innerText = 'Loading memories...';
        container.appendChild(spinner);
    }

    try {
        const res = await fetch(`http://localhost:8000/search?q=${encodeURIComponent(currentQuery)}&limit=${BATCH_SIZE}&offset=${currentOffset}`);
        const data = await res.json();
        const fetchedResults = data.results || [];

        // Remove spinner
        spinner = document.getElementById('cc-search-spinner');
        if (spinner) spinner.remove();

        // STRICT DEDUPLICATION
        const uniqueNewResults = fetchedResults.filter(newRes =>
            !currentResults.some(existingRes => existingRes.content === newRes.content)
        );

        // Always advance the offset
        currentOffset += BATCH_SIZE;

        // THE FIX: If the DB is exhausted, OR if the DB just fed us a full page of duplicates, stop the loop.
        if (fetchedResults.length < BATCH_SIZE || (fetchedResults.length > 0 && uniqueNewResults.length === 0)) {
            hasMore = false;
        }

        // Render Logic
        if (currentResults.length === 0 && uniqueNewResults.length === 0) {
            container.innerHTML = '<div class="cc-palette-empty">No closely matching memories found.</div>';
        } else if (uniqueNewResults.length > 0) {
            const startIndex = currentResults.length;
            currentResults.push(...uniqueNewResults);
            appendResultsToDOM(uniqueNewResults, startIndex);
        }

        // Add the "No more results" text securely (Check if it already exists first!)
        if (!hasMore && currentResults.length > 0) {
            if (!document.querySelector('.cc-end-of-results')) {
                const endMsg = document.createElement('div');
                endMsg.className = 'cc-end-of-results';
                endMsg.innerText = 'No more results available in context db';
                container.appendChild(endMsg);
            }
        }

    } catch (err) {
        console.error(err);
        spinner = document.getElementById('cc-search-spinner');
        if (spinner) spinner.remove();
        if (currentResults.length === 0) {
            container.innerHTML = '<div class="cc-palette-error">Local server disconnected.</div>';
        }
    }

    isFetching = false;
}

// 4. DOM Appender (Smooth injection without rebuilding HTML)
function appendResultsToDOM(newResults, startIndex) {
    const container = document.getElementById('cc-palette-results');

    const html = newResults.map((r, i) => {
        const hasImage = r.content.includes('[Local Image Path:');
        const cleanPreview = r.content.replace(/\[Local Image Path:.*?\]/g, '').trim();
        const badgeHTML = hasImage
            ? `<span class="cc-badge cc-badge-image">🖼️ Image</span>`
            : `<span class="cc-badge cc-badge-text">📝 Text</span>`;

        // Map the button to the global cache index
        const globalIndex = startIndex + i;

        return `
            <div class="cc-palette-item" data-index="${globalIndex}">
                <button class="cc-add-to-stage-btn" title="Add to bundle (Tab)">+</button>
                <div class="cc-item-clickable">
                    <div class="cc-palette-title-row">
                        <div class="cc-palette-title">${r.title}</div>
                        ${badgeHTML}
                    </div>
                    <div class="cc-palette-preview">${cleanPreview.substring(0, 100)}...</div>
                </div>
            </div>
        `;
    }).join('');

    // Safely append to the bottom of the list without breaking scroll state
    container.insertAdjacentHTML('beforeend', html);

    // Attach event listeners only to the newly added elements
    const allItems = container.querySelectorAll('.cc-palette-item');
    for (let i = startIndex; i < allItems.length; i++) {
        const item = allItems[i];
        const data = currentResults[i];

        item.querySelector('.cc-item-clickable').addEventListener('click', () => {
            if (stagedItems.length > 0) addToStage(data);
            else injectContextsToAI([data]);
        });

        item.querySelector('.cc-add-to-stage-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            addToStage(data);
        });
    }
}

// --- STAGING & DRAG AND DROP LOGIC ---

function addToStage(data) {
    // Prevent duplicates in staging
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
        // Strip the image path so the user only sees clean text
        const cleanText = item.content.replace(/\[Local Image Path:.*?\]/g, '').trim();

        return `
        <div class="cc-staged-item" draggable="true" data-index="${index}">
            <div class="cc-staged-text" style="pointer-events:none">
                <span class="cc-staged-title">≡ ${item.title}</span>
                <span class="cc-staged-preview"> — ${cleanText}</span>
            </div>
            <span class="cc-staged-remove" data-index="${index}">✕</span>
        </div>
        `;
    }).join('');

    // Remove logic
    list.querySelectorAll('.cc-staged-remove').forEach(rm => {
        rm.addEventListener('click', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            stagedItems.splice(idx, 1);
            renderStagingArea();
        });
    });

    // HTML5 Drag and Drop logic for reordering
    let dragStartIndex;

    list.querySelectorAll('.cc-staged-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragStartIndex = parseInt(e.target.getAttribute('data-index'));
            e.target.classList.add('dragging');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        item.addEventListener('drop', (e) => {
            const dragEndIndex = parseInt(e.currentTarget.getAttribute('data-index'));

            const draggedItem = stagedItems[dragStartIndex];
            stagedItems.splice(dragStartIndex, 1);
            stagedItems.splice(dragEndIndex, 0, draggedItem);

            renderStagingArea();
        });

        item.addEventListener('dragend', (e) => {
            e.target.classList.remove('dragging');
        });
    });
}

// --- MULTI-INJECTION ENGINE ---

async function injectContextsToAI(dataArray) {
    if (dataArray.length === 0) return;
    togglePalette(); // Close UI

    if (!activeInputElement) return;
    activeInputElement.focus();

    const imgRegex = /\[Local Image Path:\s*(.*?)\]/;
    let combinedText = "";
    const dt = new DataTransfer();
    let hasImages = false;

    // Loop through in exact order and compile text/images
    for (let i = 0; i < dataArray.length; i++) {
        const data = dataArray[i];
        const match = data.content.match(imgRegex);
        const cleanText = data.content.replace(imgRegex, '').trim();

        combinedText += `\n--- Context ${i + 1}: ${data.title} ---\n${cleanText}\n`;

        // If it's an image, fetch it and append to our Payload
        if (match && match[1]) {
            try {
                const res = await fetch(`http://localhost:8000/image?path=${encodeURIComponent(match[1])}`);
                if (res.ok) {
                    const blob = await res.blob();
                    const file = new File([blob], `context_image_${i}.png`, {type: blob.type});
                    dt.items.add(file);
                    hasImages = true;
                }
            } catch (err) {
                console.error("Failed to fetch image for injection:", err);
            }
        }
    }

    // 1. Paste the concatenated text
    document.execCommand('insertText', false, combinedText.trim());

    // 2. Fire the unified Image payload event
    if (hasImages) {
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
        });
        activeInputElement.dispatchEvent(pasteEvent);
    }
}

// --- DYNAMIC HOTKEY STATE ---
let currentHotkeys = {
    capture: {ctrl: true, shift: true, alt: false, meta: false},
    palette: {ctrl: true, shift: true, alt: false, meta: false, key: " "}
};

// Listen for updates from background.js
chrome.storage.local.get(['hotkeys'], (res) => {
    if (res.hotkeys) currentHotkeys = res.hotkeys;
});
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.hotkeys) {
        currentHotkeys = changes.hotkeys.newValue;
    }
});

// Helper to check if the exact modifiers are pressed
function checkModifiers(e, configObj) {
    return (e.ctrlKey === configObj.ctrl) &&
        (e.shiftKey === configObj.shift) &&
        (e.altKey === configObj.alt) &&
        (e.metaKey === configObj.meta);
}

// --------------------------------------------------------
// THE SYNCHRONIZATION HOOK
// --------------------------------------------------------
// Listen for changes to Chrome storage (triggered by ANY open tab)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.contextCart) {
        renderUI();
    }
});
// Listen for the custom Search Palette hotkey
document.addEventListener('keydown', (e) => {
    const pal = currentHotkeys.palette;
    if (checkModifiers(e, pal) && e.key.toLowerCase() === pal.key.toLowerCase()) {
        e.preventDefault();
        e.stopPropagation();
        togglePalette();
    }
});

// Initialize on page load
renderUI();