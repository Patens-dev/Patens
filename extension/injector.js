async function injectContextsToAI(dataArray) {
    if (!dataArray || dataArray.length === 0) return;
    togglePalette();

    const knownAIChatBox =
        document.querySelector('.ql-editor[contenteditable="true"]') || // Gemini
        document.querySelector('#prompt-textarea') ||                   // ChatGPT
        document.querySelector('div[contenteditable="true"][role="textbox"]'); // Claude

    if (knownAIChatBox) {
        activeInputElement = knownAIChatBox;
    } else if (!activeInputElement || (activeInputElement.tagName !== 'TEXTAREA' && activeInputElement.tagName !== 'INPUT' && !activeInputElement.isContentEditable)) {
        activeInputElement = document.querySelector('textarea');
    }

    if (!activeInputElement) return;

    const originalPlaceholder = activeInputElement.getAttribute('data-placeholder') || activeInputElement.placeholder || "";

    try {
        activeInputElement.focus();
        if (activeInputElement.tagName === 'TEXTAREA' || activeInputElement.tagName === 'INPUT') {
            if (savedInputState) activeInputElement.setSelectionRange(savedInputState.start, savedInputState.end);
        }
    } catch (e) {}

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
                const imgPromise = secureFetch(`${CONFIG.API_BASE}/image?path=${encodeURIComponent(match[1])}`, 'blob')
                    .then(blob => {
                        if (blob) filesToPaste.push(new File([blob], `context_img_${i}_${Date.now()}.png`, {type: blob.type}));
                    })
                    .catch(err => console.log(err));
                imagePromises.push(imgPromise);
            }
        });
    });

    combinedText = combinedText.trim() + "\n";
    if (imagePromises.length > 0) await Promise.all(imagePromises);

    let textInjected = false;

    if (activeInputElement.tagName === 'TEXTAREA' || activeInputElement.tagName === 'INPUT') {
        try {
            const start = activeInputElement.selectionStart || 0;
            const end = activeInputElement.selectionEnd || 0;
            const textBefore = activeInputElement.value.substring(0, start);
            const textAfter = activeInputElement.value.substring(end);

            let nativeInputValueSetter = activeInputElement.tagName === 'TEXTAREA'
                ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
                : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

            if (nativeInputValueSetter) nativeInputValueSetter.call(activeInputElement, textBefore + combinedText + textAfter);
            else activeInputElement.value = textBefore + combinedText + textAfter;

            activeInputElement.selectionStart = activeInputElement.selectionEnd = start + combinedText.length;
            activeInputElement.dispatchEvent(new Event('input', {bubbles: true}));
            activeInputElement.dispatchEvent(new Event('change', {bubbles: true}));
            textInjected = true;
        } catch (err) {}
    }

    if (!textInjected && activeInputElement.isContentEditable) {
        try {
            activeInputElement.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(activeInputElement);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);

            textInjected = document.execCommand('insertText', false, combinedText);

            if (textInjected) {
                activeInputElement.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
                activeInputElement.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true, cancelable: true, key: ' '}));
            }
        } catch (err) {}
    }

    if (!textInjected) {
        const dtText = new DataTransfer();
        dtText.setData('text/plain', combinedText);
        const safeHtml = combinedText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        dtText.setData('text/html', `<div>${safeHtml}</div>`);

        const pasteEventText = new ClipboardEvent('paste', { clipboardData: dtText, bubbles: true, cancelable: true });
        activeInputElement.dispatchEvent(pasteEventText);
        textInjected = true;
    }

    setTimeout(() => {
        if (activeInputElement.isContentEditable && (!activeInputElement.innerText || activeInputElement.innerText.trim().length < 5)) {
            const p = document.createElement('p');
            p.innerText = combinedText;
            activeInputElement.appendChild(p);
            activeInputElement.dispatchEvent(new Event('input', {bubbles: true}));
        }
    }, 50);

    setTimeout(() => {
        if (filesToPaste.length > 0) {
            const dtImages = new DataTransfer();
            filesToPaste.forEach(file => dtImages.items.add(file));

            const pasteEventImages = new ClipboardEvent('paste', { clipboardData: dtImages, bubbles: true, cancelable: true });
            activeInputElement.dispatchEvent(pasteEventImages);

            const dropEvent = new DragEvent('drop', {dataTransfer: dtImages, bubbles: true, cancelable: true});
            activeInputElement.dispatchEvent(dropEvent);

            const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
            if (isFirefox && activeInputElement.isContentEditable) {
                filesToPaste.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const base64Url = e.target.result;
                        const imgInjected = document.execCommand('insertImage', false, base64Url);
                        if (!imgInjected) {
                            const imgNode = document.createElement('img');
                            imgNode.src = base64Url;
                            imgNode.style.maxWidth = '100%';
                            activeInputElement.appendChild(imgNode);
                        }
                        activeInputElement.dispatchEvent(new Event('input', {bubbles: true}));
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
        if (activeInputElement.tagName === 'TEXTAREA' || activeInputElement.tagName === 'INPUT') {
            activeInputElement.placeholder = originalPlaceholder;
        }
    }, 250);
}