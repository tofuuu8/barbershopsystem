// ============================================
// BOOKING PAGE
// ============================================
// Login-gated the same way cart.html is — signed-out visitors see
// #bookingGate instead of the form. isLoggedIn() / getCurrentUser() /
// authReadyPromise / getRedirectParam() all live in js/main.js, loaded
// before this file.
//
// Writes to the `bookings` table in Supabase — see bookings_setup.sql
// for the table definition + required RLS policies. Nothing here will
// work until that SQL has been run once in the Supabase SQL Editor.
//
// This file also reads/writes `profiles.phone` (to prefill Step 5's
// contact number) and `bookings.contact_phone` / `bookings.contact_preference`.
// Run this once in the SQL Editor if either hasn't been added yet:
//
//   alter table public.bookings add column if not exists contact_phone text;
//   alter table public.bookings add column if not exists contact_preference text;
//
// Older rows will just have both columns null — nothing else depends on
// them being backfilled. There's deliberately no bookings.contact_email
// column — when contact_preference is 'email', the email is just
// profiles.email for whoever's signed in, so it isn't duplicated onto
// every booking row.
//
// SLOT HOLDS — once a date + time are picked, this file requests a real
// 10-minute hold on that barber/slot via the create_booking_hold RPC
// (see migration 202608260001_booking_slot_holds.sql), so nobody else
// can book it out from under this visitor while they finish the form.
// This degrades gracefully if that migration hasn't been applied yet —
// see the "SLOT HOLD" section below — the booking flow works exactly
// as before, just without the countdown/reservation.

// --------------------------------------------
// SERVICE CATALOG
// --------------------------------------------
// Toughcuts only offers one haircut service per gender right now — kept
// as a one-item-per-gender array (rather than two bare objects) so
// visibleServices()/findService() below don't need special-casing, and
// so adding a service back later is a one-line change.
const BOOKING_SERVICES = [
    // ---------------- MEN'S ----------------
    { id: 'classic-haircut', gender: 'men', name: 'Classic Haircut', icon: 'fa-scissors', price: 280, duration: '30 min', blurb: 'A timeless, all-purpose cut — clean and sharp.' },
    // ---------------- WOMEN'S ----------------
    { id: 'haircut-style', gender: 'women', name: 'Haircut & Style', icon: 'fa-scissors', price: 450, duration: '45 min', blurb: 'Cut, shape, and blow-dry finish.' }
];

// Haircut is the only service offered, in-studio or Home Service alike —
// nothing to filter out here anymore, but kept as the single source of
// truth in case Home Service coverage ever needs to differ from In-Studio
// again.
const HAIRCUT_SERVICE_IDS = {
    men: ['classic-haircut'],
    women: ['haircut-style']
};

// Same coverage list as services.js's HOME_SERVICE_AREAS, trimmed to just
// what booking needs (name + flat travel fee) — no geolocation shortcut
// here since booking's own area <select> is a simpler, self-contained
// pick-and-go rather than a full availability check.
const BOOKING_HOME_AREAS = [
    { name: 'san isidro', fee: 80 },
    { name: 'rodriguez', label: 'Rodriguez (Montalban)', fee: 100 },
    { name: 'san mateo', fee: 150 },
    { name: 'marikina', fee: 180 },
    { name: 'antipolo', fee: 200 },
    { name: 'cainta', fee: 200 },
    { name: 'taytay', fee: 220 },
    { name: 'quezon city', fee: 250 }
];

function findBookingArea(name) {
    return BOOKING_HOME_AREAS.find(a => a.name === name) || null;
}

// --------------------------------------------
// BARBER ROSTER — used for random assignment when
// "Random" is selected. Women's haircuts are only done by
// Barber Klark, so the random pool for women's is just him.
// --------------------------------------------
const BOOKING_BARBERS = [
    { id: 'barber-russel', name: 'Barber Russel' },
    { id: 'klark-dizon',  name: 'Barber Klark' },
    { id: 'barber-jon',   name: 'Barber Jon' }
];

const WOMENS_BARBER_IDS = ['klark-dizon'];

function areaLabel(area) {
    return area.label || area.name.replace(/\b\w/g, c => c.toUpperCase());
}

// --------------------------------------------
// BUSINESS HOURS -> TIME SLOTS
// Matches the footer's posted hours: Mon-Fri 9am-8pm, Sat 9am-6pm, Sun closed.
// --------------------------------------------
function hoursForDate(dateStr) {
    const day = new Date(dateStr + 'T00:00:00').getDay(); // 0 = Sunday
    if (day === 0) return null;
    if (day === 6) return { open: 9 * 60, close: 18 * 60 };
    return { open: 9 * 60, close: 20 * 60 };
}

// How far ahead someone can book — keeps the date picker from being
// scrolled through years of empty availability.
const MAX_BOOKING_DAYS_AHEAD = 60;

// Slots are offered on the hour (9:00, 10:00, 11:00, ...), not every 30
// minutes — matches how the shop actually schedules appointments.
const SLOT_INCREMENT_MINUTES = 60;

