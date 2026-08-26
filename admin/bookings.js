// ============================================================
// ADMIN — BOOKINGS PAGE
// ============================================================
// Reads `bookings` directly through the anon-key client, same pattern
// as users.js reads `profiles` — admin-only visibility comes from the
// is_admin() RLS policies, not a special key here.
//
// `bookings.user_id` references auth.users.id, not profiles directly,
// so client names/emails/phones are joined client-side against a
// profiles map fetched alongside the bookings (same "look up by id in
// a small map" pattern cart.js uses for product images).
//
// DELETE — once a booking's status is 'cancelled', its row gets a
// Delete action (same icon-button convention as users.js's row
// actions) alongside the existing View/Update eye button. This is a
// real DELETE, not a status change, so it removes the row outright —
// same table the customer's My Appointments page reads, so a booking
// deleted here (or self-deleted by the customer once it's cancelled)
// disappears from both places at once.

let allBookings = [];
let profilesById = {};
let currentAdmin = null;
let activeStatusFilter = 'all';
let activeBookingId = null; // whoever the detail modal is currently open for
let availableBarbers = [];

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return; // already redirected

    const emailEl = document.getElementById('adminSidebarEmail');
    if (emailEl) emailEl.textContent = currentAdmin.email;

    initLogout();
    initSearch();
    initStatusPills();
    initBookingModal();
    await loadBarberOptions();
    await loadBookings();
});

function initLogout() {
    const btn = document.getElementById('adminLogoutBtn');
    if (btn) btn.addEventListener('click', adminLogOut);
}

