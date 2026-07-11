import json
from pathlib import Path


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
