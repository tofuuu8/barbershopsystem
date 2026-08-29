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
    // Each of these hits its own tables and updates its own DOM section,
    // so they're independent — run them in parallel instead of one
    // sequential await chain. allSettled also means a failure in one
    // (e.g. a missing table, a thrown error) can no longer silently
    // block the loaders queued after it, the way loadTopBarbers throwing
    // used to prevent loadRecentOrders from ever running.
    const results = await Promise.allSettled([
        loadTotalUsers(),
        loadBookingStats(),
        loadLowStockCount(),
        loadTopServices(),
        loadTopBarbers(),
        loadRecentOrders()
    ]);

    results.forEach(function (r) {
        if (r.status === 'rejected') console.error('Dashboard section failed to load:', r.reason);
    });
}

// --------------------------------------------
// Bookings — real data, from `bookings`. Powers the top stat row
// (Revenue/Appointments Today, Pending), the Weekly Revenue chart,
// and the Recent Bookings list.
// --------------------------------------------
async function loadBookingStats() {
    const todayStr = manilaDateStr(0);

    // ============================================
    // LOAD BOOKINGS TODAY
    // ============================================
    const { data: bookings, error: bookingsError } = await supabaseClient
        .from('bookings')
        .select('id, user_id, service_name, barber_name, booking_date, booking_time, total_price, status, created_at')
        .eq('booking_date', todayStr)
        .order('created_at', { ascending: false })
        .limit(500);

    if (bookingsError) {
        console.error('Error loading bookings:', bookingsError);
        return;
    }

    // ============================================
    // LOAD ORDERS TODAY
    // ============================================
    const { data: orders, error: ordersError } = await supabaseClient
        .from('orders')
        .select('id, customer_name, total_price, status, created_at')
        .gte('created_at', todayStr + 'T00:00:00+08:00')
        .lte('created_at', todayStr + 'T23:59:59+08:00')
        .limit(500);

    if (ordersError) {
        console.error('Error loading orders:', ordersError);
    }

    // ============================================
    // CALCULATE REVENUE (Bookings + Orders)
    // ============================================
    const todaysBookings = (bookings || []).filter(b => b.status !== 'cancelled');
    const todaysOrders = (orders || []).filter(o => o.status === 'completed');

    // Revenue from bookings (confirmed + completed)
    const bookingRevenue = todaysBookings
        .filter(b => b.status === 'confirmed' || b.status === 'completed')
        .reduce((sum, b) => sum + (Number(b.total_price) || 0), 0);

    // Revenue from orders (completed only)
    const orderRevenue = todaysOrders
        .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

    // Total revenue = bookings + orders
    const totalRevenue = bookingRevenue + orderRevenue;

    const pending = (bookings || []).filter(b => b.status === 'pending');

    // ============================================
    // UPDATE STATS
    // ============================================
    setText('statRevenueToday', 'PHP ' + totalRevenue.toLocaleString('en-PH'));
    setText('statAppointmentsToday', todaysBookings.length);
    setText('statPendingAppointments', pending.length);

    // ============================================
    // LOAD PROFILES FOR RECENT BOOKINGS
    // ============================================
    const userIds = (bookings || []).map(b => b.user_id).filter(Boolean);
    let profilesById = {};
    if (userIds.length) {
        const { data: profiles } = await supabaseClient
            .from('profiles')
            .select('id, full_name')
            .in('id', userIds);
        if (profiles) {
            profilesById = Object.fromEntries(profiles.map(p => [p.id, p]));
        }
    }

    // ============================================
    // RENDER RECENT BOOKINGS (Exclude cancelled)
    // ============================================
    const recentBookings = (bookings || [])
        .filter(b => b.status !== 'cancelled')
        .slice(0, 5);
    renderRecentBookings(recentBookings, profilesById);

    // ============================================
    // RENDER WEEKLY REVENUE CHART
    // ============================================
    // Load more bookings for the chart (last 7 days)
    const { data: weekBookings } = await supabaseClient
        .from('bookings')
        .select('booking_date, total_price, status')
        .gte('booking_date', getDateDaysAgo(7))
        .lte('booking_date', todayStr)
        .in('status', ['confirmed', 'completed']);

    const { data: weekOrders } = await supabaseClient
        .from('orders')
        .select('created_at, total_price, status')
        .gte('created_at', getDateDaysAgo(7) + 'T00:00:00+08:00')
        .lte('created_at', todayStr + 'T23:59:59+08:00')
        .eq('status', 'completed');

    const combinedRevenue = {};
    
    // Add bookings
    (weekBookings || []).forEach(b => {
        const date = b.booking_date;
        combinedRevenue[date] = (combinedRevenue[date] || 0) + (Number(b.total_price) || 0);
    });

    // Add orders — bucket by the Manila calendar date the order falls on,
    // not created_at's raw UTC date (which can be off by a day near midnight).
    (weekOrders || []).forEach(o => {
        const date = toManilaDateStr(o.created_at);
        combinedRevenue[date] = (combinedRevenue[date] || 0) + (Number(o.total_price) || 0);
    });

    renderWeeklyRevenueChart(combinedRevenue);
}

