import os
import sys
import json
import shutil
import platform
import tempfile
from pathlib import Path


def get_ide_paths():
    """Resolves correct 2026 IDE configuration paths across Windows, macOS, and Linux."""
    system = platform.system()
    home = Path.home()

    if system == "Windows":
        roaming = Path(os.getenv("APPDATA", home / "AppData" / "Roaming"))
        local = Path(os.getenv("LOCALAPPDATA", home / "AppData" / "Local"))
    elif system == "Darwin":
        roaming = home / "Library" / "Application Support"
        local = roaming
    else:
        roaming = home / ".config"
        local = home / ".local" / "share"

    return {
        "VS Code": roaming / "Code" / "User" / "mcp.json",
        "Cursor": home / ".cursor" / "mcp.json",
        "JetBrains": local / "github-copilot" / "intellij" / "mcp.json",
        "Claude Desktop": roaming / "Claude" / "claude_desktop_config.json"
    }


def strip_json_comments(json_str: str) -> str:
    """Removes // and /* */ comments while respecting string literals and escapes."""
    out = []
    i, n = 0, len(json_str)
    in_string, escape = False, False
    while i < n:
        c = json_str[i]
        if in_string:
            out.append(c)
            if escape:
                escape = False
            elif c == '\\':
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n and json_str[i + 1] == '/':
            while i < n and json_str[i] != '\n': i += 1
            continue
        if c == '/' and i + 1 < n and json_str[i + 1] == '*':
            i += 2
            while i + 1 < n and not (json_str[i] == '*' and json_str[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def install_to_ides(is_debug: bool = False):
    """Dynamically injects the execution path into IDE configs safely using atomic writes."""
    print("\n[Info] Auto-configuring IDEs for Patens...\n")

    is_frozen = getattr(sys, 'frozen', False)
    mode = "Compiled EXE" if is_frozen else "Python Source"

    # 1. Build the Execution Command
    if is_frozen:
        command = str(Path(sys.executable).absolute())
        args = ["--mcp"]
    else:
        command = str(Path(sys.executable).absolute())
        script_path = str(Path(sys.argv[0]).absolute())
        args = [script_path, "--mcp"]

    if is_debug:
        args.append("--debug")

    # 2. Iterate and Inject Configs
    ide_paths = get_ide_paths()
    configured_count = 0

    for ide_name, file_path in ide_paths.items():
        data = {}

        # Skip if the target IDE directory doesn't exist
        if not file_path.parent.exists():
            continue

        # Safely parse existing config
        if file_path.exists():
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    raw_content = f.read()
                    clean_content = strip_json_comments(raw_content)
                    data = json.loads(clean_content) if clean_content.strip() else {}
            except Exception as e:
                print(f"[Warning] Skipped [ {ide_name} ] - Could not read or parse file: {e}")
                continue

        # Determine correct schema key based on the client
        root_key = "servers" if "VS Code" in ide_name or "JetBrains" in ide_name else "mcpServers"
        
        if root_key not in data:
            data[root_key] = {}
        elif not isinstance(data[root_key], dict):
            print(f"[Warning] Skipped [ {ide_name} ] - '{root_key}' exists but is not a standard dictionary.")
            continue

        # Inject Patens configuration
        data[root_key]["patens"] = {
            "type": "stdio",
            "command": command,
            "args": args
        }

        # 3. Safe / Atomic Write Phase
        try:
            # Create a user backup just in case we stripped valuable comments
            backup_path = None
            if file_path.exists():
                backup_path = file_path.with_suffix(".json.bak")
                shutil.copy2(file_path, backup_path)

            # Write to a temporary file first
            with tempfile.NamedTemporaryFile("w", dir=file_path.parent, delete=False, encoding="utf-8") as tmp_file:
                json.dump(data, tmp_file, indent=4)
                temp_name = tmp_file.name

            # Swap the temporary file with the real file atomically
            os.replace(temp_name, file_path)

            print(f"[Success] Configured [ {ide_name} ] -> {file_path}")
            if backup_path:
                print(f"          (Original backup saved to {backup_path.name})")

            configured_count += 1

        except Exception as e:
            print(f"[Error] Failed to write to [ {ide_name} ]: {e}")
            if 'temp_name' in locals() and os.path.exists(temp_name):
                os.remove(temp_name)

    # 4. User Feedback Summary
    print("\n" + "=" * 50)
    if configured_count > 0:
        print(f"[Success] Configured {configured_count} IDE(s) using {mode}.")
        print("[Info] Please restart your IDE completely for the changes to take effect.")
    else:
        print("[Warning] No supported IDE configurations were found or modified.")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    install_to_ides()