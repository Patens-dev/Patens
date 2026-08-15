// extension/content/utils.js

window.Patens = window.Patens || {};

// ==========================================
// 1. CENTRAL LOGGER UTILITY
// ==========================================
Patens.LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
Patens.CURRENT_LOG_LEVEL = Patens.LOG_LEVELS.DEBUG;

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

const Logger = Patens.LoggerFactory("[Patens API & Utils]");
Logger.info("Central Logger initialized. API Service & Utils loaded.");

// ==========================================
// 2. GLOBAL FOCUS TRACKER FOR INJECTOR
// ==========================================
document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!target) return;

    const isEditable = (
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'INPUT' ||
        target.isContentEditable ||
        target.getAttribute('contenteditable') === 'true'
    );

    if (isEditable) {
        // Exclude internal Patens extension UI elements from active input tracking
        const isExtensionUI = target.closest('#patens-palette-overlay') || target.closest('#patens-context-cart-root');
        if (!isExtensionUI) {
            Patens.State = Patens.State || {};
            Patens.State.editor = Patens.State.editor || {};
            Patens.State.editor.activeInputElement = target;
        }
    }
}, true);

// ==========================================
// 3. API SERVICE (Content Script -> Background)
// ==========================================
Patens.API = {
    /** Proxies requests through background.js to bypass CORS */
    fetchProxy: (url, responseType = 'json') => {
        Logger.debug(`Initiating proxy fetch via runtime messaging [Type: ${responseType}] -> ${url}`);
        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "proxy_fetch", url, responseType }, (response) => {
                const duration = (performance.now() - startTime).toFixed(2);

                if (chrome.runtime.lastError) {
                    const lastErr = chrome.runtime.lastError.message || "Runtime messaging port closed";
                    Logger.error(`Proxy fetch messaging failed after ${duration}ms for ${url}:`, null, lastErr);
                    return reject(new Error(lastErr));
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
                        resolve(new Blob([u8arr], { type: mime }));
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
        const payloadArray = Array.isArray(payload) ? payload : [payload];
        Logger.info(`Sending batch ingestion request for ${payloadArray.length} items...`);
        const startTime = performance.now();

        // SANITIZE: Ensure only serializable primitives are sent over background IPC
        const safePayload = payloadArray.map(item => ({
            id: item.id || Date.now().toString() + Math.random().toString().slice(2, 6),
            hash: item.hash || "",
            type: item.type || (item.isImage ? "image" : "text"),
            url: item.url || window.location.href,
            title: item.title || document.title || "Untitled",
            content: item.content || item.text || "",
            media: item.media || item.base64Data || ""
        }));

        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ action: "ingest_batch", payload: safePayload }, (response) => {
                    const duration = (performance.now() - startTime).toFixed(2);

                    if (chrome.runtime.lastError) {
                        const lastErr = chrome.runtime.lastError.message || "Runtime messaging port closed";
                        Logger.error(`Ingest batch runtime message failed after ${duration}ms:`, null, lastErr);
                        resolve({ success: false, error: lastErr });
                        return;
                    }

                    if (!response) {
                        Logger.error(`Message sent, but background script returned no response after ${duration}ms.`);
                        resolve({ success: false, error: "Background script failed to respond." });
                        return;
                    }

                    Logger.info(`Batch ingestion response received in ${duration}ms`, response);
                    resolve(response);
                });
            } catch (err) {
                Logger.error("Failed to execute sendMessage:", err);
                resolve({ success: false, error: err.message });
            }
        });
    }
};

