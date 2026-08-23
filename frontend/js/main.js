// ============================================
// TOUGHCUTS - Main JavaScript
// ============================================

// Single entry point — every init function is called exactly once here.
// Do not add a second DOMContentLoaded listener anywhere else in this file;
// calling an init function twice double-attaches its click handlers, which
// makes toggles (chat, nav, etc.) appear to do nothing on click.
//
// This listener is async and awaits authReadyPromise (defined below, near
// isLoggedIn()) before wiring anything that reads login state — otherwise
// initAddToCart()/initBuyNow() could run before Supabase has finished
// restoring the session from storage and treat a signed-in visitor as
// signed out. Other pages with their own DOMContentLoaded listener that
// check isLoggedIn() at load time (currently just cart.js) need to do the
// same — see the comment on authReadyPromise for details.
document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    initNavigation();
    initHeaderSearch();
    initSiteSearch();
    initChatWidget();
    initCartCounter();
    initAddToCart();
    initBuyNow();
    initAuthGate();
    initHighlights();
    initReasonsCarousel();
    initCategoryTabs();
    initPreserveRedirectLinks();
    initPasswordToggles();
    updateAuthUI();
    setupVideoToggle('styleVideo', 'videoPlayBtn', '.video-container');
    setupVideoToggle('teamVideo', 'teamVideoBtn', '.area-video');
    initScrollAutoplay(['styleVideo', 'teamVideo']);
});

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
    const menuToggle = document.getElementById('menuToggle');
    const navMenu = document.getElementById('navMenu');

    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', function() {
            const isOpen = navMenu.classList.toggle('active');
            menuToggle.setAttribute('aria-expanded', String(isOpen));
        });

        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                menuToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }
}

// ============================================
// HEADER SEARCH TOGGLE
// ============================================
function initHeaderSearch() {
    const toggle = document.getElementById('searchToggle');
    const panel = document.getElementById('headerSearchPanel');
    const closeBtn = document.getElementById('headerSearchClose');
    const input = document.getElementById('headerSearchInput');
    if (!toggle || !panel) return;

    function openSearch() {
        panel.classList.add('active');
        toggle.classList.add('active');
        toggle.setAttribute('aria-expanded', 'true');
        setTimeout(() => input && input.focus(), 200);
    }

    function closeSearch() {
        panel.classList.remove('active');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function() {
        panel.classList.contains('active') ? closeSearch() : openSearch();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeSearch);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && panel.classList.contains('active')) closeSearch();
    });
}

// ============================================
// SITE SEARCH
// ============================================
// This script (main.js) loads on every page at a different relative depth —
// "js/main.js" from the site root (index.html) vs "../js/main.js" from the
// one-level-deep pages (studio/, services/, aboutus/). SITE_BASE reads the
// script's own src to figure out which, so every link below resolves
// correctly no matter which page the search runs from.
const SITE_BASE = (function () {
    const script = document.currentScript || document.querySelector('script[src*="main.js"]');
    const src = script ? script.getAttribute('src') || '' : '';
    return src.startsWith('../') ? '../' : '';
})();

