// CUSTOMER NOTIFICATION CENTER
// Durable notifications are created by database triggers. Realtime is an
// enhancement; the unread query remains the source of truth on page load.

let customerNotificationChannel = null;
const CUSTOMER_NOTIFICATION_LABELS = {
    order_created: 'Order received',
    order_status_changed: 'Order status updated',
    payment_paid: 'Payment confirmed',
    booking_created: 'Appointment requested',
    booking_updated: 'Appointment updated'
};

// olive = confirmed/positive, amber = pending/needs a look, rust = cancelled/failed.
// Anything not listed here falls back to amber ("something changed, go check").
const CUSTOMER_NOTIFICATION_STATUS = {
    order_created: 'amber',
    order_status_changed: 'amber',
    payment_paid: 'olive',
    booking_created: 'amber',
    booking_updated: 'amber',
    order_cancelled: 'rust',
    booking_cancelled: 'rust'
};

// In-memory unread count — the single source of truth for every badge on
// the page (header bell, desktop account-menu item, mobile account-sheet
// link) and for the notifications page's own header, via
// getUnreadNotificationCount() below. Kept as a real number rather than a
// boolean so a bell badge can show "3" instead of just a dot.
let unreadNotificationCount = 0;

function getUnreadNotificationCount() {
    return unreadNotificationCount;
}

document.addEventListener('DOMContentLoaded', async function () {
    if (typeof authReadyPromise === 'undefined' || typeof supabaseClient === 'undefined') return;
    await authReadyPromise;
    if (typeof isLoggedIn !== 'function' || !isLoggedIn()) return;

    const user = getCurrentUser();
    if (!user) return;
    await loadCustomerNotifications(user.id);
    subscribeToCustomerNotifications(user.id);

    if (isOnNotificationsListPage()) {
        // The notifications page itself renders and marks-as-read on its
        // own terms (individual/mark-all actions) — see notifications.js.
        return;
    }

    if (window.location.pathname.includes('myorders.html') || window.location.pathname.includes('myappointments.html')) {
        await markCustomerNotificationsRead(user.id);
    }
});

window.addEventListener('pagehide', function () {
    if (customerNotificationChannel && typeof supabaseClient !== 'undefined') {
        supabaseClient.removeChannel(customerNotificationChannel);
        customerNotificationChannel = null;
    }
});

function isOnNotificationsListPage() {
    return window.location.pathname.includes('notifications.html');
}

