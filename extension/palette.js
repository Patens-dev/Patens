// ==========================================
// 4. COMMAND PALETTE UI & KEYBOARD NAV
// ==========================================

let blockHover = false;
let hoverTimeout = null;

function previewPaletteItem(index) {
    if (index < 0 || index>= currentResults.length) return;
    const previewPanel = document.getElementById('cc-preview-panel');
    if (!previewPanel) return;

    const data = currentResults[index];
    let domain = "";
    try { domain = new URL(data.url).hostname; } catch(e){}
    const displayDate = formatDateTime(data.created_at || data.timestamp);

    // Clear panel safely
    previewPanel.textContent = '';

    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = "font-size: 11px; color: #8ab4f8; margin-bottom: 8px;";

    const link = document.createElement('a');
    link.href = data.url;
    link.target = "_blank";
    link.style.cssText = "color:inherit; text-decoration:none;";
    link.textContent = `🔗 ${domain}`;

    metaDiv.appendChild(link);
    metaDiv.appendChild(document.createTextNode(` • ${displayDate}`));

    const h3 = document.createElement('h3');
    h3.style.cssText = "margin: 0 0 16px 0; font-size: 16px; color: #fff; line-height: 1.3;";
    h3.textContent = data.title; // Automatically sanitizes

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = "white-space: pre-wrap; font-family: monospace; font-size: 13px; color: #ccc; line-height: 1.5;";
    contentDiv.textContent = data.content || ''; // Automatically sanitizes

    previewPanel.appendChild(metaDiv);
    previewPanel.appendChild(h3);
    previewPanel.appendChild(contentDiv);
}

function applySelectionStyles() {
    const listContainer = document.getElementById('cc-results-list');
    if (!listContainer) return;

    listContainer.querySelectorAll('.cc-palette-item').forEach(el => {
        const idx = parseInt(el.getAttribute('data-index'));
        if (selectedIndices.has(idx)) {
            el.style.backgroundColor = '#333333';
            el.style.boxShadow = 'inset 3px 0 0 #8ab4f8';

            // MANUAL SCROLL MATH (Bypasses buggy flexbox scrollIntoView)
            if (idx === selectedIndex) {
                if (idx === 0) {
                    listContainer.scrollTop = 0;
                } else {
                    const containerRect = listContainer.getBoundingClientRect();
                    const elRect = el.getBoundingClientRect();

                    if (elRect.bottom > containerRect.bottom) {
                        listContainer.scrollTop += (elRect.bottom - containerRect.bottom + 8);
                    } else if (elRect.top < containerRect.top) {
                        listContainer.scrollTop -= (containerRect.top - elRect.top + 8);
                    }
                }
            }
        } else {
            el.style.backgroundColor = 'transparent';
            el.style.boxShadow = 'none';
        }
    });
}

