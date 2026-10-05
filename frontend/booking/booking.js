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
let BOOKING_HOME_AREAS = [
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

// The hardcoded list above is only a fallback now. The real source of
// truth is the delivery_areas table (name, label, fee, is_active), so a
// fee change is one row edit instead of three code edits. If the table
// can't be read (RLS, offline), the fallback keeps booking usable.
async function loadBookingAreas() {
    if (typeof supabaseClient === 'undefined') return;
    try {
        const { data, error } = await supabaseClient
            .from('delivery_areas')
            .select('name, label, fee, is_active')
            .eq('is_active', true)
            .order('fee', { ascending: true });
        if (error || !data || !data.length) return;
        BOOKING_HOME_AREAS = data.map(row => ({
            name: String(row.name).toLowerCase(),
            label: row.label || undefined,
            fee: Number(row.fee) || 0
        }));
    } catch (err) {
        console.warn('Could not load delivery areas, using built-in list:', err);
    }
}

function renderCoverageChips() {
    const wrap = document.getElementById('bookingCoverageChips');
    if (!wrap) return;
    wrap.replaceChildren();
    BOOKING_HOME_AREAS.forEach(area => {
        const chip = document.createElement('span');
        chip.className = 'booking-coverage-chip';
        chip.textContent = areaLabel(area);
        wrap.appendChild(chip);
    });
}

// PHP amount for display; tolerant of numeric strings from Postgres.
function php(n) {
    return `PHP ${(Number(n) || 0).toLocaleString()}`;
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
// Local (not UTC) YYYY-MM-DD for "today" — new Date().toISOString()
// gives the UTC date, which runs a day behind Philippine local time
// (UTC+8) during the early-morning window (~12:00am-7:59am PH time).
// Using the UTC string as "today" in that window would let the date
// picker's min go a day stale, make the isToday check in
// refreshTimeSlots() miss today entirely (so already-passed times
// wouldn't get filtered out), and make loadUpcomingBookings()'s
// "upcoming" cutoff a day too early (so a booking from yesterday could
// still show as upcoming). Building the string from local
// getFullYear/getMonth/getDate avoids all three.
function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

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

// First-of-month currently shown in the custom calendar widget —
// independent of the selected date, since browsing to a future month
// to look around shouldn't itself change what's booked.
let calendarViewDate = new Date();
calendarViewDate.setDate(1);
calendarViewDate.setHours(0, 0, 0, 0);

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
    await loadBookingAreas();
    readInitialStateFromUrl();
    initLocationToggle();
    initRadioGroups();
    applyInitialArea();
    initGenderTabs();
    initContactMethodToggle();
    initNotesCounter();
    initBookingForm();
    initStepTracker();
    initResetButton();
    initReceiptDownloadButton();
    initMobileSummarySheet();
    applyLocationToUI();
    applyGenderToUI();
    renderServiceCard();
    initBarberCards();
    await initPreferredBarber();
    await initPhoneField();
    await initEmailField();
    await initSavedAddresses();
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
// Area handed over from the services page: either ?area= on the link, or
// the area that page saved in sessionStorage when the visitor checked
// coverage. Only used for Home Service, and only if it's still a covered area.
let initialAreaName = null;
const HOME_SERVICE_STORAGE_KEY = 'toughcuts_home_service_check';

function savedServicesPageArea() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(HOME_SERVICE_STORAGE_KEY) || 'null');
        return saved && saved.unlocked && saved.areaName ? String(saved.areaName).toLowerCase() : null;
    } catch (e) {
        return null;
    }
}

function applyInitialArea() {
    if (currentLocation !== 'home') return;
    const name = initialAreaName || savedServicesPageArea();
    if (name && findBookingArea(name)) setSelectedArea(name);
}

function readInitialStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const gender = params.get('gender');
    const barber = params.get('barber');
    initialAreaName = (params.get('area') || '').toLowerCase() || null;

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
        btn.setAttribute('aria-checked', String(active));
        btn.tabIndex = active ? 0 : -1;
    });

    const homeFields = document.getElementById('bookingHomeFields');
    if (homeFields) homeFields.hidden = currentLocation !== 'home';
}

// The three segmented toggles (location, service gender, contact method)
// pick exactly one option and have no panels, so they're radio groups, not
// tabs. This adds the keyboard model radio groups promise: one tab stop per
// group, arrow keys move the selection.
function initRadioGroups() {
    document.querySelectorAll('.booking-location-toggle, .booking-gender-tabs, .booking-contact-method').forEach(group => {
        if (group.dataset.radioReady) return;
        group.dataset.radioReady = 'true';
        const items = () => Array.from(group.querySelectorAll('[role="radio"]'));
        items().forEach(i => { i.tabIndex = i.getAttribute('aria-checked') === 'true' ? 0 : -1; });

        group.addEventListener('keydown', function (e) {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            if (!(e.key in step) && e.key !== 'Home' && e.key !== 'End') return;
            const list = items();
            const current = list.indexOf(e.target.closest('[role="radio"]'));
            if (current === -1) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 0
                : e.key === 'End' ? list.length - 1
                : (current + step[e.key] + list.length) % list.length;
            list[next].focus();
            list[next].click();
        });
    });
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
    renderCoverageChips();

    const areaSelect = document.getElementById('bookingAreaSelect');
    if (areaSelect) {
        areaSelect.addEventListener('change', function () {
            setSelectedArea(areaSelect.value);
        });
    }
}

