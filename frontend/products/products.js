// ============================================
// PRODUCTS PAGE — CATALOG + STOCK
// ============================================
// The catalog used to be hardcoded here as a plain JS array, duplicating
// data the admin panel already manages in the `public.products` table
// (see the admin products.js / products_setup.sql) — so a price change
// or new product in the dashboard never showed up here without editing
// this file too. Both the catalog copy (name, price, gallery,
// description, features, how-to-use) and the stock fields live in that
// same table/row, so one query now covers what used to be a hardcoded
// array plus a separate stock lookup.
//
// Populated by loadCatalogAndStock() below; empty until then, so
// anything that reads it (findProduct, the grid render) only runs after
// that fetch resolves.
let productsCatalog = [];

// --------------------------------------------
// CUSTOMER STOCK AVAILABILITY
// --------------------------------------------
// Purchase buttons stay disabled until this is populated, so a missing
// table or failed request fails closed instead of allowing a
// known-unavailable purchase.
const customerStockState = {
    ready: false,
    error: false,
    byId: new Map()
};

window.getCustomerProductStock = function (productId) {
    const record = customerStockState.byId.get(String(productId));
    return {
        ready: customerStockState.ready,
        error: customerStockState.error,
        isActive: record ? record.isActive : false,
        stock: record ? record.stock : 0,
        lowStockThreshold: record ? record.lowStockThreshold : 0
    };
};

function stockMessage(record, ready, error) {
    if (!ready) return error ? 'Availability unavailable' : 'Checking availability…';
    if (!record || !record.isActive || record.stock <= 0) return 'Out of stock';
    if (record.stock <= record.lowStockThreshold) {
        return `Only ${record.stock} left`;
    }
    return `${record.stock} available`;
}

function applyStockState(element, productId, record) {
    if (!element) return;

    const message = stockMessage(record, customerStockState.ready, customerStockState.error);
    const available = customerStockState.ready && record && record.isActive && record.stock > 0;
    const statusClass = !customerStockState.ready
        ? 'is-checking'
        : available
            ? (record.stock <= record.lowStockThreshold ? 'is-low' : 'is-available')
            : 'is-out';

    if (element.matches('button')) {
        // Keep the purchase label and existing button classes intact.
        element.disabled = !available;
        element.setAttribute('aria-disabled', String(!available));
        element.title = available ? '' : message;
        return;
    }

    // Reading this before the overwrite (rather than hardcoding it into
    // the template string) means whichever layout classes the caller put
    // on this element originally — e.g. the modal's "--modal" spacing
    // modifier — survive every future re-render, not just the first one.
    const isModal = element.classList.contains('product-stock--modal');
    element.textContent = message;
    element.className = `product-stock ${statusClass}` + (isModal ? ' product-stock--modal' : '');
    element.setAttribute('aria-label', `${element.dataset.productName || 'Product'}: ${message}`);
}

function renderCustomerStockStates() {
    document.querySelectorAll('.product-card--shop').forEach(card => {
        const actionButton = card.querySelector('.product-btn[data-id]');
        if (!actionButton) return;

        const productId = actionButton.dataset.id;
        let status = card.querySelector('.product-stock');
        if (!status) {
            status = document.createElement('p');
            status.className = 'product-stock';
            status.dataset.productName = actionButton.dataset.name || 'Product';
            const price = card.querySelector('.product-price');
            if (price) price.insertAdjacentElement('afterend', status);
        }

        const record = customerStockState.byId.get(productId);
        applyStockState(status, productId, record);
        card.classList.toggle('is-out-of-stock', customerStockState.ready && (!record || !record.isActive || record.stock <= 0));

        card.querySelectorAll('.product-btn, .product-buy-btn').forEach(button => {
            applyStockState(button, productId, record);
        });
    });
}

// --------------------------------------------
// Catalog rendering helpers
// --------------------------------------------
// The site's category tabs (see initCategoryTabs in main.js) filter by
// exact match against data-category ("wax" / "sprays") — normalize
// whatever free-text category the admin panel saved into one of those,
// so existing tabs keep working. Anything that doesn't match still
// renders and shows under "All Products", just without a specific tab.
function categoryToDataAttr(category) {
    const key = String(category || '').trim().toLowerCase();
    if (key === 'wax' || key === 'waxes') return 'wax';
    if (key === 'spray' || key === 'sprays') return 'sprays';
    return key;
}

// The static cards used to show a ✦ mark instead of the word
// "Toughcuts" for house-brand items — keep that convention for
// house-brand products coming from the database too.
function brandLabel(brand) {
    const trimmed = String(brand || '').trim();
    if (!trimmed || /^toughcuts$/i.test(trimmed)) return '✦';
    return trimmed.toUpperCase();
}

