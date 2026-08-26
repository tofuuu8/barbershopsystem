// ============================================================
// ADMIN — BARBERS PAGE
// ============================================================

let allBarbers = [];
let currentAdmin = null;
let activeBarberId = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return;

    document.getElementById('adminSidebarEmail').textContent = currentAdmin.email;
    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogOut);

    initBarberModal();
    await loadBarbers();
});

// ============================================================
// LOAD BARBERS
// ============================================================

async function loadBarbers() {
    const { data, error } = await supabaseClient
        .from('barbers')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error loading barbers:', error);
        document.getElementById('barbersTableBody').innerHTML = 
            '<tr class="admin-empty-row"><td colspan="5">Could not load barbers.</td></tr>';
        return;
    }

    allBarbers = data || [];
    renderStats();
    renderTable();
}

// ============================================================
// RENDER STATS
// ============================================================

function renderStats() {
    const active = allBarbers.filter(b => b.is_active).length;
    const inactive = allBarbers.filter(b => !b.is_active).length;

    document.getElementById('statTotalBarbers').textContent = allBarbers.length;
    document.getElementById('statActiveBarbers').textContent = active;
    document.getElementById('statInactiveBarbers').textContent = inactive;
}

// ============================================================
// RENDER TABLE
// ============================================================

function renderTable() {
    const tbody = document.getElementById('barbersTableBody');

    if (!allBarbers.length) {
        tbody.innerHTML = '<tr class="admin-empty-row"><td colspan="5">No barbers yet. Add your first barber!</td></tr>';
        return;
    }

    tbody.innerHTML = allBarbers.map(b => `
        <tr>
            <td>
                <div style="display:flex; align-items:center; gap:12px;">
                    ${b.image_url ? `<img src="${escapeHtml(b.image_url)}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;" />` : ''}
                    <div>
                        <strong>${escapeHtml(b.name)}</strong>
                        <div class="admin-cell-sub">${escapeHtml(b.title || 'Barber')}</div>
                    </div>
                </div>
            </td>
            <td>${escapeHtml(b.specialties || '—')}</td>
            <td>${b.experience || 0} yrs · ⭐ ${b.rating || 0}</td>
            <td>
                <span class="admin-status-badge ${b.is_active ? 'admin-status-online' : 'admin-status-offline'}">
                    ${b.is_active ? '🟢 Active' : '🔴 Inactive'}
                </span>
            </td>
            <td>
                <div class="admin-action-btns">
                    <button class="admin-action-btn admin-action-edit" data-id="${escapeHtml(b.id)}" data-action="edit" title="Edit">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="admin-action-btn ${b.is_active ? 'admin-action-block' : 'admin-action-unblock'}" 
                            data-id="${escapeHtml(b.id)}" data-action="toggle" 
                            title="${b.is_active ? 'Deactivate' : 'Activate'}">
                        <i class="fas ${b.is_active ? 'fa-eye-slash' : 'fa-eye'}"></i>
                    </button>
                    <button class="admin-action-btn admin-action-delete" data-id="${escapeHtml(b.id)}" data-action="delete" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // ATTACH EVENT LISTENERS
    tbody.querySelectorAll('.admin-action-btn').forEach(btn => {
        btn.addEventListener('click', handleBarberAction);
    });
}

// ============================================================
// HANDLE BARBER ACTIONS
// ============================================================

function handleBarberAction(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    const action = btn.dataset.action;

    console.log('🔄 Barber action:', action, 'ID:', id);  // ← MAGDAGDAG NG LOG

    if (action === 'toggle') {
        toggleBarberStatus(id);
    } else if (action === 'delete') {
        deleteBarber(id);
    } else {
        openEditBarberModal(id);  // ← DAPAT ITO ANG TUMAKBO SA EDIT
    }
}


// ============================================================
// TOGGLE BARBER STATUS
// ============================================================

async function toggleBarberStatus(id) {
    const barber = allBarbers.find(b => b.id === id);
    if (!barber) return;

    const newStatus = !barber.is_active;
    const action = newStatus ? 'activate' : 'deactivate';

    if (!confirm(`Are you sure you want to ${action} this barber?`)) return;

    const { error } = await supabaseClient
        .from('barbers')
        .update({ is_active: newStatus })
        .eq('id', id);

    if (error) {
        showToast('Error updating barber status', 'error');
        return;
    }

    barber.is_active = newStatus;
    renderStats();
    renderTable();
    showToast(`Barber ${action}d successfully!`);
}

// ============================================================
// DELETE BARBER
// ============================================================

async function deleteBarber(id) {
    if (!confirm('Delete this barber? This cannot be undone.')) return;

    const { error } = await supabaseClient
        .from('barbers')
        .delete()
        .eq('id', id);

    if (error) {
        showToast('Error deleting barber', 'error');
        return;
    }

    allBarbers = allBarbers.filter(b => b.id !== id);
    renderStats();
    renderTable();
    showToast('Barber deleted successfully!');
}

// ============================================================
// BARBER MODAL
// ============================================================

function initBarberModal() {
    document.getElementById('barberModalCloseBtn').addEventListener('click', closeBarberModal);
    document.getElementById('barberModalBackdrop').addEventListener('click', closeBarberModal);
    document.getElementById('barberSaveBtn').addEventListener('click', saveBarber);
    document.getElementById('addBarberBtn').addEventListener('click', openAddBarberModal);

    // Image preview
    const fileInput = document.getElementById('barberImageInput');
    const previewDiv = document.getElementById('imagePreview');
    const previewImg = document.getElementById('imagePreviewImg');
    const removeBtn = document.getElementById('removeImageBtn');

    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    previewImg.src = event.target.result;
                    previewDiv.style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', function() {
            fileInput.value = '';
            previewDiv.style.display = 'none';
            previewImg.src = '';
            delete fileInput.dataset.existingUrl;
        });
    }
}


function openEditBarberModal(id) {
    const barber = allBarbers.find(b => b.id === id);
    if (!barber) return;

    activeBarberId = id;
    document.getElementById('barberIdInput').value = barber.id || '';
    document.getElementById('barberModalTitle').textContent = 'Edit Barber';
    document.getElementById('barberNameInput').value = barber.name || '';
    document.getElementById('barberEmailInput').value = barber.email || '';
    document.getElementById('barberPhoneInput').value = barber.phone || '';
    document.getElementById('barberGenderInput').value = barber.service_gender || 'all';
    document.getElementById('barberTitleInput').value = barber.title || '';
    document.getElementById('barberBioInput').value = barber.bio || '';
    document.getElementById('barberSpecialtiesInput').value = barber.specialties || '';
    document.getElementById('barberExperienceInput').value = barber.experience || '';
    document.getElementById('barberRatingReviewsDisplay').textContent =
        `⭐ ${barber.rating || 0} · ${barber.reviews || 0} review${barber.reviews === 1 ? '' : 's'}`;
    document.getElementById('barberActiveInput').checked = barber.is_active;
    document.getElementById('barberSaveStatus').textContent = '';

    // Show existing image
    const fileInput = document.getElementById('barberImageInput');
    const previewDiv = document.getElementById('imagePreview');
    const previewImg = document.getElementById('imagePreviewImg');
    
    if (barber.image_url) {
        fileInput.dataset.existingUrl = barber.image_url;
        previewImg.src = barber.image_url;
        previewDiv.style.display = 'block';
    } else {
        previewDiv.style.display = 'none';
    }
    
    document.getElementById('barberModalBackdrop').hidden = false;
    document.getElementById('barberModal').hidden = false;
}
function closeBarberModal() {
    document.getElementById('barberModalBackdrop').hidden = true;
    document.getElementById('barberModal').hidden = true;
    activeBarberId = null;
}


// ============================================================
// HELPERS
// ============================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
}

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

// ============================================================
// UPDATED BARBER FORM FIELDS
// ============================================================

function openAddBarberModal() {
    activeBarberId = null;
    document.getElementById('barberIdInput').value = '';
    document.getElementById('barberModalTitle').textContent = 'Add Barber';
    document.getElementById('barberNameInput').value = '';
    document.getElementById('barberEmailInput').value = '';
    document.getElementById('barberPhoneInput').value = '';
    document.getElementById('barberGenderInput').value = 'all';
    document.getElementById('barberTitleInput').value = '';          // NEW
    document.getElementById('barberBioInput').value = '';
    document.getElementById('barberSpecialtiesInput').value = '';
    document.getElementById('barberExperienceInput').value = '';     // NEW
    document.getElementById('barberRatingReviewsDisplay').textContent = '⭐ 0 · 0 reviews (none yet)';
    document.getElementById('barberImageInput').value = '';          // NEW
    document.getElementById('barberActiveInput').checked = true;
    document.getElementById('barberSaveStatus').textContent = '';
    document.getElementById('barberModalBackdrop').hidden = false;
    document.getElementById('barberModal').hidden = false;
}

// ============================================================
// SAVE BARBER (WITH IMAGE UPLOAD)
// ============================================================

async function saveBarber() {
    const name = document.getElementById('barberNameInput').value.trim();
    const email = document.getElementById('barberEmailInput').value.trim();
    const phone = document.getElementById('barberPhoneInput').value.trim();
    const serviceGender = document.getElementById('barberGenderInput').value;
    const title = document.getElementById('barberTitleInput').value.trim();
    const bio = document.getElementById('barberBioInput').value.trim();
    const specialties = document.getElementById('barberSpecialtiesInput').value.trim();
    const experience = parseInt(document.getElementById('barberExperienceInput').value) || 0;
    // rating/reviews are no longer editable here — they're auto-calculated
    // from the reviews table by a Supabase trigger (see reviews-rating-sync.sql)
    // and left untouched on every save.
    const isActive = document.getElementById('barberActiveInput').checked;
    
    // Get image file
    const fileInput = document.getElementById('barberImageInput');
    const file = fileInput.files[0];
    
    // Get existing image URL (if editing and no new file)
    let imageUrl = document.getElementById('barberImageInput').dataset.existingUrl || '';

    if (!name) {
        document.getElementById('barberSaveStatus').textContent = 'Please enter a name.';
        document.getElementById('barberSaveStatus').style.color = 'var(--bad)';
        return;
    }
    if (!['all', 'men', 'women'].includes(serviceGender)) {
        document.getElementById('barberSaveStatus').textContent = 'Please choose who this barber serves.';
        document.getElementById('barberSaveStatus').style.color = 'var(--bad)';
        return;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
        document.getElementById('barberSaveStatus').textContent = 'Please enter a valid email address.';
        document.getElementById('barberSaveStatus').style.color = 'var(--bad)';
        return;
    }

    const btn = document.getElementById('barberSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    // Generate ID
    let barberId = activeBarberId || document.getElementById('barberIdInput')?.value?.trim();
    if (!barberId) {
        const nameSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const random = Math.floor(Math.random() * 1000);
        barberId = `barber-${nameSlug}-${random}`;
    }
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(barberId)) {
        btn.disabled = false;
        btn.textContent = 'Save Barber';
        document.getElementById('barberSaveStatus').textContent = 'Barber ID must use lowercase letters, numbers, and hyphens.';
        document.getElementById('barberSaveStatus').style.color = 'var(--bad)';
        return;
    }

    // Upload image if a file was selected
    if (file) {
        const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
        if (!allowedTypes.has(file.type) || file.size > 2 * 1024 * 1024) {
            btn.disabled = false;
            btn.textContent = 'Save Barber';
            document.getElementById('barberSaveStatus').textContent = 'Use a JPG, PNG, or WEBP image up to 2 MB.';
            document.getElementById('barberSaveStatus').style.color = 'var(--bad)';
            return;
        }
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${barberId}.${fileExt}`;
            const filePath = `barbers/${fileName}`;

            const { error: uploadError } = await supabaseClient.storage
                .from('barber-images')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                // Fallback: use the file name as relative path
                imageUrl = `../images/${fileName}`;
            } else {
                // Get public URL
                const { data: urlData } = supabaseClient.storage
                    .from('barber-images')
                    .getPublicUrl(filePath);
                imageUrl = urlData.publicUrl;
            }
        } catch (uploadError) {
            console.error('Upload error:', uploadError);
            imageUrl = `../images/${file.name}`;
        }
    }

    const payload = {
        id: barberId,
        name,
        email: email || null,
        phone: phone || null,
        service_gender: serviceGender,
        title: title || null,
        bio: bio || null,
        specialties: specialties || null,
        experience,
        // rating/reviews intentionally omitted — auto-calculated by
        // the reviews-rating-sync.sql trigger, not set from the admin form.
        image_url: imageUrl || null,
        is_active: isActive
    };

    console.log('📝 Saving barber:', payload);

    let error;
    if (activeBarberId) {
        ({ error } = await supabaseClient.from('barbers').update(payload).eq('id', activeBarberId));
    } else {
        ({ error } = await supabaseClient.from('barbers').insert(payload));
    }

    btn.disabled = false;
    btn.textContent = 'Save Barber';

    if (error) {
        console.error('❌ Error saving barber:', error);
        document.getElementById('barberSaveStatus').textContent = error.message || 'Error saving barber.';
        document.getElementById('barberSaveStatus').style.color = 'var(--bad)';
        return;
    }

    document.getElementById('barberSaveStatus').textContent = 'Saved successfully!';
    document.getElementById('barberSaveStatus').style.color = 'var(--good)';
    
    await loadBarbers();
    showToast('Barber saved successfully!');
    setTimeout(closeBarberModal, 500);
}