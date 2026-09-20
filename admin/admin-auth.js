// ============================================================
// ADMIN AUTH BOOTSTRAP
// ============================================================

let currentAdminUser = null;
let authReady = false;
let authReadyResolve;
const authReadyPromise = new Promise(function (resolve) { authReadyResolve = resolve; });

// ============================================================
// UPDATE SIDEBAR EMAIL
// ============================================================
function updateSidebarEmail() {
    const emailEl = document.getElementById('adminSidebarEmail');
    console.log('🔍 updateSidebarEmail called, element found:', !!emailEl);
    
    if (emailEl) {
        if (currentAdminUser && currentAdminUser.email) {
            emailEl.textContent = currentAdminUser.email;
            console.log('✅ Email updated:', currentAdminUser.email);
        } else {
            emailEl.textContent = '—';
            console.log('⚠️ No user email found');
        }
    } else {
        console.warn('⚠️ adminSidebarEmail element not found in DOM');
    }
}

if (typeof supabaseClient !== 'undefined') {
    // getSession() waits for Supabase to actually finish restoring the
    // persisted session before returning — unlike the first
    // onAuthStateChange event, which can fire with session: null a beat
    // before the real one comes through. That gap was what caused the
    // login.html <-> users.html bounce.
    supabaseClient.auth.getSession().then(function ({ data }) {
        currentAdminUser = data.session ? data.session.user : null;
        console.log('🔑 Session loaded:', currentAdminUser?.email || 'none');
        if (!authReady) {
            authReady = true;
            authReadyResolve();
        }
        // ✅ UPDATE EMAIL AFTER SESSION LOAD
        setTimeout(updateSidebarEmail, 100);
    });

    supabaseClient.auth.onAuthStateChange(function (event, session) {
        currentAdminUser = session ? session.user : null;
        console.log('🔄 Auth state changed:', event, currentAdminUser?.email || 'none');
        if (!authReady) {
            authReady = true;
            authReadyResolve();
        }
        // ✅ UPDATE EMAIL ON AUTH CHANGE
        setTimeout(updateSidebarEmail, 100);
    });
} else {
    console.warn('supabaseClient is not defined — make sure supabase.js is loaded before admin-auth.js.');
    authReady = true;
    authReadyResolve();
}

function isLoggedIn() {
    return !!currentAdminUser;
}

function getCurrentUser() {
    return currentAdminUser;
}

async function adminLogOut() {
    if (typeof supabaseClient === 'undefined') return;
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --------------------------------------------
// isAdmin() — always re-checks the database rather than trusting a
// value cached at login. A revoked admin should lose access on their
// very next page load, not just at their next sign-in.
// --------------------------------------------
async function isAdmin() {
    const user = getCurrentUser();
    if (!user) return false;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

    if (error) {
        console.error('isAdmin() check failed:', error);
        return false; // fail closed — a broken check should never grant access
    }
    return !!(data && data.is_admin);
}

// --------------------------------------------
// requireAdminOrRedirect() — the one call every protected admin page
// makes before rendering anything. Bounces non-admins (and signed-out
// visitors) straight to the login page rather than flashing real data
// first and hiding it a moment later.
// --------------------------------------------
async function requireAdminOrRedirect() {
    await authReadyPromise;

    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return null;
    }

    const admin = await isAdmin();
    if (!admin) {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html?denied=1';
        return null;
    }

    // ✅ UPDATE EMAIL AFTER ADMIN VERIFICATION
    setTimeout(updateSidebarEmail, 100);
    return getCurrentUser();
}

// ============================================================
// SIDEBAR TOGGLE (Mobile Dropdown)
// ============================================================

function initSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const dropdown = document.getElementById('sidebarDropdown');
    
    if (toggle && dropdown) {
        // Remove existing listeners to prevent duplicates
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        
        newToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdown.classList.toggle('open');
            const isOpen = dropdown.classList.contains('open');
            this.setAttribute('aria-expanded', String(isOpen));
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            const sidebar = document.querySelector('.admin-sidebar');
            if (sidebar && !sidebar.contains(e.target)) {
                dropdown.classList.remove('open');
                const btn = document.getElementById('sidebarToggle');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            }
        });
        
        // Close dropdown on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                dropdown.classList.remove('open');
                const btn = document.getElementById('sidebarToggle');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

// ============================================================
// INIT ON PAGE LOAD
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM loaded — initializing sidebar toggle');
    initSidebarToggle();
    // ✅ UPDATE EMAIL ON PAGE LOAD
    setTimeout(updateSidebarEmail, 50);
    setTimeout(updateSidebarEmail, 200);
    setTimeout(updateSidebarEmail, 500);
});

// Also try immediately if DOM is already ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log('📄 DOM already ready');
    setTimeout(updateSidebarEmail, 50);
}