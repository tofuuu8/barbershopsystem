// ============================================================
// ADMIN — USERS PAGE (REVISED - No Status Column)
// ============================================================

let allUsers = [];
let currentAdmin = null;
let activeActionUserId = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return;

    const emailEl = document.getElementById('adminSidebarEmail');
    if (emailEl) emailEl.textContent = currentAdmin.email;

    initLogout();
    initSearch();
    initEditModal();
    await loadUsers();
});

function initLogout() {
    const btn = document.getElementById('adminLogoutBtn');
    if (btn) btn.addEventListener('click', adminLogOut);
}

// ============================================================
// LOAD USERS
// ============================================================
async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, email, phone, address, created_at, is_admin')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error(error);
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="6">Couldn't load users — ${escapeHtml(error.message || 'please refresh.')}</td></tr>`;
        return;
    }

    allUsers = (data || []).map(u => ({
        ...u,
        is_admin: u.is_admin || false
    }));

    renderStats();
    renderTable(allUsers);
}

// ============================================================
// STATS
// ============================================================
function renderStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const newThisMonth = allUsers.filter(u => u.created_at && new Date(u.created_at) >= monthStart).length;
    const adminCount = allUsers.filter(u => u.is_admin).length;

    setText('statTotalUsers', allUsers.length);
    setText('statNewThisMonth', newThisMonth);
    setText('statAdmins', adminCount);
}

// ============================================================
// SEARCH
// ============================================================
function initSearch() {
    const input = document.getElementById('userSearchInput');
    if (!input) return;
    input.addEventListener('input', function () {
        const q = input.value.trim().toLowerCase();
        const filtered = !q
            ? allUsers
            : allUsers.filter(u =>
                (u.full_name || '').toLowerCase().includes(q) ||
                (u.email || '').toLowerCase().includes(q) ||
                (u.phone || '').toLowerCase().includes(q) ||
                (u.address || '').toLowerCase().includes(q)
            );
        renderTable(filtered);
    });
}

// ============================================================
// RENDER TABLE (WITHOUT STATUS COLUMN)
// ============================================================
function renderTable(users) {
    const tbody = document.getElementById('usersTableBody');
    const countEl = document.getElementById('userResultsCount');

    if (countEl) {
        countEl.textContent = `${users.length} of ${allUsers.length}`;
    }

    if (!users.length) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="6">No users match that search.</td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(u => {
        const isSelf = currentAdmin && currentAdmin.id === u.id;

        return `
        <tr data-id="${u.id}">
            <td>
                <strong>${escapeHtml(u.full_name || 'Unnamed')}</strong>
                ${u.is_admin ? ' <span class="admin-badge">ADMIN</span>' : ''}
            </td>
            <td>${escapeHtml(u.email || '—')}</td>
            <td>${escapeHtml(u.phone || '—')}</td>
            <td class="admin-truncate">${escapeHtml(u.address || '—')}</td>
            <td>${formatJoinedDate(u.created_at)}</td>
            <td>
                <div class="admin-action-btns">
                    <button type="button" class="admin-action-btn admin-action-edit" data-action="edit" data-id="${u.id}" title="Edit">
                        <i class="fas fa-pen" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="admin-action-btn admin-action-delete" data-action="delete" data-id="${u.id}" title="Delete" ${isSelf ? 'disabled' : ''}>
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

// ============================================================
// ACTION CLICK HANDLER
// ============================================================
function handleActionClick(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const userId = btn.dataset.id;
    if (!userId || btn.disabled) return;

    if (action === 'edit') openEditModal(userId);
    else if (action === 'delete') handleDelete(userId);
}

// ============================================================
// EDIT MODAL
// ============================================================
function initEditModal() {
    const backdrop = document.getElementById('editModalBackdrop');
    const closeBtn = document.getElementById('editModalCloseBtn');
    const saveBtn = document.getElementById('editSaveBtn');

    if (backdrop) backdrop.addEventListener('click', closeEditModal);
    if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeEditModal();
    });
    if (saveBtn) saveBtn.addEventListener('click', saveEditedUser);

    const emailInput = document.getElementById('editEmail');
    if (emailInput) {
        emailInput.readOnly = true;
        emailInput.title = 'Email can\'t be changed here — it\'s tied to the account\'s login credentials.';
    }
}

function openEditModal(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    activeActionUserId = userId;

    document.getElementById('editFullName').value = user.full_name || '';
    document.getElementById('editEmail').value = user.email || '';
    document.getElementById('editPhone').value = user.phone || '';
    document.getElementById('editAddress').value = user.address || '';
    setText('editSaveStatus', '');

    document.getElementById('editModalBackdrop').hidden = false;
    document.getElementById('editUserModal').hidden = false;
}

function closeEditModal() {
    document.getElementById('editModalBackdrop').hidden = true;
    document.getElementById('editUserModal').hidden = true;
    activeActionUserId = null;
}

async function saveEditedUser() {
    if (!activeActionUserId) return;

    const btn = document.getElementById('editSaveBtn');
    const status = document.getElementById('editSaveStatus');
    const fullName = document.getElementById('editFullName').value.trim();
    const phone = document.getElementById('editPhone').value.trim();
    const address = document.getElementById('editAddress').value.trim();

    if (!fullName) {
        status.style.color = 'var(--bad)';
        status.textContent = 'Please enter a name.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    const { error } = await supabaseClient
        .from('profiles')
        .update({
            full_name: fullName,
            phone: phone || null,
            address: address || null
        })
        .eq('id', activeActionUserId);

    btn.disabled = false;
    btn.textContent = 'Save Changes';

    if (error) {
        console.error(error);
        status.style.color = 'var(--bad)';
        status.textContent = error.message || 'Could not save changes.';
        return;
    }

    const user = allUsers.find(u => u.id === activeActionUserId);
    if (user) {
        user.full_name = fullName;
        user.phone = phone || null;
        user.address = address || null;
    }

    renderStats();
    renderTable(allUsers);
    showToast('User updated successfully!');
    closeEditModal();
}

// ============================================================
// DELETE
// ============================================================
async function handleDelete(userId) {
    if (!confirm('Are you sure you want to DELETE this user? This action cannot be undone!')) return;

    try {
        const { data, error } = await supabaseClient.functions.invoke('delete-user', {
            body: { userId }
        });

        if (error) throw error;
        if (data && data.error) throw new Error(data.error);

        allUsers = allUsers.filter(u => u.id !== userId);
        renderStats();
        renderTable(allUsers);
        showToast('User deleted successfully!');
    } catch (error) {
        console.error('Error deleting user:', error);
        showToast(error.message || 'Error deleting user', 'error');
    }
}

// ============================================================
// TOAST
// ============================================================
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
// HELPERS
// ============================================================
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatJoinedDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}