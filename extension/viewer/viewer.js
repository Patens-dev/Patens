import '../content/config.js';
import '../content/utils.js';
import '../content/cart.js';
import '../content/injector.js';
import '../content/palette.js';
import '../content/main.js';

let convertedHtmlCache = null;
let currentViewMode = 'native';

// ==========================================
// DIRECT SERVER DISCOVERY (Bypasses IPC collisions)
// ==========================================
async function getBaseUrl() {
  const hosts = ["127.0.0.1", "localhost"];

  // Fast Path: Test default port 8000 first
  for (const host of hosts) {
    const defaultUrl = `http://${host}:8000/api/v1`;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 1200);
      const resp = await fetch(`${defaultUrl}/config/system`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === "running") return defaultUrl;
      }
    } catch (e) {}
  }

  // Fallback Sweep: Check ports 8001 to 8010
  for (const host of hosts) {
    for (let port = 8001; port <= 8010; port++) {
      const testUrl = `http://${host}:${port}/api/v1`;
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 800);
        const resp = await fetch(`${testUrl}/config/system`, { signal: ctrl.signal });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json();
          if (data.status === "running") return testUrl;
        }
      } catch (e) {}
    }
  }

  throw new Error("Could not find active Patens server on ports 8000-8010");
}

// ==========================================
// VIEWER CONTROLLER
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const pdfUrl = params.get('url');

  if (!pdfUrl) return;

  const fileName = pdfUrl.split('/').pop().split('?')[0] || "Document.pdf";
  const docTitle = `📄 ${fileName}`;
  document.title = docTitle;

  const pdfEmbed = document.getElementById('pdf-embed');
  const switchBadge = document.getElementById('patens-switch-badge');
  const badgeText = document.getElementById('badge-text');
  const badgeSpinner = document.getElementById('badge-spinner');

  // 1. Instant Native PDF View (0ms UI latency)
  try {
    const response = await fetch(pdfUrl);
    if (response.ok) {
      const pdfBlob = await response.blob();
      pdfEmbed.src = URL.createObjectURL(pdfBlob);
    } else {
      pdfEmbed.src = pdfUrl;
    }
  } catch (err) {
    pdfEmbed.src = pdfUrl;
  }

  // 2. Client-Side Session Storage Cache Check
  const cacheKey = `patens_html_cache_${btoa(pdfUrl).slice(0, 32)}`;
  const cachedHtml = sessionStorage.getItem(cacheKey);

  if (cachedHtml) {
    console.log("[Patens Viewer] ⚡ Instant load from sessionStorage cache!");
    convertedHtmlCache = cachedHtml;
    enableSwitchBadge(switchBadge, badgeSpinner, badgeText);
    return;
  }

  // 3. Direct HTTP Conversion
  (async () => {
    try {
      const baseUrl = await getBaseUrl();
      console.log(`[Patens Viewer] Connected directly to Patens server at: ${baseUrl}`);

      let htmlContent = null;

      // Attempt A: Server-side URL fetch
      try {
        console.log(`[Patens Viewer] Requesting conversion via server URL -> ${pdfUrl}`);
        const response = await fetch(`${baseUrl}/pdf/convert-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pdfUrl, title: fileName })
        });

        if (response.ok) {
          htmlContent = await response.text();
        } else {
          console.warn(`[Patens Viewer] Server returned ${response.status}. Attempting browser download fallback...`);
        }
      } catch (e) {
        console.warn("[Patens Viewer] Server URL fetch failed, falling back to browser download...", e);
      }

      // Attempt B: Browser-side download fallback (for sites blocking backend with 403)
      if (!htmlContent) {
        console.info("[Patens Viewer] Downloading PDF via browser context...");
        const fileResp = await fetch(pdfUrl);
        if (!fileResp.ok) throw new Error(`Browser download failed with HTTP ${fileResp.status}`);
        const pdfBlob = await fileResp.blob();

        const formData = new FormData();
        formData.append("file", pdfBlob, fileName);

        const uploadResp = await fetch(`${baseUrl}/pdf/convert-file`, {
          method: "POST",
          body: formData
        });

        if (!uploadResp.ok) {
          const errText = await uploadResp.text();
          throw new Error(`Server returned ${uploadResp.status}: ${errText}`);
        }
        htmlContent = await uploadResp.text();
      }

      if (htmlContent) {
        convertedHtmlCache = htmlContent;

        try {
          sessionStorage.setItem(cacheKey, htmlContent);
        } catch (e) {
          console.warn("[Patens Viewer] sessionStorage quota exceeded, keeping in JS memory.");
        }

        enableSwitchBadge(switchBadge, badgeSpinner, badgeText);
      }
    } catch (err) {
      console.error("[Patens Viewer] Conversion failed:", err);
      if (badgeSpinner) badgeSpinner.remove();
      if (badgeText) badgeText.textContent = "⚠️ Conversion Failed";
    }
  })();

  // Shortcut (Ctrl + Space) to toggle view
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Space' && convertedHtmlCache) {
      e.preventDefault();
      toggleViewMode();
    }
  });
});

function enableSwitchBadge(switchBadge, badgeSpinner, badgeText) {
  const badgeIcon = document.getElementById('badge-icon');

  if (badgeSpinner) badgeSpinner.remove();
  if (badgeIcon) badgeIcon.style.display = 'block';
  if (switchBadge) switchBadge.classList.add('ready');
  if (badgeText) badgeText.textContent = "Switch Mode";

  switchBadge.addEventListener('click', toggleViewMode);
}

function toggleViewMode() {
  const pdfEmbed = document.getElementById('pdf-embed');
  const htmlContainer = document.getElementById('html-container');
  const badgeText = document.getElementById('badge-text');
  const badgeIcon = document.getElementById('badge-icon');

  if (currentViewMode === 'native') {
    currentViewMode = 'interactive';
    pdfEmbed.style.display = 'none';
    htmlContainer.style.display = 'block';

    if (!htmlContainer.hasChildNodes()) {
      renderConvertedHtml(convertedHtmlCache);
    }

    if (badgeIcon) badgeIcon.style.display = 'none';
    badgeText.textContent = "📄 Back to Native PDF";
  } else {
    currentViewMode = 'native';
    htmlContainer.style.display = 'none';
    pdfEmbed.style.display = 'block';

    if (badgeIcon) badgeIcon.style.display = 'block';
    badgeText.textContent = "Switch Mode";
  }
}

function renderConvertedHtml(rawHtml) {
  const container = document.getElementById('html-container');
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  const styles = doc.querySelectorAll('style, link[rel="stylesheet"]');
  styles.forEach(style => document.head.appendChild(style.cloneNode(true)));

  const documentViewer = doc.querySelector('#document-viewer');
  if (documentViewer) {
    container.replaceChildren(documentViewer);
  } else {
    container.replaceChildren(...Array.from(doc.body.childNodes));
  }

  setTimeout(() => {
    try {
      window.Patens?.Cart?.renderUI?.();
    } catch (e) {}
  }, 100);
}