function selectPaletteItem(index, shiftKey = false) {
    if (index < 0 || index >= currentResults.length) return;

    if (!shiftKey) {
        selectionAnchor = index;
        selectedIndices = new Set([index]);
    } else {
        selectedIndices = new Set();
        const start = Math.min(selectionAnchor, index);
        const end = Math.max(selectionAnchor, index);
        for (let i = start; i <= end; i++) {
            selectedIndices.add(i);
        }
    }

    selectedIndex = index;
    previewPaletteItem(index);
    applySelectionStyles();
}

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
    savedRange = null; savedInputState = null;
    selectedIndex = 0; selectionAnchor = 0; selectedIndices = new Set([0]);

    if (activeInputElement) {
        if (activeInputElement.tagName === 'TEXTAREA' || activeInputElement.tagName === 'INPUT') {
            savedInputState = {start: activeInputElement.selectionStart, end: activeInputElement.selectionEnd};
        } else if (activeInputElement.isContentEditable) {
            const sel = window.getSelection();
            if (sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
        }
    }

    // Safely Construct the entire DOM tree without innerHTML
    palette = document.createElement('div');
    palette.id = 'cc-palette';
    palette.className = 'cc-palette-overlay';
    palette.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; z-index: 2147483647; background-color: rgba(0, 0, 0, 0.6);';

    const container = document.createElement('div');
    container.className = 'cc-palette-container';
    container.style.cssText = 'position: relative; width: 850px; max-width: 90vw; height: 75vh; max-height: 700px; background: #222; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); font-family: sans-serif; box-sizing: border-box;';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'cc-palette-input';
    input.placeholder = "Search memory... (try 'github, yesterday' or 'from:docs.com')";
    input.autocomplete = 'off';
    input.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 55px; padding: 0 20px; border: none; background: transparent; color: white; font-size: 16px; outline: none; border-bottom: 1px solid #333; box-sizing: border-box; z-index: 5;';

    const resultsWrapper = document.createElement('div');
    resultsWrapper.id = 'cc-palette-results';
    resultsWrapper.style.cssText = 'position: absolute; top: 55px; bottom: 45px; left: 0; width: 100%; display: flex; background: #222; z-index: 1;';

    const listContainer = document.createElement('div');
    listContainer.id = 'cc-results-list';
    listContainer.style.cssText = 'width: 40%; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 8px; border-right: 1px solid #333; box-sizing: border-box;';

    const previewPanel = document.createElement('div');
    previewPanel.id = 'cc-preview-panel';
    previewPanel.style.cssText = 'width: 60%; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 20px; background: #1a1a1a; word-wrap: break-word; box-sizing: border-box;';

    const previewPlaceholder = document.createElement('div');
    previewPlaceholder.style.cssText = 'color: #666; text-align: center; margin-top: 80px;';
    previewPlaceholder.textContent = 'Select an item to preview';
    previewPanel.appendChild(previewPlaceholder);

    resultsWrapper.appendChild(listContainer);
    resultsWrapper.appendChild(previewPanel);

    const stagingContainer = document.createElement('div');
    stagingContainer.id = 'cc-staging-container';
    stagingContainer.style.cssText = 'display: none; position: absolute; bottom: 45px; left: 0; width: 100%; height: 200px; border-top: 1px solid #444; padding: 12px 20px; box-sizing: border-box; background: #222; flex-direction: column; z-index: 10;';

    const stagingLabel = document.createElement('div');
    stagingLabel.style.cssText = 'font-size: 11px; color: #888; margin-bottom: 8px; text-transform: uppercase; font-weight: bold; flex-shrink: 0;';
    stagingLabel.textContent = 'Staged for Injection';

    const stagingList = document.createElement('div');
    stagingList.id = 'cc-staging-list';
    stagingList.style.cssText = 'flex-grow: 1; overflow-y: auto; padding-right: 5px;';

    const injectBtn = document.createElement('button');
    injectBtn.id = 'cc-inject-all-btn';
    injectBtn.style.cssText = 'flex-shrink: 0; margin-top: 10px; padding: 10px; background: #8ab4f8; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;';
    injectBtn.textContent = 'Paste Items';

    stagingContainer.appendChild(stagingLabel);
    stagingContainer.appendChild(stagingList);
    stagingContainer.appendChild(injectBtn);

    const hintContainer = document.createElement('div');
    hintContainer.id = 'cc-palette-hint';
    hintContainer.style.cssText = 'position: absolute; bottom: 0; left: 0; width: 100%; height: 45px; padding: 0 20px; font-size: 12px; color: #888; border-top: 1px solid #333; display: flex; gap: 16px; align-items: center; background: #1e1e1e; box-sizing: border-box; z-index: 5;';

    const hints = [
        { key: '↑↓', text: 'Navigate' },
        { key: 'Shift + ↑↓', text: 'Multi-Select' },
        { key: 'Enter', text: 'Paste' },
        { key: 'Tab', text: 'Stage' }
    ];

    hints.forEach(h => {
        const span = document.createElement('span');
        const keySpan = document.createElement('span');
        keySpan.style.cssText = 'border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;';
        keySpan.textContent = h.key;
        span.appendChild(keySpan);
        span.appendChild(document.createTextNode(' ' + h.text));
        hintContainer.appendChild(span);
    });

    container.appendChild(input);
    container.appendChild(resultsWrapper);
    container.appendChild(stagingContainer);
    container.appendChild(hintContainer);
    palette.appendChild(container);

    document.body.appendChild(palette);
    paletteOpen = true;

    let timeout = null;
    input.focus();

    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        currentQuery = e.target.value;

        timeout = setTimeout(() => {
            currentOffset = 0; hasMore = true; currentResults = [];
            selectedIndex = 0; selectionAnchor = 0; selectedIndices = new Set([0]);

            if (listContainer) listContainer.textContent = '';
            if (previewPanel) {
                previewPanel.textContent = '';
                const pText = document.createElement('div');
                pText.style.cssText = 'color: #666; text-align: center; margin-top: 80px;';
                pText.textContent = 'Select an item to preview';
                previewPanel.appendChild(pText);
            }

            fetchBatch();
        }, 200);
    });

    listContainer.addEventListener('scroll', () => {
        if (!isFetching && hasMore && listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 20) {
            fetchBatch();
        }
    });

    currentQuery = '';
    currentOffset = 0;
    hasMore = true;
    currentResults = [];
    fetchBatch();

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') return togglePalette();

        // Arrow Navigation with HOVER LOCK
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            blockHover = true;
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => blockHover = false, 150); // Release lock after moving

            if (e.key === 'ArrowDown') selectPaletteItem(selectedIndex + 1, e.shiftKey);
            if (e.key === 'ArrowUp') selectPaletteItem(selectedIndex - 1, e.shiftKey);
            return;
        }

        const stageAllConfig = currentHotkeys.stageAll || {ctrl: true, shift: true, alt: false, meta: false, key: "a"};
        if (checkModifiers(e, stageAllConfig) && e.key.toLowerCase() === stageAllConfig.key.toLowerCase()) {
            e.preventDefault();
            if (currentResults.length > 0) {
                bulkAddToStage(currentResults);
                input.value = '';

                // Safe UI swap
                const hint = document.getElementById('cc-palette-hint');
                if (hint) {
                    const children = Array.from(hint.children);
                    children.forEach(c => c.style.display = 'none');

                    const msgSpan = document.createElement('span');
                    msgSpan.style.cssText = 'color:#10b981; font-weight:bold;';
                    msgSpan.textContent = `✨ Staged ${currentResults.length} items!`;
                    hint.appendChild(msgSpan);

                    setTimeout(() => {
                        if (hint) {
                            msgSpan.remove();
                            children.forEach(c => c.style.display = '');
                        }
                    }, 2000);
                }
            }
            return;
        }

        if (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey)) {
            e.preventDefault();
            if (selectedIndices.size > 0) {
                const itemsToStage = Array.from(selectedIndices).sort((a,b)=>a-b).map(i => currentResults[i]);
                bulkAddToStage(itemsToStage);
                selectPaletteItem(Math.max(...selectedIndices) + 1, false);
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();

            if (stagedItems.length > 0) {
                injectContextsToAI([...stagedItems]);
                return;
            }

            if (!input.value.trim() && currentResults.length === 0) {
                input.placeholder = "Fetching latest...";
                try {
                    const data = await secureFetch(`${CONFIG.API_BASE}/latest?limit=1`, 'json');
                    if (data.results?.length) injectContextsToAI([data.results[0]]);
                } catch (err) { input.placeholder = "Error fetching latest."; }
            }
            else if (selectedIndices.size > 0) {
                const itemsToInject = Array.from(selectedIndices).sort((a,b)=>a-b).map(i => currentResults[i]);
                injectContextsToAI(itemsToInject);
            }
        }
    });

    document.getElementById('cc-inject-all-btn').addEventListener('click', () => {
        if (stagedItems.length > 0) injectContextsToAI([...stagedItems]);
    });

    palette.addEventListener('click', (e) => { if (e.target.id === 'cc-palette') togglePalette(); });
}