function minutesToLabel(mins) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function minutesTo24h(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Services store duration as a display string ("30 min", "45 min") —
// pull the leading number out of it for slot-fit / overlap math. Falls
// back to a conservative 60 minutes if a duration string is ever missing
// or unparseable, so a bad value fails safe (blocks a slot) rather than
// silently double-booking.
function parseDurationMinutes(durationStr) {
    const match = /(\d+)/.exec(durationStr || '');
    return match ? parseInt(match[1], 10) : 60;
}

// Two [start, start+duration) ranges (all in minutes-since-midnight) overlap
// if one starts before the other ends, both ways.
function rangesOverlap(startA, durA, startB, durB) {
    return startA < startB + durB && startB < startA + durA;
}

// --------------------------------------------
// STATE
// --------------------------------------------
let currentGender = 'men';
let currentLocation = 'studio'; // 'studio' | 'home'
let selectedServiceId = null;
let selectedBarberId = null;    // null = Random
let selectedBarberName = 'Random';
let contactMethod = 'phone';     // 'phone' | 'email'
let selectedAreaName = null;
let currentTravelFee = 0;
// Booked [time, duration] pairs for the selected barber + date, used to
// grey out conflicting slots. Empty whenever "Random" is selected,
// since that isn't tied to one barber's calendar.
let barberBookedRanges = [];

// --------------------------------------------
// SLOT HOLD STATE
// --------------------------------------------
// A hold is a real row in Supabase's booking_holds table (see
// 202608260001_booking_slot_holds.sql) that blocks the exact
// barber/date/time from being taken by anyone else while this visitor
// finishes the form. activeHoldKey is a fingerprint of whatever
// selection the current hold was created for, so updateSummary() only
// bothers the server again when something that actually matters
// (barber/date/time/gender/duration) has changed — not on every
// keystroke elsewhere on the page.
let activeHoldId = null;
let activeHoldExpiresAt = null;
let activeHoldKey = null;
let holdCountdownInterval = null;
let holdRequestInFlight = false;
let holdFeatureUnavailable = false; // set true if the migration hasn't been applied yet

function visibleServices() {
    const byGender = BOOKING_SERVICES.filter(s => s.gender === currentGender);
    if (currentLocation === 'home') {
        const allowedIds = HAIRCUT_SERVICE_IDS[currentGender] || [];
        return byGender.filter(s => allowedIds.includes(s.id));
    }
    return byGender;
}

function findService(id) {
    return BOOKING_SERVICES.find(s => s.id === id) || null;
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showBookingGate();
        return;
    }

    showBookingContent();
    readInitialStateFromUrl();
    initLocationToggle();
    initGenderTabs();
    initContactMethodToggle();
    initNotesCounter();
    initBookingForm();
    initResetButton();
    applyLocationToUI();
    applyGenderToUI();
    renderServiceCard();
    initBarberCards();
    await initPreferredBarber();
    await initPhoneField();
    await initEmailField();
    await initDateTimeInputs();
    updateSummary();
    loadUpcomingBookings();

    // Keep the gate/content split in sync if auth state changes after
    // load too (e.g. logging out in another tab) — same pattern as
    // cart.js's onAuthStateChange listener.
    if (typeof supabaseClient !== 'undefined') {
        supabaseClient.auth.onAuthStateChange(function () {
            if (!isLoggedIn()) {
                showBookingGate();
            } else {
                showBookingContent();
                loadUpcomingBookings();
            }
        });
    }
});

// Best-effort release if the visitor leaves mid-booking without
// confirming or explicitly changing their selection. Not guaranteed to
// complete (the tab may already be gone by the time this fires) — if it
// doesn't, the hold just expires on its own after its 10-minute window.
window.addEventListener('pagehide', function () {
    if (activeHoldId && typeof supabaseClient !== 'undefined') {
        supabaseClient.rpc('release_booking_hold', { p_hold_id: activeHoldId });
    }
});

function showBookingGate() {
    const gate = document.getElementById('bookingGate');
    const content = document.getElementById('bookingContent');
    if (gate) gate.hidden = false;
    if (content) content.hidden = true;

    // Carry the visitor straight back to whatever they were trying to
    // book (including ?barber=/?type=/?gender= deep links) after they
    // log in or sign up.
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    const loginBtn = document.getElementById('bookingGateLoginBtn');
    const signupBtn = document.getElementById('bookingGateSignupBtn');
    if (loginBtn) loginBtn.href = `../login/login.html?redirect=${returnTo}`;
    if (signupBtn) signupBtn.href = `../login/signup.html?redirect=${returnTo}`;
}

function showBookingContent() {
    const gate = document.getElementById('bookingGate');
    const content = document.getElementById('bookingContent');
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
}

// ============================================
// DEEP-LINKING (?type=home&gender=women&barber=barber-russel)
// ============================================
function readInitialStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const gender = params.get('gender');
    const barber = params.get('barber');

    if (type === 'home' || type === 'studio') currentLocation = type;
    if (gender === 'men' || gender === 'women') currentGender = gender;
    if (barber) {
        selectedBarberId = barber;
        // Name gets filled in once initBarberCards() reads it off the
        // matching card's markup — see there.
    }
}

// ============================================
// LOCATION TOGGLE (In-Studio / Home Service)
// ============================================
function applyLocationToUI() {
    document.querySelectorAll('.booking-location-btn').forEach(btn => {
        const active = btn.dataset.location === currentLocation;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    const homeFields = document.getElementById('bookingHomeFields');
    if (homeFields) homeFields.hidden = currentLocation !== 'home';
}

function initLocationToggle() {
    document.querySelectorAll('.booking-location-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            currentLocation = this.dataset.location;
            applyLocationToUI();
            renderServiceCard();
            refreshTimeSlots();
            updateSummary();
        });
    });

    populateAreaSelect();

    const areaSelect = document.getElementById('bookingAreaSelect');
    if (areaSelect) {
        areaSelect.addEventListener('change', function () {
            const area = findBookingArea(areaSelect.value);
            selectedAreaName = area ? area.name : null;
            currentTravelFee = area ? area.fee : 0;
            const feeNote = document.getElementById('bookingTravelFeeNote');
            if (feeNote) {
                feeNote.hidden = !area;
                if (area) feeNote.textContent = `+ PHP ${area.fee} travel fee`;
            }
            updateSummary();
        });
    }
}

