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
    initAddressManager();
    initNotificationPreferences();

    const nameForm = document.getElementById('accountNameForm');
    const nameSubmitBtn = document.getElementById('accountNameSubmitBtn');
    const nameHint = document.getElementById('accountNameUnsavedHint');
    profileFormDirtyTracker = initFormDirtyTracking(nameForm, nameSubmitBtn, nameHint);
    initUnsavedChangesGuard();
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
    if (phoneInput) phoneInput.value = formatPhoneDisplay(currentProfile.phone);

    loadAddressesFromProfile();

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
    updateSmsWarning();

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
function setFieldError(input, message, opts) {
    if (!input) return;
    const field = input.closest('.login-field');
    if (!field) return;

    // On-blur checks pass { focus: false } so tabbing away from a field
    // never yanks the page or the cursor somewhere else.
    const shouldFocus = !opts || opts.focus !== false;

    field.classList.add('has-error');
    input.setAttribute('aria-invalid', 'true');

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

    if (shouldFocus) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => input.focus(), 280);
    }

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
    input.removeAttribute('aria-invalid');
    const msg = field.querySelector('.account-field-error');
    if (msg) msg.remove();
}

// --------------------------------------------
// Phone + address validation
// Each validator returns an error string ('' when fine) so the same rule
// drives both the on-blur hint and the submit-time check.
// --------------------------------------------

// Philippine mobile numbers only (09XX XXX XXXX, +63 9XX XXX XXXX, or
// 639XXXXXXXXX) — the number is used for SMS updates and delivery calls,
// so a landline would save fine but never actually reach anyone.
// Returns { error, value } where value is the cleaned 11-digit 09... form.
function validatePhone(raw) {
    const text = (raw || '').trim();
    if (!text) return { error: '', value: '' };

    if (/[A-Za-z]/.test(text)) return { error: 'Phone number can only contain numbers.', value: '' };
    if (!/^[0-9+()\-.\s]+$/.test(text)) return { error: 'Use numbers only — remove any special characters.', value: '' };
    if (text.lastIndexOf('+') > 0) return { error: 'The + sign can only be at the very start.', value: '' };

    let digits = text.replace(/\D/g, '');
    if (digits.startsWith('63') && (text.startsWith('+') || digits.length === 12)) {
        digits = '0' + digits.slice(2);
    } else if (digits.startsWith('9') && digits.length === 10) {
        digits = '0' + digits;
    }

    if (digits.length >= 2 && !digits.startsWith('09')) {
        return { error: 'Enter a Philippine mobile number starting with 09 or +63 9.', value: '' };
    }
    if (digits.length < 11) {
        return { error: 'That number is too short — mobile numbers have 11 digits (09XX XXX XXXX).', value: '' };
    }
    if (digits.length > 11) {
        return { error: 'That number is too long — mobile numbers have 11 digits (09XX XXX XXXX).', value: '' };
    }
    return { error: '', value: digits };
}

function formatPhoneDisplay(stored) {
    const result = validatePhone(stored);
    const d = result.value;
    return d ? d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) : (stored || '');
}

function cleanAddress(raw) {
    return (raw || '').replace(/\s+/g, ' ').trim();
}

