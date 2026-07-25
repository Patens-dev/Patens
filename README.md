<div align="center">
  
  <img src="https://via.placeholder.com/150x150/0c0d10/3b82f6?text=Patens" alt="Patens.dev Logo" width="120" />

  <h1>🧠 Patens.dev</h1>
  <p><strong>The Local Memory Layer for AI Coding Assistants</strong></p>

  <p>
    <a href="#installation"><img src="https://img.shields.io/badge/Download-Executable-3b82f6?style=for-the-badge&logo=windows" alt="Download Server" /></a>
    <a href="#installation"><img src="https://img.shields.io/badge/Chrome-Extension-10b981?style=for-the-badge&logo=googlechrome" alt="Chrome Extension" /></a>
    <br/>
    <img src="https://img.shields.io/badge/100%25-Local_&_Private-success?style=flat-square" alt="100% Local" />
    <img src="https://img.shields.io/badge/Protocol-MCP-blue?style=flat-square" alt="MCP Compatible" />
  </p>

  <p><em>Stop losing hours to copy-pasting between Chrome and your IDE.</em></p>
</div>

---

## 😫 The Problem: This Is Your Life Right Now

**It's 2 PM. You're stuck on an authentication bug.**

1. You Google "Next.js 14 App Router protected routes"
2. Find a 3-post StackOverflow thread with the exact answer
3. Highlight the code. Copy. Switch to Cursor.
4. Paste. Paste again. Paste the OAuth config. Paste the middleware logic.
5. Your context window is already at 60%. You paste the error log too. **Now it's 75%.**
6. You ask Cursor: "Fix this" — but you've already used half your context on *messy copy-pasted snippets*.
7. Cursor's response is generic. You switch back to Chrome. Re-read the docs. Copy. Paste again.
8. **20 minutes later**, you finally have working code.

**Then tomorrow, you need to implement the same thing in a different project.**

You Google it again. You copy-paste again. Because there's no way to connect what you've already learned to your IDE.

---

## ✨ The Solution: Patens Makes It Instant

**Same scenario. Different ending.**

1. You find the StackOverflow answer in Chrome
2. **Highlight the code. Press `Ctrl+Shift+C`. Done.**
3. Switch to your IDE.
4. **The `_context` folder appears automatically.** It contains everything you just highlighted, pre-organized and searchable.
5. Ask Cursor: "Fix this using `📄 NextJS_Auth_Patterns.md`"
6. Cursor reads *your exact docs* (not its training data), and generates perfect code.
7. **5 minutes total.**

**Tomorrow, in a new project?**

You ask: "Apply the same auth pattern." Cursor remembers. No re-googling. No re-pasting. No re-explaining.

---

## 🎯 Why This Matters

- **You own your research.** It's stored locally. Searchable. Reusable across projects.
- **Context limits become irrelevant.** Instead of pasting sprawling docs into your prompt, the AI reads one indexed file.
- **No more context whiplash.** You stay in the IDE. Your research comes to you.
- **Privacy built-in.** Your StackOverflow history, your GitHub issue research, your API exploration — it never leaves your machine.

---

## 🚀 How It Works

**Patens** is a zero-friction toolchain that bridges your web research and your IDE using two lightweight components:

### **Component 1: Chrome Extension** 🔍
Captures Web Context from any page you visit. Highlight docs, press the hotkey, and it's saved locally.

### **Component 2: Desktop Server** 💻
Vectorizes the data, acts as an MCP Server, and syncs the physical `.md` files to your IDE workspace.

---

## 🎯 Core Features

- ⚡ **Zero-Friction Capture:** Highlight text on any webpage and press `Ctrl+Shift+C`. It instantly vectorizes and saves to your local database without switching tabs.
- 🔄 **Native IDE Syncing:** Your web research automatically synchronizes to a local `_context` folder right inside your project workspace.
- 📊 **Master Index:** Patens auto-generates a master index file of your research. Tag one file, and the AI knows everything you researched today.
- 🔒 **100% Local & Private:** Powered by local **SQLite** and **FastEmbed**. Your browsing history and API research *never* leave your machine until you explicitly share them with your AI assistant. No cloud. No telemetry.

---

## 🚀 How It Works (The Workflow)

Patens consists of two lightweight components that work seamlessly together:

### **Component 1: Chrome Extension** 🔍
Captures Web Context from any page you visit. Highlight docs, press the hotkey, and it's saved locally.

### **Component 2: Desktop Server** 💻
Vectorizes the data, acts as an MCP Server, and syncs the physical `.md` files to your IDE workspace.

### The "Aha!" Moment - Real Example

**Step 1: Research (In Chrome)**
You are reading the Next.js App Router documentation. You highlight the routing logic, press `Ctrl+Shift+C`, and commit it to your local memory.

**Step 2: Prompt (In Cursor / VS Code)**
You switch to your IDE. A `_context` folder has automatically appeared with your research. You open your AI chat and type:

> **You:** "Refactor my auth flow using `📄 00_Context_Index.md`"

**Step 3: Generate**
The AI reads the index, seamlessly pulls the exact documentation you highlighted in your browser, and generates the perfect code:

> **AI:** *"I will update the `layout.tsx` to use the new App Router conventions based on the Next.js documentation you provided. Here is the refactored code..."*

---

## 🛠️ Installation & Setup

Setup takes less than 3 minutes.

### Step 1: Install the Tools
- 📦 **[Get the Chrome Extension](#)** *(Link to Chrome Web Store)*
- 🖥️ **[Download the Desktop Server](#)** *(Link to Releases)*

### Step 2: Configure your IDE (MCP Setup)

Run the `Patens.exe` file. It will automatically detect your environment and launch the setup UI on `http://localhost:8000/welcome`.

If you prefer manual setup, add the following to your IDE's MCP Configuration file:

**For Cursor (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "patens": {
      "type": "stdio",
      "command": "C:\\Absolute\\Path\\To\\Patens.exe",
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
      "command": "C:\\Absolute\\Path\\To\\Patens.exe",
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

## 🏗️ Architecture

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

1. **Download** the Chrome Extension from [Chrome Web Store](#)
2. **Download** the Desktop Server from [Releases](#)
3. **Configure** your IDE (2-minute setup)
4. **Highlight** docs in Chrome → `Ctrl+Shift+C`
5. **Chat** with your AI in Cursor/VS Code with full context

---

## 💡 Use Cases

- 📚 **API Documentation:** Save API reference docs, instantly access in IDE
- 🐛 **Debugging:** Capture StackOverflow answers, apply solutions with AI
- 🏗️ **Architecture:** Save design patterns, let AI follow them in generated code
- 📖 **Learning:** Research tutorials, let AI build projects aligned with your research

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

- 🐛 **Found a bug?** [Open an issue](#)
- 💬 **Have a feature request?** [Discussions](#)
- 📧 **Need help?** Check our [FAQ](#) or start a [GitHub Discussion](#)

---

<div align="center">
  <strong>Made with ❤️ for developers who value speed and privacy</strong>
  <br/>
  <a href="#installation"><strong>Get Started Now →</strong></a>
</div>