async function fetchBatch() {
    if (isFetching || !hasMore) return;
    const listContainer = document.getElementById('cc-results-list');
    if (!listContainer) return;

    isFetching = true;
    let spinner = document.getElementById('cc-search-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'cc-loading-spinner';
        spinner.id = 'cc-search-spinner';
        spinner.textContent = 'Loading...';
        spinner.style.color = '#888';
        spinner.style.padding = '10px';
        spinner.style.textAlign = 'center';
        listContainer.appendChild(spinner);
    }

    try {
        const tzOffset = new Date().getTimezoneOffset();

        let searchQuery = currentQuery.trim();
        let domainFilter = "";
        let timeFilter = "all";

        const domainMatch = searchQuery.match(/from:([^\s]+)/);
        if (domainMatch) {
            domainFilter = domainMatch[1];
            searchQuery = searchQuery.replace(domainMatch[0], "").trim();
        }

        const timeMappings = [
            {regex: /\b(yesterday)\b/i, filter: 'yesterday'},
            {regex: /\b(today)\b/i, filter: 'today'},
            {regex: /\b(last 2 hours|2 hours ago|2h ago|2h)\b/i, filter: '2h'},
            {regex: /\b(two days ago|2 days ago)\b/i, filter: 'yesterday'}
        ];

        for (let tm of timeMappings) {
            if (tm.regex.test(searchQuery)) {
                timeFilter = tm.filter;
                searchQuery = searchQuery.replace(tm.regex, '');
                searchQuery = searchQuery.replace(/^[, ]+|[, ]+$/g, '').trim();
                break;
            }
        }

        const url = `${CONFIG.API_BASE}/search?q=${encodeURIComponent(searchQuery)}&url_filter=${encodeURIComponent(domainFilter)}&limit=${CONFIG.BATCH_SIZE}&offset=${currentOffset}&time_filter=${timeFilter}&tz_offset=${tzOffset}`;
        const data = await secureFetch(url, 'json');
        const fetchedResults = data.results || [];

        document.getElementById('cc-search-spinner')?.remove();

        const uniqueNewResults = fetchedResults.filter(newRes => !currentResults.some(existingRes => existingRes.content === newRes.content));
        currentOffset += CONFIG.BATCH_SIZE;

        if (fetchedResults.length < CONFIG.BATCH_SIZE || (fetchedResults.length > 0 && uniqueNewResults.length === 0)) hasMore = false;

        if (currentResults.length === 0 && uniqueNewResults.length === 0) {
            if (document.getElementById('cc-results-list')) {
                listContainer.textContent = '';
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'cc-palette-empty';
                emptyMsg.style.cssText = 'color:#666; text-align:center; padding: 20px;';
                emptyMsg.textContent = 'No matching memories found.';
                listContainer.appendChild(emptyMsg);
            }
        } else if (uniqueNewResults.length > 0) {
            const startIndex = currentResults.length;
            currentResults.push(...uniqueNewResults);
            if (document.getElementById('cc-results-list')) appendResultsToDOM(uniqueNewResults, startIndex);
        }

        if (!hasMore && currentResults.length > 0 && !document.querySelector('.cc-end-of-results')) {
            if (document.getElementById('cc-results-list')) {
                const endMsg = document.createElement('div');
                endMsg.className = 'cc-end-of-results';
                endMsg.textContent = 'End of results';
                endMsg.style.cssText = 'text-align: center; color: #666; padding: 10px;';
                listContainer.appendChild(endMsg);
            }
        }
    } catch (err) {
        console.error(err);
        document.getElementById('cc-search-spinner')?.remove();
        if (currentResults.length === 0 && document.getElementById('cc-results-list')) {
            listContainer.textContent = '';
            const errMsg = document.createElement('div');
            errMsg.className = 'cc-palette-error';
            errMsg.style.cssText = 'color:#ef4444; text-align:center; padding: 20px;';
            errMsg.textContent = 'Local server disconnected.';
            listContainer.appendChild(errMsg);
        }
    }
    isFetching = false;
}

