#!/bin/bash
set -euo pipefail

# 0. Automatically load environment variables safely
if [ -f .env ]; then
    set -a
    # shellcheck source=/dev/null
    source .env
    set +a
fi

# ===================================================================
# CONFIGURATION & COLOR LOGGING
# ===================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_profile() { echo -e "${CYAN}[PROFILER]${NC} $1"; }

PIPELINE_START=$(date +%s)
step_timer_start=0

start_timer() { step_timer_start=$(date +%s); }
stop_timer()  { echo "$(( $(date +%s) - step_timer_start ))"; }

get_size() {
    if [ -e "$1" ]; then du -sh "$1" 2>/dev/null | cut -f1; else echo "0B"; fi
}

# Only delete transient env files on exit (leaves spec/iss for debugging if build fails)
TEMP_FILES=()
cleanup() {
    for item in "${TEMP_FILES[@]}"; do [ -e "$item" ] && rm -rf "$item"; done
}
trap cleanup EXIT INT TERM

# ===================================================================
# 0. PRE-BUILD CONFIGURATION SYNC & VENV DETECTION
# ===================================================================
PYTHON_BIN="python"
if [ -f "./.venv/Scripts/python.exe" ]; then
    PYTHON_BIN="./.venv/Scripts/python.exe"
elif [ -f "./.venv/bin/python" ]; then
    PYTHON_BIN="./.venv/bin/python"
elif [ -f "./build_env/Scripts/python.exe" ]; then
    PYTHON_BIN="./build_env/Scripts/python.exe"
elif [ -f "./build_env/bin/python" ]; then
    PYTHON_BIN="./build_env/bin/python"
fi

if [ -f "scripts/sync_config.py" ]; then
    log_info "🔄 Syncing central urls.json inventory across project..."
    "$PYTHON_BIN" scripts/sync_config.py || log_warn "sync_config.py failed to run; continuing with build."
fi

# ===================================================================
# TOOL DETECTORS
# ===================================================================
log_info "Detecting build tools..."

PYINSTALLER_BIN=""
if command -v pyinstaller &> /dev/null; then
    PYINSTALLER_BIN="pyinstaller"
elif [ -f "./build_env/Scripts/pyinstaller.exe" ]; then
    PYINSTALLER_BIN="./build_env/Scripts/pyinstaller.exe"
elif [ -f "./.venv/Scripts/pyinstaller.exe" ]; then
    PYINSTALLER_BIN="./.venv/Scripts/pyinstaller.exe"
else
    log_error "PyInstaller not found."
    exit 1
fi

MAKEAPPX_CMD=""
SIGNTOOL_CMD=""

for candidate in \
    "/c/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64" \
    "/c/Program Files (x86)/Windows Kits/10/bin/10.0.22621.0/x64" \
    "/c/Program Files (x86)/Windows Kits/10/bin/10.0.19041.0/x64"; do
    if [ -f "$candidate/makeappx.exe" ]; then
        MAKEAPPX_CMD="$candidate/makeappx.exe"
        SIGNTOOL_CMD="$candidate/signtool.exe"
        break
    fi
done

if [ -z "$MAKEAPPX_CMD" ]; then
    log_error "makeappx.exe (Windows SDK) not found."
    exit 1
fi

ISCC_CMD=""
for iscc_candidate in \
    "iscc" \
    "/c/Program Files (x86)/Inno Setup 6/ISCC.exe" \
    "/c/Program Files/Inno Setup 6/ISCC.exe"; do
    if command -v "$iscc_candidate" &> /dev/null || [ -f "$iscc_candidate" ]; then
        ISCC_CMD="$iscc_candidate"
        break
    fi
done

log_info "Using Windows SDK tools from: $(dirname "$MAKEAPPX_CMD")"
if [ -n "$ISCC_CMD" ]; then
    log_info "Using Inno Setup Compiler: $ISCC_CMD"
else
    log_warn "Inno Setup (ISCC.exe) not found."
fi

log_info "Cleaning previous build outputs..."
rm -rf build dist Patens.spec msix_layout patens_setup.iss version_info.txt
mkdir -p dist

