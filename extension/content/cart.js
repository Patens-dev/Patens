// extension/content/cart.js

(() => {
    window.Patens = window.Patens || {};
    const Logger = Patens.LoggerFactory ? Patens.LoggerFactory("[Patens CartUI]") : console;
    const h = Patens.h;

    if (!window._patensCartLoaded) {
        window._patensCartLoaded = true;

        Logger.info("Cart UI module loaded and initialized.");

        const injectCustomStyles = () => {
            if (document.getElementById('cc-cart-custom-styles')) return;
            const style = document.createElement('style');
            style.id = 'cc-cart-custom-styles';
            style.textContent = `
                .cc-cart-items {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
                }
                .cc-cart-items::-webkit-scrollbar { width: 5px; }
                .cc-cart-items::-webkit-scrollbar-track { background: transparent; }
                .cc-cart-items::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.18);
                    border-radius: 6px;
                    transition: background 0.2s ease;
                }
                .cc-cart-items::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.35); }
                .cc-cart-items::-webkit-scrollbar-button { display: none !important; }
                @keyframes ccSlideUp {
                    from { opacity: 0; transform: translateY(8px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes ccPulseError {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
                    50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
                }
                .cc-cart-error-pulse {
                    animation: ccPulseError 2s infinite ease-in-out;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        };

        injectCustomStyles();

        const RING_RADIUS = 22;
        const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

        const createSvgElement = (tag, attrs = {}) => {
            const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
            for (const [key, value] of Object.entries(attrs)) {
                el.setAttribute(key, value);
            }
            return el;
        };

        const createBrandSvgIcon = () => {
            const svg = createSvgElement('svg', {
                width: '24',
                height: '24',
                viewBox: '0 0 24 24',
                fill: 'none',
                style: 'z-index: 2; pointer-events: none;'
            });
            const rect = createSvgElement('rect', {
                x: '3',
                y: '3',
                width: '18',
                height: '18',
                rx: '5',
                fill: '#6366f1'
            });
            const path = createSvgElement('path', {
                d: 'M8 7h5a3 3 0 0 1 0 6H8V7zm0 6h4a3 3 0 0 1 0 6H8v-6z',
                fill: '#ffffff',
                'fill-rule': 'evenodd'
            });
            svg.appendChild(rect);
            svg.appendChild(path);
            return svg;
        };

        // ==========================================
        // CART COMPONENT
        // ==========================================
        Patens.Cart = {
            FORGIVING_WINDOW_MS: 40000,
            _timerEnd: 0,
            _countdownInterval: null,
            _isWindowActive: false,
            _isPaused: false,
            _isError: false,
            _isRetrying: false,
            _lastError: null,
            _tempIdToDbId: new Map(),
            _pendingCancelledTempIds: new Set(),

            renderUI: () => {
                try {
                    injectCustomStyles();
                    chrome.storage.local.get(['contextCart', 'contextCartTimerEnd', 'contextCartPaused'], (result) => {
                        if (chrome.runtime.lastError) return;
                        const cart = result.contextCart || [];
                        const timerEnd = result.contextCartTimerEnd || 0;
                        const isPaused = !!result.contextCartPaused;
                        Patens.Cart.syncUIWithStorage(cart, timerEnd, isPaused);
                    });
                } catch (err) {
                    Logger.error("Uncaught exception in renderUI:", err);
                }
            },

            syncUIWithStorage: (cart, timerEnd, isPaused = false) => {
                const now = Date.now();
                let btn = document.getElementById('cc-cart-btn');

                if (cart.length > 0 && (isPaused || timerEnd > now || Patens.Cart._isError)) {
                    if (!btn) {
                        btn = Patens.Cart.createCartButton(cart.length);
                        document.body.appendChild(btn);
                    } else {
                        const badge = document.getElementById('cc-badge');
                        if (badge) badge.textContent = cart.length;
                    }

                    Patens.Cart._isPaused = isPaused;

                    if (Patens.Cart._isError) {
                        Patens.Cart.cancelCountdownTimer();
                        const ring = document.getElementById('cc-progress-ring');
                        const badge = document.getElementById('cc-badge');
                        if (ring) {
                            ring.setAttribute('stroke-dashoffset', '0');
                            ring.setAttribute('stroke', '#ef4444');
                        }
                        if (badge) badge.style.background = '#ef4444';
                        if (btn) {
                            btn.classList.add('cc-cart-error-pulse');
                            btn.title = `⚠️ Server offline! ${cart.length} item(s) pending sync. Click to retry.`;
                        }
                    } else if (isPaused) {
                        Patens.Cart.cancelCountdownTimer();
                        Patens.Cart._isWindowActive = true;
                        const ring = document.getElementById('cc-progress-ring');
                        const badge = document.getElementById('cc-badge');
                        if (ring) {
                            ring.setAttribute('stroke-dashoffset', '0');
                            ring.setAttribute('stroke', '#f59e0b');
                        }
                        if (badge) badge.style.background = '#10b981';
                        if (btn) btn.classList.remove('cc-cart-error-pulse');
                    } else {
                        Patens.Cart._timerEnd = timerEnd;
                        Patens.Cart.startCountdownRing(timerEnd);
                        const badge = document.getElementById('cc-badge');
                        if (badge) badge.style.background = '#10b981';
                        if (btn) btn.classList.remove('cc-cart-error-pulse');
                    }

                    if (Patens.State?.ui?.cartOpen) {
                        Patens.Cart.renderModalContents(cart);
                    }
                } else {
                    if (btn) btn.remove();
                    Patens.Cart.cancelCountdownTimer();
                    Patens.Cart._isError = false;

                    if (Patens.State?.ui?.cartOpen) {
                        Patens.Cart.toggleModal();
                    }

                    if (!isPaused && timerEnd > 0 && timerEnd <= now) {
                        chrome.storage.local.set({contextCart: [], contextCartTimerEnd: 0, contextCartPaused: false});
                    }
                }
            },

            createCartButton: (itemCount) => {
                const isErr = Patens.Cart._isError;
                const btn = h('div', {
                    id: 'cc-cart-btn',
                    class: `cc-cart-btn ${isErr ? 'cc-cart-error-pulse' : ''}`,
                    style: `
                        position: fixed;
                        bottom: 24px;
                        right: 24px;
                        width: 52px;
                        height: 52px;
                        border-radius: 50%;
                        background: #18181b;
                        border: 1px solid ${isErr ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.12)'};
                        color: #ffffff;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                        z-index: 2147483647;
                        user-select: none;
                        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
                    `,
                    onclick: Patens.Cart.toggleModal
                });

                const iconUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
                    ? chrome.runtime.getURL('extension/assets/icon48.png')
                    : 'extension/assets/icon48.png';

                const iconEl = h('img', {
                    src: iconUrl,
                    alt: 'Patens',
                    style: 'width: 24px; height: 24px; border-radius: 6px; z-index: 2; pointer-events: none; object-fit: contain;',
                    onerror: (e) => {
                        const fallbackUrl = chrome.runtime?.getURL ? chrome.runtime.getURL('extension/assets/icon32.png') : null;
                        if (fallbackUrl && e.target.src !== fallbackUrl) {
                            e.target.src = fallbackUrl;
                        } else {
                            e.target.replaceWith(createBrandSvgIcon());
                        }
                    }
                });

                const badge = h('div', {
                    class: 'cc-cart-badge',
                    id: 'cc-badge',
                    style: `
                        position: absolute;
                        top: -3px;
                        right: -3px;
                        background: ${isErr ? '#ef4444' : '#10b981'};
                        color: #ffffff;
                        font-size: 11px;
                        font-weight: 700;
                        padding: 1px 6px;
                        border-radius: 12px;
                        border: 2px solid #18181b;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                        z-index: 3;
                    `
                }, itemCount);

                const svg = createSvgElement('svg', {
                    id: 'cc-progress-svg',
                    width: '52',
                    height: '52',
                    viewBox: '0 0 52 52',
                    style: 'position: absolute; top: -1px; left: -1px; pointer-events: none; transform: rotate(-90deg);'
                });

                const track = createSvgElement('circle', {
                    cx: '27',
                    cy: '27',
                    r: RING_RADIUS,
                    fill: 'none',
                    stroke: isErr ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                    'stroke-width': '3'
                });

                const progress = createSvgElement('circle', {
                    id: 'cc-progress-ring',
                    cx: '27', cy: '27', r: RING_RADIUS, fill: 'none', stroke: isErr ? '#ef4444' : '#10b981', 'stroke-width': '3',
                    'stroke-dasharray': `${RING_CIRCUMFERENCE}`, 'stroke-dashoffset': '0', 'stroke-linecap': 'round',
                    style: 'transition: stroke-dashoffset 0.1s linear, stroke 0.3s ease;'
                });

                svg.appendChild(track);
                svg.appendChild(progress);
                btn.appendChild(svg);
                btn.appendChild(iconEl);
                btn.appendChild(badge);
                return btn;
            },

            startCountdownRing: (targetEndTime) => {
                if (Patens.Cart._countdownInterval) clearInterval(Patens.Cart._countdownInterval);
                Patens.Cart._isWindowActive = true;
                Patens.Cart._isPaused = false;
                Patens.Cart._timerEnd = targetEndTime;

                const updateTick = () => {
                    if (Patens.Cart._isError || Patens.Cart._isPaused) return;

                    const remainingMs = Math.max(0, Patens.Cart._timerEnd - Date.now());
                    const progressFraction = Math.min(1, Math.max(0, remainingMs / Patens.Cart.FORGIVING_WINDOW_MS));
                    const offset = RING_CIRCUMFERENCE * (1 - progressFraction);

                    const ring = document.getElementById('cc-progress-ring');
                    const btn = document.getElementById('cc-cart-btn');
                    const remainingSec = Math.ceil(remainingMs / 1000);

                    if (ring) {
                        ring.setAttribute('stroke-dashoffset', offset);
                        ring.setAttribute('stroke', remainingSec <= 8 ? '#f59e0b' : '#10b981');
                    }
                    if (btn) btn.title = `Saved to memory! ${remainingSec}s left to undo.`;

                    const modalTimer = document.getElementById('cc-modal-timer-text');
                    if (modalTimer) modalTimer.textContent = `${remainingSec}s`;

                    if (remainingMs <= 0) {
                        Patens.Cart.cancelCountdownTimer();
                        chrome.storage.local.set({
                            contextCart: [],
                            contextCartTimerEnd: 0,
                            contextCartPaused: false
                        }, () => {
                            Patens.Cart.renderUI();
                        });
                    }
                };

                updateTick();
                Patens.Cart._countdownInterval = setInterval(updateTick, 100);
            },

            cancelCountdownTimer: () => {
                if (Patens.Cart._countdownInterval) {
                    clearInterval(Patens.Cart._countdownInterval);
                    Patens.Cart._countdownInterval = null;
                }
                Patens.Cart._isWindowActive = false;
                const ring = document.getElementById('cc-progress-ring');
                if (ring && !Patens.Cart._isPaused && !Patens.Cart._isError) {
                    ring.setAttribute('stroke-dashoffset', '0');
                    ring.setAttribute('stroke', '#10b981');
                }
            },

            togglePauseResume: async () => {
                if (Patens.Cart._isError) return;

                if (Patens.Cart._isPaused) {
                    const newTimerEnd = Date.now() + Patens.Cart.FORGIVING_WINDOW_MS;
                    await chrome.storage.local.set({contextCartPaused: false, contextCartTimerEnd: newTimerEnd});
                    Patens.Cart.startCountdownRing(newTimerEnd);
                } else {
                    Patens.Cart.cancelCountdownTimer();
                    Patens.Cart._isPaused = true;
                    Patens.Cart._isWindowActive = true;
                    await chrome.storage.local.set({contextCartPaused: true, contextCartTimerEnd: 0});
                    const ring = document.getElementById('cc-progress-ring');
                    if (ring) {
                        ring.setAttribute('stroke-dashoffset', '0');
                        ring.setAttribute('stroke', '#f59e0b');
                    }
                }
                Patens.Cart.renderUI();
            },

            handleSyncError: (errorMsg) => {
                Patens.Cart._isError = true;
                Patens.Cart._lastError = errorMsg || "Local Patens engine is offline";
                Patens.Cart.cancelCountdownTimer();

                // Auto-pause so items are preserved in storage until server recovers
                chrome.storage.local.set({contextCartPaused: true, contextCartTimerEnd: 0});

                if (Patens.Utils?.showNotification) {
                    Patens.Utils.showNotification(
                        `⚠️ Server Offline: Could not sync to memory`,
                        '#ef4444'
                    );
                }

                Patens.Cart.renderUI();
            },

            retryFailedSync: async () => {
                if (Patens.Cart._isRetrying) return;
                Patens.Cart._isRetrying = true;

                const retryBtn = document.getElementById('cc-retry-sync-btn');
                if (retryBtn) {
                    retryBtn.textContent = 'Retrying...';
                    retryBtn.style.opacity = '0.7';
                }

                try {
                    const result = await chrome.storage.local.get(['contextCart']);
                    const cart = result.contextCart || [];

                    if (cart.length === 0) {
                        Patens.Cart._isError = false;
                        Patens.Cart.renderUI();
                        return;
                    }

                    let ingestResponse = null;
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        const resp = await chrome.runtime.sendMessage({
                            action: "ingest_batch",
                            payload: cart
                        });
                        ingestResponse = resp?.data || resp;
                    } else if (Patens.API?.ingestBatch) {
                        ingestResponse = await Patens.API.ingestBatch(cart);
                    }

                    const isSuccess = ingestResponse && (ingestResponse.success !== false) && (ingestResponse.status !== 'error') && !ingestResponse.error;

                    if (isSuccess) {
                        Patens.Cart._isError = false;
                        Patens.Cart._lastError = null;

                        // Resume standard forgiving timer
                        const newTimerEnd = Date.now() + Patens.Cart.FORGIVING_WINDOW_MS;
                        await chrome.storage.local.set({
                            contextCartPaused: false,
                            contextCartTimerEnd: newTimerEnd
                        });

                        if (Patens.Utils?.showNotification) {
                            Patens.Utils.showNotification('✨ Reconnected & Synced to Memory!', '#10b981');
                        }

                        Patens.Cart.renderUI();
                    } else {
                        throw new Error(ingestResponse?.error || "Server connection refused");
                    }
                } catch (err) {
                    Logger.error("Retry sync failed:", err);
                    if (Patens.Utils?.showNotification) {
                        Patens.Utils.showNotification('❌ Server still unreachable. Is Patens running?', '#ef4444');
                    }
                } finally {
                    Patens.Cart._isRetrying = false;
                    Patens.Cart.renderUI();
                }
            },

            deleteFromMemory: async (itemsToDelete) => {
                if (!itemsToDelete || itemsToDelete.length === 0) return;

                const realIds = [];

                itemsToDelete.forEach(item => {
                    const possibleId = item.db_id || item.server_id || item.id;
                    if (possibleId && !String(possibleId).startsWith('temp_')) {
                        realIds.push(String(possibleId));
                    } else if (String(item.id).startsWith('temp_')) {
                        if (Patens.Cart._tempIdToDbId.has(item.id)) {
                            realIds.push(String(Patens.Cart._tempIdToDbId.get(item.id)));
                        } else {
                            Patens.Cart._pendingCancelledTempIds.add(item.id);
                        }
                    }
                });

                if (realIds.length > 0) {
                    try {
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                            await chrome.runtime.sendMessage({action: "delete_context", ids: realIds});
                        } else if (Patens.API?.fetchProxy) {
                            await Patens.API.fetchProxy(`/api/v1/delete?ids=${encodeURIComponent(realIds.join(','))}`, {method: 'DELETE'});
                        }
                        Logger.info(`Successfully deleted ${realIds.length} item(s) from backend memory.`);
                    } catch (err) {
                        Logger.error("Failed to delete items from backend memory:", err);
                    }
                }
            },

            toggleModal: () => {
                let modal = document.getElementById('cc-cart-modal');
                Patens.State = Patens.State || {ui: {}};
                Patens.State.ui = Patens.State.ui || {};

                if (Patens.State.ui.cartOpen && modal) {
                    modal.remove();
                    Patens.State.ui.cartOpen = false;
                    document.getElementById('cc-cart-tooltip')?.classList.remove('cc-tooltip-visible');
                } else {
                    modal = h('div', {
                        id: 'cc-cart-modal',
                        class: 'cc-cart-modal',
                        style: `
                            position: fixed;
                            bottom: 86px;
                            right: 24px;
                            width: 380px;
                            max-height: 480px;
                            background: #18181b;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            border-radius: 12px;
                            box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
                            z-index: 2147483647;
                            display: flex;
                            flex-direction: column;
                            overflow: hidden;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                            animation: ccSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
                        `
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

                const remainingSec = Math.max(0, Math.ceil((Patens.Cart._timerEnd - Date.now()) / 1000));
                const isPaused = Patens.Cart._isPaused;
                const isErr = Patens.Cart._isError;

                const statusPill = isErr ? h('div', {
                    style: `
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 3px 8px;
                        border-radius: 20px;
                        font-size: 11px;
                        font-weight: 600;
                        background: rgba(239, 68, 68, 0.15);
                        border: 1px solid rgba(239, 68, 68, 0.3);
                        color: #f87171;
                        user-select: none;
                    `
                },
                    h('span', {
                        style: 'width: 6px; height: 6px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444; display: inline-block;'
                    }),
                    h('span', {}, 'Offline')
                ) : h('div', {
                    style: `
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 3px 8px;
                        border-radius: 20px;
                        font-size: 11px;
                        font-weight: 500;
                        background: ${isPaused ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)'};
                        border: 1px solid ${isPaused ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.25)'};
                        color: ${isPaused ? '#fbbf24' : '#34d399'};
                        user-select: none;
                    `
                },
                    h('span', {
                        style: `
                            width: 6px; height: 6px; border-radius: 50%;
                            background: ${isPaused ? '#fbbf24' : '#34d399'};
                            box-shadow: 0 0 8px ${isPaused ? '#fbbf24' : '#34d399'};
                            display: inline-block;
                        `
                    }),
                    h('span', {id: 'cc-modal-timer-text'}, isPaused ? 'Paused' : `${remainingSec}s`),
                    h('button', {
                        title: isPaused ? 'Resume countdown' : 'Pause countdown',
                        style: `
                            background: none; border: none; padding: 0 0 0 2px; margin: 0;
                            cursor: pointer; color: ${isPaused ? '#fbbf24' : '#34d399'};
                            display: flex; align-items: center; font-size: 10px; opacity: 0.85;
                        `,
                        onclick: (e) => {
                            e.stopPropagation();
                            Patens.Cart.togglePauseResume();
                        }
                    }, isPaused ? '▶' : '⏸')
                );

                const header = h('div', {
                        class: 'cc-cart-header',
                        style: 'display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); background: #1c1c20;'
                    },
                    h('div', {style: 'display: flex; align-items: center; gap: 8px;'},
                        h('span', {style: 'font-weight: 600; font-size: 13px; color: #f4f4f5;'}, 'Recent Additions'),
                        statusPill
                    ),
                    h('div', {style: 'display: flex; align-items: center; gap: 10px;'},
                        cart.length > 0 ? h('span', {
                            class: 'cc-cart-clear-btn',
                            style: 'font-size: 11px; color: #f87171; cursor: pointer; opacity: 0.85; font-weight: 500;',
                            onclick: (e) => Patens.Cart.handleClearAll(e.target, tooltip)
                        }, 'Delete all') : null,
                        h('span', {
                            style: 'cursor: pointer; color: #71717a; font-size: 14px; padding: 0 2px;',
                            onclick: () => document.getElementById('cc-cart-btn')?.click()
                        }, '✕')
                    )
                );

                // UX Error Alert Banner when Server Is Unreachable
                const errorBanner = isErr ? h('div', {
                    style: `
                        padding: 8px 12px;
                        background: rgba(239, 68, 68, 0.12);
                        border-bottom: 1px solid rgba(239, 68, 68, 0.25);
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        font-size: 11.5px;
                        color: #fca5a5;
                    `
                },
                    h('div', {style: 'display: flex; align-items: center; gap: 6px; overflow: hidden;'},
                        h('span', {}, '⚠️'),
                        h('span', {style: 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;'},
                            'Local server offline. Ensure Patens is running.'
                        )
                    ),
                    h('button', {
                        id: 'cc-retry-sync-btn',
                        style: `
                            background: #ef4444; border: none; color: #ffffff;
                            padding: 3px 8px; border-radius: 4px; font-size: 10px;
                            font-weight: 600; cursor: pointer; white-space: nowrap;
                        `,
                        onclick: () => Patens.Cart.retryFailedSync()
                    }, 'Retry')
                ) : null;

                const itemsContainer = h('div', {
                        class: 'cc-cart-items',
                        style: 'flex: 1; overflow-y: auto; padding: 8px;'
                    },
                    ...cart.map(itemData => h('div', {
                            class: 'cc-cart-item',
                            style: `
                                padding: 8px 10px; margin-bottom: 4px;
                                background: ${isErr ? 'rgba(239, 68, 68, 0.04)' : 'rgba(255, 255, 255, 0.03)'};
                                border: 1px solid ${isErr ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)'};
                                border-radius: 8px; position: relative; cursor: default;
                            `,
                            onmouseenter: (e) => Patens.Cart.showTooltip(itemData, e.currentTarget, tooltip, modal),
                            onmouseleave: () => tooltip.classList.remove('cc-tooltip-visible')
                        },
                        h('div', {
                            class: 'cc-item-remove',
                            title: 'Remove from list',
                            style: 'position: absolute; right: 8px; top: 8px; font-size: 11px; color: #71717a; cursor: pointer; padding: 2px 4px;',
                            onclick: async (e) => {
                                e.stopPropagation();
                                tooltip.classList.remove('cc-tooltip-visible');

                                Patens.Cart.deleteFromMemory([itemData]);

                                const updatedCart = cart.filter(i => i.id !== itemData.id);
                                const newTimerEnd = updatedCart.length === 0 ? 0 : Patens.Cart._timerEnd;

                                await chrome.storage.local.set({
                                    contextCart: updatedCart,
                                    contextCartTimerEnd: newTimerEnd,
                                    contextCartPaused: updatedCart.length === 0 ? false : Patens.Cart._isPaused
                                });

                                if (Patens.Utils?.showNotification) {
                                    Patens.Utils.showNotification('🗑️ Removed from memory', '#ef4444');
                                }
                            }
                        }, '✕'),
                        h('div', {
                            class: 'cc-item-source',
                            style: 'font-size: 12px; font-weight: 500; color: #e4e4e7; width: calc(100% - 20px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
                        }, itemData.title || 'Untitled snippet'),
                        h('div', {
                            class: 'cc-item-text',
                            style: 'font-size: 11px; color: #a1a1aa; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;'
                        }, itemData.content || '')
                    ))
                );

                const footer = h('div', {
                        class: 'cc-cart-footer',
                        style: 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.08); background: #1c1c20; font-size: 12px;'
                    },
                    h('div', {style: `display: flex; align-items: center; gap: 6px; color: ${isErr ? '#f87171' : '#71717a'};`},
                        h('span', {style: `color: ${isErr ? '#ef4444' : '#34d399'}; font-size: 12px; font-weight: bold;`}, isErr ? '⚠️' : '✓'),
                        h('span', {style: 'font-size: 11px; font-weight: 500;'}, isErr ? 'Pending Sync' : 'Saved to memory')
                    ),
                    h('button', {
                        style: `
                            background: ${isErr ? '#ef4444' : (isPaused ? '#6366f1' : '#27272a')};
                            border: 1px solid ${isErr ? '#dc2626' : (isPaused ? '#4f46e5' : '#3f3f46')};
                            color: #ffffff; font-size: 11px; font-weight: 600;
                            padding: 5px 12px; border-radius: 6px; cursor: pointer;
                            transition: background 0.15s ease;
                        `,
                        onclick: async () => {
                            if (isErr) {
                                await Patens.Cart.retryFailedSync();
                            } else {
                                await chrome.storage.local.set({
                                    contextCart: [],
                                    contextCartTimerEnd: 0,
                                    contextCartPaused: false
                                });
                                Patens.Cart.renderUI();
                            }
                        }
                    }, isErr ? 'Retry Sync' : (isPaused ? 'Commit & Close' : 'Done'))
                );

                modal.appendChild(header);
                if (errorBanner) modal.appendChild(errorBanner);
                modal.appendChild(itemsContainer);
                modal.appendChild(footer);
            },

            showTooltip: (itemData, itemEl, tooltip, modal) => {
                tooltip.textContent = '';
                if (itemData.type === 'image') {
                    tooltip.appendChild(h('img', {
                        src: itemData.media,
                        style: 'max-width: 200px; border-radius: 4px;'
                    }));
                } else {
                    const contentStr = itemData.content || itemData.text || '';
                    tooltip.textContent = contentStr.length > 256
                        ? contentStr.substring(0, 256) + '...'
                        : contentStr;
                }
                const rect = itemEl.getBoundingClientRect();
                tooltip.style.right = `${window.innerWidth - modal.getBoundingClientRect().left + 15}px`;
                tooltip.style.top = `${Math.min(rect.top, window.innerHeight - 260)}px`;
                tooltip.classList.add('cc-tooltip-visible');
            },

            handleClearAll: async (btnEl, tooltip) => {
                if (btnEl.dataset.confirming === "true") {
                    tooltip?.classList.remove('cc-tooltip-visible');
                    Patens.Cart.cancelCountdownTimer();

                    const result = await chrome.storage.local.get(['contextCart']);
                    const cart = result.contextCart || [];

                    Patens.Cart.deleteFromMemory(cart);

                    await chrome.storage.local.set({contextCart: [], contextCartTimerEnd: 0, contextCartPaused: false});
                    Patens.Cart._isError = false;

                    if (Patens.Utils?.showNotification) {
                        Patens.Utils.showNotification('✨ Purged recent items from memory', '#ef4444');
                    }
                } else {
                    btnEl.dataset.confirming = "true";
                    btnEl.textContent = "Confirm delete?";
                    btnEl.style.color = "#ef4444";
                    btnEl.style.fontWeight = "bold";

                    clearTimeout(btnEl._confirmTimeout);
                    btnEl._confirmTimeout = setTimeout(() => {
                        if (btnEl && document.contains(btnEl)) {
                            btnEl.dataset.confirming = "false";
                            btnEl.textContent = "Delete all";
                            btnEl.style.color = "#f87171";
                            btnEl.style.fontWeight = "500";
                        }
                    }, 3000);
                }
            },

            saveBulkToCartDirectly: async (itemsToSave, eventX, eventY) => {
                if (!Array.isArray(itemsToSave) || itemsToSave.length === 0) return;

                try {
                    const result = await chrome.storage.local.get(['contextCart']);
                    let cart = result.contextCart || [];
                    let addedCount = 0;
                    let duplicateCount = 0;
                    const newlyAdded = [];

                    for (let i = 0; i < itemsToSave.length; i++) {
                        const item = itemsToSave[i];
                        const text = item.isImage ? (item.base64Data || '') : (item.text || item.content || '');
                        if (!text.trim()) continue;

                        const itemHash = Patens.Utils?.fastHash
                            ? Patens.Utils.fastHash(text).toString()
                            : (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

                        if (!cart.some(cartItem => cartItem.hash === itemHash)) {
                            const newItem = {
                                id: "temp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                                hash: itemHash,
                                type: item.isImage ? 'image' : 'text',
                                url: item.url || window.location.href,
                                title: item.title || document.title || "Untitled",
                                content: text.trim(),
                                media: item.base64Data || '',
                                created_at: new Date().toISOString()
                            };

                            cart.push(newItem);
                            newlyAdded.push(newItem);
                            addedCount++;

                            if (item.element?.classList) {
                                item.element.classList.add('cc-added-flash');
                                setTimeout(() => item.element.classList.remove('cc-added-flash'), 600);
                            }
                        } else {
                            duplicateCount++;
                        }
                    }

                    if (newlyAdded.length === 0) {
                        if (duplicateCount > 0) {
                            Patens.Utils?.showNotification?.(`Already in memory`, '#ff5252', eventX, eventY);
                        }
                        return;
                    }

                    // 1. INSTANT OPTIMISTIC UI RENDER
                    const newTimerEnd = Date.now() + Patens.Cart.FORGIVING_WINDOW_MS;
                    await chrome.storage.local.set({
                        contextCart: cart,
                        contextCartTimerEnd: newTimerEnd,
                        contextCartPaused: false
                    });

                    Patens.Cart.syncUIWithStorage(cart, newTimerEnd, false);

                    if (addedCount > 0 && duplicateCount === 0) {
                        Patens.Utils?.showNotification?.(`✨ Saved ${addedCount} item(s) to memory`, '#10b981', eventX, eventY);
                    } else if (addedCount > 0 && duplicateCount > 0) {
                        Patens.Utils?.showNotification?.(`✨ Saved ${addedCount} (${duplicateCount} duplicates skipped)`, '#f59e0b', eventX, eventY);
                    }

                    // 2. NON-BLOCKING ASYNC INGEST WITH FAIL-SAFE ERROR RECOVERY
                    (async () => {
                        try {
                            let ingestResponse = null;
                            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                                const resp = await chrome.runtime.sendMessage({
                                    action: "ingest_batch",
                                    payload: newlyAdded
                                });
                                ingestResponse = resp?.data || resp;
                            } else if (Patens.API?.ingestBatch) {
                                ingestResponse = await Patens.API.ingestBatch(newlyAdded);
                            }

                            const isSuccess = ingestResponse && (ingestResponse.success !== false) && (ingestResponse.status !== 'error') && !ingestResponse.error;

                            if (!isSuccess) {
                                const errorDetail = ingestResponse?.error || ingestResponse?.detail || "Local Patens server is unreachable";
                                Patens.Cart.handleSyncError(errorDetail);
                                return;
                            }

                            // On success, clear any previous error state
                            Patens.Cart._isError = false;
                            Patens.Cart._lastError = null;

                            const resultsList = Array.isArray(ingestResponse) ? ingestResponse : (ingestResponse?.data || []);
                            if (Array.isArray(resultsList) && resultsList.length > 0) {
                                const currentStored = await chrome.storage.local.get(['contextCart']);
                                let currentCart = currentStored.contextCart || [];
                                const orphanedServerIds = [];

                                newlyAdded.forEach((item, idx) => {
                                    const res = resultsList[idx];
                                    if (res) {
                                        const serverId = String(res.id || res.data?.id || res.item_id || res._id || '');
                                        if (serverId) {
                                            Patens.Cart._tempIdToDbId.set(item.id, serverId);

                                            if (Patens.Cart._pendingCancelledTempIds.has(item.id)) {
                                                orphanedServerIds.push(serverId);
                                                Patens.Cart._pendingCancelledTempIds.delete(item.id);
                                            } else {
                                                const match = currentCart.find(c => c.id === item.id);
                                                if (match) {
                                                    match.db_id = serverId;
                                                    match.id = serverId;
                                                }
                                            }
                                        }
                                    }
                                });

                                if (orphanedServerIds.length > 0) {
                                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                                        await chrome.runtime.sendMessage({
                                            action: "delete_context",
                                            ids: orphanedServerIds
                                        });
                                    }
                                }

                                await chrome.storage.local.set({contextCart: currentCart});
                            }
                        } catch (bgErr) {
                            Logger.error("Background ingest failed:", bgErr);
                            Patens.Cart.handleSyncError(bgErr.message || "Connection refused to local Patens engine");
                        }
                    })();

                } catch (e) {
                    Logger.error("Failed instant save to cart/memory:", e);
                }
            }
        };

        // Cross-tab Synchronization
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            if (changes.contextCart || changes.contextCartTimerEnd || changes.contextCartPaused) {
                chrome.storage.local.get(['contextCart', 'contextCartTimerEnd', 'contextCartPaused'], (result) => {
                    const cart = result.contextCart || [];
                    const timerEnd = result.contextCartTimerEnd || 0;
                    const isPaused = !!result.contextCartPaused;
                    Patens.Cart.syncUIWithStorage(cart, timerEnd, isPaused);
                });
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') Patens.Cart.renderUI();
        });
        window.addEventListener('focus', () => Patens.Cart.renderUI());
    }
})();