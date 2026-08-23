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
            dot.style.cssText = 'position:absolute;top:-2px;right:-2px;width:9px;height:9px;border-radius:50%;background:#e05a5a;border:2px solid var(--black,#0f0f0f);';
            icon.style.position = icon.style.position || 'relative';
            icon.appendChild(dot);
        }
    });
    if (!count && !increment) hideCustomerNotificationBadge();
}

function hideCustomerNotificationBadge() {
    document.querySelectorAll('.account-icon .order-notif-dot').forEach(dot => dot.remove());
}

function showCustomerNotificationToast(notification) {
    let toast = document.getElementById('customerNotificationToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'customerNotificationToast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;max-width:340px;padding:14px 18px;border-radius:12px;background:#1a1a1a;border:1px solid rgba(255,255,255,.12);color:#fff;font-family:system-ui,sans-serif;font-size:.85rem;line-height:1.5;z-index:9999;box-shadow:0 12px 30px rgba(0,0,0,.4);cursor:pointer;transition:opacity .3s ease,transform .3s ease;';
        toast.addEventListener('click', function () {
            window.location.href = window.location.pathname.includes('/myorders/') ? 'myorders.html' : '../myorders/myorders.html';
        });
        document.body.appendChild(toast);
    }
    toast.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = CUSTOMER_NOTIFICATION_LABELS[notification.event_type] || notification.title || 'Toughcuts update';
    const body = document.createTextNode(` — ${notification.body || 'Open your account to view the latest update.'}`);
    toast.append(title, body);
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
    }, 6000);
}
