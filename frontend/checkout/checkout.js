// ============================================
// CHECKOUT PAGE
// ============================================
// Login-gated the same way cart.html is. isLoggedIn() / getCurrentUser() /
// authReadyPromise / getRedirectParam() come from js/main.js. getCart() /
// clearCart() / formatPHP() / cartProductImages come from cart.js, loaded
// right before this file (see checkout.html) purely for those helpers —
// cart.js's own DOMContentLoaded handler no-ops harmlessly here since
// none of #cartGate/#cartContent/#cartItems/#cartCheckoutBtn exist on
// this page.
//
// getCart() now reads from Supabase (async) rather than localStorage, so
// this page fetches it once at load into `checkoutCart` and reads that
// local copy everywhere else — see the STATE section below.
//
// Two payment methods now: Cash on Pickup/Delivery (unchanged — writes
// directly to `orders`/`order_items` client-side) and Pay Online via
// PayMongo (calls the create-payment-checkout Edge Function, which does
// all the writing itself server-side — see that function's header
// comment for exactly what it inserts and why). This file never talks
// to PayMongo directly; it only invokes the Edge Function and redirects
// the browser to whatever checkout_url comes back.
//
// Run orders_setup.sql once in the Supabase SQL Editor if `orders`/
// `order_items` don't exist yet. In short, it creates:
//
//   public.orders (id, user_id, fulfillment_type, address, contact_phone,
//                   subtotal, total_price, status, notes,
//                   created_at, updated_at)
//   public.order_items (id, order_id, product_id, product_name,
//                        unit_price, quantity, line_total)
//
// with RLS so a customer can only insert/select their own orders (and
// an is_admin policy already in place for the admin Orders page).
//
// This file also writes `customer_name` (text), `delivery_fee`
// (numeric, default 0), and `area` (text) on `orders` for the Cash on
// Pickup/Delivery path — run once in the Supabase SQL Editor if those
// columns don't exist yet:
//
//   ALTER TABLE public.orders
//     ADD COLUMN IF NOT EXISTS customer_name text,
//     ADD COLUMN IF NOT EXISTS delivery_fee numeric DEFAULT 0,
//     ADD COLUMN IF NOT EXISTS area text;
//
// The online-payment path additionally needs create-payment-checkout
// and paymongo-webhook deployed (see their own header comments), plus
// `payment_status` / `payment_provider` / `payment_reference` /
// `paid_at` on `orders` — per project notes these already exist.

// --------------------------------------------
// STATE
// --------------------------------------------
let currentFulfillment = 'pickup'; // 'pickup' | 'delivery'
let currentPaymentMethod = 'cod'; // 'cod' | 'online'

// cart.js's getCart() now reads from Supabase (async), rather than the
// old synchronous localStorage read — fetched once here at page load
// and cached, since nothing on this page lets a visitor edit cart
// contents/quantities directly (that only happens on cart.html). Every
// place that used to call getCart() synchronously reads this instead.
let checkoutCart = [];

// Address needs to be more than just "not blank" — matches booking.js's
// MIN_ADDRESS_LENGTH for the same reason (a couple of characters isn't
// an address a rider could deliver to).
const MIN_ADDRESS_LENGTH = 10;

// A couple characters isn't a real name either.
const MIN_NAME_LENGTH = 2;

// Mirrors create-payment-checkout/index.ts's SHIPPING_AREAS exactly.
// Duplicated here on purpose (display-only): the online-payment path's
// real charge is whatever the Edge Function recomputes server-side from
// this same table, and the Cash on Pickup/Delivery path stores whatever
// this lookup returns directly — so both payment methods need to agree
// on the same numbers or the total would visibly change when someone
// switches payment method mid-checkout.
const SHIPPING_AREAS = {
    'san isidro': 80,
    'rodriguez': 100,
    'san mateo': 150,
    'marikina': 180,
    'antipolo': 200,
    'cainta': 200,
    'taytay': 220,
    'quezon city': 250
};

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

    // Returning from PayMongo's hosted checkout page. The cart was
    // already cleared before we redirected there (see initCheckoutForm),
    // so this branch owns the whole screen instead of the normal form —
    // there's nothing left in the cart to check out.
    const returnParams = new URLSearchParams(window.location.search);
    const returningOrderId = returnParams.get('order');
    const paymentResult = returnParams.get('payment');

    if (returningOrderId && paymentResult === 'success') {
        await handlePaymentSuccessReturn(returningOrderId);
        return;
    }

    let cancellationSucceeded = null;
    if (returningOrderId && paymentResult === 'cancelled') {
        cancellationSucceeded = await cancelReturnedPaymentOrder(returningOrderId);
    }

    checkoutCart = await getCart();
    if (!checkoutCart.length) {
        showEmptyCart();
        if (paymentResult === 'cancelled') showCancelledEmptyNote(cancellationSucceeded);
        return;
    }

    initFulfillmentToggle();
    initPaymentMethodToggle();
    initAreaField();
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

