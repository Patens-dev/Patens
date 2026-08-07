<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/Patens-dev/Patens@main/assets/patens_full_logo_white.png" alt="Patens.dev Logo" width="180" />

  <h1>Patens</h1>
  <p><strong>Stop copy-pasting web docs into your IDE.</strong></p>

  <p>
    <a href="#-installation"><img src="https://img.shields.io/badge/Extension-Chrome%20%7C%20Firefox%20%7C%20Edge-3b82f6?style=for-the-badge&logo=googlechrome" alt="Browser Extension" /></a>
    <a href="#-installation"><img src="https://img.shields.io/badge/Backend-MS%20Store%20%7C%20VS%20Code%20%7C%20EXE-10b981?style=for-the-badge&logo=windows" alt="Backend Engine" /></a>
    <br/>
    <img src="https://img.shields.io/badge/100%25-Local_&_Private-success?style=flat-square" alt="100% Local" />
    <img src="https://img.shields.io/badge/Protocol-MCP-blue?style=flat-square" alt="MCP Compatible" />
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  </p>

  <p><em>Never explain your context twice. 1-click browser context straight to Cursor, VS Code, and Cline — or any web-based LLM.</em></p>

  <p><a href="https://patens.dev"><strong>patens.dev</strong></a></p>
</div>

---
<div align="center">
  <video 
    src="https://cdn.jsdelivr.net/gh/Patens-dev/Patens@main/assets/patens-hero.webm" 
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
| **Result:** Broken builds, lost flow state, and repeated prompts. | **Result:** 100% accurate AI code generation on the first try. |

---

## ⚡ Core Features

- ⚡ **Zero-Friction Capture:** Highlight text or images on any web page and press `Ctrl+Shift+C`. It vectorizes directly to your local database, even behind logins, Notion specs, or SPAs.
- 📂 **Physical File Mounting:** Patens writes vector-indexed Markdown files directly into your project's `_context/` directory. Tag them in Cursor, Copilot, or Cline using simple `@` file references.
- 🔒 **100% Private & Local:** Powered by local **SQLite-vec** and **FastEmbed**. Your code and research never leave your hardware. Zero cloud dependencies, zero tracking, zero telemetry.
- 🤝 **Git-Native Context Sharing:** Commit your `_context/` folder to Git. When teammates pull your repository, their AI assistants instantly inherit your research without re-googling.
- 🤖 **Works Beyond the IDE:** Not just Cursor/Copilot/Cline — feed the same verified local memory to web-based models like ChatGPT, Claude, or DeepSeek without blowing out context windows or re-typing prompts.

---

## 🚀 How It Works (3 Steps)

### Step 1: Ditch the old way, full of hallucinations
Stop relying on LLM training data for fast-moving frameworks or private internal APIs.

### Step 2: Capture context with 1-click
Highlight any documentation page, StackOverflow thread, or Notion spec in Chrome, Firefox, or Edge, then press `Ctrl+Shift+C`.

### Step 3: Implement with minimal instructions
Switch to your IDE. A physical `_context/` folder auto-mounts in your workspace. Prompt Cursor, Copilot, or Cline:
> *"Implement auth flow using `@00_Context_Index.md`"*

---

## 📦 Installation & Setup

Setup takes less than 2 minutes and consists of two lightweight components:
### Step 1: Install Browser Extension
Select your browser to enable 1-click capturing:
- 🌐 [Chrome Web Store](https://chromewebstore.google.com/detail/patens/ffmbjdnembhdfdmbhbagfgcnidlhpffd?authuser=4&hl=en-GB)
- 🦊 [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/patens/)
- 🌀 [Edge Add-ons](https://chromewebstore.google.com/detail/patens/ffmbjdnembhdfdmbhbagfgcnidlhpffd?authuser=4&hl=en-GB)

### Step 2: Install Local Memory Engine
Select your preferred distribution to launch the local vector indexer and MCP bridge:
- 🏪 [Microsoft Store](ms-windows-store://pdp/?productid=9PM9R44F0RXV)
- 💻 [VS Code Extension](vscode:extension/patens-dev.patens)
- 📦 [Executable Installer (.EXE, v1.1.2)](https://download.patens.dev/v.1.1.2/patens_installer_1.1.2.exe)

---

## ⚙️ IDE Configuration (Model Context Protocol)

Run `Patens.exe` or launch the backend extension. It will automatically detect your environment and start the local sync bridge.

If you prefer manual MCP configuration, add Patens to your IDE settings:

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

### Step 3: Initialize the Workspace

Open your workspace in your IDE and run:

```bash
python -m patens --setup
```

The `_context` folder will instantly materialize in your file explorer.

### Step 4: Start Using It

1. Restart your IDE
2. Open your AI Chat panel (Copilot or Cursor)
3. Enable the Patens tool
4. Start highlighting text in Chrome with `Ctrl+Shift+C`

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
- **Searchable** (AI uses these files to enhance code generation)

---

## 🔐 Privacy & Security

✅ **100% Local Execution:** No data leaves your machine  
✅ **No Telemetry:** We don't track your browsing  
✅ **No Cloud Storage:** SQLite database stays on your disk  
✅ **MIT Licensed:** Open source, inspect the code yourself  

---

## 🚀 Getting Started

1. **Download** the Chrome Extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/patens/ffmbjdnembhdfdmbhbagfgcnidlhpffd?authuser=4&hl=en-GB)
2. **Download** the Desktop Server from the [Microsoft Store](ms-windows-store://pdp/?productid=9PM9R44F0RXV), [VS Code Marketplace](vscode:extension/patens-dev.patens), or as the [.EXE Installer](https://download.patens.dev/v.1.1.2/patens_installer_1.1.2.exe)
3. **Configure** your IDE (2-minute setup)
4. **Highlight** docs in Chrome → `Ctrl+Shift+C`
5. **Chat** with your AI in Cursor/VS Code — or in ChatGPT, Claude, and other web models — with full context

---

## 💡 Use Cases

- 📚 **API Documentation:** Save API reference docs, instantly access in IDE
- 🐛 **Debugging:** Capture StackOverflow answers, apply solutions with AI
- 🏗️ **Architecture:** Save design patterns, let AI follow them in generated code
- 📖 **Learning:** Research tutorials, let AI build projects aligned with your research
- 🤖 **Web Model Workflows:** Bring captured, verified context into ChatGPT, Claude, or DeepSeek without re-explaining yourself in every new chat

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
