# src/context_clipboard/server/ui_templates.py

SETTINGS_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Context Clipboard Settings</title>
    <style>
        body { background: #121212; color: #e8eaed; font-family: system-ui, sans-serif; display: flex; justify-content: center; padding-top: 8vh; margin: 0; }
        .container { background: #202124; padding: 32px; border-radius: 12px; border: 1px solid #3c4043; width: 440px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
        h2 { color: #8ab4f8; margin-top: 0; font-size: 22px; display: flex; align-items: center; gap: 8px; }
        p { color: #9aa0a6; font-size: 13px; line-height: 1.5; margin-bottom: 28px; }
        .setting-group { margin-bottom: 28px; border-bottom: 1px solid #3c4043; padding-bottom: 20px; }
        .setting-group:last-of-type { border-bottom: none; padding-bottom: 0; }
        .setting-group label { display: block; font-size: 12px; font-weight: 700; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #bdc1c6; }

        /* Pill-based layout */
        .pill-container { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .modifier-pill { background: #303134; border: 1px solid #5f6368; color: #e8eaed; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; user-select: none; }
        .modifier-pill:hover { border-color: #8ab4f8; }
        .modifier-pill.active { background: rgba(138, 180, 248, 0.15); border-color: #8ab4f8; color: #8ab4f8; }

        /* Character key input box */
        .key-input-wrapper { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
        .key-input-label { font-size: 13px; color: #9aa0a6; }
        .key-box { background: #303134; border: 1px solid #5f6368; color: #e8eaed; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: bold; width: 120px; text-align: center; cursor: pointer; user-select: none; }
        .key-box:hover { border-color: #8ab4f8; }
        .key-box.recording { border-color: #f28b82; background: rgba(242, 139, 130, 0.1); color: #f28b82; }

        .save-btn { background: #8ab4f8; color: #202124; border: none; padding: 12px; width: 100%; border-radius: 6px; font-weight: bold; font-size: 15px; cursor: pointer; margin-top: 10px; transition: background 0.2s; }
        .save-btn:hover { background: #aecbfa; }
    </style>
</head>
<body>
    <div class="container">
        <h2>⚙️ Context Clipboard Settings</h2>
        <p>Toggle the modifier buttons below to construct your desired combinations. Changes apply globally without requiring restarts.</p>

        <!-- 1. CAPTURE HOTKEY CONFIG -->
        <div class="setting-group">
            <label>1. Add to Cart (Mouse Shortcut)</label>
            <div class="pill-container">
                <div id="cap-ctrl" class="modifier-pill" onclick="toggleModifier('capture', 'ctrl')">Ctrl</div>
                <div id="cap-shift" class="modifier-pill" onclick="toggleModifier('capture', 'shift')">Shift</div>
                <div id="cap-alt" class="modifier-pill" onclick="toggleModifier('capture', 'alt')">Alt</div>
                <div id="cap-meta" class="modifier-pill" onclick="toggleModifier('capture', 'meta')">⌘ Win/Mac</div>
            </div>
            <span style="font-size: 12px; color: #9aa0a6;">Triggered via: Selected Modifiers + Mouse Click/Hover</span>
        </div>

        <!-- 2. PALETTE HOTKEY CONFIG -->
        <div class="setting-group">
            <label>2. Open Search Palette (Keyboard Shortcut)</label>
            <div class="pill-container">
                <div id="pal-ctrl" class="modifier-pill" onclick="toggleModifier('palette', 'ctrl')">Ctrl</div>
                <div id="pal-shift" class="modifier-pill" onclick="toggleModifier('palette', 'shift')">Shift</div>
                <div id="pal-alt" class="modifier-pill" onclick="toggleModifier('palette', 'alt')">Alt</div>
                <div id="pal-meta" class="modifier-pill" onclick="toggleModifier('palette', 'meta')">⌘ Win/Mac</div>
            </div>
            <div class="key-input-wrapper">
                <span class="key-input-label">Plus Key:</span>
                <div id="pal-key-box" class="key-box" onclick="startRecordingKey()">Space</div>
            </div>
        </div>

        <button class="save-btn" onclick="saveSettings()">Save & Sync Settings</button>
    </div>

    <script>
        let currentConfig = { capture: {}, palette: {} };
        let isRecordingKey = false;

        fetch('/api/config').then(r => r.json()).then(data => {
            currentConfig = data;
            renderUI();
        });

        function renderUI() {
            document.getElementById('cap-ctrl').classList.toggle('active', currentConfig.capture.ctrl);
            document.getElementById('cap-shift').classList.toggle('active', currentConfig.capture.shift);
            document.getElementById('cap-alt').classList.toggle('active', currentConfig.capture.alt);
            document.getElementById('cap-meta').classList.toggle('active', currentConfig.capture.meta);

            document.getElementById('pal-ctrl').classList.toggle('active', currentConfig.palette.ctrl);
            document.getElementById('pal-shift').classList.toggle('active', currentConfig.palette.shift);
            document.getElementById('pal-alt').classList.toggle('active', currentConfig.palette.alt);
            document.getElementById('pal-meta').classList.toggle('active', currentConfig.palette.meta);

            const keyVal = currentConfig.palette.key;
            document.getElementById('pal-key-box').innerText = keyVal === " " ? "Space" : keyVal.toUpperCase();
        }

        function toggleModifier(type, modifier) {
            currentConfig[type][modifier] = !currentConfig[type][modifier];
            renderUI();
        }

        function startRecordingKey() {
            isRecordingKey = true;
            const box = document.getElementById('pal-key-box');
            box.classList.add('recording');
            box.innerText = "Press any key...";
        }

        document.addEventListener('keydown', (e) => {
            if (!isRecordingKey) return;
            e.preventDefault();
            if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

            currentConfig.palette.key = e.key;
            const box = document.getElementById('pal-key-box');
            box.classList.remove('recording');
            isRecordingKey = false;
            renderUI();
        });

        function saveSettings() {
            const btn = document.querySelector('.save-btn');
            btn.innerText = "Syncing with Extension...";
            fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentConfig)
            }).then(() => {
                btn.innerText = "✓ Saved & Synced Successfully";
                setTimeout(() => btn.innerText = "Save & Sync Settings", 2000);
            });
        }
    </script>
</body>
</html>
"""