// Cancelling on PayMongo's page always lands back here with an empty
// cart (it was cleared before the redirect), so the normal empty-cart
// state already shows — this just swaps in copy that explains why,
// instead of the generic "you haven't added anything" message.
async function cancelReturnedPaymentOrder(orderId) {
    const { data, error } = await supabaseClient.rpc('cancel_order_atomic', {
        p_order_id: orderId,
        p_cancel_reason: 'Payment cancelled by customer'
    });
    if (error) {
        const { data: order } = await supabaseClient
            .from('orders')
            .select('status, payment_status')
            .eq('id', orderId)
            .maybeSingle();
        if (order?.status === 'cancelled' && order.payment_status !== 'paid') return true;
        console.error('Could not cancel returned payment order:', error);
        return false;
    }
    return !!data;
}

function showCancelledEmptyNote(cancelled) {
    if (cancelled) {
        setText('checkoutEmptyTitle', 'Payment Cancelled');
        setText('checkoutEmptyText', 'No payment was completed. The order and payment attempt were cancelled. Head back to Products whenever you\u2019re ready to try again.');
    } else {
        setText('checkoutEmptyTitle', 'Payment Status Pending');
        setText('checkoutEmptyText', 'The payment was cancelled, but the order is still being reconciled. Please check My Orders or contact the studio before trying again.');
    }
}

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
    // Scoped to [data-fulfillment] — the payment-method buttons below
    // reuse this same .checkout-fulfillment-btn class for visual
    // consistency but carry a [data-payment] attribute instead, and
    // must not be touched by this toggle.
    document.querySelectorAll('.checkout-fulfillment-btn[data-fulfillment]').forEach(function (btn) {
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
    document.querySelectorAll('.checkout-fulfillment-btn[data-fulfillment]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            currentFulfillment = this.dataset.fulfillment;
            applyFulfillmentToUI();
            updateSummaryTotals();
        });
    });
    applyFulfillmentToUI();
}

// ============================================
// DELIVERY AREA (sets the delivery fee — see SHIPPING_AREAS)
// ============================================
function initAreaField() {
    const areaSelect = document.getElementById('checkoutAreaInput');
    if (areaSelect) areaSelect.addEventListener('change', updateSummaryTotals);
}