function validateAddress(raw) {
    const text = cleanAddress(raw);
    if (!text) return '';
    if (text.length > 200) return 'Keep each address under 200 characters.';
    if (text.length < 10) return 'That address is too short — include your street, barangay, and city.';
    if (!/[A-Za-z]/.test(text)) return 'Add a street, barangay, or city name — numbers alone are not enough.';
    if (text.split(/[\s,]+/).filter(Boolean).length < 3) {
        return 'Add more detail, e.g. house/unit no., street, barangay, city.';
    }
    return '';
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
    if (!form || !submitBtn) return { isDirty() { return false; }, resetBaseline() {} };

    let baseline = serializeForm(form);

    function check() {
        const dirty = serializeForm(form) !== baseline;
        submitBtn.disabled = !dirty;
        if (hintEl) hintEl.hidden = !dirty;
    }

    form.addEventListener('input', check);
    form.addEventListener('change', check);

    return {
        isDirty() {
            return serializeForm(form) !== baseline;
        },
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
    const preferredBarberInput = document.getElementById('accountPreferredBarberInput');
    const fulfillmentInput = document.getElementById('accountFulfillmentInput');
    const submitBtn = document.getElementById('accountNameSubmitBtn');
    const submitText = submitBtn.querySelector('.login-submit-text');
    const spinner = submitBtn.querySelector('.login-submit-spinner');

    // Tell the visitor as soon as they leave a field, not only on Save.
    // Empty is fine (both are optional); errors clear themselves on the
    // next keystroke (see setFieldError).
    if (phoneInput) {
        phoneInput.addEventListener('blur', function () {
            const result = validatePhone(phoneInput.value);
            if (result.error) setFieldError(phoneInput, result.error, { focus: false });
        });
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideBanners('accountProfileError', 'accountProfileSuccess');

        const name = nameInput.value.trim();
        const preferredBarberId = preferredBarberInput ? preferredBarberInput.value : '';
        const defaultFulfillmentType = fulfillmentInput && fulfillmentInput.value === 'delivery' ? 'delivery' : 'pickup';

        // An address that's still open in the editor hasn't been added to
        // the list yet — saving now would silently drop it.
        if (isAddressEditorOpen()) {
            setAddressEditorError('Save or cancel this address before saving your profile.');
            focusAddressEditor();
            return;
        }

        // Collect every problem first, then show them all together (only
        // the first one scrolls/focuses) so fixing one field doesn't
        // reveal a new error on the next save attempt. Phone is optional,
        // but if it IS filled in, it has to be usable. Addresses are
        // validated one at a time as they're added/edited.
        const problems = [];
        [nameInput, phoneInput].forEach(clearFieldError);

        if (!name) problems.push({ input: nameInput, message: 'Enter your name.' });

        const phoneResult = validatePhone(phoneInput ? phoneInput.value : '');
        if (phoneResult.error) problems.push({ input: phoneInput, message: phoneResult.error });
        const phone = phoneResult.value;

        // The list is ordered default-first, so the default address is
        // simply the first entry (same convention the old textarea used).
        const savedAddresses = savedAddressList.slice(0, MAX_SAVED_ADDRESSES);
        const address = savedAddresses[0] || '';

        if (problems.length) {
            problems.forEach(function (problem, index) {
                setFieldError(problem.input, problem.message, { focus: index === 0 });
            });
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
                    saved_addresses: savedAddresses
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
    const followup = document.getElementById('accountPasswordFollowup');
    const followupText = document.getElementById('accountPasswordFollowupText');
    const signOutOthersBtn = document.getElementById('accountSignOutOthersBtn');
    const FOLLOWUP_DEFAULT_TEXT = followupText ? followupText.textContent : '';

    initPasswordChecklist(newInput, checklist);

    // After a successful change, offer to end every OTHER session. Changing
    // a password doesn't sign other devices out by itself, so anyone who
    // changed it because of a lost phone or a shared computer would
    // otherwise still be logged in there. scope: 'others' keeps this device.
    if (signOutOthersBtn) {
        signOutOthersBtn.addEventListener('click', async function () {
            signOutOthersBtn.disabled = true;
            signOutOthersBtn.textContent = 'Signing out...';

            const { error: signOutError } = await supabaseClient.auth.signOut({ scope: 'others' });

            if (signOutError) {
                signOutOthersBtn.disabled = false;
                signOutOthersBtn.textContent = 'Sign out other devices';
                showPasswordError(friendlyErrorMessage(signOutError, "Couldn't sign out your other devices. Please try again."));
                return;
            }

            if (followupText) followupText.textContent = "Done. You're now signed in on this device only.";
            signOutOthersBtn.hidden = true;
        });
    }

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
        if (followup) followup.hidden = true;

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
            // Only a genuine credentials rejection means "wrong password".
            // Offline, rate-limited, or server errors say so instead of
            // wrongly blaming the password the visitor typed.
            const wrongPassword = reauthError.status === 400 || /invalid login credentials/i.test(reauthError.message || '');
            if (wrongPassword) {
                setFieldError(currentInput, 'Your current password is incorrect.');
            } else {
                showPasswordError(friendlyErrorMessage(reauthError, 'Could not verify your current password. Please try again.'));
            }
            return;
        }

        const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

        submitBtn.disabled = false;
        submitText.textContent = 'Update Password';
        spinner.hidden = true;

        if (error) {
            showPasswordError(friendlyErrorMessage(error, 'Could not update your password. Please try again.'));
            return;
        }

        form.reset();
        resetPasswordVisibility(form); // form.reset() doesn't undo a "Show password" toggle
        initPasswordChecklist(newInput, checklist); // reset the checklist back to its empty state
        checkPasswordFormFilled(); // fields are empty again — disable Update until refilled
        showPasswordSuccess('Your password has been updated.');

        if (followup && signOutOthersBtn) {
            if (followupText) followupText.textContent = FOLLOWUP_DEFAULT_TEXT;
            signOutOthersBtn.hidden = false;
            signOutOthersBtn.disabled = false;
            signOutOthersBtn.textContent = 'Sign out other devices';
            followup.hidden = false;
        }
    });
}