function populateAreaSelect() {
    const select = document.getElementById('bookingAreaSelect');
    if (!select) return;
    BOOKING_HOME_AREAS.forEach(area => {
        const option = document.createElement('option');
        option.value = area.name;
        option.textContent = areaLabel(area);
        select.appendChild(option);
    });
}

// ============================================
// GENDER TABS
// ============================================
function applyGenderToUI() {
    document.querySelectorAll('.booking-gender-tab').forEach(tab => {
        const active = tab.dataset.gender === currentGender;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
}

function initGenderTabs() {
    document.querySelectorAll('.booking-gender-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            currentGender = this.dataset.gender;
            applyGenderToUI();
            renderServiceCard();
            // The two haircuts run different durations (30 vs 45 min),
            // which changes which end-of-day slots still fit — recompute.
            refreshTimeSlots();
            updateSummary();
        });
    });
}

// ============================================
// SERVICE — read-only display
// ============================================
function renderServiceCard() {
    const grid = document.getElementById('bookingServiceGrid');
    if (!grid) return;

    const service = visibleServices()[0] || null;
    selectedServiceId = service ? service.id : null;

    grid.innerHTML = service ? `
        <div class="booking-service-card booking-service-card--fixed" aria-live="polite">
            <span class="booking-service-icon"><i class="fas ${service.icon}" aria-hidden="true"></i></span>
            <span class="booking-service-name">${service.name}</span>
            <span class="booking-service-blurb">${service.blurb}</span>
            <span class="booking-service-meta">
                <span class="booking-service-price">PHP ${service.price.toLocaleString()}</span>
                <span class="booking-service-duration">${service.duration}</span>
            </span>
        </div>
    ` : '<p class="booking-service-empty">No service available for this selection.</p>';
}

// ============================================
// BARBER CARDS
// ============================================
function initBarberCards() {
    // Use the dynamic version instead of hardcoded
    renderBarberCardsDynamic();
    
    // Listen for gender changes
    document.querySelectorAll('.booking-gender-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            setTimeout(updateBarberVisibilityForGender, 50);
        });
    });
}

// ============================================
// CONTACT METHOD (Step 5)
// ============================================
function applyContactMethodToUI() {
    document.querySelectorAll('.booking-contact-method-btn').forEach(btn => {
        const active = btn.dataset.method === contactMethod;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    const phoneField = document.getElementById('bookingPhoneField');
    const emailField = document.getElementById('bookingEmailField');
    if (phoneField) phoneField.hidden = contactMethod !== 'phone';
    if (emailField) emailField.hidden = contactMethod !== 'email';
}

async function initPreferredBarber() {
    if (selectedBarberId || typeof supabaseClient === 'undefined') return;
    const user = getCurrentUser();
    if (!user) return;
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('preferred_barber_id')
        .eq('id', user.id)
        .maybeSingle();
    if (error || !data?.preferred_barber_id) return;
    const card = document.querySelector(`.booking-barber-card[data-barber-id="${data.preferred_barber_id}"]`);
    if (card && !card.classList.contains('is-unavailable')) selectPreferredBarberCard(card);
}

function selectPreferredBarberCard(card) {
    document.querySelectorAll('.booking-barber-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedBarberId = card.dataset.barberId || null;
    selectedBarberName = card.querySelector('.booking-barber-name')?.textContent || 'Random';
    refreshTimeSlots();
    updateSummary();
}

function initContactMethodToggle() {
    document.querySelectorAll('.booking-contact-method-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            contactMethod = this.dataset.method;
            applyContactMethodToUI();
            updateSummary();
        });
    });
}

async function initPhoneField() {
    const input = document.getElementById('bookingPhoneInput');
    const note = document.getElementById('bookingPhoneNote');
    if (!input) return;

    const user = getCurrentUser();
    if (!user || typeof supabaseClient === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .maybeSingle();

    if (error || !data || !data.phone) {
        if (note) note.hidden = false;
        return;
    }

    input.value = data.phone;
}

async function initEmailField() {
    const input = document.getElementById('bookingEmailInput');
    if (!input) return;

    const user = getCurrentUser();
    if (!user) return;

    if (user.email) input.value = user.email;
}

function isValidBookingPhone(phone) {
    return /^[0-9+()\-.\s]{7,20}$/.test(phone);
}

function isValidBookingEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================
// DATE & TIME
// ============================================
async function fetchAvailableBookingSlots(barberId, dateStr, durationMinutes) {
    if (!dateStr || typeof supabaseClient === 'undefined') return [];

    const { data, error } = await supabaseClient.rpc('get_available_booking_slots', {
        p_date: dateStr,
        p_barber_id: barberId || null,
        p_gender: currentGender,
        p_service_duration_minutes: durationMinutes
    });

    if (error) {
        console.error('Could not load appointment availability:', error);
        return [];
    }

    return data || [];
}

async function initDateTimeInputs() {
    const dateInput = document.getElementById('bookingDateInput');
    if (!dateInput) return;

    const today = new Date();
    dateInput.min = today.toISOString().slice(0, 10);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + MAX_BOOKING_DAYS_AHEAD);
    dateInput.max = maxDate.toISOString().slice(0, 10);

    dateInput.addEventListener('change', refreshTimeSlots);
    document.getElementById('bookingTimeSelect') &&
        document.getElementById('bookingTimeSelect').addEventListener('change', updateSummary);

    await refreshTimeSlots();
}

