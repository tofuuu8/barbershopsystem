// ============================================
// SERVICES PAGE
// ============================================

// Fallback fee shown before any area check has run (matches the previous
// flat rate). Once an area is matched, its own `fee` below is used instead.
const HOME_TRAVEL_FEE = 150;

// Areas the shop currently covers for home service (matches the Rodriguez, Rizal studio).
// `fee` is a rough distance-based travel charge from the studio, `lat`/`lng` are approximate
// coordinates used by "Use my current location" — adjust here if the actual coverage area,
// pricing, or geolocation matching changes; this is the single source of truth for all three.
// NOTE: 'rizal' (the whole province) was intentionally left out — it's too broad and would
// match towns nowhere near the shop. 'san isidro' is kept for the studio's own barangay, but
// since "San Isidro" is a very common barangay name nationwide, this is still a best-effort
// match, not real geocoding — false positives are possible for other San Isidros.
const HOME_SERVICE_AREAS = [
    { name: 'san isidro', fee: 80, lat: 14.7306, lng: 121.1214 },
    // "Montalban" is the old name for Rodriguez — same town, same coverage/fee,
    // so it's shown as one entry rather than two identical-looking options.
    { name: 'rodriguez', label: 'Rodriguez (Montalban)', fee: 100, lat: 14.7305, lng: 121.1215 },
    { name: 'san mateo', fee: 150, lat: 14.6961, lng: 121.1197 },
    { name: 'marikina', fee: 180, lat: 14.6507, lng: 121.1029 },
    { name: 'antipolo', fee: 200, lat: 14.5878, lng: 121.1760 },
    { name: 'cainta', fee: 200, lat: 14.5786, lng: 121.1222 },
    { name: 'taytay', fee: 220, lat: 14.5561, lng: 121.1327 },
    { name: 'quezon city', fee: 250, lat: 14.6760, lng: 121.0437 }
];

// The area <select> only ever offers these exact area names as values (no free
// text), so matching is a direct lookup — no fuzzy/word-boundary logic needed.
function findCoveredArea(name) {
    return HOME_SERVICE_AREAS.find(area => area.name === name) || null;
}

// ------------------------------------------------------------------
// "Use my current location" — approximate area coordinates (above) +
// straight-line distance matching. Not real geocoding (no API key/backend
// here), but enough to save someone from picking manually when they allow
// location access.
// ------------------------------------------------------------------

// Beyond this radius, don't guess — the person should pick their area manually instead.
const MAX_LOCATION_MATCH_KM = 12;

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Finds the covered area nearest a lat/lng, or null if even the closest one
// is farther than MAX_LOCATION_MATCH_KM away (i.e. clearly not covered).
function nearestCoveredArea(lat, lng) {
    let best = null;
    let bestKm = Infinity;
    HOME_SERVICE_AREAS.forEach(area => {
        const km = haversineKm(lat, lng, area.lat, area.lng);
        if (km < bestKm) {
            bestKm = km;
            best = area;
        }
    });
    return bestKm <= MAX_LOCATION_MATCH_KM ? best : null;
}

function capitalizeArea(name) {
    return name.replace(/\b\w/g, c => c.toUpperCase());
}

// Areas can set a `label` to override the default capitalized name (e.g.
// folding an old town name into one combined entry) — falls back to the
// plain capitalized name when no override is set.
function areaDisplayName(area) {
    return area.label || capitalizeArea(area.name);
}

// ------------------------------------------------------------------
// Same-session persistence for the availability check — so refreshing the
// page or navigating away and back doesn't force a recheck. Intentionally
// sessionStorage (not localStorage): coverage/fee is tied to a visit, not
// something that should silently carry over days later if areas change.
// ------------------------------------------------------------------
const HOME_SERVICE_STORAGE_KEY = 'toughcuts_home_service_check';