// Puts every password field back to hidden, with the toggle button's icon
// and label to match. The toggles themselves are wired in main.js
// (initPasswordToggles); this only undoes their state after form.reset().
function resetPasswordVisibility(form) {
    form.querySelectorAll('.login-toggle-pass[data-toggle-target]').forEach(function (btn) {
        const input = document.getElementById(btn.dataset.toggleTarget);
        if (input) input.type = 'password';
        btn.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i>';
        btn.setAttribute('aria-label', 'Show password');
    });
}

// --------------------------------------------
// Log out
// --------------------------------------------
function initLogoutButton() {
    const btn = document.getElementById('accountLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        if (!confirmLeaveIfUnsaved()) return;
        logOut();
    });
}

// ============================================
// SAVED ADDRESSES
// ============================================
// One list replaces the old "default address" box + "one address per
// line" box. The list is ordered default-first, which is the same
// convention the old code stored (profiles.address === saved_addresses[0]),
// so checkout and any other page reading those columns keep working
// unchanged. Edits are held in memory and written by the form's normal
// Save Changes button — a hidden input (#accountSavedAddressesData)
// mirrors the list so the unsaved-changes tracking sees them.
const MAX_SAVED_ADDRESSES = 5;
const ADDRESS_LIMIT_NOTE = 'You\'ve reached the limit of ' + MAX_SAVED_ADDRESSES + ' saved addresses. Delete one to add another.';
const ADDRESS_DEFAULT_NOTE = 'Your default address is used first at checkout. Changes apply when you press Save Changes.';

let savedAddressList = [];  // default first
let addressEditor = null;   // { index: number | null (null = adding), original, textarea, errorEl } while open