async function refreshTimeSlots() {
    const dateInput = document.getElementById('bookingDateInput');
    const timeSelect = document.getElementById('bookingTimeSelect');
    const closedNote = document.getElementById('bookingClosedNote');
    if (!dateInput || !timeSelect) return;

    const dateStr = dateInput.value;
    const previousValue = timeSelect.value;
    timeSelect.innerHTML = '<option value="">Select a time</option>';
    timeSelect.disabled = true;
    if (closedNote) closedNote.hidden = true;

    if (!dateStr) { updateSummary(); return; }

    const hours = hoursForDate(dateStr);
    if (!hours) {
        if (closedNote) {
            closedNote.hidden = false;
            closedNote.textContent = 'We\u2019re closed Sundays — please pick another day.';
        }
        updateSummary();
        return;
    }

    const service = selectedServiceId ? findService(selectedServiceId) : null;
    const durationMinutes = service ? parseDurationMinutes(service.duration) : 60;

    const today = new Date();
    const isToday = dateStr === today.toISOString().slice(0, 10);
    const nowMinutes = today.getHours() * 60 + today.getMinutes();

    const availableSlots = await fetchAvailableBookingSlots(selectedBarberId, dateStr, durationMinutes);
    const availableTimes = new Set(availableSlots.map(slot => String(slot.slot_time || '').slice(0, 5)));

    for (let mins = hours.open; mins + durationMinutes <= hours.close; mins += SLOT_INCREMENT_MINUTES) {
        if (isToday && mins <= nowMinutes) continue;
        const slotValue = minutesTo24h(mins);
        if (!availableTimes.has(slotValue)) continue;

        const option = document.createElement('option');
        option.value = slotValue;
        option.textContent = minutesToLabel(mins);
        timeSelect.appendChild(option);
    }

    timeSelect.disabled = timeSelect.options.length <= 1;
    if (timeSelect.disabled && closedNote) {
        closedNote.hidden = false;
        closedNote.textContent = selectedBarberId
            ? 'No open times with this barber on that date — try another date or barber.'
            : 'No remaining time slots today — please pick another date.';
    } else if (previousValue) {
        const stillThere = Array.from(timeSelect.options).some(o => o.value === previousValue);
        if (stillThere) timeSelect.value = previousValue;
    }

    updateSummary();
}

// ============================================
// NOTES CHARACTER COUNTER
// ============================================
function initNotesCounter() {
    const input = document.getElementById('bookingNotesInput');
    const counter = document.getElementById('bookingNotesCount');
    if (!input || !counter) return;
    const max = input.getAttribute('maxlength') || 300;
    function update() { counter.textContent = `${input.value.length}/${max}`; }
    input.addEventListener('input', update);
    update();
}

// ============================================
// SUMMARY PANEL + VALIDATION
// ============================================
function formatDateLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function currentSelection() {
    const service = selectedServiceId ? findService(selectedServiceId) : null;
    const dateInput = document.getElementById('bookingDateInput');
    const timeSelect = document.getElementById('bookingTimeSelect');
    const addressInput = document.getElementById('bookingAddressInput');
    const phoneInput = document.getElementById('bookingPhoneInput');

    return {
        service,
        date: dateInput ? dateInput.value : '',
        time: timeSelect ? timeSelect.value : '',
        timeLabel: timeSelect && timeSelect.selectedOptions[0] ? timeSelect.selectedOptions[0].textContent : '',
        address: addressInput ? addressInput.value.trim() : '',
        phone: phoneInput ? phoneInput.value.trim() : '',
        email: document.getElementById('bookingEmailInput') ? document.getElementById('bookingEmailInput').value.trim() : '',
        contactMethod,
        notes: (document.getElementById('bookingNotesInput') || {}).value || ''
    };
}

