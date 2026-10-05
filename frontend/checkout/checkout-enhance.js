// ============================================
// CHECKOUT — UI POLISH LAYER
// Purely additive: never touches cart/order logic in checkout.js.
// Everything here is defensive (checks elements exist) so it's safe
// to drop into any page state.
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    initMobileStickyBar();
    initLiveFieldFeedback();
    initOrderNumberCopy();
});

// --------------------------------------------
// COPY ORDER NUMBER
// Small, expected convenience once an order is placed — the kind of
// detail that separates a checkout that feels finished from one
// that just technically works.
// --------------------------------------------
function initOrderNumberCopy() {
    const orderNumberEl = document.getElementById('checkoutSuccessOrderNumber');
    if (!orderNumberEl) return;
    const row = orderNumberEl.closest('.checkout-success-row');
    if (!row) return;

    row.classList.add('checkout-success-row--order');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.title = 'Copy order number';

    function copyOrderNumber() {
        const value = orderNumberEl.textContent.trim();
        if (!value) return;
        navigator.clipboard?.writeText(value).then(function () {
            const original = orderNumberEl.textContent;
            orderNumberEl.textContent = 'Copied!';
            row.classList.add('is-copied');
            setTimeout(function () {
                orderNumberEl.textContent = original;
                row.classList.remove('is-copied');
            }, 1200);
        }).catch(function () {
            // Clipboard access denied or unsupported — fail silently,
            // the number is still visible to copy manually.
        });
    }

    row.addEventListener('click', copyOrderNumber);
    row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            copyOrderNumber();
        }
    });
}

// --------------------------------------------
// MOBILE STICKY ORDER BAR
// Mirrors the total + submit action once the real summary card
// scrolls out of view on small screens. Proxies a real click to the
// existing confirm button so all checkout logic still runs there.
// --------------------------------------------
function initMobileStickyBar() {
    const confirmBtn = document.getElementById('checkoutConfirmBtn');
    const totalEl = document.getElementById('checkoutSummaryTotal');
    const content = document.getElementById('checkoutContent');
    if (!confirmBtn || !totalEl || !content) return;

    const bar = document.createElement('div');
    bar.className = 'checkout-sticky-bar';
    bar.innerHTML = `
        <div class="checkout-sticky-bar-total">
            <span>Total</span>
            <span id="checkoutStickyTotal">PHP 0</span>
        </div>
        <button type="button" class="checkout-sticky-bar-btn" id="checkoutStickyBtn">
            Place Order
        </button>
    `;
    document.body.appendChild(bar);

    const stickyTotal = bar.querySelector('#checkoutStickyTotal');
    const stickyBtn = bar.querySelector('#checkoutStickyBtn');
    const spinner = confirmBtn.querySelector('.checkout-confirm-spinner');

    // checkout.js toggles the spinner's `hidden` attribute to show
    // the loading state; mirror that onto aria-busy so both this
    // bar and the CSS busy-state rule can key off one clean signal
    // without any change to checkout.js itself.
    if (spinner) {
        const busyObserver = new MutationObserver(function () {
            confirmBtn.setAttribute('aria-busy', spinner.hidden ? 'false' : 'true');
        });
        busyObserver.observe(spinner, { attributes: true, attributeFilter: ['hidden'] });
    }

    stickyBtn.addEventListener('click', function () {
        confirmBtn.click();
    });

    function syncFromRealButton() {
        stickyTotal.textContent = totalEl.textContent;
        const isDisabled = confirmBtn.disabled;
        stickyBtn.disabled = isDisabled;
        const isBusy = confirmBtn.getAttribute('aria-busy') === 'true';
        stickyBtn.textContent = isBusy ? 'Placing Order…' : 'Place Order';
    }

    // Keep the mirrored total and button state in sync without
    // requiring any change to checkout.js's own update logic.
    const syncObserver = new MutationObserver(syncFromRealButton);
    syncObserver.observe(totalEl, { childList: true, characterData: true, subtree: true });
    syncObserver.observe(confirmBtn, { attributes: true, attributeFilter: ['disabled', 'aria-busy'] });
    syncFromRealButton();

    // Only show the bar once the real confirm button has scrolled
    // out of view, and only while the checkout form itself (not the
    // gate, empty state, or success screen) is on screen.
    const visibilityObserver = new IntersectionObserver(function (entries) {
        const entry = entries[0];
        const contentVisible = !content.hidden;
        const shouldShow = contentVisible && !entry.isIntersecting && window.matchMedia('(max-width: 900px)').matches;
        bar.classList.toggle('is-visible', shouldShow);
    }, { threshold: 0 });

    visibilityObserver.observe(confirmBtn);

    window.addEventListener('resize', function () {
        if (!window.matchMedia('(max-width: 900px)').matches) {
            bar.classList.remove('is-visible');
        }
    });
}

// --------------------------------------------
// LIVE FIELD FEEDBACK
// Lightweight, non-blocking visual state (checkout.js's own
// validation still gates form submission) — this just gives people
// a confirmation the moment they finish a field instead of only at
// submit time.
// --------------------------------------------
function initLiveFieldFeedback() {
    // Each check returns an error message ('' when fine). The rules come
    // from main.js so this stays in step with what checkout.js enforces
    // at submit time.
    const opts = { wrapper: '.checkout-field', errorClass: 'is-error', messageClass: 'checkout-field-error', focus: false };
    const fields = [
        { input: 'checkoutNameInput', check: v => validatePersonName(v) },
        { input: 'checkoutPhoneInput', check: v => validatePhMobile(v).error },
        { input: 'checkoutAddressInput', check: v => validateAddressText(v) },
        { input: 'checkoutAreaInput', check: v => v ? '' : 'Select your delivery area.' },
    ];

    fields.forEach(function (f) {
        const input = document.getElementById(f.input);
        if (!input) return;
        const field = input.closest('.checkout-field');
        if (!field) return;

        function validate() {
            if (!input.value.trim()) {
                clearFieldMessage(input, opts);
                field.classList.remove('is-success');
                return;
            }
            const message = f.check(input.value);
            if (message) {
                showFieldMessage(input, message, opts);
            } else {
                clearFieldMessage(input, opts);
                field.classList.add('is-success');
            }
        }

        input.addEventListener('blur', validate);
        if (input.tagName === 'SELECT') input.addEventListener('change', validate);

        input.addEventListener('input', function () {
            // Typing again clears a stale error; success shows once it's valid.
            if (field.classList.contains('is-error') && !f.check(input.value)) {
                clearFieldMessage(input, opts);
                field.classList.add('is-success');
            }
        });
    });
}