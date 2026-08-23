// ============================================
// MY ORDERS PAGE
// ============================================
// Login-gated the same way cart.html/checkout.html are. isLoggedIn() /
// getCurrentUser() / authReadyPromise come from ../js/main.js.
//
// Reads `orders` + `order_items` for the signed-in visitor. RLS on
// `orders` (from orders_setup.sql) already restricts SELECT to rows
// where user_id = auth.uid(), so the .eq('user_id', ...) filter below
// isn't strictly required to keep other people's orders out — but it's
// kept anyway for clarity and as a second line of defense.
//
// Reads order.customer_name / order.delivery_fee, both added by
// checkout.js's insert — see the ALTER TABLE note at the top of
// checkout.js if those columns don't exist yet. Both are handled as
// optional here (older orders placed before that migration simply
// won't have them).
//
// PAYMENT-RESUME — an order that's still 'awaiting_payment' (customer
// started an online payment but never completed it) shows a "Complete
// Payment" button instead of being a dead end. That calls the
// resume-payment-checkout edge function, which builds a fresh PayMongo
// Checkout Session for the SAME existing order (no new order/order_items
// — those already exist and already reserved stock) and returns a
// checkoutUrl to redirect to.
//
// CARD CLICK — clicking anywhere on a card (other than the pay button)
// opens a detail modal with the full order info. The pay button calls
// stopPropagation() so clicking it doesn't also pop the modal open.

const ORDER_STATUS_LABELS = {
    awaiting_payment: 'Awaiting Payment',
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    out_for_delivery: 'Out for Delivery',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

// Self-service cancellation is only offered while an order hasn't
// started being fulfilled yet. Assumes an RLS policy on `orders` that
// lets a signed-in user UPDATE their own rows to status='cancelled'
// only from one of these starting statuses — see the policy this
// feature ships with:
//
//   create policy "Users can cancel their own pending/awaiting orders"
//   on orders for update
//   using (auth.uid() = user_id and status in ('pending', 'awaiting_payment'))
//   with check (status = 'cancelled');
//
// If that policy isn't in place yet, the cancel button will fail with
// a row-level-security error, which is caught below and surfaced as a
// friendly message rather than a silent failure.
const CANCELLABLE_STATUSES = ['pending', 'awaiting_payment'];

// On top of status, an order that's already been paid online
// (payment_provider set AND payment_status === 'paid') can no longer
// be self-service cancelled, even if it's still sitting in 'pending'
// (which is exactly the status a successful online payment moves it
// to). Cash on Pickup/Delivery orders have no payment_provider at
// all, so they're untouched by this and stay cancellable while
// pending. Mirror this same check server-side in the RLS policy
// (add `and not (payment_provider is not null and payment_status =
// 'paid')` to the USING clause) — the button hiding below is only a
// UX nicety, not the actual enforcement.
function isOrderCancellable(order) {
    if (!CANCELLABLE_STATUSES.includes(order.status)) return false;
    if (order.payment_provider && order.payment_status === 'paid') return false;
    return true;
}

function isPaymentWindowOpen(order) {
    return order.status === 'awaiting_payment'
        && !!order.payment_provider
        && (!order.expires_at || new Date(order.expires_at).getTime() > Date.now());
}

// Kept in module scope so the detail modal (opened from a card click)
// can look up the order + its items without re-querying Supabase.
let myOrdersCache = [];
let myOrderItemsByOrder = {};

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showMyOrdersGate();
        return;
    }

    showMyOrdersContent();
    initOrderDetailModal();
    await loadMyOrders();

    // Keep the gate/content split in sync if auth state changes after
    // load too (e.g. logging out in another tab) — same pattern as
    // cart.js's onAuthStateChange listener.
    if (typeof supabaseClient !== 'undefined') {
        supabaseClient.auth.onAuthStateChange(function () {
            if (!isLoggedIn()) showMyOrdersGate();
        });
    }
});

function showMyOrdersGate() {
    const gate = document.getElementById('myordersGate');
    const content = document.getElementById('myordersContent');
    if (gate) gate.hidden = false;
    if (content) content.hidden = true;
}

function showMyOrdersContent() {
    const gate = document.getElementById('myordersGate');
    const content = document.getElementById('myordersContent');
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
}

