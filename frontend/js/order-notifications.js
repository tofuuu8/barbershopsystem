// ============================================================
// ORDER STATUS NOTIFICATIONS
// ============================================================
// Self-contained, sitewide. Add this ONE script tag to every page
// that already loads supabase.js + main.js, right after main.js:
//
//   <script src="../js/supabase.js"></script>
//   <script src="../js/main.js"></script>
//   <script src="../js/order-notifications.js"></script>
//
// What it does:
//   1. On load, compares each of the signed-in visitor's orders'
//      status against what was last seen (stored in localStorage).
//      If anything changed since their last visit, a small red dot
//      badge appears on the account icon (#accountIcon) — a low-key
//      "something happened" signal without needing email/push.
//   2. While a page is open, subscribes to Realtime updates on the
//      visitor's own `orders` rows. If a status changes live (e.g.
//      admin marks an order "ready" while the customer is browsing),
//      a toast pops up immediately.
//   3. Visiting myorders.html marks everything as "seen" (clears the
//      badge), since that page already shows current statuses.
//
// Assumes: isLoggedIn() / getCurrentUser() / authReadyPromise (from
// main.js), supabaseClient (from supabase.js), and an element with
// id="accountIcon" in the header (present on every page's markup).
// Realtime requires the `orders` table to have replication enabled
// (Database -> Replication -> orders, toggle on) — if it's off, the
// toast simply won't fire; the on-load badge check still works either
// way since that's a plain SELECT, not Realtime.
// ============================================================

const ORDER_NOTIF_STORAGE_KEY = 'toughcuts_seen_order_statuses';

// Tracked so subscribeToLiveOrderChanges() can be torn down cleanly
// instead of leaking a channel — see the pagehide listener below and
// the guard inside subscribeToLiveOrderChanges() itself.
let orderNotifChannel = null;

document.addEventListener('DOMContentLoaded', async function () {
    if (typeof authReadyPromise === 'undefined' || typeof supabaseClient === 'undefined') return;
    await authReadyPromise;
    if (typeof isLoggedIn !== 'function' || !isLoggedIn()) return;

    const user = getCurrentUser();
    if (!user) return;

    await checkForStatusChangesSinceLastVisit(user.id);
    subscribeToLiveOrderChanges(user.id);

    // Being on My Orders itself counts as "seeing" the current state.
    if (window.location.pathname.includes('myorders.html')) {
        markAllOrdersAsSeen(user.id);
    }
});

// Realtime subscriptions don't automatically close when a full page
// navigation happens (and definitely don't close for a bfcache
// restore) — clean this up explicitly rather than relying on the
// browser to eventually garbage-collect it.
window.addEventListener('pagehide', function () {
    if (orderNotifChannel) {
        supabaseClient.removeChannel(orderNotifChannel);
        orderNotifChannel = null;
    }
});

// --------------------------------------------
// On-load badge check (localStorage diff, not Realtime)
// --------------------------------------------
async function checkForStatusChangesSinceLastVisit(userId) {
    const { data: orders, error } = await supabaseClient
        .from('orders')
        .select('id, status, updated_at')
        .eq('user_id', userId);

    if (error || !orders) return;

    const seen = getSeenOrderStatuses();
    let changed = false;

    orders.forEach(function (order) {
        const lastSeenStatus = seen[order.id];
        if (lastSeenStatus !== undefined && lastSeenStatus !== order.status) {
            changed = true;
        }
    });

    if (changed) showAccountIconBadge();
}

function getSeenOrderStatuses() {
    try {
        return JSON.parse(localStorage.getItem(ORDER_NOTIF_STORAGE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function markAllOrdersAsSeen(userId) {
    supabaseClient
        .from('orders')
        .select('id, status')
        .eq('user_id', userId)
        .then(function (result) {
            const data = result && result.data;
            if (!data) return;
            const seen = {};
            data.forEach(function (o) { seen[o.id] = o.status; });
            localStorage.setItem(ORDER_NOTIF_STORAGE_KEY, JSON.stringify(seen));
            hideAccountIconBadge();
        });
}

// --------------------------------------------
// Live updates while a page is open
// --------------------------------------------
function subscribeToLiveOrderChanges(userId) {
    // Guard against calling this twice in the same page session (e.g.
    // an auth state change firing again) — leaving the old channel
    // open while opening a second one is exactly the leak this is
    // meant to avoid.
    if (orderNotifChannel) {
        supabaseClient.removeChannel(orderNotifChannel);
        orderNotifChannel = null;
    }

    // Per-user channel name — avoids any cross-tab/cross-user channel
    // name collisions on a shared browser profile.
    orderNotifChannel = supabaseClient
        .channel(`order-status-changes-${userId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
            function (payload) {
                const newRow = payload.new;
                const oldRow = payload.old;
                if (!newRow || !oldRow || newRow.status === oldRow.status) return;

                showOrderStatusToast(newRow);
                showAccountIconBadge();

                // Keep localStorage in sync so the badge doesn't
                // re-trigger for the same change on the next page load.
                const seen = getSeenOrderStatuses();
                seen[newRow.id] = newRow.status;
                localStorage.setItem(ORDER_NOTIF_STORAGE_KEY, JSON.stringify(seen));
            }
        )
        .subscribe();
}

// --------------------------------------------
// UI bits
// --------------------------------------------
const ORDER_NOTIF_STATUS_LABELS = {
    awaiting_payment: 'Awaiting Payment',
    pending: 'Pending',
    preparing: 'Preparing',
    ready: 'Ready',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

function showOrderStatusToast(order) {
    let toast = document.getElementById('orderStatusToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'orderStatusToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            max-width: 320px;
            padding: 14px 18px;
            border-radius: 12px;
            background: #1a1a1a;
            border: 1px solid rgba(255,255,255,0.12);
            color: #fff;
            font-family: system-ui, sans-serif;
            font-size: 0.85rem;
            line-height: 1.5;
            z-index: 9999;
            box-shadow: 0 12px 30px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: opacity 0.3s ease, transform 0.3s ease;
        `;
        toast.addEventListener('click', function () {
            window.location.href = window.location.pathname.includes('/myorders/')
                ? 'myorders.html'
                : '../myorders/myorders.html';
        });
        document.body.appendChild(toast);
    }

    const label = ORDER_NOTIF_STATUS_LABELS[order.status] || order.status;
    toast.innerHTML = `<strong>Order #${order.id.slice(0, 8).toUpperCase()}</strong> is now <strong>${label}</strong>. Tap to view.`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
    }, 6000);
}

function showAccountIconBadge() {
    document.querySelectorAll('.account-icon').forEach(function (icon) {
        if (icon.querySelector('.order-notif-dot')) return; // already showing

        const dot = document.createElement('span');
        dot.className = 'order-notif-dot';
        dot.style.cssText = `
            position: absolute;
            top: -2px;
            right: -2px;
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #e05a5a;
            border: 2px solid var(--black, #0f0f0f);
        `;
        icon.style.position = icon.style.position || 'relative';
        icon.appendChild(dot);
    });
}

function hideAccountIconBadge() {
    document.querySelectorAll('.account-icon').forEach(function (icon) {
        const dot = icon.querySelector('.order-notif-dot');
        if (dot) dot.remove();
    });
}