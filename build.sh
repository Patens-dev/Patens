#!/bin/bash

echo "🧹 Cleaning old build files..."
rm -rf build dist Patens.spec version_info.txt

echo "📄 Reading pyproject.toml and generating version_info.txt..."
python -c '
import re

# Read the TOML file
with open("pyproject.toml", "r", encoding="utf-8") as f:
    text = f.read()

# Helper to extract flat values via regex
def get_val(key, default=""):
    match = re.search(fr"{key}\s*=\s*\"([^\"]+)\"", text)
    return match.group(1) if match else default

# Extract metadata
name = get_val("name", "Patens")
version = get_val("version", "1.0.0")
desc = get_val("description", "Patens Executable")

# FIX: Extract company/publisher from the authors array
author_match = re.search(r"authors\s*=\s*\[\s*\{\s*name\s*=\s*\"([^\"]+)\"\s*\}\s*\]", text)
company = author_match.group(1) if author_match else "Unknown Publisher"

# Convert version "1.1.0" into the required tuple format (1, 1, 0, 0)
v_parts = version.split(".")
while len(v_parts) < 4:
    v_parts.append("0")
v_tuple = f"({v_parts[0]}, {v_parts[1]}, {v_parts[2]}, {v_parts[3]})"

# Generate the PyInstaller version text
template = f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={v_tuple},
    prodvers={v_tuple},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
    ),
  kids=[
    StringFileInfo(
      [
      StringTable(
        \"040904B0\",
        [StringStruct(\"CompanyName\", \"{company}\"),
        StringStruct(\"FileDescription\", \"{desc}\"),
        StringStruct(\"FileVersion\", \"{version}\"),
        StringStruct(\"InternalName\", \"{name}\"),
        StringStruct(\"LegalCopyright\", \"Copyright (c) 2026 {company}\"),
        StringStruct(\"OriginalFilename\", \"Patens.exe\"),
        StringStruct(\"ProductName\", \"{name}\"),
        StringStruct(\"ProductVersion\", \"{version}\")])
      ]),
    VarFileInfo([VarStruct(\"Translation\", [1033, 1200])])
  ]
)"""

# Write to disk
with open("version_info.txt", "w", encoding="utf-8") as f:
    f.write(template)
print(f"✅ Generated v{version} metadata for {company}")
'

echo "🚀 Building executable with PyInstaller..."

# Run PyInstaller with Patens target name
./build_env/Scripts/pyinstaller.exe \
  --name "Patens" \
  --onefile \
  --paths=src \
  --copy-metadata fastmcp \
  --copy-metadata fastmcp-slim \
  --add-data "src/patens/server/default_config.yaml;patens/server" \
  --add-data "src/patens/server/templates;patens/server/templates" \
  --collect-all sqlite_vec \
  --version-file="version_info.txt" \
  src/patens/main.py

echo "🎉 Build complete! Your version-stamped .exe is waiting in the /dist folder."