function updateSummary() {
    const sel = currentSelection();
    const total = (sel.service ? sel.service.price : 0) + (currentLocation === 'home' ? currentTravelFee : 0);

    setText('bookingSummaryService', sel.service ? `${sel.service.name} — PHP ${sel.service.price.toLocaleString()}` : 'Not selected yet');
    setText('bookingSummaryBarber', selectedBarberName);
    setText('bookingSummaryLocation', currentLocation === 'home'
        ? `Home Service${selectedAreaName ? ' — ' + areaLabel(findBookingArea(selectedAreaName) || { name: selectedAreaName }) : ''}`
        : 'In-Studio');
    setText('bookingSummaryDateTime', sel.date && sel.time
        ? `${formatDateLabel(sel.date)} at ${sel.timeLabel}`
        : 'Not selected yet');

    const contactValue = contactMethod === 'phone' ? sel.phone : sel.email;
    const contactLabel = contactMethod === 'phone' ? 'Phone' : 'Email';
    setText('bookingSummaryContact', contactValue ? `${contactLabel}: ${contactValue}` : 'Not entered yet');

    const feeRow = document.getElementById('bookingSummaryFeeRow');
    if (feeRow) feeRow.hidden = currentLocation !== 'home' || !currentTravelFee;
    setText('bookingSummaryFee', `PHP ${currentTravelFee.toLocaleString()}`);
    setText('bookingSummaryTotal', `PHP ${total.toLocaleString()}`);

    const confirmBtn = document.getElementById('bookingConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = !isSelectionComplete(sel);

    updateStepProgress(sel);
    maybeRefreshHold();
}

// --------------------------------------------
// Step completion — lets each card show its own checkmark
// and drives the thin progress bar above the form, purely
// from state that's already tracked for the summary/submit
// button above (no extra bookkeeping).
// --------------------------------------------
function updateStepProgress(sel) {
    const stepDone = {
        1: currentLocation === 'studio' || (!!selectedAreaName && sel.address.length >= MIN_ADDRESS_LENGTH),
        2: !!sel.service,
        3: !!sel.service, // a barber value always exists once a service is picked (Random is a valid default)
        4: !!(sel.date && sel.time),
        5: contactMethod === 'phone' ? isValidBookingPhone(sel.phone) : isValidBookingEmail(sel.email)
    };

    let doneCount = 0;
    Object.keys(stepDone).forEach(step => {
        const card = document.querySelector(`.booking-card[data-step="${step}"]`);
        const done = stepDone[step];
        if (done) doneCount++;
        if (card) card.classList.toggle('is-done', done);
    });

    const fill = document.getElementById('bookingProgressFill');
    const bar = document.getElementById('bookingProgress');
    const totalSteps = Object.keys(stepDone).length;
    if (fill) fill.style.width = `${(doneCount / totalSteps) * 100}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(doneCount));
}

const MIN_ADDRESS_LENGTH = 10;

function isSelectionComplete(sel) {
    if (!sel.service || !sel.date || !sel.time) return false;
    if (contactMethod === 'phone' && (!sel.phone || !isValidBookingPhone(sel.phone))) return false;
    if (contactMethod === 'email' && (!sel.email || !isValidBookingEmail(sel.email))) return false;
    if (currentLocation === 'home' && (!selectedAreaName || sel.address.length < MIN_ADDRESS_LENGTH)) return false;
    return true;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ============================================
// SLOT HOLD — countdown + server-side reservation
// ============================================
// Flow: once a date + time are both picked, we ask the server to hold
// that exact barber/slot for 10 minutes (create_booking_hold RPC).
// While the hold is active, get_available_booking_slots() hides that
// slot from every OTHER signed-in visitor, so it can't be double-booked
// out from under this one. Changing barber/date/time/gender releases
// the old hold and requests a fresh one for the new selection.

function hideHoldBanner() {
    const el = document.getElementById('bookingHoldBanner');
    if (el) el.hidden = true;
}

function hideHoldExpiredNotice() {
    const el = document.getElementById('bookingHoldExpired');
    if (el) el.hidden = true;
}

function showHoldExpiredNotice() {
    hideHoldBanner();
    const el = document.getElementById('bookingHoldExpired');
    if (el) el.hidden = false;
}

function stopHoldCountdown() {
    if (holdCountdownInterval) {
        clearInterval(holdCountdownInterval);
        holdCountdownInterval = null;
    }
}

// Clears all client-side hold state without talking to the server —
// used once a hold has already been consumed (booking confirmed) or is
// known to be gone already.
function forgetActiveHold() {
    stopHoldCountdown();
    activeHoldId = null;
    activeHoldExpiresAt = null;
    activeHoldKey = null;
    hideHoldBanner();
}

// Best-effort release — fire-and-forget so callers (including the
// pagehide listener) never have to await this.
function releaseActiveHold() {
    if (!activeHoldId || typeof supabaseClient === 'undefined') {
        forgetActiveHold();
        return;
    }
    const holdId = activeHoldId;
    forgetActiveHold();
    supabaseClient.rpc('release_booking_hold', { p_hold_id: holdId }).then(function (res) {
        if (res && res.error) console.warn('Could not release booking hold:', res.error);
    });
}

function startHoldCountdown(expiresAtIso) {
    stopHoldCountdown();
    activeHoldExpiresAt = new Date(expiresAtIso).getTime();

    const timerEl = document.getElementById('bookingHoldTimer');
    const bannerEl = document.getElementById('bookingHoldBanner');

    function tick() {
        const msLeft = activeHoldExpiresAt - Date.now();
        if (msLeft <= 0) {
            stopHoldCountdown();
            // The hold just lapsed — try to silently re-hold the exact
            // same selection so someone still typing their phone number
            // isn't interrupted. If that fails (slot's genuinely gone
            // now), tell them plainly.
            renewExpiredHold();
            return;
        }
        const totalSeconds = Math.ceil(msLeft / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        if (timerEl) timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
        if (bannerEl) bannerEl.classList.toggle('is-low', totalSeconds <= 60);
    }

    tick();
    holdCountdownInterval = setInterval(tick, 1000);

    hideHoldExpiredNotice();
    if (bannerEl) bannerEl.hidden = false;
}

async function renewExpiredHold() {
    const key = activeHoldKey;
    const previousHoldId = activeHoldId;
    activeHoldId = null; // the old hold is gone server-side too once expired
    if (!key) return;

    const sel = currentSelection();
    // Bail quietly if the selection has already moved on since the hold
    // was created (e.g. they picked a new time right as the old one
    // lapsed) — the regular change-triggered flow will handle it.
    if (currentHoldKey(sel) !== key) return;

    const result = await requestHold(sel, previousHoldId);
    if (!result) {
        showHoldExpiredNotice();
        await refreshTimeSlots();
    }
}

// Fingerprint of everything that would change which slot is actually
// being held, so re-selecting the same thing twice in a row (e.g.
// updateSummary() firing from an unrelated field) doesn't spam the RPC.
function currentHoldKey(sel) {
    if (!sel.date || !sel.time || !sel.service) return null;
    return [currentGender, selectedBarberId || '', sel.date, sel.time, sel.service.id].join('|');
}

async function requestHold(sel, previousHoldId) {
    if (holdFeatureUnavailable || typeof supabaseClient === 'undefined') return null;
    if (holdRequestInFlight) return null;
    holdRequestInFlight = true;

    const durationMinutes = parseDurationMinutes(sel.service.duration);
    const key = currentHoldKey(sel);

    const { data, error } = await supabaseClient.rpc('create_booking_hold', {
        p_gender: currentGender,
        p_barber_id: selectedBarberId,
        p_booking_date: sel.date,
        p_booking_time: sel.time,
        p_service_duration_minutes: durationMinutes,
        p_previous_hold_id: previousHoldId || null
    });

    holdRequestInFlight = false;

    if (error || !data) {
        if (/create_booking_hold|does not exist|could not find the function/i.test(error?.message || '')) {
            // Migration hasn't been applied yet — degrade silently rather
            // than nag the customer about an internal detail. Booking
            // still works end-to-end without a hold.
            holdFeatureUnavailable = true;
        } else if (/booked|held|available|schedule/i.test(error?.message || '')) {
            // A genuine conflict — surface this like any other slot
            // becoming unavailable, via the normal time-slot refresh.
            return null;
        } else {
            console.warn('Could not hold this slot:', error);
        }
        return null;
    }

    activeHoldId = data.hold_id;
    activeHoldKey = key;
    startHoldCountdown(data.expires_at);
    return data;
}

// Called from updateSummary() on every state-changing action (gender
// tab, location toggle, barber pick, date/time pick). Only actually
// talks to the server when the fingerprinted selection changed.
async function maybeRefreshHold() {
    if (holdFeatureUnavailable) return;

    const sel = currentSelection();
    const key = currentHoldKey(sel);

    if (!key) {
        // Selection is incomplete (no date/time/service yet) — nothing
        // worth holding. Release whatever hold might still be active.
        if (activeHoldId) releaseActiveHold();
        hideHoldExpiredNotice();
        return;
    }

    if (key === activeHoldKey && activeHoldId) return; // nothing changed

    hideHoldExpiredNotice();
    const previousHoldId = activeHoldId;
    // Clear local state up front so a slow/failed request doesn't leave
    // a stale countdown running against the old selection.
    stopHoldCountdown();
    activeHoldId = null;
    activeHoldKey = null;

    const result = await requestHold(sel, previousHoldId);
    if (!result) hideHoldBanner();
}

// ============================================
// FORM SUBMISSION
// ============================================
function showBookingError(message) {
    const el = document.getElementById('bookingError');
    if (!el) return;

    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message || 'Something went wrong. Please try again.');
    el.replaceChildren(icon, text);
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideBookingError() {
    const el = document.getElementById('bookingError');
    if (el) el.hidden = true;
}

function initBookingForm() {
    const form = document.getElementById('bookingForm');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideBookingError();

        const sel = currentSelection();
        if (!sel.service || !sel.date || !sel.time) {
            showBookingError('Please fill in every required field before confirming.');
            return;
        }
        if (contactMethod === 'phone' && (!sel.phone || !isValidBookingPhone(sel.phone))) {
            showBookingError('Please enter a valid contact number so your barber can reach you.');
            return;
        }
        if (contactMethod === 'email' && (!sel.email || !isValidBookingEmail(sel.email))) {
            showBookingError('Please enter a valid email address so we can notify you.');
            return;
        }
        if (currentLocation === 'home' && !selectedAreaName) {
            showBookingError('Please select your area for Home Service.');
            return;
        }
        if (currentLocation === 'home' && sel.address.length < MIN_ADDRESS_LENGTH) {
            showBookingError('Please enter a complete street address so your barber can find you.');
            return;
        }

        const user = getCurrentUser();
        if (!user) {
            showBookingError('Your session expired — please log in again.');
            return;
        }

        const confirmBtn = document.getElementById('bookingConfirmBtn');
        const btnText = confirmBtn.querySelector('.booking-confirm-text');
        const spinner = confirmBtn.querySelector('.booking-confirm-spinner');
        confirmBtn.disabled = true;
        if (btnText) btnText.textContent = 'Booking...';
        if (spinner) spinner.hidden = false;

        // p_hold_id is only included when we actually have an active hold.
        // Omitting the key entirely (rather than sending null) keeps this
        // call compatible with the pre-hold-feature 11-arg version of
        // create_booking_atomic, in case that migration hasn't been
        // applied yet — the hold is a pure enhancement, never required.
        const bookingParams = {
            p_gender: currentGender,
            p_service_id: sel.service.id,
            p_barber_id: selectedBarberId,
            p_location_type: currentLocation,
            p_area: currentLocation === 'home' ? selectedAreaName : null,
            p_address: currentLocation === 'home' ? sel.address : null,
            p_booking_date: sel.date,
            p_booking_time: sel.time,
            p_contact_phone: contactMethod === 'phone' ? sel.phone : null,
            p_contact_preference: contactMethod,
            p_notes: sel.notes.trim() || null
        };
        if (activeHoldId) bookingParams.p_hold_id = activeHoldId;

        const { data, error } = await supabaseClient.rpc('create_booking_atomic', bookingParams);

        if (error || !data) {
            confirmBtn.disabled = false;
            if (btnText) btnText.textContent = 'Confirm Booking';
            if (spinner) spinner.hidden = true;
            console.error(error);
            showBookingError(
                /booked|outside|available/i.test(error?.message || '')
                    ? (error.message || 'That time is no longer available. Please pick another slot.')
                    : /function .*create_booking_atomic|does not exist/i.test(error?.message || '')
                        ? 'Secure booking availability is not installed yet — run the latest Supabase migrations first.'
                        : (error?.message || 'Something went wrong. Please try again.')
            );
            // Whatever hold we had didn't get us through — drop it and
            // let refreshTimeSlots()/updateSummary() sort out whether a
            // fresh hold on the (now re-checked) slot is still possible.
            forgetActiveHold();
            await refreshTimeSlots();
            return;
        }

        confirmBtn.disabled = false;
        if (btnText) btnText.textContent = 'Confirm Booking';
        if (spinner) spinner.hidden = true;

        // The hold (if any) was already consumed server-side inside
        // create_booking_atomic — just drop the client-side countdown.
        forgetActiveHold();

        showBookingSuccess(data, sel);
        loadUpcomingBookings();
    });
}

function showBookingSuccess(booking, sel) {
    const formWrap = document.getElementById('bookingFormWrap');
    const success = document.getElementById('bookingSuccess');
    if (formWrap) formWrap.hidden = true;
    if (success) success.hidden = false;

    setText('bookingSuccessService', `${booking.service_name} — PHP ${booking.service_price.toLocaleString()}`);
    setText('bookingSuccessBarber', booking.barber_name || 'Random');
    setText('bookingSuccessLocation', booking.location_type === 'home'
        ? `Home Service${booking.area ? ' — ' + areaLabel(findBookingArea(booking.area) || { name: booking.area }) : ''} (${booking.address})`
        : 'In-Studio');
    setText('bookingSuccessDateTime', `${formatDateLabel(booking.booking_date)} at ${sel.timeLabel}`);
    setText('bookingSuccessContact', booking.contact_preference === 'email'
        ? `Email: ${sel.email}`
        : `Phone: ${booking.contact_phone || sel.phone}`);

    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// "Book Another Appointment" — resets the form
function initResetButton() {
    const btn = document.getElementById('bookingSuccessReset');
    if (!btn) return;
    btn.addEventListener('click', async function () {
        // Any hold from the just-completed booking was already consumed
        // server-side; this only matters if they'd changed the selection
        // again before clicking "Book Another Appointment".
        releaseActiveHold();

        selectedServiceId = null;
        selectedBarberId = null;
        selectedBarberName = 'Random';
        currentLocation = 'studio';
        selectedAreaName = null;
        currentTravelFee = 0;
        contactMethod = 'phone';
        barberBookedRanges = [];

        const form = document.getElementById('bookingForm');
        if (form) form.reset();

        const areaSelect = document.getElementById('bookingAreaSelect');
        if (areaSelect) areaSelect.value = '';
        const feeNote = document.getElementById('bookingTravelFeeNote');
        if (feeNote) feeNote.hidden = true;
        const timeSelect = document.getElementById('bookingTimeSelect');
        if (timeSelect) { timeSelect.innerHTML = '<option value="">Select a time</option>'; timeSelect.disabled = true; }

        applyLocationToUI();
        renderServiceCard();
        initBarberCards();
        applyContactMethodToUI();
        await initPhoneField();
        await initEmailField();
        await refreshTimeSlots();
        updateSummary();
        initNotesCounter();

        document.getElementById('bookingSuccess').hidden = true;
        document.getElementById('bookingFormWrap').hidden = false;
        document.getElementById('bookingFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// ============================================
// YOUR UPCOMING APPOINTMENTS
// ============================================
function formatTimeLabel(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    return minutesToLabel(h * 60 + m);
}

function statusBadgeClass(status) {
    const safeStatus = ['pending', 'confirmed', 'completed', 'cancelled'].includes(status) ? status : 'unknown';
    return `booking-history-status booking-history-status--${safeStatus}`;
}

async function loadUpcomingBookings() {
    const list = document.getElementById('bookingHistoryList');
    const empty = document.getElementById('bookingHistoryEmpty');
    if (!list) return;

    const user = getCurrentUser();
    if (!user) return;

    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabaseClient
        .from('bookings')
        .select('*')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .gte('booking_date', today)
        .order('booking_date', { ascending: true })
        .order('booking_time', { ascending: true });

    if (error) {
        console.error(error);
        list.innerHTML = '';
        if (empty) {
            empty.hidden = false;
            empty.textContent = 'Couldn\u2019t load your appointments right now — please refresh.';
        }
        return;
    }

    if (!data || !data.length) {
        list.innerHTML = '';
        if (empty) {
            empty.hidden = false;
            empty.textContent = 'No upcoming appointments yet — book one above.';
        }
        return;
    }

    if (empty) empty.hidden = true;

    list.innerHTML = data.map(b => {
        const id = escapeHtml(String(b.id || ''));
        const serviceName = escapeHtml(String(b.service_name || 'Appointment'));
        const barberName = escapeHtml(String(b.barber_name || 'Random'));
        const phone = b.contact_phone ? `&middot; ${escapeHtml(String(b.contact_phone))}` : '';
        const status = String(b.status || 'unknown');
        const statusLabel = escapeHtml(status);
        const location = b.location_type === 'home' ? 'Home Service' : 'In-Studio';
        const cancelButton = status === 'pending' || status === 'confirmed'
            ? `<button type="button" class="booking-history-cancel" data-id="${id}">Cancel</button>`
            : '';

        return `
            <div class="booking-history-item" data-id="${id}">
                <div class="booking-history-main">
                    <h3>${serviceName}</h3>
                    <p class="booking-history-meta">
                        ${formatDateLabel(b.booking_date)} at ${formatTimeLabel(b.booking_time)}
                        &middot; ${location}
                        &middot; ${barberName}
                        ${phone}
                    </p>
                </div>
                <div class="booking-history-aside">
                    <span class="${statusBadgeClass(status)}">${statusLabel}</span>
                    ${cancelButton}
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.booking-history-cancel').forEach(btn => {
        btn.addEventListener('click', function () { cancelBooking(this.dataset.id, this); });
    });
}

