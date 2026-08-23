// ============================================
// ACCOUNT / PROFILE SETTINGS PAGE
// ============================================
// Reads and writes the `profiles` table in Supabase
// (id uuid -> auth.users.id, full_name text, email text, phone text,
// address text, created_at timestamptz, updated_at timestamptz).
//
// ------------------------------------------------------------------
// REQUIRED SUPABASE SETUP — add the phone/address columns if this
// table was created before they existed. Run once in the Supabase
// SQL editor:
//
//   alter table public.profiles
//     add column if not exists phone text,
//     add column if not exists address text;
// ------------------------------------------------------------------
//
// isLoggedIn() / getCurrentUser() / authReadyPromise / logOut() /
// getAvatarInitial() / passwordMeetsRequirements() / initPasswordChecklist()
// / initPasswordToggles() all live in ../js/main.js, shared with every
// other auth page — this file only adds what's specific to the profile
// itself.
//
// ------------------------------------------------------------------
// REQUIRED SUPABASE SETUP — Row Level Security on `profiles`:
// Without these policies every read/write below will silently return
// nothing (select) or fail outright (insert/update). Run once in the
// Supabase SQL editor:
//
//   alter table public.profiles enable row level security;
//
//   create policy "Users can view own profile"
//     on public.profiles for select
//     using (auth.uid() = id);
//
//   create policy "Users can insert own profile"
//     on public.profiles for insert
//     with check (auth.uid() = id);
//
//   create policy "Users can update own profile"
//     on public.profiles for update
//     using (auth.uid() = id);
// ------------------------------------------------------------------

let currentProfile = null;

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showAccountGate();
        return;
    }

    showAccountPage();
    setAccountLoading(true);
    await loadProfile();
    setAccountLoading(false);
    initEditNameForm();
    initPasswordChangeForm();
    initLogoutButton();
});

// --------------------------------------------
// Gate / page visibility
// --------------------------------------------
function showAccountGate() {
    const gate = document.getElementById('accountGate');
    const page = document.getElementById('accountPage');
    if (gate) gate.hidden = false;
    if (page) page.hidden = true;
}

function showAccountPage() {
    const gate = document.getElementById('accountGate');
    const page = document.getElementById('accountPage');
    if (gate) gate.hidden = true;
    if (page) page.hidden = false;
}

// Toggles a skeleton/shimmer state on the summary card + settings forms
// while loadProfile() is in flight, instead of showing blank/placeholder
// fields for a beat on slower connections.
function setAccountLoading(isLoading) {
    const summary = document.getElementById('accountSummary');
    const settings = document.getElementById('accountSettingsGrid');
    if (summary) summary.classList.toggle('is-loading', isLoading);
    if (settings) settings.classList.toggle('is-loading', isLoading);
}

// --------------------------------------------
// Load the profile row, creating it on first visit if it doesn't
// exist yet (accounts created before this page existed, or before a
// database trigger is set up, won't have one).
// --------------------------------------------
async function loadProfile() {
    const user = getCurrentUser();
    if (!user) return;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (error) {
        showProfileError('Could not load your profile. Please refresh and try again.');
        console.error(error);
        return;
    }

    if (data) {
        currentProfile = data;
    } else {
        const { data: created, error: insertError } = await supabaseClient
            .from('profiles')
            .insert({
                id: user.id,
                full_name: (user.user_metadata && user.user_metadata.name) || '',
                email: user.email,
                phone: '',
                address: '',
                // Captured by signup.js at signUp() time and stored in auth
                // user_metadata (no profiles row exists yet at that point if
                // email confirmation is required). Copied in here the first
                // time this profile is created. Falls back to null for
                // accounts created before this existed.
                terms_accepted_at: (user.user_metadata && user.user_metadata.terms_accepted_at) || null
            })
            .select()
            .single();

        if (insertError) {
            showProfileError('Could not set up your profile. Please refresh and try again.');
            console.error(insertError);
            return;
        }
        currentProfile = created;
    }

    renderProfile();
}

