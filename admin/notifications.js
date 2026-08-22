// ============================================================
// ADMIN — NOTIFICATIONS BELL
// ============================================================
// Shared across every admin page (loaded after admin-auth.js, before
// the page's own script). "Accounts" (new signups) and "Bookings"
// (pending appointments) are both wired to real data now that the
// `bookings` table exists — `profiles` and `bookings` respectively.
// "Products" stays a static placeholder until a products table
// exists; give it its own loadXNotifications() function here
// following the same shape as the two below once it does.
//
// Pages without a #notifBookings element (none currently) simply skip
// that section — loadBookingNotifications() no-ops if the element
// isn't found, same guard pattern as loadAccountNotifications().

const NOTIF_NEW_ACCOUNT_WINDOW_HOURS = 48; // accounts registered within this window count as "new"

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
});

// --------------------------------------------
// Accounts — real data, from `profiles`
// --------------------------------------------
async function loadAccountNotifications() {
    const listEl = document.getElementById('notifAccounts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    const since = new Date(Date.now() - NOTIF_NEW_ACCOUNT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

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
    notifCounts.accounts = accounts.length;
    updateNotifBadge();

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
// Bookings — real data, from `bookings`. Surfaces pending
// appointments, since those are the ones that actually need staff
// attention (confirmed/completed/cancelled don't need a nudge).
// --------------------------------------------
async function loadBookingNotifications() {
    const listEl = document.getElementById('notifBookings');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('bookings')
        .select('id, service_name, barber_name, booking_date, booking_time, created_at, user_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error(error);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load booking notifications.</div>`;
        return;
    }

    const bookings = data || [];
    notifCounts.bookings = bookings.length;
    updateNotifBadge();

    if (!bookings.length) {
        listEl.innerHTML = `<div class="admin-notif-empty">No pending bookings right now.</div>`;
        return;
    }

    listEl.innerHTML = bookings.map(b => `
        <div class="admin-notif-item">
            <div class="admin-notif-item-icon"><i class="fas fa-calendar-check" aria-hidden="true"></i></div>
            <div class="admin-notif-item-body">
                <p>Pending: <strong>${escapeHtmlNotif(b.service_name || 'Booking')}</strong> with ${escapeHtmlNotif(b.barber_name || 'a barber')}</p>
                <span>${timeAgoNotif(b.created_at)}</span>
            </div>
        </div>
    `).join('');
}

// --------------------------------------------
// Badge — sums whichever sections have loaded so far. Sections with
// no data source yet (Products) just never add to notifCounts.
// --------------------------------------------
const notifCounts = { accounts: 0, bookings: 0 };

function updateNotifBadge() {
    const total = notifCounts.accounts + notifCounts.bookings;
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total > 9 ? '9+' : String(total);
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