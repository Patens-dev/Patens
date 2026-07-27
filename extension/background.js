const API_CONFIG = {
    // ✨ FIX: Use 127.0.0.1 explicitly to bypass Chrome's IPv6 localhost bugs
    baseUrl: "http://127.0.0.1:8000/api/v1",
    timeoutMs: 15000,
    headers: { "Content-Type": "application/json" }
};

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS.DEBUG;

const Logger = {
    prefix: "[Patens Background]",
    debug(msg, ...args) { if (CURRENT_LOG_LEVEL <= LOG_LEVELS.DEBUG) console.debug(`${this.prefix} [DEBUG] ${msg}`, ...args); },
    info(msg, ...args) { if (CURRENT_LOG_LEVEL <= LOG_LEVELS.INFO) console.info(`${this.prefix} [INFO] ${msg}`, ...args); },
    warn(msg, ...args) { if (CURRENT_LOG_LEVEL <= LOG_LEVELS.WARN) console.warn(`${this.prefix} [WARN] ${msg}`, ...args); },
    error(msg, err = null, ...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.ERROR) {
            err ? console.error(`${this.prefix} [ERROR] ${msg}`, err, ...args) : console.error(`${this.prefix} [ERROR] ${msg}`, ...args);
        }
    }
};

async function coreFetch(endpoint, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);
    const method = options.method || "GET";
    const url = endpoint.startsWith("http") ? endpoint : `${API_CONFIG.baseUrl}${endpoint}`;

    Logger.debug(`Executing HTTP ${method} -> ${url}`);

    try {
        const response = await fetch(url, {
            ...options,
            headers: { ...API_CONFIG.headers, ...options.headers },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errText}`);
        }

        if (options.responseType === 'blob') return await response.blob();
        if (options.responseType === 'text') return await response.text();
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error("Local server timed out. Is Python running?");
        throw error;
    }
}

const PatensAPI = {
    getSettings: () => coreFetch("/config/hotkeys"),
    ingestItem: (payload) => {
        return coreFetch("/ingest", {
            method: "POST",
            body: JSON.stringify({
                url: payload.url || "unknown",
                title: payload.title || "Untitled",
                content: payload.content || "",
                type: payload.type || "text",
                media: payload.media || ""
            })
        });
    },
    ingestBatch: async (cartArray) => {
        if (!Array.isArray(cartArray) || cartArray.length === 0) return [];
        const results = [];
        for (const item of cartArray) {
            results.push(await PatensAPI.ingestItem(item));
        }
        return results;
    },
    proxyFetch: (url, responseType = 'text') => coreFetch(url, { responseType })
};

chrome.runtime.onInstalled.addListener(() => {
    PatensAPI.getSettings().then(config => chrome.storage.local.set({ hotkeys: config })).catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    Logger.debug(`Message received: '${request.action}'`);

    if (request.action === "ingest_batch") {
        PatensAPI.ingestBatch(request.payload)
            .then((results) => {
                Logger.info("Batch ingested successfully.");
                sendResponse({ success: true, data: results });
            })
            .catch((err) => {
                Logger.error("Batch ingestion failed:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep message channel open
    }

    if (request.action === "proxy_fetch") {
        PatensAPI.proxyFetch(request.url, request.responseType)
            .then(async (data) => {
                if (request.responseType === 'blob') {
                    try {
                        const buffer = await data.arrayBuffer();
                        let binary = '';
                        const bytes = new Uint8Array(buffer);
                        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                        sendResponse({ success: true, data: `data:${data.type || 'image/png'};base64,${btoa(binary)}` });
                    } catch (e) {
                        sendResponse({ success: false, error: "Failed to read blob data" });
                    }
                } else {
                    sendResponse({ success: true, data });
                }
            })
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
    }
});