// Small static index — pages, services, and the homepage's product catalog.
// Service links land on the Services page pre-filtered to the right gender;
// product links land on the homepage pre-filtered to the right category tab
// (see the ?category= handling in initCategoryTabs below).
const SEARCH_INDEX = [
    { label: 'Home', type: 'Page', href: SITE_BASE + 'index.html' },
    { label: 'Studio', type: 'Page', href: SITE_BASE + 'studio/studio.html' },
    { label: 'Services', type: 'Page', href: SITE_BASE + 'services/services.html' },
    { label: 'About Us', type: 'Page', href: SITE_BASE + 'aboutus/about.html' },

    { label: 'Classic Haircut', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },
    { label: 'Fade', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },
    { label: 'Taper', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },
    { label: 'Pompadour', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },
    { label: 'Buzz Cut', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },
    { label: 'Beard Trim', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },
    { label: 'Royal Shave', type: "Men's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=men' },

    { label: 'Haircut & Style', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },
    { label: 'Hair Coloring', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },
    { label: 'Highlights', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },
    { label: 'Balayage', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },
    { label: 'Hair Treatment', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },
    { label: 'Styling', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },
    { label: 'Blowout', type: "Women's Service", href: SITE_BASE + 'services/services.html?type=studio&gender=women' },

    { label: 'Matte Molding Wax', type: 'Product', href: SITE_BASE + 'products/products.html?category=wax' },
    { label: 'Natural Styling Wax', type: 'Product', href: SITE_BASE + 'products/products.html?category=wax' },
    { label: 'Premium Styling Wax', type: 'Product', href: SITE_BASE + 'products/products.html?category=wax' },
    { label: 'Solid Matte Spray', type: 'Product', href: SITE_BASE + 'products/products.html?category=sprays' },
    { label: 'Volume Boost Spray', type: 'Product', href: SITE_BASE + 'products/products.html?category=sprays' },
    { label: 'Premium Hold Spray', type: 'Product', href: SITE_BASE + 'products/products.html?category=sprays' }
];

function searchSite(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_INDEX
        .filter(item => item.label.toLowerCase().includes(q) || item.type.toLowerCase().includes(q))
        .slice(0, 6);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderSearchResults(container, results, query) {
    if (!query.trim()) {
        container.innerHTML = '';
        container.classList.remove('active');
        return;
    }
    if (!results.length) {
        container.innerHTML = `<p class="search-results-empty">No matches for "${escapeHtml(query)}"</p>`;
        container.classList.add('active');
        return;
    }
    container.innerHTML = results.map(r => `
        <a href="${r.href}" class="search-result-item">
            <span class="search-result-label">${escapeHtml(r.label)}</span>
            <span class="search-result-type">${escapeHtml(r.type)}</span>
        </a>
    `).join('');
    container.classList.add('active');
}

// Shared wiring for both the desktop header search input and the
// mobile-drawer search input — same filtering behavior, separate
// dropdown elements.
function wireSearchInput(input, resultsContainer) {
    input.addEventListener('input', function () {
        renderSearchResults(resultsContainer, searchSite(this.value), this.value);
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const results = searchSite(this.value);
            if (results.length) window.location.href = results[0].href;
        }
    });

    document.addEventListener('click', function (e) {
        if (e.target !== input && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.remove('active');
        }
    });
}

function initSiteSearch() {
    // Desktop expandable header search
    const headerForm = document.querySelector('.header-search-form');
    const headerInput = document.getElementById('headerSearchInput');
    if (headerForm && headerInput) {
        const headerResults = document.createElement('div');
        headerResults.className = 'search-results';
        headerResults.id = 'headerSearchResults';
        headerForm.appendChild(headerResults);
        wireSearchInput(headerInput, headerResults);
    }

    // Mobile drawer search (no id in markup — it's unique per page, so
    // querying by its class is enough)
    const mobileForm = document.querySelector('.mobile-search-form');
    const mobileInput = mobileForm ? mobileForm.querySelector('input') : null;
    if (mobileForm && mobileInput) {
        const mobileResults = document.createElement('div');
        mobileResults.className = 'search-results search-results--mobile';
        mobileForm.appendChild(mobileResults);
        wireSearchInput(mobileInput, mobileResults);
    }
}

// ============================================
// HIGHLIGHTS — INSTAGRAM-STYLE STORY BUBBLES
// ============================================
// Reuses existing site imagery rather than requiring new assets — each
// highlight is a themed set of photos already used elsewhere on the site.
// `seeMore` controls where the popup's "See More" button sends people —
// style highlights go to Services, team photos go to About/Team, studio
// photos go to the Studio page, and products scrolls to the on-page
// products section instead of navigating away.
const HIGHLIGHTS = [
    {
        id: 'fades',
        label: 'Fades',
        cover: 'images/fadecut.jpg',
        likes: 214,
        seeMore: { label: 'See More Styles', href: 'services/services.html?type=studio&gender=men' },
        stories: [
            { image: 'images/fadecut.jpg', caption: 'Skin fade, blended freehand for a seamless gradient.' },
            { image: 'images/tapercut.jpg', caption: 'Taper — a softer fade, sharp but office-safe.' },
            { image: 'images/crewcut.jpg', caption: 'Crew cut, tight fade on the sides.' }
        ]
    },
    {
        id: 'classics',
        label: 'Classics',
        cover: 'images/pompadourcut.jpg',
        likes: 176,
        seeMore: { label: 'See More Styles', href: 'services/services.html?type=studio&gender=men' },
        stories: [
            { image: 'images/pompadourcut.jpg', caption: 'Pompadour — volume on top, tapered sides.' },
            { image: 'images/modernmulletcut.jpg', caption: 'Modern mullet, textured and easy to style.' },
            { image: 'images/buzzcut.jpg', caption: 'Buzz cut — low maintenance, all one length.' }
        ]
    },
    {
        id: 'studio-life',
        label: 'Studio',
        cover: 'images/landscape.jpg',
        likes: 98,
        seeMore: { label: 'Visit the Studio', href: 'studio/studio.html' },
        stories: [
            { image: 'images/landscape.jpg', caption: 'Our studio and its surroundings.' },
            { image: 'images/booknowpic.jpg', caption: 'Precision at every chair.' }
        ]
    },
    {
        id: 'the-team',
        label: 'The Team',
        cover: 'images/team.jpg',
        likes: 152,
        seeMore: { label: 'Meet the Team', href: 'aboutus/about.html' },
        stories: [
            { image: 'images/team.jpg', caption: 'The barbers behind the chair.' },
            { image: 'images/team1.jpg', caption: 'Always sharpening the craft.' }
        ]
    },
    {
        id: 'products',
        label: 'Products',
        cover: 'images/hairwax.webp',
        likes: 67,
        seeMore: { label: 'Shop Products', href: 'products/products.html' },
        stories: [
            { image: 'images/hairwax.webp', caption: 'Matte Molding Wax — ₱250.' },
            { image: 'images/hairwax2.webp', caption: 'Natural Styling Wax — ₱350.' },
            { image: 'images/hairspray.png', caption: 'Solid Matte Spray — ₱450.' }
        ]
    }
];

const STORY_DURATION_MS = 4500;

function initHighlights() {
    const track = document.getElementById('highlightsTrack');
    const viewer = document.getElementById('storyViewer');
    if (!track || !viewer) return;

    // ---- Render the bubble row ----
    track.innerHTML = HIGHLIGHTS.map(h => `
        <button class="highlight-item" type="button" data-highlight="${h.id}" role="listitem">
            <span class="highlight-ring">
                <span class="highlight-avatar">
                    <img src="${h.cover}" alt="" loading="lazy"
                         onerror="this.src='https://placehold.co/150x150/232323/666?text=%20'" />
                </span>
                ${h.stories.length > 1 ? `<span class="highlight-count">${h.stories.length}</span>` : ''}
            </span>
            <span class="highlight-label">${h.label}</span>
        </button>
    `).join('');

    // ---- Viewer elements ----
    const backdrop = document.getElementById('storyViewerBackdrop');
    const closeBtn = document.getElementById('storyClose');
    const prevBtn = document.getElementById('storyPrev');
    const nextBtn = document.getElementById('storyNext');
    const progressWrap = document.getElementById('storyProgress');
    const headerAvatar = document.getElementById('storyHeaderAvatar');
    const headerLabel = document.getElementById('storyHeaderLabel');
    const storyImage = document.getElementById('storyImage');
    const storyCaption = document.getElementById('storyCaption');
    const likeBtn = document.getElementById('storyLikeBtn');
    const likeCountEl = document.getElementById('storyLikeCount');
    const seeMoreBtn = document.getElementById('storySeeMoreBtn');
    const seeMoreLabel = document.getElementById('storySeeMoreLabel');

    // ---- Liked state (persisted, like Instagram remembering what you've liked) ----
    const LIKED_STORAGE_KEY = 'toughcuts-liked-highlights';

    function getLikedIds() {
        try {
            const raw = localStorage.getItem(LIKED_STORAGE_KEY);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch (e) {
            return new Set();
        }
    }

    function setLikedIds(set) {
        try {
            localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify(Array.from(set)));
        } catch (e) {
            // Storage unavailable (private browsing, etc.) — like still works
            // for the current session, it just won't persist across reloads.
        }
    }

    function updateLikeUI(highlight) {
        const liked = getLikedIds().has(highlight.id);
        const count = highlight.likes + (liked ? 1 : 0);
        likeBtn.classList.toggle('liked', liked);
        likeBtn.setAttribute('aria-pressed', String(liked));
        likeBtn.setAttribute('aria-label', liked ? 'Unlike this highlight' : 'Like this highlight');
        likeBtn.querySelector('i').className = liked ? 'fas fa-heart' : 'fa-regular fa-heart';
        likeCountEl.textContent = count.toLocaleString();
    }

    let highlightIndex = 0;
    let storyIndex = 0;
    let timer = null;
    let lastFocused = null;

    function segments() {
        return Array.from(progressWrap.querySelectorAll('.story-progress-seg-fill'));
    }

    function buildProgressSegments(count) {
        progressWrap.innerHTML = Array.from({ length: count }, () =>
            `<span class="story-progress-seg"><span class="story-progress-seg-fill"></span></span>`
        ).join('');
    }

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function goToHighlight(index, resumeStoryIndex) {
        if (index < 0) return; // no previous highlight — just stay on the first story
        if (index >= HIGHLIGHTS.length) {
            closeViewer();
            return;
        }
        highlightIndex = index;
        storyIndex = resumeStoryIndex || 0;

        const highlight = HIGHLIGHTS[highlightIndex];
        buildProgressSegments(highlight.stories.length);
        headerAvatar.src = highlight.cover;
        headerLabel.textContent = highlight.label;

        updateLikeUI(highlight);
        seeMoreLabel.textContent = highlight.seeMore.label;
        seeMoreBtn.href = highlight.seeMore.href;

        const bubble = track.querySelector(`[data-highlight="${highlight.id}"]`);
        if (bubble) bubble.classList.add('viewed');

        showStory();
    }

    function showStory() {
        clearTimer();
        const highlight = HIGHLIGHTS[highlightIndex];
        const story = highlight.stories[storyIndex];

        storyImage.src = story.image;
        storyImage.alt = `${highlight.label} — ${story.caption}`;
        storyCaption.textContent = story.caption;

        const segs = segments();
        segs.forEach((seg, i) => {
            seg.classList.remove('animating');
            seg.style.transition = 'none';
            if (i < storyIndex) {
                seg.style.width = '100%';
            } else {
                seg.style.width = '0%';
            }
        });

        // Force reflow so the transition below actually animates from 0%
        // instead of jumping straight to 100% on the very first frame.
        void progressWrap.offsetWidth;

        const current = segs[storyIndex];
        if (current) {
            current.style.transition = `width linear ${STORY_DURATION_MS}ms`;
            requestAnimationFrame(() => { current.style.width = '100%'; });
        }

        timer = setTimeout(nextStory, STORY_DURATION_MS);
    }

    function nextStory() {
        const highlight = HIGHLIGHTS[highlightIndex];
        if (storyIndex < highlight.stories.length - 1) {
            storyIndex += 1;
            showStory();
        } else {
            goToHighlight(highlightIndex + 1, 0);
        }
    }

    function prevStory() {
        if (storyIndex > 0) {
            storyIndex -= 1;
            showStory();
        } else if (highlightIndex > 0) {
            const prevHighlight = HIGHLIGHTS[highlightIndex - 1];
            goToHighlight(highlightIndex - 1, prevHighlight.stories.length - 1);
        } else {
            showStory(); // already at the very first story — just restart its progress
        }
    }

    function openViewer(startId) {
        const startIndex = Math.max(0, HIGHLIGHTS.findIndex(h => h.id === startId));
        lastFocused = document.activeElement;
        viewer.hidden = false;
        document.body.style.overflow = 'hidden';
        goToHighlight(startIndex, 0);
        closeBtn.focus();
    }

    function closeViewer() {
        clearTimer();
        viewer.hidden = true;
        document.body.style.overflow = '';
        if (lastFocused) lastFocused.focus();
    }

    // ---- Wiring ----
    track.addEventListener('click', function (e) {
        const item = e.target.closest('.highlight-item');
        if (!item) return;
        openViewer(item.dataset.highlight);
    });

    closeBtn.addEventListener('click', closeViewer);
    backdrop.addEventListener('click', closeViewer);
    prevBtn.addEventListener('click', prevStory);
    nextBtn.addEventListener('click', nextStory);

    likeBtn.addEventListener('click', function () {
        const highlight = HIGHLIGHTS[highlightIndex];
        const liked = getLikedIds();
        if (liked.has(highlight.id)) {
            liked.delete(highlight.id);
        } else {
            liked.add(highlight.id);
        }
        setLikedIds(liked);
        updateLikeUI(highlight);
    });

    // "See More" normally navigates to another page (Services/Studio/About).
    // The Products highlight instead points at an in-page anchor, so close
    // the popup and smooth-scroll to it rather than trying to navigate.
    seeMoreBtn.addEventListener('click', function (e) {
        const href = this.getAttribute('href') || '';
        if (href.startsWith('#')) {
            e.preventDefault();
            closeViewer();
            const target = document.querySelector(href);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Otherwise let the link navigate normally.
    });

    document.addEventListener('keydown', function (e) {
        if (viewer.hidden) return;
        if (e.key === 'Escape') closeViewer();
        else if (e.key === 'ArrowRight') nextStory();
        else if (e.key === 'ArrowLeft') prevStory();
        else if (e.key === 'Tab') trapFocus(e);
    });

    // Pause the auto-advance while the tab is in the background, same
    // guard used for the homepage videos — otherwise stories can silently
    // burn through their whole timer while the person is on another tab.
    document.addEventListener('visibilitychange', function () {
        if (viewer.hidden) return;
        if (document.hidden) {
            clearTimer();
        } else {
            timer = setTimeout(nextStory, STORY_DURATION_MS);
        }
    });

    // Touch swipe — left/right advances or rewinds a story, same threshold
    // pattern as the reasons carousel elsewhere on this page.
    let touchStartX = 0;
    let touchDeltaX = 0;

    viewer.addEventListener('touchstart', function (e) {
        touchStartX = e.touches[0].clientX;
    }, { passive: true });

    viewer.addEventListener('touchmove', function (e) {
        touchDeltaX = e.touches[0].clientX - touchStartX;
    }, { passive: true });

    viewer.addEventListener('touchend', function () {
        const threshold = 50;
        if (touchDeltaX < -threshold) nextStory();
        else if (touchDeltaX > threshold) prevStory();
        touchDeltaX = 0;
    });

    function trapFocus(e) {
        const focusable = viewer.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

// ============================================
// REASONS CAROUSEL - AUTO SLIDE
// ============================================
function initReasonsCarousel() {
    const wrapper = document.getElementById('reasonsWrapper');
    const track = document.getElementById('reasonsTrack');
    if (!track || !wrapper) return;

    const cards = track.querySelectorAll('.reason-card');
    const dots = document.querySelectorAll('.carousel-dot');
    const statusEl = document.getElementById('carouselStatus');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let currentIndex = 0;
    let autoSlideInterval;

    // IMPORTANT: cards are NOT all the same width (the intro card is wider
    // than the regular cards, and the ratio between them changes again at
    // each responsive breakpoint). Positioning by a fixed "step" multiplied
    // by index drifts out of alignment starting at the 3rd/4th card. Reading
    // each card's actual offsetLeft is correct at every screen size.
    function updateActiveDot() {
        dots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    }

    function slideTo(index) {
        if (index < 0) index = 0;
        if (index >= cards.length) index = cards.length - 1;

        currentIndex = index;
        const offset = cards[currentIndex].offsetLeft;
        track.style.transform = `translateX(-${offset}px)`;
        updateActiveDot();

        if (statusEl) {
            statusEl.textContent = `Slide ${currentIndex + 1} of ${cards.length}`;
        }
    }

    function autoSlide() {
        let nextIndex = currentIndex + 1;
        if (nextIndex >= cards.length) nextIndex = 0;
        slideTo(nextIndex);
    }

    function stopAutoSlide() {
        if (autoSlideInterval) {
            clearInterval(autoSlideInterval);
            autoSlideInterval = null;
        }
        wrapper.classList.add('is-paused');
    }

    function startAutoSlide() {
        stopAutoSlide();
        if (prefersReducedMotion) return; // don't force motion on people who've asked not to see it
        wrapper.classList.remove('is-paused');
        autoSlideInterval = setInterval(autoSlide, 4000);
    }

    // Dots
    dots.forEach((dot, index) => {
        dot.addEventListener('click', function() {
            slideTo(index);
            startAutoSlide();
        });
    });

    // Slide button on the intro card
    const slideBtn = document.getElementById('slideBtn');
    if (slideBtn) {
        slideBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            let nextIndex = currentIndex + 1;
            if (nextIndex >= cards.length) nextIndex = 0;
            slideTo(nextIndex);
            startAutoSlide();
        });
    }

    // Pause on hover
    wrapper.addEventListener('mouseenter', stopAutoSlide);
    wrapper.addEventListener('mouseleave', startAutoSlide);

    // Pause on keyboard focus (tabbing to dots/button, or the wrapper itself)
    wrapper.addEventListener('focusin', stopAutoSlide);
    wrapper.addEventListener('focusout', function(e) {
        if (!wrapper.contains(e.relatedTarget)) startAutoSlide();
    });

    // Arrow-key navigation when the wrapper itself has focus
    wrapper.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            slideTo(currentIndex + 1);
            startAutoSlide();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            slideTo(currentIndex - 1);
            startAutoSlide();
        }
    });

    // Touch swipe
    let touchStartX = 0;
    let touchDeltaX = 0;
    let isDragging = false;

    track.addEventListener('touchstart', function(e) {
        touchStartX = e.touches[0].clientX;
        isDragging = true;
        stopAutoSlide();
    }, { passive: true });

    track.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        touchDeltaX = e.touches[0].clientX - touchStartX;
    }, { passive: true });

    track.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        const threshold = 50;
        if (touchDeltaX < -threshold) {
            slideTo(currentIndex + 1);
        } else if (touchDeltaX > threshold) {
            slideTo(currentIndex - 1);
        }
        touchDeltaX = 0;
        startAutoSlide();
    });

    // Recalculate position on resize without animating the jump.
    // No manual math needed here either — offsetLeft is re-read live.
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            track.style.transition = 'none';
            track.style.transform = `translateX(-${cards[currentIndex].offsetLeft}px)`;
            requestAnimationFrame(() => {
                track.style.transition = 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
            });
        }, 200);
    });

    slideTo(0);
    startAutoSlide();
    window.addEventListener('beforeunload', stopAutoSlide);
}

