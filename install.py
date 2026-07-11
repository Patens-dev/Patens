import json
import sys
from pathlib import Path


def get_bat_path():
    # Gets the absolute path to start_mcp.bat
    project_root = Path(__file__).parent.absolute()
    return str(project_root / "start_mcp.bat")


def update_json_file(file_path, config_blocks):
    # Safely creates or updates JSON without overwriting existing data
    data = {}
    if file_path.exists():
        try:
            with open(file_path, "r") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            pass

    for root_key, server_config in config_blocks.items():
        if root_key not in data:
            data[root_key] = {}
        data[root_key]["ContextClipboard"] = server_config

    # Ensure directory exists
    file_path.parent.mkdir(parents=True, exist_ok=True)

    with open(file_path, "w") as f:
        json.dump(data, f, indent=2)


def main():
    print("🚀 Installing Context Clipboard MCP...")

    bat_path = get_bat_path()
    server_config = {
        "command": "cmd.exe",
        "args": ["/c", bat_path]
    }

    # Block required for Copilot ('servers') and Cursor/FastMCP ('mcpServers')
    config_blocks = {
        "servers": server_config,
        "mcpServers": server_config
    }

    # 1. GitHub Copilot Configuration
    copilot_file = Path.home() / "AppData" / "Local" / "github-copilot" / "intellij" / "mcp.json"
    update_json_file(copilot_file, config_blocks)
    print(f"✅ Configured GitHub Copilot -> {copilot_file}")

    # 2. Local Project Configuration (for fastmcp CLI testing)
    local_file = Path(__file__).parent / "mcp.json"
    update_json_file(local_file, config_blocks)
    print(f"✅ Configured Local Env -> {local_file}")

    print("\n🎉 Installation Complete!")
    print("Please RESTART your JetBrains IDE for Copilot to load the changes.")


if __name__ == "__main__":
    main()