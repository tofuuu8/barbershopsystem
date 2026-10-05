// ============================================
// NOTIFICATIONS PAGE
// ============================================
// Unlike order-notifications.js's badge/toast logic (which only ever
// looks at *unread* rows), this page shows the visitor's full
// notification history and lets them mark things read individually or
// all at once, or clear the whole list. Loads after supabase.js, main.js,
// bottom-nav.js and order-notifications.js (same order as every other
// page — see the <script> tags at the bottom of notifications.html), so it
// can reuse SITE_BASE, authReadyPromise, isLoggedIn(), getCurrentUser(),
// setCustomerNotificationBadge() and the label/status maps exactly the
// way those files already expose them.

const NOTIF_PAGE_SIZE = 30;
let notifOffset = 0;
let notifReachedEnd = false;
let notifLoadInFlight = false;

// This page's own unread count. It comes from a direct count query rather
// than getUnreadNotificationCount(), because that value is filled in by
// order-notifications.js's separate load and may not be ready yet when
// this page's list finishes rendering (which made the subtitle briefly
// say "all caught up" with unread rows on screen).
let notifUnread = 0;

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
        prependNotification(notification, listEl);
    };

    if (markAllBtn) {
        markAllBtn.addEventListener('click', function () {
            markAllRead(user.id, listEl, markAllBtn);
        });
    }

    initClearAll(user.id, listEl);

    notifUnread = await fetchUnreadCount(user.id);
    if (typeof setCustomerNotificationBadge === 'function') setCustomerNotificationBadge(notifUnread);

    await loadMoreNotifications(user.id, listEl);
});

async function fetchUnreadCount(userId) {
    const { count, error } = await supabaseClient
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('audience', 'customer')
        .eq('user_id', userId)
        .is('read_at', null);

    if (error || typeof count !== 'number') {
        return typeof getUnreadNotificationCount === 'function' ? getUnreadNotificationCount() : 0;
    }
    return count;
}

// Single place that decides what the header area shows, so the subtitle,
// "Mark all as read", "Clear all" and the empty state can never disagree.
function updateSummary(listEl) {
    const subtitleEl = document.getElementById('notifSubtitle');
    const emptyEl = document.getElementById('notifEmpty');
    const markAllBtn = document.getElementById('notifMarkAllBtn');
    const clearBtn = document.getElementById('notifClearBtn');
    const confirmEl = document.getElementById('notifClearConfirm');

    const hasItems = listEl.children.length > 0;
    if (notifUnread < 0) notifUnread = 0;

    if (emptyEl) emptyEl.hidden = hasItems;
    if (markAllBtn) markAllBtn.hidden = !hasItems || notifUnread <= 0;
    if (clearBtn) clearBtn.hidden = !hasItems || (confirmEl && !confirmEl.hidden);
    if (!hasItems && confirmEl) confirmEl.hidden = true;

    if (subtitleEl) {
        subtitleEl.textContent = hasItems && notifUnread > 0
            ? `${notifUnread} unread notification${notifUnread === 1 ? '' : 's'}`
            : "You're all caught up.";
    }
}

function showNotifError(message) {
    const el = document.getElementById('notifError');
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
}

async function loadMoreNotifications(userId, listEl) {
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
        const subtitleEl = document.getElementById('notifSubtitle');
        if (subtitleEl) subtitleEl.textContent = 'Something went wrong loading your notifications.';
        return;
    }

    const rows = data || [];
    notifOffset += rows.length;
    if (rows.length < NOTIF_PAGE_SIZE) notifReachedEnd = true;

    rows.forEach(function (row) { listEl.appendChild(renderNotificationItem(row)); });
    updateLoadMoreControl(listEl);
    updateSummary(listEl);
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
        // Created after the initial wiring in DOMContentLoaded, so it
        // needs its own handler.
        btn.addEventListener('click', function () {
            const user = getCurrentUser();
            if (user) loadMoreNotifications(user.id, listEl);
        });
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

        notifUnread -= 1;
        if (typeof setCustomerNotificationBadge === 'function') setCustomerNotificationBadge(Math.max(notifUnread, 0));
        updateSummary(document.getElementById('notifList'));

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
    notifUnread = 0;
    if (typeof setCustomerNotificationBadge === 'function') setCustomerNotificationBadge(0);
    updateSummary(listEl);
}

// --------------------------------------------
// Clear all — inline two-step confirm (button -> "Are you sure?") instead
// of window.confirm(), which looks out of place and is easy to dismiss
// by accident on mobile.
// --------------------------------------------
function initClearAll(userId, listEl) {
    const clearBtn = document.getElementById('notifClearBtn');
    const confirmEl = document.getElementById('notifClearConfirm');
    const yesBtn = document.getElementById('notifClearYes');
    const noBtn = document.getElementById('notifClearNo');
    if (!clearBtn || !confirmEl || !yesBtn || !noBtn) return;

    clearBtn.addEventListener('click', function () {
        showNotifError('');
        clearBtn.hidden = true;
        confirmEl.hidden = false;
        noBtn.focus(); // default focus on the safe choice
    });

    noBtn.addEventListener('click', function () {
        confirmEl.hidden = true;
        updateSummary(listEl);
        clearBtn.focus();
    });

    yesBtn.addEventListener('click', async function () {
        yesBtn.classList.add('is-loading');
        yesBtn.disabled = true;
        noBtn.disabled = true;

        // .select() makes Supabase return the rows it actually deleted.
        // Without it, a Row Level Security policy that blocks DELETE
        // looks exactly like success (0 rows, no error).
        const { data, error } = await supabaseClient
            .from('notifications')
            .delete()
            .eq('audience', 'customer')
            .eq('user_id', userId)
            .select('id');

        yesBtn.classList.remove('is-loading');
        yesBtn.disabled = false;
        noBtn.disabled = false;

        if (error || !data || data.length === 0) {
            console.warn('Could not clear notifications:', error ? error.message : 'no rows deleted — check the notifications DELETE policy');
            confirmEl.hidden = true;
            updateSummary(listEl);
            showNotifError("Couldn't clear your notifications. Please try again in a moment.");
            return;
        }

        listEl.replaceChildren();
        notifOffset = 0;
        notifReachedEnd = true;
        notifUnread = 0;
        const loadMore = document.getElementById('notifLoadMoreBtn');
        if (loadMore) loadMore.remove();
        const toast = document.getElementById('customerNotificationToast');
        if (toast) toast.classList.remove('is-visible');
        if (typeof setCustomerNotificationBadge === 'function') setCustomerNotificationBadge(0);

        confirmEl.hidden = true;
        showNotifError('');
        updateSummary(listEl);
    });
}

function prependNotification(notification, listEl) {
    const item = renderNotificationItem(Object.assign({ read_at: null }, notification));
    listEl.insertBefore(item, listEl.firstChild);
    notifOffset += 1;
    notifUnread += 1;
    showNotifError('');
    updateSummary(listEl);
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