// ============================================
// VIDEO CONTROLS (shared by the style-upgrade video and the team video)
// ============================================
function setupVideoToggle(videoId, btnId, containerSelector) {
    const video = document.getElementById(videoId);
    const playBtn = document.getElementById(btnId);
    const container = document.querySelector(containerSelector);
    if (!video || !playBtn || !container) return;

    const toggle = () => (video.paused ? video.play() : video.pause());

    playBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggle();
    });
    container.addEventListener('click', toggle);

    video.addEventListener('play', () => {
        playBtn.classList.add('hidden');
        playBtn.innerHTML = '<i class="fas fa-pause" aria-hidden="true"></i>';
        playBtn.setAttribute('aria-label', 'Pause video');
    });
    video.addEventListener('pause', () => {
        if (!video.ended) {
            playBtn.classList.remove('hidden');
            playBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i>';
            playBtn.setAttribute('aria-label', 'Play video');
        }
    });
    video.addEventListener('ended', () => {
        playBtn.classList.remove('hidden');
        playBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i>';
        playBtn.setAttribute('aria-label', 'Play video');
        video.currentTime = 0;
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !video.paused) video.pause();
    });
}

// ============================================
// SCROLL-TRIGGERED AUTOPLAY
// ============================================
function initScrollAutoplay(videoIds) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return; // respect accessibility preference — don't force motion

    const videos = videoIds
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!videos.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                video.play().catch(() => {}); // guards against browsers blocking autoplay
            } else {
                video.pause();
            }
        });
    }, { threshold: 0.5 });

    videos.forEach(video => observer.observe(video));
}

