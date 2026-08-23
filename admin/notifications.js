// ============================================================
// ADMIN — NOTIFICATIONS BELL
// ============================================================
// Shared across every admin page (loaded after admin-auth.js, before
// the page's own script) — this is the ONLY place bell content is
// populated, so every page shows the exact same notifications
// regardless of which page you're on. Don't add page-specific
// notification code to individual page scripts (e.g. bookings.js /
// orders.js) — it belongs here instead, so the bell stays consistent
// everywhere.
//
// "Accounts" and "Bookings" are wired to real data (`profiles` /
// `bookings`). "Products" surfaces low/out-of-stock items from
// `products`. "Orders" is wired too — new orders from `orders`, same
// "new within the window" pattern as Bookings/Accounts.

const NOTIF_WINDOW_HOURS = 48; // anything within this window counts as "new" for the bell

let notifAccountCount = 0;
let notifBookingCount = 0;
let notifProductCount = 0;
let notifOrderCount = 0;

document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('notifBtn');
    const panel = document.getElementById('notifPanel');
    if (!btn || !panel) return; // page doesn't have the notif bell

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const isHidden = panel.hidden;
        panel.hidden = !isHidden;
    });

    document.addEventListener('click', function (e) {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
            panel.hidden = true;
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') panel.hidden = true;
    });

    loadAccountNotifications();
    loadBookingNotifications();
    loadProductNotifications();
    loadOrderNotifications();
});

// --------------------------------------------
// Accounts — real data, from `profiles`
// --------------------------------------------
async function loadAccountNotifications() {
    const listEl = document.getElementById('notifAccounts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error(error);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load account notifications.</div>`;
        return;
    }

    const accounts = data || [];
    notifAccountCount = accounts.length;
    refreshNotifBadge();

    if (!accounts.length) {
        listEl.innerHTML = `<div class="admin-notif-empty">No new accounts recently.</div>`;
        return;
    }

    listEl.innerHTML = accounts.map(u => `
        <div class="admin-notif-item">
            <div class="admin-notif-item-icon"><i class="fas fa-user-plus" aria-hidden="true"></i></div>
            <div class="admin-notif-item-body">
                <p>New account: <strong>${escapeHtmlNotif(u.full_name || u.email || 'Unnamed')}</strong></p>
                <span>${timeAgoNotif(u.created_at)}</span>
            </div>
        </div>
    `).join('');
}

// --------------------------------------------
// Bookings — real data, from `bookings`
// --------------------------------------------
async function loadBookingNotifications() {
    const listEl = document.getElementById('notifBookings');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseClient
        .from('bookings')
        .select('id, service_name, barber_name, booking_date, booking_time, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error(error);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load booking notifications.</div>`;
        return;
    }

    const bookings = data || [];
    notifBookingCount = bookings.length;
    refreshNotifBadge();

    if (!bookings.length) {
        listEl.innerHTML = `<div class="admin-notif-empty">No new bookings recently.</div>`;
        return;
    }

    listEl.innerHTML = bookings.map(b => `
        <div class="admin-notif-item">
            <div class="admin-notif-item-icon"><i class="fas fa-calendar-check" aria-hidden="true"></i></div>
            <div class="admin-notif-item-body">
                <p>New booking: <strong>${escapeHtmlNotif(b.service_name || 'Service')}</strong> with ${escapeHtmlNotif(b.barber_name || 'a barber')}</p>
                <span>${timeAgoNotif(b.created_at)}</span>
            </div>
        </div>
    `).join('');
}

// --------------------------------------------
// Products — real data, from `products`. Surfaces low/out-of-stock
// items rather than "new" ones (there's no meaningful "recently
// added" urgency for a product the way there is for a signup or a
// booking) — anything at or under its own low_stock_threshold.
// --------------------------------------------
async function loadProductNotifications() {
    const listEl = document.getElementById('notifProducts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('products')
        .select('id, name, stock_quantity, low_stock_threshold, is_active')
        .eq('is_active', true)
        .order('stock_quantity', { ascending: true })
        .limit(50);

    if (error) {
        // Table may not exist yet on sites that haven't run
        // products_setup.sql — fail quietly rather than showing an
        // alarming error in the bell for something optional.
        listEl.innerHTML = `<div class="admin-notif-empty">No product alerts yet.</div>`;
        return;
    }

    const lowStock = (data || []).filter(p => p.stock_quantity <= (p.low_stock_threshold ?? 5)).slice(0, 5);
    notifProductCount = lowStock.length;
    refreshNotifBadge();

    if (!lowStock.length) {
        listEl.innerHTML = `<div class="admin-notif-empty">All products are well stocked.</div>`;
        return;
    }

    listEl.innerHTML = lowStock.map(p => `
        <div class="admin-notif-item">
            <div class="admin-notif-item-icon"><i class="fas fa-box" aria-hidden="true"></i></div>
            <div class="admin-notif-item-body">
                <p>${p.stock_quantity <= 0 ? 'Out of stock' : 'Low stock'}: <strong>${escapeHtmlNotif(p.name)}</strong></p>
                <span>${p.stock_quantity} left</span>
            </div>
        </div>
    `).join('');
}

// --------------------------------------------
// Orders — real data, from `orders`. Same "new within the window"
// pattern as Accounts/Bookings — recent checkouts staff should know
// about. Skips 'awaiting_payment' orders (nothing to act on until a
// customer actually pays or it gets auto-cancelled) so the bell only
// surfaces orders that genuinely need attention.
// --------------------------------------------
async function loadOrderNotifications() {
    const listEl = document.getElementById('notifOrders');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseClient
        .from('orders')
        .select('id, fulfillment_type, total_price, status, created_at')
        .neq('status', 'awaiting_payment')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error(error);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load order notifications.</div>`;
        return;
    }

    const orders = data || [];
    notifOrderCount = orders.length;
    refreshNotifBadge();

    if (!orders.length) {
        listEl.innerHTML = `<div class="admin-notif-empty">No new orders recently.</div>`;
        return;
    }

    listEl.innerHTML = orders.map(o => `
        <div class="admin-notif-item">
            <div class="admin-notif-item-icon"><i class="fas fa-bag-shopping" aria-hidden="true"></i></div>
            <div class="admin-notif-item-body">
                <p>New order: <strong>#${o.id.slice(0, 8).toUpperCase()}</strong> \u2014 PHP ${Number(o.total_price || 0).toLocaleString('en-PH')} (${o.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup'})</p>
                <span>${timeAgoNotif(o.created_at)}</span>
            </div>
        </div>
    `).join('');
}

// --------------------------------------------
// Badge — combined count across every wired section (Accounts +
// Bookings + Products + Orders). Add a section's count here once it's
// wired.
// --------------------------------------------
function refreshNotifBadge() {
    setNotifBadge(notifAccountCount + notifBookingCount + notifProductCount + notifOrderCount);
}

function setNotifBadge(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function timeAgoNotif(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function escapeHtmlNotif(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}