function renderProfile() {
    const user = getCurrentUser();
    if (!currentProfile || !user) return;

    const avatarEl = document.getElementById('accountAvatarLarge');
    if (avatarEl) avatarEl.textContent = getAvatarInitial(user);

    const nameEl = document.getElementById('accountDisplayName');
    if (nameEl) nameEl.textContent = currentProfile.full_name || 'Add your name';

    const emailEl = document.getElementById('accountDisplayEmail');
    if (emailEl) emailEl.textContent = currentProfile.email || user.email;

    const staticEmailEl = document.getElementById('accountEmailStatic');
    if (staticEmailEl) staticEmailEl.textContent = currentProfile.email || user.email;

    const memberSinceEl = document.getElementById('accountMemberSince');
    if (memberSinceEl) {
        const joined = currentProfile.created_at || user.created_at;
        memberSinceEl.textContent = joined
            ? 'Member since ' + new Date(joined).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
            : '';
    }

    const nameInput = document.getElementById('accountNameInput');
    if (nameInput) nameInput.value = currentProfile.full_name || '';

    const phoneInput = document.getElementById('accountPhoneInput');
    if (phoneInput) phoneInput.value = currentProfile.phone || '';

    const addressInput = document.getElementById('accountAddressInput');
    if (addressInput) addressInput.value = currentProfile.address || '';
}

// --------------------------------------------
// Inline banners — separate pairs for the profile card and the
// password card so a message in one doesn't get lost under the other.
// --------------------------------------------
function showBanner(errorId, successId, message, isError) {
    const errorEl = document.getElementById(errorId);
    const successEl = document.getElementById(successId);
    if (isError) {
        if (successEl) successEl.hidden = true;
        if (errorEl) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-circle-exclamation';
            icon.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span');
            text.textContent = String(message || 'Something went wrong. Please try again.');
            errorEl.replaceChildren(icon, text);
            errorEl.hidden = false;
        }
    } else {
        if (errorEl) errorEl.hidden = true;
        if (successEl) {
            successEl.querySelector('span').textContent = message;
            successEl.hidden = false;
        }
    }
}

function hideBanners(errorId, successId) {
    const errorEl = document.getElementById(errorId);
    const successEl = document.getElementById(successId);
    if (errorEl) errorEl.hidden = true;
    if (successEl) successEl.hidden = true;
}

function showProfileError(message) { showBanner('accountProfileError', 'accountProfileSuccess', message, true); }
function showProfileSuccess(message) { showBanner('accountProfileError', 'accountProfileSuccess', message, false); }
function showPasswordError(message) { showBanner('accountPasswordError', 'accountPasswordSuccess', message, true); }
function showPasswordSuccess(message) { showBanner('accountPasswordError', 'accountPasswordSuccess', message, false); }

