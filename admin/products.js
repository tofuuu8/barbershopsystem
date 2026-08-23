// ============================================================
// ADMIN — PRODUCTS PAGE
// ============================================================
// Reads/writes `public.products` directly through the anon-key
// client — admin-only write access (and full read access, including
// hidden products) comes from the is_admin() RLS policies in
// products_setup.sql, the same pattern as every other admin table.
//
// `id` is a hand-entered text slug (e.g. 'wax-fox-matte'), not an
// auto-generated uuid — it's the same value stored in
// order_items.product_id, so it can't be changed after creation
// without breaking the link to past orders. The Edit modal disables
// the ID field for that reason.
//
// features / how_to_use / gallery are stored as text[] columns.
// This page edits them as plain multi-line textareas (one entry per
// line) rather than building a dynamic list-editor UI — simplest
// thing that works for a first version.

let allProducts = [];
let activeProductId = null; // null while adding; set to the product's id while editing

document.addEventListener('DOMContentLoaded', async function () {
    const admin = await requireAdminOrRedirect();
    if (!admin) return;

    const emailEl = document.getElementById('adminSidebarEmail');
    if (emailEl) emailEl.textContent = admin.email;

    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogOut);
    initFilters();
    initModal();
    await loadProducts();
});

function showProductsError(message) {
    const el = document.getElementById('productsError');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${message}</span>`;
    el.hidden = false;
}

function hideProductsError() {
    const el = document.getElementById('productsError');
    if (el) el.hidden = true;
}

// --------------------------------------------
// Load
// --------------------------------------------
async function loadProducts() {
    const tbody = document.getElementById('productsTableBody');
    hideProductsError();

    const { data, error } = await supabaseClient
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="6">Couldn\u2019t load products — ${escapeHtml(error.message || '')}</td></tr>`;
        if (/relation .*products.* does not exist/i.test(error.message || '')) {
            showProductsError('The products table doesn\u2019t exist yet — run products_setup.sql in the Supabase SQL Editor first.');
        } else if (/row-level security|permission denied/i.test(error.message || '')) {
            showProductsError('Products table denied this read — check that its admin RLS policy uses the same public.is_admin() check as your other tables.');
        }
        return;
    }

    allProducts = data || [];
    populateCategoryFilter();
    renderStats();
    applyFiltersAndRender();
}

// --------------------------------------------
// Stats
// --------------------------------------------
function stockLevel(product) {
    if (product.stock_quantity <= 0) return 'out';
    if (product.stock_quantity <= (product.low_stock_threshold ?? 5)) return 'low';
    return 'ok';
}

function renderStats() {
    const active = allProducts.filter(p => p.is_active).length;
    const low = allProducts.filter(p => stockLevel(p) === 'low').length;
    const out = allProducts.filter(p => stockLevel(p) === 'out').length;

    setText('statTotalProducts', allProducts.length);
    setText('statActiveProducts', active);
    setText('statLowStockProducts', low);
    setText('statOutOfStockProducts', out);
}

// --------------------------------------------
// Filters
// --------------------------------------------
function populateCategoryFilter() {
    const select = document.getElementById('productCategoryFilter');
    if (!select) return;

    const current = select.value;
    const categories = Array.from(new Set(allProducts.map(p => p.category).filter(Boolean))).sort();

    select.innerHTML = '<option value="">All Categories</option>' +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    if (categories.includes(current)) select.value = current;
}

function initFilters() {
    document.getElementById('productSearchInput').addEventListener('input', applyFiltersAndRender);
    document.getElementById('productCategoryFilter').addEventListener('change', applyFiltersAndRender);
    document.getElementById('productStockFilter').addEventListener('change', applyFiltersAndRender);
    document.getElementById('addProductBtn').addEventListener('click', openAddModal);
}

