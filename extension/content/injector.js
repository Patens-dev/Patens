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

            // 2. Close Command Palette if active to restore focus
            if (Patens.State?.ui?.paletteOpen && typeof Patens.Palette?.toggle === 'function') {
                Logger.debug("Closing Command Palette before context injection.");
                Patens.Palette.toggle();
                await new Promise(r => setTimeout(r, 100)); // Allow DOM focus handoff
            }

            // 3. Resolve Target Input Element
            const savedInput = Patens.State?.editor?.activeInputElement;

            const isEditable = (el) => el && document.body.contains(el) && (
                el.tagName === 'TEXTAREA' ||
                el.tagName === 'INPUT' ||
                el.isContentEditable ||
                el.getAttribute('contenteditable') === 'true'
            );

            const knownAIChatBox =
                document.querySelector('#mock-chat-box') ||                             // Onboarding Welcome Page
                document.querySelector('#prompt-textarea') ||                           // ChatGPT
                document.querySelector('div#prompt-textarea[contenteditable="true"]') ||
                document.querySelector('div.ProseMirror[contenteditable="true"]') ||     // Claude
                document.querySelector('div[contenteditable="true"][role="textbox"]') ||  // DeepSeek / Claude
                document.querySelector('rich-textarea div[contenteditable="true"]') ||   // Gemini
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

            // 4. Focus & DOM Content Baseline Check
            const initialVal = activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT'
                ? activeInput.value
                : activeInput.innerText;

            try {
                activeInput.focus();
            } catch (e) {
                Logger.debug("Failed to set focus on target element:", e);
            }

            let injected = false;

            // Strategy A: Native Textarea/Input Value Setter
            if (activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT') {
                try {
                    Logger.debug("Executing Strategy A (Native Value Setter)...");
                    const start = activeInput.selectionStart || activeInput.value.length;
                    const end = activeInput.selectionEnd || activeInput.value.length;
                    const val = activeInput.value || "";

                    const prototype = activeInput.tagName === 'TEXTAREA'
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype;
                    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

                    if (setter) {
                        setter.call(activeInput, val.substring(0, start) + combinedText + val.substring(end));
                    } else {
                        activeInput.value = val.substring(0, start) + combinedText + val.substring(end);
                    }

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

            // Strategy B: DataTransfer Simulated Paste Event
            if (!injected && activeInput.isContentEditable) {
                try {
                    Logger.debug("Executing Strategy B (DataTransfer Clipboard Paste)...");
                    const dt = new DataTransfer();
                    dt.setData('text/plain', combinedText);
                    const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                    activeInput.dispatchEvent(pasteEvent);
                    injected = true;
                    Logger.debug("Strategy B completed.");
                } catch (err) {
                    Logger.debug("Strategy B failed:", err);
                }
            }

            // Strategy C: Direct DOM InnerText Fallback
            if (!injected && activeInput.isContentEditable) {
                try {
                    Logger.debug("Executing Strategy C (Direct InnerText Fallback)...");
                    activeInput.innerText += (activeInput.innerText ? "\n" : "") + combinedText;
                    activeInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: combinedText }));
                    injected = true;
                    Logger.debug("Strategy C completed.");
                } catch (err) {
                    Logger.error("Strategy C failed:", err);
                }
            }

            // 5. Post-Processing & Verification
            setTimeout(() => {
                const finalVal = activeInput.tagName === 'TEXTAREA' || activeInput.tagName === 'INPUT'
                    ? activeInput.value
                    : activeInput.innerText;

                if (finalVal.length > initialVal.length || injected) {
                    const duration = (performance.now() - startTime).toFixed(2);
                    Logger.info(`Context injection completed successfully in ${duration}ms.`);

                    const rect = activeInput.getBoundingClientRect();
                    const notifyX = (rect.left > 0 && rect.width > 0) ? rect.left + (rect.width / 2) : window.innerWidth / 2;
                    const notifyY = (rect.top > 0 && rect.height > 0) ? rect.top - 40 : window.innerHeight - 80;

                    Patens.Utils?.showNotification?.("✨ Pasted context to editor", "#10b981", notifyX, notifyY);
                } else {
                    Logger.error("Context injection failed to mutate DOM content.");
                    Patens.Utils?.showNotification?.("⚠️ Failed to paste context", "#ef4444");
                }
            }, 100);
        }
    };
})();