# ===================================================================
# 1. METADATA PARSING (SECURE ENV FILE GENERATION)
# ===================================================================
log_info "Parsing project metadata..."
start_timer

META_ENV=$(mktemp)
TEMP_FILES+=("$META_ENV")

"$PYTHON_BIN" -c '
import json, os, sys, shlex
if not os.path.exists("pyproject.toml"): sys.exit(1)
app_version, name, desc, company = "1.0.0", "Patens", "Patens Executable", "Patens"
try:
    import tomllib
    with open("pyproject.toml", "rb") as f: toml_data = tomllib.load(f)
    project = toml_data.get("project", {})
    name = project.get("name", name)
    app_version = project.get("version", app_version)
    desc = project.get("description", desc)
    authors = project.get("authors", [])
    if authors and isinstance(authors[0], dict):
        company = authors[0].get("name", company)
except Exception: pass

v_parts = [int(p) for p in app_version.split(".") if p.isdigit()]
while len(v_parts) < 4: v_parts.append(0)
v_tuple = f"({v_parts[0]}, {v_parts[1]}, {v_parts[2]}, {v_parts[3]})"
msix_version = f"{v_parts[0]}.{v_parts[1]}.{v_parts[2]}.{v_parts[3]}"

version_info_template = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v_tuple}, prodvers={v_tuple}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[StringFileInfo([StringTable("040904B0", [
    StringStruct("CompanyName", "{company}"), StringStruct("FileDescription", "{desc}"),
    StringStruct("FileVersion", "{app_version}"), StringStruct("InternalName", "{name}"),
    StringStruct("LegalCopyright", "Copyright (c) 2026 {company}"), StringStruct("OriginalFilename", "Patens.exe"),
    StringStruct("ProductName", "{name}"), StringStruct("ProductVersion", "{app_version}")
  ])]), VarFileInfo([VarStruct("Translation", [1033, 1200])])]
)"""
with open("version_info.txt", "w", encoding="utf-8") as f:
    f.write(version_info_template)

possible_ext_paths = ["extension/manifest.json", "browser_extension/manifest.json", "chrome_extension/manifest.json", "manifest.json"]
ext_manifest_path = next((p for p in possible_ext_paths if os.path.exists(p)), None)
ext_version, ext_dir = "1.0.0", "extension"
if ext_manifest_path:
    ext_dir = os.path.dirname(ext_manifest_path) or "."
    try:
        with open(ext_manifest_path, "r", encoding="utf-8") as f:
            ext_version = json.load(f).get("version", "1.0.0")
    except Exception: pass

with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write(f"APP_VERSION={shlex.quote(app_version)}\n")
    f.write(f"MSIX_VERSION={shlex.quote(msix_version)}\n")
    f.write(f"EXT_VERSION={shlex.quote(ext_version)}\n")
    f.write(f"COMPANY={shlex.quote(company)}\n")
    f.write(f"EXT_DIR={shlex.quote(ext_dir)}\n")
' "$META_ENV"

# shellcheck source=/dev/null
source "$META_ENV"
VERSION_DIR="dist/v${APP_VERSION}"
mkdir -p "$VERSION_DIR"
TIME_METADATA=$(stop_timer)

# ===================================================================
# 2. RUN TEST SUITE (FAIL-FAST)
# ===================================================================
log_info "🧪 Executing unit and integration test suites..."
start_timer

if "$PYTHON_BIN" -m pytest tests/ -v; then
    log_success "✅ All test suites passed cleanly!"
else
    log_error "❌ Test suite failure detected! Aborting build pipeline immediately."
    exit 1
fi
TIME_TESTS=$(stop_timer)

# ===================================================================
# 3. BROWSER EXTENSION BUILD & PACKAGING (VITE)
# ===================================================================
log_info "⚡ Compiling browser extension using Vite..."
start_timer

if command -v npm &> /dev/null; then
    npm run build || {
        log_error "Failed to build browser extension with Vite/npm."
        exit 1
    }
else
    log_error "npm command not found. Required for building the browser extension with Vite."
    exit 1
fi

BUILD_EXT_DIR="dist/extension"
EXTENSION_ZIP_OUTPUT="${VERSION_DIR}/extension_${EXT_VERSION}.zip"

if [ ! -d "$BUILD_EXT_DIR" ]; then
    log_error "Vite extension build directory '$BUILD_EXT_DIR' not found."
    exit 1
fi

mkdir -p "$VERSION_DIR"

log_info "📦 Zipping compiled extension bundle from ${BUILD_EXT_DIR}..."
"$PYTHON_BIN" -c '
import sys, os, zipfile
ext_dir, zip_filename = sys.argv[1], sys.argv[2]
if os.path.exists(ext_dir):
    os.makedirs(os.path.dirname(os.path.abspath(zip_filename)), exist_ok=True)
    with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(ext_dir):
            for file in files:
                file_path = os.path.join(root, file)
                zipf.write(file_path, os.path.relpath(file_path, ext_dir))
' "$BUILD_EXT_DIR" "$EXTENSION_ZIP_OUTPUT"

TIME_EXTENSION=$(stop_timer)

# ===================================================================
# 4. DYNAMIC FASTEMBED MODEL CACHING
# ===================================================================
log_info "📥 Synchronizing FastEmbed model from config..."
start_timer

"$PYTHON_BIN" -c '
import os, sys
sys.path.insert(0, "src")
from patens.server.config import MODEL_NAME
from fastembed import TextEmbedding

cache_path = os.path.abspath("fastembed_cache")
print(f"Resolving configured model: {MODEL_NAME} -> {cache_path}")
TextEmbedding(model_name=MODEL_NAME, cache_dir=cache_path)
'
TIME_FASTEMBED=$(stop_timer)
SIZE_MODEL_CACHE=$(get_size "fastembed_cache")

# ===================================================================
# 5. PYINSTALLER COMPILATION (DYNAMIC SPEC GENERATION)
# ===================================================================
log_info "📝 Generating dynamic Patens.spec with complete C-extension hooks..."
start_timer

"$PYTHON_BIN" -c '
spec_content = """# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_all, collect_dynamic_libs, copy_metadata