// --------------------------------------------
// Load
// --------------------------------------------
async function loadMyOrders() {
    const listEl = document.getElementById('myordersList');
    const emptyEl = document.getElementById('myordersEmpty');
    const user = getCurrentUser();
    if (!listEl || !user || typeof supabaseClient === 'undefined') return;

    listEl.innerHTML = '<p class="myorders-status-text">Loading your orders...</p>';

    const { data: orders, error } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        listEl.innerHTML = `<p class="myorders-status-text">Couldn\u2019t load your orders \u2014 ${escapeHtmlMyOrders(error.message || 'please refresh.')}</p>`;
        return;
    }

    if (!orders || !orders.length) {
        if (emptyEl) emptyEl.hidden = false;
        listEl.innerHTML = '';
        myOrdersCache = [];
        myOrderItemsByOrder = {};
        return;
    }

    if (emptyEl) emptyEl.hidden = true;

    const { data: items, error: itemsError } = await supabaseClient
        .from('order_items')
        .select('order_id, product_name, unit_price, quantity, line_total')
        .in('order_id', orders.map(o => o.id));

    const itemsByOrder = {};
    if (itemsError) {
        console.error(itemsError);
    } else {
        (items || []).forEach(function (item) {
            (itemsByOrder[item.order_id] || (itemsByOrder[item.order_id] = [])).push(item);
        });
    }

    // Cache for the detail modal to read from on click.
    myOrdersCache = orders;
    myOrderItemsByOrder = itemsByOrder;

    listEl.innerHTML = orders.map(function (order) {
        return renderMyOrderCard(order, itemsByOrder[order.id] || []);
    }).join('');

    // Wire up interactions AFTER the HTML actually exists in the DOM.
    initMyOrderCardClicks();
    initMyOrderPayButtons();
    initMyOrderCancelButtons();
}

// --------------------------------------------
// Card click -> open detail modal
// --------------------------------------------
function initMyOrderCardClicks() {
    const listEl = document.getElementById('myordersList');
    if (!listEl) return;

    listEl.querySelectorAll('.myorder-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
            // Ignore clicks on the native <details>/<summary> items
            // toggle and on the pay/cancel buttons — those have their
            // own behavior and shouldn't also pop the modal open.
            if (
                e.target.closest('.myorder-items') ||
                e.target.closest('.myorder-pay-btn') ||
                e.target.closest('.myorder-cancel-btn')
            ) return;

            const order = myOrdersCache.find(o => o.id === card.dataset.id);
            if (order) openOrderDetailModal(order, myOrderItemsByOrder[order.id] || []);
        });
    });
}

// --------------------------------------------
// "Complete Payment" button -> resume-payment-checkout
// --------------------------------------------
function initMyOrderPayButtons() {
    const listEl = document.getElementById('myordersList');
    if (!listEl) return;

    listEl.querySelectorAll('.myorder-pay-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation(); // don't also trigger the card's "view details" click
            handleResumePayment(btn.dataset.orderId, btn);
        });
    });
}

async function handleResumePayment(orderId, btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Redirecting...';

    const { data, error } = await supabaseClient.functions.invoke('resume-payment-checkout', {
        body: { orderId: orderId }
    });

    if (error || !data || data.error || !data.checkoutUrl) {
        alert((data && data.error) || 'Could not resume payment. Please try again.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-credit-card" aria-hidden="true"></i> Complete Payment';
        return;
    }

    window.location.href = data.checkoutUrl;
}

// --------------------------------------------
// "Cancel Order" button -> self-service cancel for pending/
// awaiting_payment orders only. Same recipe as myappointments.js's
// handleCancelAppointment(): RLS-guarded UPDATE, .select() so a
// silently-blocked policy (zero rows matched, error: null) is treated
// as a failure instead of a false success.
// --------------------------------------------
function initMyOrderCancelButtons() {
    const listEl = document.getElementById('myordersList');
    if (!listEl) return;

    listEl.querySelectorAll('.myorder-cancel-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            handleCancelOrder(btn.dataset.orderId, btn);
        });
    });
}

// Returns true on a successful cancel, false otherwise — callers that
// also need to close a modal (see the modal's cancel button above)
// check this before doing so, so a failed/blocked cancel never closes
// the modal out from under the error message.
async function handleCancelOrder(orderId, btn) {
    if (!confirm('Cancel this order? This can\u2019t be undone.')) return false;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Cancelling...';

    const { data, error } = await supabaseClient
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId)
        .select();

    if (error) {
        console.error(error);
        alert(
            /row-level security|permission denied/i.test(error.message || '')
                ? 'Cancelling isn\u2019t enabled for customer accounts yet \u2014 please contact the studio to cancel this order.'
                : (error.message || 'Something went wrong \u2014 please try again.')
        );
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i> Cancel Order';
        return false;
    }

    if (!data || !data.length) {
        // RLS silently matched zero rows — same as a blocked policy,
        // since Postgres never surfaces this as an error on its own.
        alert('Cancelling isn\u2019t enabled for customer accounts yet \u2014 please contact the studio to cancel this order.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i> Cancel Order';
        return false;
    }

    await loadMyOrders(); // re-fetch so status/buttons/modal all update together
    return true;
}