// --------------------------------------------
// Cancel — same guard as myappointments.js's handleCancelAppointment():
// under RLS, an UPDATE that matches zero rows (blocked by policy)
// returns error: null, not an error. Postgres never surfaces "blocked
// by policy" as a failure on its own, so without checking the returned
// row count, a blocked cancel would silently report success here while
// the booking's status never actually changed.
// --------------------------------------------
async function cancelBooking(id, btn) {
    if (!window.confirm('Cancel this appointment?')) return;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Cancelling...';
    }

    const { data, error } = await supabaseClient
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select();

    if (error) {
        console.error(error);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Cancel';
        }
        alert('Could not cancel that appointment — please try again.');
        return;
    }

    if (!data || !data.length) {
        // RLS silently matched zero rows (e.g. the booking is no longer
        // in a cancellable status) — treat the same as a blocked policy
        // rather than reporting success.
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Cancel';
        }
        alert('This appointment can no longer be cancelled from here — please refresh the page.');
        return;
    }

    loadUpcomingBookings();
    refreshTimeSlots();
}

// ============================================================
// LOAD BARBERS FROM SUPABASE (FOR BOOKING PAGE)
// ============================================================

async function loadBarbersForBooking() {
    console.log('🔄 Loading barbers for booking...');
    
    try {
        const { data, error } = await supabaseClient
            .from('barbers')
            .select('id, name, title, image_url, rating, service_gender')
            .eq('is_active', true)
            .order('name');

        if (error) {
            console.error('❌ Error loading barbers:', error);
            return [];
        }

        console.log('✅ Loaded barbers for booking:', data.length);
        return data || [];
        
    } catch (error) {
        console.error('❌ Error:', error);
        return [];
    }
}

