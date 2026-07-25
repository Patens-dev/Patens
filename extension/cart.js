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

                    // Create content natively to avoid innerHTML
                    const iconText = document.createTextNode('📦');
                    const badge = document.createElement('div');
                    badge.className = 'cc-cart-badge';
                    badge.id = 'cc-badge';

                    btn.appendChild(iconText);
                    btn.appendChild(badge);
                    btn.onclick = window.toggleModal;
                    document.body.appendChild(btn);
                }
                document.getElementById('cc-badge').textContent = cart.length;
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

        // Clear previous contents
        modal.textContent = '';

        // --- 1. Header ---
        const header = document.createElement('div');
        header.className = 'cc-cart-header';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = 'Context Cart';

        const closeSpan = document.createElement('span');
        closeSpan.style.cursor = 'pointer';
        closeSpan.textContent = '_';
        closeSpan.onclick = () => {
            const btn = document.getElementById('cc-cart-btn');
            if (btn) btn.click();
        };

        header.appendChild(titleSpan);
        header.appendChild(closeSpan);
        modal.appendChild(header);

        // --- Tooltip Setup ---
        let tooltip = document.getElementById('cc-cart-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'cc-cart-tooltip';
            tooltip.className = 'cc-cart-tooltip';
            tooltip.style.zIndex = '2147483647';
            document.body.appendChild(tooltip);
        }

        // --- 2. Items List ---
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'cc-cart-items';

        cart.forEach(itemData => {
            const itemEl = document.createElement('div');
            itemEl.className = 'cc-cart-item';
            itemEl.setAttribute('data-id', itemData.id);

            // Remove Button
            const removeBtn = document.createElement('div');
            removeBtn.className = 'cc-item-remove';
            removeBtn.textContent = '✕';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                const updatedCart = cart.filter(i => i.id !== itemData.id);
                tooltip.classList.remove('cc-tooltip-visible');
                chrome.storage.local.set({contextCart: updatedCart});
            };

            // Source Title
            const sourceEl = document.createElement('div');
            sourceEl.className = 'cc-item-source';
            sourceEl.textContent = itemData.title; // Safe from XSS

            // Item Text
            const textEl = document.createElement('div');
            textEl.className = 'cc-item-text';
            textEl.textContent = itemData.content; // Safe from XSS

            itemEl.appendChild(removeBtn);
            itemEl.appendChild(sourceEl);
            itemEl.appendChild(textEl);

            // Tooltip Interactions
            itemEl.addEventListener('mouseenter', () => {
                tooltip.textContent = ''; // clear previous tooltip

                if (itemData.type === 'image') {
                    const img = document.createElement('img');
                    img.src = itemData.media;
                    img.alt = 'Preview';
                    tooltip.appendChild(img);
                } else {
                    if (itemData.content.length > 256) {
                        tooltip.textContent = itemData.content.substring(0, 256);
                        const dots = document.createElement('span');
                        dots.style.color = '#8ab4f8';
                        dots.textContent = '...';
                        tooltip.appendChild(dots);
                    } else {
                        tooltip.textContent = itemData.content;
                    }
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

            itemsContainer.appendChild(itemEl);
        });

        modal.appendChild(itemsContainer);

        // --- 3. Footer ---
        const footer = document.createElement('div');
        footer.className = 'cc-cart-footer';

        const sendBtn = document.createElement('button');
        sendBtn.className = 'cc-send-btn';
        sendBtn.id = 'cc-send-all';
        sendBtn.textContent = '✨ Send All to Local Memory';

        sendBtn.onclick = (e) => {
            const btn = e.target;
            btn.textContent = "Sending...";
            btn.disabled = true;

            chrome.runtime.sendMessage({action: "ingest_batch", payload: cart}, async (response) => {
                if (response?.success) {
                    btn.textContent = "✓ Saved!";
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
                    btn.textContent = "❌ Failed to send";
                    btn.style.background = "#8B0000";
                    btn.disabled = false;
                }
            });
        };

        footer.appendChild(sendBtn);
        modal.appendChild(footer);
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