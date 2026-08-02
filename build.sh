#!/bin/bash
set -euo pipefail

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

TEMP_FILES=("version_info.txt" "msix_layout" "patens_setup.iss")
cleanup() {
    log_info "Cleaning temporary build script artifacts..."
    for item in "${TEMP_FILES[@]}"; do [ -e "$item" ] && rm -rf "$item"; done
}
trap cleanup EXIT INT TERM

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
    log_warn "Inno Setup (ISCC.exe) not found. Standard standalone binary will be used as the EXE installer target."
fi

log_info "Cleaning previous build outputs..."
rm -rf build dist Patens.spec msix_layout
mkdir -p dist

# ===================================================================
# 1. METADATA PARSING
# ===================================================================
log_info "Parsing project metadata..."
start_timer

eval "$(python -c '
import json, os, re, sys
if not os.path.exists("pyproject.toml"): sys.exit(1)
app_version, name, desc, company = "1.0.0", "Patens", "Patens Executable", "Patens"
try:
    import tomllib
    with open("pyproject.toml", "rb") as f: toml_data = tomllib.load(f)
    project = toml_data.get("project", {})
    name, app_version, desc = project.get("name", name), project.get("version", app_version), project.get("description", desc)
    authors = project.get("authors", [])
    if authors and isinstance(authors[0], dict): company = authors[0].get("name", company)
except Exception: pass

v_parts = app_version.split(".")
while len(v_parts) < 4: v_parts.append("0")
v_tuple = f"({v_parts[0]}, {v_parts[1]}, {v_parts[2]}, {v_parts[3]})"

