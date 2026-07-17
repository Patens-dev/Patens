// ==========================================
// 4. COMMAND PALETTE UI & KEYBOARD NAV
// ==========================================

let blockHover = false;
let hoverTimeout = null;

function previewPaletteItem(index) {
    if (index < 0 || index >= currentResults.length) return;
    const previewPanel = document.getElementById('cc-preview-panel');
    if (!previewPanel) return;

    const data = currentResults[index];
    let domain = ""; try { domain = new URL(data.url).hostname; } catch(e){}
    const displayDate = formatDateTime(data.created_at || data.timestamp);

    previewPanel.innerHTML = `
        <div style="font-size: 11px; color: #8ab4f8; margin-bottom: 8px;">
            <a href="${data.url}" target="_blank" style="color:inherit; text-decoration:none;">🔗 ${domain}</a> • ${displayDate}
        </div>
        <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #fff; line-height: 1.3;">${data.title}</h3>
        <div style="white-space: pre-wrap; font-family: monospace; font-size: 13px; color: #ccc; line-height: 1.5;">
            ${(data.content || '').replace(/</g, '&lt;')}
        </div>
    `;
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

    palette = document.createElement('div');
    palette.id = 'cc-palette';
    palette.className = 'cc-palette-overlay';

    // 1. Overlay
    palette.style.position = 'fixed';
    palette.style.top = '0';
    palette.style.left = '0';
    palette.style.right = '0';
    palette.style.bottom = '0';
    palette.style.display = 'flex';
    palette.style.alignItems = 'center';
    palette.style.justifyContent = 'center';
    palette.style.zIndex = '2147483647';
    palette.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';

    // 2. ABSOLUTE POSITIONING FIX: Bypasses Flexbox blowout entirely
    palette.innerHTML = `
        <div class="cc-palette-container" style="position: relative; width: 850px; max-width: 90vw; height: 75vh; max-height: 700px; background: #222; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); font-family: sans-serif; box-sizing: border-box;">
            
            <input type="text" id="cc-palette-input" placeholder="Search memory... (try 'github, yesterday' or 'from:docs.com')" autocomplete="off" style="position: absolute; top: 0; left: 0; width: 100%; height: 55px; padding: 0 20px; border: none; background: transparent; color: white; font-size: 16px; outline: none; border-bottom: 1px solid #333; box-sizing: border-box; z-index: 5;" />
            
            <div id="cc-palette-results" style="position: absolute; top: 55px; bottom: 45px; left: 0; width: 100%; display: flex; background: #222; z-index: 1;">
                <div id="cc-results-list" style="width: 40%; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 8px; border-right: 1px solid #333; box-sizing: border-box;"></div>
                <div id="cc-preview-panel" style="width: 60%; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 20px; background: #1a1a1a; word-wrap: break-word; box-sizing: border-box;">
                    <div style="color: #666; text-align: center; margin-top: 80px;">Select an item to preview</div>
                </div>
            </div>

            <!-- Staging Overlay slides up over the results -->
            <div id="cc-staging-container" style="display: none; position: absolute; bottom: 45px; left: 0; width: 100%; height: 200px; border-top: 1px solid #444; padding: 12px 20px; box-sizing: border-box; background: #222; flex-direction: column; z-index: 10;">
                <div style="font-size: 11px; color: #888; margin-bottom: 8px; text-transform: uppercase; font-weight: bold; flex-shrink: 0;">Staged for Injection</div>
                <div id="cc-staging-list" style="flex-grow: 1; overflow-y: auto; padding-right: 5px;"></div>
                <button id="cc-inject-all-btn" style="flex-shrink: 0; margin-top: 10px; padding: 10px; background: #8ab4f8; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Paste Items</button>
            </div>
            
            <div id="cc-palette-hint" style="position: absolute; bottom: 0; left: 0; width: 100%; height: 45px; padding: 0 20px; font-size: 12px; color: #888; border-top: 1px solid #333; display: flex; gap: 16px; align-items: center; background: #1e1e1e; box-sizing: border-box; z-index: 5;">
                <span><span style="border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;">↑↓</span> Navigate</span>
                <span><span style="border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;">Shift + ↑↓</span> Multi-Select</span>
                <span><span style="border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;">Enter</span> Paste</span>
                <span><span style="border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;">Tab</span> Stage</span>
            </div>
        </div>
    `;

    document.body.appendChild(palette);
    paletteOpen = true;

    const input = document.getElementById('cc-palette-input');
    const listContainer = document.getElementById('cc-results-list');
    const previewPanel = document.getElementById('cc-preview-panel');
    let timeout = null;
    input.focus();

    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        currentQuery = e.target.value;

        timeout = setTimeout(() => {
            currentOffset = 0; hasMore = true; currentResults = [];
            selectedIndex = 0; selectionAnchor = 0; selectedIndices = new Set([0]);
            if (listContainer) listContainer.innerHTML = '';
            if (previewPanel) previewPanel.innerHTML = '<div style="color: #666; text-align: center; margin-top: 80px;">Select an item to preview</div>';
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
                const hint = document.getElementById('cc-palette-hint');
                const origHint = hint.innerHTML;
                hint.innerHTML = `<span style="color:#10b981; font-weight:bold;">✨ Staged ${currentResults.length} items!</span>`;
                setTimeout(() => { if(hint) hint.innerHTML = origHint; }, 2000);
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
        spinner.innerText = 'Loading...';
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
                listContainer.innerHTML = '<div class="cc-palette-empty" style="color:#666; text-align:center; padding: 20px;">No matching memories found.</div>';
            }
        } else if (uniqueNewResults.length > 0) {
            const startIndex = currentResults.length;
            currentResults.push(...uniqueNewResults);
            if (document.getElementById('cc-results-list')) appendResultsToDOM(uniqueNewResults, startIndex);
        }

        if (!hasMore && currentResults.length > 0 && !document.querySelector('.cc-end-of-results')) {
            if (document.getElementById('cc-results-list')) {
                const endMsg = document.createElement('div'); endMsg.className = 'cc-end-of-results'; endMsg.innerText = 'End of results'; endMsg.style.textAlign = 'center'; endMsg.style.color = '#666'; endMsg.style.padding = '10px';
                listContainer.appendChild(endMsg);
            }
        }
    } catch (err) {
        console.error(err);
        document.getElementById('cc-search-spinner')?.remove();
        if (currentResults.length === 0 && document.getElementById('cc-results-list')) {
            listContainer.innerHTML = '<div class="cc-palette-error" style="color:#ef4444; text-align:center; padding: 20px;">Local server disconnected.</div>';
        }
    }
    isFetching = false;
}

