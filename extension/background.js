// Function to sync settings from the Python backend
async function syncSettings() {
    try {
        const res = await fetch("http://localhost:8000/api/config");
        if (res.ok) {
            const config = await res.json();
            chrome.storage.local.set({hotkeys: config});
        }
    } catch (err) {
        // Silently fail if server is offline
    }
}

// Sync on startup and every 5 seconds
syncSettings();
setInterval(syncSettings, 5000);

// Your existing ingestion code
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ingest_batch") {
        const requests = request.payload.map(item => sendToLocalServer(item));
        Promise.all(requests)
            .then(() => sendResponse({success: true}))
            .catch(err => {
                console.error("Batch send failed", err);
                sendResponse({success: false});
            });
        return true;
    }
});

async function sendToLocalServer(payload) {
    const response = await fetch("http://localhost:8000/ingest", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("Server rejected request");
    return response.json();
}

// Listen for the hotkey
// chrome.commands.onCommand.addListener((command) => {
//     if (command === "toggle_search_palette") {
//         chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
//             if (tabs[0]) {
//                 chrome.tabs.sendMessage(tabs[0].id, {action: "open_palette"});
//             }
//         });
//     }
// });