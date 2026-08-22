// ============================================
// CHECKOUT PAGE
// ============================================
// Login-gated the same way cart.html is. isLoggedIn() / getCurrentUser() /
// authReadyPromise / getRedirectParam() come from js/main.js. getCart() /
// saveCart() / formatPHP() / cartProductImages come from cart.js, loaded
// right before this file (see checkout.html) purely for those helpers —
// cart.js's own DOMContentLoaded handler no-ops harmlessly here since
// none of #cartGate/#cartContent/#cartItems/#cartCheckoutBtn exist on
// this page.
//
// Cash on Delivery / studio pickup only — no payment integration.
// Writes one row to `orders` and one row per cart line to `order_items`.
// Run orders_setup.sql once in the Supabase SQL Editor if this table
// doesn't exist yet. In short, it creates:
//
//   public.orders (id, user_id, fulfillment_type, address, contact_phone,
//                   subtotal, total_price, status, notes,
//                   created_at, updated_at)
//   public.order_items (id, order_id, product_id, product_name,
//                        unit_price, quantity, line_total)
//
// with RLS so a customer can only insert/select their own orders (and
// an is_admin policy already in place for a future admin Orders page).
//
// This file also writes `customer_name` (text) and `delivery_fee`
// (numeric, default 0) on `orders` — run once in the Supabase SQL
// Editor if those columns don't exist yet:
//
//   ALTER TABLE public.orders
//     ADD COLUMN IF NOT EXISTS customer_name text,
//     ADD COLUMN IF NOT EXISTS delivery_fee numeric DEFAULT 0;

// --------------------------------------------
// STATE
// --------------------------------------------
let currentFulfillment = 'pickup'; // 'pickup' | 'delivery'

// Address needs to be more than just "not blank" — matches booking.js's
// MIN_ADDRESS_LENGTH for the same reason (a couple of characters isn't
// an address a rider could deliver to).
const MIN_ADDRESS_LENGTH = 10;

// A couple characters isn't a real name either.
const MIN_NAME_LENGTH = 2;

// PLACEHOLDER — flat delivery fee until real rate/zone logic exists.
// Swap this for a computed value (by distance, weight, zone, etc.)
// whenever that logic is ready; every place it's used below just reads
// this constant, so nothing else needs to change.
const DELIVERY_FEE = 100;

// Same loose phone check booking.js/account.js use, so all three stay
// consistent for the visitor.
function isValidCheckoutPhone(phone) {
    return /^[0-9+()\-.\s]{7,20}$/.test(phone);
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showCheckoutGate();
        return;
    }

    showCheckoutContent();

    if (!getCart().length) {
        showEmptyCart();
        return;
    }

    initFulfillmentToggle();
    initNotesCounter();
    initCheckoutForm();
    renderSummaryItems();
    await initContactFields();
    updateSummaryTotals();

    // Keep the gate/content split in sync if auth state changes after
    // load too (e.g. logging out in another tab) — same pattern as
    // cart.js's onAuthStateChange listener.
    if (typeof supabaseClient !== 'undefined') {
        supabaseClient.auth.onAuthStateChange(function () {
            if (!isLoggedIn()) showCheckoutGate();
        });
    }
});

function showCheckoutGate() {
    const gate = document.getElementById('checkoutGate');
    const content = document.getElementById('checkoutContent');
    if (gate) gate.hidden = false;
    if (content) content.hidden = true;
}

function showCheckoutContent() {
    const gate = document.getElementById('checkoutGate');
    const content = document.getElementById('checkoutContent');
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
}

function showEmptyCart() {
    const empty = document.getElementById('checkoutEmpty');
    const formWrap = document.getElementById('checkoutFormWrap');
    if (empty) empty.hidden = false;
    if (formWrap) formWrap.hidden = true;
}

// ============================================
// FULFILLMENT TOGGLE (Pickup / Delivery)
// ============================================
function applyFulfillmentToUI() {
    document.querySelectorAll('.checkout-fulfillment-btn').forEach(function (btn) {
        const active = btn.dataset.fulfillment === currentFulfillment;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    const pickupInfo = document.getElementById('checkoutPickupInfo');
    const deliveryFields = document.getElementById('checkoutDeliveryFields');
    if (pickupInfo) pickupInfo.hidden = currentFulfillment !== 'pickup';
    if (deliveryFields) deliveryFields.hidden = currentFulfillment !== 'delivery';
}

function initFulfillmentToggle() {
    document.querySelectorAll('.checkout-fulfillment-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            currentFulfillment = this.dataset.fulfillment;
            applyFulfillmentToUI();
            updateSummaryTotals();
        });
    });
    applyFulfillmentToUI();
}