// ============================================
// CHAT WIDGET
// ============================================
function initChatWidget() {
    const toggle = document.getElementById('chatToggle');
    const container = document.getElementById('chatContainer');
    const close = document.getElementById('chatClose');
    const send = document.getElementById('chatSend');
    const input = document.getElementById('chatInput');
    const messages = document.getElementById('chatMessages');

    if (!toggle || !container) return;

    toggle.addEventListener('click', function() {
        container.classList.toggle('active');
        if (container.classList.contains('active')) {
            input.focus();
        }
    });

    if (close) {
        close.addEventListener('click', function() {
            container.classList.remove('active');
        });
    }

    function appendMessage(role, text) {
        const wrap = document.createElement('div');
        wrap.className = `message ${role}`;

        const p = document.createElement('p');
        p.textContent = text; // textContent, not innerHTML — avoids XSS from typed input

        const small = document.createElement('small');
        small.textContent = 'Just now';

        wrap.append(p, small);
        messages.appendChild(wrap);
        messages.scrollTop = messages.scrollHeight;
    }

    const sendMessage = function() {
        const text = input.value.trim();
        if (!text) return;

        appendMessage('user', text);
        input.value = '';

        setTimeout(() => {
            const responses = [
                "Thanks for reaching out! How can I help you with your grooming needs today?",
                "Great question! Would you like to book an appointment or learn about our services?",
                "I'd be happy to help! Our services include precision cuts, beard grooming, and more.",
                "You can book an appointment online or walk into any of our studios!",
                "We offer both in-studio and home service options. What works best for you?"
            ];
            appendMessage('bot', responses[Math.floor(Math.random() * responses.length)]);
        }, 800);
    };

    if (send) send.addEventListener('click', sendMessage);
    if (input) {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendMessage();
        });
    }
}

