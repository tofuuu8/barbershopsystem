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

const ORDER_STATUS_LABELS = {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showMyOrdersGate();
        return;
    }

    showMyOrdersContent();
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

    listEl.innerHTML = orders.map(function (order) {
        return renderMyOrderCard(order, itemsByOrder[order.id] || []);
    }).join('');
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

    const itemCount = items.reduce((sum, i) => sum + (i.quantity || 0), 0);

    return `
        <div class="myorder-card" data-id="${order.id}">
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