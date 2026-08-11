window.Patens = window.Patens || {};

// ==========================================
// 1. CENTRAL LOGGER UTILITY
// ==========================================
Patens.LOG_LEVELS = {DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3};
Patens.CURRENT_LOG_LEVEL = Patens.LOG_LEVELS.DEBUG;

// Create a global factory on the Patens namespace
Patens.LoggerFactory = (prefix) => ({
    debug: (msg, ...args) => {
        if (Patens.CURRENT_LOG_LEVEL <= Patens.LOG_LEVELS.DEBUG) console.debug(`${prefix} [DEBUG] ${msg}`, ...args);
    },
    info: (msg, ...args) => {
        if (Patens.CURRENT_LOG_LEVEL <= Patens.LOG_LEVELS.INFO) console.info(`${prefix} [INFO] ${msg}`, ...args);
    },
    warn: (msg, ...args) => {
        if (Patens.CURRENT_LOG_LEVEL <= Patens.LOG_LEVELS.WARN) console.warn(`${prefix} [WARN] ${msg}`, ...args);
    },
    error: (msg, err = null, ...args) => {
        if (Patens.CURRENT_LOG_LEVEL <= Patens.LOG_LEVELS.ERROR) {
            err ? console.error(`${prefix} [ERROR] ${msg}`, err, ...args) : console.error(`${prefix} [ERROR] ${msg}`, ...args);
        }
    }
});

// Create the local logger for this specific file
const Logger = Patens.LoggerFactory("[Patens API & Utils]");
Logger.info("Central Logger initialized. API Service & Utils loaded.");

// ==========================================
// 2. API SERVICE (Content Script -> Background)
// ==========================================
Patens.API = {
    /** Proxies requests through background.js to bypass CORS */
    fetchProxy: (url, responseType = 'json') => {
        Logger.debug(`Initiating proxy fetch via runtime messaging [Type: ${responseType}] -> ${url}`);
        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({action: "proxy_fetch", url, responseType}, (response) => {
                const duration = (performance.now() - startTime).toFixed(2);

                if (chrome.runtime.lastError) {
                    Logger.error(`Proxy fetch messaging failed after ${duration}ms for ${url}:`, chrome.runtime.lastError);
                    return reject(new Error(chrome.runtime.lastError.message));
                }

                if (!response || !response.success) {
                    const errorMsg = response?.error || "Proxy fetch error";
                    Logger.error(`Proxy fetch rejected by background worker in ${duration}ms:`, null, errorMsg);
                    return reject(new Error(errorMsg));
                }

                Logger.debug(`Proxy fetch completed successfully in ${duration}ms for ${url}`);

                if (responseType === 'json') {
                    try {
                        const parsedData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                        resolve(parsedData);
                    } catch (jsonErr) {
                        Logger.error("Failed to parse JSON response payload from proxy fetch:", jsonErr);
                        reject(new Error("Invalid JSON payload from proxy response"));
                    }
                } else if (responseType === 'blob') {
                    try {
                        const split = response.data.split(',');
                        const mimeMatch = split[0].match(/:(.*?);/);
                        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                        const bstr = atob(split[1]);
                        let n = bstr.length;
                        const u8arr = new Uint8Array(n);
                        while (n--) {
                            u8arr[n] = bstr.charCodeAt(n);
                        }
                        resolve(new Blob([u8arr], {type: mime}));
                    } catch (blobErr) {
                        Logger.error("Failed to decode base64 string into Blob:", blobErr);
                        reject(new Error("Failed to decode base64 image"));
                    }
                } else {
                    resolve(response.data);
                }
            });
        });
    },

    ingestBatch: (payload) => {
        const itemCount = Array.isArray(payload) ? payload.length : 1;
        Logger.info(`Sending batch ingestion request for ${itemCount} items...`);
        const startTime = performance.now();

        const safePayload = payload.map(item => ({
            id: item.id || Date.now().toString(),
            hash: item.hash || "",
            type: item.type || "text",
            url: item.url || "unknown",
            title: item.title || "Untitled",
            content: item.content || "",
            media: item.media || ""
        }));

        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({action: "ingest_batch", payload: safePayload}, (response) => {
                    const duration = (performance.now() - startTime).toFixed(2);

                    if (chrome.runtime.lastError) {
                        Logger.error(`Ingest batch runtime message failed after ${duration}ms:`, chrome.runtime.lastError);
                        resolve({success: false, error: chrome.runtime.lastError.message});
                        return;
                    }

                    if (!response) {
                        Logger.error(`Message sent, but background script returned no response after ${duration}ms.`);
                        resolve({success: false, error: "Background script failed to respond."});
                        return;
                    }

                    Logger.info(`Batch ingestion response received in ${duration}ms`, response);
                    resolve(response);
                });
            } catch (err) {
                Logger.error("Failed to execute sendMessage:", err);
                resolve({success: false, error: err.message});
            }
        });
    }
};

