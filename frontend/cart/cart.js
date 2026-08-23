// ============================================
// CART PAGE
// ============================================
// isLoggedIn() / addToCart() / initCartCounter() come from main.js,
// which is loaded on this page before cart.js.

// Root-relative photo lookup for the sample catalog so cart rows show a
// real thumbnail instead of a bare placeholder. Anything not listed here
// (or any path that 404s) falls back to a placeholder automatically.
const cartProductImages = {
    'wax-fox-matte': '../images/products/matte-wax.jpg',
    'wax-atlas-natural': '../images/products/natural-wax.jpg',
    'wax-premium': '../images/products/premium-wax.jpg',
    'spray-fox-matte': '../images/products/matte-spray.jpg',
    'spray-atlas-volume': '../images/products/volume-spray.jpg',
    'spray-premium-hold': '../images/products/premium-hold-spray.jpg',
    // Homepage teaser grid uses separate ids for the same products
    'latest-matte-wax': '../images/products/matte-wax.jpg',
    'latest-natural-wax': '../images/products/natural-wax.jpg',
    'latest-matte-spray': '../images/products/matte-spray.jpg'
};

function normalizeCart(items) {
    if (!Array.isArray(items)) return [];

    const byId = new Map();
    items.forEach(function (item) {
        const id = String(item && item.id || '').trim();
        const name = String(item && item.name || '').trim();
        const price = Number(item && item.price);
        const quantity = item && item.quantity;
        if (!id || !name || !Number.isFinite(price) || price < 0 || typeof quantity !== 'number'
            || !Number.isInteger(quantity) || quantity <= 0) return;

        const existing = byId.get(id);
        if (existing) existing.quantity += quantity;
        else byId.set(id, { id, name, price, quantity });
    });
    return [...byId.values()];
}

function getCart() {
    try {
        return normalizeCart(JSON.parse(localStorage.getItem('toughcuts_cart') || '[]'));
    } catch (e) {
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem('toughcuts_cart', JSON.stringify(normalizeCart(cart)));
    if (typeof initCartCounter === 'function') initCartCounter();
}

function formatPHP(amount) {
    const value = Number(amount);
    return 'PHP ' + (Number.isFinite(value) ? value : 0).toLocaleString('en-PH');
}

function renderCartPage() {
    const gate = document.getElementById('cartGate');
    const content = document.getElementById('cartContent');
    if (!gate || !content) return;

    // Signed-out visitors never see cart contents — just the login/signup gate.
    if (typeof isLoggedIn !== 'function' || !isLoggedIn()) {
        gate.hidden = false;
        content.hidden = true;
        return;
    }

    gate.hidden = true;
    content.hidden = false;

    const cart = getCart();
    const empty = document.getElementById('cartEmpty');
    const layout = document.getElementById('cartLayout');
    const itemsWrap = document.getElementById('cartItems');
    const subtotalEl = document.getElementById('cartSubtotal');

    if (!cart.length) {
        empty.hidden = false;
        layout.hidden = true;
        return;
    }

    empty.hidden = true;
    layout.hidden = false;

    let subtotal = 0;
    itemsWrap.innerHTML = cart.map(function (item) {
        const lineTotal = item.price * item.quantity;
        subtotal += lineTotal;
        const image = cartProductImages[item.id];
        const safeId = escapeHtml(item.id);
        const safeName = escapeHtml(item.name);

        return `
            <div class="cart-item" data-id="${safeId}">
                <div class="cart-item-image">
                    <img src="${image || ''}" alt="${safeName}" loading="lazy"
                         onerror="this.src='https://placehold.co/160x160/232323/666?text=Item'" />
                </div>
                <div class="cart-item-info">
                    <h3>${safeName}</h3>
                    <p class="cart-item-price">${formatPHP(item.price)} each</p>
                    <div class="cart-item-qty">
                        <button type="button" class="cart-qty-decrease" aria-label="Decrease quantity">
                            <i class="fas fa-minus" aria-hidden="true"></i>
                        </button>
                        <span>${item.quantity}</span>
                        <button type="button" class="cart-qty-increase" aria-label="Increase quantity">
                            <i class="fas fa-plus" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                <div class="cart-item-aside">
                    <span class="cart-item-total">${formatPHP(lineTotal)}</span>
                    <button type="button" class="cart-item-remove" aria-label="Remove ${safeName} from cart">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    subtotalEl.textContent = formatPHP(subtotal);
}

function updateItemQuantity(id, delta) {
    let cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        cart = cart.filter(i => i.id !== id);
    }

    saveCart(cart);
    renderCartPage();
}

function removeItem(id) {
    const cart = getCart().filter(i => i.id !== id);
    saveCart(cart);
    renderCartPage();
}

function initCartItemActions() {
    const itemsWrap = document.getElementById('cartItems');
    if (!itemsWrap) return;

    itemsWrap.addEventListener('click', function (e) {
        const row = e.target.closest('.cart-item');
        if (!row) return;
        const id = row.dataset.id;

        if (e.target.closest('.cart-qty-increase')) {
            updateItemQuantity(id, 1);
        } else if (e.target.closest('.cart-qty-decrease')) {
            updateItemQuantity(id, -1);
        } else if (e.target.closest('.cart-item-remove')) {
            removeItem(id);
        }
    });
}

function initCheckoutButton() {
    const btn = document.getElementById('cartCheckoutBtn');
    if (!btn) return;

    // Hands off to checkout.html — see checkout.js for the actual
    // pickup/delivery + order-placement flow.
    btn.addEventListener('click', function () {
        window.location.href = '../checkout/checkout.html';
    });
}

// main.js's DOMContentLoaded listener is registered first (cart.html
// loads main.js before cart.js) and already awaits authReadyPromise
// before doing anything auth-dependent. This listener needs to do the
// same — otherwise renderCartPage() can run before Supabase has
// finished restoring the session from storage and show the signed-out
// gate to someone who's actually logged in. See the comment on
// authReadyPromise in main.js for the full explanation.
document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;
    renderCartPage();
    initCartItemActions();
    initCheckoutButton();

    // Keep the cart gate/content in sync if auth state changes after
    // load too (e.g. logging out in another tab).
    if (typeof supabaseClient !== 'undefined') {
        supabaseClient.auth.onAuthStateChange(function () {
            renderCartPage();
        });
    }
});