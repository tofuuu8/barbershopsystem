// ============================================================
// ADMIN — REVENUE PAGE
// ============================================================

let allTransactions = [];
let currentAdmin = null;
let revenueData = [];

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return;

    document.getElementById('adminSidebarEmail').textContent = currentAdmin.email;
    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogOut);

    initRevenueFilters();
    await loadRevenueData();
});

// ============================================================
// INIT FILTERS
// ============================================================

// ============================================================
// INIT REVENUE FILTERS (WITH ACTIVE STATE)
// ============================================================

function initRevenueFilters() {
    // Set default date range (last 30 days) — anchored to the Manila
    // calendar date (see manilaDateStr() below), not UTC. Business runs
    // on UTC+8, so using toISOString() here would show yesterday's date
    // for the first 8 hours of every Manila day.
    document.getElementById('revenueStartDate').value = manilaDateStr(-30);
    document.getElementById('revenueEndDate').value = manilaDateStr(0);

    // ============================================
    // HELPER: Update active state ng buttons
    // ============================================
    function setActiveButton(activeId) {
        const buttons = ['revenueTodayBtn', 'revenueWeekBtn', 'revenueMonthBtn', 'revenueFilterBtn'];
        buttons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.classList.remove('active');
            }
        });
        if (activeId) {
            const activeBtn = document.getElementById(activeId);
            if (activeBtn) {
                activeBtn.classList.add('active');
            }
        }
    }

    // ============================================
    // APPLY BUTTON (Custom Range)
    // ============================================
    document.getElementById('revenueFilterBtn').addEventListener('click', function() {
        console.log('📅 Apply button clicked');
        setActiveButton('revenueFilterBtn');
        loadRevenueData();
    });

    // ============================================
    // TODAY BUTTON
    // ============================================
    document.getElementById('revenueTodayBtn').addEventListener('click', function() {
        console.log('📅 Today button clicked');
        const today = manilaDateStr(0);
        document.getElementById('revenueStartDate').value = today;
        document.getElementById('revenueEndDate').value = today;
        setActiveButton('revenueTodayBtn');
        loadRevenueData();
    });

    // ============================================
    // THIS WEEK BUTTON
    // ============================================
    document.getElementById('revenueWeekBtn').addEventListener('click', function() {
        console.log('📅 This Week button clicked');
        document.getElementById('revenueStartDate').value = manilaDateStr(-7);
        document.getElementById('revenueEndDate').value = manilaDateStr(0);
        setActiveButton('revenueWeekBtn');
        loadRevenueData();
    });

    // ============================================
    // THIS MONTH BUTTON
    // ============================================
    document.getElementById('revenueMonthBtn').addEventListener('click', function() {
        console.log('📅 This Month button clicked');
        document.getElementById('revenueStartDate').value = manilaMonthStartStr();
        document.getElementById('revenueEndDate').value = manilaDateStr(0);
        setActiveButton('revenueMonthBtn');
        loadRevenueData();
    });

    // Load data on page load happens once, from the DOMContentLoaded
    // handler below — not here, to avoid firing loadRevenueData() twice
    // on every page load.
}

// ============================================================
// LOAD REVENUE DATA
// ============================================================

