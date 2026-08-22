// ============================================
// MY APPOINTMENTS PAGE
// ============================================
// Login-gated the same way myorders.html is. isLoggedIn() /
// getCurrentUser() / authReadyPromise come from ../js/main.js.
//
// Reads `bookings` for the signed-in visitor only. Same table the
// admin Bookings page reads (see bookings.js's header comment for the
// full schema) — this page just filters to the current user's own
// rows and skips anything admin-only (editing status to
// confirmed/completed, viewing other clients' contact info, etc).
//
// Status vocabulary matches the admin side: pending / confirmed /
// completed / cancelled.
//
// SELF-SERVICE CANCEL — "Cancel Appointment" writes
// { status: 'cancelled' } on the visitor's own booking. This assumes
// an RLS policy on `bookings` that lets a signed-in user UPDATE rows
// where user_id = auth.uid() (at minimum, restricted to setting
// status = 'cancelled' — e.g. via a CHECK/using clause or a Postgres
// function). If no such policy exists yet, the cancel button will
// fail with a row-level-security error, which is caught below and
// surfaced as a friendly message rather than a silent failure.
//
// SELF-SERVICE DELETE — once a booking's status is 'cancelled', the
// card shows a "Delete" button instead of "Cancel Appointment". This
// does a real DELETE on the visitor's own row, not a status change —
// the row disappears from this page, from the admin Bookings page,
// and from the database. This assumes a matching RLS policy on
// `bookings` that lets a signed-in user DELETE rows where
// user_id = auth.uid() AND status = 'cancelled' (so they can only
// ever delete their own already-cancelled bookings, never pending/
// confirmed/completed ones or anyone else's).
//
// IMPORTANT — under RLS, a DELETE that matches zero rows (because a
// policy blocks it) comes back with error: null. Supabase doesn't
// treat "blocked by policy" as an error, it just deletes nothing. So
// the delete call below chains .select() to ask Postgres to return
// the row it actually deleted — an empty result means the delete was
// silently blocked, which is treated as a failure instead of being
// reported as success.

const APPT_STATUS_LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

// Statuses the visitor is still allowed to cancel from.
const APPT_CANCELLABLE_STATUSES = ['pending', 'confirmed'];

let myAppointments = [];

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showApptGate();
        return;
    }

    showApptContent();
    await loadMyAppointments();

    // Keep the gate/content split in sync if auth state changes after
    // load too (e.g. logging out in another tab) — same pattern as
    // myorders.js's onAuthStateChange listener.
    if (typeof supabaseClient !== 'undefined') {
        supabaseClient.auth.onAuthStateChange(function () {
            if (!isLoggedIn()) showApptGate();
        });
    }
});

function showApptGate() {
    const gate = document.getElementById('myappointmentsGate');
    const content = document.getElementById('myappointmentsContent');
    if (gate) gate.hidden = false;
    if (content) content.hidden = true;
}

function showApptContent() {
    const gate = document.getElementById('myappointmentsGate');
    const content = document.getElementById('myappointmentsContent');
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
}

// --------------------------------------------
// Load
// --------------------------------------------
async function loadMyAppointments() {
    const listEl = document.getElementById('myappointmentsList');
    const emptyEl = document.getElementById('myappointmentsEmpty');
    const user = getCurrentUser();
    if (!listEl || !user || typeof supabaseClient === 'undefined') return;

    listEl.innerHTML = '<p class="myappointments-status-text">Loading your appointments...</p>';

    const { data, error } = await supabaseClient
        .from('bookings')
        .select('*')
        .eq('user_id', user.id)
        .order('booking_date', { ascending: false })
        .order('booking_time', { ascending: false });

    if (error) {
        console.error(error);
        listEl.innerHTML = `<p class="myappointments-status-text">Couldn\u2019t load your appointments \u2014 ${escapeHtmlAppt(error.message || 'please refresh.')}</p>`;
        return;
    }

    myAppointments = data || [];

    if (!myAppointments.length) {
        if (emptyEl) emptyEl.hidden = false;
        listEl.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.hidden = true;
    renderMyAppointments();
}

function renderMyAppointments() {
    const listEl = document.getElementById('myappointmentsList');
    if (!listEl) return;

    listEl.innerHTML = myAppointments.map(renderApptCard).join('');

    listEl.querySelectorAll('.myappt-cancel-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            handleCancelAppointment(btn.dataset.id);
        });
    });

    listEl.querySelectorAll('.myappt-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            handleDeleteAppointment(btn.dataset.id);
        });
    });
}