// --------------------------------------------
// Order detail modal
// --------------------------------------------
function initOrderDetailModal() {
    const modal = document.getElementById('orderDetailModal');
    if (!modal) return;

    const backdrop = document.getElementById('orderModalBackdrop');
    const closeBtn = document.getElementById('orderModalClose');

    if (backdrop) backdrop.addEventListener('click', closeOrderDetailModal);
    if (closeBtn) closeBtn.addEventListener('click', closeOrderDetailModal);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) closeOrderDetailModal();
    });
}

function openOrderDetailModal(order, items) {
    const modal = document.getElementById('orderDetailModal');
    if (!modal) return;

    setTextMyOrders('orderModalId', `Order #${order.id.slice(0, 8).toUpperCase()}`);

    const statusEl = document.getElementById('orderModalStatus');
    if (statusEl) {
        statusEl.textContent = ORDER_STATUS_LABELS[order.status] || order.status || 'Unknown';
        statusEl.className = `myorder-status myorder-status-${order.status || 'pending'}`;
    }

    setTextMyOrders('orderModalDate', `Placed ${formatDateMyOrders(order.created_at)}`);
    setTextMyOrders(
        'orderModalFulfillment',
        order.fulfillment_type === 'delivery'
            ? `Delivery \u2014 ${order.address || '\u2014'}`
            : 'Pickup at Studio'
    );
    setTextMyOrders('orderModalContact', order.contact_phone || '\u2014');
    setTextMyOrders('orderModalTotal', formatPHPMyOrders(order.total_price));

    const paymentEl = document.getElementById('orderModalPayment');
    if (paymentEl) {
        if (order.payment_provider) {
            paymentEl.hidden = false;
            paymentEl.textContent = order.payment_status === 'paid'
                ? `Paid online via ${order.payment_provider}${order.paid_at ? ' on ' + formatDateMyOrders(order.paid_at) : ''}`
                : isPaymentWindowOpen(order)
                    ? `Awaiting online payment via ${order.payment_provider}`
                    : 'Payment window expired';
        } else {
            paymentEl.hidden = true;
        }
    }

    const notesWrap = document.getElementById('orderModalNotesWrap');
    if (notesWrap) {
        if (order.notes) {
            setTextMyOrders('orderModalNotes', order.notes);
            notesWrap.hidden = false;
        } else {
            notesWrap.hidden = true;
        }
    }

    const itemsEl = document.getElementById('orderModalItems');
    if (itemsEl) {
        itemsEl.innerHTML = items.length
            ? items.map(function (item) {
                return `
                    <div class="myorder-item-row">
                        <span>${item.quantity}\u00d7 ${escapeHtmlMyOrders(item.product_name)}</span>
                        <span>${formatPHPMyOrders(item.line_total)}</span>
                    </div>
                `;
            }).join('')
            : '<p class="myorders-status-text myorder-items-empty">No items found for this order.</p>';
    }

    // "Complete Payment" also lives inside the modal, so it's reachable
    // even after someone's already opened the detail view.
    const modalPayWrap = document.getElementById('orderModalPayWrap');
    const modalPayBtn = document.getElementById('orderModalPayBtn');
    if (modalPayWrap && modalPayBtn) {
        if (isPaymentWindowOpen(order)) {
            modalPayWrap.hidden = false;
            modalPayBtn.dataset.orderId = order.id;
            modalPayBtn.disabled = false;
            modalPayBtn.innerHTML = '<i class="fas fa-credit-card" aria-hidden="true"></i> Complete Payment';
            modalPayBtn.onclick = function () { handleResumePayment(order.id, modalPayBtn); };
        } else {
            modalPayWrap.hidden = true;
        }
    }

    // Same idea for "Cancel Order" inside the modal.
    const modalCancelWrap = document.getElementById('orderModalCancelWrap');
    const modalCancelBtn = document.getElementById('orderModalCancelBtn');
    if (modalCancelWrap && modalCancelBtn) {
        if (isOrderCancellable(order)) {
            modalCancelWrap.hidden = false;
            modalCancelBtn.dataset.orderId = order.id;
            modalCancelBtn.disabled = false;
            modalCancelBtn.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i> Cancel Order';
            modalCancelBtn.onclick = function () {
                handleCancelOrder(order.id, modalCancelBtn).then(function (succeeded) {
                    if (succeeded) closeOrderDetailModal();
                });
            };
        } else {
            modalCancelWrap.hidden = true;
        }
    }

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeOrderDetailModal() {
    const modal = document.getElementById('orderDetailModal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
}

// --------------------------------------------
// Render one order card
// --------------------------------------------
function renderMyOrderCard(order, items) {
    const fulfillmentLine = order.fulfillment_type === 'delivery'
        ? `<span><i class="fas fa-truck" aria-hidden="true"></i> Delivery \u2014 ${escapeHtmlMyOrders(order.address || '\u2014')}</span>`
        : `<span><i class="fas fa-store" aria-hidden="true"></i> Pickup at Studio</span>`;

    const contactLine = order.contact_phone
        ? `<span><i class="fas fa-phone" aria-hidden="true"></i> ${escapeHtmlMyOrders(order.contact_phone)}</span>`
        : '';

    const itemsBody = items.length
        ? items.map(function (item) {
            return `
                <div class="myorder-item-row">
                    <span>${item.quantity}\u00d7 ${escapeHtmlMyOrders(item.product_name)}</span>
                    <span>${formatPHPMyOrders(item.line_total)}</span>
                </div>
            `;
        }).join('')
        : '<p class="myorders-status-text myorder-items-empty">No line items found for this order.</p>';

    const hasDeliveryFee = order.delivery_fee !== null && order.delivery_fee !== undefined && Number(order.delivery_fee) > 0;
    const deliveryFeeRow = hasDeliveryFee
        ? `<div class="myorder-total-row"><span>Delivery Fee</span><span>${formatPHPMyOrders(order.delivery_fee)}</span></div>`
        : '';

    const notesBlock = order.notes
        ? `<div class="myorder-card-notes"><i class="fas fa-note-sticky" aria-hidden="true"></i> <span>${escapeHtmlMyOrders(order.notes)}</span></div>`
        : '';

    // "Complete Payment" only ever shows for an order that's still
    // waiting on an online payment that was actually started
    // (payment_provider set) — never for Cash on Pickup/Delivery
    // orders, which don't have a payment_provider at all.
    const showPayBtn = isPaymentWindowOpen(order);
    const showCancelBtn = isOrderCancellable(order);
    const paymentExpiryBlock = order.status === 'awaiting_payment' && order.payment_provider && !isPaymentWindowOpen(order)
        ? '<div class="myorder-card-notes"><i class="fas fa-clock" aria-hidden="true"></i> Payment window expired — place the order again.</div>'
        : '';

    const footerButtons = [
        showCancelBtn
            ? `<button type="button" class="myorder-cancel-btn" data-order-id="${order.id}">
                   <i class="fas fa-xmark" aria-hidden="true"></i> Cancel Order
               </button>`
            : '',
        showPayBtn
            ? `<button type="button" class="myorder-pay-btn" data-order-id="${order.id}">
                   <i class="fas fa-credit-card" aria-hidden="true"></i> Complete Payment
               </button>`
            : ''
    ].join('');

    const resumePaymentBlock = (showPayBtn || showCancelBtn)
        ? `<div class="myorder-card-footer">${footerButtons}</div>`
        : '';

    const itemCount = items.reduce((sum, i) => sum + (i.quantity || 0), 0);

    return `
        <div class="myorder-card" data-id="${order.id}" role="button" tabindex="0">
            <div class="myorder-card-header">
                <div>
                    <span class="myorder-card-id">Order #${order.id.slice(0, 8).toUpperCase()}</span>
                    <span class="myorder-card-date">Placed ${formatDateMyOrders(order.created_at)}</span>
                </div>
                <span class="myorder-status myorder-status-${order.status || 'pending'}">${ORDER_STATUS_LABELS[order.status] || order.status || 'Unknown'}</span>
            </div>

            <div class="myorder-card-meta">
                ${fulfillmentLine}
                ${contactLine}
            </div>

            <details class="myorder-items">
                <summary>${itemCount} item${itemCount === 1 ? '' : 's'}</summary>
                <div class="myorder-items-body">${itemsBody}</div>
            </details>

            <div class="myorder-card-totals">
                <div class="myorder-total-row"><span>Subtotal</span><span>${formatPHPMyOrders(order.subtotal)}</span></div>
                ${deliveryFeeRow}
                <div class="myorder-total-row myorder-total-row--grand"><span>Total</span><span>${formatPHPMyOrders(order.total_price)}</span></div>
            </div>

            ${notesBlock}
            ${paymentExpiryBlock}
            ${resumePaymentBlock}
        </div>
    `;
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function formatPHPMyOrders(amount) {
    return 'PHP ' + Number(amount || 0).toLocaleString('en-PH');
}

function formatDateMyOrders(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtmlMyOrders(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function setTextMyOrders(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}