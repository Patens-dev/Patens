<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/Patens-dev/Patens@main/assets/patens_full_logo_white.png" alt="Patens.dev Logo" width="180" />

  <h1>Patens</h1>
  <p><strong>Stop copy-pasting web docs into your IDE — or any AI chat.</strong></p>

  <p>
    <a href="https://patens.dev"><img src="https://img.shields.io/badge/Extension-Chrome%20%7C%20Firefox%20%7C%20Edge-3b82f6?style=for-the-badge&logo=googlechrome" alt="Browser Extension" /></a>
    <a href="https://patens.dev"><img src="https://img.shields.io/badge/Backend-MS%20Store%20%7C%20VS%20Code%20%7C%20EXE-10b981?style=for-the-badge&logo=windows" alt="Backend Engine" /></a>
    <br/>
    <img src="https://img.shields.io/badge/100%25-Local_&_Private-success?style=flat-square" alt="100% Local" />
    <img src="https://img.shields.io/badge/Protocol-MCP-blue?style=flat-square" alt="MCP Compatible" />
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  </p>

  <p><em>Never explain your context twice. 1-click browser context straight to Cursor, VS Code, and Cline — or pasted directly into ChatGPT, Claude, Gemini, and even WhatsApp Web.</em></p>

  <p><a href="https://patens.dev"><strong>patens.dev</strong></a></p>
</div>

---
<div align="center">
  <video 
    src="https://raw.githubusercontent.com/Patens-dev/Patens/main/assets/patens-hero.gif" 
    autoplay 
    loop 
    muted 
    playsinline 
    width="100%" 
    style="border-radius: 8px;">
  </video>
</div>

## ❌ The Broken Workflow vs ✨ The Patens Workflow

| ❌ The Old Copy-Paste Grind | ✨ The Patens Workflow |
| :--- | :--- |
| **Pasting docs into prompts** wastes half your context window. | **Highlight text in browser** and hit `Ctrl+Shift+C`. |
| **Standard `@docs` scrapers fail** on gated pages, Notion, or SPAs. | **Captures rendered DOM** directly from active browser tabs. |
| **LLMs hallucinate methods** from outdated training data. | **Auto-mounts physical Markdown** straight into `_context/`. |
| **Copying one clip at a time between tabs.** | **Context Cart:** select clips from multiple sources, inject all at once. |
| **Re-typing the same context in every new chat.** | **Command Palette** injects saved memory into any chat input, anywhere. |
| **Result:** Broken builds, lost flow state, and repeated prompts. | **Result:** 100% accurate AI code generation on the first try. |

---

## ⚡ Core Features

- ⚡ **Zero-Friction Capture:** Highlight text or images on any web page and press `Ctrl+Shift+C`. It vectorizes directly to your local database, even behind logins, Notion specs, or SPAs.
- 🎛️ **Command Palette, Anywhere:** Summon a spotlight-style search overlay on *any* website — search your saved memory with plain text or `from:domain.com` filters, preview the full clip, and inject it straight into whatever text field is focused: a ChatGPT prompt, a Claude.ai chat, a Notion doc, even a WhatsApp Web message box.
- 🛒 **Context Cart (Multi-Select Injection):** Don't want to inject one clip at a time? Shift+click or Shift+↑↓ to stage multiple saved snippets — pulled from different tabs or sources — into a cart, then hit **Paste Items** to inject them all into the current conversation in one shot.
- ⏪ **Instant Recall:** Hit Enter on an empty palette search to grab and inject your most recently saved clip — no searching required.
- 📂 **Physical File Mounting:** Patens writes vector-indexed Markdown files directly into your project's `_context/` directory. Tag them in Cursor, Copilot, or Cline using simple `@` file references.
- 🔎 **Query With or Without `_context`:** Your AI assistant isn't limited to reading the synced Markdown files — an MCP tool lets it search your local vector memory on demand at query time, so you can ask for relevant context even if it was never written to disk as a file.
- 🧠 **Two-Way IDE Memory:** It's not just browser → IDE. Your AI can *write back* — saving an architectural decision or debugging insight from inside your editor straight into the same searchable memory, so it resurfaces later in the browser or another project.
- 🔒 **100% Private & Local:** Powered by local **SQLite-vec** and **FastEmbed**. Your code and research never leave your hardware. Zero cloud dependencies, zero tracking, zero telemetry.
- 🤝 **Git-Native Context Sharing:** Commit your `_context/` folder to Git. When teammates pull your repository, their AI assistants instantly inherit your research without re-googling.

---

## 🚀 How It Works (3 Steps)

