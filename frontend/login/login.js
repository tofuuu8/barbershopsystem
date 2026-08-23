// ============================================
// LOGIN PAGE
// ============================================
// Backed by Supabase Auth. supabaseClient (from js/supabase.js)
// and currentSupabaseUser/authReadyPromise/isLoggedIn() etc. (from
// js/main.js) are both loaded before this file.
//
// getRedirectParam() / isValidEmail() / initPasswordToggles() /
// initPreserveRedirectLinks() live in main.js so every auth page shares
// the exact same redirect-forwarding and validation behavior.

document.addEventListener('DOMContentLoaded', async function () {
    // Wait for Supabase to finish restoring any existing session before
    // doing anything else — if someone is already logged in and lands
    // here (e.g. via browser back button), send them on immediately
    // instead of showing the form.
    await authReadyPromise;

    if (isLoggedIn()) {
        window.location.href = getRedirectParam() || '../index.html';
        return;
    }

    initResetSuccessNote();
    initRedirectNote();
    initLoginForm();
    initLoginResend();
});

// --------------------------------------------
// Redirect / reset-success banners
// --------------------------------------------
function initRedirectNote() {
    const note = document.getElementById('loginRedirectNote');
    if (!note) return;
    // Don't show "continue where you left off" on top of the reset
    // success note — the success note already covers that case.
    if (getRedirectParam() && new URLSearchParams(window.location.search).get('reset') !== 'success') {
        note.hidden = false;
    }
}

// Shown after completing the forgot -> recovery -> reset password chain
// (reset.js sends the visitor here with ?reset=success).
function initResetSuccessNote() {
    const note = document.getElementById('loginResetSuccessNote');
    if (!note) return;
    if (new URLSearchParams(window.location.search).get('reset') === 'success') {
        note.hidden = false;
    }
}

// --------------------------------------------
// Error banner
// --------------------------------------------
function showLoginError(message) {
    const el = document.getElementById('loginError');
    if (!el) return;

    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message || 'Something went wrong. Please try again.');
    el.replaceChildren(icon, text);
    el.hidden = false;
}

function hideLoginError() {
    const el = document.getElementById('loginError');
    if (el) el.hidden = true;
}

// Shown only alongside the "email not confirmed" error — see
// friendlyAuthError() below and initLoginResend() further down.
function showLoginResendRow(email) {
    const row = document.getElementById('loginResendRow');
    if (row) {
        row.hidden = false;
        row.dataset.email = email;
    }
}

function hideLoginResendRow() {
    const row = document.getElementById('loginResendRow');
    if (row) row.hidden = true;
}

// --------------------------------------------
// Resend confirmation code
// --------------------------------------------
// Shown only when login fails because the account is unconfirmed (see
// friendlyAuthError() below). Sends a fresh code, then hands the visitor
// off to confirm.html to type it in — login.html has nowhere to enter a
// code itself, so resending in place and leaving them here isn't useful.
function initLoginResend() {
    const btn = document.getElementById('loginResendBtn');
    if (!btn) return;

    btn.addEventListener('click', async function () {
        if (btn.disabled) return;

        const row = document.getElementById('loginResendRow');
        const email = row && row.dataset.email;
        if (!email) return;

        btn.disabled = true;

        const { error } = await supabaseClient.auth.resend({ type: 'signup', email: email });

        if (error && !/rate limit/i.test(error.message || '')) {
            showLoginError(error.message || 'Could not resend the confirmation email. Please try again.');
            btn.disabled = false;
            return;
        }

        const params = new URLSearchParams();
        params.set('email', email);
        const redirect = getRedirectParam();
        if (redirect) params.set('redirect', encodeURIComponent(redirect));

        window.location.href = 'confirm.html?' + params.toString();
    });
}

// --------------------------------------------
// Supabase's raw error messages are written for developers, not
// visitors — map the common ones to friendlier copy and fall back to
// the raw message for anything unexpected.
// --------------------------------------------
function friendlyAuthError(error) {
    const msg = (error && error.message) || 'Something went wrong. Please try again.';
    if (/invalid login credentials/i.test(msg)) {
        return 'Incorrect email or password. Please try again.';
    }
    if (/email not confirmed/i.test(msg)) {
        return 'Please confirm your email address before logging in — check your inbox for the confirmation code.';
    }
    return msg;
}

// --------------------------------------------
// Form submission
// --------------------------------------------
function initLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    // Enter on the email field moves to password instead of submitting early.
    emailInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            passwordInput.focus();
        }
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideLoginError();
        hideLoginResendRow();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showLoginError('Please enter both your email and password.');
            return;
        }
        if (!isValidEmail(email)) {
            showLoginError('Please enter a valid email address.');
            return;
        }

        // Must be set BEFORE signInWithPassword() — supabase.js's storage
        // adapter reads this flag at the moment the new session is written,
        // to decide whether it goes to localStorage (remembered, survives a
        // browser restart) or sessionStorage (cleared when the browser/tab
        // closes).
        const rememberMeInput = document.getElementById('rememberMe');
        localStorage.setItem('toughcuts_remember', rememberMeInput && rememberMeInput.checked ? 'true' : 'false');

        submitBtn.disabled = true;
        submitText.textContent = 'Logging In...';
        spinner.hidden = false;

        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            submitBtn.disabled = false;
            submitText.textContent = 'Log In';
            spinner.hidden = true;
            showLoginError(friendlyAuthError(error));
            if (/email not confirmed/i.test(error.message || '')) {
                showLoginResendRow(email);
            }
            return;
        }

        // onAuthStateChange (in main.js) picks this session up automatically;
        // no need to store anything ourselves. "Remember me" isn't wired to
        // anything special here — Supabase's session is persisted in
        // localStorage by default, so every login already survives a
        // browser restart. (See the note at the bottom of this file if you
        // want signed-out-on-close behavior instead.)
        const redirect = getRedirectParam();
        window.location.href = redirect || '../index.html';
    });
}

// --------------------------------------------
// Note on "Remember me"
// --------------------------------------------
// Checking the box persists the session to localStorage (survives a
// browser restart); unchecking it persists to sessionStorage instead
// (cleared when the browser/tab closes). The actual storage routing lives
// in supabase.js's dynamicAuthStorage adapter — this file's only job is
// setting the toughcuts_remember flag right before signInWithPassword()
// runs, above.
//
// One trade-off worth knowing: sessionStorage is per-tab, so with
// "Remember me" unchecked, opening the site in a second tab won't carry
// the session over — the visitor will appear logged out there even
// though the original tab is still signed in. That's expected for a
// session-only login, not a bug.