import sys
import json
import platform
import re
from pathlib import Path


def get_ide_paths():
    """Resolves correct 2026 IDE configuration paths across Windows, macOS, and Linux."""
    system = platform.system()
    home = Path.home()

    if system == "Windows":
        roaming = home / "AppData" / "Roaming"
        local = home / "AppData" / "Local"
    elif system == "Darwin":
        roaming = home / "Library" / "Application Support"
        local = roaming
    else:
        roaming = home / ".config"
        local = home / ".local" / "share"

    return {
        "VS Code (Native)": roaming / "Code" / "User" / "mcp.json",
        "Cursor (Native)": home / ".cursor" / "mcp.json",
        "JetBrains (Copilot)": local / "github-copilot" / "intellij" / "mcp.json"
    }


def clean_json_comments(json_str: str) -> str:
    """Strips // and /* */ comments to prevent parsing crashes."""
    json_str = re.sub(r'/\*.*?\*/', '', json_str, flags=re.DOTALL)
    json_str = re.sub(r'//.*', '', json_str)
    return json_str


def install_to_ides(is_debug: bool = False):
    """Dynamically injects the execution path into IDE configs with smart schema routing."""
    print("\n🚀 Auto-configuring IDEs for Patens...\n")

    is_frozen = getattr(sys, 'frozen', False)
    mode = "Compiled EXE" if is_frozen else "Python Source"

    # 1. Build the Execution Command
    if is_frozen:
        command = str(Path(sys.executable).absolute())
        args = ["--mcp"]
    else:
        command = str(Path(sys.executable).absolute())
        script_path = str(Path(sys.modules['__main__'].__file__).absolute())
        args = [script_path, "--mcp"]

    if is_debug:
        args.append("--debug")

    # 2. Iterate and Inject Configs
    ide_paths = get_ide_paths()
    configured_count = 0

    for ide_name, file_path in ide_paths.items():
        data = {}

        # Check if IDE is even installed
        if not file_path.parent.exists():
            continue

        if file_path.exists():
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    raw_content = f.read()
                    clean_content = clean_json_comments(raw_content)
                    data = json.loads(clean_content) if clean_content.strip() else {}
            except json.JSONDecodeError:
                print(f"⚠️  Skipped [ {ide_name} ] - File contains complex formatting.")
                continue

        # --- THE FIX: ROUTING LOGIC based on IDE NAME instead of filename ---
        if "VS Code" in ide_name or "JetBrains" in ide_name:
            root_key = "servers"
        else:
            root_key = "mcpServers"

        if root_key not in data:
            data[root_key] = {}

        # Changed from "context-clipboard" to "patens"
        data[root_key]["patens"] = {
            "type": "stdio",
            "command": command,
            "args": args
        }

        # Write data back safely
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            print(f"✅ Configured [ {ide_name} ] -> {file_path}")
            configured_count += 1
        except Exception as e:
            print(f"❌ Failed to write to [ {ide_name} ]: {e}")

    # 3. User Feedback Summary
    print("\n" + "=" * 50)
    if configured_count > 0:
        print(f"🎉 Success! Configured {configured_count} IDE(s) using {mode}.")
        print("🔄 Please restart your IDE completely for the changes to take effect.")
    else:
        print("⚠️  No supported IDE configurations were found or modified.")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    install_to_ides()