chrome.storage.local.get(['hotkeys'], (res) => {
    if (res.hotkeys) {
        currentHotkeys = {...currentHotkeys, ...res.hotkeys};
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.hotkeys) currentHotkeys = {...currentHotkeys, ...changes.hotkeys.newValue};
    if (changes.contextCart) renderUI();
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "open_palette") togglePalette();
});

window.addEventListener('keydown', (e) => {
    if (checkModifiers(e, currentHotkeys.palette) && e.key.toLowerCase() === currentHotkeys.palette.key.toLowerCase()) {
        e.preventDefault(); e.stopPropagation(); togglePalette();
    }
}, true);

document.body.addEventListener('click', (e) => {
    if (checkModifiers(e, currentHotkeys.capture)) {
        const isLink = e.target.closest('a');
        const isValidTag = CONFIG.VALID_TAGS.includes(e.target.tagName) || e.target.closest(CONFIG.VALID_TAGS.join(','));
        if (isLink || isValidTag) { e.preventDefault(); e.stopPropagation(); }
    }
}, true);

document.body.addEventListener('mouseover', (e) => {
    if (checkModifiers(e, currentHotkeys.capture) && e.target && CONFIG.VALID_TAGS.includes(e.target.tagName)) e.target.classList.add('cc-highlight-hover');
});

document.body.addEventListener('mouseout', (e) => {
    if (e.target && e.target.classList.contains('cc-highlight-hover')) e.target.classList.remove('cc-highlight-hover');
});

document.body.addEventListener('mousedown', async (e) => {
    if (e.target.closest('.cc-cart-btn') || e.target.closest('.cc-cart-modal') || e.target.closest('.cc-palette-overlay')) return;

    if (checkModifiers(e, currentHotkeys.capture) && e.target) {
        e.preventDefault(); e.stopPropagation();

        const textSelection = window.getSelection().toString().trim();
        const targetImg = findUnderlyingImage(e.target);
        let itemsToSave = [];

        if (textSelection) {
            itemsToSave.push({text: textSelection, title: getSmartTitle(), isImage: false, element: e.target});
        } else if (targetImg) {
            const base64Data = await getBase64Image(targetImg);
            itemsToSave.push({
                text: targetImg.alt || targetImg.title || `Image snippet from ${getSmartTitle()}`,
                title: getSmartTitle(),
                isImage: true,
                base64Data: base64Data,
                element: targetImg
            });
        } else {
            const tagName = e.target.tagName;
            const isCustomElement = tagName.includes('-');
            const isEditable = e.target.isContentEditable;

            if (CONFIG.CONTAINER_TAGS.includes(tagName) || isCustomElement || isEditable) {
                const allReadable = Array.from(e.target.querySelectorAll(CONFIG.READABLE_TAGS.join(',')));
                const topLevelReadable = allReadable.filter(el => !allReadable.some(parent => parent.contains(el) && parent !== el));

                if (topLevelReadable.length > 0) {
                    topLevelReadable.forEach(child => {
                        const childText = child.innerText.trim();
                        if (childText.length > CONFIG.MIN_TEXT_LENGTH) itemsToSave.push({text: childText, title: getSmartTitle(), isImage: false, element: child});
                    });
                } else {
                    const text = e.target.innerText.trim();
                    if (text.length > CONFIG.MIN_TEXT_LENGTH) itemsToSave.push({text, title: getSmartTitle(), isImage: false, element: e.target});
                }
            } else if (CONFIG.READABLE_TAGS.includes(tagName) || tagName === 'SPAN') {
                const text = e.target.innerText.trim();
                if (text.length > CONFIG.MIN_TEXT_LENGTH) itemsToSave.push({text, title: getSmartTitle(), isImage: false, element: e.target});
            }
        }

        if (itemsToSave.length > 0) saveBulkToCartDirectly(itemsToSave, e.clientX, e.clientY);
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
        tooltip.style.top = `${window.scrollY + rect.top - 45}px`;
        tooltip.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 60}px`;
        tooltip.style.zIndex = '2147483647';

        tooltip.onmousedown = (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            saveBulkToCartDirectly([{ text, title: getSmartTitle(), isImage: false, element: null }], ev.clientX, ev.clientY);
            tooltip.innerHTML = '✓ Saved';
            tooltip.style.background = '#10b981';
            setTimeout(() => { tooltip.remove(); selection.removeAllRanges(); }, 800);
        };
        document.body.appendChild(tooltip);
    }
});

// Initialization
renderUI();