version_info_template = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v_tuple}, prodvers={v_tuple}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[StringFileInfo([StringTable("040904B0", [
    StringStruct("CompanyName", "{company}"), StringStruct("FileDescription", "{desc}"),
    StringStruct("FileVersion", "{app_version}"), StringStruct("InternalName", "{name}"),
    StringStruct("LegalCopyright", "Copyright (c) 2026 {company}"), StringStruct("OriginalFilename", "Patens.exe"),
    StringStruct("ProductName", "{name}"), StringStruct("ProductVersion", "{app_version}")
  ])]), VarFileInfo([VarStruct("Translation", [1033, 1200])])]
)"""
with open("version_info.txt", "w", encoding="utf-8") as f: f.write(version_info_template)

possible_ext_paths = ["extension/manifest.json", "browser_extension/manifest.json", "chrome_extension/manifest.json", "manifest.json"]
ext_manifest_path = next((p for p in possible_ext_paths if os.path.exists(p)), None)
ext_version, ext_dir = "1.0.0", "extension"
if ext_manifest_path:
    ext_dir = os.path.dirname(ext_manifest_path) or "."
    with open(ext_manifest_path, "r", encoding="utf-8") as f: ext_version = json.load(f).get("version", "1.0.0")

print(f"export APP_VERSION=\"{app_version}\"")
print(f"export EXT_VERSION=\"{ext_version}\"")
print(f"export COMPANY=\"{company}\"")
print(f"export EXT_DIR=\"{ext_dir}\"")
')"
TIME_METADATA=$(stop_timer)

# ===================================================================
# 2. DYNAMIC FASTEMBED MODEL CACHING
# ===================================================================
log_info "📥 Synchronizing FastEmbed model from config..."
start_timer

python -c '
import os, sys
sys.path.insert(0, "src")
from patens.server.config import MODEL_NAME
from fastembed import TextEmbedding

cache_path = os.path.abspath("fastembed_cache")
print(f"Resolving configured model: {MODEL_NAME} -> {cache_path}")

# Download and cache cleanly without deleting blobs
TextEmbedding(model_name=MODEL_NAME, cache_dir=cache_path)
'
TIME_FASTEMBED=$(stop_timer)

# ===================================================================
# 3. PYINSTALLER COMPILATION
# ===================================================================
log_info "🔨 Compiling PyInstaller binary..."
start_timer

"$PYINSTALLER_BIN" \
  --name "Patens" \
  --onefile \
  --noconfirm \
  --paths=src \
  --exclude-module torch \
  --exclude-module scipy \
  --exclude-module transformers \
  --exclude-module sympy \
  --exclude-module sklearn \
  --exclude-module scikit_learn \
  --exclude-module networkx \
  --exclude-module matplotlib \
  --exclude-module tkinter \
  --exclude-module unittest \
  --copy-metadata fastmcp \
  --copy-metadata fastmcp-slim \
  --add-data "fastembed_cache;fastembed_cache" \
  --add-data "src/patens/server/default_config.yaml;patens/server" \
  --add-data "src/patens/server/templates;patens/server/templates" \
  --collect-all sqlite_vec \
  --version-file="version_info.txt" \
  --icon="assets/patens.ico" \
  src/patens/main.py

TIME_PYINSTALLER=$(stop_timer)
SIZE_PYINSTALLER_EXE=$(get_size "dist/Patens.exe")

# ===================================================================
# 4. MSIX PACKAGE GENERATION & SIGNING
# ===================================================================
log_info "📦 Creating MSIX package layout..."
start_timer

PACKAGE_IDENTITY_NAME="Patens"                            # Package/Identity/Name
PACKAGE_IDENTITY_PUBLISHER="CN=Patens"                   # Package/Identity/Publisher
PUBLISHER_DISPLAY_NAME="Patens"                           # Package/Properties/PublisherDisplayName

mkdir -p msix_layout/Assets

# Copy compiled binary to layout
cp "dist/Patens.exe" "msix_layout/Patens.exe"

# Convert assets/patens.ico to proper PNG assets if Pillow is available
python -c '
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

# Generate AppxManifest.xml with exact identity fields
cat << EOF > msix_layout/AppxManifest.xml
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="Patens.Patens.dev"
    Publisher="CN=6F606911-9D25-40B8-9444-C3963DE67C69"
    Version="${APP_VERSION}.0" />

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
MSIX_OUTPUT="dist/patens_${APP_VERSION}.msix"
MSYS_NO_PATHCONV=1 "$MAKEAPPX_CMD" pack /d msix_layout /p "$MSIX_OUTPUT" /o

# Sign locally for testing if self-signed cert exists in Cert store
if [ -f "$SIGNTOOL_CMD" ]; then
    log_info "🔏 Attempting local sign with signtool for developer testing..."
    MSYS_NO_PATHCONV=1 "$SIGNTOOL_CMD" sign /fd SHA256 /n "${PUBLISHER_DISPLAY_NAME}" "$MSIX_OUTPUT" 2>/dev/null || log_warn "Local cert '${PUBLISHER_DISPLAY_NAME}' not found in Cert store. Package remains unsigned for local testing, but IS ready for Microsoft Store upload!"
fi

TIME_MSIX=$(stop_timer)
SIZE_MSIX=$(get_size "$MSIX_OUTPUT")

# ===================================================================
# 5. EXE INSTALLER GENERATION
# ===================================================================
log_info "⚙️ Generating standalone EXE installer..."
start_timer
EXE_INSTALLER_OUTPUT="dist/patens_installer_${APP_VERSION}.exe"

if [ -n "$ISCC_CMD" ]; then
    cat << EOF > patens_setup.iss
[Setup]
AppName=Patens
AppVersion=${APP_VERSION}
AppPublisher=${COMPANY}
DefaultDirName={userappdata}\..\Local\Programs\Patens
PrivilegesRequired=lowest
OutputBaseFilename=patens_installer_${APP_VERSION}
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir=dist
SetupIconFile=assets\patens.ico
WizardStyle=modern

[Files]
Source: "dist\Patens.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Patens"; Filename: "{app}\Patens.exe"
Name: "{autodesktop}\Patens"; Filename: "{app}\Patens.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\Patens.exe"; Description: "{cm:LaunchProgram,Patens}"; Flags: nowait postinstall skipifsilent
EOF

    log_info "🔨 Compiling Inno Setup EXE installer..."
    MSYS_NO_PATHCONV=1 "$ISCC_CMD" patens_setup.iss > /dev/null
else
    log_info "📋 Copying PyInstaller portable executable as standalone setup target..."
    cp "dist/Patens.exe" "$EXE_INSTALLER_OUTPUT"
fi

TIME_EXE_INSTALLER=$(stop_timer)
SIZE_EXE_INSTALLER=$(get_size "$EXE_INSTALLER_OUTPUT")

# ===================================================================
# 6. BROWSER EXTENSION PACKAGING
# ===================================================================
start_timer
python -c '
import sys, os, zipfile
ext_dir, ext_version = sys.argv[1], sys.argv[2]
zip_filename = os.path.join("dist", f"extension_{ext_version}.zip")
if os.path.exists(ext_dir):
    with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(ext_dir):
            for file in files:
                if not file.startswith(".") and not file.endswith((".zip", ".git")):
                    file_path = os.path.join(root, file)
                    zipf.write(file_path, os.path.relpath(file_path, ext_dir))
' "$EXT_DIR" "$EXT_VERSION"
TIME_EXTENSION=$(stop_timer)

TIME_TOTAL=$(( $(date +%s) - PIPELINE_START ))

echo ""
echo -e "${CYAN}===================================================================${NC}"
echo -e "${CYAN}               📊 PATENS BUILD PIPELINE PROFILE SUMMARY            ${NC}"
echo -e "${CYAN}===================================================================${NC}"
printf "%-35s | %-12s | %-15s\n" "Build Phase" "Duration" "Artifact Size"
echo "-------------------------------------------------------------------"
printf "%-35s | %-12s | %-15s\n" "1. Metadata Parsing" "${TIME_METADATA}s" "N/A"
printf "%-35s | %-12s | %-15s\n" "2. FastEmbed Model Prune" "${TIME_FASTEMBED}s" "Cache: ${SIZE_MODEL_CACHE}"
printf "%-35s | %-12s | %-15s\n" "3. PyInstaller Compilation" "${TIME_PYINSTALLER}s" "Exe: ${SIZE_PYINSTALLER_EXE}"
printf "%-35s | %-12s | %-15s\n" "4. MSIX Packaging" "${TIME_MSIX}s" "MSIX: ${SIZE_MSIX}"
printf "%-35s | %-12s | %-15s\n" "5. EXE Installer Generation" "${TIME_EXE_INSTALLER}s" "EXE: ${SIZE_EXE_INSTALLER}"
printf "%-35s | %-12s | %-15s\n" "6. Extension Packaging" "${TIME_EXTENSION}s" "Zip: $(get_size "dist/extension_${EXT_VERSION}.zip")"
echo "-------------------------------------------------------------------"
printf "%-35s | %-12s | %-15s\n" "TOTAL RUNTIME" "${TIME_TOTAL}s" ""
echo -e "${CYAN}===================================================================${NC}"