async function loadCustomerNotifications(userId) {
    const { data, error } = await supabaseClient
        .from('notifications')
        .select('id, event_type, title, body, entity_type, entity_id, created_at')
        .eq('audience', 'customer')
        .eq('user_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(30);

    if (error) {
        // Older deployments without the migration retain the old order-status
        // fallback and do not fail the rest of the page.
        await loadLegacyOrderBadge(userId);
        return;
    }

    setCustomerNotificationBadge((data || []).length);
    if (data && data[0] && !window.location.pathname.includes('myorders.html') && !window.location.pathname.includes('myappointments.html') && !isOnNotificationsListPage()) {
        showCustomerNotificationToast(data[0]);
    }
}

async function markCustomerNotificationsRead(userId) {
    await supabaseClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('audience', 'customer')
        .eq('user_id', userId)
        .is('read_at', null);
    setCustomerNotificationBadge(0);
}

function subscribeToCustomerNotifications(userId) {
    if (customerNotificationChannel) supabaseClient.removeChannel(customerNotificationChannel);
    customerNotificationChannel = supabaseClient
        .channel(`customer-notifications-${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, function (payload) {
            const notification = payload.new;
            if (notification && notification.audience === 'customer') {
                setCustomerNotificationBadge(1, true);
                if (isOnNotificationsListPage() && typeof window.onCustomerNotificationInserted === 'function') {
                    // Lets notifications.js prepend the new row live instead of
                    // the visitor only finding out on their next reload.
                    window.onCustomerNotificationInserted(notification);
                } else {
                    showCustomerNotificationToast(notification);
                }
            }
        })
        .subscribe();
}

async function loadLegacyOrderBadge(userId) {
    const { data } = await supabaseClient
        .from('orders')
        .select('id, status, updated_at')
        .eq('user_id', userId);
    if (!data) return;
    const seen = getSeenOrderStatuses();
    const changed = data.some(order => seen[order.id] !== undefined && seen[order.id] !== order.status);
    if (changed) setCustomerNotificationBadge(1, true);
}

function getSeenOrderStatuses() {
    try { return JSON.parse(localStorage.getItem('toughcuts_seen_order_statuses') || '{}'); } catch (_) { return {}; }
}

// `count` is either the new absolute total (setCustomerNotificationBadge(3))
// or, when `increment` is true, a delta to add to the running total
// (setCustomerNotificationBadge(1, true) on a new realtime insert,
// setCustomerNotificationBadge(-1, true) after reading a single
// notification on the notifications page). Never lets the total go
// negative, since a stale/duplicate decrement shouldn't show "-1".
function setCustomerNotificationBadge(count, increment) {
    unreadNotificationCount = increment ? unreadNotificationCount + count : count;
    if (unreadNotificationCount < 0) unreadNotificationCount = 0;
    renderNotificationBadges();
}

// Updates every place an unread count can appear on the current page:
// the small dot on the header avatar (kept for the bottom nav's Account
// tab, which mirrors this dot — see bottom-nav.js), and the numeric
// ".notif-bell-badge" badge, which shows up in up to three places at
// once (header bell, desktop account-menu item, mobile account-sheet
// link) depending on the page and viewport.
function renderNotificationBadges() {
    const hasUnread = unreadNotificationCount > 0;

    document.querySelectorAll('.account-icon').forEach(function (icon) {
        let dot = icon.querySelector('.order-notif-dot');
        if (hasUnread) {
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'order-notif-dot';
                dot.setAttribute('aria-label', 'Unread notifications');
                icon.style.position = icon.style.position || 'relative';
                icon.appendChild(dot);
            }
        } else if (dot) {
            dot.remove();
        }
    });

    document.querySelectorAll('.notif-bell-badge').forEach(function (badge) {
        badge.textContent = unreadNotificationCount > 99 ? '99+' : String(unreadNotificationCount);
        badge.hidden = !hasUnread;
    });
}

// Anchors the toast just under the sticky site header (announce bar +
// nav) instead of a fixed pixel value — header height isn't the same on
// every page (the announce bar's line can wrap on narrow screens) and
// .site-header-group is `position: sticky; top: 0`, so once it's stuck,
// its bottom edge is a stable place to hang the toast off of.
function getHeaderBottomOffset() {
    const headerGroup = document.querySelector('.site-header-group');
    return headerGroup ? Math.round(headerGroup.getBoundingClientRect().bottom) + 12 : 90;
}

function showCustomerNotificationToast(notification) {
    let toast = document.getElementById('customerNotificationToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'customerNotificationToast';
        toast.className = 'customer-toast';
        toast.addEventListener('click', function () {
            window.location.href = window.location.pathname.includes('/notifications/')
                ? 'notifications.html'
                : (typeof SITE_BASE !== 'undefined' ? SITE_BASE : '') + 'notifications/notifications.html';
        });
        document.body.appendChild(toast);
    }
    toast.replaceChildren();

    const status = CUSTOMER_NOTIFICATION_STATUS[notification.event_type] || 'amber';
    const dot = document.createElement('span');
    dot.className = `toast-dot${status === 'olive' ? '' : ' status-' + status}`;
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = CUSTOMER_NOTIFICATION_LABELS[notification.event_type] || notification.title || 'Toughcuts update';
    const body = document.createElement('span');
    body.textContent = notification.body || 'Open your account to view the latest update.';
    text.append(title, body);

    toast.append(dot, text);

    // Recomputed every show (not just once) since the header's height can
    // change between page loads, and on resize while it's still visible.
    toast.style.top = `${getHeaderBottomOffset()}px`;
    toast.classList.add('is-visible');

    clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(function () {
        toast.classList.remove('is-visible');
    }, 6000);
}