// --------------------------------------------
// Render one appointment card
// --------------------------------------------
function renderApptCard(b) {
    const status = b.status || 'pending';

    const locationLine = b.location_type === 'home'
        ? `<div><i class="fas fa-truck" aria-hidden="true"></i> <span>Home Service \u2014 ${escapeHtmlAppt(b.area || '')}${b.address ? ', ' + escapeHtmlAppt(b.address) : ''}</span></div>`
        : `<div><i class="fas fa-store" aria-hidden="true"></i> <span>In-Studio</span></div>`;

    const contactLine = b.contact_preference === 'email'
        ? `<div><i class="fas fa-envelope" aria-hidden="true"></i> <span>Reach via email</span></div>`
        : b.contact_phone
            ? `<div><i class="fas fa-phone" aria-hidden="true"></i> <span>${escapeHtmlAppt(b.contact_phone)}</span></div>`
            : '';

    let totalText = formatPHPAppt(b.total_price);
    if (b.location_type === 'home' && b.travel_fee) {
        totalText += ` <span style="font-size:0.75rem; color: var(--dim);">(incl. ${formatPHPAppt(b.travel_fee)} travel fee)</span>`;
    }

    const notesBlock = b.notes
        ? `<div class="myappt-card-notes"><i class="fas fa-note-sticky" aria-hidden="true"></i> <span>${escapeHtmlAppt(b.notes)}</span></div>`
        : '';

    const canCancel = APPT_CANCELLABLE_STATUSES.includes(status);
    const canDelete = status === 'cancelled';

    let footer = '';
    if (canCancel) {
        footer = `<div class="myappt-card-footer">
               <button type="button" class="myappt-cancel-btn" data-id="${b.id}">
                   <i class="fas fa-xmark" aria-hidden="true"></i> Cancel Appointment
               </button>
           </div>`;
    } else if (canDelete) {
        footer = `<div class="myappt-card-footer">
               <button type="button" class="myappt-delete-btn" data-id="${b.id}">
                   <i class="fas fa-trash" aria-hidden="true"></i> Delete Appointment
               </button>
           </div>`;
    }

    return `
        <div class="myappt-card" data-id="${b.id}">
            <div class="myappt-card-header">
                <div>
                    <span class="myappt-card-id">Appointment #${b.id.slice(0, 8).toUpperCase()}</span>
                    <span class="myappt-card-date">Booked ${formatCreatedAtAppt(b.created_at)}</span>
                </div>
                <span class="myappt-status myappt-status-${status}">${APPT_STATUS_LABELS[status] || status}</span>
            </div>

            <div class="myappt-card-service">
                <h3>${escapeHtmlAppt(b.service_name || '\u2014')}${b.service_duration ? ' <span style="font-size:0.8rem; color: var(--dim); font-family: var(--font-body);">(' + escapeHtmlAppt(b.service_duration) + ')</span>' : ''}</h3>
                <span>with ${escapeHtmlAppt(b.barber_name || '\u2014')}</span>
            </div>

            <div class="myappt-card-meta">
                <div><i class="fas fa-calendar-day" aria-hidden="true"></i> <span>${formatBookingDateTime(b.booking_date, b.booking_time)}</span></div>
                ${locationLine}
                ${contactLine}
            </div>

            <div class="myappt-card-total">
                <span>Total</span>
                <span>${totalText}</span>
            </div>

            ${notesBlock}
            ${footer}
        </div>
    `;
}

// --------------------------------------------
// Cancel
// --------------------------------------------
async function handleCancelAppointment(bookingId) {
    if (!bookingId) return;
    if (!confirm('Cancel this appointment? This can\u2019t be undone.')) return;

    const btn = document.querySelector(`.myappt-cancel-btn[data-id="${bookingId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Cancelling...';
    }

    const { data, error } = await supabaseClient
        .from('bookings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', bookingId)
        .select();

    if (error) {
        console.error(error);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i> Cancel Appointment';
        }
        alert(
            /row-level security|permission denied/i.test(error.message || '')
                ? 'Cancelling isn\u2019t enabled for customer accounts yet \u2014 an RLS policy needs to allow updating your own bookings\u2019 status. Please call the studio to cancel for now.'
                : (error.message || 'Something went wrong \u2014 please try again.')
        );
        return;
    }

    if (!data || !data.length) {
        // RLS silently matched zero rows — treat the same as a
        // blocked policy, since Postgres never surfaces this as an
        // error on its own.
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i> Cancel Appointment';
        }
        alert('Cancelling isn\u2019t enabled for customer accounts yet \u2014 an RLS policy needs to allow updating your own bookings\u2019 status. Please call the studio to cancel for now.');
        return;
    }

    const booking = myAppointments.find(b => b.id === bookingId);
    if (booking) booking.status = 'cancelled';
    renderMyAppointments();
}

// --------------------------------------------
// Delete (only ever shown for cancelled bookings)
// --------------------------------------------
async function handleDeleteAppointment(bookingId) {
    if (!bookingId) return;
    if (!confirm('Delete this appointment for good? This removes it completely and can\u2019t be undone.')) return;

    const btn = document.querySelector(`.myappt-delete-btn[data-id="${bookingId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting...';
    }

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
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i> Delete Appointment';
        }
        alert(
            /row-level security|permission denied/i.test(error.message || '')
                ? 'Deleting isn\u2019t enabled for customer accounts yet \u2014 an RLS policy needs to allow deleting your own cancelled bookings. Please call the studio to remove this for now.'
                : (error.message || 'Something went wrong \u2014 please try again.')
        );
        return;
    }

    if (!data || !data.length) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i> Delete Appointment';
        }
        alert('Deleting isn\u2019t enabled for customer accounts yet \u2014 an RLS policy needs to allow deleting your own cancelled bookings. Please call the studio to remove this for now.');
        return;
    }

    myAppointments = myAppointments.filter(function (b) { return b.id !== bookingId; });

    if (!myAppointments.length) {
        const emptyEl = document.getElementById('myappointmentsEmpty');
        const listEl = document.getElementById('myappointmentsList');
        if (emptyEl) emptyEl.hidden = false;
        if (listEl) listEl.innerHTML = '';
    } else {
        renderMyAppointments();
    }
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function formatPHPAppt(amount) {
    return 'PHP ' + Number(amount || 0).toLocaleString('en-PH');
}

function formatBookingDateTime(dateStr, timeStr) {
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

function formatCreatedAtAppt(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtmlAppt(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}