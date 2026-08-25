// ============================================================
// ADMIN — ADMIN ACCOUNT PAGE
// ============================================================

let currentAdmin = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return;

    document.getElementById('adminSidebarEmail').textContent = currentAdmin.email;

    // Load profile
    await loadAdminProfile();

    // Logout
    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogOut);

    // Save profile
    document.getElementById('adminProfileSaveBtn').addEventListener('click', saveAdminProfile);

    // Change password
    document.getElementById('adminPasswordSaveBtn').addEventListener('click', changePassword);

    // ============================================
    // NEW: Password features
    // ============================================
    initPasswordToggles();
    initPasswordStrength();
    initPasswordMatchCheck();
});

// ============================================================
// LOAD ADMIN PROFILE
// ============================================================

async function loadAdminProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('full_name, email')
        .eq('id', currentAdmin.id)
        .single();

    if (error) {
        console.error('Error loading profile:', error);
        return;
    }

    document.getElementById('adminFullName').value = data.full_name || '';
    document.getElementById('adminEmailInput').value = data.email || '';
}

// ============================================================
// SAVE ADMIN PROFILE
// ============================================================

async function saveAdminProfile() {
    const fullName = document.getElementById('adminFullName').value.trim();
    const statusEl = document.getElementById('adminProfileStatus');

    if (!fullName) {
        statusEl.style.color = 'var(--bad)';
        statusEl.textContent = 'Please enter your name.';
        return;
    }

    const btn = document.getElementById('adminProfileSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const { error } = await supabaseClient
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', currentAdmin.id);

    btn.disabled = false;
    btn.textContent = 'Update Profile';

    if (error) {
        statusEl.style.color = 'var(--bad)';
        statusEl.textContent = error.message || 'Error updating profile.';
        return;
    }

    statusEl.style.color = 'var(--good)';
    statusEl.textContent = 'Profile updated successfully!';
    showToast('Profile updated!');
}

// ============================================================
// PASSWORD VISIBILITY TOGGLE
// ============================================================

function initPasswordToggles() {
    document.querySelectorAll('.admin-password-toggle').forEach(btn => {
        btn.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;
            
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            
            // Toggle icon
            const icon = this.querySelector('i');
            if (icon) {
                icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
            
            // Update aria-label
            this.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        });
    });
}

// ============================================================
// PASSWORD STRENGTH INDICATOR
// ============================================================

function initPasswordStrength() {
    const passwordInput = document.getElementById('adminNewPassword');
    const strengthEl = document.getElementById('passwordStrength');
    const barEl = document.getElementById('passwordStrengthBar');
    const labelEl = document.getElementById('passwordStrengthLabel');
    
    if (!passwordInput) return;
    
    passwordInput.addEventListener('input', function() {
        const password = this.value;
        
        if (password.length === 0) {
            strengthEl.hidden = true;
            return;
        }
        
        strengthEl.hidden = false;
        
        // Calculate strength
        let strength = 0;
        if (password.length >= 6) strength++;
        if (password.length >= 10) strength++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
        if (/\d/.test(password)) strength++;
        if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strength++;
        
        // Determine label and color
        let label, color, width;
        if (strength <= 1) {
            label = 'Weak';
            color = '#e05a5a';
            width = '20%';
        } else if (strength <= 2) {
            label = 'Fair';
            color = '#f2c96b';
            width = '40%';
        } else if (strength <= 3) {
            label = 'Good';
            color = '#9bc7ff';
            width = '60%';
        } else if (strength <= 4) {
            label = 'Strong';
            color = '#4caf7d';
            width = '80%';
        } else {
            label = 'Very Strong';
            color = '#2e7d32';
            width = '100%';
        }
        
        barEl.style.width = width;
        barEl.style.backgroundColor = color;
        labelEl.textContent = label;
        labelEl.style.color = color;
    });
}

// ============================================================
// PASSWORD MATCH CHECK
// ============================================================

function initPasswordMatchCheck() {
    const newPassword = document.getElementById('adminNewPassword');
    const confirmPassword = document.getElementById('adminConfirmPassword');
    const statusEl = document.getElementById('adminPasswordStatus');
    
    if (!newPassword || !confirmPassword) return;
    
    function checkMatch() {
        const newVal = newPassword.value;
        const confirmVal = confirmPassword.value;
        
        if (confirmVal.length === 0) {
            statusEl.textContent = '';
            return;
        }
        
        if (newVal === confirmVal) {
            statusEl.style.color = 'var(--good)';
            statusEl.textContent = '✓ Passwords match';
        } else {
            statusEl.style.color = 'var(--bad)';
            statusEl.textContent = '✗ Passwords do not match';
        }
    }
    
    newPassword.addEventListener('input', checkMatch);
    confirmPassword.addEventListener('input', checkMatch);
}

// ============================================================
// CHANGE PASSWORD
// ============================================================

async function changePassword() {
    const currentPassword = document.getElementById('adminCurrentPassword').value;
    const newPassword = document.getElementById('adminNewPassword').value;
    const confirmPassword = document.getElementById('adminConfirmPassword').value;
    const statusEl = document.getElementById('adminPasswordStatus');

    if (!currentPassword) {
        statusEl.style.color = 'var(--bad)';
        statusEl.textContent = 'Please enter your current password.';
        return;
    }

    if (newPassword.length < 6) {
        statusEl.style.color = 'var(--bad)';
        statusEl.textContent = 'New password must be at least 6 characters.';
        return;
    }

    if (newPassword !== confirmPassword) {
        statusEl.style.color = 'var(--bad)';
        statusEl.textContent = 'Passwords do not match.';
        return;
    }

    const btn = document.getElementById('adminPasswordSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Updating...';

    const { error } = await supabaseClient.auth.updateUser({
        password: newPassword
    });

    btn.disabled = false;
    btn.textContent = 'Update Password';

    if (error) {
        statusEl.style.color = 'var(--bad)';
        statusEl.textContent = error.message || 'Error updating password.';
        return;
    }

    statusEl.style.color = 'var(--good)';
    statusEl.textContent = 'Password updated successfully!';
    showToast('Password updated!');
    
    document.getElementById('adminCurrentPassword').value = '';
    document.getElementById('adminNewPassword').value = '';
    document.getElementById('adminConfirmPassword').value = '';
}

// ============================================================
// HELPERS
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