import browser from 'webextension-polyfill';

const API_CONFIG = {
  defaultHost: "127.0.0.1",
  startPort: 8000,
  maxPort: 8010,
  timeoutMs: 15000,
  headers: { "Content-Type": "application/json" }
};

let activeBaseUrl = null;

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

// ==========================================
// 1. SERVER DISCOVERY & CORE FETCH
// ==========================================
async function discoverServer() {
  if (activeBaseUrl) return activeBaseUrl;

  Logger.info(`Sweeping ports ${API_CONFIG.startPort} to ${API_CONFIG.maxPort}...`);

  for (let port = API_CONFIG.startPort; port <= API_CONFIG.maxPort; port++) {
    const testUrl = `http://${API_CONFIG.defaultHost}:${port}/api/v1`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300);

      const response = await fetch(`${testUrl}/config/system`, {
        signal: controller.signal,
        headers: { "Accept": "application/json" }
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.status === "running") {
          Logger.info(`✅ Found active Patens server on port ${port}`);
          activeBaseUrl = testUrl;
          return activeBaseUrl;
        }
      }
    } catch (err) {}
  }

  throw new Error("Could not find active Patens server on ports 8000-8010");
}

async function coreFetch(endpoint, options = {}) {
  try {
    const baseUrl = await discoverServer();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeoutMs);

    const method = options.method || "GET";
    const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;

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
  convertPdfUrl: (pdfUrl, title) => coreFetch("/pdf/convert-url", {
    method: "POST",
    body: JSON.stringify({
      url: pdfUrl,
      title: title || "PDF Document"
    }),
    responseType: 'text'
  }),
  getSpatialIndex: (pdfUrl, title) => coreFetch("/pdf/spatial-index-url", {
    method: "POST",
    body: JSON.stringify({
      url: pdfUrl,
      title: title || "PDF Document"
    }),
    responseType: 'json'
  }),
  proxyFetch: (url, responseType = 'json') => coreFetch(url, { responseType })
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
chrome.tabs?.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && isPdfUrl(changeInfo.url)) {
    const viewerPath = chrome.runtime.getURL('extension/viewer/viewer.html');
    const redirectUrl = `${viewerPath}?url=${encodeURIComponent(changeInfo.url)}`;
    Logger.info(`🚀 Redirecting PDF tab [${tabId}] to Viewer -> ${redirectUrl}`);
    chrome.tabs.update(tabId, { url: redirectUrl });
  }
});

// ==========================================
// 4. EXTENSION EVENT LISTENERS & IPC
// ==========================================
chrome.runtime.onInstalled?.addListener(() => {
  PatensAPI.getSettings()
    .then(config => chrome.storage.local.set({ hotkeys: config }))
    .catch(err => Logger.warn("Initial hotkeys fetch failed during install:", err));

  chrome.contextMenus?.create({
    id: "patens_capture_pdf",
    title: "📦 Capture Document to Patens Cart",
    contexts: ["page", "link", "selection"]
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. PING / STATUS HANDLER
  if (request.action === "ping" || request.type === "PATENS_PING") {
    sendResponse({ success: true, patensInstalled: true });
    return true;
  }

  // 2. PROXY FETCH HANDLER
  if (request.action === "proxy_fetch") {
    (async () => {
      try {
        Logger.info(`[Proxy Fetch] Proxying request -> ${request.url}`);
        const responseData = await PatensAPI.proxyFetch(
          request.url,
          request.responseType || 'json'
        );
        sendResponse({ success: true, data: responseData });
      } catch (err) {
        Logger.error("❌ Proxy fetch error:", err);
        sendResponse({
          success: false,
          error: err.message || "Could not complete proxy request to Patens server"
        });
      }
    })();
    return true;
  }

  // 3. INGEST BATCH HANDLER
  if (request.action === "ingest_batch") {
    (async () => {
      try {
        const results = await PatensAPI.ingestBatch(request.payload);
        sendResponse({ success: true, data: results });
      } catch (err) {
        sendResponse({ success: false, error: err.message || "Could not connect to Patens server" });
      }
    })();
    return true;
  }

  // 4. PDF CONVERT HANDLER
  if (request.action === "convert_pdf_url") {
    (async () => {
      try {
        Logger.info(`[PDF Convert] Requesting async HTML conversion -> ${request.url}`);
        const htmlContent = await PatensAPI.convertPdfUrl(request.url, request.title);
        sendResponse({ success: true, html: htmlContent });
      } catch (err) {
        Logger.error("❌ Failed to convert PDF URL via Patens server:", err);
        sendResponse({ success: false, error: err.message || "Failed to convert PDF" });
      }
    })();
    return true;
  }

  // 5. SPATIAL INDEX HANDLER
  if (request.action === "get_pdf_spatial_index") {
    (async () => {
      try {
        Logger.info(`[Spatial Index] Requesting spatial index from Patens server -> ${request.url}`);
        const spatialData = await PatensAPI.getSpatialIndex(request.url, request.title);
        sendResponse({ success: true, index: spatialData });
      } catch (err) {
        Logger.error("❌ Failed to fetch PDF spatial index:", err);
        sendResponse({ success: false, error: err.message || "Failed to index PDF" });
      }
    })();
    return true;
  }

  sendResponse({ success: false, error: "Unknown message action" });
  return false;
});

// Context Menu Right-Click Handler (Direct Server Capture)
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "patens_capture_pdf") {
    const targetUrl = info.linkUrl || info.pageUrl || tab?.url;
    if (!targetUrl) return;

    const fileName = targetUrl.split('/').pop().split('?')[0] || "Document.pdf";
    Logger.info(`Context menu triggered capture for: ${targetUrl}`);

    try {
      const spatialIndex = await PatensAPI.getSpatialIndex(targetUrl, fileName);
      if (spatialIndex) {
        const storage = await chrome.storage.local.get(['contextCart']);
        const cart = storage.contextCart || [];

        cart.push({
          id: Date.now().toString() + Math.random().toString().slice(2, 6),
          hash: Date.now().toString(),
          type: 'text',
          url: targetUrl,
          title: `📄 ${fileName}`,
          content: `Document spatial index captured (${spatialIndex.length || 0} pages)`,
          media: ''
        });

        await chrome.storage.local.set({ contextCart: cart });
        Logger.info(`✅ Saved document context to cart for ${fileName}`);
      }
    } catch (err) {
      Logger.error("❌ Context menu document capture failed:", err);
    }
  }
});