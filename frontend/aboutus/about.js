// ============================================
// ABOUT PAGE — BARBER PROFILES + MODAL
// Data comes from Supabase — NO HARDCODED BARBERS!
// ============================================

let barbers = [];

// ============================================
// LOAD BARBERS FROM SUPABASE
// ============================================
async function loadBarbers() {
    console.log('🔄 Loading barbers from Supabase...');
    showBarberSkeleton();

    try {
        const { data, error } = await supabaseClient
            .from('barbers')
            .select('*')
            .eq('is_active', true)
            .order('name');

        console.log('📊 Supabase response:', { data, error });

        if (error) {
            console.error('❌ Error loading barbers:', error);
            showBarberError('Could not load barbers. Please refresh the page.');
            return;
        }

        barbers = data || [];
        console.log('✅ Loaded barbers:', barbers.length, barbers);
        
        renderBarberCards();
        initBarberModal();
        
    } catch (error) {
        console.error('❌ Error:', error);
        showBarberError('Something went wrong. Please try again.');
    }
}

// ============================================
// LOADING SKELETON
// Shown immediately on page load so the grid never sits blank
// while waiting on the Supabase response.
// ============================================
function showBarberSkeleton(count = 4) {
    const grid = document.getElementById('barberGrid');
    if (!grid) return;
    grid.innerHTML = Array.from({ length: count }).map(() => `
        <div class="barber-card-skel" aria-hidden="true">
            <div class="skel-photo"></div>
            <div class="skel-line" style="width:60%;height:16px;"></div>
            <div class="skel-line" style="width:40%;"></div>
            <div class="skel-line" style="width:80%;"></div>
        </div>
    `).join('');
}

function showBarberError(message) {
    const grid = document.getElementById('barberGrid');
    if (grid) {
        grid.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--dim);">
                <i class="fas fa-exclamation-circle" style="font-size:2rem; margin-bottom:16px; display:block;"></i>
                <p>${message}</p>
            </div>
        `;
    }
}

// ============================================
// STAR RATING HELPER
// ============================================
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

// ============================================
// ESCAPE HTML
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// RENDER BARBER CARDS
// ============================================
function renderBarberCards() {
    const grid = document.getElementById('barberGrid');
    if (!grid) return;

    if (!barbers.length) {
        grid.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--dim);">
                <i class="fas fa-users" style="font-size:2rem; margin-bottom:16px; display:block;"></i>
                <p>No barbers available yet. Check back soon!</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = barbers.map(barber => {
        let imageSrc = barber.image_url || '';
        
        // If it's a Supabase URL, use it directly
        if (imageSrc.includes('supabase.co')) {
            // Use as is
        } 
        // If it's a relative path, fix it
        else if (imageSrc && !imageSrc.startsWith('http')) {
            // Remove any leading ../ or ./
            imageSrc = imageSrc.replace(/^\.\.?\//, '');
            imageSrc = '../' + imageSrc;
        }
        // Fallback
        else {
            imageSrc = '../images/team.jpg';
        }
        
        return `
        <article class="barber-card">
            <div class="barber-card-photo">
                <img src="${imageSrc}" 
                     alt="${barber.name}, ${barber.title || 'Barber'}" 
                     loading="lazy"
                     onerror="this.src='../images/team.jpg'" />
            </div>
            <div class="barber-card-body">
                <h3 class="barber-card-name">${escapeHtml(barber.name)}</h3>
                <p class="barber-card-role">${escapeHtml(barber.title || 'Barber')}</p>
                <div class="barber-card-tags">
                    ${barber.specialties ? barber.specialties.split(',').map(s => `<span class="barber-tag">${escapeHtml(s.trim())}</span>`).join('') : ''}
                </div>
                <div class="barber-card-stats">
                    <span class="barber-card-experience"><strong>${barber.experience || 0}</strong> yrs experience</span>
                    <span class="barber-card-rating">${starRatingHtml(barber.rating || 0)} ${barber.rating || 0}</span>
                </div>
                <div class="barber-card-actions">
                    <a href="../booking/booking.html?barber=${barber.id}" class="btn-primary">Book with This Barber</a>
                    <button class="barber-view-more" type="button" data-barber-id="${barber.id}">View Full Profile</button>
                </div>
            </div>
        </article>
    `}).join('');

    attachModalListeners();
}

// ============================================
// BARBER MODAL
// ============================================
function initBarberModal() {
    const modal = document.getElementById('barberModal');
    const backdrop = document.getElementById('barberModalBackdrop');
    const closeBtn = document.getElementById('barberModalClose');
    const returnBtn = document.getElementById('barberModalReturn');
    if (!modal) return;

    let lastFocused = null;

 function openModal(barber) {
    // Use image_url from database
    let imageSrc = barber.image_url || '';
    if (!imageSrc) {
        imageSrc = 'https://placehold.co/400x500/232323/666?text=Photo';
    }
    
    document.getElementById('barberModalPhoto').src = imageSrc;
    document.getElementById('barberModalPhoto').alt = barber.name;
    document.getElementById('barberModalPhoto').onerror = function() {
        this.src = 'https://placehold.co/400x500/232323/666?text=Photo';
    };
    
    document.getElementById('barberModalName').textContent = barber.name;
    document.getElementById('barberModalRole').textContent = barber.title || 'Barber';
    document.getElementById('barberModalRating').innerHTML =
        `${starRatingHtml(barber.rating || 0)} ${barber.rating || 0} (${barber.reviews || 0} reviews)`;
    document.getElementById('barberModalBio').textContent = barber.bio || 'No bio available.';
    
    const specialtiesEl = document.getElementById('barberModalSpecialties');
    if (barber.specialties) {
        specialtiesEl.innerHTML = barber.specialties.split(',').map(s => 
            `<span class="barber-tag">${escapeHtml(s.trim())}</span>`
        ).join('');
    } else {
        specialtiesEl.innerHTML = '<span class="barber-tag">All services</span>';
    }
    
    document.getElementById('barberModalExperience').textContent = barber.experience || 0;
    document.getElementById('barberModalReviews').textContent = barber.reviews || 0;
    document.getElementById('barberModalBook').href = `../booking/booking.html?barber=${barber.id}`;

    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (closeBtn) closeBtn.focus();
}

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = '';
        if (lastFocused) lastFocused.focus();
    }

    window._openBarberModal = openModal;

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (returnBtn) returnBtn.addEventListener('click', closeModal);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
}

// ============================================
// ATTACH MODAL LISTENERS
// ============================================
function attachModalListeners() {
    const grid = document.getElementById('barberGrid');
    if (!grid) return;

    grid.addEventListener('click', function(e) {
        const btn = e.target.closest('.barber-view-more');
        if (!btn) return;
        const barberId = btn.dataset.barberId;
        const barber = barbers.find(b => b.id === barberId);
        if (barber && window._openBarberModal) {
            window._openBarberModal(barber);
        }
    });
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📄 About page loaded!');
    
    if (typeof supabaseClient === 'undefined') {
        console.error('❌ supabaseClient is not defined!');
        showBarberError('Unable to connect to the server. Please try again later.');
        return;
    }
    
    loadBarbers();
});