// ============================================
// PAYMENT METHOD TOGGLE (Cash on Pickup/Delivery / Pay Online)
// ============================================
function applyPaymentMethodToUI() {
    document.querySelectorAll('.checkout-payment-btn').forEach(function (btn) {
        const active = btn.dataset.payment === currentPaymentMethod;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    const isOnline = currentPaymentMethod === 'online';

    const note = document.getElementById('checkoutPaymentNote');
    if (note) {
        note.textContent = isOnline
            ? 'You\u2019ll be sent to a secure PayMongo page to pay via GCash, Maya, GrabPay, or card.'
            : 'You\u2019ll pay in cash when your order is ready or delivered.';
    }

    const summaryNote = document.getElementById('checkoutSummaryNote');
    if (summaryNote) {
        summaryNote.textContent = isOnline
            ? 'Secure online payment via PayMongo \u2014 nothing is charged until you complete it there.'
            : 'Cash on hand at pickup or delivery \u2014 no online payment needed.';
    }

    const confirmText = document.querySelector('.checkout-confirm-text');
    if (confirmText) confirmText.textContent = isOnline ? 'Continue to Payment' : 'Place Order';
}

function initPaymentMethodToggle() {
    document.querySelectorAll('.checkout-payment-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            currentPaymentMethod = this.dataset.payment;
            applyPaymentMethodToUI();
        });
    });
    applyPaymentMethodToUI();
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
        .select('full_name, phone, address, saved_addresses, default_fulfillment_type')
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

    const savedAddresses = Array.isArray(data.saved_addresses)
        ? data.saved_addresses.map(value => typeof value === 'string' ? value : (value && value.address) || '').filter(Boolean)
        : [];
    if (data.address && addressInput) {
        addressInput.value = data.address;
    } else if (savedAddresses[0] && addressInput) {
        addressInput.value = savedAddresses[0];
    } else if (addressNote) {
        addressNote.hidden = false;
    }

    if (data.default_fulfillment_type === 'delivery') {
        currentFulfillment = 'delivery';
        applyFulfillmentToUI();
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

    const cart = checkoutCart;
    wrap.innerHTML = cart.map(function (item) {
        const image = (typeof cartProductImages !== 'undefined' && cartProductImages[item.id]) || '';
        const safeName = escapeHtml(item.name);
        const lineTotal = item.price * item.quantity;
        return `
            <div class="checkout-summary-item">
                <div class="checkout-summary-item-image">
                    <img src="${image}" alt="${safeName}" loading="lazy"
                         onerror="this.src='https://placehold.co/88x88/232323/666?text=Item'" />
                </div>
                <div class="checkout-summary-item-info">
                    <h4>${safeName}</h4>
                    <span>${formatPHP(item.price)} &times; ${item.quantity}</span>
                </div>
                <span class="checkout-summary-item-total">${formatPHP(lineTotal)}</span>
            </div>
        `;
    }).join('');
}