function appendResultsToDOM(newResults, startIndex) {
    const listContainer = document.getElementById('cc-results-list');

    const html = newResults.map((r, i) => {
        let domain = "";
        try { domain = new URL(r.url).hostname.replace('www.', ''); } catch(e){}
        const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
        const displayTitle = truncateTitle(r.title);
        const displayDate = formatDateTime(r.created_at || r.timestamp);

        return `
            <div class="cc-palette-item" data-index="${startIndex + i}" style="padding: 8px 12px; margin-bottom: 2px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 10px; transition: background 0.1s; background: transparent;">
                ${faviconUrl ? `<img src="${faviconUrl}" style="width:16px;height:16px;border-radius:3px;flex-shrink:0;" />` : `<span style="font-size:16px;">📄</span>`}
                <div style="flex-grow: 1; overflow: hidden; display: flex; flex-direction: column;">
                    <div style="font-size: 13px; color: #e5e5e5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayTitle}</div>
                    <div style="font-size: 11px; color: #8ab4f8; margin-top: 2px;">${displayDate}</div>
                </div>
                <button class="cc-add-to-stage-btn" style="background:transparent; border:none; color:#8ab4f8; cursor:pointer; font-weight:bold; opacity:0; transition:opacity 0.2s; padding:0 4px;" title="Add to bundle">+</button>
            </div>
        `;
    }).join('');

    listContainer.insertAdjacentHTML('beforeend', html);

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
    btn.innerText = `✨ Paste ${stagedItems.length} Item${stagedItems.length > 1 ? 's' : ''} (Enter)`;

    list.innerHTML = stagedItems.map((item, index) => {
        let cleanText = item.content.replace(/\[Local Image Path:.*?\]/g, '').trim();
        if (cleanText.length > 60) cleanText = `${cleanText.substring(0, 60)}...`;
        return `
            <div class="cc-staged-item" draggable="true" data-index="${index}" style="display:flex; align-items:center; gap:8px; padding:6px; background:#1e1e1e; border-radius:6px; margin-bottom:4px;">
                <div class="cc-staged-drag-handle" style="cursor:grab; color:#666;">⠿</div>
                <div class="cc-staged-text" style="pointer-events:none; flex-grow:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <span class="cc-staged-title" style="color:#e5e5e5; font-size:13px; font-weight:bold;">${truncateTitle(item.title)}</span>
                    <span class="cc-staged-preview" style="color:#888; font-size:12px;"> — ${cleanText}</span>
                </div>
                <span class="cc-staged-remove" data-index="${index}" style="cursor:pointer; color:#ef4444; font-weight:bold; padding:0 5px;" title="Remove">✕</span>
            </div>
        `;
    }).join('');

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