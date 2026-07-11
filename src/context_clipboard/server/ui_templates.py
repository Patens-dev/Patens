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

WELCOME_HTML="""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Context Clipboard</title>
    <style>
        :root {
            --bg-base: #0c0d10;
            --bg-card: #16181d;
            --border-color: #2d313a;
            --text-main: #e2e8f0;
            --text-muted: #94a3b8;
            --accent-blue: #3b82f6;
            --accent-blue-hover: #2563eb;
            --accent-glow: rgba(59, 130, 246, 0.15);
            --success-color: #10b981;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-base);
            color: var(--text-main);
            line-height: 1.6;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            background-image: 
                radial-gradient(circle at 50% 0%, var(--accent-glow) 0%, transparent 40%),
                linear-gradient(to bottom, transparent, var(--bg-base));
        }

        .container {
            max-width: 800px;
            width: 100%;
            padding: 60px 24px;
            margin: 0 auto;
        }

        /* Hero Section */
        .hero { text-align: center; margin-bottom: 48px; }
        
        .hero-icon {
            font-size: 48px;
            margin-bottom: 16px;
            filter: drop-shadow(0 0 12px var(--accent-glow));
        }

        .hero h1 {
            font-size: 36px;
            font-weight: 800;
            letter-spacing: -0.5px;
            margin-bottom: 12px;
            color: #f8fafc;
        }

        .hero p {
            font-size: 16px;
            color: var(--text-muted);
            max-width: 500px;
            margin: 0 auto;
        }

        /* Setup Flow */
        .setup-flow {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .step-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 32px;
            position: relative;
            display: flex;
            gap: 32px;
            align-items: center;
        }

        .step-number {
            position: absolute;
            top: -16px;
            left: 32px;
            background: var(--accent-blue);
            color: white;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            font-weight: bold;
            font-size: 14px;
            box-shadow: 0 0 0 4px var(--bg-base);
        }

        .step-content { flex: 1; }
        
        .step-content h2 {
            font-size: 20px;
            margin-bottom: 8px;
            color: #f8fafc;
        }

        .step-content p {
            color: var(--text-muted);
            font-size: 15px;
            margin-bottom: 16px;
        }

        /* GIF / Media Placeholder */
        .media-placeholder {
            flex: 1;
            background: #0f1115;
            border: 1px dashed #475569;
            border-radius: 8px;
            height: 200px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #64748b;
            font-size: 13px;
            overflow: hidden;
            position: relative;
        }

        .media-placeholder img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            position: absolute;
            top: 0; left: 0;
            opacity: 0; /* Change to 1 when you add your real image/gif */
        }

        /* Test Prompt Box */
        .prompt-box {
            background: #0f1115;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 16px;
        }

        .prompt-text {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 13px;
            color: #a5b4fc;
        }

        .copy-btn {
            background: transparent;
            border: 1px solid #475569;
            color: var(--text-muted);
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .copy-btn:hover { background: #334155; color: white; }

        /* Final Action */
        .footer-action {
            margin-top: 48px;
            text-align: center;
        }

        .btn-primary {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--accent-blue);
            color: white;
            padding: 14px 28px;
            border: none;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s ease;
        }

        .btn-primary:hover {
            background: var(--accent-blue-hover);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(59, 130, 246, 0.25);
        }

        @media (max-width: 768px) {
            .step-card { flex-direction: column; gap: 24px; padding: 24px; }
            .media-placeholder { width: 100%; }
        }
    </style>
</head>
<body>

    <div class="container">
        <!-- Header -->
        <header class="hero">
            <div class="hero-icon">✅</div>
            <h1>Server Connected</h1>
            <p>Your local database is running and IDE configurations have been injected. Complete these final manual steps to bypass your IDE's security sandbox.</p>
        </header>

        <!-- Setup Flow -->
        <main class="setup-flow">
            
            <!-- Step 1 -->
            <div class="step-card">
                <div class="step-number">1</div>
                <div class="step-content">
                    <h2>Restart your IDE</h2>
                    <p>To load the newly injected configurations, you must completely restart Visual Studio Code, Cursor, or JetBrains.</p>
                </div>
            </div>

            <!-- Step 2 -->
            <div class="step-card">
                <div class="step-number">2</div>
                <div class="step-content">
                    <h2>Authorize the Tools</h2>
                    <p>For security reasons, your IDE requires you to manually enable third-party tools.</p>
                    <ul style="color: var(--text-muted); font-size: 14px; margin-left: 20px; line-height: 1.8;">
                        <li>Open the GitHub Copilot or Cursor Chat panel.</li>
                        <li>Click the <strong>Tools (📎)</strong> icon.</li>
                        <li>Find <strong>ContextClipboard</strong> and check the boxes to enable your memory tools.</li>
                    </ul>
                </div>
                <div class="media-placeholder">
                    <svg width="24" height="24" fill="currentColor" style="margin-bottom: 8px;" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                    Replace with tool_enable.gif
                    <!-- <img src="/images/tool_enable.gif" alt="How to enable tools" /> -->
                </div>
            </div>

            <!-- Step 3 -->
            <div class="step-card">
                <div class="step-number">3</div>
                <div class="step-content">
                    <h2>Test Your Memory</h2>
                    <p>Save a snippet from the browser extension, then ask your AI assistant to read your clipboard.</p>
                    
                    <div class="prompt-box">
                        <span class="prompt-text">Review the latest context I saved in my clipboard.</span>
                        <button class="copy-btn" onclick="copyPrompt(this)">Copy</button>
                    </div>
                </div>
            </div>

        </main>

        <!-- Footer -->
        <div class="footer-action">
            <a href="/settings" class="btn-primary">
                I've done this, take me to Settings
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
        </div>
    </div>

    <script>
        function copyPrompt(btn) {
            const text = "Review the latest context I saved in my clipboard.";
            navigator.clipboard.writeText(text).then(() => {
                const originalText = btn.innerText;
                btn.innerText = "Copied!";
                btn.style.color = "var(--success-color)";
                btn.style.borderColor = "var(--success-color)";
                
                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.style.color = "var(--text-muted)";
                    btn.style.borderColor = "#475569";
                }, 2000);
            });
        }
    </script>
</body>
</html>
"""