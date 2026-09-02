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
let cachedBarbers = [];

document.addEventListener('DOMContentLoaded', async function () {
    await authReadyPromise;

    if (!isLoggedIn()) {
        showAccountGate();
        return;
    }

    showAccountPage();
    setAccountLoading(true);
    await loadProfile();
    await loadBarberOptions();
    renderProfile();
    setAccountLoading(false);
    initEditNameForm();
    initPasswordChangeForm();
    initLogoutButton();
    initSettingsNav();

    const nameForm = document.getElementById('accountNameForm');
    const nameSubmitBtn = document.getElementById('accountNameSubmitBtn');
    const nameHint = document.getElementById('accountNameUnsavedHint');
    profileFormDirtyTracker = initFormDirtyTracking(nameForm, nameSubmitBtn, nameHint);
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

async function loadBarberOptions() {
    const select = document.getElementById('accountPreferredBarberInput');
    if (!select) return;

    const fallback = [
        { id: 'barber-russel', name: 'Barber Russel' },
        { id: 'klark-dizon', name: 'Barber Klark' },
        { id: 'barber-jon', name: 'Barber Jon' }
    ];
    let barbers = fallback;
    if (typeof supabaseClient !== 'undefined') {
        const { data, error } = await supabaseClient
            .from('barbers')
            .select('id, name')
            .eq('is_active', true)
            .order('name');
        if (!error && data && data.length) barbers = data;
    }
    cachedBarbers = barbers;

    select.innerHTML = '<option value="">No preference</option>' + barbers.map(function (barber) {
        const option = document.createElement('option');
        option.value = barber.id;
        option.textContent = barber.name;
        return option.outerHTML;
    }).join('');
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

    const savedAddressesInput = document.getElementById('accountSavedAddressesInput');
    if (savedAddressesInput) {
        const saved = Array.isArray(currentProfile.saved_addresses) ? currentProfile.saved_addresses : [];
        savedAddressesInput.value = saved.map(function (item) {
            return typeof item === 'string' ? item : (item && item.address) || '';
        }).filter(Boolean).join('\n');
    }

    const preferredBarberInput = document.getElementById('accountPreferredBarberInput');
    if (preferredBarberInput) preferredBarberInput.value = currentProfile.preferred_barber_id || '';

    const fulfillmentInput = document.getElementById('accountFulfillmentInput');
    if (fulfillmentInput) fulfillmentInput.value = currentProfile.default_fulfillment_type === 'delivery' ? 'delivery' : 'pickup';

    const emailNotificationsInput = document.getElementById('accountEmailNotificationsInput');
    if (emailNotificationsInput) emailNotificationsInput.checked = currentProfile.notification_email !== false;
    const smsNotificationsInput = document.getElementById('accountSmsNotificationsInput');
    if (smsNotificationsInput) smsNotificationsInput.checked = currentProfile.notification_sms !== false;
    const marketingInput = document.getElementById('accountMarketingInput');
    if (marketingInput) marketingInput.checked = currentProfile.marketing_opt_in === true;

    // Quick-glance chips on the member card — mirror whatever the form
    // below currently holds, so a returning visitor can see their
    // settings without opening the form. The barber chip only appears
    // once there's an actual preference to show.
    const factBarberEl = document.getElementById('accountFactBarber');
    if (factBarberEl) {
        const barber = cachedBarbers.find(function (b) { return b.id === currentProfile.preferred_barber_id; });
        if (barber) {
            factBarberEl.querySelector('span').textContent = barber.name;
            factBarberEl.hidden = false;
        } else {
            factBarberEl.hidden = true;
        }
    }

    const factFulfillmentEl = document.getElementById('accountFactFulfillment');
    if (factFulfillmentEl) {
        const isDelivery = currentProfile.default_fulfillment_type === 'delivery';
        factFulfillmentEl.querySelector('span').textContent = isDelivery ? 'Delivery' : 'Pickup at Studio';
        const icon = factFulfillmentEl.querySelector('i');
        if (icon) icon.className = isDelivery ? 'fas fa-truck' : 'fas fa-store';
    }
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
            scrollBannerIntoView(errorEl);
        }
    } else {
        if (errorEl) errorEl.hidden = true;
        if (successEl) {
            successEl.querySelector('span').textContent = message;
            successEl.hidden = false;
            scrollBannerIntoView(successEl);
        }
    }
}

