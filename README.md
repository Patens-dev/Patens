<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/Patens-dev/Patens@main/assets/patens_full_logo_white.png" alt="Patens Logo" width="220" />

  <h1>patens</h1>
  <p><strong>The Zero-Friction Research & Synthesis Layer for AI.</strong></p>
  <p><em>Gather research in 1-click. Feed pure signal to AI.</em></p>

  <p>
    <a href="https://patens.dev"><img src="https://img.shields.io/badge/Extension-Chrome%20%7C%20Edge%20%7C%20Firefox-3b82f6?style=for-the-badge&logo=googlechrome" alt="Browser Extension" /></a>
    <a href="https://patens.dev"><img src="https://img.shields.io/badge/Backend-MS%20Store%20%7C%20VS%20Code%20%7C%20EXE-10b981?style=for-the-badge&logo=windows" alt="Backend Engine" /></a>
    <br/>
    <img src="https://img.shields.io/badge/100%25-Local_&_Air--Gapped-success?style=flat-square" alt="100% Local" />
    <img src="https://img.shields.io/badge/Protocol-MCP-blue?style=flat-square" alt="MCP Compatible" />
    <img src="https://img.shields.io/badge/Vector_DB-SQLite--vec-orange?style=flat-square" alt="SQLite-vec" />
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  </p>

  <p><a href="https://patens.dev"><strong>patens.dev</strong></a> • <a href="guide.html"><strong>Setup Guide</strong></a></p>
</div>

---
<div align="center">
  <video src="https://cdn.jsdelivr.net/gh/Patens-dev/Patens@main/assets/patens-hero.mp4" controls="controls" width="100%"></video>
</div>

## ❌ The Tab-Thrashing Agony vs ✨ The Patens Flow

| ❌ The Old Tab-Thrashing Grind | ✨ The Patens Flow State |
| :--- | :--- |
| **35 open tabs:** Competitor pages, Reddit reviews, SEC filings, and pricing matrices. | **1-Click capture:** Highlight text or figures as you browse with `Ctrl+Shift+Click`. |
| **Clipboard hell:** `Ctrl+C` ➔ `Alt+Tab` ➔ `Ctrl+V` × 60 into messy scratchpads. | **40s Undo Safety Ring:** Forgiving grace window to inspect, pause, or prune clips without breaking flow. |
| **Context pollution:** Pasting web pages into LLMs dumps navbars, ads, and cookie banners. | **Auto-Clustering:** Auto-coalesces snippets by source URL into a structured document tree. |
| **Lost provenance:** 2 hours later, you can't find which specific page had that vital stat. | **Automatic Citations:** Every paragraph retains its exact source URL, title, and timestamp. |
| **LLMs hallucinate** numbers from outdated training data or corrupted context. | **1-Key AI Injection:** Stream clean, token-optimized context directly into chatboxes or IDEs. |
| **Result:** Mental friction, token waste, and hours spent formatting raw text. | **Result:** Deep, multi-source synthesis in minutes with 100% verified source traceability. |

---

## ⚡ Core Features

- ⚡ **Zero-Friction Harvest:** Highlight paragraphs, tables, or quotes across 20+ tabs with `Ctrl+Shift+Click`. Patens silently indexes them in the background with a 40-second undo safety ring.
- 🖼️ **Multimodal Image Support:** Harvest diagrams, screenshots, and visual specs. Injected into AI chatboxes (ChatGPT, Claude, Gemini) as native image file attachments rather than raw Base64 text.
- 📚 **Automatic Citation Engine:** Every harvested paragraph retains its exact source URL, page title, and timestamp. When streamed to an LLM, it formats bibliographies and ground-truth citations automatically.
- 🎛️ **Hierarchical Command Palette (`Ctrl+Shift+Space`):** Summon a spotlight-style memory overlay anywhere. Search across local memory, expand documents into individual paragraphs with `←→`, and preview full clips with token counts.
- 🛒 **Multi-Select Context Staging:** Hold `Shift` while navigating with `↑↓` (or shift-click) to stage multiple snippets across disparate sources, then inject them all in one shot.
- 📂 **Physical Workspace Sync:** Auto-generates clean, human-readable `_context/` Markdown files directly inside your active workspace for Cursor, Obsidian, or Windsurf.
- 🤖 **Model Context Protocol (MCP):** Connects to Claude Desktop, Cursor, and JetBrains Copilot. Ask: *"Synthesize the competitor pricing models I gathered this morning"* to query local vector memory autonomously.
- 🔒 **100% Local & Air-Gapped:** Powered by local **FastEmbed** ONNX vectors and **SQLite-vec**. Research notes, internal wikis, and credentials never leave your machine. Zero cloud dependencies, zero telemetry.

