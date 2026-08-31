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

// Maps booking_id -> { rating, comment } for the current visitor's own
// reviews, fetched alongside their bookings. Missing from this map
// (and the `reviews` table not existing yet) both just mean "not
// reviewed yet" — same degrade-gracefully approach booking.js takes
// with its slot-hold feature when that migration isn't applied.
let myReviewsByBookingId = {};

// Review-modal state — which booking is being reviewed and the star
// rating picked so far (0 = none picked yet).
let reviewModalBookingId = null;
let reviewModalRating = 0;

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

    initApptAutoRefresh();
    initApptReceiptModal();
    initApptReviewModal();
});

// --------------------------------------------
// Auto-refresh on return to this page
// --------------------------------------------
// loadMyAppointments() only ran once above, right after DOMContentLoaded.
// That's stale the moment someone books a new appointment and comes back
// to this tab without a hard reload — e.g. they had My Appointments open
// already, booked in another tab, then switched back; or they used the
// browser's Back button, which on many browsers restores the page from
// bfcache without re-running any of the code above. Either way the list
// just sits there showing what it saw at the original page load.
//
// Refetching whenever the tab regains focus/visibility, or whenever the
// page is restored from bfcache, means the freshly-booked appointment
// shows up without the visitor having to manually refresh.
let apptRefreshInFlight = false;

async function refreshMyAppointmentsIfVisible() {
    if (document.hidden) return;
    if (!isLoggedIn()) return;
    if (apptRefreshInFlight) return;

    apptRefreshInFlight = true;
    try {
        await loadMyAppointments({ silent: true });
    } finally {
        apptRefreshInFlight = false;
    }
}