// ==========================================
// 3. HELPER UTILITIES
// ==========================================
Patens.Utils = {
    fastHash: (str) => {
        if (!str) return 0;
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
        }
        return hash >>> 0;
    },

    truncateTitle: (title) => {
        if (!title) return 'Untitled';
        const words = title.trim().split(/\s+/);
        return words.length <= 5 ? title : `${words.slice(0, 5).join(' ')}...`;
    },

    formatDateTime: (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            Logger.warn(`Invalid date format passed to formatDateTime: '${dateString}'`);
            return '';
        }

        const now = new Date();
        const diffMs = Math.max(0, now - date);

        const isToday = date.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        const timeStr = date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});

        if (isToday) {
            if (diffMs < 60000) return `Just now`;
            if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
            return `Today at ${timeStr}`;
        }
        if (isYesterday) return `Yesterday at ${timeStr}`;

        const opts = {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'};
        if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
        return date.toLocaleDateString(undefined, opts);
    },

    getSmartTitle: () => {
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
        } catch (e) {
            Logger.debug("Smart title extraction selector error:", e);
        }
        return (document.title || "Untitled")
            .replace(/ - Google Search$/, '')
            .replace(/ - YouTube$/, '')
            .replace(/ \| ChatGPT$/, '');
    },

    getBase64Image: async (imgElement) => {
        if (!imgElement || !imgElement.src) {
            Logger.warn("getBase64Image called with an invalid image element.");
            return "";
        }

        if (imgElement.src.startsWith('data:')) {
            Logger.debug("Image source is already Base64 data string.");
            return imgElement.src;
        }

        try {
            Logger.debug(`Fetching image directly as blob -> ${imgElement.src}`);
            const response = await fetch(imgElement.src);
            const blob = await response.blob();

            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = (err) => {
                    Logger.error("FileReader failed converting image blob to DataURL:", err);
                    reject(err);
                };
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            Logger.warn("Direct fetch for image blob failed (CORS/Network); falling back to canvas draw.", err);
            try {
                const canvas = document.createElement("canvas");
                canvas.width = imgElement.naturalWidth || imgElement.width || 100;
                canvas.height = imgElement.naturalHeight || imgElement.height || 100;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(imgElement, 0, 0);
                    return canvas.toDataURL("image/png");
                }
            } catch (canvasErr) {
                Logger.error("Canvas draw fallback failed due to tainted canvas (CORS restriction):", canvasErr);
            }
            return "";
        }
    },

    findUnderlyingImage: (targetElement) => {
        if (!targetElement || targetElement.nodeType !== Node.ELEMENT_NODE) return null;
        if (targetElement.tagName === 'IMG') return targetElement;
        if (['PICTURE', 'FIGURE', 'A'].includes(targetElement.tagName)) {
            return targetElement.querySelector('img');
        }
        return null;
    },

    checkModifiers: (e, configObj) => {
        if (!configObj) return false;
        return (e.ctrlKey === !!configObj.ctrl) &&
            (e.shiftKey === !!configObj.shift) &&
            (e.altKey === !!configObj.alt) &&
            (e.metaKey === !!configObj.meta);
    },

    showNotification: (message, color = '#10b981', x, y) => {
        Logger.debug(`Displaying notification tooltip: "${message}" at [${x}, ${y}]`);
        const popup = document.createElement('div');
        popup.className = 'cc-toast-notification';
        popup.innerText = message;

        const isCursorPos = (typeof x === 'number' && typeof y === 'number');

        if (isCursorPos) {
            // Cursor-following mini tooltip (used when clipping text/images near mouse)
            popup.style.cssText = `
            position: fixed;
            left: ${x + 15}px;
            top: ${y + 15}px;
            background: ${color};
            color: #ffffff;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 2147483648;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            transition: opacity 0.3s ease, transform 0.3s ease;
        `;
        } else {
            // Bottom-center dark theme toast matching Patens UI
            popup.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: #18181b;
            border: 1px solid #27272a;
            color: #f4f4f5;
            padding: 10px 20px;
            border-radius: 24px;
            font-size: 13px;
            font-weight: 500;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 2147483648;
            pointer-events: none;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            gap: 8px;
            transition: opacity 0.3s ease, transform 0.3s ease;
        `;
        }

        document.body.appendChild(popup);

        setTimeout(() => {
            popup.style.opacity = '0';
            popup.style.transform = isCursorPos ? 'translateY(-5px)' : 'translateX(-50%) translateY(10px)';
            setTimeout(() => popup.remove(), 300);
        }, 1800);

        return popup;}
    };
// ==========================================
// 4. DECLARATIVE UI BUILDER
// ==========================================
    Patens.UIBuilder = {
        /**
         * Safely and declaratively builds a DOM element.
         * @param {string} tag - The HTML tag name (e.g., 'div', 'button')
         * @param {Object} attrs - Attributes, styles, and event listeners
         * @param  {...(Node|string)} children - Child nodes or text strings
         * @returns {HTMLElement}
         */
        create: (tag, attrs = {}, ...children) => {
            const el = document.createElement(tag);

            for (const [key, value] of Object.entries(attrs)) {
                if (key.startsWith('on') && typeof value === 'function') {
                    el.addEventListener(key.substring(2).toLowerCase(), value);
                } else if (key === 'style') {
                    if (typeof value === 'string') {
                        el.style.cssText = value;
                    } else if (value && typeof value === 'object') {
                        Object.assign(el.style, value);
                    }
                } else if (key === 'className' || key === 'class') {
                    el.className = value;
                } else if (value !== null && value !== undefined) {
                    el.setAttribute(key, value);
                }
            }

            for (const child of children) {
                if (child == null || child === false) continue;

                if (typeof child === 'string' || typeof child === 'number') {
                    el.appendChild(document.createTextNode(child.toString()));
                } else if (child instanceof Node) {
                    el.appendChild(child);
                } else {
                    Logger.warn("Skipped invalid child node type passed to UIBuilder:", child);
                }
            }

            return el;
        }
    };

// Expose a short alias for rapid UI development
    Patens.h = Patens.UIBuilder.create;