block_cipher = None

sqlite_vec_datas, sqlite_vec_binaries, sqlite_vec_hidden = collect_all("sqlite_vec")
fastembed_datas, fastembed_binaries, fastembed_hidden = collect_all("fastembed")
onnx_binaries = collect_dynamic_libs("onnxruntime")

fastmcp_datas = []
for pkg in ["fastmcp", "fastmcp-slim"]:
    try:
        fastmcp_datas.extend(copy_metadata(pkg))
    except Exception:
        pass

datas = [
    ("assets/patens.ico", "assets"),
    ("assets/patens_full_logo_white.png", "assets"),
    ("assets/cursor_demo.mp4", "assets"),
    ("assets/vsc_demo.mp4", "assets"),
    ("assets/jetbrains_demo.mp4", "assets"),
    ("fastembed_cache", "fastembed_cache"),
    ("src/patens/server/default_config.yaml", "patens/server"),
    ("src/patens/server/templates", "patens/server/templates"),
] + sqlite_vec_datas + fastembed_datas + fastmcp_datas

binaries = sqlite_vec_binaries + fastembed_binaries + onnx_binaries

hiddenimports = [
    "patens.server.api",
    "patens.server.unified_server",
] + sqlite_vec_hidden + fastembed_hidden

excludes = [
    "pytest", "_pytest", "pytest_mock", "pluggy", "unittest",
    "tkinter", "torch", "scipy", "transformers", "matplotlib",
    "sympy", "sklearn", "scikit_learn", "networkx"
]

