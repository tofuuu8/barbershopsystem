// ============================================================
// ADMIN AUTH BOOTSTRAP
// ============================================================
// Deliberately NOT the frontend's js/main.js — that file wires up the
// marketing site's nav, search, and homepage story viewer, none of
// which exist on admin pages, and it would either error out reaching
// for missing elements or just be dead weight. This is the minimal
// slice admin actually needs: know who's signed in, and confirm
// they're an admin before showing anything.
//
// Loaded after ../frontend/js/supabase.js (same shared Supabase
// client/project as the customer site — admins are just profiles rows
// with is_admin = true, not a separate user pool).
// ============================================================

let currentAdminUser = null;
let authReady = false;
let authReadyResolve;
const authReadyPromise = new Promise(function (resolve) { authReadyResolve = resolve; });

if (typeof supabaseClient !== 'undefined') {
    // getSession() waits for Supabase to actually finish restoring the
    // persisted session before returning — unlike the first
    // onAuthStateChange event, which can fire with session: null a beat
    // before the real one comes through. That gap was what caused the
    // login.html <-> users.html bounce.
    supabaseClient.auth.getSession().then(function ({ data }) {
        currentAdminUser = data.session ? data.session.user : null;
        if (!authReady) {
            authReady = true;
            authReadyResolve();
        }
    });

    supabaseClient.auth.onAuthStateChange(function (event, session) {
        currentAdminUser = session ? session.user : null;
        if (!authReady) {
            authReady = true;
            authReadyResolve();
        }
    });
} else {
    console.warn('supabaseClient is not defined — make sure ../frontend/js/supabase.js is loaded before admin-auth.js.');
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

    return getCurrentUser();
}