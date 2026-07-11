# ContextClipboard.py
import sys
import json
import webbrowser
from pathlib import Path


# --- 1. SETUP / INSTALLER LOGIC ---
def install_to_ides(exe_path: Path):
    """Injects this exact executable into IDE MCP configs."""
    print("🚀 Installing Context Clipboard MCP...")

    # The IDE will run the exe with the --mcp flag
    server_config = {
        "command": str(exe_path),
        "args": ["--mcp"]
    }

    config_blocks = {
        "servers": server_config,
        "mcpServers": server_config
    }

    # 1. GitHub Copilot Configuration
    copilot_file = Path.home() / "AppData" / "Local" / "github-copilot" / "intellij" / "mcp.json"

    # 2. Cursor Configuration
    cursor_file = Path.home() / "AppData" / "Roaming" / "Cursor" / "User" / "globalStorage" / "rooveterinaryinc.roo-cline" / "settings" / "cline_mcp_settings.json"

    for file_path in [copilot_file, cursor_file]:
        data = {}
        if file_path.exists():
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
            except json.JSONDecodeError:
                pass

        for root_key, config in config_blocks.items():
            if root_key not in data:
                data[root_key] = {}
            data[root_key]["ContextClipboard"] = config

        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w") as f:
            json.dump(data, f, indent=2)

        print(f"✅ Configured IDE -> {file_path}")


# --- 2. MAIN EXECUTION ROUTING ---
if __name__ == "__main__":
    # If the IDE is running this, it will pass the --mcp flag
    if "--mcp" in sys.argv:
        # Import and run your actual server logic here to prevent it from loading during setup
        import server.unified_server

        # Otherwise, the user just double-clicked the .exe
    else:
        import time
        import threading

        # 1. Register with the IDEs
        current_exe = Path(sys.executable) if getattr(sys, 'frozen', False) else Path(__file__).absolute()
        install_to_ides(current_exe)

        # 2. Start the FastAPI server in the background so the Settings page works
        import server.unified_server

        api_thread = threading.Thread(target=server.unified_server.run_fastapi, daemon=True)
        api_thread.start()

        # 3. Open the browser to the settings page automatically
        print("\n🎉 Installation Complete!")
        print("Opening settings panel...")
        time.sleep(2)  # Give FastAPI a second to boot
        webbrowser.open("http://localhost:8000/settings")

        # Keep the setup window open so the server stays alive while they tweak settings
        input("\nPress ENTER to close this window (The background server will stop).")