async function loadRevenueData() {
    const startDate = document.getElementById('revenueStartDate').value;
    const endDate = document.getElementById('revenueEndDate').value;

    if (!startDate || !endDate) {
        showToast('Please select a date range.', 'warning');
        return;
    }

    console.log('📅 Date range:', startDate, 'to', endDate);

    // ============================================
    // LOAD COMPLETED BOOKINGS ONLY
    // ============================================
    const { data: bookings, error: bookingsError } = await supabaseClient
        .from('bookings')
        .select('id, user_id, service_name, total_price, status, booking_date, created_at')
        .gte('booking_date', startDate)
        .lte('booking_date', endDate)
        .eq('status', 'completed');  // ← COMPLETED LANG!

    if (bookingsError) {
        console.error('Error loading bookings:', bookingsError);
        showToast('Error loading revenue data', 'error');
        return;
    }

    console.log('📊 Completed bookings found:', bookings?.length || 0);

    // ============================================
    // LOOK UP BOOKING CUSTOMER NAMES
    // ============================================
    // bookings only stores user_id — resolve to a display name the same
    // way dashboard.js's loadBookingStats() does, so the table shows
    // actual customer names instead of raw UUIDs.
    const bookingUserIds = (bookings || []).map(b => b.user_id).filter(Boolean);
    let profilesById = {};
    if (bookingUserIds.length) {
        const { data: profiles } = await supabaseClient
            .from('profiles')
            .select('id, full_name')
            .in('id', bookingUserIds);
        if (profiles) profilesById = Object.fromEntries(profiles.map(p => [p.id, p]));
    }

    // ============================================
    // LOAD COMPLETED ORDERS ONLY
    // ============================================
    const { data: orders, error: ordersError } = await supabaseClient
        .from('orders')
        .select('id, customer_name, total_price, status, created_at')
        .gte('created_at', startDate + 'T00:00:00+08:00')
        .lte('created_at', endDate + 'T23:59:59+08:00')
        .eq('status', 'completed');  // ← COMPLETED LANG!

    if (ordersError) {
        console.error('Error loading orders:', ordersError);
    }

    console.log('📦 Completed orders found:', orders?.length || 0);

    // ============================================
    // COMBINE TRANSACTIONS
    // ============================================
    const bookingTransactions = (bookings || []).map(b => ({
        date: b.booking_date,
        type: 'Booking',
        customer: (profilesById[b.user_id] && profilesById[b.user_id].full_name) || 'Guest',
        item: b.service_name || 'Service',
        amount: b.total_price || 0,
        status: b.status
    }));

    const orderTransactions = (orders || []).map(o => ({
        date: toManilaDateStr(o.created_at),
        type: 'Order',
        customer: o.customer_name || 'Guest',
        item: 'Product Order',
        amount: o.total_price || 0,
        status: o.status
    }));

    allTransactions = [...bookingTransactions, ...orderTransactions];
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log('💰 Total transactions:', allTransactions.length);
    console.log('💰 Total revenue:', allTransactions.reduce((sum, t) => sum + t.amount, 0));

    renderStats();
    renderRevenueTrend();
    renderRevenueBreakdown();
    renderTable();
}

// ============================================================
// RENDER STATS
// ============================================================

function renderStats() {
    const totalRevenue = allTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalOrders = allTransactions.length;
    const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    document.getElementById('statTotalRevenue').textContent = 'PHP ' + totalRevenue.toLocaleString('en-PH');
    document.getElementById('statTotalOrders').textContent = totalOrders;
    document.getElementById('statAvgOrder').textContent = 'PHP ' + avgOrder.toLocaleString('en-PH');
}

// ============================================================
// RENDER REVENUE TREND
// ============================================================

function renderRevenueTrend() {
    const barsWrap = document.getElementById('revenueTrendBars');
    const emptyEl = document.getElementById('revenueTrendEmpty');

    if (!allTransactions.length) {
        barsWrap.style.display = 'none';
        emptyEl.style.display = '';
        return;
    }

    barsWrap.style.display = '';
    emptyEl.style.display = 'none';

    // Group by date
    const dailyTotals = {};
    allTransactions.forEach(t => {
        dailyTotals[t.date] = (dailyTotals[t.date] || 0) + t.amount;
    });

    const sortedDates = Object.keys(dailyTotals).sort();
    const maxTotal = Math.max(...Object.values(dailyTotals), 0);

    barsWrap.innerHTML = sortedDates.map(date => {
        const total = dailyTotals[date];
        const heightPct = maxTotal > 0 ? Math.max((total / maxTotal) * 100, 4) : 4;
        const dateObj = new Date(date);
        const label = dateObj.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        return `
            <div class="admin-chart-bar-col" title="${label}: PHP ${total.toLocaleString('en-PH')}">
                <div class="admin-chart-bar" style="height: ${heightPct}%; background: var(--good);"></div>
                <span>${label}</span>
            </div>
        `;
    }).join('');
}

// ============================================================
// RENDER REVENUE BREAKDOWN
// ============================================================

