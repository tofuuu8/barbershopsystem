// ============================================
// NOTIFICATIONS PAGE
// ============================================
// Unlike order-notifications.js's badge/toast logic (which only ever
// looks at *unread* rows), this page shows the visitor's full
// notification history and lets them mark things read individually or
// all at once. Loads after supabase.js, main.js, bottom-nav.js and
// order-notifications.js (same order as every other page — see the
// <script> tags at the bottom of notifications.html), so it can reuse
// SITE_BASE, authReadyPromise, isLoggedIn(), getCurrentUser(),
// escapeHtml(), setCustomerNotificationBadge() and
// getUnreadNotificationCount() exactly the way those files already
// expose them.

const NOTIF_PAGE_SIZE = 30;
let notifOffset = 0;
let notifReachedEnd = false;
let notifLoadInFlight = false;

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    const listEl = document.getElementById('notifList');
    const emptyEl = document.getElementById('notifEmpty');
    const signedOutEl = document.getElementById('notifSignedOut');
    const subtitleEl = document.getElementById('notifSubtitle');
    const markAllBtn = document.getElementById('notifMarkAllBtn');
    const loginBtn = document.getElementById('notifLoginBtn');

    if (!isLoggedIn()) {
        if (signedOutEl) signedOutEl.hidden = false;
        if (subtitleEl) subtitleEl.textContent = 'Log in to see updates about your orders and appointments.';
        if (loginBtn) {
            loginBtn.href = `${SITE_BASE}login/login.html?redirect=${encodeURIComponent('notifications/notifications.html')}`;
        }
        return;
    }

    const user = getCurrentUser();
    if (!user) return;

    // Lets order-notifications.js's realtime subscription hand new
    // inserts straight to this page instead of showing a toast that
    // would just be pointing the visitor at the page they're already on.
    window.onCustomerNotificationInserted = function (notification) {
        prependNotification(notification, listEl, emptyEl);
    };

    if (markAllBtn) {
        markAllBtn.addEventListener('click', function () {
            markAllRead(user.id, listEl, markAllBtn);
        });
    }

    await loadMoreNotifications(user.id, listEl, emptyEl, subtitleEl, markAllBtn);

    const loadMoreBtn = document.getElementById('notifLoadMoreBtn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', function () {
            loadMoreNotifications(user.id, listEl, emptyEl, subtitleEl, markAllBtn);
        });
    }
});

async function loadMoreNotifications(userId, listEl, emptyEl, subtitleEl, markAllBtn) {
    if (notifLoadInFlight || notifReachedEnd) return;
    notifLoadInFlight = true;

    const { data, error } = await supabaseClient
        .from('notifications')
        .select('id, event_type, title, body, entity_type, entity_id, read_at, created_at')
        .eq('audience', 'customer')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(notifOffset, notifOffset + NOTIF_PAGE_SIZE - 1);

    notifLoadInFlight = false;

    if (error) {
        if (subtitleEl) subtitleEl.textContent = 'Something went wrong loading your notifications.';
        return;
    }

    const rows = data || [];
    notifOffset += rows.length;
    if (rows.length < NOTIF_PAGE_SIZE) notifReachedEnd = true;

    if (notifOffset === rows.length && rows.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        if (subtitleEl) subtitleEl.textContent = "You're all caught up.";
        if (markAllBtn) markAllBtn.hidden = true;
        return;
    }

    rows.forEach(function (row) { listEl.appendChild(renderNotificationItem(row)); });
    updateLoadMoreControl(listEl);

    const unreadCount = typeof getUnreadNotificationCount === 'function' ? getUnreadNotificationCount() : 0;
    if (subtitleEl) {
        subtitleEl.textContent = unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
            : "You're all caught up.";
    }
    if (markAllBtn) markAllBtn.hidden = unreadCount <= 0;
}

function updateLoadMoreControl(listEl) {
    let btn = document.getElementById('notifLoadMoreBtn');
    if (notifReachedEnd) {
        if (btn) btn.remove();
        return;
    }
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'notifLoadMoreBtn';
        btn.className = 'btn-secondary notif-load-more';
        btn.textContent = 'Load more';
        listEl.insertAdjacentElement('afterend', btn);
    }
}

function renderNotificationItem(row) {
    const isUnread = !row.read_at;

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'notif-item' + (isUnread ? ' is-unread' : '');
    item.dataset.id = row.id;

    const status = CUSTOMER_NOTIFICATION_STATUS[row.event_type] || 'amber';
    const dot = document.createElement('span');
    dot.className = 'notif-item-dot' + (status === 'olive' ? '' : ' status-' + status);
    dot.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'notif-item-body';

    const title = document.createElement('strong');
    title.textContent = CUSTOMER_NOTIFICATION_LABELS[row.event_type] || row.title || 'Toughcuts update';

    const text = document.createElement('span');
    text.className = 'notif-item-text';
    text.textContent = row.body || '';

    const time = document.createElement('span');
    time.className = 'notif-item-time';
    time.textContent = formatRelativeTime(row.created_at);

    body.append(title, text, time);
    item.append(dot, body);

    item.addEventListener('click', function () {
        handleNotificationClick(row, item);
    });

    return item;
}

async function handleNotificationClick(row, item) {
    if (!row.read_at) {
        row.read_at = new Date().toISOString();
        item.classList.remove('is-unread');
        if (typeof setCustomerNotificationBadge === 'function') setCustomerNotificationBadge(-1, true);

        supabaseClient
            .from('notifications')
            .update({ read_at: row.read_at })
            .eq('id', row.id)
            .then(function (res) {
                if (res.error) console.warn('Could not mark notification read:', res.error.message);
            });
    }

    if (row.entity_type === 'order') {
        window.location.href = `${SITE_BASE}myorders/myorders.html`;
    } else if (row.entity_type === 'booking') {
        window.location.href = `${SITE_BASE}myappointments/myappointments.html`;
    }
    // Unrecognized/absent entity_type: just mark read in place, no navigation.
}

async function markAllRead(userId, listEl, markAllBtn) {
    markAllBtn.classList.add('is-loading');
    const { error } = await supabaseClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('audience', 'customer')
        .eq('user_id', userId)
        .is('read_at', null);
    markAllBtn.classList.remove('is-loading');

    if (error) {
        console.warn('Could not mark all notifications read:', error.message);
        return;
    }

    listEl.querySelectorAll('.notif-item.is-unread').forEach(function (el) { el.classList.remove('is-unread'); });
    if (typeof setCustomerNotificationBadge === 'function') setCustomerNotificationBadge(0);
    markAllBtn.hidden = true;

    const subtitleEl = document.getElementById('notifSubtitle');
    if (subtitleEl) subtitleEl.textContent = "You're all caught up.";
}

function prependNotification(notification, listEl, emptyEl) {
    if (emptyEl) emptyEl.hidden = true;
    const item = renderNotificationItem(Object.assign({ read_at: null }, notification));
    listEl.insertBefore(item, listEl.firstChild);
    notifOffset += 1;

    const markAllBtn = document.getElementById('notifMarkAllBtn');
    if (markAllBtn) markAllBtn.hidden = false;

    const subtitleEl = document.getElementById('notifSubtitle');
    const unreadCount = typeof getUnreadNotificationCount === 'function' ? getUnreadNotificationCount() : 0;
    if (subtitleEl) subtitleEl.textContent = `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`;
}

function formatRelativeTime(isoString) {
    const then = new Date(isoString).getTime();
    const diffSeconds = Math.round((Date.now() - then) / 1000);

    if (diffSeconds < 60) return 'Just now';
    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

    return new Date(isoString).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}