function saveHomeServiceCheck(state) {
    try {
        sessionStorage.setItem(HOME_SERVICE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // sessionStorage unavailable (private browsing, etc.) — just skip persistence
    }
}

function loadHomeServiceCheck() {
    try {
        const raw = sessionStorage.getItem(HOME_SERVICE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

const services = [
    // ---------------- MEN'S ----------------
    {
        id: 'classic-haircut',
        gender: 'men',
        name: 'Classic Haircut',
        icon: 'fa-scissors',
        price: 280,
        duration: '30 min',
        blurb: 'A timeless, all-purpose cut — clean and sharp.',
        description: 'Our go-to cut for a clean, professional look. Scissor-and-clipper work tailored to your head shape, finished with a wash and style.',
        rating: 4.8,
        reviews: [
            'Consistent every single time — my barber never has to ask what I want anymore.',
            'Quick, sharp, and exactly what I asked for.'
        ]
    },
    {
        id: 'fade',
        gender: 'men',
        name: 'Fade',
        icon: 'fa-wind',
        price: 350,
        duration: '40 min',
        blurb: 'Skin, low, mid, or high — blended to perfection.',
        description: 'A precise blend from skin to length, done freehand for a seamless gradient. Choose your fade style and we\'ll dial it in.',
        rating: 4.9,
        reviews: [
            'Cleanest fade I\'ve had in the city, no blotchy lines at all.',
            'Asked for a mid skin fade and it came out exactly like the reference photo.'
        ]
    },
    {
        id: 'taper',
        gender: 'men',
        name: 'Taper',
        icon: 'fa-layer-group',
        price: 320,
        duration: '35 min',
        blurb: 'Subtle blend down the sides and back.',
        description: 'A softer alternative to the fade — gradual tapering along the sides and neckline while keeping more length on top.',
        rating: 4.7,
        reviews: [
            'Perfect for office life, sharp but not too aggressive.',
            'Grows out nicely between appointments.'
        ]
    },
    {
        id: 'pompadour',
        gender: 'men',
        name: 'Pompadour',
        icon: 'fa-crown',
        price: 380,
        duration: '40 min',
        blurb: 'Volume up top, tight on the sides.',
        description: 'Classic pompadour shaping with tapered sides, styled with product for hold and shine. Great for a bit of statement height.',
        rating: 4.8,
        reviews: [
            'Held up all day at work, no touch-ups needed.',
            'Barber gave great tips on styling it myself at home.'
        ]
    },
    {
        id: 'buzz-cut',
        gender: 'men',
        name: 'Buzz Cut',
        icon: 'fa-circle-dot',
        price: 220,
        duration: '20 min',
        blurb: 'Low maintenance, all one length.',
        description: 'Fast, even, all-over clipper cut. Pick your guard length and you\'re in and out in twenty minutes.',
        rating: 4.9,
        reviews: [
            'In and out in under 20 minutes, exactly as advertised.',
            'Even length all around, no patchy spots.'
        ]
    },
    {
        id: 'beard-trim',
        gender: 'men',
        name: 'Beard Trim',
        icon: 'fa-hand-sparkles',
        price: 180,
        duration: '20 min',
        blurb: 'Shape, line-up, and clean edges.',
        description: 'Beard shaping and line-up with hot towel finish. Keeps your beard sharp between full grooming sessions.',
        rating: 4.7,
        reviews: [
            'Lines are always razor sharp after this.',
            'Great add-on if you\'re already getting a haircut.'
        ]
    },
    {
        id: 'royal-shave',
        gender: 'men',
        name: 'Royal Shave',
        icon: 'fa-gem',
        price: 420,
        duration: '45 min',
        blurb: 'The full hot towel straight razor treatment.',
        description: 'A traditional straight-razor shave with hot towel prep, pre-shave oil, and a soothing aftershave finish. Pure relaxation.',
        rating: 5.0,
        reviews: [
            'Closest shave I\'ve ever had, skin felt amazing after.',
            'Worth every peso, book this if you\'ve never tried it.'
        ]
    },

    // ---------------- WOMEN'S ----------------
    {
        id: 'haircut-style',
        gender: 'women',
        name: 'Haircut & Style',
        icon: 'fa-scissors',
        price: 450,
        duration: '45 min',
        blurb: 'Cut, shape, and blow-dry finish.',
        description: 'A full consultation, cut tailored to your face shape and hair type, finished with a blow-dry style.',
        rating: 4.8,
        reviews: [
            'They actually listened to what I wanted instead of pushing their own idea.',
            'Left feeling like a completely new person.'
        ]
    },
    {
        id: 'hair-coloring',
        gender: 'women',
        name: 'Hair Coloring',
        icon: 'fa-palette',
        price: 1200,
        duration: '90 min',
        blurb: 'Full, single-process color.',
        description: 'All-over color application using professional-grade dye, matched to your desired shade with a patch test beforehand.',
        rating: 4.7,
        reviews: [
            'Color came out exactly like the swatch I picked.',
            'Faded evenly, no brassiness after a month.'
        ]
    },
    {
        id: 'highlights',
        gender: 'women',
        name: 'Highlights',
        icon: 'fa-sun',
        price: 1500,
        duration: '120 min',
        blurb: 'Foiled highlights for dimension.',
        description: 'Hand-placed foil highlights to add depth and dimension, customizable from subtle to bold.',
        rating: 4.8,
        reviews: [
            'Super natural looking, not stripy at all.',
            'Stylist explained maintenance really clearly afterward.'
        ]
    },
    {
        id: 'balayage',
        gender: 'women',
        name: 'Balayage',
        icon: 'fa-paintbrush',
        price: 1800,
        duration: '150 min',
        blurb: 'Hand-painted, sun-kissed color.',
        description: 'Freehand painted color for a soft, graduated look that grows out beautifully with minimal upkeep.',
        rating: 4.9,
        reviews: [
            'Took a while but the grow-out is so low maintenance, worth it.',
            'Got so many compliments the week after.'
        ]
    },
    {
        id: 'hair-treatment',
        gender: 'women',
        name: 'Hair Treatment',
        icon: 'fa-spa',
        price: 900,
        duration: '60 min',
        blurb: 'Deep conditioning and repair.',
        description: 'Intensive deep-conditioning treatment to restore moisture and repair damage from coloring or heat styling.',
        rating: 4.8,
        reviews: [
            'My hair felt so much softer immediately after.',
            'Great for repairing damage from bleaching.'
        ]
    },
    {
        id: 'styling',
        gender: 'women',
        name: 'Styling',
        icon: 'fa-wind',
        price: 500,
        duration: '40 min',
        blurb: 'Event-ready curls, waves, or updos.',
        description: 'Occasion styling — curls, waves, or an updo — using heat tools and long-lasting hold product.',
        rating: 4.7,
        reviews: [
            'Style held up through an entire wedding reception.',
            'Exactly the soft waves look I showed in my reference photo.'
        ]
    },
    {
        id: 'blowout',
        gender: 'women',
        name: 'Blowout',
        icon: 'fa-fan',
        price: 400,
        duration: '30 min',
        blurb: 'Smooth, voluminous salon blow-dry.',
        description: 'A professional round-brush blow-dry for smooth, voluminous, salon-fresh hair without any cut or color.',
        rating: 4.8,
        reviews: [
            'Hair felt so bouncy and smooth, lasted three days.',
            'Perfect quick refresh before a night out.'
        ]
    }
];

// ============================================
// IN-STUDIO: HAIRCUT REFERENCE GALLERY
// ============================================
// In-studio Men's/Women's shows a simple photo-reference gallery instead of
// the full per-service grid — just look, one general starting price, one
// Book Now button. (Home service keeps the full detailed grid below.)
const HAIRCUT_REFERENCES = {
    // Real photos, reused from the homepage hairstyle gallery (index.html).
    // Path is relative to /services/services.html, so it climbs up to /images/.
    men: [
        { label: 'Taper', img: '../images/tapercut.jpg' },
        { label: 'Pompadour', img: '../images/pompadourcut.jpg' },
        { label: 'Modern Mullet', img: '../images/modernmulletcut.jpg' },
        { label: 'Fade', img: '../images/fadecut.jpg' },
        { label: 'Crew Cut', img: '../images/crewcut.jpg' },
        { label: 'Buzz Cut', img: '../images/buzzcut.jpg' }
    ],
    // No women's reference photos exist on the site yet — placeholders until
    // real ones are available. Swap these `img` paths in when you have them.
    women: [
        { label: 'Long Layers', img: 'https://placehold.co/400x500/1a1a1a/999?text=Long+Layers' },
        { label: 'Lob', img: 'https://placehold.co/400x500/1a1a1a/999?text=Lob' },
        { label: 'Blunt Bob', img: 'https://placehold.co/400x500/1a1a1a/999?text=Blunt+Bob' },
        { label: 'Curtain Bangs', img: 'https://placehold.co/400x500/1a1a1a/999?text=Curtain+Bangs' },
        { label: 'Textured Pixie', img: 'https://placehold.co/400x500/1a1a1a/999?text=Textured+Pixie' },
        { label: 'Beach Waves', img: 'https://placehold.co/400x500/1a1a1a/999?text=Beach+Waves' }
    ]
};

// Which entries in `services` count toward the "general" haircut price shown
// in the gallery (excludes add-ons/treatments like beard trim, royal shave,
// coloring, etc. that aren't a plain haircut).
const HAIRCUT_SERVICE_IDS = {
    men: ['classic-haircut', 'fade', 'taper', 'pompadour', 'buzz-cut'],
    women: ['haircut-style']
};

function generalHaircutPrice(gender) {
    const ids = HAIRCUT_SERVICE_IDS[gender] || [];
    const prices = services.filter(s => ids.includes(s.id)).map(s => s.price);
    return prices.length ? Math.min(...prices) : null;
}

function renderHaircutGallery(gender) {
    const grid = document.getElementById('haircutGalleryGrid');
    const priceEl = document.getElementById('haircutGalleryPrice');
    const priceLabelEl = document.querySelector('.haircut-gallery-stat-label');
    const bookBtn = document.getElementById('haircutGalleryBook');
    if (!grid) return;

    const refs = HAIRCUT_REFERENCES[gender] || [];
    grid.innerHTML = refs.map(ref => `
        <div class="haircut-gallery-item">
            <img src="${ref.img}" alt="${ref.label} haircut reference"
                 loading="lazy" onerror="this.src='https://placehold.co/400x500/232323/666?text=Photo'" />
            <div class="haircut-gallery-overlay">
                <span class="haircut-gallery-name">${ref.label}</span>
            </div>
        </div>
    `).join('');

    const basePrice = generalHaircutPrice(gender);
    const total = basePrice !== null
        ? basePrice + (currentType === 'home' ? currentTravelFee : 0)
        : null;

    if (priceEl) {
        priceEl.textContent = total !== null ? `₱${total.toLocaleString()}` : '—';
    }
    if (priceLabelEl) {
        priceLabelEl.textContent = currentType === 'home'
            ? `Starting At (incl. ₱${currentTravelFee} travel fee)`
            : 'Starting At';
    }
    if (bookBtn) {
        bookBtn.href = `../booking.html?type=${currentType}&gender=${gender}`;
    }
}

// ============================================
// STATE
// ============================================
let currentType = 'studio';   // 'studio' | 'home'
let currentGender = 'men';    // 'men' | 'women'
let homeServiceUnlocked = false;
let currentTravelFee = HOME_TRAVEL_FEE;   // set to the matched area's own fee once checked

// ============================================
// RENDER: SERVICE CARDS
// ============================================
function renderServiceCards() {
    const empty = document.getElementById('servicesEmpty');
    const gallery = document.getElementById('haircutGallery');
    if (!gallery) return;

    // Home service is gated behind a successful availability check —
    // nothing renders until that passes.
    if (currentType === 'home' && !homeServiceUnlocked) {
        gallery.hidden = true;
        if (empty) empty.hidden = false;
        return;
    }

    // Both In-Studio and unlocked Home Service show the same haircut-only
    // reference gallery — there's only one service on offer at home (a
    // haircut), so a per-service grid would just be one lonely card. Price
    // picks up the matched area's travel fee for Home Service; the Book Now
    // link carries type=home through to booking.
    gallery.hidden = false;
    if (empty) empty.hidden = true;
    renderHaircutGallery(currentGender);
}

// ============================================
// URL STATE SYNC (deep-linking to type/gender)
// ============================================
// Lets people share/bookmark a link straight to e.g. "?type=home&gender=women".
// Uses replaceState (not pushState) so switching tabs doesn't spam browser history.
function syncUrlState() {
    const params = new URLSearchParams(window.location.search);
    params.set('type', currentType);
    params.set('gender', currentGender);
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
}

function readInitialStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const gender = params.get('gender');
    if (type === 'home' || type === 'studio') currentType = type;
    if (gender === 'men' || gender === 'women') currentGender = gender;
}

// ============================================
// SERVICE TYPE TOGGLE (In-Studio / Home Service)
// ============================================
function applyTypeToUI(type) {
    document.querySelectorAll('.service-type-btn').forEach(b => {
        const isActive = b.dataset.type === type;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
    });

    const homeAvailability = document.getElementById('homeAvailability');
    const genderTabsGroup = document.getElementById('genderTabsGroup');
    if (type === 'home') {
        homeAvailability.hidden = false;
        // Home service stays gated behind the availability check even when
        // linked to directly via URL — deep-linking can't skip that step.
        genderTabsGroup.hidden = !homeServiceUnlocked;
    } else {
        homeAvailability.hidden = true;
        genderTabsGroup.hidden = false;
    }
}

function applyGenderToUI(gender) {
    document.querySelectorAll('.gender-tab').forEach(t => {
        const isActive = t.dataset.gender === gender;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', String(isActive));
    });
}

function initServiceTypeToggle() {
    const buttons = document.querySelectorAll('.service-type-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', function () {
            currentType = this.dataset.type;
            applyTypeToUI(currentType);
            syncUrlState();
            renderServiceCards();
        });
    });
}

// ============================================
// HOME SERVICE AVAILABILITY CHECK
// ============================================
// Fills the area <select> with the covered areas.
function populateAreaSelect() {
    const select = document.getElementById('areaSelect');
    if (!select) return;
    HOME_SERVICE_AREAS.forEach(area => {
        const option = document.createElement('option');
        option.value = area.name;
        option.textContent = areaDisplayName(area);
        select.appendChild(option);
    });
}

// Renders the always-visible list of covered areas as chips, so people can
// see coverage at a glance instead of guessing what to type/select.
function renderCoverageChips() {
    const wrap = document.getElementById('coverageChips');
    if (!wrap) return;
    wrap.innerHTML = HOME_SERVICE_AREAS
        .map(area => `<span class="coverage-chip">${areaDisplayName(area)}</span>`)
        .join('');
}

function initAvailabilityCheck() {
    const select = document.getElementById('areaSelect');
    const yesPanel = document.getElementById('availabilityYes');
    const noPanel = document.getElementById('availabilityNo');
    const feeText = document.getElementById('availabilityFeeText');
    const genderTabsGroup = document.getElementById('genderTabsGroup');
    if (!select) return;

    populateAreaSelect();
    renderCoverageChips();

    function showUnlocked(area) {
        homeServiceUnlocked = true;
        currentTravelFee = area.fee;
        yesPanel.hidden = false;
        noPanel.hidden = true;
        if (feeText) feeText.textContent = `₱${area.fee} travel fee`;
        genderTabsGroup.hidden = false;
        saveHomeServiceCheck({ unlocked: true, areaName: area.name, fee: area.fee });
        renderServiceCards();
    }

    function showLocked() {
        homeServiceUnlocked = false;
        select.value = '';
        yesPanel.hidden = true;
        noPanel.hidden = false;
        genderTabsGroup.hidden = true;
        saveHomeServiceCheck({ unlocked: false });
        renderServiceCards();
    }

    // Selecting an area unlocks instantly — no separate "check" step needed
    // since every option in the dropdown is already a covered area.
    select.addEventListener('change', function () {
        if (!select.value) {
            homeServiceUnlocked = false;
            yesPanel.hidden = true;
            noPanel.hidden = true;
            genderTabsGroup.hidden = true;
            renderServiceCards();
            return;
        }
        const area = findCoveredArea(select.value);
        if (area) showUnlocked(area);
    });

    // "Use my current location" — matches to the nearest covered area by
    // distance (see nearestCoveredArea) and selects it automatically.
    const locateBtn = document.getElementById('useLocationBtn');
    const locateStatus = document.getElementById('locationStatus');

    if (locateBtn) {
        if (!('geolocation' in navigator)) {
            // No geolocation support (or blocked in this context) — the
            // dropdown still works fine, just skip offering the shortcut.
            locateBtn.hidden = true;
        } else {
            locateBtn.addEventListener('click', function () {
                locateBtn.disabled = true;
                if (locateStatus) {
                    locateStatus.hidden = false;
                    locateStatus.textContent = 'Finding your location…';
                }

                navigator.geolocation.getCurrentPosition(
                    function (position) {
                        locateBtn.disabled = false;
                        const area = nearestCoveredArea(position.coords.latitude, position.coords.longitude);

                        if (area) {
                            if (locateStatus) locateStatus.hidden = true;
                            select.value = area.name;
                            showUnlocked(area);
                        } else {
                            if (locateStatus) locateStatus.hidden = true;
                            showLocked();
                        }
                    },
                    function () {
                        locateBtn.disabled = false;
                        if (locateStatus) {
                            locateStatus.hidden = false;
                            locateStatus.textContent = 'Couldn\u2019t get your location — check browser permissions, or just pick your area above.';
                        }
                    },
                    { timeout: 8000 }
                );
            });
        }
    }

    // Restore a same-session check so a refresh (or navigating away and back)
    // doesn't force people to re-select their area. applyTypeToUI(), called
    // later during init, handles showing/hiding based on homeServiceUnlocked.
    const saved = loadHomeServiceCheck();
    if (saved && saved.unlocked) {
        homeServiceUnlocked = true;
        currentTravelFee = saved.fee || HOME_TRAVEL_FEE;
        if (saved.areaName) select.value = saved.areaName;
        yesPanel.hidden = false;
        if (feeText) feeText.textContent = `₱${currentTravelFee} travel fee`;
    }
}

// ============================================
// GENDER TABS
// ============================================
function initGenderTabs() {
    const tabs = document.querySelectorAll('.gender-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            currentGender = this.dataset.gender;
            applyGenderToUI(currentGender);
            syncUrlState();
            renderServiceCards();
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    readInitialStateFromUrl();

    initServiceTypeToggle();
    initAvailabilityCheck();
    initGenderTabs();

    // Reflect whatever state we ended up with (URL-provided or defaults) in the UI.
    applyTypeToUI(currentType);
    applyGenderToUI(currentGender);
    syncUrlState();

    renderServiceCards();

    // Deep-linking straight into Home Service (e.g. a shared "?type=home"
    // link) should draw attention to the availability check instead of
    // leaving people looking at an empty grid with no obvious next step.
    if (currentType === 'home' && !homeServiceUnlocked) {
        const areaSelect = document.getElementById('areaSelect');
        if (areaSelect) areaSelect.focus();
    }
});