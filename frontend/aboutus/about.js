// ============================================
// ABOUT PAGE — BARBER PROFILES + MODAL
// ============================================
const barbers = [
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

function renderBarberCards() {
    const grid = document.getElementById('barberGrid');
    if (!grid) return;

    grid.innerHTML = barbers.map(barber => `
        <article class="barber-card">
            <div class="barber-card-photo">
                <img src="${barber.photo}" alt="${barber.name}, ${barber.role}" loading="lazy"
                     onerror="this.src='https://placehold.co/400x500/232323/666?text=Photo'" />
            </div>
            <div class="barber-card-body">
                <h3 class="barber-card-name">${barber.name}</h3>
                <p class="barber-card-role">${barber.role}</p>
                <div class="barber-card-tags">
                    ${barber.specialties.map(s => `<span class="barber-tag">${s}</span>`).join('')}
                </div>
                <div class="barber-card-stats">
                    <span class="barber-card-experience"><strong>${barber.experience}</strong> yrs experience</span>
                    <span class="barber-card-rating">${starRatingHtml(barber.rating)} ${barber.rating}</span>
                </div>
                <div class="barber-card-actions">
                    <a href="../booking.html?barber=${barber.id}" class="btn-primary">Book with This Barber</a>
                    <button class="barber-view-more" type="button" data-barber-id="${barber.id}">View Full Profile</button>
                </div>
            </div>
        </article>
    `).join('');
}

function initBarberModal() {
    const modal = document.getElementById('barberModal');
    const backdrop = document.getElementById('barberModalBackdrop');
    const closeBtn = document.getElementById('barberModalClose');
    const returnBtn = document.getElementById('barberModalReturn');
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
        document.getElementById('barberModalBook').href = `../booking.html?barber=${barber.id}`;

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

    // "View Full Profile" buttons are rendered dynamically, so listen on the
    // grid container and match by data-barber-id rather than binding per-card.
    const grid = document.getElementById('barberGrid');
    if (grid) {
        grid.addEventListener('click', function(e) {
            const btn = e.target.closest('.barber-view-more');
            if (!btn) return;
            const barber = barbers.find(b => b.id === btn.dataset.barberId);
            if (barber) openModal(barber);
        });
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (returnBtn) returnBtn.addEventListener('click', closeModal);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    renderBarberCards();
    initBarberModal();
});