function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function makeIcon(className) {
    const icon = document.createElement('i');
    icon.className = className;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function normalizeAddressList(profile) {
    const seen = new Set();
    const list = [];
    function add(raw) {
        const text = cleanAddress(raw);
        const key = text.toLowerCase();
        if (!text || seen.has(key)) return;
        seen.add(key);
        list.push(text);
    }
    // The single-address column always leads (it was the default), then
    // whatever was saved, de-duplicated case-insensitively.
    add(profile.address);
    (Array.isArray(profile.saved_addresses) ? profile.saved_addresses : []).forEach(function (item) {
        add(typeof item === 'string' ? item : (item && item.address) || '');
    });
    return list.slice(0, MAX_SAVED_ADDRESSES);
}

function loadAddressesFromProfile() {
    if (!currentProfile) return;
    savedAddressList = normalizeAddressList(currentProfile);
    addressEditor = null;
    renderAddressList();
}

function initAddressManager() {
    const addBtn = document.getElementById('accountAddressAddBtn');
    if (addBtn) addBtn.addEventListener('click', startAddressAdd);
}

function announceAddressChange(message) {
    const live = document.getElementById('accountAddressAnnounce');
    if (live) live.textContent = message;
}

// focus: { type: 'add' } or { type: 'edit', index } — where keyboard focus
// should land after the re-render, since the button that was just
// pressed no longer exists.
function renderAddressList(focus) {
    const list = document.getElementById('accountAddressList');
    const addBtn = document.getElementById('accountAddressAddBtn');
    const note = document.getElementById('accountAddressNote');
    if (!list) return;

    list.replaceChildren();

    const adding = addressEditor && addressEditor.index === null;
    if (!savedAddressList.length && !adding) {
        list.append(makeEl('p', 'account-address-empty', 'No saved addresses yet.'));
    }
    savedAddressList.forEach(function (address, index) {
        list.append(addressEditor && addressEditor.index === index
            ? buildAddressEditor(index, address)
            : buildAddressItem(address, index));
    });
    if (adding) list.append(buildAddressEditor(null, ''));

    const full = savedAddressList.length >= MAX_SAVED_ADDRESSES;
    if (addBtn) addBtn.disabled = !!addressEditor || full;
    if (note) note.textContent = full ? ADDRESS_LIMIT_NOTE : ADDRESS_DEFAULT_NOTE;

    // Mirror into the hidden input so the form's dirty tracking notices.
    const data = document.getElementById('accountSavedAddressesData');
    if (data) {
        const next = JSON.stringify(savedAddressList);
        if (data.value !== next) {
            data.value = next;
            data.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    if (focus) {
        const target = focus.type === 'add'
            ? addBtn
            : list.querySelector('[data-index="' + focus.index + '"] .js-address-edit');
        if (target && !target.disabled) target.focus();
        else if (addBtn && !addBtn.disabled) addBtn.focus();
    }
}

function makeAddressButton(label, iconClass, ariaLabel, onClick, extraClass) {
    const btn = makeEl('button', 'account-mini-btn' + (extraClass ? ' ' + extraClass : ''));
    btn.type = 'button';
    btn.append(makeIcon(iconClass), document.createTextNode(' ' + label));
    btn.setAttribute('aria-label', ariaLabel);
    btn.disabled = !!addressEditor; // finish or cancel the open editor first
    btn.addEventListener('click', onClick);
    return btn;
}

function buildAddressItem(address, index) {
    const isDefault = index === 0;
    const item = makeEl('div', 'account-address-item' + (isDefault ? ' is-default' : ''));
    item.dataset.index = String(index);
    item.setAttribute('role', 'group');
    item.setAttribute('aria-label', 'Address ' + (index + 1) + (isDefault ? ', default' : ''));

    const body = makeEl('div', 'account-address-body');
    if (isDefault) {
        const badge = makeEl('span', 'account-address-badge');
        badge.append(makeIcon('fas fa-check'), document.createTextNode(' Default'));
        body.append(badge);
    }
    body.append(makeEl('p', 'account-address-text', address));

    const actions = makeEl('div', 'account-address-actions');
    if (!isDefault) {
        actions.append(makeAddressButton('Set as default', 'fas fa-star', 'Set address ' + (index + 1) + ' as default', function () {
            setDefaultAddress(index);
        }));
    }
    const editBtn = makeAddressButton('Edit', 'fas fa-pen', 'Edit address ' + (index + 1), function () {
        startAddressEdit(index);
    }, 'js-address-edit');
    actions.append(editBtn);
    actions.append(makeAddressButton('Delete', 'fas fa-trash', 'Delete address ' + (index + 1), function () {
        deleteAddress(index);
    }, 'is-danger'));

    item.append(body, actions);
    return item;
}

function buildAddressEditor(index, value) {
    const wrap = makeEl('div', 'account-address-editor');
    wrap.append(makeEl('span', 'account-address-editor-title', index === null ? 'New address' : 'Edit address'));

    // No id on purpose: the form's dirty tracking serializes every field
    // that has one, and a half-typed address shouldn't light up Save —
    // only a completed add/edit changes the list.
    const textarea = makeEl('textarea', 'login-input account-address-input');
    textarea.rows = 3;
    textarea.maxLength = 200;
    textarea.value = value;
    textarea.placeholder = 'House/Unit No., Street, Barangay, City, Province';
    textarea.autocomplete = 'street-address';
    textarea.setAttribute('aria-label', index === null ? 'New delivery address' : 'Edit delivery address');

    const errorEl = makeEl('p', 'account-field-error account-address-error');
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;

    const buttons = makeEl('div', 'account-address-editor-actions');
    const saveBtn = makeEl('button', 'account-mini-btn is-primary', index === null ? 'Add address' : 'Save address');
    saveBtn.type = 'button';
    const cancelBtn = makeEl('button', 'account-mini-btn', 'Cancel');
    cancelBtn.type = 'button';
    buttons.append(saveBtn, cancelBtn);

    saveBtn.addEventListener('click', commitAddressEditor);
    cancelBtn.addEventListener('click', cancelAddressEditor);
    textarea.addEventListener('input', function () { setAddressEditorError(''); });
    textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelAddressEditor();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commitAddressEditor();
        }
    });

    wrap.append(textarea, errorEl, buttons);
    addressEditor.textarea = textarea;
    addressEditor.errorEl = errorEl;
    addressEditor.original = value;
    return wrap;
}

