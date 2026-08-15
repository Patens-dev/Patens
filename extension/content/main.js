// extension/content/main.js

import './config.js';
import './utils.js';
import './cart.js';
import './injector.js';
import './palette.js';

(() => {
    window.Patens = window.Patens || {};

    // 0. IMMEDIATE EXTENSION DOM MARKERS
    try {
        if (document.documentElement) {
            document.documentElement.setAttribute('data-patens-extension', 'true');
            document.documentElement.setAttribute('data-patens-installed', 'true');
        }
        window.__PATENS_EXTENSION__ = true;
    } catch (e) {}

    // 1. LOGGER INITIALIZATION
    const Logger = Patens.LoggerFactory
        ? Patens.LoggerFactory("[Patens Main Events]")
        : { debug: console.debug, info: console.info, warn: console.warn, error: console.error };

    Logger.info("Initializing Content Script Event Listeners...");

    // ==========================================
    // 2. ACTIVE CARET & SELECTION SNAPSHOT HELPER
    // ==========================================
    const snapshotActiveCaretState = () => {
        Patens.State = Patens.State || {};
        Patens.State.editor = Patens.State.editor || {};

        const activeEl = document.activeElement;
        if (!activeEl) return;

        if (activeEl.closest?.('.cc-palette-overlay') || activeEl.closest?.('.cc-cart-modal')) return;

        if (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') {
            Patens.State.editor.activeInputElement = activeEl;
            Patens.State.editor.selectionStart = activeEl.selectionStart;
            Patens.State.editor.selectionEnd = activeEl.selectionEnd;
            Patens.State.editor.savedRange = null;
        } else if (activeEl.isContentEditable || activeEl.getAttribute('contenteditable') === 'true') {
            Patens.State.editor.activeInputElement = activeEl;
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                try {
                    Patens.State.editor.savedRange = sel.getRangeAt(0).cloneRange();
                } catch (_) {}
            }
        }
    };

    document.addEventListener('selectionchange', snapshotActiveCaretState, { passive: true });
    document.addEventListener('focusin', snapshotActiveCaretState, { passive: true });

    // ==========================================
    // 3. STORAGE & STATE INITIALIZATION
    // ==========================================
    try {
        Patens.State = Patens.State || {};
        Patens.State.hotkeys = Patens.State.hotkeys || {};

        chrome.storage.local.get(['hotkeys'], (res) => {
            if (chrome.runtime.lastError) return;
            if (res.hotkeys) {
                Patens.State = Patens.State || {};
                Patens.State.hotkeys = { ...Patens.State.hotkeys, ...res.hotkeys };
            }
        });
    } catch (initErr) {
        Logger.error("Uncaught exception during hotkey state initialization:", initErr);
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes.hotkeys) {
            Patens.State = Patens.State || {};
            Patens.State.hotkeys = { ...(Patens.State.hotkeys || {}), ...changes.hotkeys.newValue };
        }
        if (changes.contextCart) {
            Patens.Cart?.renderUI?.();
        }
    });

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
            snapshotActiveCaretState();
            if (Patens.Palette && typeof Patens.Palette.toggle === 'function') {
                Patens.Palette.toggle();
            }
        }
        if (request.action === "ping" || request.type === "PATENS_PING") {
            window.postMessage({ source: 'patens-extension', type: 'PATENS_PONG', patensInstalled: true }, '*');
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

        // Fast-Forward Cart Commit (Ctrl+Shift+Enter)
        if (e.ctrlKey && e.shiftKey && isEnterKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            chrome.storage.local.get(['contextCart'], async (result) => {
                const cart = result.contextCart || [];
                if (cart.length > 0) {
                    const response = await Patens.API?.ingestBatch(cart);
                    if (response?.success) {
                        Patens.Utils?.showNotification("✨ Context Committed!", '#006400', window.innerWidth / 2 - 50, window.innerHeight - 50);
                        chrome.storage.local.set({ contextCart: [] });
                    }
                }
            });
            return;
        }

        // Toggle Palette Shortcut (Ctrl+Shift+K)
        const paletteHotkey = Patens.State?.hotkeys?.palette;
        if (paletteHotkey && Patens.Utils?.checkModifiers(e, paletteHotkey)) {
            const configuredKey = paletteHotkey.key?.toLowerCase();
            if (configuredKey && e.key.toLowerCase() === configuredKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                snapshotActiveCaretState();

                if (Patens.Palette?.toggle) {
                    Logger.info("Hotkey triggered: Toggle Palette");
                    Patens.Palette.toggle();
                }
            }
        }
    }, true);

    // ==========================================
    // 6. MOUSE CAPTURE & HOVER LISTENERS
    // ==========================================
    document.addEventListener('click', (e) => {
        const captureHotkey = Patens.State?.hotkeys?.capture || { ctrl: true, shift: true, alt: false, meta: false };
        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    document.addEventListener('mouseover', (e) => {
        const captureHotkey = Patens.State?.hotkeys?.capture || { ctrl: true, shift: true, alt: false, meta: false };
        if (!Patens.Utils?.checkModifiers(e, captureHotkey)) return;

        const target = e.target;
        if (!target || target.closest?.('.cc-cart-btn') || target.closest?.('.cc-cart-modal') || target.closest?.('.cc-palette-overlay')) return;

        const pdfFigure = target.closest?.('.patens-pdf-figure');
        const pdfBlock = target.closest?.('.patens-pdf-block');
        const semanticContainer = Patens.Utils?.getSemanticContainer?.(target);

        if (pdfFigure) {
            pdfFigure.classList.add('cc-highlight-hover');
        } else if (pdfBlock) {
            pdfBlock.classList.add('cc-highlight-hover');
        } else if (semanticContainer) {
            semanticContainer.classList.add('cc-highlight-hover');
        } else {
            target.classList.add('cc-highlight-hover');
        }
    }, true);

    document.addEventListener('mouseout', (e) => {
        if (e.target) {
            e.target.classList?.remove('cc-highlight-hover');
            const semanticContainer = Patens.Utils?.getSemanticContainer?.(e.target);
            if (semanticContainer) semanticContainer.classList?.remove('cc-highlight-hover');
        }
        clearHoverHighlights();
    }, true);

    document.addEventListener('mousedown', async (e) => {
        if (!e.target || e.target.closest?.('.cc-cart-btn') || e.target.closest?.('.cc-cart-modal') || e.target.closest?.('.cc-palette-overlay')) return;

        const captureHotkey = Patens.State?.hotkeys?.capture || { ctrl: true, shift: true, alt: false, meta: false };

        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey)) {
            e.preventDefault();
            e.stopPropagation();

            let textSelection = window.getSelection() ? window.getSelection().toString().trim() : "";
            const isPdfPage = Patens.DocumentParser?.isDocumentTarget?.(window.location.href);
            const targetImg = Patens.Utils?.findUnderlyingImage?.(e.target);
            const targetLink = e.target?.closest?.('a');
            const linkUrl = targetLink ? targetLink.href : window.location.href;

            const pdfFigure = e.target?.closest?.('.patens-pdf-figure');
            const pdfBlock = e.target?.closest?.('.patens-pdf-block');
            const hasPdfBlocks = !!document.querySelector('.patens-pdf-block');

            let itemsToSave = [];

            // 1. PDF FIGURE IMAGE CAPTURE
            if (pdfFigure) {
                const imageB64 = pdfFigure.src;
                const figureAlt = pdfFigure.alt || pdfFigure.title || `Figure from ${document.title || 'PDF'}`;
                itemsToSave.push({
                    text: figureAlt,
                    title: document.title || "PDF Figure",
                    isImage: true,
                    base64Data: imageB64,
                    element: pdfFigure
                });
                Patens.Utils?.showNotification?.("🖼️ Figure Saved to Cart!", '#10b981', e.clientX, e.clientY);
            }
            // 2. SPECIFIC PDF TEXT / FORMULA BLOCK
            else if (pdfBlock) {
                const blockText = pdfBlock.dataset.cleanText || pdfBlock.getAttribute('data-clean-text') || pdfBlock.innerText?.trim() || "";
                const mediaB64 = pdfBlock.dataset.mediaB64 || pdfBlock.getAttribute('data-media-b64') || null;
                const docTitle = document.title || Patens.Utils?.getSmartTitle?.() || "PDF Document";

                if (blockText || mediaB64) {
                    itemsToSave.push({
                        text: blockText,
                        title: docTitle,
                        isImage: !!mediaB64,
                        base64Data: mediaB64,
                        element: pdfBlock
                    });
                }
            }
            // 3. HIGHLIGHTED TEXT SELECTION
            else if (textSelection) {
                const smartTitle = Patens.Utils?.getSmartTitle?.() || document.title || "Excerpt";
                itemsToSave.push({
                    text: textSelection,
                    title: isPdfPage ? `📄 ${smartTitle} (Excerpt)` : smartTitle,
                    isImage: false,
                    element: e.target
                });

                try {
                    window.getSelection()?.removeAllRanges();
                } catch (_) {}
            }
            // 4. DOCUMENT LINK CLICKED ON REGULAR HTML PAGE
            else if (targetLink && Patens.DocumentParser?.isDocumentTarget?.(linkUrl)) {
                Patens.Utils?.showNotification?.("📄 Parsing Document Content...", '#3b82f6', e.clientX, e.clientY);
                try {
                    const parsedDoc = await Patens.DocumentParser.parseUrlOrFile(linkUrl);
                    if (parsedDoc && parsedDoc.text) {
                        itemsToSave.push({
                            text: parsedDoc.text,
                            title: parsedDoc.title || "Document",
                            isImage: false,
                            element: targetLink
                        });
                        Patens.Utils?.showNotification?.("✨ Document Saved to Memory!", '#10b981', e.clientX, e.clientY);
                    }
                } catch (docErr) {
                    Logger.error("Failed to parse document link:", docErr);
                    Patens.Utils?.showNotification?.("⚠️ Failed to parse document", '#ef4444', e.clientX, e.clientY);
                }
            }
            // 5. CONVERTED PDF VIEWER PAGE - WHITESPACE BULK CAPTURE
            else if (hasPdfBlocks) {
                const allDocElements = Array.from(document.querySelectorAll('.patens-pdf-block, .patens-pdf-figure'));
                const docTitle = document.title || Patens.Utils?.getSmartTitle?.() || "PDF Document";

                allDocElements.forEach(el => {
                    if (el.classList.contains('patens-pdf-figure')) {
                        const imageB64 = el.src;
                        if (imageB64) {
                            itemsToSave.push({
                                text: el.alt || el.title || `Figure from ${docTitle}`,
                                title: docTitle,
                                isImage: true,
                                base64Data: imageB64,
                                element: el
                            });
                        }
                    } else if (el.classList.contains('patens-pdf-block')) {
                        const blockText = el.dataset.cleanText || el.getAttribute('data-clean-text') || el.innerText?.trim() || "";
                        const mediaB64 = el.dataset.mediaB64 || el.getAttribute('data-media-b64') || null;
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
                    Patens.Utils?.showNotification?.(`✨ Captured Full PDF (${itemsToSave.length} Items)!`, '#3b82f6', e.clientX, e.clientY);
                }
            }
            // 6. NATIVE RAW PDF TAB
            else if (isPdfPage) {
                Patens.Utils?.showNotification?.("📄 Parsing PDF Document...", '#3b82f6', e.clientX, e.clientY);
                try {
                    const parsedDoc = await Patens.DocumentParser?.parseUrlOrFile?.(window.location.href);
                    if (parsedDoc && parsedDoc.text) {
                        itemsToSave.push({
                            text: parsedDoc.text,
                            title: parsedDoc.title || document.title || "PDF Document",
                            isImage: false,
                            element: document.body
                        });
                        Patens.Utils?.showNotification?.("✨ Full PDF Saved!", '#10b981', e.clientX, e.clientY);
                    }
                } catch (docErr) {
                    Logger.error("Failed to parse PDF page:", docErr);
                    Patens.Utils?.showNotification?.("⚠️ Failed to parse PDF", '#ef4444', e.clientX, e.clientY);
                }
            }
            // 7. REGULAR HTML IMAGE CAPTURE
            else if (targetImg) {
                try {
                    const base64Data = await Patens.Utils?.getBase64Image?.(targetImg);
                    itemsToSave.push({
                        text: targetImg.alt || targetImg.title || `Image from ${Patens.Utils?.getSmartTitle?.() || 'Webpage'}`,
                        title: Patens.Utils?.getSmartTitle?.() || document.title,
                        isImage: true,
                        base64Data: base64Data,
                        element: targetImg
                    });
                } catch (err) {
                    Logger.error("Image capture error:", err);
                }
            }
            // 8. SEMANTIC CONTAINER CAPTURE (Stripe cards, pricing tables, feature units)
            else {
                const semanticContainer = Patens.Utils?.getSemanticContainer?.(e.target);
                const structuredText = Patens.Utils?.extractStructuredText?.(semanticContainer || e.target);
                const minLength = Patens.Config?.MIN_TEXT_LENGTH || 0;

                if (structuredText && structuredText.length > minLength) {
                    itemsToSave.push({
                        text: structuredText,
                        title: Patens.Utils?.getSmartTitle?.() || document.title,
                        isImage: false,
                        element: semanticContainer || e.target
                    });
                } else {
                    // Fallback to DOM subtree scan
                    const tagName = e.target.tagName;
                    if (tagName) {
                        const isCustomElement = tagName.includes('-');
                        const containerTags = Patens.Config?.CONTAINER_TAGS || [];
                        const readableTags = Patens.Config?.READABLE_TAGS || [];

                        if (containerTags.includes(tagName) || isCustomElement || e.target.isContentEditable) {
                            const allReadable = Array.from(e.target.querySelectorAll(readableTags.join(',')));
                            const topLevel = allReadable.filter(el => !allReadable.some(parent => parent.contains(el) && parent !== el));

                            if (topLevel.length > 0) {
                                topLevel.forEach(child => {
                                    const childText = child.innerText?.trim() || "";
                                    if (childText.length > minLength) {
                                        itemsToSave.push({
                                            text: childText,
                                            title: Patens.Utils?.getSmartTitle?.() || document.title,
                                            isImage: false,
                                            element: child
                                        });
                                    }
                                });
                            }
                        }
                    }
                }
            }

            if (itemsToSave.length > 0) {
                Patens.Cart?.saveBulkToCartDirectly?.(itemsToSave, e.clientX, e.clientY);
                clearHoverHighlights();
            }
        }
    }, true);

    // Selection Tooltip Listener
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
                        title: Patens.Utils?.getSmartTitle?.() || document.title || "Excerpt",
                        isImage: false,
                        element: null
                    }], ev.clientX, ev.clientY);

                    tooltip.innerHTML = '✓ Saved';
                    tooltip.style.background = '#10b981';

                    setTimeout(() => {
                        tooltip.remove();
                        try {
                            selection.removeAllRanges();
                        } catch (_) {}
                    }, 800);
                };
                (document.body || document.documentElement).appendChild(tooltip);
            }
        } catch (_) {}
    });

    // Boot UI
    try {
        Patens.Cart?.renderUI?.();
    } catch (err) {
        Logger.error("Error during initial UI boot:", err);
    }
})();