// ============================================================
// RENDER BARBER CARDS (Dynamic from Supabase)
// ============================================================

async function renderBarberCardsDynamic() {
    const grid = document.getElementById('bookingBarberGrid');
    if (!grid) return;

    const barbers = await loadBarbersForBooking();

    // Build the grid HTML
    let html = `
        <!-- Random option -->
        <button type="button" class="booking-barber-card booking-barber-card--random" data-barber-id="">
            <span class="booking-barber-none-icon"><i class="fas fa-shuffle" aria-hidden="true"></i></span>
            <span class="booking-barber-name">Random</span>
            <span class="booking-barber-role">We'll pick for you</span>
        </button>
    `;

    // Add barbers from database
    barbers.forEach(barber => {
        const imageSrc = barber.image_url || '../images/team.jpg';
        const rating = barber.rating || 0;
        const title = barber.title || 'Barber';
        
        html += `
                <button type="button" class="booking-barber-card" data-barber-id="${escapeHtml(barber.id)}" data-service-gender="${escapeHtml(barber.service_gender || 'all')}">
                <img src="${imageSrc}" alt="" class="booking-barber-photo" loading="lazy" 
                     onerror="this.src='../images/team.jpg'" />
                <span class="booking-barber-name">${escapeHtml(barber.name)}</span>
                <span class="booking-barber-role">${escapeHtml(title)}</span>
                <span class="booking-barber-rating"><i class="fas fa-star" aria-hidden="true"></i> ${rating}</span>
            </button>
        `;
    });

    grid.innerHTML = html;

    // Re-attach event listeners
    grid.querySelectorAll('.booking-barber-card').forEach(card => {
        card.addEventListener('click', function() {
            if (this.classList.contains('is-unavailable')) return;
            selectBarberCard(this);
        });
    });

    // Re-apply gender restrictions
    updateBarberVisibilityForGender();
    
    // Restore selected barber if any
    if (selectedBarberId) {
        const match = grid.querySelector(`.booking-barber-card[data-barber-id="${selectedBarberId}"]`);
        if (match && !match.classList.contains('is-unavailable')) {
            selectBarberCard(match);
        } else {
            const randomCard = grid.querySelector('.booking-barber-card[data-barber-id=""]');
            if (randomCard) selectBarberCard(randomCard);
        }
    }
}

