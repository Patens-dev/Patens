// extension/content/main.js

import './config.js';
import './utils.js';
import './cart.js';
import './injector.js';
import './palette.js';
import './main.js';

(() => {
    window.Patens = window.Patens || {};

    // 0. IMMEDIATE EXTENSION DOM MARKERS (For welcome.html auto-detection)
    try {
        if (document.documentElement) {
            document.documentElement.setAttribute('data-patens-extension', 'true');
            document.documentElement.setAttribute('data-patens-installed', 'true');
        }
        window.__PATENS_EXTENSION__ = true;
    } catch (e) {
        // Suppress safely if context is restricted
    }

    // 1. LOGGER INITIALIZATION
    const Logger = Patens.LoggerFactory
        ? Patens.LoggerFactory("[Patens Main Events]")
        : {debug: console.debug, info: console.info, warn: console.warn, error: console.error};

    Logger.info("Initializing Content Script Event Listeners...");

    // ==========================================
    // 2. STORAGE & STATE INITIALIZATION
    // ==========================================
    try {
        Patens.State = Patens.State || {};
        Patens.State.hotkeys = Patens.State.hotkeys || {};

        chrome.storage.local.get(['hotkeys'], (res) => {
            if (chrome.runtime.lastError) {
                Logger.error("Failed to fetch initial hotkeys from storage:", chrome.runtime.lastError);
                return;
            }
            if (res.hotkeys) {
                Patens.State = Patens.State || {};
                Patens.State.hotkeys = {...Patens.State.hotkeys, ...res.hotkeys};
                Logger.debug("Hotkeys initialized from local storage.");
            }
        });
    } catch (initErr) {
        Logger.error("Uncaught exception during hotkey state initialization:", initErr);
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;

        if (changes.hotkeys) {
            Patens.State = Patens.State || {};
            Patens.State.hotkeys = {...(Patens.State.hotkeys || {}), ...changes.hotkeys.newValue};
            Logger.info("Hotkeys state updated via storage listener.");
        }

        if (changes.contextCart) {
            Patens.Cart?.renderUI?.();
        }
    });

    // ==========================================
    // 3. HELPER FUNCTIONS & CLEANUP
    // ==========================================
    const clearHoverHighlights = () => {
        document.querySelectorAll('.cc-highlight-hover').forEach(el => {
            el.classList.remove('cc-highlight-hover');
        });
    };

    window.addEventListener('blur', clearHoverHighlights);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearHoverHighlights();
    });

    // ==========================================
    // 4. MESSAGE LISTENER
    // ==========================================
    chrome.runtime.onMessage.addListener((request) => {
        if (request.target === 'offscreen') return false;

        if (request.action === "open_palette") {
            if (Patens.Palette && typeof Patens.Palette.toggle === 'function') {
                Logger.info("Command 'open_palette' received; toggling palette overlay.");
                Patens.Palette.toggle();
            } else {
                Logger.warn("Received 'open_palette' but Patens.Palette is not loaded yet.");
            }
        }
        if (request.action === "ping" || request.type === "PATENS_PING") {
            window.postMessage({source: 'patens-extension', type: 'PATENS_PONG', patensInstalled: true}, '*');
        }
    });

    // ==========================================
    // 5. KEYBOARD LISTENERS
    // ==========================================
    window.addEventListener('beforeinput', (e) => {
        const isCartShortcut = (e.ctrlKey || e.metaKey) && e.shiftKey;
        if (isCartShortcut) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    }, true);

    window.addEventListener('keydown', (e) => {
        const isEnterKey = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';

        if (e.ctrlKey && e.shiftKey && isEnterKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const activeEl = document.activeElement;
            if (activeEl && (activeEl.isContentEditable || typeof activeEl.blur === 'function')) {
                activeEl.blur();
            }

            Logger.info("Hotkey triggered: Fast-Forward Cart Commit");
            chrome.storage.local.get(['contextCart'], async (result) => {
                const cart = result.contextCart || [];
                if (cart.length > 0) {
                    const response = await Patens.API?.ingestBatch(cart);
                    if (response?.success) {
                        Patens.Utils?.showNotification("✨ Context Committed!", '#006400', window.innerWidth / 2 - 50, window.innerHeight - 50);
                        chrome.storage.local.set({contextCart: []});
                    }
                }
            });
            return;
        }

        const paletteHotkey = Patens.State?.hotkeys?.palette;
        if (paletteHotkey && Patens.Utils?.checkModifiers(e, paletteHotkey)) {
            const configuredKey = paletteHotkey.key?.toLowerCase();
            if (configuredKey && e.key.toLowerCase() === configuredKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const activeEl = document.activeElement;
                if (activeEl && (activeEl.isContentEditable || typeof activeEl.blur === 'function')) {
                    activeEl.blur();
                }

                if (Patens.Palette?.toggle) {
                    Logger.info("Hotkey triggered: Toggle Palette");
                    Patens.Palette.toggle();

                    setTimeout(() => {
                        const paletteInput = document.querySelector('#patens-palette-input')
                            || Patens.Palette.shadowRoot?.querySelector('input');
                        paletteInput?.focus();
                    }, 50);
                } else {
                    Logger.warn("Palette toggle hotkey pressed, but Patens.Palette module is undefined.");
                }
            }
        }
    }, true);

    // ==========================================
    // 6. MOUSE INTERACTION LISTENERS
    // ==========================================
    document.addEventListener('click', (e) => {
        const captureHotkey = Patens.State?.hotkeys?.capture || {ctrl: true, shift: true, alt: false, meta: false};
        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey)) {
            const validTags = Patens.Config?.VALID_TAGS || [];
            const isLink = e.target?.closest?.('a');
            const isValidTag = e.target?.tagName && (validTags.includes(e.target.tagName) || e.target.closest?.(validTags.join(',')));

            if (isLink || isValidTag || e.target?.closest?.('.patens-pdf-block') || e.target?.closest?.('.patens-pdf-figure') || document.querySelector('.patens-pdf-block')) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, true);

    document.addEventListener('mouseover', (e) => {
        const captureHotkey = Patens.State?.hotkeys?.capture || {ctrl: true, shift: true, alt: false, meta: false};
        const validTags = Patens.Config?.VALID_TAGS || [];

        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey)) {
            const pdfFigure = e.target?.closest?.('.patens-pdf-figure');
            const pdfBlock = e.target?.closest?.('.patens-pdf-block');

            if (pdfFigure) {
                pdfFigure.classList.add('cc-highlight-hover');
            } else if (pdfBlock) {
                pdfBlock.classList.add('cc-highlight-hover');
            } else if (e.target?.tagName && validTags.includes(e.target.tagName)) {
                e.target.classList.add('cc-highlight-hover');
            }
        }
    }, true);

    document.addEventListener('mouseout', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('cc-highlight-hover')) {
            e.target.classList.remove('cc-highlight-hover');
        }
        const pdfFigure = e.target?.closest?.('.patens-pdf-figure');
        if (pdfFigure && pdfFigure.classList.contains('cc-highlight-hover')) {
            pdfFigure.classList.remove('cc-highlight-hover');
        }
        const pdfBlock = e.target?.closest?.('.patens-pdf-block');
        if (pdfBlock && pdfBlock.classList.contains('cc-highlight-hover')) {
            pdfBlock.classList.remove('cc-highlight-hover');
        }
    }, true);

    document.addEventListener('mousedown', async (e) => {
        if (!e.target || e.target.closest?.('.cc-cart-btn') || e.target.closest?.('.cc-cart-modal') || e.target.closest?.('.cc-palette-overlay')) return;

        const captureHotkey = Patens.State?.hotkeys?.capture || {ctrl: true, shift: true, alt: false, meta: false};

        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey)) {
            console.log("[Patens Main] 🎯 [STEP 1] Hotkey + Click intercepted!", {
                targetTag: e.target.tagName,
                currentUrl: window.location.href,
                hasSelection: !!window.getSelection()?.toString().trim()
            });

            e.preventDefault();
            e.stopPropagation();

            const startTime = performance.now();
            let textSelection = window.getSelection() ? window.getSelection().toString().trim() : "";
            const isPdfPage = Patens.DocumentParser?.isDocumentTarget(window.location.href);
            const targetImg = Patens.Utils?.findUnderlyingImage(e.target);
            const targetLink = e.target?.closest?.('a');
            const linkUrl = targetLink ? targetLink.href : window.location.href;

            const pdfFigure = e.target?.closest?.('.patens-pdf-figure');
            const hasPdfBlocks = !!document.querySelector('.patens-pdf-block');

            let itemsToSave = [];

            // 📋 Clipboard Fallback for native PDF plugin pages
            if (isPdfPage && !hasPdfBlocks && !textSelection && !pdfFigure) {
                console.log("[Patens Main] Native PDF tab detected with empty selection. Attempting clipboard fallback...");
                try {
                    const clipboardText = await navigator.clipboard.readText();
                    if (clipboardText && clipboardText.trim().length > 0) {
                        textSelection = clipboardText.trim();
                        console.log(`[Patens Main] ✅ Retrieved ${textSelection.length} chars from clipboard fallback.`);
                    }
                } catch (clipErr) {
                    console.warn("[Patens Main] ⚠️ Clipboard read restricted:", clipErr.message);
                }
            }

            // 🖼️ 1. SINGLE PDF FIGURE IMAGE CAPTURE
            if (pdfFigure) {
                console.log("[Patens Main] Branch 0: Single PDF Figure overlay clicked!");
                const imageB64 = pdfFigure.src;
                const figureAlt = pdfFigure.alt || pdfFigure.title || `Figure from ${document.title}`;

                itemsToSave.push({
                    text: figureAlt,
                    title: document.title || "PDF Figure",
                    isImage: true,
                    base64Data: imageB64,
                    element: pdfFigure
                });

                Patens.Utils?.showNotification("🖼️ Figure Saved to Cart!", '#10b981', e.clientX, e.clientY);
            }
            // 🔤 2. HIGHLIGHTED / CLIPBOARD TEXT SELECTION
            else if (textSelection) {
                const smartTitle = Patens.Utils?.getSmartTitle() || document.title || "PDF Excerpt";
                console.log(`[Patens Main] Branch A: Processing text snippet selection (${textSelection.length} chars)`);

                itemsToSave.push({
                    text: textSelection,
                    title: isPdfPage ? `📄 ${smartTitle} (Excerpt)` : smartTitle,
                    isImage: false,
                    element: e.target
                });

                try {
                    window.getSelection()?.removeAllRanges();
                } catch (err) {
                }
            }
            // 📄 3. DOCUMENT LINK CLICKED ON HTML PAGE
            else if (targetLink && Patens.DocumentParser?.isDocumentTarget(linkUrl)) {
                console.log(`[Patens Main] Branch B: Document link target clicked -> ${linkUrl}`);
                Patens.Utils?.showNotification("📄 Parsing Document Content...", '#3b82f6', e.clientX, e.clientY);

                try {
                    const parsedDoc = await Patens.DocumentParser.parseUrlOrFile(linkUrl);
                    if (parsedDoc && parsedDoc.text) {
                        itemsToSave.push({
                            text: parsedDoc.text,
                            title: parsedDoc.title,
                            isImage: false,
                            element: targetLink
                        });
                        Patens.Utils?.showNotification("✨ Document Saved to Memory!", '#10b981', e.clientX, e.clientY);
                    }
                } catch (docErr) {
                    console.error("[Patens Main] ❌ Branch B failed to parse document link:", docErr);
                    Patens.Utils?.showNotification("⚠️ Failed to parse document", '#ef4444', e.clientX, e.clientY);
                }
            }
            // 📑 4. CONVERTED PDF VIEWER PAGE INTERACTION (Has .patens-pdf-block elements)
            else if (hasPdfBlocks) {
                const clickedBlock = e.target.closest('.patens-pdf-block');
                const docTitle = document.title || Patens.Utils?.getSmartTitle() || "PDF Document";

                if (clickedBlock) {
                    // Clicked a specific paragraph or math block
                    const blockText = clickedBlock.dataset.cleanText || clickedBlock.innerText?.trim() || "";
                    const mediaB64 = clickedBlock.dataset.mediaB64 || null; // Reads formula crop image attribute

                    if (blockText || mediaB64) {
                        console.log(`[Patens Main] Branch C1: Captured specific PDF paragraph block (${blockText.length} chars, Formula Image: ${!!mediaB64})`);
                        itemsToSave.push({
                            text: blockText,
                            title: docTitle,
                            isImage: !!mediaB64,
                            base64Data: mediaB64,
                            element: clickedBlock
                        });
                    }
                } else {
                    // Clicked white space / background -> Query BOTH text blocks AND figure images in DOM document order
                    const allDocElements = Array.from(document.querySelectorAll('.patens-pdf-block, .patens-pdf-figure'));

                    allDocElements.forEach(el => {
                        if (el.classList.contains('patens-pdf-figure')) {
                            const imageB64 = el.src;
                            const figureAlt = el.alt || el.title || `Figure from ${docTitle}`;
                            if (imageB64) {
                                itemsToSave.push({
                                    text: figureAlt,
                                    title: docTitle,
                                    isImage: true,
                                    base64Data: imageB64,
                                    element: el
                                });
                            }
                        } else if (el.classList.contains('patens-pdf-block')) {
                            const blockText = el.dataset.cleanText || el.innerText?.trim() || "";
                            const mediaB64 = el.dataset.mediaB64 || null;

                            if (blockText || mediaB64) {
                                itemsToSave.push({
                                    text: blockText,
                                    title: docTitle,
                                    isImage: !!mediaB64,
                                    base64Data: mediaB64,
                                    element: el
                                });
                            }
                        }
                    });

                    if (itemsToSave.length > 0) {
                        console.log(`[Patens Main] Branch C2: Clicked white space. Bulk captured ${itemsToSave.length} total items (Text blocks + Figures).`);
                        Patens.Utils?.showNotification(`✨ Captured Full PDF (${itemsToSave.length} Text & Figure Items)!`, '#3b82f6', e.clientX, e.clientY);
                    }
                }
            }
            // 📑 5. CURRENT TAB IS DIRECT NATIVE PDF
            else if (isPdfPage) {
                console.log(`[Patens Main] Branch D: Current tab is direct native PDF. Triggering full document parse -> ${window.location.href}`);
                Patens.Utils?.showNotification("📄 Parsing Full PDF Document...", '#3b82f6', e.clientX, e.clientY);

                try {
                    const parsedDoc = await Patens.DocumentParser.parseUrlOrFile(window.location.href);
                    if (parsedDoc && parsedDoc.text) {
                        itemsToSave.push({
                            text: parsedDoc.text,
                            title: parsedDoc.title,
                            isImage: false,
                            element: document.body
                        });
                        Patens.Utils?.showNotification("✨ Full PDF Saved!", '#10b981', e.clientX, e.clientY);
                    }
                } catch (docErr) {
                    console.error("[Patens Main] ❌ Branch D failed to parse current PDF page:", docErr);
                    Patens.Utils?.showNotification("⚠️ Failed to parse PDF", '#ef4444', e.clientX, e.clientY);
                }
            }
            // 🖼️ 6. REGULAR HTML IMAGE CAPTURE
            else if (targetImg) {
                console.log("[Patens Main] Branch E: Processing standard HTML image element.");
                try {
                    const base64Data = await Patens.Utils?.getBase64Image(targetImg);
                    itemsToSave.push({
                        text: targetImg.alt || targetImg.title || `Image snippet from ${Patens.Utils?.getSmartTitle()}`,
                        title: Patens.Utils?.getSmartTitle(),
                        isImage: true,
                        base64Data: base64Data,
                        element: targetImg
                    });
                } catch (err) {
                    console.error("[Patens Main] ❌ Branch E image capture failed:", err);
                }
            }
            // 📦 7. STANDARD DOM ELEMENT FALLBACK
            else {
                console.log("[Patens Main] Branch F: Fallback standard HTML element click processing.");
                const tagName = e.target.tagName;
                if (tagName) {
                    const isCustomElement = tagName.includes('-');
                    const containerTags = Patens.Config?.CONTAINER_TAGS || [];
                    const readableTags = Patens.Config?.READABLE_TAGS || [];
                    const minLength = Patens.Config?.MIN_TEXT_LENGTH || 0;

                    if (containerTags.includes(tagName) || isCustomElement || e.target.isContentEditable) {
                        const allReadable = Array.from(e.target.querySelectorAll(readableTags.join(',')));
                        const topLevel = allReadable.filter(el => !allReadable.some(parent => parent.contains(el) && parent !== el));

                        if (topLevel.length > 0) {
                            topLevel.forEach(child => {
                                const childText = child.innerText?.trim() || "";
                                if (childText.length > minLength) itemsToSave.push({
                                    text: childText,
                                    title: Patens.Utils?.getSmartTitle(),
                                    isImage: false,
                                    element: child
                                });
                            });
                        } else {
                            const text = e.target.innerText?.trim() || "";
                            if (text.length > minLength) itemsToSave.push({
                                text,
                                title: Patens.Utils?.getSmartTitle(),
                                isImage: false,
                                element: e.target
                            });
                        }
                    } else if (readableTags.includes(tagName) || tagName === 'SPAN') {
                        const text = e.target.innerText?.trim() || "";
                        if (text.length > minLength) itemsToSave.push({
                            text,
                            title: Patens.Utils?.getSmartTitle(),
                            isImage: false,
                            element: e.target
                        });
                    }
                }
            }

            if (itemsToSave.length > 0) {
                console.log(`[Patens Main] 💾 [STEP 6] Saving ${itemsToSave.length} extracted items to storage cart... (${(performance.now() - startTime).toFixed(2)}ms)`);
                Patens.Cart?.saveBulkToCartDirectly?.(itemsToSave, e.clientX, e.clientY);
                clearHoverHighlights();
            } else {
                console.warn("[Patens Main] ⚠️ Click event processed, but 0 items were extracted to save.");
            }
        }
    }, true);

    document.addEventListener('mouseup', (e) => {
        if (!e.target || e.target.closest?.('.cc-selection-tooltip') || e.target.closest?.('.cc-palette-overlay') || e.target.closest?.('.cc-cart-modal')) return;

        try {
            const selection = window.getSelection();
            if (!selection) return;

            const text = selection.toString().trim();
            document.getElementById('cc-selection-tooltip')?.remove();

            if (text.length > 0 && !e.ctrlKey && !e.shiftKey) {
                if (selection.rangeCount === 0) return;
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                if (rect.width === 0 && rect.height === 0) return;

                const tooltip = document.createElement('div');
                tooltip.id = 'cc-selection-tooltip';
                tooltip.className = 'cc-selection-tooltip';
                tooltip.innerHTML = '✨ Save Context';
                tooltip.style.cssText = `top: ${window.scrollY + rect.top - 45}px; left: ${window.scrollX + rect.left + (rect.width / 2) - 60}px; z-index: 2147483647; position: absolute;`;

                tooltip.onmousedown = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    Patens.Cart?.saveBulkToCartDirectly?.([{
                        text,
                        title: Patens.Utils?.getSmartTitle(),
                        isImage: false,
                        element: null
                    }], ev.clientX, ev.clientY);

                    tooltip.innerHTML = '✓ Saved';
                    tooltip.style.background = '#10b981';

                    setTimeout(() => {
                        tooltip.remove();
                        try {
                            selection.removeAllRanges();
                        } catch (err) {
                        }
                    }, 800);
                };
                (document.body || document.documentElement).appendChild(tooltip);
            }
        } catch (err) {
        }
    });

    // Boot UI
    try {
        Patens.Cart?.renderUI?.();
    } catch (err) {
        Logger.error("Error during initial UI boot:", err);
    }
})();