function isAddressEditorOpen() {
    return !!addressEditor;
}

// True only when the open editor holds text that differs from what it
// opened with — an editor opened and left untouched isn't "unsaved".
function isAddressEditorDirty() {
    if (!addressEditor || !addressEditor.textarea) return false;
    return cleanAddress(addressEditor.textarea.value) !== cleanAddress(addressEditor.original);
}

function focusAddressEditor() {
    if (!addressEditor || !addressEditor.textarea) return;
    addressEditor.textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    addressEditor.textarea.focus({ preventScroll: true });
}

function setAddressEditorError(message) {
    if (!addressEditor || !addressEditor.errorEl) return;
    const errorEl = addressEditor.errorEl;
    if (!message) {
        errorEl.hidden = true;
        errorEl.replaceChildren();
        addressEditor.textarea.removeAttribute('aria-invalid');
        return;
    }
    errorEl.replaceChildren(makeIcon('fas fa-circle-exclamation'), makeEl('span', '', message));
    errorEl.hidden = false;
    addressEditor.textarea.setAttribute('aria-invalid', 'true');
}

function startAddressAdd() {
    if (addressEditor || savedAddressList.length >= MAX_SAVED_ADDRESSES) return;
    addressEditor = { index: null };
    renderAddressList();
    focusAddressEditor();
}

function startAddressEdit(index) {
    if (addressEditor) return;
    addressEditor = { index: index };
    renderAddressList();
    focusAddressEditor();
}

function cancelAddressEditor() {
    if (!addressEditor) return;
    const wasAdding = addressEditor.index === null;
    const index = addressEditor.index;
    addressEditor = null;
    renderAddressList(wasAdding ? { type: 'add' } : { type: 'edit', index: index });
}