function initApptAutoRefresh() {
    // Tab switched back to, or window refocused.
    document.addEventListener('visibilitychange', refreshMyAppointmentsIfVisible);
    window.addEventListener('focus', refreshMyAppointmentsIfVisible);

    // Restored from bfcache (e.g. hitting Back after booking elsewhere)
    // — event.persisted is true only for the bfcache-restore case, not
    // a normal fresh navigation (which already ran the block above).
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) refreshMyAppointmentsIfVisible();
    });
}

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
async function loadMyAppointments(opts) {
    const silent = !!(opts && opts.silent);
    const listEl = document.getElementById('myappointmentsList');
    const emptyEl = document.getElementById('myappointmentsEmpty');
    const user = getCurrentUser();
    if (!listEl || !user || typeof supabaseClient === 'undefined') return;

    // Skip the "Loading..." flash on background refreshes (tab refocus,
    // bfcache restore) — only show it the first time, when the list is
    // still empty, so an already-rendered page doesn't flicker every
    // time the visitor tabs back in.
    if (!silent) {
        listEl.innerHTML = '<p class="myappointments-status-text">Loading your appointments...</p>';
    }

    const [bookingsRes, reviewsRes] = await Promise.all([
        supabaseClient
            .from('bookings')
            .select('*')
            .eq('user_id', user.id)
            .order('booking_date', { ascending: false })
            .order('booking_time', { ascending: false }),
        // Might fail with "relation does not exist" if reviews_setup.sql
        // hasn't been run yet — handled below by just treating every
        // booking as not-yet-reviewed rather than surfacing the error,
        // since reviews are a pure enhancement, not required to view
        // appointments.
        supabaseClient
            .from('reviews')
            .select('booking_id, rating, comment')
            .eq('user_id', user.id)
    ]);

    const { data, error } = bookingsRes;

    if (error) {
        console.error(error);
        if (!silent) {
            listEl.innerHTML = `<p class="myappointments-status-text">Couldn\u2019t load your appointments \u2014 ${escapeHtmlAppt(error.message || 'please refresh.')}</p>`;
        }
        return;
    }

    myAppointments = data || [];

    myReviewsByBookingId = {};
    if (!reviewsRes.error && reviewsRes.data) {
        reviewsRes.data.forEach(function (r) { myReviewsByBookingId[r.booking_id] = r; });
    }

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

    listEl.querySelectorAll('.myappt-receipt-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            openApptReceipt(btn.dataset.id);
        });
    });

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

    listEl.querySelectorAll('.myappt-review-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            openReviewModal(btn.dataset.id);
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

    const refId = String(b.id || '').slice(0, 8).toUpperCase();
    const receiptBtn = `<button type="button" class="myappt-receipt-btn" data-id="${b.id}">
               <i class="fas fa-qrcode" aria-hidden="true"></i> View Receipt
           </button>`;

    let actionBtn = '';
    if (canCancel) {
        actionBtn = `<button type="button" class="myappt-cancel-btn" data-id="${b.id}">
               <i class="fas fa-xmark" aria-hidden="true"></i> Cancel Appointment
           </button>`;
    } else if (canDelete) {
        actionBtn = `<button type="button" class="myappt-delete-btn" data-id="${b.id}">
               <i class="fas fa-trash" aria-hidden="true"></i> Delete Appointment
           </button>`;
    } else if (status === 'completed') {
        // Only a completed appointment can be reviewed — matches
        // submit_booking_review()'s own check server-side, so this is
        // just showing the button where it would actually succeed.
        const existingReview = myReviewsByBookingId[b.id];
        actionBtn = existingReview
            ? `<div class="myappt-review-submitted" aria-label="You rated this ${existingReview.rating} out of 5 stars">
                   <span class="myappt-review-stars">${renderStaticStars(existingReview.rating)}</span>
                   <span class="myappt-review-label">Reviewed</span>
               </div>`
            : `<button type="button" class="myappt-review-btn" data-id="${b.id}">
                   <i class="fas fa-star" aria-hidden="true"></i> Leave Review
               </button>`;
    }

    const footer = `<div class="myappt-card-footer">${receiptBtn}${actionBtn}</div>`;

    return `
        <div class="myappt-card" data-id="${b.id}">
            <div class="myappt-card-header">
                <div>
                    <span class="myappt-card-id">Appointment #${refId || '\u2014'}</span>
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

// --------------------------------------------
// Receipt modal — same digital QR receipt shown right after booking
// (see booking.js's showBookingSuccess()/renderReceiptQr()), reopenable
// any time from here so a saved appointment's proof isn't a one-time
// thing tied to the moment it was booked.
// --------------------------------------------
function initApptReceiptModal() {
    const backdrop = document.getElementById('apptReceiptBackdrop');
    const closeBtn = document.getElementById('apptReceiptCloseBtn');
    const downloadBtn = document.getElementById('apptReceiptDownloadBtn');

    if (backdrop) backdrop.addEventListener('click', closeApptReceipt);
    if (closeBtn) closeBtn.addEventListener('click', closeApptReceipt);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeApptReceipt();
    });
    if (downloadBtn) downloadBtn.addEventListener('click', downloadApptReceipt);
}

function openApptReceipt(bookingId) {
    const b = myAppointments.find(function (x) { return x.id === bookingId; });
    if (!b) return;

    const refId = String(b.id || '').slice(0, 8).toUpperCase();

    setText('apptReceiptService', `${b.service_name || '\u2014'}${b.service_duration ? ' (' + b.service_duration + ')' : ''}`);
    setText('apptReceiptBarber', b.barber_name || 'Random');
    setText('apptReceiptLocation', b.location_type === 'home'
        ? `Home Service${b.area ? ' \u2014 ' + b.area : ''}${b.address ? ', ' + b.address : ''}`
        : 'In-Studio');
    setText('apptReceiptDateTime', formatBookingDateTime(b.booking_date, b.booking_time));
    setText('apptReceiptContact', b.contact_preference === 'email'
        ? 'Email'
        : (b.contact_phone ? `Phone: ${b.contact_phone}` : '\u2014'));
    setText('apptReceiptStatus', APPT_STATUS_LABELS[b.status] || b.status || '\u2014');
    setText('apptReceiptId', refId || '\u2014');

    // Open the modal FIRST, then render the QR. The QR library can
    // throw (e.g. "code length overflow" when the payload is too long
    // for the QR version it picked) — if that call happened before
    // these two lines, the uncaught error would abort this whole
    // function and the modal would never show up, making the button
    // look completely unresponsive. Showing the modal first means a
    // QR failure only affects the QR itself (handled gracefully
    // inside renderApptReceiptQr), never the modal opening.
    document.getElementById('apptReceiptBackdrop').hidden = false;
    document.getElementById('apptReceiptModal').hidden = false;

    renderApptReceiptQr(b, refId);
}

function closeApptReceipt() {
    const backdrop = document.getElementById('apptReceiptBackdrop');
    const modal = document.getElementById('apptReceiptModal');
    if (backdrop) backdrop.hidden = true;
    if (modal) modal.hidden = true;
}

function renderApptReceiptQr(b, refId) {
    const container = document.getElementById('apptReceiptQr');
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
    // flow (see openApptReceipt). Ref/Booking ID alone are enough to
    // look this appointment up; long free-text fields (barber names,
    // service names) are truncated defensively in case of unusually
    // long data.
    const qrPayload = [
        'TOUGHCUTS APPOINTMENT',
        `Ref: ${refId}`,
        `Booking ID: ${b.id}`
    ].join('\n').slice(0, 200);

    try {
        new QRCode(container, {
            text: qrPayload,
            width: 132,
            height: 132,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L
        });
    } catch (err) {
        console.error('QR render failed:', err);
        container.textContent = 'QR unavailable';
    }
}

async function downloadApptReceipt() {
    const node = document.getElementById('apptReceiptCapture');
    const btn = document.getElementById('apptReceiptDownloadBtn');
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
        const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#141414';
        const canvas = await html2canvas(node, { backgroundColor: cardBg, scale: 2, useCORS: true });
        const refEl = document.getElementById('apptReceiptId');
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

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function escapeHtmlAppt(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// --------------------------------------------
// Reviews — rate a completed appointment's barber. One review per
// booking, enforced server-side by submit_booking_review() (see
// reviews_setup.sql) — this modal is just the UI for it.
// --------------------------------------------
function renderStaticStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
        html += `<i class="fas fa-star${i <= rating ? '' : ' myappt-star-empty'}" aria-hidden="true"></i>`;
    }
    return html;
}

function initApptReviewModal() {
    const backdrop = document.getElementById('apptReviewBackdrop');
    const closeBtn = document.getElementById('apptReviewCloseBtn');
    const submitBtn = document.getElementById('apptReviewSubmitBtn');
    const commentInput = document.getElementById('apptReviewComment');
    const countEl = document.getElementById('apptReviewCount');
    const starPicker = document.getElementById('apptReviewStarPicker');

    if (backdrop) backdrop.addEventListener('click', closeReviewModal);
    if (closeBtn) closeBtn.addEventListener('click', closeReviewModal);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeReviewModal();
    });
    if (submitBtn) submitBtn.addEventListener('click', submitApptReview);

    if (commentInput && countEl) {
        const max = commentInput.getAttribute('maxlength') || 500;
        commentInput.addEventListener('input', function () {
            countEl.textContent = `${commentInput.value.length}/${max}`;
        });
    }

    if (starPicker) {
        const stars = starPicker.querySelectorAll('.myappt-review-star');
        stars.forEach(function (star) {
            star.addEventListener('click', function () {
                setReviewRating(Number(star.dataset.value));
            });
            // Hover preview only paints up to the hovered star; the
            // committed value (reviewModalRating) doesn't change until
            // an actual click, so moving the mouse away safely falls
            // back to whatever was last picked (see mouseleave below).
            star.addEventListener('mouseenter', function () {
                paintStars(Number(star.dataset.value));
            });
        });
        starPicker.addEventListener('mouseleave', function () {
            paintStars(reviewModalRating);
        });
    }
}

function paintStars(uptoValue) {
    const starPicker = document.getElementById('apptReviewStarPicker');
    if (!starPicker) return;
    starPicker.querySelectorAll('.myappt-review-star').forEach(function (star) {
        star.classList.toggle('is-filled', Number(star.dataset.value) <= uptoValue);
    });
}

function setReviewRating(value) {
    reviewModalRating = value;
    paintStars(value);
    const starPicker = document.getElementById('apptReviewStarPicker');
    if (starPicker) {
        starPicker.querySelectorAll('.myappt-review-star').forEach(function (star) {
            star.setAttribute('aria-checked', String(Number(star.dataset.value) === value));
        });
    }
    hideReviewError();
}

function openReviewModal(bookingId) {
    const b = myAppointments.find(function (x) { return x.id === bookingId; });
    if (!b) return;

    reviewModalBookingId = bookingId;
    reviewModalRating = 0;

    setText('apptReviewBarber', b.barber_name || 'Random');
    paintStars(0);
    const starPicker = document.getElementById('apptReviewStarPicker');
    if (starPicker) {
        starPicker.querySelectorAll('.myappt-review-star').forEach(function (star) {
            star.setAttribute('aria-checked', 'false');
        });
    }

    const commentInput = document.getElementById('apptReviewComment');
    if (commentInput) commentInput.value = '';
    const countEl = document.getElementById('apptReviewCount');
    if (countEl) countEl.textContent = '0/500';

    hideReviewError();

    document.getElementById('apptReviewBackdrop').hidden = false;
    document.getElementById('apptReviewModal').hidden = false;
}

function closeReviewModal() {
    const backdrop = document.getElementById('apptReviewBackdrop');
    const modal = document.getElementById('apptReviewModal');
    if (backdrop) backdrop.hidden = true;
    if (modal) modal.hidden = true;
    reviewModalBookingId = null;
}

function showReviewError(message) {
    const el = document.getElementById('apptReviewError');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
}

function hideReviewError() {
    const el = document.getElementById('apptReviewError');
    if (el) el.hidden = true;
}

async function submitApptReview() {
    if (!reviewModalBookingId || typeof supabaseClient === 'undefined') return;
    if (!reviewModalRating) {
        showReviewError('Please pick a star rating before submitting.');
        return;
    }

    const btn = document.getElementById('apptReviewSubmitBtn');
    const btnText = btn ? btn.querySelector('.myappt-review-submit-text') : null;
    const spinner = btn ? btn.querySelector('.myappt-review-submit-spinner') : null;
    const commentInput = document.getElementById('apptReviewComment');
    const bookingId = reviewModalBookingId;

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Submitting...';
    if (spinner) spinner.hidden = false;
    hideReviewError();

    const { data, error } = await supabaseClient.rpc('submit_booking_review', {
        p_booking_id: bookingId,
        p_rating: reviewModalRating,
        p_comment: commentInput ? commentInput.value.trim() : ''
    });

    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Submit Review';
    if (spinner) spinner.hidden = true;

    if (error || !data) {
        showReviewError(
            /submit_booking_review|does not exist|could not find the function/i.test(error?.message || '')
                ? 'Reviews aren\u2019t set up yet \u2014 run the latest Supabase migrations first.'
                : (error?.message || 'Couldn\u2019t submit your review \u2014 please try again.')
        );
        return;
    }

    myReviewsByBookingId[bookingId] = { booking_id: bookingId, rating: data.rating, comment: data.comment };
    closeReviewModal();
    renderMyAppointments();
}