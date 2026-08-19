// ============================================
// SIGNUP PAGE
// ============================================
// Backed by Supabase Auth. supabaseClient (from js/supabase.js)
// and currentSupabaseUser/authReadyPromise/isLoggedIn() etc. (from
// js/main.js) are both loaded before this file.
//
// getRedirectParam() / isValidEmail() / passwordMeetsRequirements() /
// initPasswordChecklist() / initPasswordToggles() all live in main.js,
// shared with login.js / reset.js / forgot.js / recovery.js.
//
// NOTE on email confirmation: whether supabase.auth.signUp() logs the
// visitor straight in or not depends on a project setting — Supabase
// Dashboard -> Authentication -> Providers -> Email -> "Confirm email".
//   - OFF: signUp() returns an active session immediately, same feel as
//     the old localStorage version of this page (create account -> signed in).
//   - ON (the default for new projects): signUp() returns a user but no
//     session until they click the link in the confirmation email. This
//     file handles both cases below.

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (isLoggedIn()) {
        window.location.href = getRedirectParam() || '../index.html';
        return;
    }

    initSignupRedirectNote();
    initSignupPasswordChecklist();
    initSignupForm();
});

// --------------------------------------------
// Redirect note
// --------------------------------------------
function initSignupRedirectNote() {
    const note = document.getElementById('signupRedirectNote');
    if (!note) return;
    if (getRedirectParam()) note.hidden = false;
}

// --------------------------------------------
// Live password requirements checklist
// --------------------------------------------
function initSignupPasswordChecklist() {
    initPasswordChecklist(
        document.getElementById('signupPassword'),
        document.getElementById('signupPasswordChecklist')
    );
}

// --------------------------------------------
// Error banner
// --------------------------------------------
function showSignupError(message) {
    const el = document.getElementById('signupError');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${message}</span>`;
    el.hidden = false;
}

function hideSignupError() {
    const el = document.getElementById('signupError');
    if (el) el.hidden = true;
}

function friendlyAuthError(error) {
    const msg = (error && error.message) || 'Something went wrong. Please try again.';
    if (/already registered|already exists|user already registered/i.test(msg)) {
        return 'An account with that email already exists. Try logging in instead.';
    }
    if (/password should be at least/i.test(msg)) {
        return 'Password must be at least 6 characters and include a letter, a number, and one of ! $ @ %.';
    }
    return msg;
}

// Shown instead of redirecting when the project requires email
// confirmation (signUp() succeeded but returned no session).
function showCheckEmailState(email) {
    const form = document.getElementById('signupForm');
    const divider = document.querySelector('.login-divider');
    const note = document.getElementById('signupCheckEmailNote');
    if (form) form.hidden = true;
    if (divider) divider.hidden = true;
    if (note) {
        note.querySelector('[data-email-slot]').textContent = email;
        note.hidden = false;
    }
}

// --------------------------------------------
// Form submission
// --------------------------------------------
function initSignupForm() {
    const form = document.getElementById('signupForm');
    if (!form) return;

    const nameInput = document.getElementById('signupName');
    const emailInput = document.getElementById('signupEmail');
    const passwordInput = document.getElementById('signupPassword');
    const confirmInput = document.getElementById('signupConfirm');
    const termsInput = document.getElementById('signupTerms');
    const submitBtn = document.getElementById('signupSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    // Enter key moves field-to-field instead of submitting early.
    const fields = [nameInput, emailInput, passwordInput, confirmInput];
    fields.forEach(function (field, index) {
        field.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && index < fields.length - 1) {
                e.preventDefault();
                fields[index + 1].focus();
            }
        });
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideSignupError();

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirm = confirmInput.value;

        if (!name || !email || !password || !confirm) {
            showSignupError('Please fill in all fields.');
            return;
        }
        if (!isValidEmail(email)) {
            showSignupError('Please enter a valid email address.');
            return;
        }
        // Checked before the password-strength rules below so a visitor
        // who simply forgot the checkbox isn't stuck re-reading password
        // errors first — the checklist already gives live feedback on
        // those as they type.
        if (!termsInput || !termsInput.checked) {
            showSignupError('Please agree to the Terms of Service and Privacy Policy.');
            return;
        }
        if (!passwordMeetsRequirements(password)) {
            showSignupError('Password must be at least 6 characters and include a letter, a number, and one of ! $ @ %.');
            return;
        }
        if (password !== confirm) {
            showSignupError('Passwords do not match.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Creating Account...';
        spinner.hidden = false;

        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                // Stored as user_metadata — readable via
                // getCurrentUser().user_metadata.name anywhere on the site.
                data: { name: name }
            }
        });

        if (error) {
            submitBtn.disabled = false;
            submitText.textContent = 'Create Account';
            spinner.hidden = true;
            showSignupError(friendlyAuthError(error));
            return;
        }

        if (data.session) {
            // Email confirmation is OFF for this project — signed in
            // immediately, same feel as the old localStorage version.
            const redirect = getRedirectParam();
            window.location.href = redirect || '../index.html';
            return;
        }

        // Email confirmation is ON — account was created but there's no
        // session yet. Show a "check your email" state instead of an error.
        submitBtn.disabled = false;
        submitText.textContent = 'Create Account';
        spinner.hidden = true;
        showCheckEmailState(email);
    });
}