// ============================================================
// ADMIN — NOTIFICATIONS CENTER (COMPLETE)
// ============================================================
// Loaded after admin-auth.js, before the page's own script.
// Every page shows the exact same notifications.

const NOTIF_WINDOW_HOURS = 48;
const NOTIF_LOAD_LIMIT = 5;

let notifAccountCount = 0;
let notifBookingCount = 0;
let notifOrderCount = 0;
let notifProductCount = 0;
let notifLiveChannels = [];

// ============================================================
// DOMContentLoaded — Initialize bell
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('notifBtn');
    const panel = document.getElementById('notifPanel');
    if (!btn || !panel) return;

    // Toggle panel
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
            markNotificationsAsRead();
        }
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
            panel.hidden = true;
        }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') panel.hidden = true;
    });

    // Load all notifications
    loadAccountNotifications();
    loadBookingNotifications();
    loadOrderNotifications();
    loadProductNotifications();

    // Set up real-time subscriptions
    setupRealTimeNotifications();

    // Refresh every 60 seconds
    setInterval(function() {
        loadAccountNotifications();
        loadBookingNotifications();
        loadOrderNotifications();
        loadProductNotifications();
    }, 60000);
});

// ============================================================
// REAL-TIME SUBSCRIPTIONS
// ============================================================
function setupRealTimeNotifications() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient.channel) return;

    // Accounts
    const accountChannel = supabaseClient
        .channel('notif-accounts')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'profiles' },
            () => loadAccountNotifications()
        )
        .subscribe();

    // Bookings
    const bookingChannel = supabaseClient
        .channel('notif-bookings')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'bookings' },
            () => loadBookingNotifications()
        )
        .subscribe();

    // Orders
    const orderChannel = supabaseClient
        .channel('notif-orders')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'orders' },
            () => loadOrderNotifications()
        )
        .subscribe();

    // Products (low stock)
    const productChannel = supabaseClient
        .channel('notif-products')
        .on('postgres_changes', 
            { event: 'UPDATE', schema: 'public', table: 'products' },
            () => loadProductNotifications()
        )
        .subscribe();

    notifLiveChannels = [accountChannel, bookingChannel, orderChannel, productChannel];
}

// ============================================================
// ACCOUNTS — New signups from `profiles`
// ============================================================
async function loadAccountNotifications() {
    const listEl = document.getElementById('notifAccounts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    notifAccountCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">Loading...</div>`;

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
                    <p><strong>${escapeHtmlNotif(u.full_name || u.email || 'New User')}</strong> signed up</p>
                    <span>${timeAgoNotif(u.created_at)}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading accounts:', err);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load accounts.</div>`;
    }
}

// ============================================================
// BOOKINGS — New appointments from `bookings`
// ============================================================
async function loadBookingNotifications() {
    const listEl = document.getElementById('notifBookings');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    notifBookingCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">Loading...</div>`;

    try {
        const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseClient
            .from('bookings')
            .select('id, service_name, barber_name, created_at')
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
                    <p><strong>${escapeHtmlNotif(b.service_name || 'New booking')}</strong> with ${escapeHtmlNotif(b.barber_name || 'Unassigned')}</p>
                    <span>${timeAgoNotif(b.created_at)}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading bookings:', err);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load bookings.</div>`;
    }
}

// ============================================================
// ORDERS — New orders from `orders`
// ============================================================
async function loadOrderNotifications() {
    const listEl = document.getElementById('notifOrders');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    notifOrderCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">Loading...</div>`;

    try {
        const since = new Date(Date.now() - NOTIF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseClient
            .from('orders')
            .select('id, customer_name, total_price, status, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(NOTIF_LOAD_LIMIT);

        if (error) throw error;

        const orders = data || [];
        notifOrderCount = orders.length;
        refreshNotifBadge();

        if (!orders.length) {
            listEl.innerHTML = `<div class="admin-notif-empty">No new orders recently.</div>`;
            return;
        }

        listEl.innerHTML = orders.map(o => `
            <div class="admin-notif-item">
                <div class="admin-notif-item-icon"><i class="fas fa-bag-shopping" aria-hidden="true"></i></div>
                <div class="admin-notif-item-body">
                    <p><strong>${escapeHtmlNotif(o.customer_name || 'New order')}</strong> — PHP ${(o.total_price || 0).toLocaleString()}</p>
                    <span>${timeAgoNotif(o.created_at)}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading orders:', err);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load orders.</div>`;
    }
}

// ============================================================
// PRODUCTS — Low stock alerts from `products`
// ============================================================
async function loadProductNotifications() {
    const listEl = document.getElementById('notifProducts');
    if (!listEl || typeof supabaseClient === 'undefined') return;

    notifProductCount = 0;
    refreshNotifBadge();
    listEl.innerHTML = `<div class="admin-notif-empty">Loading...</div>`;

    try {
        // Get products with stock <= low_stock_threshold
        const { data, error } = await supabaseClient
            .from('products')
            .select('id, product_name, stock_quantity, low_stock_threshold')
            .eq('is_active', true)
            .order('stock_quantity', { ascending: true })
            .limit(NOTIF_LOAD_LIMIT);

        if (error) throw error;

        // Filter products that are low stock
        const lowStockProducts = (data || []).filter(p => 
            p.stock_quantity <= (p.low_stock_threshold || 5)
        );

        notifProductCount = lowStockProducts.length;
        refreshNotifBadge();

        if (!lowStockProducts.length) {
            listEl.innerHTML = `<div class="admin-notif-empty">All products in stock ✅</div>`;
            return;
        }

        listEl.innerHTML = lowStockProducts.map(p => `
            <div class="admin-notif-item">
                <div class="admin-notif-item-icon"><i class="fas fa-box" aria-hidden="true"></i></div>
                <div class="admin-notif-item-body">
                    <p><strong>${escapeHtmlNotif(p.product_name || 'Product')}</strong> — ${p.stock_quantity} left</p>
                    <span>⚠️ Low stock (threshold: ${p.low_stock_threshold || 5})</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading products:', err);
        listEl.innerHTML = `<div class="admin-notif-empty">Couldn't load products.</div>`;
    }
}

// ============================================================
// MARK AS READ
// ============================================================
function markNotificationsAsRead() {
    try {
        localStorage.setItem('adminNotifLastSeen', new Date().toISOString());
        notifAccountCount = 0;
        notifBookingCount = 0;
        notifOrderCount = 0;
        notifProductCount = 0;
        refreshNotifBadge();
    } catch (e) {
        console.warn('Could not save last seen timestamp:', e);
    }
}

// ============================================================
// BADGE — Combined count
// ============================================================
function refreshNotifBadge() {
    const total = notifAccountCount + notifBookingCount + notifOrderCount + notifProductCount;
    setNotifBadge(total);
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

// ============================================================
// HELPERS
// ============================================================
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
    div.textContent = String(str || '');
    return div.innerHTML;
}

// ============================================================
// CLEANUP
// ============================================================
window.addEventListener('beforeunload', function () {
    if (notifLiveChannels && notifLiveChannels.length) {
        notifLiveChannels.forEach(channel => {
            if (channel && typeof channel.unsubscribe === 'function') {
                channel.unsubscribe();
            }
        });
    }
});