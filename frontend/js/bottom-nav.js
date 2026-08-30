// ============================================
// MOBILE BOTTOM NAVIGATION
// ============================================
// Injects a persistent bottom tab bar (Home / Services / Shop / Account)
// plus a floating "Book Appointment" action, replacing the hamburger
// drawer as the primary navigation model below 900px (see the
// max-width:900px rules in style.css that show this bar and hide the
// old .nav-menu drawer at that width, and hide this bar above it).
// Desktop navigation is completely untouched.
//
// Loads after supabase.js + main.js on every page (same script order as
// order-notifications.js), so it can reuse SITE_BASE, isLoggedIn(),
// getCurrentUser(), getAvatarInitial(), logOut() and authReadyPromise
// exactly the way main.js's own header logic already does — nothing
// here hardcodes a page depth or duplicates auth state.
document.addEventListener('DOMContentLoaded', function () {
    if (typeof SITE_BASE === 'undefined') return; // main.js didn't load on this page — bail safely

    injectBottomNav();
    initBottomNavActiveState();
    initBottomNavCartBadge();
    initBottomNavNotifBadge();
    initAccountSheet();
});

// --------------------------------------------
// Build + insert the bar, FAB, and (hidden) sheet
// --------------------------------------------
function injectBottomNav() {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
        <a class="bottom-nav-item" data-nav="home" href="${SITE_BASE}index.html">
            <i class="fas fa-house" aria-hidden="true"></i><span>Home</span>
        </a>
        <a class="bottom-nav-item" data-nav="services" href="${SITE_BASE}services/services.html">
            <i class="fas fa-scissors" aria-hidden="true"></i><span>Services</span>
        </a>
        <a class="bottom-nav-item" data-nav="shop" href="${SITE_BASE}products/products.html">
            <i class="fas fa-bag-shopping" aria-hidden="true"></i><span>Shop</span>
            <span class="bottom-nav-badge" id="bottomNavCartBadge" hidden>0</span>
        </a>
        <button type="button" class="bottom-nav-item" data-nav="account" id="bottomNavAccountBtn" aria-haspopup="true" aria-expanded="false">
            <i class="fas fa-user" aria-hidden="true"></i><span>Account</span>
            <span class="bottom-nav-badge" id="bottomNavNotifBadge" hidden aria-label="Unread notifications"></span>
        </button>
    `;

    const fab = document.createElement('a');
    fab.className = 'bottom-nav-fab';
    fab.href = SITE_BASE + 'booking/booking.html';
    fab.setAttribute('aria-label', 'Book Appointment');
    fab.innerHTML = '<i class="fas fa-calendar-check" aria-hidden="true"></i>';

    const sheet = document.createElement('div');
    sheet.className = 'account-sheet';
    sheet.id = 'bottomNavAccountSheet';
    sheet.hidden = true;
    sheet.innerHTML = `
        <div class="account-sheet-backdrop" id="accountSheetBackdrop"></div>
        <div class="account-sheet-panel" role="dialog" aria-modal="true" aria-label="Account menu">
            <div class="account-sheet-grabber" aria-hidden="true"></div>
            <div id="accountSheetContent"></div>
        </div>
    `;

    document.body.appendChild(nav);
    document.body.appendChild(fab);
    document.body.appendChild(sheet);
}

// --------------------------------------------
// Highlight the tab for the current page. Studio and other secondary
// pages intentionally show no active tab (they live inside the Account
// sheet's "Explore" list, not the primary four) rather than force-fitting
// them onto a tab that isn't really them.
// --------------------------------------------
function initBottomNavActiveState() {
    const path = window.location.pathname;
    let current = null;

    if (/\/index\.html$/.test(path) || /\/$/.test(path)) current = 'home';
    else if (/\/services\.html$/.test(path)) current = 'services';
    else if (/\/products\.html$/.test(path)) current = 'shop';
    else if (/\/(myorders|myappointments|account)\.html$/.test(path)) current = 'account';

    if (!current) return;
    const item = document.querySelector('.bottom-nav-item[data-nav="' + current + '"]');
    if (item) item.setAttribute('aria-current', 'page');
}

// --------------------------------------------
// Cart badge — mirrors the header's existing .cart-count (kept in sync
// by main.js's own initCartCounter()/cart mutations) instead of
// tracking cart state a second time.
// --------------------------------------------
function initBottomNavCartBadge() {
    const source = document.querySelector('.cart-count');
    const badge = document.getElementById('bottomNavCartBadge');
    if (!source || !badge) return;

    function sync() {
        const n = parseInt(source.textContent, 10) || 0;
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.hidden = n <= 0;
    }

    sync();
    new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
}

// --------------------------------------------
// Notification badge — mirrors the header avatar's existing
// .order-notif-dot (added/removed by order-notifications.js's
// setCustomerNotificationBadge()/hideCustomerNotificationBadge()).
// Observing the same element instead of reimplementing the unread
// check keeps this in lockstep with the real source of truth for free.
// --------------------------------------------
function initBottomNavNotifBadge() {
    const headerIcon = document.querySelector('.account-icon');
    const badge = document.getElementById('bottomNavNotifBadge');
    if (!headerIcon || !badge) return;

    function sync() {
        badge.hidden = !headerIcon.querySelector('.order-notif-dot');
    }

    sync();
    new MutationObserver(sync).observe(headerIcon, { childList: true, subtree: true });
}

// --------------------------------------------
// Account sheet — bottom sheet instead of a centered modal on purpose:
// on a small screen a centered dialog leaves dead space above/below and
// puts its own close button out of comfortable thumb reach, while a
// sheet keeps everything in the lower two-thirds of the screen.
// --------------------------------------------
function initAccountSheet() {
    const trigger = document.getElementById('bottomNavAccountBtn');
    const sheet = document.getElementById('bottomNavAccountSheet');
    const backdrop = document.getElementById('accountSheetBackdrop');
    const content = document.getElementById('accountSheetContent');
    if (!trigger || !sheet || !content) return;

    let lastFocused = null;

    async function open() {
        if (typeof authReadyPromise !== 'undefined') await authReadyPromise;
        renderAccountSheetContent(content);

        lastFocused = document.activeElement;
        sheet.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';

        const firstFocusable = content.querySelector('a, button');
        if (firstFocusable) firstFocusable.focus();
    }

    function close() {
        sheet.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        if (lastFocused) lastFocused.focus();
    }

    trigger.addEventListener('click', function () {
        if (sheet.hidden) open();
        else close();
    });

    if (backdrop) backdrop.addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || sheet.hidden) return;
        close();
    });

    // Simple Tab-trap so keyboard users can't tab out into the page
    // behind the sheet while it's open.
    sheet.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        const focusable = sheet.querySelectorAll('a, button');
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
    });
}

function renderAccountSheetContent(content) {
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;

    if (user) {
        const initial = typeof getAvatarInitial === 'function' ? getAvatarInitial(user) : '?';
        const name = (user.user_metadata && user.user_metadata.name) || user.email || 'Your account';

        content.innerHTML = `
            <div class="account-sheet-user">
                <span class="account-sheet-avatar" aria-hidden="true">${initial}</span>
                <span>${escapeHtml(name)}</span>
            </div>
            <a class="account-sheet-link" href="${SITE_BASE}account/account.html">
                <i class="fas fa-user" aria-hidden="true"></i> My Account
            </a>
            <a class="account-sheet-link" href="${SITE_BASE}myorders/myorders.html">
                <i class="fas fa-bag-shopping" aria-hidden="true"></i> My Orders
            </a>
            <a class="account-sheet-link" href="${SITE_BASE}myappointments/myappointments.html">
                <i class="fas fa-calendar-check" aria-hidden="true"></i> My Appointments
            </a>
            <div class="account-sheet-title">Explore</div>
            <a class="account-sheet-link" href="${SITE_BASE}studio/studio.html">
                <i class="fas fa-location-dot" aria-hidden="true"></i> Studio &amp; Locations
            </a>
            <a class="account-sheet-link" href="${SITE_BASE}aboutus/about.html">
                <i class="fas fa-circle-info" aria-hidden="true"></i> About Us
            </a>
            <div class="account-sheet-actions">
                <button type="button" class="btn-secondary" id="accountSheetLogout">Log Out</button>
            </div>
        `;

        const logoutBtn = content.querySelector('#accountSheetLogout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                if (typeof logOut === 'function') logOut();
            });
        }
    } else {
        content.innerHTML = `
            <div class="account-sheet-actions" style="margin-top: 4px;">
                <a class="btn-primary" href="${SITE_BASE}login/signup.html">Sign Up</a>
                <a class="btn-secondary" href="${SITE_BASE}login/login.html">Log In</a>
            </div>
            <div class="account-sheet-title">Explore</div>
            <a class="account-sheet-link" href="${SITE_BASE}studio/studio.html">
                <i class="fas fa-location-dot" aria-hidden="true"></i> Studio &amp; Locations
            </a>
            <a class="account-sheet-link" href="${SITE_BASE}services/services.html">
                <i class="fas fa-scissors" aria-hidden="true"></i> Services
            </a>
            <a class="account-sheet-link" href="${SITE_BASE}aboutus/about.html">
                <i class="fas fa-circle-info" aria-hidden="true"></i> About Us
            </a>
        `;
    }
}

// Minimal escape for the one bit of user-controlled text (display name)
// this file ever writes via innerHTML.
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}