// Save buttons sit at the bottom of a fairly long form, but that's not
// guaranteed to be where the visitor is scrolled to when the response
// comes back (e.g. they scrolled down to click Save, but a slow network
// response could land after they've scrolled elsewhere). Bringing the
// banner into view — rather than relying on it already being on
// screen — is what actually guarantees the feedback gets seen.
function scrollBannerIntoView(el) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
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
// Field-level validation. Points directly at the one field that's
// wrong (clay border + inline fix, self-clearing on the next
// keystroke) instead of leaving the visitor to match a banner at the
// top of the page against five stacked cards.
// --------------------------------------------
function setFieldError(input, message) {
    if (!input) return;
    const field = input.closest('.login-field');
    if (!field) return;

    field.classList.add('has-error');

    let msg = field.querySelector('.account-field-error');
    if (!msg) {
        msg = document.createElement('p');
        msg.className = 'account-field-error';
        field.appendChild(msg);
    }
    const icon = document.createElement('i');
    icon.className = 'fas fa-circle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    msg.replaceChildren(icon, text);

    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => input.focus(), 280);

    if (!input.dataset.hasErrorClearListener) {
        input.dataset.hasErrorClearListener = 'true';
        input.addEventListener('input', () => clearFieldError(input));
    }
}

function clearFieldError(input) {
    if (!input) return;
    const field = input.closest('.login-field');
    if (!field) return;
    field.classList.remove('has-error');
    const msg = field.querySelector('.account-field-error');
    if (msg) msg.remove();
}

// --------------------------------------------
// Unsaved-changes tracking for the profile form. Save starts disabled
// (see the HTML) and only lights up once something actually differs
// from the last-loaded/last-saved snapshot — a form with nothing new
// in it shouldn't invite a click. resetBaseline() is called again
// right after a successful save, so Save disables itself once more
// until the next real edit.
// --------------------------------------------
function serializeForm(form) {
    return Array.from(form.elements)
        .filter(el => el.id)
        .map(el => el.type === 'checkbox' ? `${el.id}:${el.checked}` : `${el.id}:${el.value}`)
        .join('|');
}

function initFormDirtyTracking(form, submitBtn, hintEl) {
    if (!form || !submitBtn) return { resetBaseline() {} };

    let baseline = serializeForm(form);

    function check() {
        const dirty = serializeForm(form) !== baseline;
        submitBtn.disabled = !dirty;
        if (hintEl) hintEl.hidden = !dirty;
    }

    form.addEventListener('input', check);
    form.addEventListener('change', check);

    return {
        resetBaseline() {
            baseline = serializeForm(form);
            check();
        }
    };
}

let profileFormDirtyTracker = null;

// --------------------------------------------
// Desktop settings rail — click scrolls to the matching card;
// IntersectionObserver keeps the highlighted link honest about which
// section is actually in view as the visitor scrolls, rather than
// only updating on click.
// --------------------------------------------
function initSettingsNav() {
    const nav = document.getElementById('accountSettingsNav');
    if (!nav) return;

    const links = Array.from(nav.querySelectorAll('.account-settings-nav-link'));
    if (!links.length) return;

    nav.addEventListener('click', function (e) {
        const link = e.target.closest('.account-settings-nav-link');
        if (!link) return;
        e.preventDefault();
        const target = document.getElementById(link.dataset.section);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    if (!('IntersectionObserver' in window)) return;

    const sections = links
        .map(link => document.getElementById(link.dataset.section))
        .filter(Boolean);
    if (!sections.length) return;

    const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            const link = links.find(l => l.dataset.section === entry.target.id);
            if (!link) return;
            links.forEach(l => l.classList.remove('is-active'));
            link.classList.add('is-active');
        });
    }, { rootMargin: '-25% 0px -65% 0px', threshold: 0 });

    sections.forEach(section => observer.observe(section));
}

