import browser from 'webextension-polyfill';

const API_CONFIG = {
    defaultHost: "127.0.0.1",
    startPort: 8000,
    maxPort: 8010,
    discoveryTimeoutMs: 2000,
    timeoutMs: 15000,
    pdfTimeoutMs: 600000,
    headers: { "Content-Type": "application/json" }
};

let activeBaseUrl = null;

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS.DEBUG;

const Logger = {
    prefix: "[Patens Background]",
    debug(msg, ...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.DEBUG) console.debug(`${this.prefix} [DEBUG] ${msg}`, ...args);
    },
    info(msg, ...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.INFO) console.info(`${this.prefix} [INFO] ${msg}`, ...args);
    },
    warn(msg, ...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.WARN) console.warn(`${this.prefix} [WARN] ${msg}`, ...args);
    },
    error(msg, err = null, ...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.ERROR) {
            err ? console.error(`${this.prefix} [ERROR] ${msg}`, err, ...args) : console.error(`${this.prefix} [ERROR] ${msg}`, ...args);
        }
    }
};

// ==========================================
// 1. SERVER DISCOVERY & CORE FETCH
// ==========================================
async function checkPort(port) {
    const testUrl = `http://${API_CONFIG.defaultHost}:${port}/api/v1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Port ${port} discovery timed out`));
    }, API_CONFIG.discoveryTimeoutMs);

    try {
        const response = await fetch(`${testUrl}/config/system`, {
            signal: controller.signal,
            headers: { "Accept": "application/json" }
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data.status === "running") {
                return testUrl;
            }
        }
    } catch (err) {
        clearTimeout(timeoutId);
    }
    throw new Error(`Port ${port} not reachable`);
}

async function discoverServer() {
    if (activeBaseUrl) return activeBaseUrl;

    Logger.info(`Checking primary port ${API_CONFIG.startPort}...`);

    try {
        const primaryUrl = await checkPort(API_CONFIG.startPort);
        Logger.info(`✅ Found active Patens server on port ${API_CONFIG.startPort}`);
        activeBaseUrl = primaryUrl;
        return activeBaseUrl;
    } catch (err) {
        Logger.warn(`Primary port busy. Sweeping ports ${API_CONFIG.startPort + 1} to ${API_CONFIG.maxPort}...`);
    }

    const portChecks = [];
    for (let port = API_CONFIG.startPort + 1; port <= API_CONFIG.maxPort; port++) {
        portChecks.push(checkPort(port));
    }

    try {
        activeBaseUrl = await Promise.any(portChecks);
        Logger.info(`✅ Found active Patens server at: ${activeBaseUrl}`);
        return activeBaseUrl;
    } catch (err) {
        throw new Error("Could not find active Patens server on ports 8000-8010");
    }
}