### Step 1: Ditch the old way, full of hallucinations
Stop relying on LLM training data for fast-moving frameworks or private internal APIs.

### Step 2: Capture context with 1-click
Highlight any documentation page, StackOverflow thread, or Notion spec in Chrome, Firefox, or Edge, then press `Ctrl+Shift+C`. Capturing multiple pages? Stage them in the **Context Cart** and send them together.

### Step 3: Use it wherever you're working
- **In your IDE:** A physical `_context/` folder auto-mounts in your workspace. Prompt Cursor, Copilot, or Cline:
  > *"Implement auth flow using `@00_Context_Index.md`"*
- **In any browser chat:** Open the Command Palette on ChatGPT, Claude.ai, or wherever you're typing, search your memory, and inject it directly into the message box — no `_context` folder needed.

---

## 🎛️ Command Palette & Context Cart

The browser extension isn't just a capture button — it's a searchable memory palette you can summon on top of any page, including AI chat UIs and messaging apps.

- **Search syntax:** type plain text to full-text/semantic search your saved clips, or narrow results to a single source with `from:docs.com`.
- **Live preview:** hover or arrow through results to preview the full saved content before injecting anything.
- **Multi-select:** hold `Shift` while navigating with `↑↓` (or shift-click) to select a range of clips at once — they're staged in the Context Cart at the bottom of the palette.
- **One-shot injection:** hit **Paste Items** (or `Enter`) to inject every staged clip into whatever input field was focused when you opened the palette — a ChatGPT/Claude/Gemini prompt box, a Notion block, a WhatsApp Web message, or any other editable field on the page.
- **Instant recall:** press `Enter` with an empty search to inject your single most recent clip immediately, no typing required.

This means Patens' memory isn't locked to IDE workflows — the same captured docs, specs, and saved insights can be dropped straight into any AI product you use in the browser, or any other text box, without leaving the page.

---

## 📦 Installation & Setup

