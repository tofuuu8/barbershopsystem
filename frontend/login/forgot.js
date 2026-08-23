// ============================================
// FORGOT PASSWORD PAGE
// ============================================
// Kicks off Supabase's password recovery flow: resetPasswordForEmail()
// sends an email containing an 8-digit code (NOT the default magic link —
// see the setup note below), then this chains the visitor to
// recovery.html to enter it, carrying their email (for display) and any
// ?redirect= they arrived with so the original destination survives the
// whole recovery chain.
//
// getRedirectParam() / isValidEmail() live in main.js, shared with every
// other auth page.
//
// ------------------------------------------------------------------
// REQUIRED SUPABASE DASHBOARD SETUP for the code (not link) to work:
// Authentication -> Email Templates -> "Reset Password" -> change the
// body so it renders {{ .Token }} (the 8-digit OTP) instead of / in
// addition to {{ .ConfirmationURL }}. See the project README / chat
// notes for the exact snippet.
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
    initForgotForm();
});

function showForgotError(message) {
    const el = document.getElementById('forgotError');
    if (!el) return;

    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message || 'Something went wrong. Please try again.');
    el.replaceChildren(icon, text);
    el.hidden = false;
}

function hideForgotError() {
    const el = document.getElementById('forgotError');
    if (el) el.hidden = true;
}

function initForgotForm() {
    const form = document.getElementById('forgotForm');
    if (!form) return;

    const emailInput = document.getElementById('forgotEmail');
    const submitBtn = document.getElementById('forgotSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideForgotError();

        const email = emailInput.value.trim();

        if (!email) {
            showForgotError('Please enter your email address.');
            return;
        }
        if (!isValidEmail(email)) {
            showForgotError('Please enter a valid email address.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Sending Code...';
        spinner.hidden = false;

        const { error } = await supabaseClient.auth.resetPasswordForEmail(email);

        // Deliberately don't reveal whether the email exists — Supabase
        // returns success either way to avoid leaking which addresses have
        // accounts, so we forward to recovery.html regardless. A genuine
        // error here (network/rate-limit) is the only thing we surface.
        if (error && !/rate limit/i.test(error.message || '')) {
            submitBtn.disabled = false;
            submitText.textContent = 'Send Reset Code';
            spinner.hidden = true;
            showForgotError(error.message || 'Something went wrong. Please try again.');
            return;
        }
        if (error) {
            submitBtn.disabled = false;
            submitText.textContent = 'Send Reset Code';
            spinner.hidden = true;
            showForgotError('Too many requests — please wait a bit before trying again.');
            return;
        }

        const params = new URLSearchParams();
        params.set('email', email);
        const redirect = getRedirectParam();
        if (redirect) params.set('redirect', encodeURIComponent(redirect));

        window.location.href = 'recovery.html?' + params.toString();
    });
}