// ============================================
// CART COUNTER
// ============================================
function initCartCounter() {
    const count = document.querySelector('.cart-count');
    const cartIcon = document.getElementById('cartIcon');
    if (!count) return;

    try {
        const cart = JSON.parse(localStorage.getItem('toughcuts_cart') || '[]');
        const total = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
        count.textContent = total;
        if (cartIcon) {
            cartIcon.setAttribute('aria-label', `View cart, ${total} item${total === 1 ? '' : 's'}`);
        }
    } catch (e) {
        count.textContent = '0';
    }
}

// ============================================
// SUPABASE AUTH STATE
// ============================================
// supabaseClient comes from supabaseClient.js, loaded on every page
// before this file. Supabase's session lives in localStorage under its
// own key and survives reloads/tabs on its own — we don't manage that
// storage directly. Instead we mirror the current user into
// currentSupabaseUser via onAuthStateChange so the rest of the site
// (cart gating, the nav, product/buy buttons) can call isLoggedIn()
// synchronously instead of awaiting getSession() everywhere.
//
// authReadyPromise resolves the first time onAuthStateChange fires
// (Supabase always fires an initial INITIAL_SESSION event on load, even
// when there's no session). Any code that checks isLoggedIn() at page
// load — not in response to a click — must await this first, or it may
// run before the session has been restored from storage. See the
// DOMContentLoaded listener at the top of this file, and cart.js's.
let currentSupabaseUser = null;
let authReady = false;
let authReadyResolve;
const authReadyPromise = new Promise(function (resolve) { authReadyResolve = resolve; });

