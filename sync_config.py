# scripts/sync_config.py
import json
from pathlib import Path

# Smart detection: checks script folder first, then parent folder (if in a subfolder like scripts/)
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR if (SCRIPT_DIR / "urls.json").exists() else SCRIPT_DIR.parent

def sync():
    urls_path = PROJECT_ROOT / "urls.json"
    if not urls_path.exists():
        print(f"❌ [Error] urls.json not found at: {urls_path}")
        return

    urls = json.loads(urls_path.read_text(encoding="utf-8"))

    contract_version = urls.get("version", "1.0.0")
    release_version = urls.get("releaseVersion", contract_version)
    github_repo = urls.get("app", {}).get("github", {}).get("repository", "")
    stores = urls.get("storeUrls", {})

    replacements = {
        "{{ VERSION }}": contract_version,
        "{{ RELEASE_VERSION }}": release_version,
        "{{ GITHUB_REPO }}": github_repo,
        "{{ STORE_FIREFOX }}": stores.get("firefox", ""),
        "{{ STORE_VSCODE }}": stores.get("vscode", ""),
        "{{ STORE_CHROME }}": stores.get("chrome", ""),
        "{{ STORE_EDGE }}": stores.get("edge", ""),
        "{{ STORE_MS_STORE }}": stores.get("microsoftStore", ""),
        "{{ STORE_EXE_INSTALLER }}": stores.get("exeInstaller", ""),
        "{{ STORE_EXTENSION_ZIP }}": stores.get("extensionZip", "")
    }

    template_files = [
        ("docs/index.template.html", "docs/index.html"),
        ("docs/not-available.template.html", "docs/not-available.html"),
    ]

    for t_name, out_name in template_files:
        t_path = PROJECT_ROOT / t_name
        out_path = PROJECT_ROOT / out_name

        if t_path.exists():
            content = t_path.read_text(encoding="utf-8")
            for placeholder, val in replacements.items():
                content = content.replace(placeholder, val)

            out_path.write_text(content, encoding="utf-8")
            print(f"✨ Compiled {t_name} -> {out_name}")
        else:
            print(f"⚠️  [Skipped] Template file not found: {t_path.name}")

    # Keep package.json default setting aligned with exeInstaller
    pkg_path = PROJECT_ROOT / "package.json"
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        props = pkg.get("contributes", {}).get("configuration", {}).get("properties", {})

        if "patens.downloadUrl" in props:
            props["patens.downloadUrl"]["default"] = stores.get("exeInstaller", "")

        pkg_path.write_text(json.dumps(pkg, indent=2), encoding="utf-8")
        print("✅ Synced package.json downloadUrl default")

if __name__ == "__main__":
    sync()