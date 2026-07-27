(() => {
    window.Patens = window.Patens || {};
    
    // Safely grab the factory, or fallback to console
    const Logger = Patens.LoggerFactory 
        ? Patens.LoggerFactory("[Patens Main Events]") 
        : { debug: console.debug, info: console.info, warn: console.warn, error: console.error };

    Logger.info("Initializing Content Script Event Listeners...");

    // ==========================================
    // 2. STORAGE & STATE INITIALIZATION
    // ==========================================
    try {
        // Ensure State exists before we try to append hotkeys to it
        Patens.State = Patens.State || {};
        Patens.State.hotkeys = Patens.State.hotkeys || {};

        chrome.storage.local.get(['hotkeys'], (res) => {
            if (chrome.runtime.lastError) {
                Logger.error("Failed to fetch initial hotkeys from storage:", chrome.runtime.lastError);
                return;
            }
            if (res.hotkeys) {
                Patens.State.hotkeys = { ...Patens.State.hotkeys, ...res.hotkeys };
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
            Patens.State.hotkeys = { ...(Patens.State.hotkeys || {}), ...changes.hotkeys.newValue };
            Logger.info("Hotkeys state updated via storage listener.");
        }

        if (changes.contextCart) {
            Patens.Cart?.renderUI?.();
        }
    });

    // ==========================================
    // 3. MESSAGE LISTENER
    // ==========================================
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "open_palette") {
            if (Patens.Palette && typeof Patens.Palette.toggle === 'function') {
                Logger.info("Command 'open_palette' received; toggling palette overlay.");
                Patens.Palette.toggle();
            } else {
                Logger.warn("Received 'open_palette' but Patens.Palette is not loaded yet.");
            }
        }
    });

    // ==========================================
    // 4. KEYBOARD LISTENERS
    // ==========================================
    window.addEventListener('keydown', (e) => {
        // Fast-Forward Cart Injection (Ctrl + Shift + Enter)
        if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
            Logger.info("Hotkey triggered: Fast-Forward Cart Commit");
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

        // Toggle Palette Shortcut
        const paletteHotkey = Patens.State?.hotkeys?.palette;
        if (paletteHotkey && Patens.Utils?.checkModifiers(e, paletteHotkey)) {
            const configuredKey = paletteHotkey.key?.toLowerCase();
            if (configuredKey && e.key.toLowerCase() === configuredKey) {
                e.preventDefault();
                e.stopPropagation();

                if (Patens.Palette?.toggle) {
                    Logger.info("Hotkey triggered: Toggle Palette");
                    Patens.Palette.toggle();
                } else {
                    Logger.warn("Palette toggle hotkey pressed, but Patens.Palette module is undefined.");
                }
            }
        }
    }, true);

    // ==========================================
    // 5. MOUSE INTERACTION LISTENERS
    // ==========================================
    document.body.addEventListener('click', (e) => {
        const captureHotkey = Patens.State?.hotkeys?.capture;
        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey)) {
            const validTags = Patens.Config?.VALID_TAGS || [];
            const isLink = e.target.closest('a');
            const isValidTag = validTags.includes(e.target.tagName) || e.target.closest(validTags.join(','));

            if (isLink || isValidTag) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, true);

    document.body.addEventListener('mouseover', (e) => {
        const captureHotkey = Patens.State?.hotkeys?.capture;
        const validTags = Patens.Config?.VALID_TAGS || [];

        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey) && e.target && validTags.includes(e.target.tagName)) {
            e.target.classList.add('cc-highlight-hover');
        }
    });

    document.body.addEventListener('mouseout', (e) => {
        if (e.target && e.target.classList.contains('cc-highlight-hover')) {
            e.target.classList.remove('cc-highlight-hover');
        }
    });

    document.body.addEventListener('mousedown', async (e) => {
        if (e.target.closest('.cc-cart-btn') || e.target.closest('.cc-cart-modal') || e.target.closest('.cc-palette-overlay')) return;

        const captureHotkey = Patens.State?.hotkeys?.capture;

        if (captureHotkey && Patens.Utils?.checkModifiers(e, captureHotkey) && e.target) {
            e.preventDefault();
            e.stopPropagation();

            const startTime = performance.now();
            const textSelection = window.getSelection().toString().trim();
            const targetImg = Patens.Utils?.findUnderlyingImage(e.target);
            let itemsToSave = [];

            if (textSelection) {
                itemsToSave.push({ text: textSelection, title: Patens.Utils?.getSmartTitle(), isImage: false, element: e.target });
            } else if (targetImg) {
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
                    Logger.error("Failed to process captured image:", err);
                }
            } else {
                const tagName = e.target.tagName;
                const isCustomElement = tagName.includes('-');
                const containerTags = Patens.Config?.CONTAINER_TAGS || [];
                const readableTags = Patens.Config?.READABLE_TAGS || [];
                const minLength = Patens.Config?.MIN_TEXT_LENGTH || 0;

                if (containerTags.includes(tagName) || isCustomElement || e.target.isContentEditable) {
                    const allReadable = Array.from(e.target.querySelectorAll(readableTags.join(',')));
                    const topLevel = allReadable.filter(el => !allReadable.some(parent => parent.contains(el) && parent !== el));

                    if (topLevel.length > 0) {
                        topLevel.forEach(child => {
                            const childText = child.innerText.trim();
                            if (childText.length > minLength) itemsToSave.push({ text: childText, title: Patens.Utils?.getSmartTitle(), isImage: false, element: child });
                        });
                    } else {
                        const text = e.target.innerText.trim();
                        if (text.length > minLength) itemsToSave.push({ text, title: Patens.Utils?.getSmartTitle(), isImage: false, element: e.target });
                    }
                } else if (readableTags.includes(tagName) || tagName === 'SPAN') {
                    const text = e.target.innerText.trim();
                    if (text.length > minLength) itemsToSave.push({ text, title: Patens.Utils?.getSmartTitle(), isImage: false, element: e.target });
                }
            }

            if (itemsToSave.length > 0) {
                Logger.debug(`Saving ${itemsToSave.length} extracted items... (${(performance.now() - startTime).toFixed(2)}ms)`);
                Patens.Cart?.saveBulkToCartDirectly?.(itemsToSave, e.clientX, e.clientY);
            }
        }
    }, true);

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
            tooltip.style.cssText = `top: ${window.scrollY + rect.top - 45}px; left: ${window.scrollX + rect.left + (rect.width / 2) - 60}px; z-index: 2147483647; position: absolute;`;

            tooltip.onmousedown = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                Patens.Cart?.saveBulkToCartDirectly?.([{ text, title: Patens.Utils?.getSmartTitle(), isImage: false, element: null }], ev.clientX, ev.clientY);

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

    // Boot UI
    try {
        Patens.Cart?.renderUI?.();
    } catch (err) {
        Logger.error("Error during initial UI boot:", err);
    }
})();