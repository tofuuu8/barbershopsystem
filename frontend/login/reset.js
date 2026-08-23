// ============================================
// RESET PASSWORD PAGE
// ============================================
// Relies on the short-lived "recovery" session that recovery.js's
// verifyOtp() call created — supabase.auth.updateUser({ password }) uses
// whatever session is currently active, so this only works as a direct
// continuation of the forgot -> recovery chain (or within Supabase's
// recovery-link expiry window if you also keep the email's link).
//
// After a successful reset we deliberately sign the visitor back out
// before redirecting to login.html?reset=success — otherwise login.js
// would see an active session and skip straight past the form/success
// banner, which isn't what "reset your password, now log in with it"
// is supposed to feel like.
//
// getRedirectParam() / passwordMeetsRequirements() / initPasswordChecklist()
// / initPasswordToggles() live in main.js, shared with signup.js and
// every other auth page. Password visibility toggles on this page are
// wired centrally by main.js's initPasswordToggles() — no need to redo
// that here.

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        // No recovery session — either they landed here directly, or the
        // code/link expired. Send them back to start the flow over rather
        // than showing a form that will just fail on submit.
        showNoSessionState();
        return;
    }

    initResetPasswordChecklist();
    initResetForm();
});

function showNoSessionState() {
    const form = document.getElementById('resetForm');
    if (form) form.hidden = true;
    showResetError('This reset link has expired or was already used. Please request a new code.');
    const errorEl = document.getElementById('resetError');
    if (errorEl) {
        errorEl.innerHTML += ' <a href="forgot.html" style="color:inherit;text-decoration:underline;">Start over</a>';
    }
}

function initResetPasswordChecklist() {
    initPasswordChecklist(
        document.getElementById('newPassword'),
        document.getElementById('resetPasswordChecklist')
    );
}

function showResetError(message) {
    const el = document.getElementById('resetError');
    if (!el) return;

    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message || 'Something went wrong. Please try again.');
    el.replaceChildren(icon, text);
    el.hidden = false;
}

function hideResetError() {
    const el = document.getElementById('resetError');
    if (el) el.hidden = true;
}

function initResetForm() {
    const form = document.getElementById('resetForm');
    if (!form) return;

    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const submitBtn = document.getElementById('resetSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    newPasswordInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmPasswordInput.focus();
        }
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideResetError();

        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!newPassword || !confirmPassword) {
            showResetError('Please fill in both fields.');
            return;
        }
        if (!passwordMeetsRequirements(newPassword)) {
            showResetError('Password must be at least 8 characters and include a letter, a number, and one of ! $ @ %.');
            return;
        }
        if (newPassword !== confirmPassword) {
            showResetError('Passwords do not match.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Resetting...';
        spinner.hidden = false;

        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

        if (error) {
            submitBtn.disabled = false;
            submitText.textContent = 'Reset Password';
            spinner.hidden = true;
            showResetError(error.message || 'Something went wrong. Please try again.');
            return;
        }

        // See file header — sign out of the temporary recovery session so
        // login.html shows the form + success banner instead of bouncing
        // straight past them.
        await supabaseClient.auth.signOut();

        const params = new URLSearchParams();
        params.set('reset', 'success');
        const redirect = getRedirectParam();
        if (redirect) params.set('redirect', encodeURIComponent(redirect));

        window.location.href = 'login.html?' + params.toString();
    });
}