function commitAddressEditor() {
    if (!addressEditor) return;
    const text = cleanAddress(addressEditor.textarea.value);
    const editingIndex = addressEditor.index;

    let message = text ? validateAddress(text) : 'Enter an address.';
    if (!message && savedAddressList.some(function (a, i) { return i !== editingIndex && a.toLowerCase() === text.toLowerCase(); })) {
        message = 'You\'ve already saved that address.';
    }
    if (!message && editingIndex === null && savedAddressList.length >= MAX_SAVED_ADDRESSES) {
        message = ADDRESS_LIMIT_NOTE;
    }
    if (message) {
        setAddressEditorError(message);
        focusAddressEditor();
        return;
    }

    let focusIndex;
    if (editingIndex === null) {
        savedAddressList.push(text); // first-ever address is index 0, so it becomes the default automatically
        focusIndex = savedAddressList.length - 1;
        announceAddressChange(focusIndex === 0
            ? 'Address added and set as your default. Press Save Changes to apply.'
            : 'Address added. Press Save Changes to apply.');
    } else {
        savedAddressList[editingIndex] = text;
        focusIndex = editingIndex;
        announceAddressChange('Address updated. Press Save Changes to apply.');
    }
    addressEditor = null;
    renderAddressList({ type: 'edit', index: focusIndex });
}

function setDefaultAddress(index) {
    if (addressEditor || index <= 0 || index >= savedAddressList.length) return;
    const moved = savedAddressList.splice(index, 1)[0];
    savedAddressList.unshift(moved);
    announceAddressChange('That address is now your default. Press Save Changes to apply.');
    renderAddressList({ type: 'edit', index: 0 });
}

function deleteAddress(index) {
    if (addressEditor || index < 0 || index >= savedAddressList.length) return;
    const wasDefault = index === 0;
    savedAddressList.splice(index, 1);
    announceAddressChange(wasDefault && savedAddressList.length
        ? 'Default address deleted. Your next address is now the default. Press Save Changes to apply.'
        : 'Address deleted. Press Save Changes to apply.');
    renderAddressList({ type: 'add' });
}


// ============================================
// NOTIFICATION PREFERENCES — save on toggle
// ============================================
// These three checkboxes live OUTSIDE #accountNameForm, so they never
// affect the Save button or the unsaved-changes prompt. Each one writes
// only its own column the moment it's switched; on failure it flips back
// so the screen never claims something that didn't save.
let notificationStatusTimer = null;

function setNotificationStatus(message, kind) {
    const status = document.getElementById('accountNotificationStatus');
    if (!status) return;
    clearTimeout(notificationStatusTimer);
    status.className = 'account-autosave-status' + (kind ? ' is-' + kind : '');
    if (!message) {
        status.replaceChildren();
        return;
    }
    const iconClass = kind === 'success' ? 'fas fa-circle-check'
        : kind === 'error' ? 'fas fa-circle-exclamation'
        : 'fas fa-circle-notch fa-spin';
    status.replaceChildren(makeIcon(iconClass), makeEl('span', '', message));
    if (kind === 'success') {
        notificationStatusTimer = setTimeout(function () { setNotificationStatus(''); }, 2500);
    }
}

// SMS only reaches someone if a phone number is actually SAVED on the
// account, so the check uses the stored profile — not whatever happens
// to be typed in the phone box right now.
function updateSmsWarning() {
    const warning = document.getElementById('accountSmsWarning');
    const smsInput = document.getElementById('accountSmsNotificationsInput');
    const text = document.getElementById('accountSmsWarningText');
    const action = document.getElementById('accountSmsWarningAction');
    if (!warning || !smsInput || !text || !action) return;

    const hasSavedPhone = !!(currentProfile && currentProfile.phone);
    const phoneInput = document.getElementById('accountPhoneInput');
    const hasTypedPhone = !!(phoneInput && phoneInput.value.trim());

    const show = smsInput.checked && !hasSavedPhone;
    warning.hidden = !show;
    if (!show) return;

    if (hasTypedPhone) {
        text.textContent = 'SMS updates are on, but the phone number you entered isn\'t saved yet. Press Save Changes above and we\'ll text that number. ';
        action.hidden = true;
    } else {
        text.textContent = 'SMS updates are on, but there\'s no phone number on your account, so no texts will be sent. ';
        action.hidden = false;
    }
}

