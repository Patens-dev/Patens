import '../content/config.js';
import '../content/utils.js';
import '../content/cart.js';
import '../content/injector.js';
import '../content/palette.js';
import '../content/main.js';

let convertedHtmlCache = null;
let currentViewMode = 'native';

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

  // 2. Client-Side Session Storage Cache Check (Instant load on refresh)
  const cacheKey = `patens_html_cache_${btoa(pdfUrl).slice(0, 32)}`;
  const cachedHtml = sessionStorage.getItem(cacheKey);

  if (cachedHtml) {
    console.log("[Patens Viewer] ⚡ Instant load from sessionStorage cache!");
    convertedHtmlCache = cachedHtml;
    enableSwitchBadge(switchBadge, badgeSpinner, badgeText);
    return;
  }

  // 3. Request Background Conversion (Server checks MD5 checksum)
  chrome.runtime.sendMessage(
    { action: "convert_pdf_url", url: pdfUrl, title: fileName },
    (response) => {
      // Consume lastError first to prevent hanging promises & port closure errors
      if (chrome.runtime.lastError) {
        console.warn("[Patens Viewer] Background conversion IPC error:", chrome.runtime.lastError.message);
        if (badgeSpinner) badgeSpinner.remove();
        if (badgeText) badgeText.innerText = "⚠️ Conversion Failed";
        return;
      }

      if (response && response.success && response.html) {
        convertedHtmlCache = response.html;

        // Save in sessionStorage for zero-latency page refreshes
        try {
          sessionStorage.setItem(cacheKey, response.html);
        } catch (e) {
          console.warn("[Patens Viewer] sessionStorage quota exceeded, skipping local cache.");
        }

        enableSwitchBadge(switchBadge, badgeSpinner, badgeText);
      } else {
        if (badgeSpinner) badgeSpinner.remove();
        if (badgeText) badgeText.innerText = "⚠️ Conversion Failed";
      }
    }
  );

  // Shortcut (Ctrl + Space) to toggle view
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Space' && convertedHtmlCache) {
      e.preventDefault();
      toggleViewMode();
    }
  });
});

function enableSwitchBadge(switchBadge, badgeSpinner, badgeText) {
  if (badgeSpinner) badgeSpinner.remove();
  if (switchBadge) switchBadge.classList.add('ready');
  if (badgeText) badgeText.innerHTML = "⚡ Switch to Patens Mode";

  switchBadge.addEventListener('click', toggleViewMode);
}

function toggleViewMode() {
  const pdfEmbed = document.getElementById('pdf-embed');
  const htmlContainer = document.getElementById('html-container');
  const badgeText = document.getElementById('badge-text');

  if (currentViewMode === 'native') {
    currentViewMode = 'interactive';
    pdfEmbed.style.display = 'none';
    htmlContainer.style.display = 'block';

    if (!htmlContainer.hasChildNodes()) {
      renderConvertedHtml(convertedHtmlCache);
    }

    badgeText.innerHTML = "📄 Back to Native PDF";
  } else {
    currentViewMode = 'native';
    htmlContainer.style.display = 'none';
    pdfEmbed.style.display = 'block';

    badgeText.innerHTML = "⚡ Switch to Patens Mode";
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
    container.appendChild(documentViewer);
  } else {
    container.innerHTML = doc.body.innerHTML;
  }

  setTimeout(() => {
    try {
      window.Patens?.Cart?.renderUI?.();
    } catch (e) {}
  }, 100);
}