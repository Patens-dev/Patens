// ==========================================
// INJECTION GUARD
// Prevents "Identifier has already been declared" errors
// if Chrome injects this script multiple times.
// ==========================================
if (!window._ccCartLoaded) {
    window._ccCartLoaded = true;
    window.cartOpen = false;

    window.renderUI = function () {
        chrome.storage.local.get(['contextCart'], (result) => {
            const cart = result.contextCart || [];
            let btn = document.getElementById('cc-cart-btn');

            if (cart.length > 0) {
                if (!btn) {
                    btn = document.createElement('div');
                    btn.id = 'cc-cart-btn';
                    btn.className = 'cc-cart-btn';
                    btn.style.position = 'fixed';
                    btn.style.zIndex = '2147483647';
                    btn.innerHTML = `📦<div class="cc-cart-badge" id="cc-badge"></div>`;
                    btn.onclick = window.toggleModal;
                    document.body.appendChild(btn);
                }
                document.getElementById('cc-badge').innerText = cart.length;
            } else {
                if (btn) btn.remove();
                if (window.cartOpen) window.toggleModal();
            }

            if (window.cartOpen) window.renderModalContents(cart);
        });
    };

    window.toggleModal = function () {
        let modal = document.getElementById('cc-cart-modal');
        if (window.cartOpen && modal) {
            modal.remove();
            window.cartOpen = false;
        } else {
            modal = document.createElement('div');
            modal.id = 'cc-cart-modal';
            modal.className = 'cc-cart-modal';
            modal.style.position = 'fixed';
            modal.style.zIndex = '2147483647';
            document.body.appendChild(modal);
            window.cartOpen = true;
            window.renderUI();
        }
    };

    window.renderModalContents = function (cart) {
        const modal = document.getElementById('cc-cart-modal');
        if (!modal) return;

        let itemsHTML = cart.map(item => `
            <div class="cc-cart-item" data-id="${item.id}">
                <div class="cc-item-remove" data-id="${item.id}">✕</div>
                <div class="cc-item-source">${item.title}</div>
                <div class="cc-item-text">${item.content.replace(/</g, '&lt;')}</div>
            </div>
        `).join('');

        modal.innerHTML = `
            <div class="cc-cart-header">
                <span>Context Cart</span>
                <span style="cursor:pointer" onclick="document.getElementById('cc-cart-btn').click()">_</span>
            </div>
            <div class="cc-cart-items">${itemsHTML}</div>
            <div class="cc-cart-footer">
                <button class="cc-send-btn" id="cc-send-all">✨ Send All to Local Memory</button>
            </div>
        `;

        let tooltip = document.getElementById('cc-cart-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'cc-cart-tooltip';
            tooltip.className = 'cc-cart-tooltip';
            tooltip.style.zIndex = '2147483647';
            document.body.appendChild(tooltip);
        }

        modal.querySelectorAll('.cc-cart-item').forEach(itemEl => {
            const itemId = itemEl.getAttribute('data-id');
            const itemData = cart.find(i => i.id === itemId);

            itemEl.addEventListener('mouseenter', () => {
                if (itemData.type === 'image') tooltip.innerHTML = `<img src="${itemData.media}" alt="Preview" />`;
                else {
                    const safeText = itemData.content.replace(/</g, '&lt;');
                    tooltip.innerHTML = safeText.length > 256 ? `${safeText.substring(0, 256)}<span style="color:#8ab4f8">...</span>` : safeText;
                }
                const modalRect = modal.getBoundingClientRect();
                const itemRect = itemEl.getBoundingClientRect();
                tooltip.style.right = `${window.innerWidth - modalRect.left + 15}px`;
                let topPosition = itemRect.top;
                if (topPosition + 250 > window.innerHeight) topPosition = window.innerHeight - 260;
                tooltip.style.top = `${topPosition}px`;
                tooltip.classList.add('cc-tooltip-visible');
            });

            itemEl.addEventListener('mouseleave', () => tooltip.classList.remove('cc-tooltip-visible'));
        });

        modal.querySelectorAll('.cc-item-remove').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idToRemove = btn.getAttribute('data-id');
                const updatedCart = cart.filter(item => item.id !== idToRemove);
                tooltip.classList.remove('cc-tooltip-visible');
                chrome.storage.local.set({contextCart: updatedCart});
            };
        });

        modal.querySelector('#cc-send-all').onclick = (e) => {
            const btn = e.target;
            btn.innerText = "Sending...";
            btn.disabled = true;

            chrome.runtime.sendMessage({action: "ingest_batch", payload: cart}, async (response) => {
                if (response?.success) {
                    btn.innerText = "✓ Saved!";
                    btn.style.background = "#006400";
                    tooltip.classList.remove('cc-tooltip-visible');

                    let totalTokens = 0;
                    let clipText = "> 📎 **Context Batch Saved**\n";

                    cart.forEach(item => {
                        const tokens = Math.floor(item.content.length / 4);
                        totalTokens += tokens;
                        clipText += `> - ${item.title} (~${tokens}t)\n`;
                    });

                    clipText += `> 📏 **Total Size:** ~${totalTokens} tokens\n`;
                    clipText += `> 📂 Available instantly in your IDE via \`@\` or \`#\` in the \`_context/\` folder.`;
                    try {
                        await navigator.clipboard.writeText(clipText);
                    } catch (err) {
                        console.warn("Could not write to clipboard:", err);
                    }

                    setTimeout(() => chrome.storage.local.set({contextCart: []}), 1000);
                } else {
                    btn.innerText = "❌ Failed to send";
                    btn.style.background = "#8B0000";
                    btn.disabled = false;
                }
            });
        };
    };

    // ==========================================
    // "FAST-FORWARD" KEYBOARD SHORTCUT
    // ==========================================
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
            chrome.storage.local.get(['contextCart'], (result) => {
                const cart = result.contextCart || [];
                if (cart.length > 0) {
                    const toast = document.createElement('div');
                    toast.style.cssText = `
                        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                        background: #006400; color: white; padding: 8px 16px; border-radius: 20px;
                        font-family: sans-serif; font-size: 14px; z-index: 2147483647;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-weight: bold;
                    `;
                    toast.innerText = "✨ Context Committed!";
                    document.body.appendChild(toast);

                    chrome.runtime.sendMessage({action: "ingest_batch", payload: cart}, async (response) => {
                        if (response?.success) {
                            let totalTokens = 0;
                            let clipText = "> 📎 **Context Batch Saved**\n";
                            cart.forEach(item => {
                                const tokens = Math.floor(item.content.length / 4);
                                totalTokens += tokens;
                                clipText += `> - ${item.title} (~${tokens}t)\n`;
                            });
                            clipText += `> 📏 **Total Size:** ~${totalTokens} tokens\n`;
                            clipText += `> 📂 Available instantly in your IDE via \`@\` in the \`.context/\` folder.`;

                            try {
                                await navigator.clipboard.writeText(clipText);
                            } catch (err) {
                            }
                            chrome.storage.local.set({contextCart: []});
                        }
                        setTimeout(() => toast.remove(), 2000);
                    });
                }
            });
        }
    });
}