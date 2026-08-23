// ADMIN — DURABLE NOTIFICATION CENTER
// Loaded by every protected admin page. Notifications are created by database
// triggers and remain available until staff marks them as seen.

let adminNotificationChannel = null;
let adminNotifications = [];

const NOTIFICATION_SECTIONS = {
    account_created: 'notifAccounts',
    booking_created: 'notifBookings',
    booking_updated: 'notifBookings',
    order_created: 'notifOrders',
    order_status_changed: 'notifOrders',
    payment_paid: 'notifOrders',
    product_low_stock: 'notifProducts'
};

document.addEventListener('DOMContentLoaded', async function () {
    const btn = document.getElementById('notifBtn');
    const panel = document.getElementById('notifPanel');
    if (!btn || !panel || typeof supabaseClient === 'undefined') return;

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) markAdminNotificationsRead();
    });
    document.addEventListener('click', function (e) {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') panel.hidden = true;
    });

    await loadAdminNotifications();
    subscribeToAdminNotifications();
});

window.addEventListener('pagehide', function () {
    if (adminNotificationChannel && typeof supabaseClient !== 'undefined') {
        supabaseClient.removeChannel(adminNotificationChannel);
        adminNotificationChannel = null;
    }
});

async function loadAdminNotifications() {
    const { data, error } = await supabaseClient
        .from('notifications')
        .select('id, event_type, title, body, entity_type, entity_id, created_at, read_at')
        .eq('audience', 'admin')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Could not load durable notifications:', error);
        renderNotificationMessage('notifAccounts', 'Run the latest Supabase migrations to enable notifications.');
        renderNotificationMessage('notifBookings', 'Notifications are not available yet.');
        renderNotificationMessage('notifProducts', 'Notifications are not available yet.');
        renderNotificationMessage('notifOrders', 'Notifications are not available yet.');
        setNotifBadge(0);
        return;
    }

    adminNotifications = data || [];
    renderAdminNotifications();
}

function renderAdminNotifications() {
    const grouped = { notifAccounts: [], notifBookings: [], notifProducts: [], notifOrders: [] };
    adminNotifications.forEach(function (notification) {
        const section = NOTIFICATION_SECTIONS[notification.event_type] || 'notifOrders';
        if (grouped[section]) grouped[section].push(notification);
    });

    Object.keys(grouped).forEach(function (section) {
        const entries = grouped[section].slice(0, 8);
        const label = section === 'notifAccounts' ? 'No new accounts.'
            : section === 'notifBookings' ? 'No new bookings.'
                : section === 'notifProducts' ? 'No product alerts.'
                    : 'No new orders.';
        const list = document.getElementById(section);
        if (!list) return;
        list.innerHTML = entries.length ? entries.map(renderNotificationItem).join('') : `<div class="admin-notif-empty">${label}</div>`;
    });

    setNotifBadge(adminNotifications.length);
}

function renderNotificationItem(notification) {
    const icon = notification.entity_type === 'booking' ? 'fa-calendar-check'
        : notification.entity_type === 'profile' ? 'fa-user-plus'
            : notification.entity_type === 'product' ? 'fa-box'
                : 'fa-bag-shopping';
    return `
        <div class="admin-notif-item" data-notification-id="${escapeHtmlNotif(notification.id)}">
            <div class="admin-notif-item-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
            <div class="admin-notif-item-body">
                <p><strong>${escapeHtmlNotif(notification.title)}</strong> ${escapeHtmlNotif(notification.body)}</p>
                <span>${timeAgoNotif(notification.created_at)}</span>
            </div>
        </div>
    `;
}

function renderNotificationMessage(id, message) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="admin-notif-empty">${escapeHtmlNotif(message)}</div>`;
}

async function markAdminNotificationsRead() {
    if (!adminNotifications.length) return;
    const ids = adminNotifications.map(item => item.id);
    const { error } = await supabaseClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids);
    if (!error) {
        adminNotifications = [];
        renderAdminNotifications();
    }
}

function subscribeToAdminNotifications() {
    if (adminNotificationChannel) supabaseClient.removeChannel(adminNotificationChannel);
    adminNotificationChannel = supabaseClient
        .channel('admin-durable-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'audience=eq.admin' }, function () {
            loadAdminNotifications();
        })
        .subscribe();
}

function setNotifBadge(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden = count <= 0;
}

function timeAgoNotif(iso) {
    if (!iso) return '';
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function escapeHtmlNotif(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}