// Single place that applies an area choice (dropdown, deep link, or a
// saved address) so state, fee note, slots and summary never disagree.
function setSelectedArea(name) {
    const area = name ? findBookingArea(name) : null;
    selectedAreaName = area ? area.name : null;
    currentTravelFee = area ? area.fee : 0;

    const areaSelect = document.getElementById('bookingAreaSelect');
    if (areaSelect && areaSelect.value !== (area ? area.name : '')) {
        areaSelect.value = area ? area.name : '';
        clearFieldError(areaSelect);
    }

    const feeNote = document.getElementById('bookingTravelFeeNote');
    if (feeNote) {
        feeNote.hidden = !area;
        if (area) feeNote.textContent = `+ ${php(area.fee)} travel fee`;
    }

    // Area can change how long the barber is tied up (travel buffer), so
    // availability has to be re-checked, not just the summary.
    refreshTimeSlots();
    updateSummary();
}

function populateAreaSelect() {
    const select = document.getElementById('bookingAreaSelect');
    if (!select) return;
    select.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
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
        tab.setAttribute('aria-checked', String(active));
        tab.tabIndex = active ? 0 : -1;
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
// MOBILE SUMMARY SHEET
// ============================================
// The toggle only exists visually on mobile (booking.css's ≤768px
// block turns .booking-summary into a fixed bottom sheet), but the
// listener is harmless to attach unconditionally — on desktop the
// button stays display:none and is never reachable by mouse or tab.
function initMobileSummarySheet() {
    const toggle = document.getElementById('bookingSummaryToggle');
    const details = document.getElementById('bookingSummaryDetails');
    const backdrop = document.getElementById('bookingSummaryBackdrop');
    if (!toggle || !details) return;

    function setExpanded(expanded) {
        toggle.setAttribute('aria-expanded', String(expanded));
        details.classList.toggle('is-expanded', expanded);
        toggle.querySelector('span').textContent = expanded ? 'Hide breakdown' : 'View full breakdown';
        // The backdrop is what turns this into an obvious "reviewing
        // your order" overlay instead of the breakdown just silently
        // covering the step form behind it — and gives a large, easy
        // tap target to back out of it again.
        if (backdrop) backdrop.hidden = !expanded;
    }

    toggle.addEventListener('click', function () {
        setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });

    if (backdrop) {
        backdrop.addEventListener('click', function () {
            setExpanded(false);
        });
    }
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
        btn.setAttribute('aria-checked', String(active));
        btn.tabIndex = active ? 0 : -1;
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

    input.value = formatPhMobile(data.phone);
}

async function initEmailField() {
    const input = document.getElementById('bookingEmailInput');
    if (!input) return;

    const user = getCurrentUser();
    if (!user) return;

    if (user.email) input.value = user.email;
}

// --------------------------------------------
// Saved addresses (Home Service)
// --------------------------------------------
// Reads profiles.address (the account page's default address) and
// profiles.saved_addresses (jsonb array) and offers them as a picker above
// the street-address box. The jsonb shape is written by the account page,
// so entries are normalized defensively: a plain string, or an object with
// a label and an address under any of the usual key names.
let savedAddressOptions = [];

function normalizeSavedAddress(entry, isDefault) {
    if (!entry) return null;
    if (typeof entry === 'string') {
        const text = cleanAddressText(entry);
        return text ? { label: isDefault ? 'Default' : '', address: text, area: null, isDefault } : null;
    }
    if (typeof entry !== 'object') return null;
    const pick = (...keys) => keys.map(k => entry[k]).find(v => typeof v === 'string' && v.trim());
    const address = cleanAddressText(pick('address', 'street', 'full_address', 'line1', 'value') || '');
    if (!address) return null;
    const area = (pick('area') || '').toLowerCase();
    return {
        label: pick('label', 'name', 'title') || (isDefault ? 'Default' : ''),
        address,
        area: findBookingArea(area) ? area : null,
        isDefault: !!(isDefault || entry.is_default || entry.isDefault || entry.default)
    };
}

async function initSavedAddresses() {
    const field = document.getElementById('bookingSavedAddressField');
    const select = document.getElementById('bookingSavedAddressSelect');
    const textarea = document.getElementById('bookingAddressInput');
    if (!field || !select || !textarea) return;

    field.hidden = true;

    const user = getCurrentUser();
    if (!user || typeof supabaseClient === 'undefined') return;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('address, saved_addresses')
        .eq('id', user.id)
        .maybeSingle();
    if (error || !data) return;

    const seen = new Set();
    const found = [];
    const add = item => {
        if (!item) return;
        const key = item.address.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        found.push(item);
    };

    add(normalizeSavedAddress(data.address, true));
    (Array.isArray(data.saved_addresses) ? data.saved_addresses : [])
        .forEach(e => add(normalizeSavedAddress(e, false)));

    // Default address first, then the rest in the order the account page stores them.
    found.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    savedAddressOptions = found;
    if (!savedAddressOptions.length) return;

    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a saved address';
    select.appendChild(placeholder);
    savedAddressOptions.forEach((item, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        const text = item.address.length > 60 ? item.address.slice(0, 57) + '\u2026' : item.address;
        option.textContent = item.label ? `${item.label} \u2014 ${text}` : text;
        select.appendChild(option);
    });
    field.hidden = false;

    if (!select.dataset.bound) {
        select.dataset.bound = 'true';
        select.addEventListener('change', function () {
            const item = savedAddressOptions[Number(select.value)];
            if (!item) return;
            textarea.value = item.address;
            clearFieldError(textarea);
            if (item.area) setSelectedArea(item.area);
            updateSummary();
        });
    }

    // Prefill the default so the common case is zero typing, but never over
    // something the visitor already typed.
    const defaultIndex = savedAddressOptions.findIndex(a => a.isDefault);
    if (defaultIndex !== -1 && !textarea.value.trim()) {
        select.value = String(defaultIndex);
        textarea.value = savedAddressOptions[defaultIndex].address;
        if (savedAddressOptions[defaultIndex].area && !selectedAreaName) {
            setSelectedArea(savedAddressOptions[defaultIndex].area);
        }
    }
}

// If the visitor edits the street box by hand, the picker no longer
// describes what's in it.
document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'bookingAddressInput') {
        const select = document.getElementById('bookingSavedAddressSelect');
        if (select && select.value) {
            const item = savedAddressOptions[Number(select.value)];
            if (!item || cleanAddressText(e.target.value) !== item.address) select.value = '';
        }
    }
});