function fallbackImageText(dataCategory) {
    if (dataCategory === 'wax') return 'WAX';
    if (dataCategory === 'sprays') return 'SPRAY';
    return 'ITEM';
}

function renderProductCard(product) {
    const dataCategory = categoryToDataAttr(product.category);
    const gallery = Array.isArray(product.gallery) ? product.gallery : [];
    const image = gallery[0] || '';
    // Second gallery photo, shown as a soft crossfade on hover — a small,
    // pointer-only reveal that fits the compact circular product photo
    // instead of trying to force a full image-swap treatment onto it.
    // Skipped entirely (no extra markup) for the many products that only
    // have one photo, and skipped on touch devices via CSS's
    // (hover:hover) guard rather than JS, so it never fires from a tap.
    const hoverImage = gallery[1] || '';
    const fallbackText = fallbackImageText(dataCategory);
    const safeId = escapeHtml(product.id);
    const safeName = escapeHtml(product.name);
    const price = Number(product.price) || 0;

    return `
        <div class="product-card product-card--shop" data-category="${escapeHtml(dataCategory)}">
            <div class="product-brand">${escapeHtml(brandLabel(product.brand))}</div>
            <div class="product-image">
                <img class="product-image-base" src="${escapeHtml(image)}" alt="${safeName}" loading="lazy"
                     onerror="this.src='https://placehold.co/120x120/232323/666?text=${encodeURIComponent(fallbackText)}'" />
                ${hoverImage ? `<img class="product-image-hover" src="${escapeHtml(hoverImage)}" alt="" aria-hidden="true" loading="lazy"
                     onerror="this.remove()" />` : ''}
            </div>
            <h3>${safeName}</h3>
            <p class="product-price">PHP ${price}</p>
            <div class="product-card-actions">
                <button class="product-btn" data-id="${safeId}" data-name="${safeName}" data-price="${price}">Add to Cart</button>
                <button class="product-buy-btn" data-id="${safeId}" data-name="${safeName}" data-price="${price}">Buy Now</button>
                <button class="product-view-more" type="button" data-product-id="${safeId}">View More Details</button>
            </div>
        </div>
    `;
}

// --------------------------------------------
// Load catalog + stock together (same table, one request) and render
// --------------------------------------------
// Only is_active products are fetched at all — the admin checkbox is
// literally labeled "Active (visible on the storefront)", so an
// inactive product should disappear from the grid entirely rather than
// show up grayed out. (The old hardcoded grid couldn't do this — every
// product was always in the markup, just disabled if flagged inactive.)
async function loadCatalogAndStock() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (typeof supabaseClient === 'undefined') {
        customerStockState.error = true;
        grid.innerHTML = '<p class="products-catalog-status">Couldn\u2019t load products right now — please refresh the page.</p>';
        return;
    }

    const { data, error } = await supabaseClient
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Could not load product catalog:', error);
        customerStockState.error = true;
        grid.innerHTML = '<p class="products-catalog-status">Couldn\u2019t load products right now — please refresh the page.</p>';
        updateProductModalStock();
        return;
    }

    productsCatalog = [];
    customerStockState.byId.clear();

    (data || []).forEach(row => {
        productsCatalog.push({
            id: row.id,
            name: row.name || 'Unnamed product',
            brand: row.brand || '',
            category: row.category || '',
            price: Number(row.price) || 0,
            gallery: Array.isArray(row.gallery) ? row.gallery : [],
            description: row.description || '',
            features: Array.isArray(row.features) ? row.features : [],
            howToUse: Array.isArray(row.how_to_use) ? row.how_to_use : []
        });

        const stock = Number(row.stock_quantity);
        const threshold = Number(row.low_stock_threshold);
        customerStockState.byId.set(String(row.id), {
            // The query already filtered to is_active = true, so every
            // row reaching here is active by definition.
            isActive: true,
            stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
            lowStockThreshold: Number.isFinite(threshold) ? Math.max(0, Math.floor(threshold)) : 5
        });
    });

    customerStockState.ready = true;

    if (!productsCatalog.length) {
        grid.innerHTML = '<p class="products-catalog-status">No products are available right now — check back soon.</p>';
        return;
    }

    grid.innerHTML = productsCatalog.map(renderProductCard).join('');
    renderCustomerStockStates();
    updateProductModalStock();

    // main.js's own DOMContentLoaded handler calls initAddToCart()/
    // initBuyNow() once, at page load — before this fetch has resolved,
    // since the grid still shows "Loading products…" at that point. Those
    // functions only wire up whatever .product-btn/.product-buy-btn
    // elements exist *at the moment they're called*, so without this the
    // real card buttons above would render with no click handler at all —
    // a tap that visibly does nothing. Calling them again now, against
    // the buttons that actually just got created, is what wires them up
    // for real. Safe to call more than once: this only runs one time
    // (loadCatalogAndStock() itself only runs once per page load), so
    // there's no earlier set of card buttons still in the DOM to
    // double-bind.
    if (typeof initAddToCart === 'function') initAddToCart();
    if (typeof initBuyNow === 'function') initBuyNow();

    // Cards just got (re)created, so re-apply whichever category tab is
    // currently selected — see applyCategoryFilter() in main.js.
    if (typeof applyCategoryFilter === 'function') applyCategoryFilter();
}