function renderRevenueBreakdown() {
    const barsWrap = document.getElementById('revenueBreakdownBars');
    const emptyEl = document.getElementById('revenueBreakdownEmpty');

    if (!allTransactions.length) {
        barsWrap.innerHTML = '';
        emptyEl.style.display = '';
        return;
    }

    emptyEl.style.display = 'none';

    // Group by type
    const bookingTotal = allTransactions.filter(t => t.type === 'Booking').reduce((sum, t) => sum + t.amount, 0);
    const orderTotal = allTransactions.filter(t => t.type === 'Order').reduce((sum, t) => sum + t.amount, 0);
    const total = bookingTotal + orderTotal;

    const bookingPct = total > 0 ? Math.round((bookingTotal / total) * 100) : 0;
    const orderPct = total > 0 ? Math.round((orderTotal / total) * 100) : 0;

    barsWrap.innerHTML = `
        <div style="width:100%; text-align:center; margin-bottom:10px;">
            <div style="display:flex; justify-content:center; gap:40px; margin-bottom:16px;">
                <div>
                    <div style="font-family:var(--font-display); font-size:1.4rem; color:var(--good);">${bookingPct}%</div>
                    <div style="font-family:var(--font-ui); font-size:0.65rem; color:var(--dim); letter-spacing:1px; text-transform:uppercase;">Bookings</div>
                    <div style="font-family:var(--font-body); font-size:0.8rem; color:var(--off);">PHP ${bookingTotal.toLocaleString('en-PH')}</div>
                </div>
                <div>
                    <div style="font-family:var(--font-display); font-size:1.4rem; color:var(--steel);">${orderPct}%</div>
                    <div style="font-family:var(--font-ui); font-size:0.65rem; color:var(--dim); letter-spacing:1px; text-transform:uppercase;">Orders</div>
                    <div style="font-family:var(--font-body); font-size:0.8rem; color:var(--off);">PHP ${orderTotal.toLocaleString('en-PH')}</div>
                </div>
            </div>
            <div style="display:flex; height:20px; border-radius:10px; overflow:hidden; background:var(--card-light);">
                <div style="width:${bookingPct}%; background:var(--good);"></div>
                <div style="width:${orderPct}%; background:var(--steel);"></div>
            </div>
        </div>
    `;
}

// ============================================================
// RENDER TABLE
// ============================================================

function renderTable() {
    const tbody = document.getElementById('revenueTableBody');

    if (!allTransactions.length) {
        tbody.innerHTML = '<tr class="admin-empty-row"><td colspan="6">No transactions in this date range.</td></tr>';
        return;
    }

    tbody.innerHTML = allTransactions.slice(0, 100).map(t => `
        <tr>
            <td>${formatDate(t.date)}</td>
            <td><span class="admin-badge">${t.type}</span></td>
            <td>${escapeHtml(t.customer)}</td>
            <td>${escapeHtml(t.item)}</td>
            <td><strong>PHP ${t.amount.toLocaleString('en-PH')}</strong></td>
            <td>${getStatusBadge(t.status)}</td>
        </tr>
    `).join('');
}

// ============================================================
// HELPERS
// ============================================================

// ============================================================
// HELPERS: Manila-timezone-aware dates
// ============================================================
// Same fix as dashboard.js — the business runs on Philippine time
// (UTC+8), but new Date().toISOString() always gives the UTC calendar
// date. For the first ~8 hours of every Manila day that's still the
// previous UTC date, which used to make "Today"/default ranges land on
// the wrong day and mis-bucket order transactions by a day. These
// helpers anchor everything to the Manila calendar date instead.

function manilaDateStr(offsetDays) {
    offsetDays = offsetDays || 0;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    const base = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
    base.setUTCDate(base.getUTCDate() + offsetDays);
    return base.toISOString().slice(0, 10);
}

// 'YYYY-MM-01' for the 1st of the current Manila calendar month.
function manilaMonthStartStr() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return `${map.year}-${map.month}-01`;
}

// Converts a timestamptz string (an order's created_at, stored in UTC)
// into the 'YYYY-MM-DD' it falls on in Manila time.
function toManilaDateStr(isoTimestamp) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(isoTimestamp));
}

function getStatusBadge(status) {
    const colors = {
        'confirmed': 'admin-status-confirmed',
        'completed': 'admin-status-completed',
        'pending': 'admin-status-pending',
        'cancelled': 'admin-status-cancelled'
    };
    return `<span class="admin-status-badge ${colors[status] || 'admin-status-pending'}">${status}</span>`;
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-PH', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    let toast = document.getElementById('adminToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'adminToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: all 0.3s ease;
            transform: translateY(100px);
            opacity: 0;
        `;
        document.body.appendChild(toast);
    }
    const colors = { success: '#16a34a', error: '#dc2626', warning: '#d97706' };
    toast.textContent = message;
    toast.style.backgroundColor = colors[type] || colors.success;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
    }, 3000);
}