// Rules live in main.js (validatePhMobile / validateEmailText /
// validateAddressText) so booking, checkout and My Account all agree.
function isValidBookingPhone(phone) {
    return !validatePhMobile(phone).error;
}

function isValidBookingEmail(email) {
    return !validateEmailText(email);
}

// ============================================
// DATE & TIME
// ============================================
// Home visits take travel time, so the server needs to know where the
// appointment is to block the barber for the right window. These two
// params only exist once the matching migration is applied (see
// 202610050001_home_service_travel_buffer.sql). Until then the call is
// retried without them, so booking keeps working exactly as before.
let locationParamsSupported = true;

function locationParams() {
    return {
        p_location_type: currentLocation,
        p_area: currentLocation === 'home' ? selectedAreaName : null
    };
}

async function rpcWithLocation(fn, params) {
    if (locationParamsSupported) {
        const result = await supabaseClient.rpc(fn, Object.assign({}, params, locationParams()));
        const missing = result.error && /could not find the function|does not exist|PGRST202/i.test(
            (result.error.message || '') + ' ' + (result.error.code || '')
        );
        if (!missing) return result;
        locationParamsSupported = false;
    }
    return supabaseClient.rpc(fn, params);
}

async function fetchAvailableBookingSlots(barberId, dateStr, durationMinutes) {
    if (!dateStr || typeof supabaseClient === 'undefined') return [];

    const { data, error } = await rpcWithLocation('get_available_booking_slots', {
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
    dateInput.min = localDateStr(today);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + MAX_BOOKING_DAYS_AHEAD);
    dateInput.max = localDateStr(maxDate);

    dateInput.addEventListener('change', refreshTimeSlots);
    document.getElementById('bookingTimeSelect') &&
        document.getElementById('bookingTimeSelect').addEventListener('change', updateSummary);

    initCalendarUI();
    initTimeGridUI();

    await refreshTimeSlots();
}

// --------------------------------------------
// Custom calendar — a purpose-built month grid instead of the native
// date picker (inconsistent across browsers/OSes and gives no sense
// of "what's actually available" at a glance). It only ever writes
// to the hidden #bookingDateInput and dispatches a real 'change'
// event on it, so refreshTimeSlots() and everything downstream of it
// keeps working exactly as before — this is a new face, not a new
// data path.
// --------------------------------------------
function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function renderCalendar() {
    const grid = document.getElementById('bookingCalDays');
    const monthLabel = document.getElementById('bookingCalMonthLabel');
    const dateInput = document.getElementById('bookingDateInput');
    if (!grid || !dateInput) return;

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const totalDays = daysInMonth(year, month);

    const todayStr = localDateStr(new Date());
    const minStr = dateInput.min || todayStr;
    const maxStr = dateInput.max;
    const selectedStr = dateInput.value;

    if (monthLabel) {
        monthLabel.textContent = calendarViewDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    }

    grid.replaceChildren();

    for (let i = 0; i < firstWeekday; i++) {
        const pad = document.createElement('span');
        pad.className = 'booking-calendar-day is-empty';
        pad.setAttribute('aria-hidden', 'true');
        grid.appendChild(pad);
    }

    for (let day = 1; day <= totalDays; day++) {
        const dateObj = new Date(year, month, day);
        const dStr = localDateStr(dateObj);
        const closed = !hoursForDate(dStr);
        const outOfRange = dStr < minStr || (maxStr && dStr > maxStr);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'booking-calendar-day';
        btn.textContent = String(day);
        btn.dataset.date = dStr;

        if (closed || outOfRange) btn.disabled = true;
        if (closed && !outOfRange) btn.classList.add('is-closed');
        if (dStr === todayStr) btn.classList.add('is-today');
        if (dStr === selectedStr) {
            btn.classList.add('is-selected');
            btn.setAttribute('aria-current', 'date');
        }

        const spokenDate = dateObj.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
        btn.setAttribute('aria-label', closed ? `${spokenDate}, closed` : spokenDate);

        grid.appendChild(btn);
    }

    const prevBtn = document.getElementById('bookingCalPrev');
    const nextBtn = document.getElementById('bookingCalNext');
    const viewMonthStart = new Date(year, month, 1);

    const todayMonthStart = new Date();
    todayMonthStart.setDate(1);
    todayMonthStart.setHours(0, 0, 0, 0);
    if (prevBtn) prevBtn.disabled = viewMonthStart <= todayMonthStart;

    if (nextBtn) {
        if (maxStr) {
            const maxDateObj = new Date(maxStr + 'T00:00:00');
            const maxMonthStart = new Date(maxDateObj.getFullYear(), maxDateObj.getMonth(), 1);
            nextBtn.disabled = viewMonthStart >= maxMonthStart;
        } else {
            nextBtn.disabled = false;
        }
    }
}

function initCalendarUI() {
    const grid = document.getElementById('bookingCalDays');
    const dateInput = document.getElementById('bookingDateInput');
    const prevBtn = document.getElementById('bookingCalPrev');
    const nextBtn = document.getElementById('bookingCalNext');
    if (!grid || !dateInput) return;

    grid.addEventListener('click', function (e) {
        const btn = e.target.closest('.booking-calendar-day');
        if (!btn || btn.disabled || !btn.dataset.date) return;
        dateInput.value = btn.dataset.date;
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        renderCalendar();
    });

    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
            renderCalendar();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
            renderCalendar();
        });
    }

    renderCalendar();
}

