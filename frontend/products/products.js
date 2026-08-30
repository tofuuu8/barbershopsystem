// ============================================
// PRODUCTS PAGE — PRODUCT DETAILS MODAL
// ============================================
// Data-id values below match the data-id / data-product-id attributes
// already used on the .product-btn / .product-buy-btn / .product-view-more
// buttons in products.html, so this file is the single source of truth
// for product copy (description, features, how-to-use) shown in the modal.
const productsCatalog = [
    {
        id: 'wax-fox-matte',
        name: 'Matte Molding Wax',
        brand: 'FOX',
        price: 250,
        gallery: [
            '../images/products/matte-wax.jpg',
            'https://placehold.co/500x375/232323/8a8a8a?text=In+Use',
            'https://placehold.co/500x375/232323/8a8a8a?text=Texture'
        ],
        description: 'A low-shine, high-hold molding wax built for texture. Works into dry hair without leaving any greasy residue, so the finish stays natural and matte all day.',
        features: [
            'Matte, no-shine finish',
            'Strong all-day hold',
            'Easily reworkable — restyle anytime without washing',
            'Water-based, washes out clean'
        ],
        howToUse: [
            'Start with dry or towel-dried hair.',
            'Scrape a small, pea-sized amount with your fingertip.',
            'Rub between palms until it warms and turns matte.',
            'Work through hair from roots to ends, shaping as you go.',
            'Add a touch more if you need extra hold or texture.'
        ]
    },
    {
        id: 'wax-atlas-natural',
        name: 'Natural Styling Wax',
        brand: 'ATLAS',
        price: 350,
        gallery: [
            '../images/products/natural-wax.jpg',
            'https://placehold.co/500x375/232323/8a8a8a?text=In+Use',
            'https://placehold.co/500x375/232323/8a8a8a?text=Texture'
        ],
        description: 'A medium-hold wax for a natural, undone look. Gives just enough definition to hold a style without the stiff, "product-y" feel.',
        features: [
            'Medium, flexible hold',
            'Natural low-shine finish',
            'Lightweight — won\u2019t weigh hair down',
            'Great for everyday, low-effort styling'
        ],
        howToUse: [
            'Apply to towel-dried or dry hair.',
            'Take a dime-sized amount and warm it between your palms.',
            'Distribute evenly through the hair with your fingers.',
            'Style as usual, focusing on the top and fringe.',
            'Comb lightly for a more polished look, or leave textured for a natural finish.'
        ]
    },
    {
        id: 'wax-premium',
        name: 'Premium Styling Wax',
        brand: 'Toughcuts',
        price: 450,
        gallery: [
            '../images/products/premium-wax.jpg',
            'https://placehold.co/500x375/232323/8a8a8a?text=In+Use',
            'https://placehold.co/500x375/232323/8a8a8a?text=Packaging'
        ],
        description: 'Our house-formula wax, the same one your barber reaches for in the chair. Strong hold with a soft satin finish that never looks stiff.',
        features: [
            'Barber-grade strong hold',
            'Satin finish — not too matte, not too shiny',
            'Long-lasting through humidity and heat',
            'Subtle, clean fragrance'
        ],
        howToUse: [
            'Work with dry hair for maximum hold.',
            'Scoop a small amount and rub it between your fingertips to soften.',
            'Apply evenly from the back of the head forward.',
            'Shape your style with your fingers or a comb.',
            'Let it set for a minute before touching up any flyaways.'
        ]
    },
    {
        id: 'spray-fox-matte',
        name: 'Solid Matte Spray',
        brand: 'FOX',
        price: 400,
        gallery: [
            '../images/products/matte-spray.jpg',
            'https://placehold.co/500x375/232323/8a8a8a?text=In+Use',
            'https://placehold.co/500x375/232323/8a8a8a?text=Packaging'
        ],
        description: 'A fine-mist finishing spray that locks a style in place with zero shine and zero stiffness — built to hold, not cake.',
        features: [
            'Ultra-matte, no-shine finish',
            'Flexible hold that still moves naturally',
            'Fast-drying fine mist',
            'No white residue or flaking'
        ],
        howToUse: [
            'Style your hair first with wax or cream as needed.',
            'Hold the can 20–30 cm away from your head.',
            'Spray evenly in short bursts across the finished style.',
            'Avoid over-spraying one section — a light, even coat holds best.',
            'Let it air-dry for a few seconds before touching your hair.'
        ]
    },
    {
        id: 'spray-atlas-volume',
        name: 'Volume Boost Spray',
        brand: 'ATLAS',
        price: 380,
        gallery: [
            '../images/products/volume-spray.jpg',
            'https://placehold.co/500x375/232323/8a8a8a?text=In+Use',
            'https://placehold.co/500x375/232323/8a8a8a?text=Packaging'
        ],
        description: 'A root-lifting spray that adds volume and body to flat or fine hair, without any greasy build-up.',
        features: [
            'Lifts and thickens at the root',
            'Lightweight, non-greasy formula',
            'Adds texture for easier styling',
            'Works on damp or dry hair'
        ],
        howToUse: [
            'Section hair and spray directly at the roots on damp hair.',
            'Blow-dry with fingers lifting the roots for maximum volume.',
            'On dry hair, spray lightly and tousle with your fingers for a quick refresh.',
            'Finish styling as usual once volume is set.'
        ]
    },
    {
        id: 'spray-premium-hold',
        name: 'Premium Hold Spray',
        brand: 'Toughcuts',
        price: 420,
        gallery: [
            '../images/products/premium-hold-spray.jpg',
            'https://placehold.co/500x375/232323/8a8a8a?text=In+Use',
            'https://placehold.co/500x375/232323/8a8a8a?text=Packaging'
        ],
        description: 'Maximum hold finishing spray for styles that need to survive a full day — sharp fades, structured quiffs, and everything in between.',
        features: [
            'Maximum, all-day hold',
            'Natural shine — not glossy, not dull',
            'Humidity and sweat resistant',
            'Brushes out easily at the end of the day'
        ],
        howToUse: [
            'Complete your style with your usual wax or cream first.',
            'Hold the can about 25 cm from your head.',
            'Spray in a sweeping motion, focusing on areas that need the most hold.',
            'Let it set for 30 seconds before touching up.',
            'Reapply lightly midday if needed for extra hold.'
        ]
    }
];

