// ============================================================
// ADMIN — ORDERS PAGE
// ============================================================
// Reads `orders` and `order_items` (see checkout.js's header comment
// for the exact schema) through the normal anon-key client — visibility
// comes from whatever admin RLS policy already exists on those tables
// (checkout.js's comment says one was added alongside orders_setup.sql).
// If that policy checks a different admin flag than public.is_admin()
// from admin_setup.sql, queries below will come back empty rather than
// erroring — see the note in loadOrders() if that happens to you.
//
// Status vocabulary assumed here: pending / preparing / ready /
// completed / cancelled. If orders_setup.sql defined a CHECK constraint
// with different values, update the <select> options in orders.html
// and STATUS_LABELS below to match.

const STATUS_LABELS = {
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

// Statuses that count toward "Needs Action" on the stat row — anything
// not yet finished and not cancelled.
const ACTIVE_STATUSES = ['pending', 'preparing', 'ready'];

let allOrders = [];
let orderItemsByOrder = {}; // { orderId: [items] }
let activeDrawerOrderId = null;

document.addEventListener('DOMContentLoaded', async function () {
    const admin = await requireAdminOrRedirect();
    if (!admin) return;

    const emailEl = document.getElementById('adminSidebarEmail');
    if (emailEl) emailEl.textContent = admin.email;

    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogOut);
    initFilters();
    initDrawer();
    await loadOrders();
});

function showOrdersError(message) {
    const el = document.getElementById('ordersError');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${message}</span>`;
    el.hidden = false;
}

// --------------------------------------------
// Load
// --------------------------------------------
async function loadOrders() {
    const tbody = document.getElementById('ordersTableBody');

    const { data, error } = await supabaseClient
        .from('orders')
        .select('id, user_id, fulfillment_type, address, contact_phone, subtotal, total_price, status, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error(error);
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="6">Couldn\u2019t load orders — ${escapeHtml(error.message || '')}</td></tr>`;
        // Zero rows AND an actual error (vs. just "no orders yet") most
        // often means the admin RLS policy on `orders` doesn't recognize
        // this account as an admin — e.g. it checks a different column
        // than public.is_admin(). Surface that possibility directly
        // rather than leaving a silent empty table.
        if (/row-level security|permission denied/i.test(error.message || '')) {
            showOrdersError('Orders table denied this read — check that its admin RLS policy (in orders_setup.sql) uses the same public.is_admin() helper as admin_setup.sql.');
        }
        return;
    }

    allOrders = data || [];

    const { data: items, error: itemsError } = await supabaseClient
        .from('order_items')
        .select('order_id, product_id, product_name, unit_price, quantity, line_total')
        .in('order_id', allOrders.map(o => o.id));

    if (itemsError) {
        console.error(itemsError);
    } else {
        orderItemsByOrder = {};
        (items || []).forEach(item => {
            (orderItemsByOrder[item.order_id] || (orderItemsByOrder[item.order_id] = [])).push(item);
        });
    }

    renderStats();
    applyFiltersAndRender();
}

// --------------------------------------------
// Stats
// --------------------------------------------
function renderStats() {
    const now = new Date();
    const todayStr = localDateString(now);

    const needsAction = allOrders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
    const today = allOrders.filter(o => o.created_at && localDateString(new Date(o.created_at)) === todayStr).length;
    const revenue = allOrders
        .filter(o => o.status === 'completed')
        .reduce((sum, o) => sum + Number(o.total_price || 0), 0);

    setText('statTotalOrders', allOrders.length);
    setText('statPendingOrders', needsAction);
    setText('statTodayOrders', today);
    setText('statRevenue', formatPHP(revenue));
}

// Local (not UTC) date string — see the booking-flow timezone notes;
// same fix applied here from the start.
function localDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --------------------------------------------
// Filters + table
// --------------------------------------------
function initFilters() {
    document.getElementById('orderSearchInput').addEventListener('input', applyFiltersAndRender);
    document.getElementById('orderStatusFilter').addEventListener('change', applyFiltersAndRender);
    document.getElementById('orderFulfillmentFilter').addEventListener('change', applyFiltersAndRender);
}

