// ============================================
// STUDIO PAGE — MAP LOADING, FALLBACK, COPY, BARBER MODAL
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    initMapLoadState();
    initCopyAddress();
    initBarberModal();
    loadStudioBarbers();
    initOpenStatus();
});

// --------------------------------------------
// Open / closed status
// --------------------------------------------
// The studio card ships with static "Open 8 AM – 7 PM" copy so it never
// renders blank before JS runs (and still reads fine with JS disabled).
// Here it's upgraded to an actual open/closed read off the visitor's
// local clock, matching the daily 8:00–19:00 hours in this page's own
// JSON-LD block above.
function initOpenStatus() {
    const el = document.getElementById('studioOpenStatus');
    if (!el) return;

    const hour = new Date().getHours();
    const isOpen = hour >= 8 && hour < 19;

    el.classList.add(isOpen ? 'is-open' : 'is-closed');
    el.innerHTML = '<span class="studio-visit-status-dot" aria-hidden="true"></span>' +
        (isOpen ? 'Open now — closes 7 PM' : 'Closed now — opens 8 AM');
}

// --------------------------------------------
// Map skeleton + blocked-iframe fallback
// --------------------------------------------
// Ad blockers and privacy-focused browsers commonly block Google Maps
// iframes outright. There's no reliable cross-origin way to detect a
// blocked iframe directly, so this uses a timeout heuristic: if the
// iframe's 'load' event hasn't fired within a few seconds, assume it's
// blocked (or failing) and reveal a static fallback with a real link
// to Google Maps instead of leaving a blank box on the page.
function initMapLoadState() {
    const mapFrame = document.getElementById('studioMapFrame');
    const skeleton = document.getElementById('studioMapSkeleton');
    const fallback = document.getElementById('studioMapFallback');
    if (!mapFrame) return;

    let loaded = false;

    mapFrame.addEventListener('load', function () {
        loaded = true;
        if (skeleton) skeleton.classList.add('hidden');
    });

    setTimeout(function () {
        if (!loaded) {
            if (skeleton) skeleton.classList.add('hidden');
            if (fallback) fallback.classList.add('active');
        }
    }, 4000);
}

// --------------------------------------------
// Copy address to clipboard
// --------------------------------------------
function initCopyAddress() {
    const btn = document.getElementById('copyAddressBtn');
    const addressEl = document.getElementById('studioAddressText');
    if (!btn || !addressEl) return;

    const fullAddress = 'Phase 2 Block 11 Lot 16, Eastwind Homes, San Isidro, Rodriguez, 1860 Rizal';

    btn.addEventListener('click', function (e) {
        e.stopPropagation();

        const showCopied = function () {
            btn.classList.add('copied');
            btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
            btn.setAttribute('aria-label', 'Address copied');
            setTimeout(function () {
                btn.classList.remove('copied');
                btn.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i>';
                btn.setAttribute('aria-label', 'Copy address');
            }, 2000);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullAddress).then(showCopied).catch(function () {
                fallbackCopy(fullAddress, showCopied);
            });
        } else {
            fallbackCopy(fullAddress, showCopied);
        }
    });
}

// Fallback for browsers/contexts without the async Clipboard API
function fallbackCopy(text, onSuccess) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        onSuccess();
    } catch (e) {
        // Silently fail — clipboard access just isn't available here
    }
    document.body.removeChild(textarea);
}

// --------------------------------------------
// Barber full-profile modal + "Meet the Team" mini list
// --------------------------------------------
// Pulls from the same `barbers` Supabase table as about.js, so a
// barber's name/photo/rating here always matches the About page —
// previously this was a hardcoded 3-barber array that only ever
// reflected whatever the roster looked like the day it was written,
// so it silently drifted out of sync with real ratings and any
// barber added, edited, or removed from the admin panel.
let studioBarbers = [];