// --------------------------------------------
// Custom time slot grid — a visual layer over the hidden
// #bookingTimeSelect. refreshTimeSlots() (unchanged, called from many
// places already) still owns availability: it rebuilds that select's
// <option> list exactly as before. A MutationObserver on that list is
// the single hook that keeps this grid in sync, so every existing
// call site benefits automatically without being touched.
// --------------------------------------------
function renderTimeGrid() {
    const select = document.getElementById('bookingTimeSelect');
    const grid = document.getElementById('bookingTimeGrid');
    const label = document.getElementById('bookingTimeLabel');
    const dateInput = document.getElementById('bookingDateInput');
    if (!select || !grid) return;

    const options = Array.from(select.options).filter(o => o.value);

    grid.replaceChildren();
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'booking-time-slot';
        btn.textContent = opt.textContent;
        btn.dataset.value = opt.value;
        if (opt.value === select.value) btn.classList.add('is-selected');
        grid.appendChild(btn);
    });

    grid.hidden = options.length === 0;

    const hasDate = !!(dateInput && dateInput.value);
    if (label) {
        if (!hasDate) {
            label.textContent = 'Pick a date to see available times';
            label.hidden = false;
        } else if (options.length === 0) {
            // The closed-note element right below already explains why
            // (Sunday, or nothing left today) — no need to say it twice.
            label.hidden = true;
        } else {
            label.textContent = `Available times — ${formatDateLabel(dateInput.value)}`;
            label.hidden = false;
        }
    }
}

function initTimeGridUI() {
    const select = document.getElementById('bookingTimeSelect');
    const grid = document.getElementById('bookingTimeGrid');
    if (!select || !grid) return;

    grid.addEventListener('click', function (e) {
        const btn = e.target.closest('.booking-time-slot');
        if (!btn) return;
        select.value = btn.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        grid.querySelectorAll('.booking-time-slot').forEach(b => b.classList.toggle('is-selected', b === btn));
    });

    new MutationObserver(renderTimeGrid).observe(select, { childList: true });
    renderTimeGrid();
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
    const isToday = dateStr === localDateStr(today);
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

    // Confirm stays clickable on purpose: pressing it with something
    // missing highlights what to fix (see the submit handler) instead of
    // a greyed-out button with no explanation. It's only disabled while
    // a booking is being sent.

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
        1: currentLocation === 'studio' || (!!selectedAreaName && !validateAddressText(sel.address)),
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

    syncStepTracker(stepDone, doneCount === totalSteps);
}