function applyFiltersAndRender() {
    const q = document.getElementById('orderSearchInput').value.trim().toLowerCase();
    const statusFilter = document.getElementById('orderStatusFilter').value;
    const fulfillmentFilter = document.getElementById('orderFulfillmentFilter').value;

    const filtered = allOrders.filter(o => {
        if (statusFilter && o.status !== statusFilter) return false;
        if (fulfillmentFilter && o.fulfillment_type !== fulfillmentFilter) return false;
        if (q) {
            const haystack = `${o.id} ${o.contact_phone || ''}`.toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });

    renderTable(filtered);
}

function renderTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    document.getElementById('orderResultsCount').textContent = `${orders.length} of ${allOrders.length}`;

    if (!orders.length) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="6">No orders match those filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(o => {
        const itemCount = (orderItemsByOrder[o.id] || []).reduce((sum, i) => sum + i.quantity, 0);
        return `
            <tr data-id="${o.id}">
                <td>
                    <span class="admin-table-name">#${o.id.slice(0, 8).toUpperCase()}</span>
                    <span>${itemCount} item${itemCount === 1 ? '' : 's'}</span>
                </td>
                <td>${o.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup'}</td>
                <td>${formatPHP(o.total_price)}</td>
                <td>${statusBadge(o.status)}</td>
                <td>${formatDateTime(o.created_at)}</td>
                <td style="text-align:right;"><i class="fas fa-chevron-right" aria-hidden="true" style="color:var(--dim);"></i></td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', function () { openDrawer(row.dataset.id); });
    });
}

function statusBadge(status) {
    const label = STATUS_LABELS[status] || status || 'Unknown';
    return `<span class="admin-badge admin-badge--${escapeHtml(status || 'unknown')}">${escapeHtml(label)}</span>`;
}

// --------------------------------------------
// Drawer
// --------------------------------------------
function initDrawer() {
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
    document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    document.getElementById('drawerStatusSaveBtn').addEventListener('click', saveOrderStatus);
}

function openDrawer(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    activeDrawerOrderId = orderId;

    const badgeEl = document.getElementById('drawerOrderBadge');
    badgeEl.className = `admin-badge admin-badge--${order.status || 'unknown'}`;
    badgeEl.textContent = STATUS_LABELS[order.status] || order.status || 'Unknown';

    setText('drawerOrderId', `Order #${order.id.slice(0, 8).toUpperCase()}`);
    setText('drawerOrderPlaced', `Placed ${formatDateTime(order.created_at)}`);
    setText('drawerOrderTotal', formatPHP(order.total_price));

    const items = orderItemsByOrder[order.id] || [];
    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    setText('drawerOrderItemCount', itemCount);

    setText('drawerFulfillment', order.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup at Studio');
    const addressEl = document.getElementById('drawerAddress');
    if (order.fulfillment_type === 'delivery' && order.address) {
        addressEl.textContent = order.address;
        addressEl.hidden = false;
    } else {
        addressEl.hidden = true;
    }

    setText('drawerContactPhone', order.contact_phone || '\u2014');

    const notesSection = document.getElementById('drawerNotesSection');
    if (order.notes) {
        setText('drawerNotes', order.notes);
        notesSection.hidden = false;
    } else {
        notesSection.hidden = true;
    }

    document.getElementById('drawerItemsList').innerHTML = items.map(item => `
        <div class="admin-order-item-row">
            <span>${item.quantity}\u00d7 ${escapeHtml(item.product_name)}</span>
            <span>${formatPHP(item.line_total)}</span>
        </div>
    `).join('') || '<p class="admin-drawer-dim">No line items found for this order.</p>';

    document.getElementById('drawerStatusSelect').value = order.status || 'pending';
    setText('drawerStatusSaveResult', '');

    document.getElementById('drawerBackdrop').hidden = false;
    document.getElementById('orderDrawer').hidden = false;
}

function closeDrawer() {
    document.getElementById('drawerBackdrop').hidden = true;
    document.getElementById('orderDrawer').hidden = true;
    activeDrawerOrderId = null;
}

async function saveOrderStatus() {
    if (!activeDrawerOrderId) return;

    const select = document.getElementById('drawerStatusSelect');
    const btn = document.getElementById('drawerStatusSaveBtn');
    const result = document.getElementById('drawerStatusSaveResult');
    const newStatus = select.value;

    btn.disabled = true;
    btn.textContent = 'Saving...';

    const { error } = await supabaseClient
        .from('orders')
        .update({ status: newStatus })
        .eq('id', activeDrawerOrderId);

    btn.disabled = false;
    btn.textContent = 'Save Status';

    if (error) {
        result.style.color = 'var(--bad)';
        result.textContent = error.message || 'Could not update status.';
        return;
    }

    result.style.color = 'var(--good)';
    result.textContent = 'Saved.';

    const order = allOrders.find(o => o.id === activeDrawerOrderId);
    if (order) order.status = newStatus;
    renderStats();
    applyFiltersAndRender();
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatPHP(amount) {
    return 'PHP ' + Number(amount || 0).toLocaleString('en-PH');
}

function formatDateTime(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}