function appendResultsToDOM(newResults, startIndex) {
    const listContainer = document.getElementById('cc-results-list');
    const fragment = document.createDocumentFragment();

    newResults.forEach((r, i) => {
        let domain = "";
        try { domain = new URL(r.url).hostname.replace('www.', ''); } catch(e){}
        const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
        const displayTitle = truncateTitle(r.title);
        const displayDate = formatDateTime(r.created_at || r.timestamp);

        const itemDiv = document.createElement('div');
        itemDiv.className = 'cc-palette-item';
        itemDiv.setAttribute('data-index', startIndex + i);
        itemDiv.style.cssText = 'padding: 8px 12px; margin-bottom: 2px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 10px; transition: background 0.1s; background: transparent;';

        if (faviconUrl) {
            const img = document.createElement('img');
            img.src = faviconUrl;
            img.style.cssText = 'width:16px;height:16px;border-radius:3px;flex-shrink:0;';
            itemDiv.appendChild(img);
        } else {
            const iconSpan = document.createElement('span');
            iconSpan.style.cssText = 'font-size:16px;';
            iconSpan.textContent = '📄';
            itemDiv.appendChild(iconSpan);
        }

        const textContainer = document.createElement('div');
        textContainer.style.cssText = 'flex-grow: 1; overflow: hidden; display: flex; flex-direction: column;';

        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-size: 13px; color: #e5e5e5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        titleDiv.textContent = displayTitle;

        const dateDiv = document.createElement('div');
        dateDiv.style.cssText = 'font-size: 11px; color: #8ab4f8; margin-top: 2px;';
        dateDiv.textContent = displayDate;

        textContainer.appendChild(titleDiv);
        textContainer.appendChild(dateDiv);
        itemDiv.appendChild(textContainer);

        const addBtn = document.createElement('button');
        addBtn.className = 'cc-add-to-stage-btn';
        addBtn.style.cssText = 'background:transparent; border:none; color:#8ab4f8; cursor:pointer; font-weight:bold; opacity:0; transition:opacity 0.2s; padding:0 4px;';
        addBtn.title = 'Add to bundle';
        addBtn.textContent = '+';

        itemDiv.appendChild(addBtn);
        fragment.appendChild(itemDiv);
    });

    listContainer.appendChild(fragment);

    const allItems = listContainer.querySelectorAll('.cc-palette-item');
    for (let i = startIndex; i < allItems.length; i++) {
        const item = allItems[i];
        const data = currentResults[i];
        const absoluteIndex = startIndex + i;

        item.addEventListener('mouseenter', () => {
            if (blockHover) return; // Prevent fighting with keyboard arrows
            if (!selectedIndices.has(absoluteIndex)) item.style.backgroundColor = '#2a2a2a';
            item.querySelector('.cc-add-to-stage-btn').style.opacity = '1';
            previewPaletteItem(absoluteIndex);
        });

        item.addEventListener('mouseleave', () => {
            if (blockHover) return; // Prevent fighting with keyboard arrows
            if (!selectedIndices.has(absoluteIndex)) item.style.backgroundColor = 'transparent';
            item.querySelector('.cc-add-to-stage-btn').style.opacity = '0';
        });

        item.addEventListener('click', (e) => {
            if (e.shiftKey) {
                selectPaletteItem(absoluteIndex, true);
            } else {
                selectPaletteItem(absoluteIndex, false);
                stagedItems.length > 0 ? bulkAddToStage([data]) : injectContextsToAI([data]);
            }
        });

        item.querySelector('.cc-add-to-stage-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            bulkAddToStage([data]);
        });

        if (absoluteIndex === 0 && startIndex === 0) selectPaletteItem(0, false);
    }
}

