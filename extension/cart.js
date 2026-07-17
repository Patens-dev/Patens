function renderUI() {
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
                btn.onclick = toggleModal;
                document.body.appendChild(btn);
            }
            document.getElementById('cc-badge').innerText = cart.length;
        } else {
            if (btn) btn.remove();
            if (cartOpen) toggleModal();
        }

        if (cartOpen) renderModalContents(cart);
    });
}

function toggleModal() {
    let modal = document.getElementById('cc-cart-modal');
    if (cartOpen && modal) {
        modal.remove();
        cartOpen = false;
    } else {
        modal = document.createElement('div');
        modal.id = 'cc-cart-modal';
        modal.className = 'cc-cart-modal';
        modal.style.position = 'fixed';
        modal.style.zIndex = '2147483647';
        document.body.appendChild(modal);
        cartOpen = true;
        renderUI();
    }
}

function renderModalContents(cart) {
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

        chrome.runtime.sendMessage({action: "ingest_batch", payload: cart}, (response) => {
            if (response?.success) {
                btn.innerText = "✓ Saved!";
                btn.style.background = "#006400";
                tooltip.classList.remove('cc-tooltip-visible');
                setTimeout(() => chrome.storage.local.set({contextCart: []}), 1000);
            } else {
                btn.innerText = "❌ Failed to send";
                btn.style.background = "#8B0000";
                btn.disabled = false;
            }
        });
    };
}