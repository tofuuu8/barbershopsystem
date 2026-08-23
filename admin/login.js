// ============================================================
// ADMIN LOGIN
// ============================================================
// Same Supabase Auth accounts as the customer site — an admin is just
// a profiles row with is_admin = true, not a separate user pool. The
// separation from the customer login is purely about entry point and
// what happens after sign-in: a successful signInWithPassword() here
// still gets rejected (and signed back out) if is_admin isn't true.

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    // Already signed in as a confirmed admin? Skip the form.
    if (isLoggedIn() && await isAdmin()) {
        window.location.href = 'users.html';
        return;
    }
    // Signed in but NOT an admin (e.g. a customer account, or a stale
    // session from before this project had admins) — don't leave them
    // silently logged in on the admin origin.
    if (isLoggedIn()) {
        await supabaseClient.auth.signOut();
    }

    initDeniedNotice();
    initAdminLoginForm();
});

function initDeniedNotice() {
    const notice = document.getElementById('deniedNotice');
    if (notice && new URLSearchParams(window.location.search).get('denied') === '1') {
        notice.hidden = false;
    }
}

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

function initAdminLoginForm() {
    const form = document.getElementById('adminLoginForm');
    if (!form) return;

    const emailInput = document.getElementById('adminEmail');
    const passwordInput = document.getElementById('adminPassword');
    const btn = document.getElementById('adminLoginBtn');
    const btnText = document.getElementById('adminLoginBtnText');
    const spinner = document.getElementById('adminLoginSpinner');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideLoginError();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showLoginError('Please enter both your email and password.');
            return;
        }

        btn.disabled = true;
        btnText.textContent = 'Logging In...';
        spinner.hidden = false;

        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            btn.disabled = false;
            btnText.textContent = 'Log In';
            spinner.hidden = true;
            showLoginError(
                /invalid login credentials/i.test(error.message || '')
                    ? 'Incorrect email or password.'
                    : (error.message || 'Something went wrong. Please try again.')
            );
            return;
        }

        // Signed in successfully — but that only proves they have a
        // Toughcuts account, not that they're staff. Check is_admin
        // before letting them anywhere near the dashboard.
        const admin = await isAdmin();
        if (!admin) {
            await supabaseClient.auth.signOut();
            btn.disabled = false;
            btnText.textContent = 'Log In';
            spinner.hidden = true;
            showLoginError('That account doesn\u2019t have admin access.');
            return;
        }

        window.location.href = 'users.html';
    });
}