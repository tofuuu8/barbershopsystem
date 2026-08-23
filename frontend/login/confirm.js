// ============================================
// CONFIRM EMAIL PAGE
// ============================================
// Verifies the 8-digit code from signup.js's supabaseClient.auth.signUp()
// confirmation email via supabase.auth.verifyOtp({ type: 'signup' }). A
// successful verification signs the visitor straight into a real session
// — unlike the password-recovery chain (reset.js deliberately signs back
// out after resetting), there's no reason to make someone log in again
// right after finishing signup, so this redirects on to ?redirect= or the
// homepage, same as an instant (email-confirmation-off) signup would.
//
// getRedirectParam() lives in main.js, shared with every other auth page.
//
// ------------------------------------------------------------------
// REQUIRED SUPABASE DASHBOARD SETUP for the code (not link) to work:
// Authentication -> Email Templates -> "Confirm signup" -> change the
// body so it renders {{ .Token }} (the 8-digit OTP) instead of / in
// addition to {{ .ConfirmationURL }}. Also make sure Authentication ->
// Providers -> Email -> "Confirm email" is turned ON, or signUp() will
// return an active session immediately and nobody will land here at all.
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async function () {
    // If someone who's already fully signed in (e.g. already confirmed,
    // came back via browser back button) lands here, just send them on
    // instead of showing a form that has nothing left to verify.
    await authReadyPromise;
    if (isLoggedIn()) {
        window.location.href = getRedirectParam() || '../index.html';
        return;
    }

    initConfirmSubtitle();
    initConfirmForm();
    initResendButton();
});

function getQueryParams() {
    return new URLSearchParams(window.location.search);
}

// Shows which email the code was "sent to" when we know it (arrived via
// signup.html). Falls back to the generic copy already in the markup if
// someone lands here directly without an email in the URL.
function initConfirmSubtitle() {
    const email = getQueryParams().get('email');
    const subtitle = document.getElementById('confirmSubtitle');
    if (email && subtitle) {
        subtitle.textContent = `We sent an 8-digit code to ${email}. Enter it below to activate your account.`;
    }
}

function showConfirmError(message) {
    const el = document.getElementById('confirmError');
    if (!el) return;

    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message || 'Something went wrong. Please try again.');
    el.replaceChildren(icon, text);
    el.hidden = false;
}

function hideConfirmError() {
    const el = document.getElementById('confirmError');
    if (el) el.hidden = true;
}

function initConfirmForm() {
    const form = document.getElementById('confirmForm');
    if (!form) return;

    const codeInput = document.getElementById('confirmCode');
    const submitBtn = document.getElementById('confirmSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    // Digits only, so a pasted code with spaces/dashes still works.
    codeInput.addEventListener('input', function () {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 8);
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideConfirmError();

        const email = getQueryParams().get('email');
        const code = codeInput.value.trim();

        if (!email) {
            showConfirmError('We lost track of which email this code was for — please sign up again.');
            return;
        }
        if (!code) {
            showConfirmError('Please enter the code we sent you.');
            return;
        }
        // The code is always exactly 8 digits (see codeInput's maxlength
        // and the digit-only filter above) — reject anything shorter
        // locally instead of round-tripping a doomed request to Supabase.
        if (code.length !== 8) {
            showConfirmError('That code should be 8 digits — double-check and try again.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Confirming...';
        spinner.hidden = false;

        const { error } = await supabaseClient.auth.verifyOtp({
            email: email,
            token: code,
            type: 'signup'
        });

        if (error) {
            submitBtn.disabled = false;
            submitText.textContent = 'Confirm Account';
            spinner.hidden = true;
            showConfirmError(
                /expired|invalid/i.test(error.message || '')
                    ? 'That code is invalid or has expired. Request a new one below.'
                    : (error.message || 'Something went wrong. Please try again.')
            );
            return;
        }

        // verifyOtp() just created a real, signed-in session — the account
        // is fully active now, so carry the visitor straight on rather
        // than making them log in a second time.
        const redirect = getRedirectParam();
        window.location.href = redirect || '../index.html';
    });
}

// Re-sends the confirmation code — same supabase.auth.resend() call
// login.js's "email not confirmed" resend row uses, just triggerable from
// this page without losing the entered email.
function initResendButton() {
    const btn = document.getElementById('confirmResendBtn');
    const note = document.getElementById('confirmResentNote');
    if (!btn) return;

    btn.addEventListener('click', async function () {
        if (btn.disabled) return;

        const email = getQueryParams().get('email');
        if (!email) return;

        btn.disabled = true;
        const originalLabel = 'Resend code';

        const { error } = await supabaseClient.auth.resend({ type: 'signup', email: email });

        if (error && !/rate limit/i.test(error.message || '')) {
            showConfirmError(error.message || 'Could not resend the code. Please try again.');
            btn.disabled = false;
            return;
        }

        if (note) note.hidden = false;

        let secondsLeft = 30;
        btn.textContent = `Resend in ${secondsLeft}s`;

        const interval = setInterval(function () {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
                clearInterval(interval);
                btn.disabled = false;
                btn.textContent = originalLabel;
            } else {
                btn.textContent = `Resend in ${secondsLeft}s`;
            }
        }, 1000);
    });
}