function cartSubtotal() {
    return checkoutCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function currentSelection() {
    const nameInput = document.getElementById('checkoutNameInput');
    const phoneInput = document.getElementById('checkoutPhoneInput');
    const areaSelect = document.getElementById('checkoutAreaInput');
    const addressInput = document.getElementById('checkoutAddressInput');
    const notesInput = document.getElementById('checkoutNotesInput');

    return {
        name: nameInput ? nameInput.value.trim() : '',
        phone: phoneInput ? phoneInput.value.trim() : '',
        area: areaSelect ? areaSelect.value : '',
        address: addressInput ? addressInput.value.trim() : '',
        notes: notesInput ? notesInput.value : '',
        paymentMethod: currentPaymentMethod
    };
}

// Delivery fee comes from SHIPPING_AREAS, keyed by the selected area —
// pickup (and delivery with no area chosen yet) is just the subtotal.
function currentDeliveryFee() {
    if (currentFulfillment !== 'delivery') return 0;
    const areaSelect = document.getElementById('checkoutAreaInput');
    const area = areaSelect ? areaSelect.value : '';
    return SHIPPING_AREAS[area] || 0;
}

function currentTotal() {
    return cartSubtotal() + currentDeliveryFee();
}

// UX guard only: the database/RPC must still recalculate prices and enforce
// stock atomically when the order is created. This refresh catches products
// that sold out after they were added to localStorage and prevents stale or
// manually inflated quantities from reaching the normal order flow.
async function checkCartAvailability(cart) {
    if (typeof supabaseClient === 'undefined') {
        return { ok: false, message: 'We could not verify product availability. Please refresh and try again.' };
    }

    // Local storage is only a shopping-list cache. Aggregate duplicate IDs and
    // reject malformed quantities before reading the authoritative catalog.
    const requestedById = new Map();
    for (const item of cart) {
        const productId = String(item && item.id || '').trim();
        const rawQuantity = item && item.quantity;
        const quantity = rawQuantity;
        if (!productId || typeof rawQuantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
            return { ok: false, message: 'Your cart contains an invalid quantity. Please return to the Products page.' };
        }
        requestedById.set(productId, (requestedById.get(productId) || 0) + quantity);
    }

    const productIds = [...requestedById.keys()];
    if (!productIds.length) {
        return { ok: false, message: 'Your cart contains an invalid product. Please return to the Products page.' };
    }

    const { data, error } = await supabaseClient
        .from('products')
        .select('id, name, price, stock_quantity, is_active')
        .in('id', productIds);

    if (error) {
        console.error('Could not verify checkout stock:', error);
        return { ok: false, message: 'We could not verify product availability. Please refresh and try again.' };
    }

    const productsById = new Map((data || []).map(product => [String(product.id), product]));
    const verifiedItems = [];
    for (const [productId, quantity] of requestedById) {
        const product = productsById.get(productId);
        const stock = Number(product && product.stock_quantity);
        const price = Number(product && product.price);
        const name = String(product && product.name || 'This product');

        if (!product || product.is_active === false || !Number.isInteger(stock) || stock <= 0) {
            return { ok: false, message: `${name} is currently out of stock.` };
        }
        if (!Number.isFinite(price) || price < 0) {
            return { ok: false, message: `${name} has an invalid price. Please contact the shop.` };
        }
        if (quantity > stock) {
            return { ok: false, message: `Only ${stock} ${stock === 1 ? 'unit is' : 'units are'} available for ${name}.` };
        }

        // These values are deliberately taken from Supabase, not localStorage,
        // so cash checkout cannot be completed with a forged price or name.
        verifiedItems.push({ id: productId, name, price, quantity });
    }

    return { ok: true, items: verifiedItems };
}

function isSelectionComplete(sel) {
    if (!sel.name || sel.name.length < MIN_NAME_LENGTH) return false;
    if (!sel.phone || !isValidCheckoutPhone(sel.phone)) return false;
    if (currentFulfillment === 'delivery') {
        if (!sel.area || !(sel.area in SHIPPING_AREAS)) return false;
        if (sel.address.length < MIN_ADDRESS_LENGTH) return false;
    }
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

    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message || 'Something went wrong. Please try again.');
    el.replaceChildren(icon, text);
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
        const cart = checkoutCart;

        if (!cart.length) {
            showCheckoutError('Your cart is empty — nothing to check out.');
            return;
        }

        const availability = await checkCartAvailability(cart);
        if (!availability.ok) {
            showCheckoutError(availability.message);
            return;
        }
        const verifiedCart = availability.items;

        if (!sel.name || sel.name.length < MIN_NAME_LENGTH) {
            showCheckoutError('Please enter your full name.');
            return;
        }
        if (!sel.phone || !isValidCheckoutPhone(sel.phone)) {
            showCheckoutError('Please enter a valid contact number so we can reach you about this order.');
            return;
        }
        if (currentFulfillment === 'delivery' && (!sel.area || !(sel.area in SHIPPING_AREAS))) {
            showCheckoutError('Please select your delivery area.');
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
        if (btnText) btnText.textContent = sel.paymentMethod === 'online' ? 'Starting Payment...' : 'Placing Order...';
        if (spinner) spinner.hidden = false;

        if (sel.paymentMethod === 'online') {
            await submitOnlinePayment(sel, verifiedCart, confirmBtn, btnText, spinner);
            return;
        }

        const { data: order, error: orderError } = await supabaseClient.rpc('create_order_atomic', {
            p_customer_name: sel.name,
            p_fulfillment_type: currentFulfillment,
            p_area: currentFulfillment === 'delivery' ? sel.area : null,
            p_address: currentFulfillment === 'delivery' ? sel.address : null,
            p_contact_phone: sel.phone,
            p_notes: sel.notes.trim() || null,
            p_items: verifiedCart.map(function (item) {
                return { product_id: item.id, quantity: item.quantity };
            }),
            p_payment_provider: null
        });

        if (orderError || !order) {
            confirmBtn.disabled = false;
            if (btnText) btnText.textContent = 'Place Order';
            if (spinner) spinner.hidden = true;
            console.error(orderError);
            showCheckoutError(
                /function .*create_order_atomic|does not exist/i.test(orderError?.message || '')
                    ? 'The secure checkout function is not installed yet — run the latest Supabase migrations first.'
                    : /out of stock|unavailable/i.test(orderError?.message || '')
                        ? (orderError.message || 'One or more products are no longer available.')
                        : (orderError?.message || 'Something went wrong. Please try again.')
            );
            return;
        }

        // The server transaction has already recalculated totals, inserted
        // line items, and reserved stock. Only clear the local shopping list
        // after that authoritative operation succeeds.
        await clearCart();
        showCheckoutSuccess(order, sel);
    });
}