function bulkAddToStage(dataArray) {
    let added = 0;
    dataArray.forEach(data => {
        if (!stagedItems.some(i => i.content === data.content)) {
            stagedItems.push(data);
            added++;
        }
    });
    if (added > 0) renderStagingArea();
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
    btn.textContent = `✨ Paste ${stagedItems.length} Item${stagedItems.length > 1 ? 's' : ''} (Enter)`;

    list.textContent = ''; // Clear previous items safely
    const fragment = document.createDocumentFragment();

    stagedItems.forEach((item, index) => {
        let cleanText = item.content.replace(/\[Local Image Path:.*?\]/g, '').trim();
        if (cleanText.length > 60) cleanText = `${cleanText.substring(0, 60)}...`;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'cc-staged-item';
        itemDiv.draggable = true;
        itemDiv.setAttribute('data-index', index);
        itemDiv.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px; background:#1e1e1e; border-radius:6px; margin-bottom:4px;';

        const handleDiv = document.createElement('div');
        handleDiv.className = 'cc-staged-drag-handle';
        handleDiv.style.cssText = 'cursor:grab; color:#666;';
        handleDiv.textContent = '⠿';

        const textDiv = document.createElement('div');
        textDiv.className = 'cc-staged-text';
        textDiv.style.cssText = 'pointer-events:none; flex-grow:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'cc-staged-title';
        titleSpan.style.cssText = 'color:#e5e5e5; font-size:13px; font-weight:bold;';
        titleSpan.textContent = truncateTitle(item.title);

        const previewSpan = document.createElement('span');
        previewSpan.className = 'cc-staged-preview';
        previewSpan.style.cssText = 'color:#888; font-size:12px;';
        previewSpan.textContent = ` — ${cleanText}`;

        textDiv.appendChild(titleSpan);
        textDiv.appendChild(previewSpan);

        const removeSpan = document.createElement('span');
        removeSpan.className = 'cc-staged-remove';
        removeSpan.setAttribute('data-index', index);
        removeSpan.style.cssText = 'cursor:pointer; color:#ef4444; font-weight:bold; padding:0 5px;';
        removeSpan.title = 'Remove';
        removeSpan.textContent = '✕';

        itemDiv.appendChild(handleDiv);
        itemDiv.appendChild(textDiv);
        itemDiv.appendChild(removeSpan);

        fragment.appendChild(itemDiv);
    });

    list.appendChild(fragment);

    list.querySelectorAll('.cc-staged-remove').forEach(rm => {
        rm.addEventListener('click', (e) => {
            stagedItems.splice(parseInt(e.target.getAttribute('data-index')), 1);
            renderStagingArea();
        });
    });

    let dragStartIndex;
    list.querySelectorAll('.cc-staged-item').forEach(item => {
        item.addEventListener('dragstart', (e) => { dragStartIndex = parseInt(e.target.getAttribute('data-index')); e.target.style.opacity = '0.5'; });
        item.addEventListener('dragover', (e) => { e.preventDefault(); e.currentTarget.style.border = '1px dashed #8ab4f8'; });
        item.addEventListener('dragleave', (e) => e.currentTarget.style.border = 'none');
        item.addEventListener('drop', (e) => {
            e.currentTarget.style.border = 'none';
            const dragEndIndex = parseInt(e.currentTarget.getAttribute('data-index'));
            const draggedItem = stagedItems[dragStartIndex];
            stagedItems.splice(dragStartIndex, 1);
            stagedItems.splice(dragEndIndex, 0, draggedItem);
            renderStagingArea();
        });
        item.addEventListener('dragend', (e) => {
            e.target.style.opacity = '1';
            list.querySelectorAll('.cc-staged-item').forEach(el => el.style.border = 'none');
        });
    });
}