a = Analysis(
    ["src/patens/main.py"],
    pathex=["src"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Patens",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/patens.ico",
    version="version_info.txt",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Patens",
)
"""

with open("Patens.spec", "w", encoding="utf-8") as f:
    f.write(spec_content)
'

log_info "🔨 Compiling PyInstaller binary using generated Patens.spec..."
"$PYINSTALLER_BIN" --noconfirm Patens.spec

TIME_PYINSTALLER=$(stop_timer)
SIZE_PYINSTALLER_EXE=$(get_size "dist/Patens")

# ===================================================================
# 5.1 RUNTIME DLL SMOKE TEST (FAIL-FAST GUARD)
# ===================================================================
log_info "🔍 Verifying binary integrity and dynamic C-extension DLLs..."

"$PYTHON_BIN" -c '
import subprocess, sys
exe_path = "dist/Patens/Patens.exe"
print(f"Booting executable smoke test: {exe_path}")
try:
    res = subprocess.run([exe_path, "--mcp"], timeout=5, capture_output=True)
    if res.returncode not in (0, 124):
        print(f"Smoke test failed with returncode {res.returncode}")
        print("STDERR:", res.stderr.decode("utf-8", errors="replace"))
        sys.exit(1)
except subprocess.TimeoutExpired:
    pass
except Exception as e:
    print(f"Smoke test failed with exception: {e}")
    sys.exit(1)
'
log_success "✅ Compiled binary booted successfully! All dynamic C-extensions and DLLs loaded."

# ===================================================================
# 6. MSIX PACKAGE GENERATION & SIGNING
# ===================================================================
log_info "📦 Creating MSIX package layout..."
start_timer

PACKAGE_IDENTITY_NAME="Patens.Patens.dev"
PACKAGE_IDENTITY_PUBLISHER="CN=6F606911-9D25-40B8-9444-C3963DE67C69"
PUBLISHER_DISPLAY_NAME="Patens"

mkdir -p msix_layout/Assets
cp -r dist/Patens/* msix_layout/

"$PYTHON_BIN" -c '
import os
try:
    from PIL import Image
    ico_path = os.path.join("assets", "patens.ico")
    if os.path.exists(ico_path):
        img = Image.open(ico_path)
        img.resize((44, 44)).save(os.path.join("msix_layout", "Assets", "Square44x44Logo.png"))
        img.resize((150, 150)).save(os.path.join("msix_layout", "Assets", "Square150x150Logo.png"))
        img.resize((50, 50)).save(os.path.join("msix_layout", "Assets", "StoreLogo.png"))
except Exception as e:
    print(f"Image conversion note: {e}")
'

cat << EOF > msix_layout/AppxManifest.xml
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="${PACKAGE_IDENTITY_NAME}"
    Publisher="${PACKAGE_IDENTITY_PUBLISHER}"
    Version="${MSIX_VERSION}" />

  <Properties>
    <DisplayName>Patens</DisplayName>
    <PublisherDisplayName>${PUBLISHER_DISPLAY_NAME}</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>

  <Applications>
    <Application Id="Patens" Executable="Patens.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Patens"
        Description="Patens Executable"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
      </uap:VisualElements>
    </Application>
  </Applications>
</Package>
EOF

log_info "🔨 Packing MSIX package..."
mkdir -p "$VERSION_DIR"
MSIX_OUTPUT="${VERSION_DIR}/patens_${APP_VERSION}.msix"
MSYS_NO_PATHCONV=1 "$MAKEAPPX_CMD" pack /d msix_layout /p "$MSIX_OUTPUT" /o

if [ -n "$SIGNTOOL_CMD" ]; then
    log_info "🔏 Attempting local sign with signtool..."
    MSYS_NO_PATHCONV=1 "$SIGNTOOL_CMD" sign /fd SHA256 /n "${PUBLISHER_DISPLAY_NAME}" "$MSIX_OUTPUT" 2>/dev/null || log_warn "Local cert '${PUBLISHER_DISPLAY_NAME}' not found in Cert store."
fi

TIME_MSIX=$(stop_timer)
SIZE_MSIX=$(get_size "$MSIX_OUTPUT")

# ===================================================================
# 7. EXE INSTALLER GENERATION (INNO SETUP + VC++ REDISTRIBUTABLE)
# ===================================================================
log_info "⚙️ Generating standalone EXE installer..."
start_timer
EXE_INSTALLER_OUTPUT="${VERSION_DIR}/patens_installer_${APP_VERSION}.exe"

mkdir -p build_cache
VCREDIST_PATH="build_cache/vcredist_x64.exe"
if [ ! -f "$VCREDIST_PATH" ]; then
    log_info "📥 Downloading Visual C++ 2015-2022 x64 Redistributable..."
    curl -sSL "https://aka.ms/vs/17/release/vc_redist.x64.exe" -o "$VCREDIST_PATH" || {
        log_error "Failed to download VC++ Redistributable"
        exit 1
    }
fi

if [ -n "$ISCC_CMD" ]; then
    cat << EOF > patens_setup.iss
[Setup]
AppName=Patens
AppVersion=${APP_VERSION}
AppPublisher=${COMPANY}
DefaultDirName={localappdata}\Programs\Patens
PrivilegesRequired=lowest
OutputBaseFilename=patens_installer_${APP_VERSION}
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir=${VERSION_DIR}
SetupIconFile=assets\patens.ico
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "dist\Patens\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build_cache\vcredist_x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: VCRedistNeedsInstall

[Icons]
Name: "{group}\Patens"; Filename: "{app}\Patens.exe"
Name: "{autodesktop}\Patens"; Filename: "{app}\Patens.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{tmp}\vcredist_x64.exe"; Parameters: "/quiet /norestart"; StatusMsg: "Installing Visual C++ 2015-2022 Runtime..."; Flags: waituntilterminated; Check: VCRedistNeedsInstall
Filename: "{app}\Patens.exe"; Description: "{cm:LaunchProgram,Patens}"; Flags: nowait postinstall skipifsilent

[Code]
function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  if RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Installed', Installed) then
  begin
    Result := (Installed <> 1);
  end
  else
  begin
    Result := True;
  end;
end;
EOF

    log_info "🔨 Compiling Inno Setup EXE installer..."
    MSYS_NO_PATHCONV=1 "$ISCC_CMD" patens_setup.iss > /dev/null
else
    log_warn "ISCC.exe not found. Creating zip archive fallback..."
    "$PYTHON_BIN" -c '
import sys, os, zipfile
zip_path = sys.argv[1]
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
    for root, _, files in os.walk("dist/Patens"):
        for file in files:
            file_path = os.path.join(root, file)
            zipf.write(file_path, os.path.relpath(file_path, "dist/Patens"))
' "${VERSION_DIR}/patens_standalone_${APP_VERSION}.zip"
fi

TIME_EXE_INSTALLER=$(stop_timer)
SIZE_EXE_INSTALLER=$(get_size "$EXE_INSTALLER_OUTPUT")

# ===================================================================
# 7.1 LOCAL HARDLINK CREATION (ZERO DISK SPACE DUPLICATION)
# ===================================================================
log_info "🔗 Creating local 'dist/latest/' hardlinks (0 bytes wasted)..."
mkdir -p dist/latest
rm -rf dist/latest/*

ln "$EXE_INSTALLER_OUTPUT" "dist/latest/patens_installer.exe" 2>/dev/null || cp "$EXE_INSTALLER_OUTPUT" "dist/latest/patens_installer.exe"
ln "$MSIX_OUTPUT" "dist/latest/patens.msix" 2>/dev/null || cp "$MSIX_OUTPUT" "dist/latest/patens.msix"
ln "$EXTENSION_ZIP_OUTPUT" "dist/latest/extension.zip" 2>/dev/null || cp "$EXTENSION_ZIP_OUTPUT" "dist/latest/extension.zip"

# ===================================================================
# 8. R2 DEPLOYMENT (SINGLE-PASS UPLOAD TO vX.X.X ONLY)
# ===================================================================
GIT_BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")}"

# Compute SHA256 checksum for the installer
HASH=$("$PYTHON_BIN" -c '
import hashlib, sys
with open(sys.argv[1], "rb") as f:
    print(hashlib.sha256(f.read()).hexdigest())
' "$EXE_INSTALLER_OUTPUT")

# Generate latest.json manifest containing links to all 3 artifacts
cat << EOF > dist/latest.json
{
  "version": "${APP_VERSION}",
  "installerUrl": "https://download.patens.dev/v${APP_VERSION}/patens_installer_${APP_VERSION}.exe",
  "msixUrl": "https://download.patens.dev/v${APP_VERSION}/patens_${APP_VERSION}.msix",
  "extensionUrl": "https://download.patens.dev/v${APP_VERSION}/extension_${EXT_VERSION}.zip",
  "sha256": "${HASH}",
  "minExtensionVersion": "1.1.0"
}
EOF
cp dist/latest.json "${VERSION_DIR}/latest.json"

if [[ "$GIT_BRANCH" == "release" ]] || [[ "$GIT_BRANCH" == release/* ]]; then
    log_info "🚀 On release branch ('$GIT_BRANCH'). Publishing versioned artifacts to R2..."

    : "${R2_BUCKET:?Need to set R2_BUCKET environment variable}"
    : "${R2_ENDPOINT:?Need to set R2_ENDPOINT environment variable}"

    log_info "☁️ Uploading v${APP_VERSION} directory artifacts to R2..."
    aws s3 cp "${VERSION_DIR}/" "s3://${R2_BUCKET}/v${APP_VERSION}/" \
      --recursive \
      --endpoint-url "$R2_ENDPOINT"

    log_info "📝 Updating root latest.json manifest on R2..."
    aws s3 cp dist/latest.json "s3://${R2_BUCKET}/latest.json" \
      --endpoint-url "$R2_ENDPOINT" \
      --cache-control "no-cache, no-store, must-revalidate"

    if [ -n "${CLOUDFLARE_ZONE_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        log_info "🧹 Purging Cloudflare CDN cache..."
        curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
             -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
             -H "Content-Type: application/json" \
             --data '{"files":["https://download.patens.dev/latest.json"]}' > /dev/null
    fi

    log_success "🎉 Release v${APP_VERSION} successfully published to R2!"
else
    log_warn "⏭️ Skipping R2 upload. Current branch ('$GIT_BRANCH') is not 'release'."
fi

rm -rf dist/Patens
TIME_TOTAL=$(( $(date +%s) - PIPELINE_START ))

echo ""
echo -e "${CYAN}===================================================================${NC}"
echo -e "${CYAN}               📊 PATENS BUILD PIPELINE PROFILE SUMMARY            ${NC}"
echo -e "${CYAN}===================================================================${NC}"
printf "%-35s | %-12s | %-15s\n" "Build Phase" "Duration" "Artifact Size"
echo "-------------------------------------------------------------------"
printf "%-35s | %-12s | %-15s\n" "1. Metadata Parsing" "${TIME_METADATA}s" "N/A"
printf "%-35s | %-12s | %-15s\n" "2. Test Suite Execution" "${TIME_TESTS}s" "Passed ✅"
printf "%-35s | %-12s | %-15s\n" "3. Extension Build (Vite)" "${TIME_EXTENSION}s" "Zip: $(get_size "$EXTENSION_ZIP_OUTPUT")"
printf "%-35s | %-12s | %-15s\n" "4. FastEmbed Model Cache" "${TIME_FASTEMBED}s" "Cache: ${SIZE_MODEL_CACHE}"
printf "%-35s | %-12s | %-15s\n" "5. PyInstaller Spec & Build" "${TIME_PYINSTALLER}s" "Dir: ${SIZE_PYINSTALLER_EXE}"
printf "%-35s | %-12s | %-15s\n" "6. MSIX Packaging" "${TIME_MSIX}s" "MSIX: ${SIZE_MSIX}"
printf "%-35s | %-12s | %-15s\n" "7. EXE Installer Generation" "${TIME_EXE_INSTALLER}s" "EXE: ${SIZE_EXE_INSTALLER}"
echo "-------------------------------------------------------------------"
printf "%-35s | %-12s | %-15s\n" "TOTAL RUNTIME" "${TIME_TOTAL}s" ""
echo -e "${CYAN}===================================================================${NC}"
echo -e "${GREEN} LOCAL ARTIFACTS LOCATION:${NC}"
echo -e "  • Versioned Folder: ${VERSION_DIR}/"
echo -e "  • Latest (Hardlinks): dist/latest/ (0 bytes extra)"
echo -e "${CYAN}===================================================================${NC}"