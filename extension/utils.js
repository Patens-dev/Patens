function fastHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) + hash) + str.charCodeAt(i); }
    return hash >>> 0;
}

function truncateTitle(title) {
    if (!title) return 'Untitled';
    const words = title.trim().split(/\s+/);
    return words.length <= 5 ? title : `${words.slice(0, 5).join(' ')}...`;
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = Math.max(0, now - date);

    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear();

    const timeOpts = {hour: 'numeric', minute: '2-digit'};
    const timeStr = date.toLocaleTimeString(undefined, timeOpts);

    if (isToday) {
        if (diffMs < 60000) return `Just now`;
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
        return `Today at ${timeStr}`;
    }

    if (isYesterday) return `Yesterday at ${timeStr}`;

    const dateOpts = {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'};
    if (date.getFullYear() !== now.getFullYear()) dateOpts.year = 'numeric';
    return date.toLocaleDateString(undefined, dateOpts);
}

function getSmartTitle() {
    const url = window.location.href;
    try {
        if (url.includes("chatgpt.com")) {
            const el = document.querySelector('title');
            if (el && el.innerText !== "ChatGPT") return el.innerText.replace(' | ChatGPT', '');
        }
        if (url.includes("gemini.google.com")) {
            const el = document.querySelector('.recent-content-title, .selected .conversation-title');
            if (el) return el.innerText.trim();
        }
        if (url.includes("claude.ai")) {
            const el = document.querySelector('title');
            if (el && el.innerText !== "Claude") return el.innerText;
        }
        if (url.includes("github.com") || url.includes("stackoverflow.com")) {
            const el = document.querySelector('h1');
            if (el) return el.innerText.trim().replace(/\n/g, ' ');
        }
    } catch(e) {}

    return (document.title || "Untitled").replace(/ - Google Search$/, '').replace(/ - YouTube$/, '').replace(/ \| ChatGPT$/, '');
}

async function getBase64Image(imgElement) {
    if (imgElement.src.startsWith('data:')) return imgElement.src;
    try {
        const response = await fetch(imgElement.src);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        const canvas = document.createElement("canvas");
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        canvas.getContext("2d").drawImage(imgElement, 0, 0);
        return canvas.toDataURL("image/png");
    }
}

function findUnderlyingImage(targetElement) {
    if (!targetElement || targetElement.nodeType !== Node.ELEMENT_NODE) return null;
    if (targetElement.tagName === 'IMG') return targetElement;
    const tightWrappers = ['PICTURE', 'FIGURE', 'A'];
    if (tightWrappers.includes(targetElement.tagName)) return targetElement.querySelector('img');
    return null;
}

function checkModifiers(e, configObj) {
    if (!configObj) return false;
    return (e.ctrlKey === configObj.ctrl) && (e.shiftKey === configObj.shift) && (e.altKey === configObj.alt) && (e.metaKey === configObj.meta);
}

async function secureFetch(url, responseType = 'json') {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({action: "proxy_fetch", url, responseType}, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response || !response.success) return reject(new Error(response?.error || "Unknown proxy fetch error"));

            if (responseType === 'json') {
                resolve(JSON.parse(response.data));
            } else if (responseType === 'blob') {
                try {
                    const split = response.data.split(',');
                    const mime = split[0].match(/:(.*?);/)[1];
                    const bstr = atob(split[1]);
                    let n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    while (n--) { u8arr[n] = bstr.charCodeAt(n); }
                    resolve(new Blob([u8arr], {type: mime}));
                } catch (e) {
                    reject(new Error("Failed to decode base64 image"));
                }
            } else {
                resolve(response.data);
            }
        });
    });
}

function showFloatingNotification(message, color, x, y) {
    const popup = document.createElement('div');
    popup.className = 'cc-duplicate-warning';
    popup.innerText = message;
    popup.style.background = color;
    popup.style.left = `${x + 15}px`;
    popup.style.top = `${y + 15}px`;
    popup.style.zIndex = '2147483647';

    document.body.appendChild(popup);
    setTimeout(() => {
        popup.classList.add('cc-duplicate-fade');
        setTimeout(() => popup.remove(), 300);
    }, 1500);
}

async function saveBulkToCartDirectly(itemsToSave, eventX, eventY) {
    let result;
    try {
        result = await chrome.storage.local.get(['contextCart']);
    } catch (e) {
        if (e.message.includes("Extension context invalidated")) {
            showFloatingNotification(`⚠️ Extension updated. Please refresh this page.`, '#ef4444', eventX, eventY);
            return;
        }
        return;
    }

    let cart = result.contextCart || [];
    let addedCount = 0;
    let duplicateCount = 0;

    itemsToSave.forEach(item => {
        const contentToHash = item.isImage ? item.base64Data : item.text;
        const itemHash = fastHash(contentToHash).toString();

        if (!cart.some(cartItem => cartItem.hash === itemHash)) {
            cart.push({
                id: Date.now().toString() + Math.random().toString().slice(2, 6),
                hash: itemHash,
                type: item.isImage ? 'image' : 'text',
                url: window.location.href,
                title: item.title,
                content: item.text,
                media: item.base64Data
            });
            addedCount++;

            if (item.element) {
                item.element.classList.add('cc-added-flash');
                setTimeout(() => item.element.classList.remove('cc-added-flash'), 600);
            }
        } else {
            duplicateCount++;
        }
    });

    if (addedCount > 0) await chrome.storage.local.set({contextCart: cart});

    if (addedCount > 0 && duplicateCount === 0) showFloatingNotification(`✨ Saved ${addedCount} items`, '#10b981', eventX, eventY);
    else if (addedCount > 0 && duplicateCount > 0) showFloatingNotification(`✨ Saved ${addedCount} items (${duplicateCount} duplicates)`, '#f59e0b', eventX, eventY);
    else if (addedCount === 0) showFloatingNotification(`Already in cart`, '#ff5252', eventX, eventY);
}