// --------------------------------------------
// Load
// --------------------------------------------
async function loadBookings() {
    const tbody = document.getElementById('bookingsTableBody');

    const [bookingsRes, profilesRes] = await Promise.all([
        supabaseClient
            .from('bookings')
            .select('*')
            .order('booking_date', { ascending: false })
            .order('booking_time', { ascending: false })
            .limit(1000), // plenty for a first version; add real pagination if this ever gets clipped
        supabaseClient
            .from('profiles')
            .select('id, full_name, email, phone')
    ]);

    if (bookingsRes.error) {
        console.error(bookingsRes.error);
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="8">Couldn\u2019t load bookings — ${escapeHtml(bookingsRes.error.message || 'please refresh.')}</td></tr>`;
        return;
    }

    profilesById = {};
    (profilesRes.data || []).forEach(function (p) { profilesById[p.id] = p; });

    allBookings = bookingsRes.data || [];

    renderStats();
    applyFilters();
}

// --------------------------------------------
// Stats
// --------------------------------------------
function renderStats() {
    const todayStr = localDateString(new Date());

    const today = allBookings.filter(b => b.booking_date === todayStr && b.status !== 'cancelled').length;
    const pending = allBookings.filter(b => b.status === 'pending').length;
    const revenue = allBookings
        .filter(b => b.status === 'confirmed' || b.status === 'completed')
        .reduce((sum, b) => sum + (Number(b.total_price) || 0), 0);

    setText('statTotalBookings', allBookings.length);
    setText('statTodayBookings', today);
    setText('statPendingBookings', pending);
    setText('statRevenueBookings', formatPHP(revenue));
}

// --------------------------------------------
// Filters — search + status pills combined
// --------------------------------------------
function initSearch() {
    const input = document.getElementById('bookingSearchInput');
    if (!input) return;
    input.addEventListener('input', applyFilters);
}

function initStatusPills() {
    const wrap = document.getElementById('statusFilterPills');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
        const btn = e.target.closest('.admin-filter-pill');
        if (!btn) return;
        wrap.querySelectorAll('.admin-filter-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        activeStatusFilter = btn.dataset.status;
        applyFilters();
    });
}

function applyFilters() {
    const input = document.getElementById('bookingSearchInput');
    const q = input ? input.value.trim().toLowerCase() : '';

    let filtered = allBookings;

    if (activeStatusFilter !== 'all') {
        filtered = filtered.filter(b => b.status === activeStatusFilter);
    }

    if (q) {
        filtered = filtered.filter(function (b) {
            const client = profilesById[b.user_id] || {};
            return (client.full_name || '').toLowerCase().includes(q) ||
                (client.email || '').toLowerCase().includes(q) ||
                (client.phone || '').toLowerCase().includes(q) ||
                (b.barber_name || '').toLowerCase().includes(q) ||
                (b.service_name || '').toLowerCase().includes(q);
        });
    }

    renderTable(filtered);
}

// --------------------------------------------
// Table
// --------------------------------------------
function renderTable(bookings) {
    const tbody = document.getElementById('bookingsTableBody');
    const countEl = document.getElementById('bookingResultsCount');

    if (countEl) {
        countEl.textContent = `${bookings.length} of ${allBookings.length}`;
    }

    if (!bookings.length) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="8">No bookings match that filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = bookings.map(function (b) {
        const client = profilesById[b.user_id] || {};
        const clientName = client.full_name || 'Unnamed';
        const clientSub = client.email || client.phone || '';

        return `
        <tr data-id="${b.id}">
            <td>
                <span class="admin-cell-primary">${escapeHtml(clientName)}</span>
                ${clientSub ? `<span class="admin-cell-sub">${escapeHtml(clientSub)}</span>` : ''}
            </td>
            <td>
                ${escapeHtml(b.service_name || '\u2014')}
                <span class="admin-cell-tag">${b.gender === 'women' ? 'Women' : 'Men'}</span>
            </td>
            <td>${escapeHtml(b.barber_name || '\u2014')}</td>
            <td>${formatDateTime(b.booking_date, b.booking_time)}</td>
            <td>${b.location_type === 'home' ? 'Home Service' : 'In-Studio'}</td>
            <td>${formatPHP(b.total_price)}</td>
            <td>${getStatusBadge(b.status)}</td>
            <td>
                <div class="admin-action-btns">
                    <button type="button" class="admin-action-btn admin-action-edit" data-id="${b.id}" title="View / Update">
                        <i class="fas fa-eye" aria-hidden="true"></i>
                    </button>
                    ${b.status === 'cancelled' ? `
                    <button type="button" class="admin-action-btn admin-action-delete" data-action="delete" data-id="${b.id}" title="Delete">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>` : ''}
                </div>
            </td>
        </tr>
    `;
    }).join('');

    tbody.querySelectorAll('.admin-action-edit').forEach(btn => {
        btn.addEventListener('click', function () {
            openBookingModal(btn.dataset.id);
        });
    });

    tbody.querySelectorAll('.admin-action-delete').forEach(btn => {
        btn.addEventListener('click', function () {
            handleDeleteBooking(btn.dataset.id);
        });
    });
}

// --------------------------------------------
// Status badge
// --------------------------------------------
function getStatusBadge(status) {
    const labels = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
    const safeStatus = Object.prototype.hasOwnProperty.call(labels, status) ? status : 'unknown';
    const label = labels[status] || status || 'Unknown';
    return `<span class="admin-status-badge admin-status-${safeStatus}">${escapeHtml(label)}</span>`;
}

// --------------------------------------------
// Detail / status-update modal
// --------------------------------------------
async function loadBarberOptions() {
    const select = document.getElementById('bookingBarberSelect');
    const fallback = [
        { id: 'barber-russel', name: 'Barber Russel' },
        { id: 'klark-dizon', name: 'Barber Klark' },
        { id: 'barber-jon', name: 'Barber Jon' }
    ];
    availableBarbers = fallback;
    if (typeof supabaseClient !== 'undefined') {
        const { data, error } = await supabaseClient.from('barbers').select('id, name').eq('is_active', true).order('name');
        if (!error && data && data.length) availableBarbers = data;
    }
    if (select) {
        select.innerHTML = availableBarbers.map(function (barber) {
            const option = document.createElement('option');
            option.value = barber.id;
            option.textContent = barber.name;
            return option.outerHTML;
        }).join('');
    }
}

function initBookingModal() {
    const backdrop = document.getElementById('bookingModalBackdrop');
    const closeBtn = document.getElementById('bookingModalCloseBtn');
    const saveBtn = document.getElementById('bookingSaveBtn');
    const cancelBtn = document.getElementById('bookingCancelBtn');
    const viewReceiptBtn = document.getElementById('bookingViewReceiptBtn');

    if (backdrop) backdrop.addEventListener('click', closeBookingModal);
    if (closeBtn) closeBtn.addEventListener('click', closeBookingModal);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeBookingModal();
    });
    if (saveBtn) saveBtn.addEventListener('click', saveBookingStatus);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelBookingFromModal);
    if (viewReceiptBtn) viewReceiptBtn.addEventListener('click', function () {
        if (activeBookingId) openBookingReceipt(activeBookingId);
    });

    initBookingReceiptModal();
}

function openBookingModal(bookingId) {
    const booking = allBookings.find(b => b.id === bookingId);
    if (!booking) return;

    activeBookingId = bookingId;
    const client = profilesById[booking.user_id] || {};

    setText('bookingModalSub', `Booked ${formatCreatedAt(booking.created_at)}`);
    setText('detailClientName', client.full_name || 'Unnamed');

    const contactLine = booking.contact_preference === 'email'
        ? `Email \u2014 ${client.email || '\u2014'}`
        : `Phone (SMS/Call) \u2014 ${booking.contact_phone || client.phone || '\u2014'}`;
    setText('detailContact', contactLine);

    setText('detailService', `${booking.service_name || '\u2014'} (${booking.service_duration || '\u2014'})`);
    setText('detailBarber', booking.barber_name || '\u2014');
    setText('detailDateTime', formatDateTime(booking.booking_date, booking.booking_time));

    const locationText = booking.location_type === 'home'
        ? `Home Service \u2014 ${booking.area || ''}${booking.address ? ', ' + booking.address : ''}`
        : 'In-Studio';
    setText('detailLocation', locationText);

    let totalText = formatPHP(booking.total_price);
    if (booking.location_type === 'home' && booking.travel_fee) {
        totalText += ` (incl. ${formatPHP(booking.travel_fee)} travel fee)`;
    }
    setText('detailTotal', totalText);

    const adminNotesWrap = document.getElementById('detailAdminNotesWrap');
    if (adminNotesWrap) {
        adminNotesWrap.hidden = !booking.admin_notes;
        setText('detailAdminNotes', booking.admin_notes || '—');
    }

    const barberSelect = document.getElementById('bookingBarberSelect');
    if (barberSelect) barberSelect.value = booking.barber_id || '';
    const dateInput = document.getElementById('bookingDateInput');
    if (dateInput) dateInput.value = booking.booking_date || '';
    const timeInput = document.getElementById('bookingTimeInput');
    if (timeInput) timeInput.value = String(booking.booking_time || '').slice(0, 5);
    const adminNotesInput = document.getElementById('bookingAdminNotesInput');
    if (adminNotesInput) adminNotesInput.value = booking.admin_notes || '';

    const notesWrap = document.getElementById('detailNotesWrap');
    if (booking.notes) {
        notesWrap.hidden = false;
        setText('detailNotes', booking.notes);
    } else {
        notesWrap.hidden = true;
    }

    const select = document.getElementById('bookingStatusSelect');
    if (select) select.value = booking.status || 'pending';

    const cancelBtn = document.getElementById('bookingCancelBtn');
    if (cancelBtn) cancelBtn.disabled = booking.status === 'cancelled';

    setText('bookingSaveStatus', '');

    document.getElementById('bookingModalBackdrop').hidden = false;
    document.getElementById('bookingModal').hidden = false;
}

function closeBookingModal() {
    document.getElementById('bookingModalBackdrop').hidden = true;
    document.getElementById('bookingModal').hidden = true;
    activeBookingId = null;
}

// --------------------------------------------
// Receipt modal — same digital QR receipt the customer sees on
// booking.html / myappointments.html, viewable here too so front
// desk can verify a visitor's proof-of-booking without asking them
// to pull it up themselves.
// --------------------------------------------
function initBookingReceiptModal() {
    const backdrop = document.getElementById('bookingReceiptBackdrop');
    const closeBtn = document.getElementById('bookingReceiptCloseBtn');
    const downloadBtn = document.getElementById('bookingReceiptDownloadBtn');

    if (backdrop) backdrop.addEventListener('click', closeBookingReceipt);
    if (closeBtn) closeBtn.addEventListener('click', closeBookingReceipt);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeBookingReceipt();
    });
    if (downloadBtn) downloadBtn.addEventListener('click', downloadBookingReceipt);
}

function openBookingReceipt(bookingId) {
    const booking = allBookings.find(b => b.id === bookingId);
    if (!booking) return;

    const client = profilesById[booking.user_id] || {};
    const refId = String(booking.id || '').slice(0, 8).toUpperCase();
    const statusLabels = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
    const statusLabel = statusLabels[booking.status] || booking.status || 'Unknown';

    setText('bookingReceiptClient', client.full_name || client.email || client.phone || 'Unnamed client');
    setText('bookingReceiptService', `${booking.service_name || '\u2014'}${booking.service_duration ? ' (' + booking.service_duration + ')' : ''}`);
    setText('bookingReceiptBarber', booking.barber_name || '\u2014');
    setText('bookingReceiptLocation', booking.location_type === 'home'
        ? `Home Service${booking.area ? ' \u2014 ' + booking.area : ''}${booking.address ? ', ' + booking.address : ''}`
        : 'In-Studio');
    setText('bookingReceiptDateTime', formatDateTime(booking.booking_date, booking.booking_time));
    setText('bookingReceiptStatus', statusLabel);
    setText('bookingReceiptId', refId || '\u2014');

    // Open the modal FIRST, then render the QR — same fix as the
    // customer-facing myappointments.js. new QRCode(...) can throw
    // ("code length overflow") when the payload is too long for the
    // QR version it auto-selects, and an uncaught throw before these
    // two lines used to abort the whole function, so the modal never
    // opened and the View Receipt button looked dead.
    document.getElementById('bookingReceiptBackdrop').hidden = false;
    document.getElementById('bookingReceiptModal').hidden = false;

    renderBookingReceiptQr(booking, client, refId, statusLabel);
}

function closeBookingReceipt() {
    const backdrop = document.getElementById('bookingReceiptBackdrop');
    const modal = document.getElementById('bookingReceiptModal');
    if (backdrop) backdrop.hidden = true;
    if (modal) modal.hidden = true;
}

function renderBookingReceiptQr(booking, client, refId, statusLabel) {
    const container = document.getElementById('bookingReceiptQr');
    if (!container) return;
    container.innerHTML = '';

    if (typeof QRCode === 'undefined') {
        container.textContent = 'QR unavailable';
        return;
    }

    // Keep this short and capped — the bundled qrcode.min.js throws
    // ("code length overflow") instead of degrading gracefully once
    // the payload is too long for the QR version it auto-selects, and
    // an uncaught throw here used to blow up the whole receipt-opening
    // flow (see openBookingReceipt). Ref/Booking ID alone are enough
    // to look this appointment up in the admin panel.
    const qrPayload = [
        'TOUGHCUTS APPOINTMENT',
        `Ref: ${refId}`,
        `Booking ID: ${booking.id}`
    ].join('\n').slice(0, 200);

    try {
        new QRCode(container, {
            text: qrPayload,
            width: 126,
            height: 126,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L
        });
    } catch (err) {
        console.error('QR render failed:', err);
        container.textContent = 'QR unavailable';
    }
}

async function downloadBookingReceipt() {
    const node = document.getElementById('bookingReceiptCapture');
    const btn = document.getElementById('bookingReceiptDownloadBtn');
    if (!node || typeof html2canvas === 'undefined') {
        alert('Saving isn\u2019t available right now \u2014 please take a screenshot instead.');
        return;
    }

    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Preparing...';
    }

    try {
        const canvas = await html2canvas(node, { backgroundColor: '#17171a', scale: 2, useCORS: true });
        const refEl = document.getElementById('bookingReceiptId');
        const refText = (refEl && refEl.textContent && refEl.textContent !== '\u2014') ? refEl.textContent : 'receipt';

        const link = document.createElement('a');
        link.download = `toughcuts-appointment-${refText}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (err) {
        console.error(err);
        alert('Couldn\u2019t save the receipt \u2014 please try taking a screenshot instead.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

async function updateBookingStatus(newStatus) {
    if (!activeBookingId) return null;

    const payload = {
        status: newStatus,
        booking_date: document.getElementById('bookingDateInput').value,
        booking_time: document.getElementById('bookingTimeInput').value,
        barber_id: document.getElementById('bookingBarberSelect').value,
        barber_name: availableBarbers.find(barber => barber.id === document.getElementById('bookingBarberSelect').value)?.name || null,
        admin_notes: document.getElementById('bookingAdminNotesInput').value.trim() || null,
        updated_at: new Date().toISOString()
    };

    const rpcResult = await supabaseClient.rpc('update_booking_admin', {
        p_booking_id: activeBookingId,
        p_new_status: newStatus,
        p_booking_date: payload.booking_date,
        p_booking_time: payload.booking_time,
        p_barber_id: payload.barber_id,
        p_admin_notes: payload.admin_notes
    });

    const { data, error } = rpcResult;
    if (error || !data) {
        if (/update_booking_admin|PGRST202|does not exist/i.test(error?.message || '')) {
            throw new Error('Secure appointment update is not installed. Apply the latest Supabase migrations first.');
        }
        throw error || new Error('Could not update appointment.');
    }

    const booking = allBookings.find(b => b.id === activeBookingId);
    if (booking) Object.assign(booking, data);
    return data;
}

async function saveBookingStatus() {
    if (!activeBookingId) return;

    const btn = document.getElementById('bookingSaveBtn');
    const status = document.getElementById('bookingSaveStatus');
    const select = document.getElementById('bookingStatusSelect');
    const newStatus = select.value;

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        await updateBookingStatus(newStatus);
        renderStats();
        applyFilters();
        status.style.color = 'var(--good)';
        status.textContent = 'Status updated.';
        showToast('Booking status updated!');
    } catch (error) {
        console.error(error);
        status.style.color = 'var(--bad)';
        status.textContent = /function .*update_booking_admin|does not exist/i.test(error.message || '')
            ? 'Run the latest Supabase migrations before updating appointments.'
            : (error.message || 'Could not update appointment.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Status';
    }
}

async function cancelBookingFromModal() {
    if (!activeBookingId) return;
    if (!confirm('Cancel this booking? The client will see it as cancelled.')) return;

    const btn = document.getElementById('bookingCancelBtn');
    btn.disabled = true;

    try {
        await updateBookingStatus('cancelled');
        const select = document.getElementById('bookingStatusSelect');
        if (select) select.value = 'cancelled';
        renderStats();
        applyFilters();
        showToast('Booking cancelled.');
    } catch (error) {
        console.error(error);
        showToast('Error cancelling booking', 'error');
        btn.disabled = false;
    }
}

// --------------------------------------------
// Delete (only ever offered for cancelled bookings)
// --------------------------------------------
async function handleDeleteBooking(bookingId) {
    if (!bookingId) return;
    if (!confirm('Delete this booking for good? This removes it completely \u2014 the client will no longer see it either \u2014 and can\u2019t be undone.')) return;

    const btn = document.querySelector(`.admin-action-delete[data-id="${bookingId}"]`);
    if (btn) btn.disabled = true;

    // Belt-and-suspenders: only ever delete rows that are actually
    // cancelled, even though the button only renders for those.
    //
    // .select() here matters: under RLS, a DELETE that matches zero
    // rows (policy blocks it) returns error: null and just quietly
    // deletes nothing. Asking Postgres to return the deleted row lets
    // us tell "actually deleted" apart from "silently blocked."
    const { data, error } = await supabaseClient
        .from('bookings')
        .delete()
        .eq('id', bookingId)
        .eq('status', 'cancelled')
        .select();

    if (error) {
        console.error(error);
        if (btn) btn.disabled = false;
        showToast(error.message || 'Error deleting booking', 'error');
        return;
    }

    if (!data || !data.length) {
        if (btn) btn.disabled = false;
        showToast('Delete didn\u2019t go through \u2014 likely missing an RLS DELETE policy for admins on bookings.', 'error');
        return;
    }

    allBookings = allBookings.filter(b => b.id !== bookingId);
    if (activeBookingId === bookingId) closeBookingModal();

    renderStats();
    applyFilters();
    showToast('Booking deleted.');
}

// --------------------------------------------
// Formatting helpers
// --------------------------------------------
function localDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatPHP(amount) {
    return 'PHP ' + (Number(amount) || 0).toLocaleString('en-PH');
}

function formatDateTime(dateStr, timeStr) {
    if (!dateStr) return '\u2014';
    const d = new Date(dateStr + 'T00:00:00');
    const dateLabel = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    if (!timeStr) return dateLabel;
    const [h, m] = timeStr.split(':').map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    const timeLabel = t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    return `${dateLabel} \u00b7 ${timeLabel}`;
}

function formatCreatedAt(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// --------------------------------------------
// Toast — same look/behavior as users.js's, duplicated here since
// each admin page's script is loaded standalone (no shared bundle).
// --------------------------------------------
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