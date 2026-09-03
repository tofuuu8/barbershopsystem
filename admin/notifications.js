// ============================================================
// ADMIN — NOTIFICATIONS BELL (REVISED)
// ============================================================
// Shared across every admin page (loaded after admin-auth.js, before
// the page's own script) — this is the ONLY place bell content is
// populated, so every page shows the exact same notifications
// regardless of which page you're on.

const NOTIF_WINDOW_HOURS = 48; // anything within this window counts as "new" for the bell
const NOTIF_LOAD_LIMIT = 5;    // max items per section

let notifAccountCount = 0;
let notifBookingCount = 0;
let notifProductsCount = 0; // future use

let notifLastSeenKey = 'adminNotifLastSeen';
let notifLiveChannel = null;

// --------------------------------------------
// DOMContentLoaded — initialize bell
// --------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('notifBtn');
    const panel = document.getElementById('notifPanel');
    if (!btn || !panel) return; // page doesn't have the notif bell

    // Toggle panel
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
            markNotificationsAsRead();
        }
    });

    // Close when clicking outside
    document.addEventListener('click', function (e) {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
            panel.hidden = true;
        }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') panel.hidden = true;
    });

    // Load initial notifications
    loadAccountNotifications();
    loadBookingNotifications();

    // Set up real-time subscriptions (optional but recommended)
    setupRealTimeNotifications();
});

// --------------------------------------------
// Real-time subscriptions (Supabase)
// --------------------------------------------
function setupRealTimeNotifications() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient.channel) return;

    // Subscribe to new profiles (accounts)
    const accountChannel = supabaseClient
        .channel('notif-accounts')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'profiles' },
            () => {
                loadAccountNotifications();
            }
        )
        .subscribe();

    // Subscribe to new bookings
    const bookingChannel = supabaseClient
        .channel('notif-bookings')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'bookings' },
            () => {
                loadBookingNotifications();
            }
        )
        .subscribe();

    notifLiveChannel = [accountChannel, bookingChannel];
}

// --------------------------------------------
// Accounts — real data, from `profiles`
// --------------------------------------------
async function loadAccountNotifications() {
    const listEl = document.getElementById('notifAccounts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    // Reset count & show loading state
    notifAccountCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">Loading accounts...</div>`;

    try {
        const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseClient
            .from('profiles')
            .select('id, full_name, email, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(NOTIF_LOAD_LIMIT);

        if (error) throw error;

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
    } catch (err) {
        console.error('Error loading account notifications:', err);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load account notifications.</div>`;
    }
}

// --------------------------------------------
// Bookings — real data, from `bookings`
// --------------------------------------------
async function loadBookingNotifications() {
    const listEl = document.getElementById('notifBookings');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    // Reset count & show loading state
    notifBookingCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">Loading bookings...</div>`;

    try {
        const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseClient
            .from('bookings')
            .select('id, service_name, barber_name, booking_date, booking_time, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(NOTIF_LOAD_LIMIT);

        if (error) throw error;

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
    } catch (err) {
        console.error('Error loading booking notifications:', err);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load booking notifications.</div>`;
    }
}

// --------------------------------------------
// Products — placeholder (future use)
// --------------------------------------------
function loadProductNotifications() {
    const listEl = document.getElementById('notifProducts');
    if (!listEl) return;

    // Since no `products` table exists yet, just show empty state
    notifProductsCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">No product notifications yet.</div>`;
}

// --------------------------------------------
// Mark as read — stores last seen timestamp
// --------------------------------------------
function markNotificationsAsRead() {
    try {
        localStorage.setItem(notifLastSeenKey, new Date().toISOString());
        notifAccountCount = 0;
        notifBookingCount = 0;
        notifProductsCount = 0;
        refreshNotifBadge();
    } catch (e) {
        console.warn('Could not save last seen timestamp:', e);
    }
}

function getLastSeenTimestamp() {
    try {
        return localStorage.getItem(notifLastSeenKey) || new Date(0).toISOString();
    } catch (e) {
        return new Date(0).toISOString();
    }
}

// --------------------------------------------
// Badge — combined count across every wired section
// --------------------------------------------
function refreshNotifBadge() {
    const totalCount = notifAccountCount + notifBookingCount + notifProductsCount;
    setNotifBadge(totalCount);
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

// --------------------------------------------
// Cleanup on page unload (optional)
// --------------------------------------------
window.addEventListener('beforeunload', function () {
    if (notifLiveChannel) {
        notifLiveChannel.forEach(channel => {
            if (channel && typeof channel.unsubscribe === 'function') {
                channel.unsubscribe();
            }
        });
    }
});