if (typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.onAuthStateChange(function (event, session) {
        currentSupabaseUser = session ? session.user : null;
        if (!authReady) {
            authReady = true;
            authReadyResolve();
        } else {
            // Not the first firing (i.e. a login/logout/token refresh that
            // happened after the page had already settled) — refresh the
            // bits of UI that depend on auth state.
            if (typeof updateAuthUI === 'function') updateAuthUI();
            if (typeof initCartCounter === 'function') initCartCounter();
        }
    });
} else {
    // supabaseClient.js wasn't loaded on this page — fail safe as
    // "signed out" rather than hanging every awaiter forever.
    console.warn('supabaseClient is not defined — make sure supabaseClient.js is loaded before main.js.');
    authReady = true;
    authReadyResolve();
}

function isLoggedIn() {
    return !!currentSupabaseUser;
}

function getCurrentUser() {
    return currentSupabaseUser;
}

async function logOut() {
    if (typeof supabaseClient === 'undefined') return;
    await supabaseClient.auth.signOut();
    window.location.href = SITE_BASE + 'index.html';
}

// Header avatar's initial — first letter of the account's display name
// (set at signup, editable on account.html) falling back to the first
// letter of their email if they haven't set one. account.js's profile
// summary card uses this exact same rule, so the header and the
// account page always agree.
function getAvatarInitial(user) {
    if (!user) return '';
    const name = user.user_metadata && user.user_metadata.name;
    const source = (name && name.trim()) || user.email || '';
    return source.trim().charAt(0).toUpperCase() || '?';
}

// Swaps the header's Log In / Sign Up links for a Log Out link, and
// reveals the account avatar icon, once someone is signed in. Runs on
// load (after authReadyPromise resolves) and again on every auth state
// change — including right after account.js saves a new name, so the
// header's initial stays in sync without a page reload. Only touches
// text/behavior, not the original href, so it works unmodified at any
// folder depth.
function updateAuthUI() {
    const user = getCurrentUser();

    document.querySelectorAll('.nav-auth-link').forEach(function (link) {
        if (user) {
            if (!link.dataset.originalHref) link.dataset.originalHref = link.getAttribute('href');
            link.textContent = 'Log Out';
            link.setAttribute('href', '#');
            link.onclick = function (e) {
                e.preventDefault();
                logOut();
            };
        } else {
            if (link.dataset.originalHref) link.setAttribute('href', link.dataset.originalHref);
            link.textContent = 'Log In';
            link.onclick = null;
        }
    });

    // Sign Up only makes sense while signed out — hide it instead of
    // repurposing it.
    document.querySelectorAll('.nav-auth-btn').forEach(function (btn) {
        btn.style.display = user ? 'none' : '';
    });

    // Account avatar — hidden while signed out (Log In / Sign Up already
    // cover that case); shown with the visitor's initial once signed in.
    document.querySelectorAll('.account-icon').forEach(function (link) {
        link.hidden = !user;
        if (user) {
            link.setAttribute('aria-label', 'View account');
            const avatar = link.querySelector('.account-icon-avatar');
            if (avatar) avatar.textContent = getAvatarInitial(user);
        }
    });

    initAccountMenus();
}

// --------------------------------------------
// Account dropdown — turns the header avatar into a small menu (My
// Account / My Orders / My Appointments / Log Out) instead of a direct
// link, so those pages are reachable from every page without editing
// each page's header markup individually. Built once per .account-icon (there's
// exactly one per page) the first time updateAuthUI() runs; later
// updateAuthUI() calls just show/hide the trigger and refresh the
// avatar initial as before — the menu itself doesn't need rebuilding.
// --------------------------------------------
function initAccountMenus() {
    document.querySelectorAll('.account-icon').forEach(function (trigger) {
        if (trigger.dataset.menuInit) return;
        trigger.dataset.menuInit = 'true';

        // The icon's own href already resolves correctly at this page's
        // depth (e.g. "../account/account.html") — reuse it as-is for
        // the "My Account" item instead of recomputing it.
        const accountHref = trigger.getAttribute('href');

        const wrap = document.createElement('div');
        wrap.className = 'account-menu';
        trigger.parentNode.insertBefore(wrap, trigger);
        wrap.appendChild(trigger);

        const panel = document.createElement('div');
        panel.className = 'account-menu-panel';
        panel.hidden = true;
        panel.innerHTML = `
            <a href="${accountHref}" class="account-menu-item">
                <i class="fas fa-user" aria-hidden="true"></i> My Account
            </a>
            <a href="${SITE_BASE}myorders/myorders.html" class="account-menu-item">
                <i class="fas fa-bag-shopping" aria-hidden="true"></i> My Orders
            </a>
            <a href="${SITE_BASE}myappointments/myappointments.html" class="account-menu-item">
                <i class="fas fa-calendar-check" aria-hidden="true"></i> My Appointments
            </a>
            <button type="button" class="account-menu-item account-menu-logout">
                <i class="fas fa-arrow-right-from-bracket" aria-hidden="true"></i> Log Out
            </button>
        `;
        wrap.appendChild(panel);

        trigger.setAttribute('aria-haspopup', 'true');
        trigger.setAttribute('aria-expanded', 'false');

        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            const isOpen = !panel.hidden;
            closeAllAccountMenus();
            if (!isOpen) {
                panel.hidden = false;
                trigger.setAttribute('aria-expanded', 'true');
            }
        });

        const logoutBtn = panel.querySelector('.account-menu-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function (e) {
                e.preventDefault();
                closeAllAccountMenus();
                logOut();
            });
        }
    });
}

