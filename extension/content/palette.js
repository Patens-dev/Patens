(() => {
    window.Patens = window.Patens || {};

    const Logger = Patens.LoggerFactory
        ? Patens.LoggerFactory("[Patens Palette]")
        : { debug: console.debug, info: console.info, warn: console.warn, error: console.error };

    const h = Patens.h;

    const restorePaletteFocus = () => {
        setTimeout(() => {
            const input = document.getElementById('cc-palette-input');
            if (input) input.focus();
        }, 50);
    };

    // ==========================================
    // PALETTE COMPONENT (Multi-Select Tree)
    // ==========================================
    Patens.Palette = {
        blockHover: false,
        hoverTimeout: null,
        _isFetching: false,

        executeInjection: async (selectedItems) => {
            if (!selectedItems || selectedItems.length === 0) return;

            Logger.info(`Executing injection for ${selectedItems.length} item(s)...`);

            if (!Patens.State?.editor?.activeInputElement) {
                const onboardingBox = document.querySelector('#mock-chat-box');
                if (onboardingBox) {
                    Patens.State = Patens.State || {};
                    Patens.State.editor = Patens.State.editor || {};
                    Patens.State.editor.activeInputElement = onboardingBox;
                }
            }

            if (Patens.Injector?.injectContextsToAI) {
                await Patens.Injector.injectContextsToAI(selectedItems);
            } else {
                Logger.error("❌ Patens.Injector.injectContextsToAI is undefined!");
            }
        },

        getDeletePreference: (callback) => {
            if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
                chrome.storage.local.get(['dontAskDeleteContext'], (res) => {
                    callback(!!res.dontAskDeleteContext);
                });
            } else {
                callback(false);
            }
        },

        setDeletePreference: (val) => {
            if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
                chrome.storage.local.set({ dontAskDeleteContext: val });
            }
        },

        showDeleteDialog: (selectedNavItems, onConfirm) => {
            let totalClips = 0;
            let docCount = 0;
            let childCount = 0;

            selectedNavItems.forEach(nav => {
                if (nav.type === 'document') {
                    docCount++;
                    totalClips += nav.item.clip_count || (nav.item.raw_ids ? nav.item.raw_ids.length : 1);
                } else if (nav.type === 'child') {
                    childCount++;
                    totalClips += 1;
                }
            });

            let messageText = '';
            if (selectedNavItems.length === 1) {
                const single = selectedNavItems[0];
                if (single.type === 'child') {
                    messageText = `Delete this individual paragraph from "${single.parentDoc.title || 'Document'}"?`;
                } else {
                    const count = single.item.clip_count || 1;
                    messageText = `Delete "${single.item.title || 'Untitled'}" (${count} total paragraphs) from memory?`;
                }
            } else {
                messageText = `Delete ${selectedNavItems.length} selected items (${totalClips} total paragraphs) from memory?`;
            }

            let dontAskChecked = false;

            const dialog = h('div', {
                    id: 'cc-delete-dialog',
                    style: 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(2px);'
                },
                h('div', {
                        style: 'width: 420px; max-width: 90%; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
                    },
                    h('h3', { style: 'margin: 0 0 10px 0; font-size: 16px; font-weight: 600; color: #ffffff;' }, 'Delete from Memory?'),
                    h('p', { style: 'margin: 0 0 16px 0; font-size: 13px; color: #a1a1aa; line-height: 1.5;' }, messageText),
                    h('label', { style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 20px; font-size: 12px; color: #a1a1aa; cursor: pointer; user-select: none;' },
                        h('input', {
                            type: 'checkbox',
                            id: 'cc-delete-dont-ask',
                            style: 'cursor: pointer; accent-color: #ef4444;',
                            onchange: (e) => { dontAskChecked = e.target.checked; }
                        }),
                        "Don't ask me again"
                    ),
                    h('div', { style: 'display: flex; justify-content: flex-end; gap: 10px;' },
                        h('button', {
                            style: 'padding: 8px 16px; background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;',
                            onclick: () => {
                                dialog.remove();
                                restorePaletteFocus();
                            }
                        }, 'Cancel'),
                        h('button', {
                            id: 'cc-confirm-delete-btn',
                            style: 'padding: 8px 16px; background: #ef4444; border: none; color: #ffffff; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;',
                            onclick: () => {
                                dialog.remove();
                                if (dontAskChecked) Patens.Palette.setDeletePreference(true);
                                onConfirm();
                            }
                        }, 'Delete')
                    )
                )
            );

            const container = document.querySelector('.cc-palette-container') || document.body;
            container.appendChild(dialog);

            setTimeout(() => {
                const btn = document.getElementById('cc-confirm-delete-btn');
                if (btn) btn.focus();
            }, 50);
        },

        requestDelete: (selectedNavItems) => {
            if (!selectedNavItems || selectedNavItems.length === 0) return;
            Patens.Palette.getDeletePreference((dontAsk) => {
                if (dontAsk) Patens.Palette.executeDeletion(selectedNavItems);
                else Patens.Palette.showDeleteDialog(selectedNavItems, () => Patens.Palette.executeDeletion(selectedNavItems));
            });
        },

        executeDeletion: async (selectedNavItems) => {
            if (!selectedNavItems || selectedNavItems.length === 0) return;

            const state = Patens.State.palette || {};
            const childDeletionsByParent = new Map();
            const docDeletions = new Set();
            const allDbIdsToDelete = [];

            selectedNavItems.forEach(nav => {
                if (nav.type === 'document') {
                    docDeletions.add(nav.item);
                    (nav.item.raw_ids || [nav.item.id]).forEach(id => allDbIdsToDelete.push(id));
                } else if (nav.type === 'child') {
                    if (!childDeletionsByParent.has(nav.parentDoc)) {
                        childDeletionsByParent.set(nav.parentDoc, new Set());
                    }
                    childDeletionsByParent.get(nav.parentDoc).add(nav.item.id);
                    allDbIdsToDelete.push(nav.item.id);
                }
            });

            const uniqueIds = Array.from(new Set(allDbIdsToDelete.filter(Boolean)));

            try {
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    await chrome.runtime.sendMessage({ action: "delete_context", ids: uniqueIds });
                } else if (Patens.API?.fetchProxy) {
                    await Patens.API.fetchProxy(`/api/v1/delete?ids=${encodeURIComponent(uniqueIds.join(','))}`, { method: 'DELETE' });
                }
            } catch (err) {
                Logger.error("Failed to execute deletion:", err);
            }

            // 1. Remove deleted parent documents
            state.documents = (state.documents || []).filter(d => !docDeletions.has(d));

            // 2. For non-deleted parent documents whose children were deleted, filter clips in-place
            childDeletionsByParent.forEach((clipIdsToDelete, parentDoc) => {
                if (docDeletions.has(parentDoc)) return;
                parentDoc.clips = (parentDoc.clips || []).filter(c => !clipIdsToDelete.has(c.id));
                parentDoc.raw_ids = (parentDoc.raw_ids || []).filter(id => !clipIdsToDelete.has(id));
                parentDoc.clip_count = parentDoc.clips.length;

                if (parentDoc.clip_count === 0) {
                    state.documents = state.documents.filter(d => d !== parentDoc);
                } else {
                    parentDoc.content = parentDoc.clips.map(c => c.content.trim()).filter(Boolean).join('\n\n');
                    parentDoc.tokens = Math.ceil(parentDoc.content.length / 4);
                }
            });

            // 3. Rebuild navigable list and reset selection
            Patens.Palette.rebuildNavigableList();
            const newIndex = Math.max(0, Math.min(state.selectedIndex || 0, state.navigableList.length - 1));
            state.selectedIndex = newIndex;
            state.selectionAnchor = newIndex;
            state.selectedIndices = new Set(state.navigableList.length > 0 ? [newIndex] : []);

            Patens.Palette.renderResultsList();

            if (Patens.Utils?.showNotification) {
                Patens.Utils.showNotification(`✨ Deleted ${uniqueIds.length} item(s) from memory`, '#ef4444');
            }

            if (state.documents.length < 5 && state.hasMore) {
                Patens.Palette.fetchBatch();
            }

            restorePaletteFocus();
        },

        toggleDocExpand: (docKey) => {
            const state = Patens.State.palette;
            if (!state) return;

            if (state.expandedDocKeys.has(docKey)) {
                state.expandedDocKeys.delete(docKey);
            } else {
                state.expandedDocKeys.add(docKey);
            }

            Patens.Palette.rebuildNavigableList();
            Patens.Palette.renderResultsList();
        },

        rebuildNavigableList: () => {
            const state = Patens.State.palette;
            if (!state) return;

            const list = [];
            (state.documents || []).forEach((doc, docIdx) => {
                const docKey = doc.url || doc.title || String(doc.id);
                const isExpanded = state.expandedDocKeys.has(docKey);

                list.push({
                    type: 'document',
                    docIndex: docIdx,
                    docKey: docKey,
                    isExpanded: isExpanded,
                    item: doc
                });

                if (isExpanded && Array.isArray(doc.clips)) {
                    doc.clips.forEach((clip, clipIdx) => {
                        list.push({
                            type: 'child',
                            docIndex: docIdx,
                            clipIndex: clipIdx,
                            parentDoc: doc,
                            item: clip
                        });
                    });
                }
            });

            state.navigableList = list;
        },

        toggle: () => {
            let palette = document.getElementById('cc-palette');
            if (Patens.State?.ui?.paletteOpen && palette) {
                palette.remove();
                if (Patens.State.ui) Patens.State.ui.paletteOpen = false;
                if (Patens.State.palette) Patens.State.palette.stagedItems = [];
                if (Patens.State.editor?.activeInputElement) {
                    try { Patens.State.editor.activeInputElement.focus(); } catch (_) {}
                }
                return;
            }

            if (Patens.State.editor) {
                Patens.State.editor.activeInputElement = document.activeElement;
            }

            Patens.State = Patens.State || {};
            Patens.State.palette = {
                currentQuery: '',
                currentOffset: 0,
                hasMore: true,
                documents: [],
                expandedDocKeys: new Set(),
                navigableList: [],
                selectedIndex: 0,
                selectionAnchor: 0,
                selectedIndices: new Set([0])
            };

            palette = h('div', {
                    id: 'cc-palette',
                    class: 'cc-palette-overlay',
                    style: 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; z-index: 2147483647; background-color: rgba(0, 0, 0, 0.65); backdrop-filter: blur(4px);',
                    onclick: (e) => { if (e.target.id === 'cc-palette') Patens.Palette.toggle(); },
                    onkeydown: (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }
                },
                h('div', {
                        class: 'cc-palette-container',
                        style: 'position: relative; width: 880px; max-width: 92vw; height: 75vh; max-height: 700px; background: #18181b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.7); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
                    },
                    h('input', {
                        type: 'text',
                        id: 'cc-palette-input',
                        autocomplete: 'off',
                        placeholder: "Search documents in memory... (try 'docs', 'today' or 'from:github.com')",
                        style: 'position: absolute; top: 0; left: 0; width: 100%; height: 55px; padding: 0 20px; border: none; background: #18181b; color: white; font-size: 15px; outline: none; border-bottom: 1px solid #27272a; z-index: 5;',
                        oninput: Patens.Palette.handleSearchInput,
                        onkeydown: Patens.Palette.handleKeyboardNav
                    }),
                    h('div', {
                            id: 'cc-palette-results',
                            style: 'position: absolute; top: 55px; bottom: 45px; left: 0; width: 100%; display: flex; background: #18181b; z-index: 1;'
                        },
                        h('div', {
                            id: 'cc-results-list',
                            style: 'width: 44%; height: 100%; overflow-y: auto; padding: 8px; border-right: 1px solid #27272a; scrollbar-width: thin;',
                            onscroll: Patens.Palette.handleScroll
                        }),
                        h('div', {
                                id: 'cc-preview-panel',
                                style: 'width: 56%; height: 100%; overflow-y: auto; padding: 20px; background: #121215; word-wrap: break-word; scrollbar-width: thin;'
                            },
                            h('div', { style: 'color: #52525b; text-align: center; margin-top: 80px; font-size: 13px;' }, 'Select an item to preview')
                        )
                    ),
                    h('div', {
                            id: 'cc-palette-hint',
                            style: 'position: absolute; bottom: 0; left: 0; width: 100%; height: 45px; padding: 0 20px; font-size: 12px; color: #71717a; border-top: 1px solid #27272a; display: flex; gap: 16px; align-items: center; background: #141417; z-index: 5;'
                        },
                        h('span', {}, h('span', { style: 'border: 1px solid #3f3f46; padding: 2px 5px; border-radius: 4px; background: #27272a; color: #e4e4e7; margin-right: 4px;' }, '↑↓'), 'Navigate'),
                        h('span', {}, h('span', { style: 'border: 1px solid #3f3f46; padding: 2px 5px; border-radius: 4px; background: #27272a; color: #e4e4e7; margin-right: 4px;' }, 'Shift + ↑↓'), 'Multi-Select'),
                        h('span', {}, h('span', { style: 'border: 1px solid #3f3f46; padding: 2px 5px; border-radius: 4px; background: #27272a; color: #e4e4e7; margin-right: 4px;' }, '←→'), 'Expand/Collapse'),
                        h('span', {}, h('span', { style: 'border: 1px solid #3f3f46; padding: 2px 5px; border-radius: 4px; background: #27272a; color: #e4e4e7; margin-right: 4px;' }, 'Enter'), 'Paste'),
                        h('span', {}, h('span', { style: 'border: 1px solid #3f3f46; padding: 2px 5px; border-radius: 4px; background: #27272a; color: #e4e4e7; margin-right: 4px;' }, 'Del'), 'Delete'),
                        h('span', {}, h('span', { style: 'border: 1px solid #3f3f46; padding: 2px 5px; border-radius: 4px; background: #27272a; color: #e4e4e7; margin-right: 4px;' }, 'Esc'), 'Close')
                    )
                )
            );

            document.body.appendChild(palette);
            Patens.State.ui = Patens.State.ui || {};
            Patens.State.ui.paletteOpen = true;

            restorePaletteFocus();
            Patens.Palette.fetchBatch();
        },

        handleSearchInput: (e) => {
            const query = e.target.value;
            clearTimeout(Patens.Palette._searchTimeout);

            Patens.Palette._searchTimeout = setTimeout(() => {
                const state = Patens.State.palette;
                if (!state) return;

                state.currentQuery = query;
                state.currentOffset = 0;
                state.hasMore = true;
                state.documents = [];
                state.expandedDocKeys = new Set();
                state.navigableList = [];
                state.selectedIndex = 0;
                state.selectionAnchor = 0;
                state.selectedIndices = new Set([0]);

                const list = document.getElementById('cc-results-list');
                const preview = document.getElementById('cc-preview-panel');
                if (list) list.textContent = '';
                if (preview) {
                    preview.textContent = '';
                    preview.appendChild(h('div', { style: 'color: #52525b; text-align: center; margin-top: 80px; font-size: 13px;' }, 'Select an item to preview'));
                }

                Patens.Palette.fetchBatch();
            }, 180);
        },

        handleKeyboardNav: async (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();

            const dialog = document.getElementById('cc-delete-dialog');

            if (e.key === 'Escape') {
                e.preventDefault();
                if (dialog) {
                    dialog.remove();
                    restorePaletteFocus();
                    return;
                }
                return Patens.Palette.toggle();
            }

            const state = Patens.State.palette || {};
            const navList = state.navigableList || [];
            const currentIndex = state.selectedIndex || 0;
            const currentItem = navList[currentIndex];

            // 1. VERTICAL NAVIGATION WITH SHIFT MULTI-SELECT
            if (e.key === 'ArrowDown') {
                if (dialog) return;
                e.preventDefault();
                Patens.Palette.blockHover = true;
                clearTimeout(Patens.Palette.hoverTimeout);
                Patens.Palette.hoverTimeout = setTimeout(() => Patens.Palette.blockHover = false, 150);

                Patens.Palette.selectNavIndex(currentIndex + 1, e.shiftKey);
                return;
            }
            if (e.key === 'ArrowUp') {
                if (dialog) return;
                e.preventDefault();
                Patens.Palette.blockHover = true;
                clearTimeout(Patens.Palette.hoverTimeout);
                Patens.Palette.hoverTimeout = setTimeout(() => Patens.Palette.blockHover = false, 150);

                Patens.Palette.selectNavIndex(currentIndex - 1, e.shiftKey);
                return;
            }

            // 2. HORIZONTAL EXPAND / COLLAPSE
            if (e.key === 'ArrowRight') {
                if (dialog || !currentItem) return;
                e.preventDefault();

                if (currentItem.type === 'document') {
                    if (!currentItem.isExpanded) {
                        Patens.Palette.toggleDocExpand(currentItem.docKey);
                    } else if (currentIndex + 1 < navList.length && navList[currentIndex + 1].type === 'child') {
                        Patens.Palette.selectNavIndex(currentIndex + 1, false);
                    }
                }
                return;
            }

            if (e.key === 'ArrowLeft') {
                if (dialog || !currentItem) return;
                e.preventDefault();

                if (currentItem.type === 'document' && currentItem.isExpanded) {
                    Patens.Palette.toggleDocExpand(currentItem.docKey);
                } else if (currentItem.type === 'child') {
                    const parentIdx = navList.findIndex((item, idx) => idx < currentIndex && item.type === 'document' && item.item === currentItem.parentDoc);
                    if (parentIdx !== -1) {
                        Patens.Palette.selectNavIndex(parentIdx, false);
                    }
                }
                return;
            }

            // 3. DELETE (GRANULAR & MULTI-SELECT)
            if (e.key === 'Delete' || (e.key === 'Backspace' && document.activeElement?.value === '')) {
                if (dialog || !currentItem) return;
                e.preventDefault();

                const selectedIndices = Array.from(state.selectedIndices || [currentIndex]);
                const selectedNavItems = selectedIndices
                    .sort((a, b) => a - b)
                    .map(i => navList[i])
                    .filter(Boolean);

                if (selectedNavItems.length > 0) {
                    Patens.Palette.requestDelete(selectedNavItems);
                }
                return;
            }

            // 4. ENTER (INJECT SELECTION)
            if (e.key === 'Enter') {
                e.preventDefault();
                if (dialog) {
                    const confirmBtn = document.getElementById('cc-confirm-delete-btn');
                    if (confirmBtn) confirmBtn.click();
                    return;
                }

                const selectedIndices = Array.from(state.selectedIndices || [currentIndex]);
                const selectedNavItems = selectedIndices
                    .sort((a, b) => a - b)
                    .map(i => navList[i])
                    .filter(Boolean);

                if (selectedNavItems.length > 0) {
                    const parentDocsInSelection = new Set(
                        selectedNavItems.filter(n => n.type === 'document').map(n => n.item)
                    );

                    const itemsToInject = [];
                    selectedNavItems.forEach(n => {
                        if (n.type === 'document') {
                            itemsToInject.push(n.item);
                        } else if (n.type === 'child') {
                            if (!parentDocsInSelection.has(n.parentDoc)) {
                                itemsToInject.push(n.item);
                            }
                        }
                    });

                    Logger.info(`Enter pressed; injecting ${itemsToInject.length} selected item(s).`);
                    Patens.Palette.executeInjection(itemsToInject);
                }
            }
        },

        handleScroll: (e) => {
            const list = e.target;
            const state = Patens.State.palette || {};
            if (!Patens.Palette._isFetching && state.hasMore && list.scrollTop + list.clientHeight >= list.scrollHeight - 30) {
                Patens.Palette.fetchBatch();
            }
        },

        fetchBatch: async () => {
            const state = Patens.State.palette || {};
            if (Patens.Palette._isFetching || !state.hasMore) return;

            const listContainer = document.getElementById('cc-results-list');
            if (!listContainer) return;

            Patens.Palette._isFetching = true;

            let spinner = document.getElementById('cc-search-spinner');
            if (!spinner && (!state.documents || state.documents.length === 0)) {
                spinner = h('div', {
                    id: 'cc-search-spinner',
                    style: 'color: #71717a; padding: 16px; text-align: center; font-size: 12px;'
                }, 'Loading documents...');
                listContainer.appendChild(spinner);
            }

            try {
                const tzOffset = new Date().getTimezoneOffset();
                let sq = (state.currentQuery || "").trim();
                let domainFilter = "";

                const domainMatch = sq.match(/from:([^\s]+)/);
                if (domainMatch) {
                    domainFilter = domainMatch[1];
                    sq = sq.replace(domainMatch[0], "").trim();
                }

                const batchSize = 15;
                const searchUrl = `/api/v1/search?q=${encodeURIComponent(sq)}&url_filter=${encodeURIComponent(domainFilter)}&limit=${batchSize}&offset=${state.currentOffset}&tz_offset=${tzOffset}`;

                let data;
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    const resp = await chrome.runtime.sendMessage({
                        action: "proxy_fetch",
                        url: searchUrl,
                        responseType: 'json'
                    });
                    data = resp?.data;
                } else if (Patens.API?.fetchProxy) {
                    data = await Patens.API.fetchProxy(searchUrl, 'json');
                }

                document.getElementById('cc-search-spinner')?.remove();

                const fetchedDocs = data?.results || [];
                state.currentOffset = (state.currentOffset || 0) + fetchedDocs.length;

                if (fetchedDocs.length < batchSize) {
                    state.hasMore = false;
                }

                if (!state.documents) state.documents = [];
                const existingKeys = new Set(state.documents.map(d => d.url || d.title));
                const uniqueNew = fetchedDocs.filter(d => !existingKeys.has(d.url || d.title));

                if (uniqueNew.length > 0) {
                    state.documents.push(...uniqueNew);
                    Patens.Palette.rebuildNavigableList();
                    Patens.Palette.renderResultsList();
                } else if (state.documents.length === 0) {
                    listContainer.textContent = '';
                    listContainer.appendChild(h('div', {
                        style: 'color: #71717a; text-align: center; padding: 40px 10px; font-size: 13px;'
                    }, 'No matching memory documents found.'));
                }

            } catch (err) {
                Logger.error("Failed to fetch documents:", err);
                document.getElementById('cc-search-spinner')?.remove();
            } finally {
                Patens.Palette._isFetching = false;
            }
        },

        renderResultsList: () => {
            const listContainer = document.getElementById('cc-results-list');
            const state = Patens.State.palette || {};
            if (!listContainer) return;

            listContainer.textContent = '';
            const navList = state.navigableList || [];

            navList.forEach((navItem, absoluteIndex) => {
                let rowEl;

                if (navItem.type === 'document') {
                    const doc = navItem.item;
                    let domain = "";
                    try {
                        if (doc.url) domain = new URL(doc.url).hostname.replace('www.', '');
                    } catch (_) {}

                    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
                    const clipCount = doc.clip_count || (doc.clips ? doc.clips.length : 1);
                    const tokens = doc.tokens || Math.ceil((doc.content || '').length / 4);

                    rowEl = h('div', {
                            class: 'cc-palette-item cc-palette-doc',
                            'data-nav-index': absoluteIndex,
                            style: `
                                padding: 9px 10px;
                                margin-bottom: 2px;
                                cursor: pointer;
                                border-radius: 8px;
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                background: transparent;
                                border: 1px solid transparent;
                                transition: background 0.1s ease;
                                user-select: none;
                            `,
                            onmouseenter: () => {
                                if (Patens.Palette.blockHover) return;
                                Patens.Palette.selectNavIndex(absoluteIndex, false);
                            },
                            onclick: (e) => Patens.Palette.selectNavIndex(absoluteIndex, e.shiftKey),
                            ondblclick: () => Patens.Palette.toggleDocExpand(navItem.docKey)
                        },
                        h('button', {
                            title: navItem.isExpanded ? 'Collapse' : 'Expand paragraphs (or press Right Arrow)',
                            style: `
                                background: transparent;
                                border: none;
                                color: #71717a;
                                cursor: pointer;
                                padding: 2px 4px;
                                font-size: 9px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                transform: ${navItem.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};
                                transition: transform 0.15s ease, color 0.15s ease;
                                flex-shrink: 0;
                            `,
                            onclick: (e) => {
                                e.stopPropagation();
                                Patens.Palette.toggleDocExpand(navItem.docKey);
                            }
                        }, '▶'),
                        faviconUrl ? h('img', {
                            src: faviconUrl,
                            style: 'width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0;'
                        }) : h('span', { style: 'font-size: 14px; flex-shrink: 0;' }, '📄'),
                        h('div', { style: 'flex-grow: 1; min-width: 0;' },
                            h('div', {
                                style: 'font-size: 13px; font-weight: 500; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
                            }, doc.title || 'Untitled Document'),
                            h('div', { style: 'display: flex; align-items: center; gap: 6px; margin-top: 2px;' },
                                h('span', { style: 'font-size: 11px; color: #a1a1aa;' }, domain || 'Local'),
                                h('span', {
                                    style: 'font-size: 10px; background: rgba(99, 102, 241, 0.15); color: #818cf8; padding: 1px 5px; border-radius: 4px; font-weight: 600;'
                                }, `${clipCount} clips • ~${tokens}t`)
                            )
                        )
                    );

                } else {
                    const clip = navItem.item;
                    const snippetPreview = (clip.content || '').replace(/\s+/g, ' ').trim();
                    const clipTokens = clip.tokens || Math.ceil(snippetPreview.length / 4);

                    rowEl = h('div', {
                            class: 'cc-palette-item cc-palette-child',
                            'data-nav-index': absoluteIndex,
                            style: `
                                padding: 6px 10px 6px 28px;
                                margin-bottom: 2px;
                                cursor: pointer;
                                border-radius: 6px;
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                background: transparent;
                                border: 1px solid transparent;
                                transition: background 0.1s ease;
                                position: relative;
                            `,
                            onmouseenter: () => {
                                if (Patens.Palette.blockHover) return;
                                Patens.Palette.selectNavIndex(absoluteIndex, false);
                            },
                            onclick: (e) => Patens.Palette.selectNavIndex(absoluteIndex, e.shiftKey)
                        },
                        h('div', {
                            style: 'position: absolute; left: 16px; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.1);'
                        }),
                        h('span', { style: 'font-size: 11px; color: #818cf8; font-weight: 600; flex-shrink: 0;' }, `¶ ${navItem.clipIndex + 1}`),
                        h('div', {
                            style: 'flex-grow: 1; min-width: 0; font-size: 12px; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
                        }, snippetPreview),
                        h('span', { style: 'font-size: 10px; color: #52525b; flex-shrink: 0;' }, `~${clipTokens}t`)
                    );
                }

                listContainer.appendChild(rowEl);
            });

            // Automatically select & preview the active index (defaults to index 0 on load)
            if (navList.length > 0) {
                const targetIdx = Math.max(0, Math.min(state.selectedIndex || 0, navList.length - 1));
                Patens.Palette.selectNavIndex(targetIdx, false);
            }
        },

        selectNavIndex: (index, shiftKey = false) => {
            const state = Patens.State.palette || {};
            const navList = state.navigableList || [];
            if (!navList.length) return;

            const safeIndex = Math.max(0, Math.min(index, navList.length - 1));

            if (!shiftKey) {
                state.selectionAnchor = safeIndex;
                state.selectedIndices = new Set([safeIndex]);
            } else {
                if (!state.selectedIndices) state.selectedIndices = new Set();
                state.selectedIndices.clear();
                const start = Math.min(state.selectionAnchor ?? safeIndex, safeIndex);
                const end = Math.max(state.selectionAnchor ?? safeIndex, safeIndex);
                for (let i = start; i <= end; i++) {
                    state.selectedIndices.add(i);
                }
            }

            state.selectedIndex = safeIndex;
            Patens.Palette.updateSelectionVisuals();

            const currentItem = navList[safeIndex];
            Patens.Palette.renderPreview(currentItem, state.selectedIndices);
        },

        updateSelectionVisuals: () => {
            const state = Patens.State.palette || {};
            const selectedSet = state.selectedIndices || new Set([state.selectedIndex || 0]);

            document.querySelectorAll('.cc-palette-item').forEach(el => {
                const idx = parseInt(el.getAttribute('data-nav-index'), 10);
                if (selectedSet.has(idx)) {
                    el.style.backgroundColor = 'rgba(99, 102, 241, 0.16)';
                    el.style.borderColor = 'rgba(99, 102, 241, 0.4)';
                    if (idx === state.selectedIndex) {
                        el.scrollIntoView({ block: 'nearest' });
                    }
                } else {
                    el.style.backgroundColor = 'transparent';
                    el.style.borderColor = 'transparent';
                }
            });
        },

        renderPreview: (navItem, selectedIndicesSet) => {
            if (!navItem) return;
            const panel = document.getElementById('cc-preview-panel');
            if (!panel) return;

            panel.textContent = '';

            const selectedCount = selectedIndicesSet ? selectedIndicesSet.size : 1;

            if (navItem.type === 'document') {
                const doc = navItem.item;
                let domain = "";
                try {
                    if (doc.url) domain = new URL(doc.url).hostname;
                } catch (_) {}

                const count = doc.clip_count || (doc.clips ? doc.clips.length : 1);
                const tokens = doc.tokens || Math.ceil((doc.content || '').length / 4);

                panel.appendChild(h('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' },
                    h('a', {
                        href: doc.url || '#',
                        target: '_blank',
                        style: 'font-size: 12px; color: #818cf8; text-decoration: none; display: flex; align-items: center; gap: 4px;'
                    }, `🔗 ${domain || 'Local Document'}`),
                    h('span', {
                        style: `font-size: 11px; background: ${selectedCount > 1 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(99, 102, 241, 0.12)'}; color: ${selectedCount > 1 ? '#fbbf24' : '#a5b4fc'}; padding: 2px 8px; border-radius: 4px; font-weight: 500;`
                    }, selectedCount > 1 ? `Selected ${selectedCount} items • ${count} paragraphs • ~${tokens}t` : `Full Document • ${count} paragraphs • ~${tokens}t`)
                ));
                panel.appendChild(h('h3', { style: 'margin: 0 0 14px 0; font-size: 15px; font-weight: 600; color: #f4f4f5; line-height: 1.4;' }, doc.title || 'Untitled Document'));
                panel.appendChild(h('div', {
                    style: 'white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #d4d4d8; line-height: 1.6; background: rgba(0,0,0,0.25); padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);'
                }, doc.content || ''));

            } else {
                const clip = navItem.item;
                const parent = navItem.parentDoc;
                const totalClips = parent.clip_count || (parent.clips ? parent.clips.length : 1);
                const clipTokens = clip.tokens || Math.ceil((clip.content || '').length / 4);

                panel.appendChild(h('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' },
                    h('span', { style: 'font-size: 12px; color: #818cf8; font-weight: 600;' }, `Paragraph ${navItem.clipIndex + 1} of ${totalClips}`),
                    h('span', {
                        style: `font-size: 11px; background: ${selectedCount > 1 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.06)'}; color: ${selectedCount > 1 ? '#fbbf24' : '#a1a1aa'}; padding: 2px 8px; border-radius: 4px;`
                    }, selectedCount > 1 ? `Selected ${selectedCount} items • ~${clipTokens}t` : `~${clipTokens} tokens`)
                ));
                panel.appendChild(h('h4', { style: 'margin: 0 0 12px 0; font-size: 14px; font-weight: 500; color: #e4e4e7;' }, `From: ${parent.title || 'Untitled'}`));
                panel.appendChild(h('div', {
                    style: 'white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #d4d4d8; line-height: 1.6; background: rgba(0,0,0,0.25); padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);'
                }, clip.content || ''));
            }
        }
    };
})();