// ============================================
// TOUGHCUTS - Main JavaScript
// ============================================

// Single entry point — every init function is called exactly once here.
// Do not add a second DOMContentLoaded listener anywhere else in this file;
// calling an init function twice double-attaches its click handlers, which
// makes toggles (chat, nav, etc.) appear to do nothing on click.
document.addEventListener('DOMContentLoaded', function () {
    initNavigation();
    initHeaderSearch();
    initChatWidget();
    initCartCounter();
    initAddToCart();
    initReasonsCarousel();
    initCategoryTabs();
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
// ADD TO CART
// ============================================
function addToCart(productId, name, price, quantity = 1) {
    let cart = JSON.parse(localStorage.getItem('toughcuts_cart') || '[]');

    const existing = cart.find(item => item.id === productId);
    if (existing) {
        existing.quantity += quantity;
    } else {
        cart.push({ id: productId, name, price, quantity });
    }

    localStorage.setItem('toughcuts_cart', JSON.stringify(cart));
    initCartCounter();

    alert(`${name} added to cart!`);
}

// Wires every .product-btn in the DOM to addToCart() using its data attributes.
function initAddToCart() {
    document.querySelectorAll('.product-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const { id, name, price } = this.dataset;
            if (!id || !name || !price) return;
            addToCart(id, name, parseFloat(price));
        });
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
                product.style.display = product.dataset.category === category ? 'flex' : 'none';
            });
        });
    });
}