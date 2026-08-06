# scripts/sync_config.py
import json
from pathlib import Path


def sync():
    urls_path = Path("urls.json")
    if not urls_path.exists():
        print("❌ [Error] urls.json not found!")
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
        ("index.template.html", "index.html"),
        ("not-available.template.html", "not-available.html"),
        ("welcome.template.html", "welcome.html")
    ]

    for t_name, out_name in template_files:
        t_path = Path(t_name)
        if t_path.exists():
            content = t_path.read_text(encoding="utf-8")
            for placeholder, val in replacements.items():
                content = content.replace(placeholder, val)

            Path(out_name).write_text(content, encoding="utf-8")
            print(f"✨ Compiled {t_name} -> {out_name}")

    # Keep package.json default setting aligned with exeInstaller
    pkg_path = Path("package.json")
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        props = pkg.get("contributes", {}).get("configuration", {}).get("properties", {})

        if "patens.downloadUrl" in props:
            props["patens.downloadUrl"]["default"] = stores.get("exeInstaller", "")

        pkg_path.write_text(json.dumps(pkg, indent=2), encoding="utf-8")
        print("✅ Synced package.json downloadUrl default")


if __name__ == "__main__":
    sync()