// ============================================
// CONTACT FIELDS — prefill from profiles.phone / profiles.address
// ============================================
async function initContactFields() {
    const nameInput = document.getElementById('checkoutNameInput');
    const nameNote = document.getElementById('checkoutNameNote');
    const phoneInput = document.getElementById('checkoutPhoneInput');
    const phoneNote = document.getElementById('checkoutPhoneNote');
    const addressInput = document.getElementById('checkoutAddressInput');
    const addressNote = document.getElementById('checkoutAddressNote');

    nameInput && nameInput.addEventListener('input', updateSummaryTotals);
    phoneInput && phoneInput.addEventListener('input', updateSummaryTotals);
    addressInput && addressInput.addEventListener('input', updateSummaryTotals);

    const user = getCurrentUser();
    if (!user || typeof supabaseClient === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('full_name, phone, address')
        .eq('id', user.id)
        .maybeSingle();

    if (error || !data) {
        if (nameNote) nameNote.hidden = false;
        if (phoneNote) phoneNote.hidden = false;
        if (addressNote) addressNote.hidden = false;
        return;
    }

    if (data.full_name && nameInput) {
        nameInput.value = data.full_name;
    } else if (nameNote) {
        nameNote.hidden = false;
    }

    if (data.phone && phoneInput) {
        phoneInput.value = data.phone;
    } else if (phoneNote) {
        phoneNote.hidden = false;
    }

    if (data.address && addressInput) {
        addressInput.value = data.address;
    } else if (addressNote) {
        addressNote.hidden = false;
    }
}

// ============================================
// NOTES CHARACTER COUNTER
// ============================================
function initNotesCounter() {
    const input = document.getElementById('checkoutNotesInput');
    const counter = document.getElementById('checkoutNotesCount');
    if (!input || !counter) return;
    const max = input.getAttribute('maxlength') || 300;
    function update() { counter.textContent = `${input.value.length}/${max}`; }
    input.addEventListener('input', update);
    update();
}

// ============================================
// SUMMARY — items list + totals + validation
// ============================================
function renderSummaryItems() {
    const wrap = document.getElementById('checkoutSummaryItems');
    if (!wrap) return;

    const cart = getCart();
    wrap.innerHTML = cart.map(function (item) {
        const image = (typeof cartProductImages !== 'undefined' && cartProductImages[item.id]) || '';
        const lineTotal = item.price * item.quantity;
        return `
            <div class="checkout-summary-item">
                <div class="checkout-summary-item-image">
                    <img src="${image}" alt="" loading="lazy"
                         onerror="this.src='https://placehold.co/88x88/232323/666?text=Item'" />
                </div>
                <div class="checkout-summary-item-info">
                    <h4>${item.name}</h4>
                    <span>${formatPHP(item.price)} &times; ${item.quantity}</span>
                </div>
                <span class="checkout-summary-item-total">${formatPHP(lineTotal)}</span>
            </div>
        `;
    }).join('');
}

function cartSubtotal() {
    return getCart().reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function currentSelection() {
    const nameInput = document.getElementById('checkoutNameInput');
    const phoneInput = document.getElementById('checkoutPhoneInput');
    const addressInput = document.getElementById('checkoutAddressInput');
    const notesInput = document.getElementById('checkoutNotesInput');

    return {
        name: nameInput ? nameInput.value.trim() : '',
        phone: phoneInput ? phoneInput.value.trim() : '',
        address: addressInput ? addressInput.value.trim() : '',
        notes: notesInput ? notesInput.value : ''
    };
}

// Delivery fee (placeholder — see DELIVERY_FEE) is the only thing that
// separates delivery's total from the subtotal; pickup is just the
// subtotal.
function currentDeliveryFee() {
    return currentFulfillment === 'delivery' ? DELIVERY_FEE : 0;
}

function currentTotal() {
    return cartSubtotal() + currentDeliveryFee();
}

function isSelectionComplete(sel) {
    if (!sel.name || sel.name.length < MIN_NAME_LENGTH) return false;
    if (!sel.phone || !isValidCheckoutPhone(sel.phone)) return false;
    if (currentFulfillment === 'delivery' && sel.address.length < MIN_ADDRESS_LENGTH) return false;
    return true;
}

function updateSummaryTotals() {
    const subtotal = cartSubtotal();
    const deliveryFee = currentDeliveryFee();
    const total = currentTotal();

    setText('checkoutSummarySubtotal', formatPHP(subtotal));
    setText('checkoutSummaryDeliveryFee', formatPHP(deliveryFee));
    setText('checkoutSummaryTotal', formatPHP(total));

    const deliveryFeeRow = document.getElementById('checkoutDeliveryFeeRow');
    if (deliveryFeeRow) deliveryFeeRow.hidden = currentFulfillment !== 'delivery';

    const confirmBtn = document.getElementById('checkoutConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = !isSelectionComplete(currentSelection());
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ============================================
// FORM SUBMISSION
// ============================================
function showCheckoutError(message) {
    const el = document.getElementById('checkoutError');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${message}</span>`;
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideCheckoutError() {
    const el = document.getElementById('checkoutError');
    if (el) el.hidden = true;
}

function initCheckoutForm() {
    const form = document.getElementById('checkoutForm');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideCheckoutError();

        const sel = currentSelection();
        const cart = getCart();

        if (!cart.length) {
            showCheckoutError('Your cart is empty — nothing to check out.');
            return;
        }
        if (!sel.name || sel.name.length < MIN_NAME_LENGTH) {
            showCheckoutError('Please enter your full name.');
            return;
        }
        if (!sel.phone || !isValidCheckoutPhone(sel.phone)) {
            showCheckoutError('Please enter a valid contact number so we can reach you about this order.');
            return;
        }
        if (currentFulfillment === 'delivery' && sel.address.length < MIN_ADDRESS_LENGTH) {
            showCheckoutError('Please enter a complete delivery address.');
            return;
        }

        const user = getCurrentUser();
        if (!user) {
            showCheckoutError('Your session expired — please log in again.');
            return;
        }

        const confirmBtn = document.getElementById('checkoutConfirmBtn');
        const btnText = confirmBtn.querySelector('.checkout-confirm-text');
        const spinner = confirmBtn.querySelector('.checkout-confirm-spinner');
        confirmBtn.disabled = true;
        if (btnText) btnText.textContent = 'Placing Order...';
        if (spinner) spinner.hidden = false;

        const subtotal = cartSubtotal();
        const deliveryFee = currentDeliveryFee();
        const total = currentTotal();

        const { data: order, error: orderError } = await supabaseClient
            .from('orders')
            .insert({
                user_id: user.id,
                customer_name: sel.name,
                fulfillment_type: currentFulfillment,
                address: currentFulfillment === 'delivery' ? sel.address : null,
                contact_phone: sel.phone,
                subtotal: subtotal,
                delivery_fee: deliveryFee,
                total_price: total,
                notes: sel.notes.trim() || null
            })
            .select()
            .single();

        if (orderError) {
            confirmBtn.disabled = false;
            if (btnText) btnText.textContent = 'Place Order';
            if (spinner) spinner.hidden = true;
            console.error(orderError);
            showCheckoutError(
                /row-level security/i.test(orderError.message || '')
                    ? 'The orders table isn\u2019t set up yet — run orders_setup.sql in the Supabase SQL Editor first.'
                    : /column .*(customer_name|delivery_fee)/i.test(orderError.message || '')
                        ? 'The orders table is missing a column — see the ALTER TABLE note at the top of checkout.js.'
                        : (orderError.message || 'Something went wrong. Please try again.')
            );
            return;
        }

        const itemRows = cart.map(function (item) {
            return {
                order_id: order.id,
                product_id: item.id,
                product_name: item.name,
                unit_price: item.price,
                quantity: item.quantity,
                line_total: item.price * item.quantity
            };
        });

        const { error: itemsError } = await supabaseClient
            .from('order_items')
            .insert(itemRows);

        if (itemsError) {
            console.error(itemsError);
            // Don't leave an order with no line items behind — clean it
            // up so the visitor's order history (once it exists) never
            // shows a mystery empty order.
            await supabaseClient.from('orders').delete().eq('id', order.id);

            confirmBtn.disabled = false;
            if (btnText) btnText.textContent = 'Place Order';
            if (spinner) spinner.hidden = true;
            showCheckoutError(
                /column .*order_items|relation .*order_items/i.test(itemsError.message || '')
                    ? 'The order_items table isn\u2019t set up yet — run orders_setup.sql in the Supabase SQL Editor first.'
                    : (itemsError.message || 'Something went wrong saving your order items. Please try again.')
            );
            return;
        }

        // Order fully saved — clear the cart (saveCart() from cart.js
        // also refreshes the header's cart counter) and show the
        // confirmation screen.
        saveCart([]);
        showCheckoutSuccess(order, sel);
    });
}

function showCheckoutSuccess(order, sel) {
    const formWrap = document.getElementById('checkoutFormWrap');
    const success = document.getElementById('checkoutSuccess');
    if (formWrap) formWrap.hidden = true;
    if (success) success.hidden = false;

    setText('checkoutSuccessOrderNumber', order.id.slice(0, 8).toUpperCase());
    setText('checkoutSuccessName', order.customer_name || sel.name);
    setText('checkoutSuccessFulfillment', order.fulfillment_type === 'delivery'
        ? `Delivery — ${order.address}`
        : 'Pickup at Studio');
    setText('checkoutSuccessContact', sel.phone);
    setText('checkoutSuccessTotal', formatPHP(order.total_price));

    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
}