Setup takes less than 2 minutes and consists of two lightweight components:
### Step 1: Install Browser Extension
Select your browser to enable 1-click capturing and the Command Palette:
- 🌐 [Chrome Web Store](https://chromewebstore.google.com/detail/patens/ffmbjdnembhdfdmbhbagfgcnidlhpffd?authuser=4&hl=en-GB)
- 🦊 [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/patens/)
- 🌀 [Edge Add-ons](https://chromewebstore.google.com/detail/patens/ffmbjdnembhdfdmbhbagfgcnidlhpffd?authuser=4&hl=en-GB)

### Step 2: Install Local Memory Engine
Select your preferred distribution to launch the local vector indexer and MCP bridge:
- 🏪 [Microsoft Store](ms-windows-store://pdp/?productid=9PM9R44F0RXV)
- 💻 [VS Code Extension](vscode:extension/patens-dev.patens)
- 📦 [Executable Installer (.EXE, v1.1.2)](https://download.patens.dev/v.1.1.2/patens_installer_1.1.2.exe)

### Step 3: Start Using It

That's it — no manual configuration or terminal commands needed. Launching the installed backend (double-click the `.exe`, or the Store/VS Code Ext handles it for you) auto-detects your IDE, starts the local MCP + sync bridge, and materializes the `_context` folder in your open workspace on its own.

1. Restart your IDE
2. Open your AI Chat panel (Copilot or Cursor)
3. Enable the Patens tool
4. Start highlighting text in Chrome with `Ctrl+Shift+C`

---

## ⚙️ Manual MCP Configuration (Optional)

Most people never need this section — it's for manually wiring up the MCP connection (e.g. an unsupported IDE) or for running Patens **from source** instead of the installer.

The backend runs a unified local engine: an MCP server over stdio for your IDE, and a FastAPI server for the browser extension, sharing the same vector memory.

### For Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "patens": {
      "type": "stdio",
      "command": "C:\\Path\\To\\Patens.exe",
      "args": ["--mcp"]
    }
  }
}
```

**For VS Code (`.vscode/settings.json`):**
```json
{
  "servers": {
    "patens": {
      "type": "stdio",
      "command": "C:\\Path\\To\\Patens.exe",
      "args": ["--mcp"]
    }
  }
}
```

### Running from Source

If you've cloned the repo instead of using the installer, initialize the workspace manually:

```bash
python -m patens --setup
```

The `_context` folder will materialize in your file explorer.

### Available MCP Tools

Your IDE's AI assistant has direct access to these tools, in addition to reading `_context/*.md` files:

| Tool | What it does |
|------|---------------|
| `query_browser_context` | Searches your local vector memory on demand — works even for clips that were never synced to a physical file. |
| `memorize_ide_insight` | Saves a conclusion or architectural decision made *during* a coding session back into memory, so it's searchable later. |
| `forget_memory` | Deletes an outdated or deprecated saved clip and purges it from the synced `_context/` files. |
| `mount_workspace_context` | Redirects where the `_context/` folder is written — useful when switching between projects/repos. |

---

## Architecture

Patens is built for absolute speed and privacy with these core technologies:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend** | Python, FastAPI, Uvicorn | Manages MCP server & sync engine |
| **Protocol** | Model Context Protocol (MCP) | Native IDE integration via fastmcp |
| **Vector DB** | sqlite-vec | Ultra-fast, local-only RAG (Retrieval-Augmented Generation) |
| **Embedding Model** | FastEmbed | Runs entirely on CPU, no GPU required |
| **Data Format** | Markdown Files | Auto-synced `_context` folder in your workspace |
| **Browser UI** | Command Palette | In-page search & multi-select injection overlay, works on any site |

---

## 📁 The _context Folder

Once activated, Patens automatically generates and maintains a `_context` folder in your workspace:

```
_context/
├── 00_Context_Index.md          # Master index of all your research
├── YAML_Configuration_*.md      # Your saved clips (auto-grouped by source)
├── API_Documentation_*.md
├── GitHub_Issues_*.md
└── .gitignore                   # Prevents Git from tracking local context
```

Each file is:
- **Auto-grouped by source URL** (merges clips from the same page)
- **Named intelligently** (reflects content + token count)
- **Updated in real-time** (as you save new clips)
- **Searchable** (AI uses these files, or the `query_browser_context` tool, to enhance code generation)

Prefer not to litter your workspace with files at all? You don't have to — anything saved is also queryable directly through the MCP tool or the browser Command Palette without ever touching disk.

---

## 🔐 Privacy & Security

✅ **100% Local Execution:** No data leaves your machine  
✅ **No Telemetry:** We don't track your browsing  
✅ **No Cloud Storage:** SQLite database stays on your disk  
✅ **Workspace Guardrails:** The sync engine refuses to write `_context/` into your home folder, system directories, or the app's own install path  
✅ **MIT Licensed:** Open source, inspect the code yourself  

---

## 🚀 Getting Started

1. **Download** the Chrome Extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/patens/ffmbjdnembhdfdmbhbagfgcnidlhpffd?authuser=4&hl=en-GB)
2. **Download** the Desktop Server from the [Microsoft Store](ms-windows-store://pdp/?productid=9PM9R44F0RXV), [VS Code Marketplace](vscode:extension/patens-dev.patens), or as the [.EXE Installer](https://download.patens.dev/v.1.1.2/patens_installer_1.1.2.exe)
3. **Configure** your IDE (2-minute setup)
4. **Highlight** docs in Chrome → `Ctrl+Shift+C`
5. **Search & inject** with the Command Palette in your IDE, ChatGPT, Claude, or any other chat — one clip or a whole cart at once

---

## 💡 Use Cases

- 📚 **API Documentation:** Save API reference docs, instantly access in IDE
- 🐛 **Debugging:** Capture StackOverflow answers, apply solutions with AI
- 🏗️ **Architecture:** Save design patterns, let AI follow them in generated code
- 📖 **Learning:** Research tutorials, let AI build projects aligned with your research
- 🤖 **Web Model Workflows:** Bring captured, verified context into ChatGPT, Claude, or DeepSeek without re-explaining yourself in every new chat
- 🛒 **Multi-Source Research Dumps:** Clip five different docs pages across tabs, stage them in the Context Cart, and inject all five into one prompt at once
- 💬 **Beyond Coding:** Recall a saved spec, quote, or note and paste it into any message box — including WhatsApp Web, Notion, or email

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](#) for details on:
- Setting up the dev environment
- Building the `.exe`
- Submitting pull requests

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](#) file for details.

---

## 📞 Support

- 🐛 **Found a bug?** [Open an issue](https://github.com/Patens-dev/Patens/issues)
- 💬 **Have a feature request?** [Discussions](https://github.com/Patens-dev/Patens/discussions)
- 📧 **Need help?** Check our [FAQ](#) or start a [GitHub Discussion](https://github.com/Patens-dev/Patens/discussions)

---

<div align="center">
  <strong>Made with ❤️ for developers who value speed and privacy</strong>
  <br/>
  <a href="https://patens.dev"><strong>Get Started Now →</strong></a>
</div>