// ============================================================
// HELPER: Manila-timezone-aware dates
// ============================================================
// The business runs on Philippine time (UTC+8), but new Date().toISOString()
// always gives the UTC calendar date. Near midnight PH time (which is still
// mid-afternoon/morning UTC on the other side of the date line) that used to
// make "today" resolve to the wrong day, skewing Revenue/Appointments Today
// and mis-bucketing the weekly chart. These helpers anchor everything to the
// Manila calendar date instead.

// Returns a Date object at UTC-midnight representing the Manila calendar
// date `offsetDays` away from now (0 = today, -7 = a week ago, etc).
function manilaDateParts(offsetDays) {
    offsetDays = offsetDays || 0;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    const base = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
    base.setUTCDate(base.getUTCDate() + offsetDays);
    return base;
}

// 'YYYY-MM-DD' string for the Manila calendar date `offsetDays` away from now.
function manilaDateStr(offsetDays) {
    return manilaDateParts(offsetDays).toISOString().slice(0, 10);
}

// Converts a timestamptz string (e.g. an order's created_at, stored in UTC)
// into the 'YYYY-MM-DD' it falls on in Manila time — NOT the same as
// timestamp.split('T')[0], which gives the UTC date.
function toManilaDateStr(isoTimestamp) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(isoTimestamp));
}

// Kept for the two callers (loadTopServices/loadTopBarbers) that only need
// a "N days ago" boundary for a .gte() filter on a plain date column.
function getDateDaysAgo(days) {
    return manilaDateStr(-days);
}

// --------------------------------------------
// Weekly Revenue graph — last 7 days (oldest to newest, ending today),
// confirmed + completed bookings only (pending/cancelled aren't real
// revenue yet).
// --------------------------------------------
function renderWeeklyRevenueChart(dailyTotals) {
    const chartEl = document.getElementById('weeklyRevenueChart');
    const barsWrap = chartEl ? chartEl.querySelector('.admin-chart-bars') : null;
    const emptyEl = chartEl ? chartEl.querySelector('.admin-chart-empty') : null;
    if (!barsWrap) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
        days.push(manilaDateParts(-i));
    }

    const dayTotals = days.map(function (d) {
        const dateStr = d.toISOString().slice(0, 10);
        const total = dailyTotals[dateStr] || 0;
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
        const label = d.date.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' });
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
        // ✅ FIX: Get proper status badge
        const statusBadge = getStatusBadge(b.status);
        
        return `
            <div class="admin-recent-item">
                <div>
                    <div class="admin-recent-item-name">${escapeHtml(client.full_name || 'Unnamed')}</div>
                    <div class="admin-recent-item-meta">${escapeHtml(b.service_name || '\u2014')} with ${escapeHtml(b.barber_name || '\u2014')}</div>
                </div>
                ${statusBadge}
            </div>
        `;
    }).join('');
}

// ✅ ADD THIS HELPER
function getStatusBadge(status) {
    const labels = {
        'pending': 'Pending',
        'confirmed': 'Confirmed',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
    };
    const safeStatus = status || 'unknown';
    const label = labels[safeStatus] || status || 'Unknown';
    const colorClass = `admin-status-${safeStatus}`;
    return `<span class="admin-status-badge ${colorClass}">${label}</span>`;
}