function updateProductModalStock() {
    const status = document.getElementById('productModalStock');
    const addButton = document.getElementById('productModalAddToCart');
    const buyButton = document.getElementById('productModalBuyNow');
    const productId = addButton && addButton.dataset.id;
    if (!status || !productId) return;

    const record = customerStockState.byId.get(productId);
    status.dataset.productName = document.getElementById('productModalName')?.textContent || 'Product';
    applyStockState(status, productId, record);

    [addButton, buyButton].forEach(button => {
        if (!button) return;
        const available = customerStockState.ready && record && record.isActive && record.stock > 0;
        button.disabled = !available;
        button.setAttribute('aria-disabled', String(!available));
    });
}

function findProduct(id) {
    return productsCatalog.find(p => p.id === id);
}

function initProductModal() {
    const grid = document.getElementById('productsGrid');
    const modal = document.getElementById('productModal');
    if (!grid || !modal) return;

    const backdrop = document.getElementById('productModalBackdrop');
    const closeBtn = document.getElementById('productModalClose');
    const returnBtn = document.getElementById('productModalReturn');
    const addToCartBtn = document.getElementById('productModalAddToCart');
    const buyNowBtn = document.getElementById('productModalBuyNow');

    let lastFocused = null;
    let activeProduct = null;

    function setMainPhoto(src, alt, fallbackLabel) {
        const mainPhoto = document.getElementById('productModalMainPhoto');
        mainPhoto.src = src;
        mainPhoto.alt = alt;
        mainPhoto.onerror = function () {
            this.onerror = null;
            this.src = 'https://placehold.co/500x375/232323/666?text=' + encodeURIComponent(fallbackLabel || 'PRODUCT');
        };
    }

    function renderGallery(product) {
        const thumbsWrap = document.getElementById('productModalThumbs');
        const images = product.gallery && product.gallery.length ? product.gallery : [];

        setMainPhoto(images[0], product.name, product.brand);

        thumbsWrap.innerHTML = '';
        images.forEach(function (src, index) {
            const thumbBtn = document.createElement('button');
            thumbBtn.type = 'button';
            thumbBtn.className = 'thumb-btn' + (index === 0 ? ' active' : '');
            thumbBtn.setAttribute('aria-label', product.name + ' photo ' + (index + 1));

            const thumbImg = document.createElement('img');
            thumbImg.src = src;
            thumbImg.alt = '';
            thumbImg.loading = 'lazy';
            thumbImg.onerror = function () {
                this.onerror = null;
                this.src = 'https://placehold.co/200x200/232323/666?text=' + encodeURIComponent(product.brand || 'PRODUCT');
            };

            thumbBtn.appendChild(thumbImg);
            thumbBtn.addEventListener('click', function () {
                setMainPhoto(src, product.name, product.brand);
                thumbsWrap.querySelectorAll('.thumb-btn').forEach(b => b.classList.remove('active'));
                thumbBtn.classList.add('active');
            });

            thumbsWrap.appendChild(thumbBtn);
        });
    }

    function openModal(product) {
        activeProduct = product;

        renderGallery(product);

        document.getElementById('productModalBrand').textContent = product.brand;
        document.getElementById('productModalName').textContent = product.name;
        document.getElementById('productModalPrice').textContent = 'PHP ' + product.price;
        document.getElementById('productModalDescription').textContent = product.description;

        document.getElementById('productModalFeatures').innerHTML =
            product.features.map(f => `<li>${f}</li>`).join('');

        document.getElementById('productModalSteps').innerHTML =
            product.howToUse.map(s => `<li>${s}</li>`).join('');

        if (addToCartBtn) {
            addToCartBtn.dataset.id = product.id;
            addToCartBtn.dataset.name = product.name;
            addToCartBtn.dataset.price = product.price;
        }
        if (buyNowBtn) {
            buyNowBtn.dataset.id = product.id;
            buyNowBtn.dataset.name = product.name;
            buyNowBtn.dataset.price = product.price;
        }
        updateProductModalStock();

        lastFocused = document.activeElement;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        closeBtn.focus();
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = '';
        activeProduct = null;
        if (lastFocused) lastFocused.focus();
    }

    // Keeps Tab cycling inside the modal while it's open, instead of
    // letting a keyboard user tab out into the page (and the rest of the
    // product grid) sitting behind it — Escape-to-close already existed,
    // this covers the other half of expected modal keyboard behavior.
    modal.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab' || modal.hidden) return;
        const focusable = modal.querySelectorAll(
            'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });

    // "View More Details" buttons are static in the markup, so a single
    // delegated listener on the grid covers all of them.
    grid.addEventListener('click', function (e) {
        const btn = e.target.closest('.product-view-more');
        if (!btn) return;
        const product = findProduct(btn.dataset.productId);
        if (product) openModal(product);
    });

    // The modal's own Add to Cart / Buy Now reuse the same login-gated
    // cart logic (isLoggedIn / openAuthGate / addToCart) defined in
    // main.js, which is loaded on this page before products.js. Both
    // handlers await addToCart() now that it talks to Supabase instead
    // of localStorage — Buy Now in particular depends on the resolved
    // true/false to decide whether it's safe to redirect.
    // Same spinner → confirmation/error language as the card buttons
    // (.is-loading / .is-added / .has-error, defined in products.css) —
    // previously this only toggled `disabled`, so opening a product and
    // adding it from the modal gave noticeably weaker feedback than doing
    // the same thing from the grid.
    if (addToCartBtn) {
        const originalLabel = addToCartBtn.innerHTML;

        addToCartBtn.addEventListener('click', async function () {
            if (!activeProduct || addToCartBtn.disabled || addToCartBtn.classList.contains('is-loading')) return;
            if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
                openAuthGate({ id: activeProduct.id, name: activeProduct.name, price: activeProduct.price });
                return;
            }

            addToCartBtn.classList.remove('is-added', 'has-error');
            addToCartBtn.classList.add('is-loading');

            let added = false;
            try {
                added = await addToCart(activeProduct.id, activeProduct.name, activeProduct.price);
            } finally {
                addToCartBtn.classList.remove('is-loading');
                updateProductModalStock();
            }

            if (added) {
                addToCartBtn.classList.add('is-added');
                addToCartBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Added';
                if (typeof bumpCartCount === 'function') bumpCartCount();
                setTimeout(function () {
                    addToCartBtn.classList.remove('is-added');
                    addToCartBtn.innerHTML = originalLabel;
                }, 1600);
            } else {
                addToCartBtn.classList.add('has-error');
                addToCartBtn.textContent = (typeof addToCart !== 'undefined' && addToCart.lastError) || "Couldn't add";
                setTimeout(function () {
                    addToCartBtn.classList.remove('has-error');
                    addToCartBtn.innerHTML = originalLabel;
                }, 2200);
            }
        });
    }

    if (buyNowBtn) {
        const originalLabel = buyNowBtn.innerHTML;

        buyNowBtn.addEventListener('click', async function () {
            if (!activeProduct || buyNowBtn.disabled || buyNowBtn.classList.contains('is-loading')) return;
            if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
                openAuthGate({ id: activeProduct.id, name: activeProduct.name, price: activeProduct.price });
                return;
            }

            buyNowBtn.classList.remove('has-error');
            buyNowBtn.classList.add('is-loading');

            let added = false;
            try {
                added = await addToCart(activeProduct.id, activeProduct.name, activeProduct.price, 1, { silent: true });
            } finally {
                updateProductModalStock();
            }

            if (!added) {
                buyNowBtn.classList.remove('is-loading');
                buyNowBtn.classList.add('has-error');
                buyNowBtn.textContent = (typeof addToCart !== 'undefined' && addToCart.lastError) || "Couldn't add";
                setTimeout(function () {
                    buyNowBtn.classList.remove('has-error');
                    buyNowBtn.innerHTML = originalLabel;
                }, 2200);
                return;
            }

            const cartLink = document.getElementById('cartIcon');
            if (cartLink) window.location.href = cartLink.getAttribute('href');
        });
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (returnBtn) returnBtn.addEventListener('click', closeModal);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    initProductModal();
    loadCatalogAndStock();
});