---

## ⌨️ Shortcuts Reference

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Click</kbd> | **1-Click Harvest:** Capture highlighted text or image with source provenance | Browser |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> | **Command Palette:** Open search overlay to browse memory | Anywhere |
| <kbd>↑</kbd> / <kbd>↓</kbd> | **Navigate:** Move between documents and clips | Palette |
| <kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | **Multi-Select:** Select a range of items to inject together | Palette |
| <kbd>→</kbd> / <kbd>←</kbd> | **Expand / Collapse:** Drill into granular paragraphs within a document | Palette |
| <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> | **Inject Context:** Stream structured Markdown / images directly into active input | Palette |
| <kbd>Delete</kbd> | **Prune Memory:** Delete document or specific paragraph from database and disk | Palette |

---

## 🚀 How It Works (3 Steps)

### 1. Harvest As You Browse
Highlight any text snippet, table, or figure and press `Ctrl+Shift+Click`. Patens automatically vectorizes and stores it locally with full origin metadata.

### 2. Organize with Hierarchical Palette
Press `Ctrl+Shift+Space` to summon the palette. Search with keywords or filter by domain (`from:stripe.com`). Expand document trees to review individual paragraphs, token counts, and images.

### 3. Stream Pure Signal to AI
Press `Enter` to stream cited Markdown directly into your active input—whether in ChatGPT, Claude, Gemini, Cursor, or VS Code.

---

## 📦 Installation & Setup

### Step 1: Install Browser Extension
- 🌐 **Chrome / Edge / Brave:** [Download Extension (.zip)](https://download.patens.dev/latest/extension.zip) *(Load unpacked via `chrome://extensions`)*[cite: 2]
- 🦊 **Firefox:** [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/patens/)

### Step 2: Install Local Memory Engine
Choose your preferred distribution:
- 🏪 **Microsoft Store:** [Get on MS Store](ms-windows-store://pdp/?productid=9PM9R44F0RXV) *(Sandboxed desktop background app)*
- 💻 **VS Code / Cursor Extension:** [Install Marketplace Extension](vscode:extension/patens-dev.patens) *(Auto-spins up local background engine)*
- 📦 **Direct .EXE Installer:** [Download .EXE Installer](https://download.patens.dev/latest/patens_installer.exe) *(For standalone setups, Obsidian, & offline dev)*

---

## ⚙️ Model Context Protocol (MCP) Configuration

The background engine exposes a local FastMCP stdio server sharing the same SQLite vector memory.

### Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "patens": {
      "command": "patens",
      "args": ["mcp"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "patens": {
      "command": "patens",
      "args": ["mcp"]
    }
  }
}
```

### JetBrains / Visual Studio 2022 (GitHub Copilot)
1. Install **GitHub Copilot** in your editor.
2. Run the Patens desktop background engine (MS Store or `.EXE`).[cite: 1, 2]
3. Enable Agent mode in Copilot settings to query Patens vector memory autonomously.

---

## 📁 The `_context/` Workspace Directory

When running inside an IDE workspace, Patens automatically writes and maintains a physical context directory:

```
_context/
├── 00_Context_Index.md          # Master index of all research sources
├── Pricing_Specs_Stripe_*.md    # Auto-coalesced clips by source URL
├── API_Documentation_*.md
└── .gitignore                   # Keeps research local if preferred
```

Each document is:
- **Auto-grouped by source URL** (merges clips from the same page).
- **Token-calculated** (provides estimated prompt token counts).
- **Physical & Portable** (point Cursor, Obsidian, or Copilot directly to files with `@` mentions).

---

## 🔐 Privacy & Security

- ✅ **100% Local Execution:** FastEmbed CPU embeddings & SQLite-vec run entirely on your hardware.
- ✅ **Zero Telemetry:** No user tracking, analytics, or remote API pings.
- ✅ **Air-Gapped Ready:** Works fully offline with local vector databases.
- ✅ **Open Source:** Licensed under the MIT License.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
