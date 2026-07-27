(() => {
    window.Patens = window.Patens || {};
    
    // Safely grab the factory, or fallback to console if load order gets messed up
    const Logger = Patens.LoggerFactory 
        ? Patens.LoggerFactory("[Patens Palette]") 
        : { debug: console.debug, info: console.info, warn: console.warn, error: console.error };
        
    const h = Patens.h;

    // ==========================================
    // 2. PALETTE COMPONENT
    // ==========================================
    Patens.Palette = {
        blockHover: false,
        hoverTimeout: null,

        toggle: () => {
            let palette = document.getElementById('cc-palette');

            if (Patens.State?.ui?.paletteOpen && palette) {
                Logger.info("Closing command palette overlay.");
                palette.remove();
                if (Patens.State.ui) Patens.State.ui.paletteOpen = false;
                if (Patens.State.palette) Patens.State.palette.stagedItems = [];

                if (Patens.State.editor?.activeInputElement) {
                    try {
                        Logger.debug("Restoring focus to active input element.");
                        Patens.State.editor.activeInputElement.focus();
                    } catch (focusErr) {
                        Logger.warn("Failed to restore focus to active input element:", focusErr);
                    }
                }
                return;
            }

            Logger.info("Opening command palette overlay.");

            // Save Editor Input Context
            if (Patens.State.editor) {
                Patens.State.editor.activeInputElement = document.activeElement;
                Patens.State.editor.savedRange = null;
                Patens.State.editor.savedInputState = null;
            }

            if (Patens.State.palette) {
                Patens.State.palette.selectedIndex = 0;
                Patens.State.palette.selectionAnchor = 0;
                Patens.State.palette.selectedIndices = new Set([0]);
            }

            const active = document.activeElement;
            if (active && Patens.State.editor) {
                if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
                    Patens.State.editor.savedInputState = { start: active.selectionStart, end: active.selectionEnd };
                    Logger.debug(`Saved selection range for input element [${active.selectionStart}:${active.selectionEnd}]`);
                } else if (active.isContentEditable) {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                        Patens.State.editor.savedRange = sel.getRangeAt(0).cloneRange();
                        Logger.debug("Saved selection range for contenteditable element.");
                    }
                }
            }

            // Construct Overlay UI via DOM Declarative Builder
            palette = h('div', {
                    id: 'cc-palette',
                    class: 'cc-palette-overlay',
                    style: 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; z-index: 2147483647; background-color: rgba(0, 0, 0, 0.6);',
                    onclick: (e) => {
                        if (e.target.id === 'cc-palette') Patens.Palette.toggle();
                    }
                },
                h('div', {
                        class: 'cc-palette-container',
                        style: 'position: relative; width: 850px; max-width: 90vw; height: 75vh; max-height: 700px; background: #222; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); font-family: sans-serif;'
                    },
                    h('input', {
                        type: 'text',
                        id: 'cc-palette-input',
                        autocomplete: 'off',
                        placeholder: "Search memory... (try 'github, yesterday' or 'from:docs.com')",
                        style: 'position: absolute; top: 0; left: 0; width: 100%; height: 55px; padding: 0 20px; border: none; background: transparent; color: white; font-size: 16px; outline: none; border-bottom: 1px solid #333; z-index: 5;',
                        oninput: Patens.Palette.handleSearchInput,
                        onkeydown: Patens.Palette.handleKeyboardNav
                    }),
                    h('div', {
                            id: 'cc-palette-results',
                            style: 'position: absolute; top: 55px; bottom: 45px; left: 0; width: 100%; display: flex; background: #222; z-index: 1;'
                        },
                        h('div', {
                            id: 'cc-results-list',
                            style: 'width: 40%; height: 100%; overflow-y: auto; padding: 8px; border-right: 1px solid #333;',
                            onscroll: Patens.Palette.handleScroll
                        }),
                        h('div', {
                                id: 'cc-preview-panel',
                                style: 'width: 60%; height: 100%; overflow-y: auto; padding: 20px; background: #1a1a1a; word-wrap: break-word;'
                            },
                            h('div', { style: 'color: #666; text-align: center; margin-top: 80px;' }, 'Select an item to preview')
                        )
                    ),
                    h('div', {
                            id: 'cc-staging-container',
                            style: 'display: none; position: absolute; bottom: 45px; left: 0; width: 100%; height: 200px; border-top: 1px solid #444; padding: 12px 20px; background: #222; flex-direction: column; z-index: 10;'
                        },
                        h('div', { style: 'font-size: 11px; color: #888; margin-bottom: 8px; font-weight: bold;' }, 'Staged for Injection'),
                        h('div', { id: 'cc-staging-list', style: 'flex-grow: 1; overflow-y: auto;' }),
                        h('button', {
                            id: 'cc-inject-all-btn',
                            style: 'margin-top: 10px; padding: 10px; background: #8ab4f8; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;',
                            onclick: () => {
                                const staged = Patens.State.palette?.stagedItems || [];
                                Logger.info(`Injecting ${staged.length} staged items...`);
                                Patens.Injector?.injectContextsToAI([...staged]);
                            }
                        }, 'Paste Items')
                    ),
                    h('div', {
                            id: 'cc-palette-hint',
                            style: 'position: absolute; bottom: 0; left: 0; width: 100%; height: 45px; padding: 0 20px; font-size: 12px; color: #888; border-top: 1px solid #333; display: flex; gap: 16px; align-items: center; background: #1e1e1e; z-index: 5;'
                        },
                        h('span', {}, h('span', { style: 'border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;' }, '↑↓'), ' Navigate'),
                        h('span', {}, h('span', { style: 'border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;' }, 'Shift + ↑↓'), ' Multi-Select'),
                        h('span', {}, h('span', { style: 'border: 1px solid #444; padding: 2px 6px; border-radius: 4px; background: #333; color: #ccc; margin-right: 4px;' }, 'Enter'), ' Paste')
                    )
                )
            );

            document.body.appendChild(palette);
            if (Patens.State.ui) Patens.State.ui.paletteOpen = true;

            setTimeout(() => {
                const input = document.getElementById('cc-palette-input');
                if (input) input.focus();
            }, 100);

            if (Patens.State.palette) {
                Patens.State.palette.currentQuery = '';
                Patens.State.palette.currentOffset = 0;
                Patens.State.palette.hasMore = true;
                Patens.State.palette.currentResults = [];
            }

            Patens.Palette.fetchBatch();
        },

        handleSearchInput: (e) => {
            const query = e.target.value;
            Logger.debug(`Search input changed: "${query}"`);

            clearTimeout(Patens.Palette._searchTimeout);
            if (Patens.State.palette) Patens.State.palette.currentQuery = query;

            Patens.Palette._searchTimeout = setTimeout(() => {
                Logger.info(`Executing debounced search query: "${query}"`);

                if (Patens.State.palette) {
                    Patens.State.palette.currentOffset = 0;
                    Patens.State.palette.hasMore = true;
                    Patens.State.palette.currentResults = [];
                    Patens.State.palette.selectedIndex = 0;
                    Patens.State.palette.selectionAnchor = 0;
                    Patens.State.palette.selectedIndices = new Set([0]);
                }

                const list = document.getElementById('cc-results-list');
                const preview = document.getElementById('cc-preview-panel');
                if (list) list.textContent = '';
                if (preview) {
                    preview.textContent = '';
                    preview.appendChild(h('div', { style: 'color: #666; text-align: center; margin-top: 80px;' }, 'Select an item to preview'));
                }

                Patens.Palette.fetchBatch();
            }, 200);
        },

        handleKeyboardNav: async (e) => {
            if (e.key === 'Escape') {
                Logger.debug("Escape key pressed; closing palette.");
                return Patens.Palette.toggle();
            }

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                Patens.Palette.blockHover = true;
                clearTimeout(Patens.Palette.hoverTimeout);
                Patens.Palette.hoverTimeout = setTimeout(() => Patens.Palette.blockHover = false, 150);

                const currentIndex = Patens.State.palette?.selectedIndex || 0;
                if (e.key === 'ArrowDown') Patens.Palette.selectItem(currentIndex + 1, e.shiftKey);
                if (e.key === 'ArrowUp') Patens.Palette.selectItem(currentIndex - 1, e.shiftKey);
                return;
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const state = Patens.State.palette || {};

                if (state.stagedItems && state.stagedItems.length > 0) {
                    Logger.info(`Enter pressed; injecting ${state.stagedItems.length} staged items.`);
                    Patens.Injector?.injectContextsToAI([...state.stagedItems]);
                    return;
                }

                const queryVal = e.target.value.trim();

                if (!queryVal && (!state.currentResults || state.currentResults.length === 0)) {
                    Logger.info("Enter pressed on empty input; fetching latest context entry...");
                    e.target.placeholder = "Fetching latest...";
                    try {
                        const apiBase = Patens.Config?.API_BASE || "http://localhost:8000";
                        const data = await Patens.API?.fetchProxy(`${apiBase}/api/v1/latest?limit=1`, 'json');
                        if (data?.results?.length) {
                            Logger.info("Injecting latest context entry:", data.results[0]);
                            Patens.Injector?.injectContextsToAI([data.results[0]]);
                        } else {
                            Logger.warn("No latest context entry returned from server.");
                        }
                    } catch (err) {
                        Logger.error("Failed to fetch latest context entry:", err);
                        e.target.placeholder = "Error fetching latest.";
                    }
                } else if (state.selectedIndices && state.selectedIndices.size > 0) {
                    const itemsToInject = Array.from(state.selectedIndices)
                        .sort((a, b) => a - b)
                        .map(i => state.currentResults[i])
                        .filter(Boolean);

                    Logger.info(`Enter pressed; injecting ${itemsToInject.length} selected items.`);
                    Patens.Injector?.injectContextsToAI(itemsToInject);
                }
            }
        },

        handleScroll: (e) => {
            const list = e.target;
            const state = Patens.State.palette || {};

            if (!state.isFetching && state.hasMore && list.scrollTop + list.clientHeight >= list.scrollHeight - 20) {
                Logger.debug("Scroll limit reached; requesting next batch...");
                Patens.Palette.fetchBatch();
            }
        },

        fetchBatch: async () => {
            const state = Patens.State.palette || {};
            if (state.isFetching || !state.hasMore) return;

            const listContainer = document.getElementById('cc-results-list');
            if (!listContainer) {
                Logger.warn("fetchBatch aborted: #cc-results-list container element not found.");
                return;
            }

            state.isFetching = true;
            let spinner = document.getElementById('cc-search-spinner');

            if (!spinner) {
                spinner = h('div', {
                    id: 'cc-search-spinner',
                    style: 'color: #888; padding: 10px; text-align: center;'
                }, 'Loading...');
                listContainer.appendChild(spinner);
            }

            const startTime = performance.now();

            try {
                const tzOffset = new Date().getTimezoneOffset();
                let sq = (state.currentQuery || "").trim();
                let domainFilter = "";
                let timeFilter = "all";

                const domainMatch = sq.match(/from:([^\s]+)/);
                if (domainMatch) {
                    domainFilter = domainMatch[1];
                    sq = sq.replace(domainMatch[0], "").trim();
                    Logger.debug(`Parsed domain filter: "${domainFilter}", refined query: "${sq}"`);
                }

                const apiBase = Patens.Config?.API_BASE || "http://localhost:8000";
                const batchSize = Patens.Config?.BATCH_SIZE || 10;

                const searchUrl = `${apiBase}/api/v1/search?q=${encodeURIComponent(sq)}&url_filter=${encodeURIComponent(domainFilter)}&limit=${batchSize}&offset=${state.currentOffset}&time_filter=${timeFilter}&tz_offset=${tzOffset}`;

                Logger.debug(`Executing API search fetch [Offset: ${state.currentOffset}] -> ${searchUrl}`);
                const data = await Patens.API?.fetchProxy(searchUrl, 'json');

                const duration = (performance.now() - startTime).toFixed(2);
                const fetchedResults = data?.results || [];

                Logger.info(`Search API returned ${fetchedResults.length} items in ${duration}ms.`);

                document.getElementById('cc-search-spinner')?.remove();

                const existingContentSet = new Set((state.currentResults || []).map(r => r.content));
                const uniqueNew = fetchedResults.filter(nr => !existingContentSet.has(nr.content));

                state.currentOffset = (state.currentOffset || 0) + batchSize;

                if (fetchedResults.length < batchSize || (fetchedResults.length > 0 && uniqueNew.length === 0)) {
                    Logger.debug("End of search result stream reached. Setting hasMore = false.");
                    state.hasMore = false;
                }

                if ((!state.currentResults || state.currentResults.length === 0) && uniqueNew.length === 0) {
                    Logger.info("No memory entries matched search query.");
                    listContainer.textContent = '';
                    listContainer.appendChild(h('div', { style: 'color:#666; text-align:center; padding: 20px;' }, 'No matching memories found.'));
                } else if (uniqueNew.length > 0) {
                    const startIndex = state.currentResults ? state.currentResults.length : 0;
                    if (!state.currentResults) state.currentResults = [];
                    state.currentResults.push(...uniqueNew);

                    Logger.debug(`Appending ${uniqueNew.length} new items to results list (Starting at index ${startIndex}).`);
                    Patens.Palette.appendResults(uniqueNew, startIndex);
                }

            } catch (err) {
                Logger.error("Failed to fetch memory search batch:", err);
                document.getElementById('cc-search-spinner')?.remove();

                if (!state.currentResults || state.currentResults.length === 0) {
                    listContainer.textContent = '';
                    listContainer.appendChild(h('div', { style: 'color:#ef4444; text-align:center; padding: 20px;' }, 'Local server disconnected.'));
                }
            } finally {
                state.isFetching = false;
            }
        },

        appendResults: (newResults, startIndex) => {
            const listContainer = document.getElementById('cc-results-list');
            const state = Patens.State.palette || {};

            if (!listContainer) return;

            newResults.forEach((r, i) => {
                const absoluteIndex = startIndex + i;
                let domain = "";
                try {
                    if (r.url) domain = new URL(r.url).hostname.replace('www.', '');
                } catch (e) {
                    Logger.debug(`Could not parse domain URL '${r.url}':`, e);
                }

                const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
                const itemTitle = Patens.Utils?.truncateTitle ? Patens.Utils.truncateTitle(r.title) : (r.title || 'Untitled');
                const itemTime = Patens.Utils?.formatDateTime ? Patens.Utils.formatDateTime(r.created_at || r.timestamp) : (r.created_at || r.timestamp || '');

                const itemDiv = h('div', {
                        class: 'cc-palette-item',
                        'data-index': absoluteIndex,
                        style: 'padding: 8px 12px; margin-bottom: 2px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 10px; background: transparent;',
                        onmouseenter: () => {
                            if (Patens.Palette.blockHover) return;
                            if (!state.selectedIndices?.has(absoluteIndex)) itemDiv.style.backgroundColor = '#2a2a2a';
                            Patens.Palette.previewItem(absoluteIndex);
                        },
                        onmouseleave: () => {
                            if (Patens.Palette.blockHover) return;
                            if (!state.selectedIndices?.has(absoluteIndex)) itemDiv.style.backgroundColor = 'transparent';
                        },
                        onclick: (e) => {
                            Logger.info(`Clicked palette result index ${absoluteIndex}; injecting context...`);
                            Patens.Palette.selectItem(absoluteIndex, e.shiftKey);
                            if (state.currentResults && state.currentResults[absoluteIndex]) {
                                Patens.Injector?.injectContextsToAI([state.currentResults[absoluteIndex]]);
                            }
                        }
                    },
                    faviconUrl ? h('img', {
                        src: faviconUrl,
                        style: 'width:16px;height:16px;border-radius:3px;'
                    }) : h('span', { style: 'font-size:16px;' }, '📄'),
                    h('div', { style: 'flex-grow: 1; overflow: hidden;' },
                        h('div', { style: 'font-size: 13px; color: #e5e5e5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' }, itemTitle),
                        h('div', { style: 'font-size: 11px; color: #8ab4f8;' }, itemTime)
                    )
                );

                listContainer.appendChild(itemDiv);

                if (absoluteIndex === 0 && startIndex === 0) {
                    Patens.Palette.selectItem(0, false);
                }
            });
        },

        previewItem: (index) => {
            const state = Patens.State.palette || {};
            if (!state.currentResults || index < 0 || index >= state.currentResults.length) return;

            const panel = document.getElementById('cc-preview-panel');
            if (!panel) return;

            const data = state.currentResults[index];
            if (!data) return;

            let domain = "";
            try {
                if (data.url) domain = new URL(data.url).hostname;
            } catch (e) {
                Logger.debug(`Could not parse preview domain for URL '${data.url}':`, e);
            }

            const formattedTime = Patens.Utils?.formatDateTime ? Patens.Utils.formatDateTime(data.created_at || data.timestamp) : (data.created_at || data.timestamp || '');

            panel.textContent = '';
            panel.appendChild(h('div', { style: 'font-size: 11px; color: #8ab4f8; margin-bottom: 8px;' },
                h('a', { href: data.url || '#', target: '_blank', style: 'color:inherit; text-decoration:none;' }, `🔗 ${domain || 'Local Context'}`),
                ` • ${formattedTime}`
            ));
            panel.appendChild(h('h3', { style: 'margin: 0 0 16px 0; font-size: 16px; color: #fff;' }, data.title || 'Untitled'));
            panel.appendChild(h('div', { style: 'white-space: pre-wrap; font-family: monospace; font-size: 13px; color: #ccc;' }, data.content || ''));
        },

        selectItem: (index, shiftKey = false) => {
            const state = Patens.State.palette || {};
            if (!state.currentResults || index < 0 || index >= state.currentResults.length) return;

            if (!shiftKey) {
                state.selectionAnchor = index;
                state.selectedIndices = new Set([index]);
            } else {
                if (!state.selectedIndices) state.selectedIndices = new Set();
                state.selectedIndices.clear();
                const start = Math.min(state.selectionAnchor || 0, index);
                const end = Math.max(state.selectionAnchor || 0, index);
                for (let i = start; i <= end; i++) state.selectedIndices.add(i);
            }

            state.selectedIndex = index;
            Patens.Palette.previewItem(index);

            document.querySelectorAll('.cc-palette-item').forEach(el => {
                const idx = parseInt(el.getAttribute('data-index'), 10);
                if (state.selectedIndices?.has(idx)) {
                    el.style.backgroundColor = '#333333';
                    el.style.boxShadow = 'inset 3px 0 0 #8ab4f8';

                    if (idx === state.selectedIndex) {
                        el.scrollIntoView({ block: 'nearest' });
                    }
                } else {
                    el.style.backgroundColor = 'transparent';
                    el.style.boxShadow = 'none';
                }
            });
        }
    };

})();