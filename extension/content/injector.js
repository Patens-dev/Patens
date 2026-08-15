(() => {
    window.Patens = window.Patens || {};

    const Logger = Patens.LoggerFactory
        ? Patens.LoggerFactory("[Patens Injector]")
        : {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: console.error
          };

    Patens.Injector = {
        injectContextsToAI: async (dataArray) => {
            Logger.debug("injectContextsToAI initiated with payload:", dataArray);

            if (!Array.isArray(dataArray) || dataArray.length === 0) {
                Logger.warn("dataArray is empty or invalid. Aborting injection.");
                return;
            }

            const startTime = performance.now();

            // 1. Payload Construction
            let combinedText = "";
            dataArray.forEach((item, idx) => {
                const text = item.content || item.text || item.snippet || item.body || item.raw_text || "";
                if (text) {
                    combinedText += `\n--- Context ${idx + 1}: ${item.title || 'Untitled'} ---\n${text}\n`;
                }
            });

            combinedText = combinedText.trim() + "\n";

            if (!combinedText.trim()) {
                Logger.error("Extracted context payload was empty. Check backend response schema.");
                return;
            }

            // 2. Retrieve Cached Target & Cursor Info BEFORE Closing Palette
            const savedInput = Patens.State?.editor?.activeInputElement;
            const savedStart = Patens.State?.editor?.selectionStart;
            const savedEnd = Patens.State?.editor?.selectionEnd;
            const savedRange = Patens.State?.editor?.savedRange;

            // 3. Close Command Palette if active
            if (Patens.State?.ui?.paletteOpen && typeof Patens.Palette?.toggle === 'function') {
                Logger.debug("Closing Command Palette before context injection.");
                Patens.Palette.toggle();
                await new Promise(r => setTimeout(r, 60)); // Allow DOM focus handoff
            }

            // 4. Resolve Target Input Element
            const isEditable = (el) => el && document.body.contains(el) && (
                el.tagName === 'TEXTAREA' ||
                el.tagName === 'INPUT' ||
                el.isContentEditable ||
                el.getAttribute('contenteditable') === 'true'
            );

            const knownAIChatBox =
                document.querySelector('#mock-chat-box') ||                             // Onboarding Welcome Page
                document.querySelector('rich-textarea div[contenteditable="true"]') ||   // Gemini (Quill)
                document.querySelector('.ql-editor[contenteditable="true"]') ||          // Gemini / Quill fallback
                document.querySelector('#prompt-textarea') ||                           // ChatGPT
                document.querySelector('div#prompt-textarea[contenteditable="true"]') ||
                document.querySelector('div.ProseMirror[contenteditable="true"]') ||     // Claude
                document.querySelector('div[contenteditable="true"][role="textbox"]') ||  // DeepSeek / Claude / Gemini
                document.querySelector('textarea#chat-input');

            let activeInput = (isEditable(savedInput) ? savedInput : null) ||
                knownAIChatBox ||
                (isEditable(document.activeElement) ? document.activeElement : null) ||
                document.querySelector('textarea') ||
                document.querySelector('div[contenteditable="true"]');

            if (!activeInput) {
                Logger.error("No valid editable element resolved on page.");
                Patens.Utils?.showNotification?.("⚠️ No active AI input found", "#ef4444");
                return;
            }

            Logger.debug("Resolved active input element:", activeInput);

            // 5. Restore Focus & Exact Caret Selection Range
            const initialVal = activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT'
                ? activeInput.value
                : (activeInput.innerText || activeInput.textContent || "");

            try {
                activeInput.focus();
            } catch (e) {
                Logger.debug("Failed to set focus on target element:", e);
            }

            let injected = false;

            // =========================================================================
            // STRATEGY A: Standard TEXTAREA / INPUT (Precise Index Splice)
            // =========================================================================
            if (activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT') {
                try {
                    Logger.debug("Executing Strategy A (Native Value Setter with Caret Restoration)...");
                    const val = activeInput.value || "";

                    const start = typeof savedStart === 'number'
                        ? savedStart
                        : (typeof activeInput.selectionStart === 'number' ? activeInput.selectionStart : val.length);
                    const end = typeof savedEnd === 'number'
                        ? savedEnd
                        : (typeof activeInput.selectionEnd === 'number' ? activeInput.selectionEnd : val.length);

                    const prototype = activeInput.tagName === 'TEXTAREA'
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype;
                    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

                    const prefix = val.substring(0, start);
                    const suffix = val.substring(end);
                    const newVal = prefix + combinedText + suffix;

                    if (setter) {
                        setter.call(activeInput, newVal);
                    } else {
                        activeInput.value = newVal;
                    }

                    // Move cursor right after the newly inserted text
                    const newCursorPos = start + combinedText.length;
                    activeInput.setSelectionRange(newCursorPos, newCursorPos);

                    activeInput.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: combinedText
                    }));
                    activeInput.dispatchEvent(new Event('change', { bubbles: true }));

                    injected = true;
                    Logger.debug("Strategy A completed.");
                } catch (err) {
                    Logger.debug("Strategy A failed:", err);
                }
            }

            // =========================================================================
            // STRATEGY B: ContentEditable (ChatGPT, Claude, Gemini, Quill, ProseMirror)
            // =========================================================================
            if (!injected && activeInput.isContentEditable) {
                try {
                    Logger.debug("Executing Strategy B (Restoring DOM Range + execCommand)...");

                    const sel = window.getSelection();
                    if (sel) {
                        sel.removeAllRanges();

                        let rangeRestored = false;
                        if (savedRange && activeInput.contains(savedRange.commonAncestorContainer)) {
                            try {
                                sel.addRange(savedRange);
                                rangeRestored = true;
                            } catch (_) {}
                        }

                        // If no valid saved range inside activeInput, place caret at the end of the text
                        if (!rangeRestored) {
                            const endRange = document.createRange();
                            endRange.selectNodeContents(activeInput);
                            endRange.collapse(false); // Move caret to the end
                            sel.addRange(endRange);
                        }
                    }

                    // B1: execCommand at the restored caret
                    const execSuccess = document.execCommand('insertText', false, combinedText);

                    if (execSuccess) {
                        const currentText = activeInput.innerText || activeInput.textContent || "";
                        if (currentText.length > initialVal.length) {
                            injected = true;
                            Logger.debug("Strategy B1 (execCommand) completed successfully at caret.");
                        }
                    }

                    // B2: Fallback to DataTransfer Paste at Caret
                    if (!injected) {
                        Logger.debug("Strategy B1 fallback -> Strategy B2 (DataTransfer Clipboard Paste)...");
                        const dt = new DataTransfer();
                        dt.setData('text/plain', combinedText);
                        const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                        activeInput.dispatchEvent(pasteEvent);

                        const currentText = activeInput.innerText || activeInput.textContent || "";
                        if (currentText.length > initialVal.length) {
                            injected = true;
                            Logger.debug("Strategy B2 completed.");
                        }
                    }
                } catch (err) {
                    Logger.debug("Strategy B failed:", err);
                }
            }

            // =========================================================================
            // STRATEGY C: Direct DOM Insertion Fallback (Appends at end if all else fails)
            // =========================================================================
            if (!injected && activeInput.isContentEditable) {
                try {
                    Logger.debug("Executing Strategy C (Direct DOM Fallback)...");
                    activeInput.innerText += (activeInput.innerText ? "\n" : "") + combinedText;
                    activeInput.classList.remove('ql-blank');

                    activeInput.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: combinedText
                    }));
                    injected = true;
                    Logger.debug("Strategy C completed.");
                } catch (err) {
                    Logger.error("Strategy C failed:", err);
                }
            }

            // 6. Post-Processing & Verification
            setTimeout(() => {
                const finalVal = activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT'
                    ? activeInput.value
                    : (activeInput.innerText || activeInput.textContent || "");

                if (finalVal.length > initialVal.length || injected) {
                    const duration = (performance.now() - startTime).toFixed(2);
                    Logger.info(`Context injection completed successfully in ${duration}ms.`);

                    const rect = activeInput.getBoundingClientRect();
                    const notifyX = (rect.left > 0 && rect.width > 0) ? rect.left + (rect.width / 2) : window.innerWidth / 2;
                    const notifyY = (rect.top > 0 && rect.height > 0) ? rect.top - 40 : window.innerHeight - 80;

                    Patens.Utils?.showNotification?.("✨ Pasted context at cursor", "#10b981", notifyX, notifyY);
                } else {
                    Logger.error("Context injection failed to mutate DOM content.");
                    Patens.Utils?.showNotification?.("⚠️ Failed to paste context", "#ef4444");
                }
            }, 100);
        }
    };
})();