function closeAllAccountMenus() {
    document.querySelectorAll('.account-menu-panel').forEach(function (panel) {
        panel.hidden = true;
        const trigger = panel.previousElementSibling;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
}

// Close on outside click / Escape — same pattern as admin's notifications.js.
document.addEventListener('click', function (e) {
    if (!e.target.closest('.account-menu')) closeAllAccountMenus();
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllAccountMenus();
});

// ============================================
// ADD TO CART
// ============================================
// Products page can register this optional getter after the shared script
// loads. Other pages do not have to load the catalog module, so the guard
// remains permissive there and the server must still enforce stock at checkout.
function canAddStockAwareCartItem(productId, quantity) {
    if (!Number.isFinite(quantity) || quantity <= 0) return false;
    if (typeof window.getCustomerProductStock !== 'function') return true;

    const stock = window.getCustomerProductStock(productId);
    if (!stock) return true;

    if (!stock.ready) {
        alert(stock.error
            ? 'Stock availability is temporarily unavailable. Please refresh and try again.'
            : 'Stock availability is still loading. Please try again in a moment.');
        return false;
    }

    if (!stock.isActive || stock.stock <= 0) {
        alert('This product is currently out of stock.');
        return false;
    }

    let cart = [];
    try {
        cart = JSON.parse(localStorage.getItem('toughcuts_cart') || '[]');
    } catch (e) {
        cart = [];
    }

    const existing = cart.find(item => item.id === productId);
    const requestedTotal = (existing && Number(existing.quantity) || 0) + quantity;
    if (requestedTotal > stock.stock) {
        alert(`Only ${stock.stock} ${stock.stock === 1 ? 'unit is' : 'units are'} currently available.`);
        return false;
    }

    return true;
}

function addToCart(productId, name, price, quantity = 1, opts = {}) {
    if (!canAddStockAwareCartItem(productId, quantity)) return false;

    let cart = [];
    try {
        cart = JSON.parse(localStorage.getItem('toughcuts_cart') || '[]');
    } catch (e) {
        cart = [];
    }

    const existing = cart.find(item => item.id === productId);
    if (existing) {
        existing.quantity += quantity;
    } else {
        cart.push({ id: productId, name, price, quantity });
    }

    localStorage.setItem('toughcuts_cart', JSON.stringify(cart));
    initCartCounter();

    if (!opts.silent) {
        alert(`${name} added to cart!`);
    }
    return true;
}

// Wires every .product-btn in the DOM to addToCart() using its data attributes.
// Signed-out visitors get the login/signup gate instead of an immediate add.
function initAddToCart() {
    document.querySelectorAll('.product-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const { id, name, price } = this.dataset;
            if (!id || !name || !price) return;

            if (!isLoggedIn()) {
                openAuthGate({ id, name, price: parseFloat(price) });
                return;
            }

            addToCart(id, name, parseFloat(price));
        });
    });
}

// Wires every .product-buy-btn in the DOM — same login gate as Add to Cart,
// but on success it adds the item and sends the person straight to their
// cart instead of just showing a confirmation. Reuses the header cart
// icon's own href so the redirect resolves correctly no matter how deep
// the current page sits in the folder structure (root vs. products/, etc).
function initBuyNow() {
    document.querySelectorAll('.product-buy-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const { id, name, price } = this.dataset;
            if (!id || !name || !price) return;

            if (!isLoggedIn()) {
                openAuthGate({ id, name, price: parseFloat(price) });
                return;
            }

            const added = addToCart(id, name, parseFloat(price), 1, { silent: true });
            if (!added) return;

            const cartLink = document.getElementById('cartIcon');
            if (cartLink) {
                window.location.href = cartLink.getAttribute('href');
            }
        });
    });
}

// ============================================
// AUTH GATE MODAL — login/signup prompt shown
// when a signed-out visitor tries to add to cart
// ============================================
let pendingCartItem = null;

function openAuthGate(item) {
    const modal = document.getElementById('authGate');
    if (!modal) return;

    pendingCartItem = item || null;

    // Send people back to the right spot after they log in / sign up.
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    const loginBtn = document.getElementById('authGateLoginBtn');
    const signupBtn = document.getElementById('authGateSignupBtn');
    if (loginBtn) loginBtn.href = `${SITE_BASE}login/login.html?redirect=${returnTo}`;
    if (signupBtn) signupBtn.href = `${SITE_BASE}login/signup.html?redirect=${returnTo}`;

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeAuthGate() {
    const modal = document.getElementById('authGate');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    pendingCartItem = null;
}

function initAuthGate() {
    const modal = document.getElementById('authGate');
    const backdrop = document.getElementById('authGateBackdrop');
    const closeBtn = document.getElementById('authGateClose');
    if (!modal) return;

    if (backdrop) backdrop.addEventListener('click', closeAuthGate);
    if (closeBtn) closeBtn.addEventListener('click', closeAuthGate);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.hidden) closeAuthGate();
    });
}

