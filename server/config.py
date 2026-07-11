# config.py
import os
import logging
import shutil
from pathlib import Path
import yaml

# 1. Define the User Data Directory (~/.context_clipboard)
USER_HOME = Path.home()
APP_DIR = USER_HOME / ".context_clipboard"

# Create standard subdirectories if they don't exist
IMAGE_DIR = APP_DIR / "images"
LOG_DIR = APP_DIR / "logs"
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# 2. Handle Configuration (Auto-generate if missing)
CONFIG_FILE = APP_DIR / "config.yaml"
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = BASE_DIR / "default_config.yaml"

if not CONFIG_FILE.exists():
    # If the user is running this for the first time, copy the default config
    # from your source code into their home directory.
    if DEFAULT_CONFIG_PATH.exists():
        shutil.copy(DEFAULT_CONFIG_PATH, CONFIG_FILE)
    else:
        raise FileNotFoundError(
            f"Missing default config. Expected at: {DEFAULT_CONFIG_PATH}"
        )

# 3. Load User Configuration
with open(CONFIG_FILE, "r") as f:
    _config = yaml.safe_load(f)

# 4. Extract Settings
API_HOST = _config["api"]["host"]
API_PORT = int(_config["api"]["port"])
MODEL_NAME = _config["ai"]["model_name"]

# 5. Anchor data files to the App Directory, NOT the source code
# E.g., ~/.context_clipboard/context_memory.db
DB_PATH = APP_DIR / _config["database"].get("filename", "context_memory.db")
LOG_FILE = LOG_DIR / _config["logging"].get("filename", "server.log")

_log_level_str = _config["logging"].get("level", "INFO").upper()
LOG_LEVEL = getattr(logging, _log_level_str, logging.INFO)
# Hotkey Config Loading
_hotkeys = _config.get("hotkeys", {})
HOTKEY_CAPTURE = _hotkeys.get("capture", {"ctrl": True, "shift": True, "alt": False, "meta": False})
HOTKEY_PALETTE = _hotkeys.get("palette", {"ctrl": True, "shift": True, "alt": False, "meta": False, "key": " "})

def setup_logging():
    """Configures global logging pointing to the user's home directory."""
    logging.basicConfig(
        filename=str(LOG_FILE),
        level=LOG_LEVEL,
        format='%(asctime)s - [%(levelname)s] - %(name)s - %(message)s',
        filemode='a'
    )

    console = logging.StreamHandler()
    console.setLevel(LOG_LEVEL)
    formatter = logging.Formatter('%(asctime)s - [%(levelname)s] - %(name)s - %(message)s')
    console.setFormatter(formatter)
    logging.getLogger('').addHandler(console)


def update_hotkeys_config(capture_config: dict, palette_config: dict) -> bool:
    """Updates the hotkey configuration dynamically in the user's config file."""
    try:
        with open(CONFIG_FILE, "r") as f:
            current_config = yaml.safe_load(f) or {}

        if "hotkeys" not in current_config:
            current_config["hotkeys"] = {}

        current_config["hotkeys"]["capture"] = capture_config
        current_config["hotkeys"]["palette"] = palette_config

        with open(CONFIG_FILE, "w") as f:
            yaml.safe_dump(current_config, f, default_flow_style=False)

        return True
    except Exception as e:
        logging.error(f"Failed to update config: {e}")
        return False