async function coreFetch(endpoint, options = {}) {
    const timeoutMs = options.timeout || API_CONFIG.timeoutMs;
    const controller = new AbortController();
    let isTimeout = false;

    const timeoutId = setTimeout(() => {
        isTimeout = true;
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
        const baseUrl = await discoverServer();
        const method = options.method || "GET";

        let url;
        if (endpoint.startsWith("http")) {
            url = endpoint;
        } else {
            // Strip duplicate /api/v1 if present in relative path
            const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            const cleanBase = baseUrl.endsWith('/api/v1') && cleanEndpoint.startsWith('/api/v1')
                ? baseUrl.replace(/\/api\/v1$/, '')
                : baseUrl;
            url = `${cleanBase}${cleanEndpoint}`;
        }

        const { responseType, timeout, headers, ...fetchOptions } = options;

        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        const requestHeaders = isFormData
            ? { ...headers }
            : { ...API_CONFIG.headers, ...headers };

        const response = await fetch(url, {
            method,
            ...fetchOptions,
            headers: requestHeaders,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errText}`);
        }

        if (responseType === 'blob') return await response.blob();
        if (responseType === 'text') return await response.text();
        return await response.json();

    } catch (error) {
        clearTimeout(timeoutId);

        if (isTimeout || error.name === 'AbortError') {
            throw new Error(`Request to ${endpoint} timed out after ${timeoutMs / 1000}s.`);
        }

        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            activeBaseUrl = null;
        }
        throw error;
    }
}

// ==========================================
// 2. PATENS API CLIENT
// ==========================================
const PatensAPI = {
    getSettings: () => coreFetch("/config/hotkeys"),
    ingestItem: (payload) => coreFetch("/ingest", {
        method: "POST",
        body: JSON.stringify({
            url: payload.url || "unknown",
            title: payload.title || "Untitled",
            content: payload.content || "",
            type: payload.type || "text",
            media: payload.media || ""
        })
    }),
    ingestBatch: async (cartArray) => {
        if (!Array.isArray(cartArray) || cartArray.length === 0) return [];
        const results = [];
        for (const item of cartArray) {
            if (!item || typeof item !== 'object') continue;
            results.push(await PatensAPI.ingestItem(item));
        }
        return results;
    },
    deleteBatch: (idsArray) => {
        const idStr = Array.isArray(idsArray) ? idsArray.join(',') : String(idsArray);
        return coreFetch(`/api/v1/delete?ids=${encodeURIComponent(idStr)}`, {
            method: "DELETE",
            responseType: 'json'
        });
    },
    convertPdfUrl: (pdfUrl, title) => coreFetch("/pdf/convert-url", {
        method: "POST",
        body: JSON.stringify({ url: pdfUrl, title: title || "PDF Document" }),
        responseType: 'text',
        timeout: API_CONFIG.pdfTimeoutMs
    }),
    convertPdfFile: (blob, fileName) => {
        const formData = new FormData();
        formData.append("file", blob, fileName || "document.pdf");
        return coreFetch("/pdf/convert-file", {
            method: "POST",
            body: formData,
            responseType: 'text',
            timeout: API_CONFIG.pdfTimeoutMs
        });
    },
    getSpatialIndex: (pdfUrl, title) => coreFetch("/pdf/spatial-index-url", {
        method: "POST",
        body: JSON.stringify({ url: pdfUrl, title: title || "PDF Document" }),
        responseType: 'json',
        timeout: API_CONFIG.pdfTimeoutMs
    }),
    proxyFetch: (url, options = {}) => {
        if (typeof options === 'string') {
            options = { responseType: options };
        }
        return coreFetch(url, options);
    }
};

function isPdfUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.includes('extension/viewer/viewer.html') || url.includes('viewer.html') || url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) {
        return false;
    }
    const cleanUrl = url.toLowerCase().split('?')[0].split('#')[0];
    return cleanUrl.endsWith('.pdf') || url.includes('arxiv.org/pdf/');
}

// ==========================================
// 3. TAB NAVIGATION INTERCEPTOR
// ==========================================
const redirectingTabs = new Set();

chrome.tabs?.onUpdated.addListener((tabId, changeInfo, tab) => {
    const targetUrl = changeInfo.url || tab?.url;

    if (targetUrl && isPdfUrl(targetUrl) && !redirectingTabs.has(tabId)) {
        redirectingTabs.add(tabId);

        const viewerPath = chrome.runtime.getURL('extension/viewer/viewer.html');
        const redirectUrl = `${viewerPath}?url=${encodeURIComponent(targetUrl)}`;

        Logger.info(`🚀 Redirecting PDF tab [${tabId}] to Viewer -> ${redirectUrl}`);

        chrome.tabs.update(tabId, { url: redirectUrl }, () => {
            setTimeout(() => redirectingTabs.delete(tabId), 1000);
        });
    }
});

// ==========================================
// 4. EXTENSION EVENT LISTENERS & IPC
// ==========================================
chrome.runtime.onInstalled?.addListener(() => {
    PatensAPI.getSettings()
        .then(config => chrome.storage.local.set({ hotkeys: config }))
        .catch(err => Logger.warn("Initial hotkeys fetch failed during install:", err));
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. PING
    if (request.action === "ping" || request.type === "PATENS_PING") {
        sendResponse({ success: true, patensInstalled: true });
        return false;
    }

    // 2. GET BASE URL
    if (request.action === "get_base_url") {
        discoverServer()
            .then(baseUrl => sendResponse({ success: true, baseUrl }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // 3. DELETE CONTEXT
    if (request.action === "delete_context") {
        const ids = Array.isArray(request.ids) ? request.ids : [request.ids];
        PatensAPI.deleteBatch(ids)
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // 4. PROXY FETCH (Now passes method, headers, and body properly)
    if (request.action === "proxy_fetch") {
        const fetchOptions = {
            method: request.method || 'GET',
            responseType: request.responseType || 'json',
            headers: request.headers,
            body: request.body
        };
        PatensAPI.proxyFetch(request.url, fetchOptions)
            .then(responseData => sendResponse({ success: true, data: responseData }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // 5. INGEST BATCH
    if (request.action === "ingest_batch") {
        PatensAPI.ingestBatch(request.payload)
            .then(results => sendResponse({ success: true, data: results }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // 6. PDF CONVERT
    if (request.action === "convert_pdf_url") {
        (async () => {
            try {
                Logger.info(`[PDF Convert] Requesting conversion via URL -> ${request.url}`);
                const htmlContent = await PatensAPI.convertPdfUrl(request.url, request.title);
                sendResponse({ success: true, html: htmlContent });
            } catch (err) {
                Logger.warn(`[PDF Convert] Direct server fetch failed (${err.message}). Attempting browser-level fetch fallback...`);

                try {
                    const response = await fetch(request.url);
                    if (!response.ok) {
                        throw new Error(`Browser fetch failed with HTTP ${response.status}`);
                    }
                    const pdfBlob = await response.blob();
                    const fileName = (request.url.split('/').pop().split('?')[0]) || "Document.pdf";

                    Logger.info(`[PDF Convert] Uploading browser-downloaded blob (${pdfBlob.size} bytes) to server...`);
                    const htmlContent = await PatensAPI.convertPdfFile(pdfBlob, fileName);
                    sendResponse({ success: true, html: htmlContent });
                } catch (fallbackErr) {
                    Logger.error("❌ Both URL conversion and browser fallback failed:", fallbackErr);
                    sendResponse({ success: false, error: fallbackErr.message || "Failed to convert PDF" });
                }
            }
        })();
        return true;
    }

    // 7. SPATIAL INDEX
    if (request.action === "get_pdf_spatial_index") {
        PatensAPI.getSpatialIndex(request.url, request.title)
            .then(spatialData => sendResponse({ success: true, index: spatialData }))
            .catch(err => sendResponse({ success: false, error: err.message || "Failed to index PDF" }));
        return true;
    }

    sendResponse({ success: false, error: "Unknown message action" });
    return false;
});