// ============================================
// PRODUCT CATEGORY TABS
// ============================================
function initCategoryTabs() {
    const tabs = document.querySelectorAll('.category-tab');
    const products = document.querySelectorAll('.product-card');

    if (!tabs.length || !products.length) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            const category = this.dataset.category;

            products.forEach(product => {
                const show = category === 'all' || product.dataset.category === category;
                product.style.display = show ? 'flex' : 'none';
            });
        });
    });

    // Deep-link support: ?category=wax preselects that tab on load.
    // Used by site search results (see initSiteSearch) so a product hit
    // lands on the right filtered view instead of just the top of the page.
    const requestedCategory = new URLSearchParams(window.location.search).get('category');
    if (requestedCategory) {
        const match = Array.from(tabs).find(t => t.dataset.category === requestedCategory);
        if (match) match.click();
    }
}

// ============================================
// AUTH PAGE SHARED HELPERS
// Used by login.html / signup.html / forgot.html / recovery.html /
// reset.html. Centralized here (rather than copy-pasted into each page's
// own JS file) so the redirect param, email validation, and password
// visibility toggle behave identically everywhere they appear.
// ============================================
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
    return EMAIL_PATTERN.test(email);
}

// Reads ?redirect= from the current page's URL. The auth pages pass this
// along to each other so a visitor gated into login/signup (or sent
// through the whole forgot -> recovery -> reset chain) lands back where
// they started instead of just dropping onto the homepage.
//
// Only same-site relative paths are accepted — anything that looks like
// an absolute URL (a scheme like "https:"/"javascript:", or a
// protocol-relative "//evil.com") is rejected. Without this check, a
// crafted link like "login.html?redirect=https://evil-lookalike.com"
// would silently send a visitor off-site immediately after they log in —
// a classic open-redirect phishing setup — since every auth page does
// `window.location.href = redirect` with whatever this function returns.
function isSafeRedirectPath(path) {
    if (!path) return false;
    if (path.startsWith('//') || path.startsWith('\\')) return false; // protocol-relative
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false; // has a scheme, e.g. "https:", "javascript:"
    return true;
}

function getRedirectParam() {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (!redirect) return null;
    let decoded;
    try {
        decoded = decodeURIComponent(redirect);
    } catch (e) {
        return null;
    }
    return isSafeRedirectPath(decoded) ? decoded : null;
}

// Appends the current page's redirect param (if any) onto a target URL,
// preserving whatever query string that URL already has.
function withRedirectParam(url) {
    const raw = new URLSearchParams(window.location.search).get('redirect');
    if (!raw) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}redirect=${raw}`;
}

// Wires every link marked data-preserve-redirect so it carries the
// current ?redirect= forward. Covers the small hops between auth pages
// (login <-> signup, forgot -> login, recovery -> forgot, reset -> login)
// that would otherwise silently drop it, stranding a visitor who was
// gated in from a specific action (like adding to cart).
function initPreserveRedirectLinks() {
    document.querySelectorAll('[data-preserve-redirect]').forEach(function (link) {
        const href = link.getAttribute('href');
        if (href) link.setAttribute('href', withRedirectParam(href));
    });
}

// Wires a show/hide toggle for a single password field.
function wirePasswordToggle(button, input) {
    if (!button || !input) return;
    button.addEventListener('click', function () {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.innerHTML = showing
            ? '<i class="fas fa-eye" aria-hidden="true"></i>'
            : '<i class="fas fa-eye-slash" aria-hidden="true"></i>';
        button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
}

// Wires every .login-toggle-pass[data-toggle-target] button on the page —
// covers the single password field on login.html and the multiple
// password fields on signup.html / reset.html alike.
function initPasswordToggles() {
    document.querySelectorAll('.login-toggle-pass[data-toggle-target]').forEach(function (btn) {
        wirePasswordToggle(btn, document.getElementById(btn.dataset.toggleTarget));
    });
}

// Password strength rules shared by signup.html and reset.html.
const PASSWORD_RULES = [
    { key: 'length', label: 'At least 8 characters', test: pw => pw.length >= 8 },
    { key: 'letter', label: 'One letter', test: pw => /[a-zA-Z]/.test(pw) },
    { key: 'number', label: 'One number', test: pw => /[0-9]/.test(pw) },
    { key: 'special', label: 'One symbol (! $ @ %)', test: pw => /[!$@%]/.test(pw) }
];

function passwordMeetsRequirements(password) {
    return PASSWORD_RULES.every(rule => rule.test(password));
}

// Renders a live checklist under a password field and keeps it in sync
// on every keystroke. `listEl` is an empty <ul> that this function fills
// with one <li> per rule.
function initPasswordChecklist(inputEl, listEl) {
    if (!inputEl || !listEl) return;

    listEl.innerHTML = PASSWORD_RULES.map(rule =>
        `<li data-rule="${rule.key}"><i class="fas fa-circle" aria-hidden="true"></i> ${rule.label}</li>`
    ).join('');

    function update() {
        const password = inputEl.value;
        PASSWORD_RULES.forEach(function (rule) {
            const li = listEl.querySelector(`[data-rule="${rule.key}"]`);
            if (!li) return;
            const passed = rule.test(password);
            li.classList.toggle('met', passed);
            const icon = li.querySelector('i');
            if (icon) icon.className = passed ? 'fas fa-circle-check' : 'fas fa-circle';
        });
    }

    inputEl.addEventListener('input', update);
    update();
}