// Canonical escaping helper for this page. dashboard.html does NOT load
// main.js, so we can't rely on main.js's escapeHtml() — every render
// function below uses this one instead (renderRecentBookings used to
// call a separate escapeHtmlDash(); loadTopBarbers/loadRecentOrders used
// to call the undefined main.js escapeHtml(), which threw and silently
// killed everything queued after it in loadDashboard()).
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// Was called by loadRecentOrders() but never defined anywhere in the
// admin JS — every "Recent Orders" render threw a ReferenceError.
function formatPHP(amount) {
    return 'PHP ' + (Number(amount) || 0).toLocaleString('en-PH');
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

async function loadTopServices() {
    const { data, error } = await supabaseClient
        .from('bookings')
        .select('service_name, total_price, status')
        .in('status', ['completed', 'confirmed'])
        .gte('booking_date', getDateDaysAgo(30));

    if (error) {
        console.error('Error loading top services:', error);
        return;
    }

    // Count services
    const serviceCounts = {};
    (data || []).forEach(b => {
        const name = b.service_name || 'Unknown';
        serviceCounts[name] = (serviceCounts[name] || 0) + 1;
    });

    // Sort and get top 5
    const sorted = Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const listEl = document.getElementById('topServicesList');
    if (!listEl) return;

    if (!sorted.length) {
        listEl.innerHTML = `
            <div class="admin-recent-empty">
                <i class="fas fa-scissors" aria-hidden="true"></i>
                <p>No service data yet</p>
                <span>Popular services will appear here once you have bookings.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = sorted.map(([name, count], index) => `
        <div class="admin-recent-item">
            <div>
                <div class="admin-recent-item-name">${index + 1}. ${escapeHtml(name)}</div>
                <div class="admin-recent-item-meta">${count} bookings</div>
            </div>
            <span class="admin-badge">${count}x</span>
        </div>
    `).join('');
}

// ============================================================
// TOP BARBERS
// ============================================================
async function loadTopBarbers() {
    const { data, error } = await supabaseClient
        .from('bookings')
        .select('barber_name, status')
        .in('status', ['completed', 'confirmed'])
        .gte('booking_date', getDateDaysAgo(30))
        .not('barber_name', 'is', null);

    if (error) {
        console.error('Error loading top barbers:', error);
        return;
    }

    const barberCounts = {};
    (data || []).forEach(b => {
        const name = b.barber_name || 'Unknown';
        barberCounts[name] = (barberCounts[name] || 0) + 1;
    });

    const sorted = Object.entries(barberCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const listEl = document.getElementById('topBarbersList');
    if (!listEl) return;

    if (!sorted.length) {
        listEl.innerHTML = `
            <div class="admin-recent-empty">
                <i class="fas fa-user-tie" aria-hidden="true"></i>
                <p>No barber data yet</p>
                <span>Barber performance will appear here once you have bookings.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = sorted.map(([name, count], index) => `
        <div class="admin-recent-item">
            <div>
                <div class="admin-recent-item-name">${index + 1}. ${escapeHtml(name)}</div>
                <div class="admin-recent-item-meta">${count} bookings</div>
            </div>
            <span class="admin-badge">${count}x</span>
        </div>
    `).join('');
}
// ============================================================
// RECENT ORDERS
// ============================================================
async function loadRecentOrders() {
    const { data, error } = await supabaseClient
        .from('orders')
        .select('id, customer_name, total_price, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error loading recent orders:', error);
        return;
    }

    const listEl = document.getElementById('recentOrdersList');
    if (!listEl) return;

    if (!data || !data.length) {
        listEl.innerHTML = `
            <div class="admin-recent-empty">
                <i class="fas fa-box" aria-hidden="true"></i>
                <p>No orders yet</p>
                <span>Orders will appear here once customers start ordering.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = data.map(order => `
        <div class="admin-recent-item">
            <div>
                <div class="admin-recent-item-name">${escapeHtml(order.customer_name || 'Guest')}</div>
                <div class="admin-recent-item-meta">${formatPHP(order.total_price)}</div>
            </div>
            <span class="admin-status-badge admin-status-${order.status || 'pending'}">${order.status || 'Pending'}</span>
        </div>
    `).join('');
}