// --------------------------------------------
// Desktop step tracker (see the HTML comment above its markup).
// Reuses the exact stepDone/doneCount just computed above rather
// than re-deriving state, so the tracker can never drift out of
// sync with the cards' own checkmarks. "Current" is simply the
// first step not yet answered — the same thing a person scanning
// the page top-to-bottom would call "what's next" — falling
// through to the optional Notes step once everything required is
// done.
// --------------------------------------------
function syncStepTracker(stepDone, allRequiredDone) {
    const tracker = document.getElementById('bookingStepTracker');
    if (!tracker) return;

    let current = null;
    for (let step = 1; step <= 5; step++) {
        if (!stepDone[step]) { current = step; break; }
    }
    if (current === null) current = 6;

    tracker.querySelectorAll('.booking-step-tracker-item').forEach(item => {
        const step = Number(item.dataset.gotoStep);
        const done = step === 6 ? !!allRequiredDone : !!stepDone[step];
        item.classList.toggle('is-done', done);
        item.classList.toggle('is-current', step === current);
        if (step === current) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
    });
}

// Click-to-jump — scrolls the matching card into the middle of the
// viewport and moves focus to its heading, so keyboard/screen-reader
// users land somewhere meaningful rather than just at the top of a
// long card.
function initStepTracker() {
    const tracker = document.getElementById('bookingStepTracker');
    if (!tracker) return;

    tracker.addEventListener('click', function (e) {
        const btn = e.target.closest('.booking-step-tracker-item');
        if (!btn) return;
        const card = document.querySelector(`.booking-card[data-step="${btn.dataset.gotoStep}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const heading = card.querySelector('.booking-card-title');
        if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
    });
}

const MIN_ADDRESS_LENGTH = 10;

function isSelectionComplete(sel) {
    if (!sel.service || !sel.date || !sel.time) return false;
    if (contactMethod === 'phone' && (!sel.phone || !isValidBookingPhone(sel.phone))) return false;
    if (contactMethod === 'email' && (!sel.email || !isValidBookingEmail(sel.email))) return false;
    if (currentLocation === 'home' && (!selectedAreaName || validateAddressText(sel.address))) return false;
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
    return [currentGender, selectedBarberId || '', sel.date, sel.time, sel.service.id,
        currentLocation, currentLocation === 'home' ? (selectedAreaName || '') : ''].join('|');
}

async function requestHold(sel, previousHoldId) {
    if (holdFeatureUnavailable || typeof supabaseClient === 'undefined') return null;
    if (holdRequestInFlight) return null;
    holdRequestInFlight = true;

    const durationMinutes = parseDurationMinutes(sel.service.duration);
    const key = currentHoldKey(sel);

    const { data, error } = await rpcWithLocation('create_booking_hold', {
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

// --------------------------------------------
// Field-level validation. Marks a single input's own wrapper as
// invalid, drops a clay-colored fix message right under it, and
// scrolls/focuses that exact field — instead of the visitor having
// to read a banner at the top of a six-step form and guess which of
// the twelve fields it means. Self-clears on the field's next input,
// so fixing the value removes the error immediately rather than
// waiting for another submit attempt.
// --------------------------------------------
function setFieldError(input, message, opts) {
    if (!input) return;
    const field = input.closest('.booking-field');
    if (!field) return;

    // On-blur checks pass { focus: false } so tabbing away from a field
    // never yanks the page or the cursor somewhere else.
    const shouldFocus = !opts || opts.focus !== false;

    field.classList.add('has-error');
    field.classList.remove('has-success');
    input.setAttribute('aria-invalid', 'true');

    let msg = field.querySelector('.booking-field-error');
    if (!msg) {
        msg = document.createElement('p');
        msg.className = 'booking-field-error';
        field.appendChild(msg);
    }
    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    msg.replaceChildren(icon, text);

    if (shouldFocus) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => input.focus(), 280);
    }

    if (!input.dataset.hasErrorClearListener) {
        input.dataset.hasErrorClearListener = 'true';
        input.addEventListener('input', () => clearFieldError(input));
        input.addEventListener('change', () => clearFieldError(input));
    }
}

function clearFieldError(input) {
    if (!input) return;
    const field = input.closest('.booking-field');
    if (!field) return;
    field.classList.remove('has-error');
    input.removeAttribute('aria-invalid');
    const msg = field.querySelector('.booking-field-error');
    if (msg) msg.remove();
}

// Checks one field and shows/clears its inline message. Returns true
// when the field is fine. Shared by the on-blur hints and the submit check.
function validateBookingField(input, opts) {
    if (!input) return true;
    let message = '';
    if (input.id === 'bookingPhoneInput') message = validatePhMobile(input.value).error;
    else if (input.id === 'bookingEmailInput') message = validateEmailText(input.value);
    else if (input.id === 'bookingAddressInput') message = validateAddressText(input.value);
    else if (input.id === 'bookingAreaSelect') message = input.value ? '' : 'Select your area for Home Service.';

    if (message) {
        setFieldError(input, message, opts);
        return false;
    }
    clearFieldError(input);
    return true;
}

function initBookingForm() {
    const form = document.getElementById('bookingForm');
    if (!form) return;

    // Tell the visitor as soon as they leave a field, not only on submit.
    // Empty fields stay quiet until they try to continue.
    ['bookingPhoneInput', 'bookingEmailInput', 'bookingAddressInput'].forEach(function (id) {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('blur', function () {
            if (!input.value.trim()) return;
            validateBookingField(input, { focus: false });
        });
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideBookingError();

        const sel = currentSelection();

        // Name exactly what's still missing, e.g. "Please choose a date and a time."
        const missing = [];
        if (!sel.service) missing.push('a service');
        if (!sel.date) missing.push('a date');
        if (!sel.time) missing.push('a time');
        const missingSelections = missing.length > 0;

        // Check every visible field and show all problems at once; only
        // the first one scrolls/focuses, so fixing it doesn't just reveal
        // the next error on the following attempt.
        const fieldsToCheck = [];
        if (currentLocation === 'home') {
            fieldsToCheck.push(document.getElementById('bookingAreaSelect'));
            fieldsToCheck.push(document.getElementById('bookingAddressInput'));
        }
        fieldsToCheck.push(document.getElementById(contactMethod === 'phone' ? 'bookingPhoneInput' : 'bookingEmailInput'));

        // When a service/date/time is missing the banner below is what
        // scrolls into view, so the fields get highlighted without also
        // fighting it for focus.
        let firstInvalid = !missingSelections;
        let allValid = true;
        fieldsToCheck.forEach(function (input) {
            const ok = validateBookingField(input, { focus: firstInvalid });
            if (!ok) {
                allValid = false;
                firstInvalid = false;
            }
        });

        if (missingSelections) {
            const list = missing.length > 1
                ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1]
                : missing[0];
            showBookingError('Please choose ' + list + ' to continue.');
            return;
        }
        if (!allValid) return;

        // Send the cleaned-up number (09XXXXXXXXX) rather than whatever
        // formatting the visitor typed.
        if (contactMethod === 'phone') sel.phone = validatePhMobile(sel.phone).value;
        if (currentLocation === 'home') sel.address = cleanAddressText(sel.address);

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

        let data = null;
        let error = null;
        try {
            const result = await supabaseClient.rpc('create_booking_atomic', bookingParams);
            data = result.data;
            error = result.error;
        } catch (thrown) {
            // Network drop mid-request - supabase-js usually returns this
            // as `error`, but some browsers/extensions make fetch throw.
            error = thrown;
        }

        if (error || !data) {
            confirmBtn.disabled = false;
            if (btnText) btnText.textContent = 'Confirm Booking';
            if (spinner) spinner.hidden = true;
            console.error(error);
            showBookingError(
                /booked|outside|available/i.test(error?.message || '')
                    ? (error.message || 'That time is no longer available. Please pick another slot.')
                    : /function .*create_booking_atomic|does not exist/i.test(error?.message || '')
                        ? 'Booking is temporarily unavailable. Please try again shortly or call the studio.'
                        : friendlyErrorMessage(error, "We couldn't complete your booking. Please try again.")
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

    // Prefer what the server stored; fall back to what the visitor was quoted
    // so the receipt can never show less than the summary did.
    const servicePrice = Number(booking.service_price ?? (sel.service ? sel.service.price : 0)) || 0;
    const isHome = booking.location_type === 'home';
    const travelFee = isHome ? (Number(booking.travel_fee ?? currentTravelFee) || 0) : 0;
    const totalPrice = Number(booking.total_price ?? (servicePrice + travelFee)) || (servicePrice + travelFee);

    setText('bookingSuccessService', `${booking.service_name} \u2014 ${php(servicePrice)}`);
    const feeRow = document.getElementById('bookingSuccessFeeRow');
    if (feeRow) feeRow.hidden = !isHome || !travelFee;
    setText('bookingSuccessFee', php(travelFee));
    setText('bookingSuccessTotal', php(totalPrice));
    setText('bookingSuccessBarber', booking.barber_name || 'Random');
    setText('bookingSuccessLocation', booking.location_type === 'home'
        ? `Home Service${booking.area ? ' — ' + areaLabel(findBookingArea(booking.area) || { name: booking.area }) : ''} (${booking.address})`
        : 'In-Studio');
    setText('bookingSuccessDateTime', `${formatDateLabel(booking.booking_date)} at ${sel.timeLabel}`);
    setText('bookingSuccessContact', booking.contact_preference === 'email'
        ? `Email: ${sel.email}`
        : `Phone: ${booking.contact_phone || sel.phone}`);

    renderReceiptQr(Object.assign({}, booking, {
        travel_fee: travelFee,
        total_price: totalPrice
    }), sel);

    success.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --------------------------------------------
// DIGITAL RECEIPT — QR code proof-of-booking
// --------------------------------------------
// Encodes the booking's own reference + details into a QR code, purely
// client-side (via the qrcodejs library loaded in booking.html) — no
// external QR API call, so nothing about the booking leaves the
// browser just to render the code. Scanning it just reveals the same
// plain-text summary a staff member could ask the visitor to read out
// loud; it isn't a signed/verifiable token, just a fast, legible way to
// carry the same proof shown in "Your Upcoming Appointments" and on
// this receipt.
function renderReceiptQr(booking, sel) {
    const container = document.getElementById('bookingReceiptQr');
    if (!container) return;
    container.innerHTML = '';

    const refId = String(booking.id || '').slice(0, 8).toUpperCase();
    setText('bookingReceiptId', refId || '\u2014');

    if (typeof QRCode === 'undefined') {
        // QR library failed to load (offline CDN, blocked script, etc.) —
        // the reference ID above still stands as proof, just without the
        // scannable code.
        container.textContent = 'QR unavailable';
        return;
    }

    // Keep this short and capped — the bundled qrcode.min.js throws
    // ("code length overflow") instead of degrading gracefully once the
    // payload is too long for the QR version it auto-selects. Left
    // unguarded, that throw would propagate all the way up through
    // showBookingSuccess() into the form submit handler, skipping the
    // loadUpcomingBookings() call right after it — so a successful
    // booking could end up not refreshing the visitor's appointment
    // list, on top of losing the QR itself. Ref/Booking ID alone are
    // enough to look this appointment up.
    // Booking ID goes before the money lines so the 200-char cap can only
    // ever trim the tail, never the lookup key.
    const qrLines = [
        'TOUGHCUTS APPOINTMENT',
        `Ref: ${refId}`,
        `Booking ID: ${booking.id}`
    ];
    if (Number(booking.travel_fee) > 0) {
        const area = booking.area ? areaLabel(findBookingArea(booking.area) || { name: booking.area }) : 'Home';
        qrLines.push(`Travel: ${php(booking.travel_fee)} (${area})`);
    }
    qrLines.push(`Total: ${php(booking.total_price)}`);
    const qrPayload = qrLines.join('\n').slice(0, 200);

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

// "Save Receipt" — screenshots the ticket (icon, details, and QR —
// everything inside #bookingReceiptCapture, not the action buttons)
// and downloads it as a PNG the visitor can keep, print, or show at
// check-in.
function initReceiptDownloadButton() {
    const btn = document.getElementById('bookingSuccessDownload');
    if (!btn) return;

    btn.addEventListener('click', async function () {
        const node = document.getElementById('bookingReceiptCapture');
        if (!node || typeof html2canvas === 'undefined') {
            showSiteNotice('Saving isn\u2019t available right now \u2014 please take a screenshot instead.', 'error');
            return;
        }

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Preparing...';

        try {
            const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#141414';
            const canvas = await html2canvas(node, {
                backgroundColor: cardBg,
                scale: 2,
                useCORS: true
            });

            const refId = document.getElementById('bookingReceiptId');
            const refText = (refId && refId.textContent && refId.textContent !== '\u2014')
                ? refId.textContent
                : 'receipt';

            const link = document.createElement('a');
            link.download = `toughcuts-appointment-${refText}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error(err);
            showSiteNotice('Couldn\u2019t save the receipt \u2014 please try taking a screenshot instead.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });
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

        // form.reset() above already cleared the hidden #bookingDateInput's
        // value — this just brings the visual calendar/time-grid back in
        // sync with that (jumping back to the current month) since a
        // native reset doesn't fire the events our render functions
        // listen for.
        calendarViewDate = new Date();
        calendarViewDate.setDate(1);
        calendarViewDate.setHours(0, 0, 0, 0);
        renderCalendar();
        renderTimeGrid();

        applyLocationToUI();
        renderServiceCard();
        initBarberCards();
        applyContactMethodToUI();
        await initPhoneField();
        await initEmailField();
        await initSavedAddresses();
        await refreshTimeSlots();
        updateSummary();
        initNotesCounter();

        const qrContainer = document.getElementById('bookingReceiptQr');
        if (qrContainer) qrContainer.innerHTML = '';
        setText('bookingReceiptId', '\u2014');

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

    // Shimmer placeholders while the fetch is in flight, same pattern
    // as the barber grid above — otherwise this section just sits
    // blank (no empty-state text, since that's reserved for the
    // genuinely-empty case) until the request resolves.
    if (empty) empty.hidden = true;
    list.innerHTML = Array.from({ length: 2 }).map(() => `
        <div class="booking-history-item skeleton" aria-hidden="true">
            <div class="booking-history-main booking-history-skel-lines">
                <span class="booking-skel-line booking-skel-line--wide booking-skeleton-shimmer"></span>
                <span class="booking-skel-line booking-skel-line--medium booking-skeleton-shimmer"></span>
            </div>
        </div>
    `).join('');

    const today = localDateStr(new Date());

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
        const isHome = b.location_type === 'home';
        const areaText = isHome && b.area
            ? areaLabel(findBookingArea(String(b.area).toLowerCase()) || { name: String(b.area) })
            : '';
        const location = isHome
            ? `Home Service${areaText ? ' \u2014 ' + escapeHtml(areaText) : ''}`
            : 'In-Studio';
        const addressLine = isHome && b.address
            ? `<p class="booking-history-address"><i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(String(b.address))}</p>`
            : '';
        const servicePrice = Number(b.service_price) || 0;
        const travelFee = isHome ? (Number(b.travel_fee) || 0) : 0;
        const total = Number(b.total_price) || (servicePrice + travelFee);
        const priceLine = `<p class="booking-history-price">${php(total)}${travelFee
            ? ` <span>(${php(servicePrice)} + ${php(travelFee)} travel)</span>` : ''}</p>`;
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
                    ${addressLine}
                    ${priceLine}
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
        showSiteNotice(friendlyErrorMessage(error, 'Could not cancel that appointment — please try again.'), 'error');
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
        showSiteNotice('This appointment can no longer be cancelled from here — please refresh the page.', 'error');
        return;
    }

    loadUpcomingBookings();
    refreshTimeSlots();
}

// ============================================================
// LOAD BARBERS FROM SUPABASE (FOR BOOKING PAGE)
// ============================================================

async function loadBarbersForBooking() {
    try {
        const { data, error } = await supabaseClient
            .from('barbers')
            .select('id, name, title, image_url, rating, service_gender')
            .eq('is_active', true)
            .order('name');

        if (error) {
            console.error('Error loading barbers:', error);
            return { data: [], failed: true };
        }

        return { data: data || [], failed: false };

    } catch (error) {
        console.error(error);
        return { data: [], failed: true };
    }
}

// ============================================================
// RENDER BARBER CARDS (Dynamic from Supabase)
// ============================================================

async function renderBarberCardsDynamic() {
    const grid = document.getElementById('bookingBarberGrid');
    if (!grid) return;

    // Show a shimmer placeholder immediately (matching the "Random"
    // card's proportions) instead of leaving the grid blank while the
    // fetch is in flight — the same problem the product grid and
    // account page solve with a shimmer skeleton.
    grid.innerHTML = Array.from({ length: 4 }).map(() => `
        <div class="booking-barber-card skeleton" aria-hidden="true">
            <span class="booking-barber-photo-skel booking-skeleton-shimmer"></span>
            <span class="booking-skel-line booking-skeleton-shimmer"></span>
            <span class="booking-skel-line booking-skel-line--short booking-skeleton-shimmer"></span>
        </div>
    `).join('');

    const { data: barbers, failed } = await loadBarbersForBooking();

    // Build the grid HTML
    let html = `
        <!-- Random option -->
        <button type="button" class="booking-barber-card booking-barber-card--random" data-barber-id="">
            <span class="booking-barber-none-icon"><i class="fas fa-shuffle" aria-hidden="true"></i></span>
            <span class="booking-barber-name">Random</span>
            <span class="booking-barber-role">We'll pick for you</span>
        </button>
    `;

    if (failed) {
        html += `
            <p class="booking-service-empty">
                Couldn't load the barber list — "Random" still works, or
                <button type="button" class="booking-inline-retry" id="bookingBarberRetry">try again</button>.
            </p>
        `;
    }

    // Add barbers from database
    barbers.forEach(barber => {
        const imageSrc = barber.image_url || '../images/team.jpg';
        const rating = barber.rating || 0;
        const title = barber.title || 'Barber';
        
        html += `
                <button type="button" class="booking-barber-card" data-barber-id="${escapeHtml(barber.id)}" data-service-gender="${escapeHtml(barber.service_gender || 'all')}">
                <img src="${escapeHtml(imageSrc)}" alt="" class="booking-barber-photo" loading="lazy" 
                     onerror="this.src='../images/team.jpg'" />
                <span class="booking-barber-name">${escapeHtml(barber.name)}</span>
                <span class="booking-barber-role">${escapeHtml(title)}</span>
                <span class="booking-barber-rating"><i class="fas fa-star" aria-hidden="true"></i> ${rating}</span>
            </button>
        `;
    });

    grid.innerHTML = html;

    const retryBtn = document.getElementById('bookingBarberRetry');
    if (retryBtn) retryBtn.addEventListener('click', renderBarberCardsDynamic);

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