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

document.addEventListener('DOMContentLoaded', async function () {
    if (typeof authReadyPromise === 'undefined' || typeof supabaseClient === 'undefined') return;
    await authReadyPromise;
    if (typeof isLoggedIn !== 'function' || !isLoggedIn()) return;

    const user = getCurrentUser();
    if (!user) return;
    await loadCustomerNotifications(user.id);
    subscribeToCustomerNotifications(user.id);

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
    if (data && data[0] && !window.location.pathname.includes('myorders.html') && !window.location.pathname.includes('myappointments.html')) {
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
                showCustomerNotificationToast(notification);
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

function setCustomerNotificationBadge(count, increment) {
    document.querySelectorAll('.account-icon').forEach(function (icon) {
        let dot = icon.querySelector('.order-notif-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'order-notif-dot';
            dot.setAttribute('aria-label', 'Unread notifications');
            icon.style.position = icon.style.position || 'relative';
            icon.appendChild(dot);
        }
    });
    if (!count && !increment) hideCustomerNotificationBadge();
}

function hideCustomerNotificationBadge() {
    document.querySelectorAll('.account-icon .order-notif-dot').forEach(dot => dot.remove());
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
            window.location.href = window.location.pathname.includes('/myorders/') ? 'myorders.html' : '../myorders/myorders.html';
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