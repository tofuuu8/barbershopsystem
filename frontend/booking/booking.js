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
    const grid = document.getElementById('bookingBarberGrid');
    if (!grid) return;

    // For women's haircuts, only Barber Klark is available
    // Hide/disable other barbers when women's is selected
    function updateBarberVisibility() {
        const cards = grid.querySelectorAll('.booking-barber-card');
        cards.forEach(card => {
            const barberId = card.dataset.barberId;
            const unavailable = currentGender === 'women' && barberId && barberId !== 'klark-dizon';
            card.classList.toggle('is-unavailable', unavailable);
            card.setAttribute('aria-disabled', String(unavailable));
        });

        // If the currently selected barber just became unavailable, fall
        // back to Random rather than leaving a disabled card selected.
        if (selectedBarberId && currentGender === 'women' && selectedBarberId !== 'klark-dizon') {
            const randomCard = grid.querySelector('.booking-barber-card[data-barber-id=""]');
            if (randomCard) selectCard(randomCard);
        }
    }

    function selectCard(card) {
        grid.querySelectorAll('.booking-barber-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedBarberId = card.dataset.barberId || null;
        selectedBarberName = card.querySelector('.booking-barber-name')
            ? card.querySelector('.booking-barber-name').textContent
            : 'Random';
        refreshTimeSlots();
        updateSummary();
    }

    grid.querySelectorAll('.booking-barber-card').forEach(card => {
        card.addEventListener('click', function () {
            if (card.classList.contains('is-unavailable')) return;
            selectCard(card);
        });
    });

    // Apply a ?barber= deep link once the cards exist
    if (selectedBarberId) {
        const match = grid.querySelector(`.booking-barber-card[data-barber-id="${selectedBarberId}"]`);
        if (match && !match.classList.contains('is-unavailable')) selectCard(match);
    } else {
        const randomCard = grid.querySelector('.booking-barber-card[data-barber-id=""]');
        if (randomCard) selectCard(randomCard);
    }

    // Update visibility when gender changes
    const genderTabs = document.querySelectorAll('.booking-gender-tab');
    genderTabs.forEach(tab => {
        tab.addEventListener('click', function () {
            setTimeout(updateBarberVisibility, 50);
        });
    });

    updateBarberVisibility();
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
async function fetchBarberBookedRanges(barberId, dateStr) {
    if (!barberId || !dateStr || typeof supabaseClient === 'undefined') return [];

    const { data, error } = await supabaseClient
        .from('bookings')
        .select('booking_time, service_duration')
        .eq('barber_id', barberId)
        .eq('booking_date', dateStr)
        .neq('status', 'cancelled');

    if (error) {
        console.error(error);
        return [];
    }

    return (data || []).map(b => {
        const [h, m] = (b.booking_time || '0:0').split(':').map(Number);
        return { start: h * 60 + m, duration: parseDurationMinutes(b.service_duration) };
    });
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

    barberBookedRanges = await fetchBarberBookedRanges(selectedBarberId, dateStr);

    for (let mins = hours.open; mins + durationMinutes <= hours.close; mins += SLOT_INCREMENT_MINUTES) {
        if (isToday && mins <= nowMinutes) continue;

        const conflict = barberBookedRanges.some(b => rangesOverlap(mins, durationMinutes, b.start, b.duration));
        if (conflict) continue;

        const option = document.createElement('option');
        option.value = minutesTo24h(mins);
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
// FORM SUBMISSION
// ============================================
function showBookingError(message) {
    const el = document.getElementById('bookingError');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${message}</span>`;
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

        // Last-moment availability check. For a specific barber this is a
        // re-check (refreshTimeSlots already filters the dropdown, but
        // someone else could book in the gap). For "Random" (no barber
        // selected) this is also where we assign a barber — we try each
        // candidate in random order and pick the first one whose calendar
        // is clear at the chosen time.
        const durationMinutes = parseDurationMinutes(sel.service.duration);
        const [h, m] = sel.time.split(':').map(Number);
        const startMinutes = h * 60 + m;

        if (selectedBarberId) {
            const freshRanges = await fetchBarberBookedRanges(selectedBarberId, sel.date);
            const conflict = freshRanges.some(b => rangesOverlap(startMinutes, durationMinutes, b.start, b.duration));

            if (conflict) {
                confirmBtn.disabled = false;
                if (btnText) btnText.textContent = 'Confirm Booking';
                if (spinner) spinner.hidden = true;
                showBookingError('That time was just booked with this barber — please pick another slot.');
                await refreshTimeSlots();
                return;
            }
        } else {
            // Random assignment — women's haircuts are only done by
            // Barber Klark, so the pool is just him; men's rotates
            // through all three barbers.
            const candidates = currentGender === 'women'
                ? BOOKING_BARBERS.filter(b => WOMENS_BARBER_IDS.includes(b.id))
                : BOOKING_BARBERS;
            const shuffled = [...candidates].sort(() => Math.random() - 0.5);
            let assignedBarber = null;

            for (const barber of shuffled) {
                const freshRanges = await fetchBarberBookedRanges(barber.id, sel.date);
                const conflict = freshRanges.some(b => rangesOverlap(startMinutes, durationMinutes, b.start, b.duration));
                if (!conflict) { assignedBarber = barber; break; }
            }

            if (!assignedBarber) {
                confirmBtn.disabled = false;
                if (btnText) btnText.textContent = 'Confirm Booking';
                if (spinner) spinner.hidden = true;
                showBookingError('All our barbers are booked at that time — please pick another slot.');
                return;
            }

            selectedBarberId = assignedBarber.id;
            selectedBarberName = assignedBarber.name;
        }

        const total = sel.service.price + (currentLocation === 'home' ? currentTravelFee : 0);

        const { data, error } = await supabaseClient
            .from('bookings')
            .insert({
                user_id: user.id,
                gender: currentGender,
                service_id: sel.service.id,
                service_name: sel.service.name,
                service_price: sel.service.price,
                service_duration: sel.service.duration,
                barber_id: selectedBarberId,
                barber_name: selectedBarberId ? selectedBarberName : null,
                location_type: currentLocation,
                area: currentLocation === 'home' ? selectedAreaName : null,
                address: currentLocation === 'home' ? sel.address : null,
                travel_fee: currentLocation === 'home' ? currentTravelFee : 0,
                total_price: total,
                booking_date: sel.date,
                booking_time: sel.time,
                contact_phone: contactMethod === 'phone' ? sel.phone : null,
                contact_preference: contactMethod,
                notes: sel.notes.trim() || null
            })
            .select()
            .single();

        if (error) {
            confirmBtn.disabled = false;
            if (btnText) btnText.textContent = 'Confirm Booking';
            if (spinner) spinner.hidden = true;
            console.error(error);
            showBookingError(
                /row-level security/i.test(error.message || '')
                    ? 'The bookings table isn\u2019t set up yet — run bookings_setup.sql in the Supabase SQL Editor first.'
                    : /column .*contact_phone/i.test(error.message || '')
                        ? 'The bookings table needs a small update — run: alter table public.bookings add column if not exists contact_phone text;'
                    : /column .*contact_preference/i.test(error.message || '')
                        ? 'The bookings table needs a small update — run: alter table public.bookings add column if not exists contact_preference text;'
                        : (error.message || 'Something went wrong. Please try again.')
            );
            return;
        }

        confirmBtn.disabled = false;
        if (btnText) btnText.textContent = 'Confirm Booking';
        if (spinner) spinner.hidden = true;

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
    return `booking-history-status booking-history-status--${status}`;
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

    list.innerHTML = data.map(b => `
        <div class="booking-history-item" data-id="${b.id}">
            <div class="booking-history-main">
                <h3>${b.service_name}</h3>
                <p class="booking-history-meta">
                    ${formatDateLabel(b.booking_date)} at ${formatTimeLabel(b.booking_time)}
                    &middot; ${b.location_type === 'home' ? 'Home Service' : 'In-Studio'}
                    &middot; ${b.barber_name || 'Random'}
                    ${b.contact_phone ? `&middot; ${b.contact_phone}` : ''}
                </p>
            </div>
            <div class="booking-history-aside">
                <span class="${statusBadgeClass(b.status)}">${b.status}</span>
                ${b.status === 'pending' || b.status === 'confirmed'
                    ? `<button type="button" class="booking-history-cancel" data-id="${b.id}">Cancel</button>`
                    : ''}
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.booking-history-cancel').forEach(btn => {
        btn.addEventListener('click', function () { cancelBooking(this.dataset.id); });
    });
}

async function cancelBooking(id) {
    if (!window.confirm('Cancel this appointment?')) return;

    const { error } = await supabaseClient
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', id);

    if (error) {
        console.error(error);
        alert('Could not cancel that appointment — please try again.');
        return;
    }

    loadUpcomingBookings();
    refreshTimeSlots();
}