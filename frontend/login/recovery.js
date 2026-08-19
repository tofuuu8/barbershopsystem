// ============================================
// RECOVERY CODE PAGE
// ============================================
// Verifies the 8-digit code from forgot.js's resetPasswordForEmail()
// email via supabase.auth.verifyOtp(). A successful verification signs
// the visitor into a short-lived "recovery" session — reset.js relies on
// that session existing to call updateUser({ password }), so don't clear
// it between here and there.
//
// getRedirectParam() lives in main.js, shared with every other auth page.

document.addEventListener('DOMContentLoaded', function () {
    initRecoverySubtitle();
    initRecoveryForm();
    initResendButton();
});

function getQueryParams() {
    return new URLSearchParams(window.location.search);
}

// Shows which email the code was "sent to" when we know it (arrived via
// forgot.html). Falls back to the generic copy already in the markup
// if someone lands here directly without an email in the URL.
function initRecoverySubtitle() {
    const email = getQueryParams().get('email');
    const subtitle = document.getElementById('recoverySubtitle');
    if (email && subtitle) {
        subtitle.textContent = `We sent an 8-digit code to ${email}. Enter it below to continue.`;
    }
}

function showRecoveryError(message) {
    const el = document.getElementById('recoveryError');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${message}</span>`;
    el.hidden = false;
}

function hideRecoveryError() {
    const el = document.getElementById('recoveryError');
    if (el) el.hidden = true;
}

function buildForwardParams() {
    const params = new URLSearchParams();
    const email = getQueryParams().get('email');
    if (email) params.set('email', email);
    const redirect = getRedirectParam();
    if (redirect) params.set('redirect', encodeURIComponent(redirect));
    return params;
}

function initRecoveryForm() {
    const form = document.getElementById('recoveryForm');
    if (!form) return;

    const codeInput = document.getElementById('recoveryCode');
    const submitBtn = document.getElementById('recoverySubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    // Digits only, so a pasted code with spaces/dashes still works.
    codeInput.addEventListener('input', function () {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 8);
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideRecoveryError();

        const email = getQueryParams().get('email');
        const code = codeInput.value.trim();

        if (!email) {
            showRecoveryError('We lost track of which email this code was for — please start over.');
            return;
        }
        if (!code) {
            showRecoveryError('Please enter the code we sent you.');
            return;
        }
        if (code.length < 4) {
            showRecoveryError('That code looks too short — double-check and try again.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Verifying...';
        spinner.hidden = false;

        const { error } = await supabaseClient.auth.verifyOtp({
            email: email,
            token: code,
            type: 'recovery'
        });

        if (error) {
            submitBtn.disabled = false;
            submitText.textContent = 'Verify Code';
            spinner.hidden = true;
            showRecoveryError(
                /expired|invalid/i.test(error.message || '')
                    ? 'That code is invalid or has expired. Request a new one below.'
                    : (error.message || 'Something went wrong. Please try again.')
            );
            return;
        }

        // verifyOtp() just created a real (recovery) session — reset.html
        // relies on it being present to call updateUser({ password }).
        window.location.href = 'reset.html?' + buildForwardParams().toString();
    });
}

// Re-sends the code — same resetPasswordForEmail() call as forgot.js,
// just triggerable from this page without losing the entered email.
function initResendButton() {
    const btn = document.getElementById('recoveryResendBtn');
    const note = document.getElementById('recoveryResentNote');
    if (!btn) return;

    btn.addEventListener('click', async function () {
        if (btn.disabled) return;

        const email = getQueryParams().get('email');
        if (!email) return;

        btn.disabled = true;
        const originalLabel = 'Resend code';

        const { error } = await supabaseClient.auth.resetPasswordForEmail(email);

        if (error && !/rate limit/i.test(error.message || '')) {
            showRecoveryError(error.message || 'Could not resend the code. Please try again.');
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