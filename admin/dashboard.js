// ============================================================
// ADMIN — DASHBOARD (Home)
// ============================================================
// "Total Registered Users" reads `profiles`. Total Revenue Today,
// Total Appointments Today, Pending Appointments, the Weekly Revenue
// graph, and Recent Bookings read `bookings`. Low Stock Alerts now
// reads `products` (see products_setup.sql / the admin Products page).

let currentAdmin = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return; // already redirected

    const emailEl = document.getElementById('adminSidebarEmail');
    if (emailEl) emailEl.textContent = currentAdmin.email;

    initLogout();
    await loadDashboard();
});

function initLogout() {
    const btn = document.getElementById('adminLogoutBtn');
    if (btn) btn.addEventListener('click', adminLogOut);
}

async function loadDashboard() {
    await loadTotalUsers();
    await loadBookingStats();
    await loadLowStockCount();
}

// --------------------------------------------
// Bookings — real data, from `bookings`. Powers the top stat row
// (Revenue/Appointments Today, Pending), the Weekly Revenue chart,
// and the Recent Bookings list.
// --------------------------------------------
async function loadBookingStats() {
    const [bookingsRes, profilesRes] = await Promise.all([
        supabaseClient
            .from('bookings')
            .select('id, user_id, service_name, barber_name, booking_date, booking_time, total_price, status, created_at')
            .order('created_at', { ascending: false })
            .limit(500),
        supabaseClient
            .from('profiles')
            .select('id, full_name')
    ]);

    if (bookingsRes.error) {
        console.error(bookingsRes.error);
        return;
    }

    const bookings = bookingsRes.data || [];
    const profilesById = {};
    (profilesRes.data || []).forEach(function (p) { profilesById[p.id] = p; });

    const todayStr = new Date().toISOString().slice(0, 10);
    const todaysBookings = bookings.filter(b => b.booking_date === todayStr && b.status !== 'cancelled');
    const pending = bookings.filter(b => b.status === 'pending');

    const revenueToday = todaysBookings.reduce((sum, b) => sum + (Number(b.total_price) || 0), 0);

    setText('statRevenueToday', 'PHP ' + revenueToday.toLocaleString('en-PH'));
    setText('statAppointmentsToday', todaysBookings.length);
    setText('statPendingAppointments', pending.length);

    renderWeeklyRevenueChart(bookings);
    renderRecentBookings(bookings.slice(0, 5), profilesById);
}

// --------------------------------------------
// Weekly Revenue graph — last 7 days (oldest to newest, ending today),
// confirmed + completed bookings only (pending/cancelled aren't real
// revenue yet).
// --------------------------------------------
function renderWeeklyRevenueChart(bookings) {
    const chartEl = document.getElementById('weeklyRevenueChart');
    const barsWrap = chartEl ? chartEl.querySelector('.admin-chart-bars') : null;
    const emptyEl = chartEl ? chartEl.querySelector('.admin-chart-empty') : null;
    if (!barsWrap) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d);
    }

    const dayTotals = days.map(function (d) {
        const dateStr = d.toISOString().slice(0, 10);
        const total = bookings
            .filter(b => b.booking_date === dateStr && (b.status === 'confirmed' || b.status === 'completed'))
            .reduce((sum, b) => sum + (Number(b.total_price) || 0), 0);
        return { date: d, total: total };
    });

    const maxTotal = Math.max(...dayTotals.map(d => d.total), 0);

    if (maxTotal === 0) {
        if (emptyEl) emptyEl.style.display = '';
        barsWrap.style.opacity = '0.5';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        barsWrap.style.opacity = '1';
    }

    barsWrap.innerHTML = dayTotals.map(function (d) {
        const heightPct = maxTotal > 0 ? Math.max((d.total / maxTotal) * 100, 4) : 4;
        const label = d.date.toLocaleDateString('en-PH', { weekday: 'short' });
        return `<div class="admin-chart-bar-col" title="${label}: PHP ${d.total.toLocaleString('en-PH')}">
            <div class="admin-chart-bar" style="height: ${heightPct}%;"></div>
            <span>${label}</span>
        </div>`;
    }).join('');
}

// --------------------------------------------
// Recent Bookings list
// --------------------------------------------
function renderRecentBookings(bookings, profilesById) {
    const listEl = document.getElementById('recentBookingsList');
    if (!listEl) return;

    if (!bookings.length) {
        listEl.innerHTML = `
            <div class="admin-recent-empty">
                <i class="fas fa-calendar-xmark" aria-hidden="true"></i>
                <p>No bookings yet</p>
                <span>Bookings will show up here once clients start booking.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = bookings.map(function (b) {
        const client = profilesById[b.user_id] || {};
        return `
            <div class="admin-recent-item">
                <div>
                    <div class="admin-recent-item-name">${escapeHtmlDash(client.full_name || 'Unnamed')}</div>
                    <div class="admin-recent-item-meta">${escapeHtmlDash(b.service_name || '\u2014')} with ${escapeHtmlDash(b.barber_name || '\u2014')}</div>
                </div>
                <span class="admin-status-badge admin-status-${b.status}">${b.status}</span>
            </div>
        `;
    }).join('');
}

function escapeHtmlDash(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// --------------------------------------------
// Total Registered Users — real data, from `profiles`
// --------------------------------------------
async function loadTotalUsers() {
    const { count, error } = await supabaseClient
        .from('profiles')
        .select('id', { count: 'exact', head: true });

    if (error) {
        console.error(error);
        setText('statTotalUsers', '—');
        return;
    }

    setText('statTotalUsers', count ?? 0);
}

// --------------------------------------------
// Low Stock Alerts — real data, from `products`. Counts active
// products at or under their own low_stock_threshold (per-product,
// not a single global number, since products.js's admin page lets
// each product set its own threshold).
// --------------------------------------------
async function loadLowStockCount() {
    const { data, error } = await supabaseClient
        .from('products')
        .select('stock_quantity, low_stock_threshold')
        .eq('is_active', true);

    if (error) {
        // Table may not exist yet on sites that haven't run
        // products_setup.sql — show the placeholder rather than an
        // alarming error on the dashboard.
        setText('statLowStock', '—');
        return;
    }

    const lowCount = (data || []).filter(p => p.stock_quantity <= (p.low_stock_threshold ?? 5)).length;
    setText('statLowStock', lowCount);
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}