// --------------------------------------------
// Online payment — hands the whole order-creation + pricing/stock
// re-check off to create-payment-checkout (server-side, trusted), then
// redirects to PayMongo's hosted checkout page. See that function's
// header comment for exactly what it verifies and inserts.
// --------------------------------------------
async function submitOnlinePayment(sel, cart, confirmBtn, btnText, spinner) {
    const { data, error } = await supabaseClient.functions.invoke('create-payment-checkout', {
        body: {
            items: cart.map(function (item) {
                return { product_id: item.id, quantity: item.quantity };
            }),
            customer_name: sel.name,
            fulfillment_type: currentFulfillment,
            area: currentFulfillment === 'delivery' ? sel.area : undefined,
            address: currentFulfillment === 'delivery' ? sel.address : undefined,
            contact_phone: sel.phone,
            contact_preference: 'phone',
            notes: sel.notes.trim() || undefined
        }
    });

    if (error || !data || data.error) {
        confirmBtn.disabled = false;
        if (btnText) btnText.textContent = 'Continue to Payment';
        if (spinner) spinner.hidden = true;

        // supabase-js only gives a generic message on a non-2xx
        // response by default — the function's real error message is in
        // the response body, reachable via error.context.
        let message = (data && data.error) || 'Could not start online payment. Please try again or choose Cash on Pickup/Delivery.';
        if (error && error.context && typeof error.context.json === 'function') {
            try {
                const body = await error.context.json();
                if (body && body.error) message = body.error;
            } catch (_) {
                // Response body wasn't JSON (or already consumed) — fall
                // back to the generic message above.
            }
        }
        showCheckoutError(message);
        return;
    }

    // The reservation already happened server-side (order_items were
    // inserted before this function returned), so the local cart is
    // spoken for either way now — clear it before leaving for PayMongo
    // rather than after, so a customer who comes straight back can't
    // accidentally create a second reservation for the same items.
    await clearCart();
    window.location.href = data.checkoutUrl;
}

// --------------------------------------------
// Returning from PayMongo — the success_url redirect only proves the
// customer finished PayMongo's flow, not that our webhook has already
// marked the order paid (those can land a moment apart), so this polls
// briefly rather than trusting the redirect alone.
// --------------------------------------------
async function handlePaymentSuccessReturn(orderId) {
    // checkoutFormWrap has no `hidden` attribute by default (it's the
    // normal-case form), so it must be hidden explicitly here — this
    // path never calls initCheckoutForm()/renderSummaryItems() etc. at
    // all, it only ever shows the pending panel or (via
    // showCheckoutSuccess) the success panel.
    const formWrap = document.getElementById('checkoutFormWrap');
    if (formWrap) formWrap.hidden = true;

    const pending = document.getElementById('checkoutPaymentPending');
    if (pending) pending.hidden = false;

    const maxAttempts = 8;
    const delayMs = 1500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { data: order, error } = await supabaseClient
            .from('orders')
            .select('id, customer_name, fulfillment_type, address, contact_phone, total_price, payment_status, status')
            .eq('id', orderId)
            .maybeSingle();

        if (!error && order) {
            if (order.payment_status === 'paid') {
                await clearCart(); // belt-and-suspenders — already cleared before the PayMongo redirect
                if (pending) pending.hidden = true;
                showCheckoutSuccess(order, { phone: order.contact_phone || '', name: order.customer_name || '' });
                return;
            }
            if (order.status === 'cancelled') {
                setText('checkoutPendingTitle', 'Payment Didn\u2019t Go Through');
                setText('checkoutPendingText', 'That payment wasn\u2019t completed, so the order was released \u2014 nothing was charged. Head back to Products to try again.');
                const actions = document.getElementById('checkoutPendingActions');
                if (actions) actions.hidden = false;
                const icon = document.querySelector('#checkoutPaymentPending .checkout-success-icon i');
                if (icon) icon.className = 'fas fa-circle-exclamation';
                return;
            }
        }

        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }

    // Still not confirmed after ~12 seconds. PayMongo only redirects here
    // on a completed checkout, so this reassures rather than implies
    // failure — the webhook will finish the job shortly regardless.
    setText('checkoutPendingTitle', 'Almost There...');
    setText('checkoutPendingText', 'Your payment went through on PayMongo\u2019s side and we\u2019re finishing up the confirmation. Check My Orders in a minute \u2014 you\u2019ll also get a text once it\u2019s ready.');
    const actions = document.getElementById('checkoutPendingActions');
    if (actions) actions.hidden = false;
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