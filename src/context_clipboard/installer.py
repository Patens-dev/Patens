# src/context_clipboard/installer.py
import sys
import json
from pathlib import Path


def install_to_ides(is_debug: bool = False):
    """Dynamically injects the correct execution path into IDE MCP configs."""
    print("🚀 Auto-configuring IDEs for Context Clipboard...")

    is_frozen = getattr(sys, 'frozen', False)

    if is_frozen:
        # We are running as a compiled .exe
        command = sys.executable
        args = ["--mcp"]
    else:
        # We are running from raw Python source code
        command = sys.executable  # Grabs the python.exe from your active build_env
        script_path = str(Path(sys.modules['__main__'].__file__).absolute())
        args = [script_path, "--mcp"]

    if is_debug:
        args.append("--debug")

    server_config = {
        "command": command,
        "args": args
    }

    config_blocks = {
        "servers": server_config,
        "mcpServers": server_config
    }

    copilot_file = Path.home() / "AppData" / "Local" / "github-copilot" / "intellij" / "mcp.json"
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

        mode = "Compiled EXE" if is_frozen else "Python Source"
        print(f"✅ Configured IDE ({mode}) -> {file_path}")