// --------------------------------------------
// CUSTOMER STOCK AVAILABILITY
// --------------------------------------------
// The customer catalog is still defined in products.html/productsCatalog,
// but stock is read from the authoritative products table. Purchase buttons
// stay disabled until this request finishes, so a missing table or failed
// request fails closed instead of allowing a known-unavailable purchase.
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

    element.textContent = message;
    element.className = `product-stock ${statusClass}`;
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

async function loadCustomerStock() {
    renderCustomerStockStates();

    if (typeof supabaseClient === 'undefined') {
        customerStockState.error = true;
        renderCustomerStockStates();
        return;
    }

    const productIds = productsCatalog.map(product => product.id);
    const { data, error } = await supabaseClient
        .from('products')
        .select('id, stock_quantity, low_stock_threshold, is_active')
        .in('id', productIds);

    if (error) {
        console.error('Could not load product availability:', error);
        customerStockState.error = true;
        renderCustomerStockStates();
        updateProductModalStock();
        return;
    }

    customerStockState.byId.clear();
    (data || []).forEach(product => {
        const stock = Number(product.stock_quantity);
        const threshold = Number(product.low_stock_threshold);
        customerStockState.byId.set(String(product.id), {
            isActive: product.is_active !== false,
            stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
            lowStockThreshold: Number.isFinite(threshold) ? Math.max(0, Math.floor(threshold)) : 5
        });
    });
    customerStockState.ready = true;
    renderCustomerStockStates();
    updateProductModalStock();
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
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async function () {
            if (!activeProduct || addToCartBtn.disabled) return;
            if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
                openAuthGate({ id: activeProduct.id, name: activeProduct.name, price: activeProduct.price });
                return;
            }
            addToCartBtn.disabled = true;
            try {
                await addToCart(activeProduct.id, activeProduct.name, activeProduct.price);
            } finally {
                updateProductModalStock();
            }
        });
    }

    if (buyNowBtn) {
        buyNowBtn.addEventListener('click', async function () {
            if (!activeProduct || buyNowBtn.disabled) return;
            if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
                openAuthGate({ id: activeProduct.id, name: activeProduct.name, price: activeProduct.price });
                return;
            }
            buyNowBtn.disabled = true;
            let added = false;
            try {
                added = await addToCart(activeProduct.id, activeProduct.name, activeProduct.price, 1, { silent: true });
            } finally {
                updateProductModalStock();
            }
            if (!added) return;
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
    loadCustomerStock();
});