// --------------------------------------------
// Edit name form
// --------------------------------------------
function initEditNameForm() {
    const form = document.getElementById('accountNameForm');
    if (!form) return;

    const nameInput = document.getElementById('accountNameInput');
    const phoneInput = document.getElementById('accountPhoneInput');
    const addressInput = document.getElementById('accountAddressInput');
    const savedAddressesInput = document.getElementById('accountSavedAddressesInput');
    const preferredBarberInput = document.getElementById('accountPreferredBarberInput');
    const fulfillmentInput = document.getElementById('accountFulfillmentInput');
    const emailNotificationsInput = document.getElementById('accountEmailNotificationsInput');
    const smsNotificationsInput = document.getElementById('accountSmsNotificationsInput');
    const marketingInput = document.getElementById('accountMarketingInput');
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
        const savedAddresses = savedAddressesInput
            ? savedAddressesInput.value.split('\n').map(value => value.trim()).filter(Boolean).slice(0, 5)
            : [];
        if (address && !savedAddresses.includes(address)) savedAddresses.unshift(address);
        const preferredBarberId = preferredBarberInput ? preferredBarberInput.value : '';
        const defaultFulfillmentType = fulfillmentInput && fulfillmentInput.value === 'delivery' ? 'delivery' : 'pickup';

        if (!name) {
            setFieldError(nameInput, 'Enter your name.');
            return;
        }
        // Loose on purpose — PH numbers, landlines, and +country formats
        // all vary — this just catches obvious garbage, not a strict format.
        if (phone && !/^[0-9+()\-.\s]{7,20}$/.test(phone)) {
            setFieldError(phoneInput, 'Enter a valid phone number.');
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
                .update({
                    full_name: name,
                    phone: phone,
                    address: address,
                    preferred_barber_id: preferredBarberId || null,
                    default_fulfillment_type: defaultFulfillmentType,
                    saved_addresses: savedAddresses,
                    notification_email: emailNotificationsInput ? emailNotificationsInput.checked : true,
                    notification_sms: smsNotificationsInput ? smsNotificationsInput.checked : true,
                    marketing_opt_in: marketingInput ? marketingInput.checked : false
                })
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
        currentProfile.preferred_barber_id = preferredBarberId || null;
        currentProfile.default_fulfillment_type = defaultFulfillmentType;
        currentProfile.saved_addresses = savedAddresses;
        currentProfile.notification_email = emailNotificationsInput ? emailNotificationsInput.checked : true;
        currentProfile.notification_sms = smsNotificationsInput ? smsNotificationsInput.checked : true;
        currentProfile.marketing_opt_in = marketingInput ? marketingInput.checked : false;
        renderProfile();
        // Table update succeeded (the tableError branch above already
        // returned otherwise) — the form now matches what's actually
        // saved, so Save disables itself again until the next real edit.
        if (profileFormDirtyTracker) profileFormDirtyTracker.resetBaseline();

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

    // Update starts disabled (see the HTML) — enabling it only once all
    // three fields actually have something in them avoids an eager
    // click landing on an obviously-incomplete form.
    function checkPasswordFormFilled() {
        const filled = [currentInput, newInput, confirmInput].every(i => i && i.value.trim().length > 0);
        submitBtn.disabled = !filled;
    }
    [currentInput, newInput, confirmInput].forEach(input => {
        if (input) input.addEventListener('input', checkPasswordFormFilled);
    });
    checkPasswordFormFilled();

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
            if (!currentPassword) setFieldError(currentInput, 'Enter your current password.');
            else if (!newPassword) setFieldError(newInput, 'Enter a new password.');
            else setFieldError(confirmInput, 'Re-enter your new password.');
            return;
        }
        if (!passwordMeetsRequirements(newPassword)) {
            setFieldError(newInput, 'Doesn\'t meet the requirements above yet.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setFieldError(confirmInput, 'New passwords do not match.');
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
            setFieldError(currentInput, 'Your current password is incorrect.');
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
        checkPasswordFormFilled(); // fields are empty again — disable Update until refilled
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