(() => {
    window.Patens = window.Patens || {};
    const Logger = Patens.LoggerFactory ? Patens.LoggerFactory("[Patens CartUI]") : console;
    const h = Patens.h; // Alias for UI builder

    if (!window._patensCartLoaded) {
        window._patensCartLoaded = true;

        Logger.info("Cart UI module loaded and initialized.");

        // ==========================================
        // CART COMPONENT
        // ==========================================
        Patens.Cart = {
            renderUI: () => {
                Logger.debug("Fetching 'contextCart' from storage to render UI...");

                try {
                    chrome.storage.local.get(['contextCart'], (result) => {
                        if (chrome.runtime.lastError) {
                            Logger.error("Failed to read 'contextCart' from storage:", chrome.runtime.lastError);
                            return;
                        }

                        const cart = result.contextCart || [];
                        Logger.debug(`Read ${cart.length} items from cart storage.`);

                        let btn = document.getElementById('cc-cart-btn');

                        if (cart.length > 0) {
                            if (!btn) {
                                Logger.debug("Creating cart trigger button widget in DOM.");
                                btn = h('div', {
                                        id: 'cc-cart-btn',
                                        class: 'cc-cart-btn',
                                        style: 'position: fixed; z-index: 2147483647;',
                                        onclick: Patens.Cart.toggleModal
                                    },
                                    '📦',
                                    h('div', {class: 'cc-cart-badge', id: 'cc-badge'}, cart.length)
                                );
                                document.body.appendChild(btn);
                            } else {
                                const badge = document.getElementById('cc-badge');
                                if (badge) badge.textContent = cart.length;
                            }
                        } else {
                            if (btn) btn.remove();
                            if (Patens.State?.ui?.cartOpen) Patens.Cart.toggleModal();
                        }

                        if (Patens.State?.ui?.cartOpen) Patens.Cart.renderModalContents(cart);
                    });
                } catch (err) {
                    Logger.error("Uncaught exception in renderUI:", err);
                }
            },

            toggleModal: () => {
                let modal = document.getElementById('cc-cart-modal');
                Patens.State = Patens.State || {ui: {}};
                Patens.State.ui = Patens.State.ui || {};

                if (Patens.State.ui.cartOpen && modal) {
                    modal.remove();
                    Patens.State.ui.cartOpen = false;
                } else {
                    modal = h('div', {
                        id: 'cc-cart-modal',
                        class: 'cc-cart-modal',
                        style: 'position: fixed; z-index: 2147483647;'
                    });
                    document.body.appendChild(modal);
                    Patens.State.ui.cartOpen = true;
                    Patens.Cart.renderUI();
                }
            },

            renderModalContents: (cart) => {
                const modal = document.getElementById('cc-cart-modal');
                if (!modal) return;

                modal.textContent = '';

                let tooltip = document.getElementById('cc-cart-tooltip') || (() => {
                    const tt = h('div', {
                        id: 'cc-cart-tooltip',
                        class: 'cc-cart-tooltip',
                        style: 'z-index: 2147483647;'
                    });
                    document.body.appendChild(tt);
                    return tt;
                })();

                // Header with Title + "Clear All" + Minimize
                const header = h('div', {class: 'cc-cart-header'},
                    h('div', {style: 'display: flex; align-items: center; gap: 10px;'},
                        h('span', {}, 'Context Cart'),
                        cart.length > 0 ? h('span', {
                            class: 'cc-cart-clear-btn',
                            style: 'font-size: 11px; color: #f28b82; cursor: pointer; opacity: 0.8; transition: all 0.2s; font-weight: 500;',
                            onclick: (e) => Patens.Cart.handleClearAll(e.target, tooltip)
                        }, 'Clear All') : null
                    ),
                    h('span', {
                        style: 'cursor: pointer; padding: 0 4px;',
                        onclick: () => document.getElementById('cc-cart-btn')?.click()
                    }, '_')
                );

                const itemsContainer = h('div', {class: 'cc-cart-items'},
                    ...cart.map(itemData => h('div', {
                            class: 'cc-cart-item',
                            onmouseenter: (e) => Patens.Cart.showTooltip(itemData, e.currentTarget, tooltip, modal),
                            onmouseleave: () => tooltip.classList.remove('cc-tooltip-visible')
                        },
                        h('div', {
                            class: 'cc-item-remove',
                            onclick: (e) => {
                                e.stopPropagation();
                                tooltip.classList.remove('cc-tooltip-visible');
                                const updatedCart = cart.filter(i => i.id !== itemData.id);
                                chrome.storage.local.set({contextCart: updatedCart}, () => Patens.Cart.renderUI());
                            }
                        }, '✕'),
                        h('div', {class: 'cc-item-source'}, itemData.title),
                        h('div', {class: 'cc-item-text'}, itemData.content)
                    ))
                );

                const footer = h('div', {class: 'cc-cart-footer'},
                    h('button', {
                        id: 'cc-send-all',
                        class: 'cc-send-btn',
                        onclick: async (e) => Patens.Cart.handleCheckout(e.target, cart, tooltip)
                    }, '✨ Send All to Local Memory')
                );

                modal.appendChild(header);
                modal.appendChild(itemsContainer);
                modal.appendChild(footer);
            },

            showTooltip: (itemData, itemEl, tooltip, modal) => {
                tooltip.textContent = '';
                if (itemData.type === 'image') {
                    tooltip.appendChild(h('img', {src: itemData.media}));
                } else {
                    tooltip.textContent = itemData.content.length > 256
                        ? itemData.content.substring(0, 256) + '...'
                        : itemData.content;
                }
                const rect = itemEl.getBoundingClientRect();
                tooltip.style.right = `${window.innerWidth - modal.getBoundingClientRect().left + 15}px`;
                tooltip.style.top = `${Math.min(rect.top, window.innerHeight - 260)}px`;
                tooltip.classList.add('cc-tooltip-visible');
            },

            // Inline 2-Step Safe Clear Handler
            handleClearAll: (btnEl, tooltip) => {
                if (btnEl.dataset.confirming === "true") {
                    tooltip?.classList.remove('cc-tooltip-visible');
                    chrome.storage.local.set({contextCart: []}, () => {
                        Logger.info("Context cart cleared.");
                        Patens.Cart.renderUI();
                    });
                } else {
                    btnEl.dataset.confirming = "true";
                    btnEl.textContent = "Confirm Clear?";
                    btnEl.style.color = "#ff5252";
                    btnEl.style.fontWeight = "bold";

                    clearTimeout(btnEl._confirmTimeout);
                    btnEl._confirmTimeout = setTimeout(() => {
                        if (btnEl && document.contains(btnEl)) {
                            btnEl.dataset.confirming = "false";
                            btnEl.textContent = "Clear All";
                            btnEl.style.color = "#f28b82";
                            btnEl.style.fontWeight = "500";
                        }
                    }, 3000);
                }
            },

            handleCheckout: async (btn, cart, tooltip) => {
                btn.textContent = "Sending...";
                btn.disabled = true;

                try {
                    const response = await Patens.API?.ingestBatch(cart);

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
                        clipText += `> 📏 **Total Size:** ~${totalTokens} tokens\n> 📂 Available instantly in your IDE via \`@\` or \`#\` in the \`_context/\` folder.`;

                        try {
                            await navigator.clipboard.writeText(clipText);
                        } catch (e) {
                        }
                        setTimeout(() => chrome.storage.local.set({contextCart: []}, () => Patens.Cart.renderUI()), 1000);
                    } else {
                        btn.textContent = "❌ Failed to send";
                        btn.style.background = "#8B0000";
                        btn.disabled = false;
                    }
                } catch (err) {
                    Logger.error("Error during checkout:", err);
                    btn.textContent = "❌ Failed to send";
                    btn.style.background = "#8B0000";
                    btn.disabled = false;
                }
            },

            saveBulkToCartDirectly: async (itemsToSave, eventX, eventY) => {
                if (!Array.isArray(itemsToSave) || itemsToSave.length === 0) return;

                try {
                    const result = await chrome.storage.local.get(['contextCart']);
                    let cart = result.contextCart || [];
                    let addedCount = 0;
                    let duplicateCount = 0;

                    itemsToSave.forEach(item => {
                        const contentToHash = item.isImage ? item.base64Data : item.text;
                        const itemHash = Patens.Utils?.fastHash(contentToHash).toString();

                        if (!cart.some(cartItem => cartItem.hash === itemHash)) {
                            cart.push({
                                id: Date.now().toString() + Math.random().toString().slice(2, 6),
                                hash: itemHash,
                                type: item.isImage ? 'image' : 'text',
                                url: window.location.href,
                                title: item.title,
                                content: item.text,
                                media: item.base64Data
                            });
                            addedCount++;
                            if (item.element) {
                                item.element.classList.add('cc-added-flash');
                                setTimeout(() => item.element.classList.remove('cc-added-flash'), 600);
                            }
                        } else {
                            duplicateCount++;
                        }
                    });

                    if (addedCount > 0) {
                        await chrome.storage.local.set({contextCart: cart});
                        Patens.Cart.renderUI();
                    }

                    if (addedCount > 0 && duplicateCount === 0) Patens.Utils?.showNotification(`✨ Saved ${addedCount} items`, '#10b981', eventX, eventY);
                    else if (addedCount > 0 && duplicateCount > 0) Patens.Utils?.showNotification(`✨ Saved ${addedCount} items (${duplicateCount} duplicates)`, '#f59e0b', eventX, eventY);
                    else if (addedCount === 0) Patens.Utils?.showNotification(`Already in cart`, '#ff5252', eventX, eventY);

                } catch (e) {
                    Logger.error("Failed bulk save to cart:", e);
                }
            }
        };
    }
})();