function starRatingHtml(rating) {
    const full = Math.floor(rating);
    const hasHalf = rating - full >= 0.5;
    let html = '';
    for (let i = 0; i < full; i++) html += '<i class="fas fa-star" aria-hidden="true"></i>';
    if (hasHalf) html += '<i class="fas fa-star-half-alt" aria-hidden="true"></i>';
    const empty = 5 - full - (hasHalf ? 1 : 0);
    for (let i = 0; i < empty; i++) html += '<i class="far fa-star" aria-hidden="true"></i>';
    return html;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Same relative/absolute image path handling as about.js, so a barber's
// photo resolves the same way no matter which page rendered it.
function resolveBarberImageSrc(barber, fallback) {
    let src = barber.image_url || '';
    if (src.includes('supabase.co')) {
        // Already a full Supabase Storage URL — use as-is.
    } else if (src && !src.startsWith('http')) {
        src = src.replace(/^\.\.?\//, '');
        src = '../' + src;
    } else if (!src) {
        src = fallback;
    }
    return src;
}

function showStudioBarberStatus(html) {
    const list = document.getElementById('studioBarberList');
    if (list) list.innerHTML = `<li class="studio-barber-status">${html}</li>`;
}

async function loadStudioBarbers() {
    const list = document.getElementById('studioBarberList');
    if (!list) return;

    if (typeof supabaseClient === 'undefined') {
        showStudioBarberStatus('Meet the team on our <a href="../aboutus/about.html#team">About page</a>.');
        return;
    }

    try {
        // Top-rated 3 active barbers — this card is a teaser for the full
        // team page, so it's meant to lead with the shop's strongest reviews.
        const { data, error } = await supabaseClient
            .from('barbers')
            .select('*')
            .eq('is_active', true)
            .order('rating', { ascending: false })
            .limit(3);

        if (error) {
            console.error('Error loading barbers:', error);
            showStudioBarberStatus('Couldn\u2019t load the team right now. <a href="../aboutus/about.html#team">See full team</a>');
            return;
        }

        studioBarbers = data || [];
        renderStudioBarberList();
    } catch (error) {
        console.error('Error loading barbers:', error);
        showStudioBarberStatus('Couldn\u2019t load the team right now. <a href="../aboutus/about.html#team">See full team</a>');
    }
}

function renderStudioBarberList() {
    const list = document.getElementById('studioBarberList');
    if (!list) return;

    if (!studioBarbers.length) {
        showStudioBarberStatus('Team info coming soon.');
        return;
    }

    list.innerHTML = studioBarbers.map(barber => {
        const avatarSrc = resolveBarberImageSrc(barber, 'https://placehold.co/40x40/232323/666?text=%20');
        return `
        <li>
            <button type="button" class="studio-barber-item" data-barber-id="${escapeHtml(barber.id)}">
                <img src="${avatarSrc}" alt="" class="studio-barber-avatar" loading="lazy" onerror="this.src='https://placehold.co/40x40/232323/666?text=%20'" />
                <span class="studio-barber-name">${escapeHtml(barber.name)}</span>
                <span class="studio-barber-rating">${starRatingHtml(barber.rating || 0)} ${barber.rating || 0}</span>
            </button>
        </li>`;
    }).join('');
}

function initBarberModal() {
    const modal = document.getElementById('barberModal');
    const backdrop = document.getElementById('barberModalBackdrop');
    const closeBtn = document.getElementById('barberModalClose');
    const returnBtn = document.getElementById('barberModalReturn');
    const bookLink = document.getElementById('barberModalBook');
    if (!modal) return;

    let lastFocused = null;

    function openModal(barber) {
        const photoSrc = resolveBarberImageSrc(barber, 'https://placehold.co/400x500/232323/666?text=Photo');
        const photoEl = document.getElementById('barberModalPhoto');
        photoEl.src = photoSrc;
        photoEl.alt = barber.name;
        photoEl.onerror = function () {
            this.onerror = null;
            this.src = 'https://placehold.co/400x500/232323/666?text=Photo';
        };
        document.getElementById('barberModalName').textContent = barber.name;
        document.getElementById('barberModalRole').textContent = barber.title || 'Barber';
        document.getElementById('barberModalRating').innerHTML =
            `${starRatingHtml(barber.rating || 0)} ${barber.rating || 0} (${barber.reviews || 0} reviews)`;
        document.getElementById('barberModalBio').textContent = barber.bio || 'No bio available.';

        const specialtiesEl = document.getElementById('barberModalSpecialties');
        specialtiesEl.innerHTML = barber.specialties
            ? barber.specialties.split(',').map(s => `<span class="barber-tag">${escapeHtml(s.trim())}</span>`).join('')
            : '<span class="barber-tag">All services</span>';

        document.getElementById('barberModalExperience').textContent = barber.experience || 0;
        document.getElementById('barberModalReviews').textContent = barber.reviews || 0;
        if (bookLink) bookLink.href = `../booking/booking.html?barber=${barber.id}`;

        lastFocused = document.activeElement;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        closeBtn.focus();
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = '';
        if (lastFocused) lastFocused.focus();
    }

    // Barber rows live inside the "View Barber List" card — listen on the
    // list container and match by data-barber-id. Event delegation means
    // this keeps working even though renderStudioBarberList() replaces
    // the <li> items after this listener is attached.
    const list = document.getElementById('studioBarberList');
    if (list) {
        list.addEventListener('click', function (e) {
            const btn = e.target.closest('.studio-barber-item');
            if (!btn) return;
            const barber = studioBarbers.find(b => b.id === btn.dataset.barberId);
            if (barber) openModal(barber);
        });
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (returnBtn) returnBtn.addEventListener('click', closeModal);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
}