// ============================================================
// SELECT BARBER CARD
// ============================================================

function selectBarberCard(card) {
    const grid = document.getElementById('bookingBarberGrid');
    if (!grid) return;
    
    grid.querySelectorAll('.booking-barber-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedBarberId = card.dataset.barberId || null;
    selectedBarberName = card.querySelector('.booking-barber-name') 
        ? card.querySelector('.booking-barber-name').textContent 
        : 'Random';
    refreshTimeSlots();
    updateSummary();
}

// ============================================================
// UPDATE BARBER VISIBILITY FOR GENDER
// ============================================================

function updateBarberVisibilityForGender() {
    const grid = document.getElementById('bookingBarberGrid');
    if (!grid) return;
    
    const cards = grid.querySelectorAll('.booking-barber-card');
    cards.forEach(card => {
        const serviceGender = card.dataset.serviceGender || 'all';
        const unavailable = currentGender !== 'men' && currentGender !== 'women'
            ? true
            : serviceGender !== 'all' && serviceGender !== currentGender;
        card.classList.toggle('is-unavailable', unavailable);
        card.setAttribute('aria-disabled', String(unavailable));
    });

    // If the currently selected barber just became unavailable, fall back to Random.
    if (selectedBarberId) {
        const selectedCard = grid.querySelector(`.booking-barber-card[data-barber-id="${CSS.escape(selectedBarberId)}"]`);
        if (selectedCard?.classList.contains('is-unavailable')) {
            const randomCard = grid.querySelector('.booking-barber-card[data-barber-id=""]');
            if (randomCard) selectBarberCard(randomCard);
        }
    }
}