// --------------------------------------------
// Edit name form
// --------------------------------------------
function initEditNameForm() {
    const form = document.getElementById('accountNameForm');
    if (!form) return;

    const nameInput = document.getElementById('accountNameInput');
    const phoneInput = document.getElementById('accountPhoneInput');
    const addressInput = document.getElementById('accountAddressInput');
    const submitBtn = document.getElementById('accountNameSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideBanners('accountProfileError', 'accountProfileSuccess');

        const name = nameInput.value.trim();
        // Phone and address are optional — not every visitor wants to
        // store them, and nothing else on the site depends on them yet.
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const address = addressInput ? addressInput.value.trim() : '';

        if (!name) {
            showProfileError('Please enter your name.');
            return;
        }
        // Loose on purpose — PH numbers, landlines, and +country formats
        // all vary — this just catches obvious garbage, not a strict format.
        if (phone && !/^[0-9+()\-.\s]{7,20}$/.test(phone)) {
            showProfileError('Please enter a valid phone number.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Saving...';
        spinner.hidden = false;

        const user = getCurrentUser();

        // Keep the profiles table and the auth user's metadata in sync.
        // Updating the auth user fires a USER_UPDATED event that main.js
        // listens for, which re-runs updateAuthUI() — so the header
        // avatar's initial updates immediately, without a page reload.
        // Phone/address only live in the profiles table — auth metadata
        // just tracks the name, same as before. `updated_at` is no longer
        // set here — the profiles_set_updated_at trigger (see
        // profiles_hardening.sql) stamps it server-side on every update.
        const [profileResult, userResult] = await Promise.all([
            supabaseClient
                .from('profiles')
                .update({ full_name: name, phone: phone, address: address })
                .eq('id', user.id),
            supabaseClient.auth.updateUser({ data: { name: name } })
        ]);

        submitBtn.disabled = false;
        submitText.textContent = 'Save Changes';
        spinner.hidden = true;

        const tableError = profileResult.error;
        const userError = userResult.error;

        // Report each half of the save independently — with the old
        // Promise.all([...]).error-or-error check, a table failure next to
        // a successful auth update (or vice versa) would show a generic
        // "could not save" message while actually leaving the two records
        // out of sync, with no way to tell which part didn't take.
        if (tableError && userError) {
            showProfileError('Could not save your changes. Please try again.');
            return;
        }
        if (tableError) {
            currentProfile.full_name = name;
            renderProfile();
            showProfileError('Your name was updated, but your phone/address could not be saved. Please try again.');
            return;
        }

        currentProfile.full_name = name;
        currentProfile.phone = phone;
        currentProfile.address = address;
        renderProfile();

        if (userError) {
            // Table saved fine; the auth metadata copy of the name (used
            // for the header avatar initial) didn't. Not worth blocking
            // the user over — it'll catch up next time they save.
            showProfileSuccess('Your profile has been updated.');
            return;
        }

        showProfileSuccess('Your profile has been updated.');
    });
}

// --------------------------------------------
// Change password form
// --------------------------------------------
function initPasswordChangeForm() {
    const form = document.getElementById('accountPasswordForm');
    if (!form) return;

    const currentInput = document.getElementById('accountCurrentPassword');
    const newInput = document.getElementById('accountNewPassword');
    const confirmInput = document.getElementById('accountConfirmPassword');
    const checklist = document.getElementById('accountPasswordChecklist');
    const submitBtn = document.getElementById('accountPasswordSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    initPasswordChecklist(newInput, checklist);

    newInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmInput.focus();
        }
    });

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideBanners('accountPasswordError', 'accountPasswordSuccess');

        const currentPassword = currentInput.value;
        const newPassword = newInput.value;
        const confirmPassword = confirmInput.value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            showPasswordError('Please fill in all three fields.');
            return;
        }
        if (!passwordMeetsRequirements(newPassword)) {
            showPasswordError('New password must be at least 8 characters and include a letter, a number, and one of ! $ @ %.');
            return;
        }
        if (newPassword !== confirmPassword) {
            showPasswordError('New passwords do not match.');
            return;
        }

        submitBtn.disabled = true;
        submitText.textContent = 'Updating...';
        spinner.hidden = false;

        const user = getCurrentUser();

        // Supabase's updateUser() doesn't ask for the old password itself —
        // re-authenticate with it first so "change password" genuinely
        // requires knowing the current one.
        const { error: reauthError } = await supabaseClient.auth.signInWithPassword({
            email: user.email,
            password: currentPassword
        });

        if (reauthError) {
            submitBtn.disabled = false;
            submitText.textContent = 'Update Password';
            spinner.hidden = true;
            showPasswordError('Your current password is incorrect.');
            return;
        }

        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

        submitBtn.disabled = false;
        submitText.textContent = 'Update Password';
        spinner.hidden = true;

        if (error) {
            showPasswordError(error.message || 'Could not update your password. Please try again.');
            return;
        }

        form.reset();
        initPasswordChecklist(newInput, checklist); // reset the checklist back to its empty state
        showPasswordSuccess('Your password has been updated.');
    });
}

// --------------------------------------------
// Log out
// --------------------------------------------
function initLogoutButton() {
    const btn = document.getElementById('accountLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        logOut();
    });
}