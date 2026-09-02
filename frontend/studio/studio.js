// ============================================
// STUDIO PAGE — MAP LOADING, FALLBACK, COPY, BARBER MODAL
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    initMapLoadState();
    initCopyAddress();
    initBarberModal();
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
// Barber full-profile modal
// --------------------------------------------
// Same roster/data as about.js so a barber's profile reads identically
// whichever page it was opened from. Ids match the data-barber-id
// values on the .studio-barber-item buttons in studio.html.
const studioBarbers = [
    {
        id: 'barber-russel',
        name: 'Barber Russel',
        role: 'Barber and Stylist',
        photo: '../images/team.jpg',
        specialties: ['Fades', 'Beard Sculpting', 'Classic Cuts'],
        experience: 8,
        rating: 4.9,
        reviews: 127,
        bio: 'Barber Russel has been behind the chair for eight years and specializes in sharp, clean fades and traditional barbering. If you want precision over trend-chasing, he\'s your guy.'
    },
    {
        id: 'klark-dizon',
        name: 'Barber Klark',
        role: 'Owner and Master Barber',
        photo: '../images/team1.jpg',
        specialties: ['Modern Styles', 'Textured Crops', 'Color'],
        experience: 6,
        rating: 4.8,
        reviews: 98,
        bio: 'Barber Klark stays on top of every trend without losing the fundamentals. His textured crops and color work have built him a loyal client base of regulars.'
    },
    {
        id: 'barber-jon',
        name: 'Barber Jon',
        role: 'Barber and Stylist',
        photo: '../images/team1.jpg',
        specialties: ['Precision Fades', 'Hair Color', 'Kids Cuts'],
        experience: 5,
        rating: 4.9,
        reviews: 110,
        bio: 'Barber Jon trained in both barbering and color, giving him range most barbers don\'t have. Patient with first-time kids\' cuts, precise with everything else.'
    }
];

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

// Fills in each barber row's inline star rating on load.
function renderBarberListRatings() {
    const items = document.querySelectorAll('.studio-barber-item');
    items.forEach(function (item) {
        const barber = studioBarbers.find(b => b.id === item.dataset.barberId);
        const ratingEl = item.querySelector('[data-rating]');
        if (barber && ratingEl) {
            ratingEl.innerHTML = starRatingHtml(barber.rating) + ' ' + barber.rating;
        }
    });
}

function initBarberModal() {
    renderBarberListRatings();

    const modal = document.getElementById('barberModal');
    const backdrop = document.getElementById('barberModalBackdrop');
    const closeBtn = document.getElementById('barberModalClose');
    const returnBtn = document.getElementById('barberModalReturn');
    const bookLink = document.getElementById('barberModalBook');
    if (!modal) return;

    let lastFocused = null;

    function openModal(barber) {
        document.getElementById('barberModalPhoto').src = barber.photo;
        document.getElementById('barberModalPhoto').alt = barber.name;
        document.getElementById('barberModalName').textContent = barber.name;
        document.getElementById('barberModalRole').textContent = barber.role;
        document.getElementById('barberModalRating').innerHTML =
            `${starRatingHtml(barber.rating)} ${barber.rating} (${barber.reviews} reviews)`;
        document.getElementById('barberModalBio').textContent = barber.bio;
        document.getElementById('barberModalSpecialties').innerHTML =
            barber.specialties.map(s => `<span class="barber-tag">${s}</span>`).join('');
        document.getElementById('barberModalExperience').textContent = barber.experience;
        document.getElementById('barberModalReviews').textContent = barber.reviews;
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
    // list container and match by data-barber-id.
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