// ==========================================
// 4. HELPER & EXTRACTION UTILITIES
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

        const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

        if (isToday) {
            if (diffMs < 60000) return `Just now`;
            if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
            return `Today at ${timeStr}`;
        }
        if (isYesterday) return `Yesterday at ${timeStr}`;

        const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
        if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
        return date.toLocaleDateString(undefined, opts);
    },

    getSmartTitle: () => {
        const url = window.location.href;
        try {
            if (url.includes("arxiv.org")) {
                const titleEl = document.querySelector('h1.title') || document.querySelector('title');
                if (titleEl) return titleEl.innerText.replace(/^Title:\s*/i, '').trim();
            }
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
            if (url.includes("deepseek.com")) {
                const el = document.querySelector('title');
                if (el) return el.innerText.replace(' - DeepSeek', '').trim();
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

    /**
     * Resolves the nearest cohesive semantic unit (e.g. pricing feature rows, cards, tables).
     */
    getSemanticContainer: (target) => {
        if (!target || target === document.body || target === document.documentElement) {
            return null;
        }

        // 1. Specific Feature / Pricing row level (e.g. Stripe, Paddle, LemonSqueezy)
        const featureUnit = target.closest(
            '.PricingProductFeature, ' +
            '.PricingGridPrice, ' +
            '[class*="PricingTier"], ' +
            '[class*="PricingCard"], ' +
            '[class*="pricing-row"], ' +
            '[class*="plan-card"], ' +
            '[data-testid*="pricing"], ' +
            'tr, li.ListItem, li.List__item'
        );
        if (featureUnit) return featureUnit;

        // 2. Cohesive Product Card / Section level
        const cardUnit = target.closest(
            '.PricingProductCard, ' +
            '.ProductGroupDisplay__productSection, ' +
            '[class*="Card--"], ' +
            'article, section[id], ' +
            '.patens-pdf-block, .patens-pdf-figure'
        );
        if (cardUnit) return cardUnit;

        // 3. Fallback: Search parent for balanced semantic text block
        let current = target;
        while (current && current !== document.body) {
            const textLen = (current.innerText || '').trim().length;
            if (textLen > 30 && textLen < 1200) {
                return current;
            }
            current = current.parentElement;
        }

        return target;
    },

    /**
     * Serializes complex pricing containers or UI cards into clean, readable Markdown.
     */
    extractStructuredText: (container) => {
        if (!container) return "";

        // PDF Block extraction support
        if (container.classList && container.classList.contains('patens-pdf-block')) {
            return container.dataset.cleanText || container.getAttribute('data-clean-text') || container.innerText.trim();
        }

        // Detect structured pricing unit (e.g. Stripe / SaaS pricing feature rows)
        const titleEl = container.querySelector('[class*="title"], h1, h2, h3, h4, strong');
        const descEl = container.querySelector('[class*="body"], [class*="desc"], [class*="copy"] p, p');
        const amountEl = container.querySelector('[class*="amount"], [class*="Price"], [class*="price"]');
        const labelEl = container.querySelector('[class*="label"], [class*="caption"]');
        const subprices = Array.from(container.querySelectorAll('[class*="Subprice"], [class*="disclaimer"], [class*="footnote"]'));

        if (titleEl && (amountEl || descEl)) {
            let output = `### ${titleEl.innerText.trim()}\n`;
            if (descEl && descEl !== titleEl) {
                output += `*Description:* ${descEl.innerText.trim()}\n`;
            }
            if (amountEl) {
                const labelText = labelEl ? ` ${labelEl.innerText.trim()}` : '';
                output += `**Base Rate:** ${amountEl.innerText.trim()}${labelText}\n`;
            }

            if (subprices.length > 0) {
                output += `**Additional Fees & Modifiers:**\n`;
                subprices.forEach(sub => {
                    const cleanSub = sub.innerText.trim().replace(/\n+/g, ' ');
                    if (cleanSub) output += `• ${cleanSub}\n`;
                });
            }
            return output.trim();
        }

        // Fallback: Clean innerText collapsing excess newlines
        return (container.innerText || "")
            .replace(/\r\n/g, '\n')
            .replace(/\n\s*\n\s*\n+/g, '\n\n')
            .trim();
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
        const isCursorPos = (typeof x === 'number' && !isNaN(x) && typeof y === 'number' && !isNaN(y));
        Logger.debug(`Displaying notification tooltip: "${message}"` + (isCursorPos ? ` at [${x}, ${y}]` : ''));

        const popup = document.createElement('div');
        popup.className = 'cc-toast-notification';
        popup.innerText = message;

        if (isCursorPos) {
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

        return popup;
    }
};

// ==========================================
// 5. DECLARATIVE UI BUILDER
// ==========================================
Patens.UIBuilder = {
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

Patens.h = Patens.UIBuilder.create;