function initNotificationPreferences() {
    const preferences = [
        { id: 'accountEmailNotificationsInput', column: 'notification_email' },
        { id: 'accountSmsNotificationsInput', column: 'notification_sms' },
        { id: 'accountMarketingInput', column: 'marketing_opt_in' }
    ];

    preferences.forEach(function (pref) {
        const input = document.getElementById(pref.id);
        if (!input) return;

        input.addEventListener('change', async function () {
            const user = getCurrentUser();
            if (!user) return;

            const desired = input.checked;
            const hadFocus = document.activeElement === input;
            input.disabled = true; // one request per toggle at a time
            updateSmsWarning();
            setNotificationStatus('Saving...', 'saving');

            const { error } = await supabaseClient
                .from('profiles')
                .update({ [pref.column]: desired })
                .eq('id', user.id);

            input.disabled = false;
            if (hadFocus) input.focus();

            if (error) {
                console.error(error);
                input.checked = !desired;
                setNotificationStatus(friendlyErrorMessage(error, 'Couldn\'t save that change. Please try again.'), 'error');
            } else {
                input.checked = desired;
                if (currentProfile) currentProfile[pref.column] = desired;
                setNotificationStatus('Saved', 'success');
            }
            updateSmsWarning();
        });
    });

    const phoneInput = document.getElementById('accountPhoneInput');
    if (phoneInput) phoneInput.addEventListener('input', updateSmsWarning);

    const action = document.getElementById('accountSmsWarningAction');
    if (action) {
        action.addEventListener('click', function () {
            const target = document.getElementById('accountPhoneInput');
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.setTimeout(function () { target.focus({ preventScroll: true }); }, 280);
        });
    }

    updateSmsWarning();
}


// ============================================
// UNSAVED-CHANGES GUARD
// ============================================
// Covers the ways someone can leave with edits pending: closing the tab,
// reloading, the browser's back/forward buttons (all via beforeunload),
// and clicking any link that goes to another page — header, footer,
// mobile bottom nav — plus Log Out. The settings rail is NOT guarded:
// its links only scroll within this page, so nothing is lost by using
// them.
let skipBeforeUnloadPrompt = false;
const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave without saving?';

function hasUnsavedProfileChanges() {
    return !!((profileFormDirtyTracker && profileFormDirtyTracker.isDirty()) || isAddressEditorDirty());
}

// Used for in-page actions that navigate away (links, Log Out). Returns
// false if the visitor chose to stay. When they choose to leave, the
// native beforeunload prompt is suppressed once so they aren't asked twice.
function confirmLeaveIfUnsaved() {
    if (!hasUnsavedProfileChanges()) return true;
    if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) return false;
    skipBeforeUnloadPrompt = true;
    window.setTimeout(function () { skipBeforeUnloadPrompt = false; }, 1500);
    return true;
}

function initUnsavedChangesGuard() {
    window.addEventListener('beforeunload', function (e) {
        if (skipBeforeUnloadPrompt || !hasUnsavedProfileChanges()) return;
        e.preventDefault();
        e.returnValue = ''; // required by some browsers to show the prompt
    });

    // Capture phase so this runs before any other click handler on the
    // page (nav drawer, bottom-nav, etc.) gets a chance to navigate.
    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = e.target.closest ? e.target.closest('a[href]') : null;
        if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

        const href = link.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(href)) return;

        const url = new URL(link.href, window.location.href);
        const samePage = url.origin === window.location.origin
            && url.pathname === window.location.pathname
            && url.search === window.location.search;
        if (samePage) return;

        if (!confirmLeaveIfUnsaved()) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
}