function applyFiltersAndRender() {
    const q = document.getElementById('productSearchInput').value.trim().toLowerCase();
    const categoryFilter = document.getElementById('productCategoryFilter').value;
    const stockFilter = document.getElementById('productStockFilter').value;

    const filtered = allProducts.filter(p => {
        if (categoryFilter && p.category !== categoryFilter) return false;
        if (stockFilter && stockLevel(p) !== stockFilter) return false;
        if (q) {
            const haystack = `${p.name || ''} ${p.brand || ''}`.toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });

    renderTable(filtered);
}

// --------------------------------------------
// Table
// --------------------------------------------
function stockBadge(product) {
    const level = stockLevel(product);
    const labels = { ok: 'In Stock', low: 'Low Stock', out: 'Out of Stock' };
    return `<span class="admin-stock-badge admin-stock-badge--${level}">${labels[level]} (${product.stock_quantity})</span>`;
}

function visibilityBadge(product) {
    return product.is_active
        ? `<span class="admin-visibility-badge admin-visibility-badge--active">Active</span>`
        : `<span class="admin-visibility-badge">Hidden</span>`;
}

function renderTable(products) {
    const tbody = document.getElementById('productsTableBody');
    const countEl = document.getElementById('productResultsCount');

    if (countEl) countEl.textContent = `${products.length} of ${allProducts.length}`;

    if (!products.length) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="6">No products match those filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = products.map(p => {
        const image = (p.gallery && p.gallery[0]) || '';
        return `
        <tr data-id="${escapeHtml(p.id)}">
            <td>
                <div class="admin-product-cell">
                    <div class="admin-product-thumb">
                        <img src="${escapeHtml(image)}" alt="" loading="lazy"
                             onerror="this.src='https://placehold.co/88x88/232323/666?text=Item'" />
                    </div>
                    <div>
                        <span class="admin-cell-primary">${escapeHtml(p.name || 'Unnamed')}</span>
                        ${p.brand ? `<span class="admin-cell-sub">${escapeHtml(p.brand)}</span>` : ''}
                    </div>
                </div>
            </td>
            <td>${escapeHtml(p.category || '\u2014')}</td>
            <td>${formatPHP(p.price)}</td>
            <td>${stockBadge(p)}</td>
            <td>${visibilityBadge(p)}</td>
            <td>
                <div class="admin-action-btns">
                    <button type="button" class="admin-action-btn" data-action="edit" data-id="${escapeHtml(p.id)}" title="Edit">
                        <i class="fas fa-pen" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="admin-action-btn" data-action="toggle-active" data-id="${escapeHtml(p.id)}" title="${p.is_active ? 'Hide from storefront' : 'Make active'}">
                        <i class="fas ${p.is_active ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="admin-action-btn admin-action-delete" data-action="delete" data-id="${escapeHtml(p.id)}" title="Delete">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.admin-action-btn').forEach(btn => {
        btn.addEventListener('click', handleActionClick);
    });
}

function handleActionClick(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!id) return;

    if (action === 'edit') openEditModal(id);
    else if (action === 'toggle-active') handleToggleActive(id);
    else if (action === 'delete') handleDelete(id);
}

// --------------------------------------------
// Toggle active / Delete
// --------------------------------------------
async function handleToggleActive(id) {
    const product = allProducts.find(p => p.id === id);
    if (!product) return;

    const newActive = !product.is_active;

    try {
        const { error } = await supabaseClient
            .from('products')
            .update({ is_active: newActive })
            .eq('id', id);

        if (error) throw error;

        product.is_active = newActive;
        renderStats();
        applyFiltersAndRender();
        showToast(newActive ? 'Product is now active.' : 'Product hidden from storefront.');
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Error updating product', 'error');
    }
}

async function handleDelete(id) {
    if (!confirm('Delete this product? This can\u2019t be undone. (Past orders that included it aren\u2019t affected — they keep their own copy of the product name/price.)')) return;

    try {
        const { error } = await supabaseClient
            .from('products')
            .delete()
            .eq('id', id);

        if (error) throw error;

        allProducts = allProducts.filter(p => p.id !== id);
        populateCategoryFilter();
        renderStats();
        applyFiltersAndRender();
        showToast('Product deleted.');
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Error deleting product', 'error');
    }
}

// --------------------------------------------
// Add / Edit modal
// --------------------------------------------
function initModal() {
    const backdrop = document.getElementById('productModalBackdrop');
    const closeBtn = document.getElementById('productModalCloseBtn');
    const saveBtn = document.getElementById('productSaveBtn');

    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    if (saveBtn) saveBtn.addEventListener('click', saveProduct);
}

function linesToArray(text) {
    return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function arrayToLines(arr) {
    return (arr || []).join('\n');
}

function fillModalFields(product) {
    document.getElementById('productIdInput').value = product ? product.id : '';
    document.getElementById('productIdInput').disabled = !!product;
    document.getElementById('productIdNote').style.display = product ? 'none' : '';
    document.getElementById('productNameInput').value = product ? (product.name || '') : '';
    document.getElementById('productBrandInput').value = product ? (product.brand || '') : '';
    document.getElementById('productCategoryInput').value = product ? (product.category || '') : '';
    document.getElementById('productPriceInput').value = product ? product.price : '';
    document.getElementById('productStockInput').value = product ? product.stock_quantity : 0;
    document.getElementById('productLowStockInput').value = product ? product.low_stock_threshold : 5;
    document.getElementById('productDescriptionInput').value = product ? (product.description || '') : '';
    document.getElementById('productFeaturesInput').value = product ? arrayToLines(product.features) : '';
    document.getElementById('productHowToUseInput').value = product ? arrayToLines(product.how_to_use) : '';
    document.getElementById('productGalleryInput').value = product ? arrayToLines(product.gallery) : '';
    document.getElementById('productActiveInput').checked = product ? !!product.is_active : true;
}

function openAddModal() {
    activeProductId = null;
    setText('productModalTitle', 'Add Product');
    fillModalFields(null);
    setText('productSaveStatus', '');
    document.getElementById('productModalBackdrop').hidden = false;
    document.getElementById('productModal').hidden = false;
}

function openEditModal(id) {
    const product = allProducts.find(p => p.id === id);
    if (!product) return;

    activeProductId = id;
    setText('productModalTitle', `Edit — ${product.name || product.id}`);
    fillModalFields(product);
    setText('productSaveStatus', '');
    document.getElementById('productModalBackdrop').hidden = false;
    document.getElementById('productModal').hidden = false;
}

function closeModal() {
    document.getElementById('productModalBackdrop').hidden = true;
    document.getElementById('productModal').hidden = true;
    activeProductId = null;
}

function showSaveStatus(message, isError) {
    const el = document.getElementById('productSaveStatus');
    if (!el) return;
    el.style.color = isError ? 'var(--bad)' : 'var(--good)';
    el.textContent = message;
}

async function saveProduct() {
    const isEditing = !!activeProductId;

    const id = document.getElementById('productIdInput').value.trim();
    const name = document.getElementById('productNameInput').value.trim();
    const brand = document.getElementById('productBrandInput').value.trim();
    const category = document.getElementById('productCategoryInput').value.trim();
    const price = Number(document.getElementById('productPriceInput').value);
    const stock = Number(document.getElementById('productStockInput').value);
    const lowStock = Number(document.getElementById('productLowStockInput').value);
    const description = document.getElementById('productDescriptionInput').value.trim();
    const features = linesToArray(document.getElementById('productFeaturesInput').value);
    const howToUse = linesToArray(document.getElementById('productHowToUseInput').value);
    const gallery = linesToArray(document.getElementById('productGalleryInput').value);
    const isActive = document.getElementById('productActiveInput').checked;

    if (!isEditing && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
        showSaveStatus('Product ID must be lowercase letters, numbers, and hyphens only (e.g. wax-fox-matte).', true);
        return;
    }
    if (!name) {
        showSaveStatus('Please enter a product name.', true);
        return;
    }
    if (!Number.isFinite(price) || price < 0) {
        showSaveStatus('Please enter a valid price.', true);
        return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
        showSaveStatus('Please enter a valid stock quantity.', true);
        return;
    }

    const btn = document.getElementById('productSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const payload = {
        name,
        brand: brand || null,
        category: category || null,
        price,
        stock_quantity: stock,
        low_stock_threshold: Number.isInteger(lowStock) && lowStock >= 0 ? lowStock : 5,
        description: description || null,
        features,
        how_to_use: howToUse,
        gallery,
        is_active: isActive
    };

    let error;
    if (isEditing) {
        ({ error } = await supabaseClient.from('products').update(payload).eq('id', activeProductId));
    } else {
        ({ error } = await supabaseClient.from('products').insert({ id, ...payload }));
    }

    btn.disabled = false;
    btn.textContent = 'Save Product';

    if (error) {
        console.error(error);
        showSaveStatus(
            /duplicate key/i.test(error.message || '')
                ? 'A product with that ID already exists.'
                : (error.message || 'Could not save product.'),
            true
        );
        return;
    }

    showSaveStatus('Saved.', false);
    await loadProducts();
    showToast(isEditing ? 'Product updated.' : 'Product added.');
    closeModal();
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatPHP(amount) {
    return 'PHP ' + Number(amount || 0).toLocaleString('en-PH');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// --------------------------------------------
// Toast — same look/behavior used on every other admin page.
// --------------------------------------------
function showToast(message, type = 'success') {
    let toast = document.getElementById('adminToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'adminToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: all 0.3s ease;
            transform: translateY(100px);
            opacity: 0;
        `;
        document.body.appendChild(toast);
    }

    const colors = { success: '#16a34a', error: '#dc2626', warning: '#d97706' };

    toast.textContent = message;
    toast.style.backgroundColor = colors[type] || colors.success;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
    }, 3000);
}