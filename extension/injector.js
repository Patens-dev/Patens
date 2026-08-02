(() => {
    window.Patens = window.Patens || {};

    // Safely grab the factory, or fallback to console if load order is interrupted
    const Logger = Patens.LoggerFactory
        ? Patens.LoggerFactory("[Patens Injector]")
        : {debug: console.debug, info: console.info, warn: console.warn, error: console.error};

    // ==========================================
    // 2. INJECTOR COMPONENT
    // ==========================================
    Patens.Injector = {
        injectContextsToAI: async (dataArray) => {
            if (!Array.isArray(dataArray) || dataArray.length === 0) {
                Logger.warn("injectContextsToAI called with empty or invalid dataArray.");
                return;
            }

            Logger.info(`Starting context injection for ${dataArray.length} items...`);
            const startTime = performance.now();

            if (Patens.State?.ui?.paletteOpen) {
                Logger.debug("Closing command palette prior to injection.");
                Patens.Palette.toggle();
            }


            // Target known Web AI Chat Selectors (Gemini, ChatGPT, Claude)
            const knownAIChatBox =
                document.querySelector('rich-textarea div[contenteditable="true"]') || // Gemini (New)
                document.querySelector('.ql-editor[contenteditable="true"]') ||        // Gemini (Legacy)
                document.querySelector('#prompt-textarea') ||                          // ChatGPT
                document.querySelector('div[contenteditable="true"][role="textbox"]'); // Claude

            // Helper to check if an element is a valid text input target
            const isEditable = (el) => el && (
                el.tagName === 'TEXTAREA' ||
                el.tagName === 'INPUT' ||
                el.isContentEditable
            );

            const savedInput = Patens.State?.editor?.activeInputElement;

            // Fallback chain: Known AI Box -> Saved Editable Input -> Fallback Page Textarea
            let activeInput = knownAIChatBox ||
                (isEditable(savedInput) ? savedInput : null) ||
                document.querySelector('textarea') ||
                document.querySelector('div[contenteditable="true"]');

            if (!activeInput) {
                Logger.warn("No active AI input or standard textarea/contenteditable element found on page.");
                return;
            }
            Logger.debug("Target input element resolved:", activeInput);

            const originalPlaceholder = activeInput.getAttribute('data-placeholder') || activeInput.placeholder || "";

            try {
                activeInput.focus();
                if ((activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT') && Patens.State?.editor?.savedInputState) {
                    const {start, end} = Patens.State.editor.savedInputState;
                    activeInput.setSelectionRange(start, end);
                    Logger.debug(`Restored selection range [${start}:${end}] on active input.`);
                }
            } catch (e) {
                Logger.warn("Failed to set focus/selection range on input element:", e);
            }

            const imgRegex = /\[Local Image Path:\s*(.*?)\]/g;
            let combinedText = "";
            const filesToPaste = [];
            const imagePromises = [];

            dataArray.forEach((data, i) => {
                const cleanText = (data.content || "").replace(imgRegex, '').trim();
                combinedText += `\n--- Context ${i + 1}: ${data.title || 'Untitled'} ---\n${cleanText}\n`;

                const matches = [...(data.content || "").matchAll(imgRegex)];
                matches.forEach(match => {
                    if (match && match[1]) {
                        const imgPath = match[1];
                        const proxyUrl = `${Patens.Config?.API_BASE || 'http://localhost:8000/api/v1'}/image?path=${encodeURIComponent(imgPath)}`;

                        Logger.debug(`Fetching image asset via proxy for item ${i + 1} -> ${imgPath}`);

                        const imgPromise = Patens.API?.fetchProxy(proxyUrl, 'blob')
                            .then(blob => {
                                if (blob) {
                                    const file = new File([blob], `context_img_${i}_${Date.now()}.png`, {type: blob.type});
                                    filesToPaste.push(file);
                                    Logger.debug(`Image asset loaded as file blob (${file.size} bytes).`);
                                } else {
                                    Logger.warn(`Proxy returned empty blob for image path: ${imgPath}`);
                                }
                            })
                            .catch(err => Logger.error(`Failed to fetch proxied image at path '${imgPath}':`, err));

                        imagePromises.push(imgPromise);
                    }
                });
            });

            combinedText = combinedText.trim() + "\n";

            if (imagePromises.length > 0) {
                Logger.debug(`Waiting for ${imagePromises.length} image asset proxy calls to resolve...`);
                await Promise.all(imagePromises);
                Logger.debug(`Image proxy resolution complete (${filesToPaste.length} total files ready).`);
            }

            let textInjected = false;

            // Strategy A: Standard Native Inputs (TEXTAREA / INPUT)
            if (activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT') {
                try {
                    Logger.debug("Attempting Native Value Setter injection strategy...");
                    const start = activeInput.selectionStart || 0;
                    const end = activeInput.selectionEnd || 0;
                    const textBefore = activeInput.value.substring(0, start);
                    const textAfter = activeInput.value.substring(end);

                    let setter = activeInput.tagName === 'TEXTAREA'
                        ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
                        : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

                    if (setter) {
                        setter.call(activeInput, textBefore + combinedText + textAfter);
                    } else {
                        activeInput.value = textBefore + combinedText + textAfter;
                    }

                    activeInput.selectionStart = activeInput.selectionEnd = start + combinedText.length;
                    activeInput.dispatchEvent(new Event('input', {bubbles: true}));
                    activeInput.dispatchEvent(new Event('change', {bubbles: true}));
                    textInjected = true;
                    Logger.info("Text successfully injected using Strategy A (Native Value Setter).");
                } catch (err) {
                    Logger.warn("Strategy A (Native Value Setter) injection failed:", err);
                }
            }

            // Strategy B: Rich Text / ContentEditable Elements
            if (!textInjected && activeInput.isContentEditable) {
                try {
                    Logger.debug("Attempting ExecCommand ContentEditable injection strategy...");
                    activeInput.focus();
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(activeInput);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);

                    textInjected = document.execCommand('insertText', false, combinedText);

                    if (textInjected) {
                        activeInput.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
                        Logger.info("Text successfully injected using Strategy B (ExecCommand).");
                    } else {
                        Logger.warn("execCommand('insertText') returned false.");
                    }
                } catch (err) {
                    Logger.warn("Strategy B (ExecCommand) injection failed:", err);
                }
            }

            // Strategy C: Fallback Synthetic Clipboard Event
            if (!textInjected) {
                try {
                    Logger.debug("Attempting Synthetic Clipboard Paste Event fallback strategy...");
                    const dtText = new DataTransfer();
                    dtText.setData('text/plain', combinedText);
                    const safeHtml = combinedText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                    dtText.setData('text/html', `<div>${safeHtml}</div>`);

                    const pasteEvent = new ClipboardEvent('paste', {
                        clipboardData: dtText,
                        bubbles: true,
                        cancelable: true
                    });
                    activeInput.dispatchEvent(pasteEvent);
                    textInjected = true;
                    Logger.info("Text successfully injected using Strategy C (Synthetic Clipboard Event).");
                } catch (err) {
                    Logger.error("Strategy C (Synthetic Clipboard Event) injection failed:", err);
                }
            }

            // Post-Processing: Dispatching Attached Image Payload Attachments
            setTimeout(() => {
                if (filesToPaste.length > 0) {
                    Logger.info(`Dispatching ${filesToPaste.length} image attachments to input via synthetic DataTransfer...`);
                    try {
                        const dtImages = new DataTransfer();
                        filesToPaste.forEach(file => dtImages.items.add(file));

                        activeInput.dispatchEvent(new ClipboardEvent('paste', {
                            clipboardData: dtImages,
                            bubbles: true,
                            cancelable: true
                        }));
                        activeInput.dispatchEvent(new DragEvent('drop', {
                            dataTransfer: dtImages,
                            bubbles: true,
                            cancelable: true
                        }));
                        Logger.debug("Synthetic image attachment events dispatched.");
                    } catch (imgDispatchErr) {
                        Logger.error("Failed to dispatch synthetic image drop/paste events:", imgDispatchErr);
                    }
                }

                if (activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT') {
                    activeInput.placeholder = originalPlaceholder;
                }

                const totalDuration = (performance.now() - startTime).toFixed(2);
                Logger.info(`Context injection workflow finalized in ${totalDuration}ms.`);
            }, 250);
        }
    };
})();