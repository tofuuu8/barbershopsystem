// ============================================
// CART PAGE
// ============================================
// isLoggedIn() / initCartCounter() / migrateLocalCartToSupabase() come
// from main.js, which is loaded on this page before cart.js. Cart data
// itself lives in the Supabase `cart_items` table (see
// cart_items_migration.sql) — RLS scopes every row to auth.uid(), so
// this file only ever sees the signed-in visitor's own items.

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

function formatPHP(amount) {
    const value = Number(amount);
    return 'PHP ' + (Number.isFinite(value) ? value : 0).toLocaleString('en-PH');
}

// Reads the signed-in visitor's cart straight from Supabase. RLS already
// restricts this to their own rows, so there's no user filter to add
// client-side.
async function getCart() {
    if (typeof supabaseClient === 'undefined' || !isLoggedIn()) return [];

    const { data, error } = await supabaseClient
        .from('cart_items')
        .select('product_id, name, price, quantity')
        .order('created_at', { ascending: true });

    if (error) {
        console.warn('Could not load cart:', error.message);
        return [];
    }

    return (data || []).map(row => ({
        id: row.product_id,
        name: row.name,
        price: Number(row.price),
        quantity: row.quantity
    }));
}

// Deletes every cart_items row for the signed-in visitor in one request —
// used by checkout.js after an order is successfully placed. There's no
// "overwrite the whole cart" operation against Supabase the way
// localStorage's saveCart([]) used to provide (only per-item
// add/update/delete), but a full clear is the one bulk operation
// checkout actually needs, so this replaces that old call directly.
async function clearCart() {
    if (typeof supabaseClient === 'undefined' || typeof isLoggedIn !== 'function' || !isLoggedIn()) return;

    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user) return;

    // RLS already scopes deletes to the caller's own rows on its own;
    // the explicit .eq is kept too since PostgREST rejects a delete with
    // no filter at all, as a guard against accidental full-table wipes.
    const { error } = await supabaseClient.from('cart_items').delete().eq('user_id', user.id);

    if (error) {
        console.warn('Could not clear cart:', error.message);
        return;
    }

    if (typeof initCartCounter === 'function') initCartCounter();
}

async function renderCartPage() {
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

    const cart = await getCart();
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

// Updates one line item's quantity by `delta` (+1/-1), deleting the row
// once quantity reaches zero rather than storing a zero-quantity row —
// that keeps cart_items a true "what's actually in the cart" table.
//
// This does a read-then-write (fetch the current quantity, then set the
// new one), which is fine for a single visitor clicking their own +/-
// buttons in one tab, but — unlike addToCart()'s add_to_cart RPC — it
// isn't race-proof against two simultaneous writers (e.g. the same
// account open in two tabs at once). Worth moving to a similar RPC if
// that scenario turns out to matter in practice.
async function updateItemQuantity(id, delta) {
    if (typeof supabaseClient === 'undefined' || !isLoggedIn()) return;

    const cart = await getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;

    const newQuantity = item.quantity + delta;

    // Instant feedback the click registered, before the request resolves
    // (design system's "active/pressed" rule) — the row dims and its
    // qty/remove buttons disable so a second click can't race the first.
    const row = document.querySelector(`.cart-item[data-id="${cssEscape(id)}"]`);
    if (row) {
        row.classList.add('is-updating');
        row.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }

    const { error } = newQuantity <= 0
        ? await supabaseClient.from('cart_items').delete().eq('product_id', id)
        : await supabaseClient.from('cart_items').update({ quantity: newQuantity }).eq('product_id', id);

    if (error) {
        console.warn('Could not update cart item:', error.message);
        alert("Couldn't update that item — please try again.");
        if (row) {
            row.classList.remove('is-updating');
            row.querySelectorAll('button').forEach(btn => btn.disabled = false);
        }
        return;
    }

    if (typeof initCartCounter === 'function') initCartCounter();
    renderCartPage();
}

async function removeItem(id) {
    if (typeof supabaseClient === 'undefined' || !isLoggedIn()) return;

    const row = document.querySelector(`.cart-item[data-id="${cssEscape(id)}"]`);
    if (row) {
        row.classList.add('is-updating');
        row.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }

    const { error } = await supabaseClient.from('cart_items').delete().eq('product_id', id);

    if (error) {
        console.warn('Could not remove cart item:', error.message);
        alert("Couldn't remove that item — please try again.");
        if (row) {
            row.classList.remove('is-updating');
            row.querySelectorAll('button').forEach(btn => btn.disabled = false);
        }
        return;
    }

    if (typeof initCartCounter === 'function') initCartCounter();
    renderCartPage();
}

// Minimal CSS.escape fallback for the data-id attribute selector above —
// product ids in this catalog are plain slugs, but this keeps the
// selector safe if that ever changes.
function cssEscape(value) {
    return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/["\\\]]/g, '\\$&');
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

    // Sweep any leftover localStorage cart (from before the Supabase
    // migration) in before the first render, so someone who added items
    // under the old system sees them here instead of an empty cart.
    if (typeof migrateLocalCartToSupabase === 'function') {
        await migrateLocalCartToSupabase();
    }

    await renderCartPage();
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