let availabilityBarbers = [];
let selectedAvailabilityBarber = null;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

document.addEventListener('DOMContentLoaded', async function () {
    const admin = await requireAdminOrRedirect();
    if (!admin) return;
    document.getElementById('adminSidebarEmail').textContent = admin.email;
    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogOut);
    document.getElementById('availabilityBarberSelect').addEventListener('change', function () {
        selectedAvailabilityBarber = this.value;
        loadSchedule();
    });
    document.getElementById('blockedTimeForm').addEventListener('submit', addBlockedTime);
    await loadBarbers();
    await loadSchedule();
    await loadBlockedTimes();
});

async function loadBarbers() {
    const { data, error } = await supabaseClient.from('barbers').select('id, name').eq('is_active', true).order('name');
    if (error || !data?.length) {
        showScheduleError('Run the latest Supabase migrations and seed data before managing availability.');
        return;
    }
    availabilityBarbers = data;
    selectedAvailabilityBarber = selectedAvailabilityBarber || data[0].id;
    ['availabilityBarberSelect', 'blockedBarberSelect'].forEach(function (id) {
        const select = document.getElementById(id);
        select.innerHTML = data.map(barber => `<option value="${escapeAvailability(barber.id)}">${escapeAvailability(barber.name)}</option>`).join('');
        select.value = selectedAvailabilityBarber;
    });
}

async function loadSchedule() {
    const body = document.getElementById('scheduleTableBody');
    if (!selectedAvailabilityBarber) return;
    const { data, error } = await supabaseClient.from('barber_schedules').select('*').eq('barber_id', selectedAvailabilityBarber).order('day_of_week');
    if (error) {
        body.innerHTML = '<tr class="admin-empty-row"><td colspan="5">Could not load schedule.</td></tr>';
        showScheduleError(error.message);
        return;
    }
    const byDay = Object.fromEntries((data || []).map(row => [row.day_of_week, row]));
    body.innerHTML = DAYS.map(function (day, dayIndex) {
        const row = byDay[dayIndex] || { open_time: '09:00', close_time: '20:00', is_active: false };
        return `<tr data-day="${dayIndex}">
            <td>${day}</td>
            <td><input type="time" class="admin-input schedule-open" value="${String(row.open_time || '').slice(0, 5)}" /></td>
            <td><input type="time" class="admin-input schedule-close" value="${String(row.close_time || '').slice(0, 5)}" /></td>
            <td><input type="checkbox" class="schedule-active" ${row.is_active ? 'checked' : ''} /></td>
            <td><button type="button" class="admin-action-btn schedule-save" data-day="${dayIndex}" title="Save"><i class="fas fa-save" aria-hidden="true"></i></button></td>
        </tr>`;
    }).join('');
    body.querySelectorAll('.schedule-save').forEach(btn => btn.addEventListener('click', saveScheduleRow));
}

async function saveScheduleRow(event) {
    const row = event.currentTarget.closest('tr');
    const day = Number(row.dataset.day);
    const openTime = row.querySelector('.schedule-open').value;
    const closeTime = row.querySelector('.schedule-close').value;
    const isActive = row.querySelector('.schedule-active').checked;
    const { error } = await supabaseClient.from('barber_schedules').upsert({
        barber_id: selectedAvailabilityBarber,
        day_of_week: day,
        open_time: openTime,
        close_time: closeTime,
        is_active: isActive
    });
    if (error) showScheduleError(error.message);
    else showScheduleMessage('Schedule saved.');
}

async function loadBlockedTimes() {
    const body = document.getElementById('blockedTimesTableBody');
    const { data, error } = await supabaseClient.from('barber_blocked_times').select('id, barber_id, starts_at, ends_at, reason').gte('ends_at', new Date().toISOString()).order('starts_at').limit(100);
    if (error) {
        body.innerHTML = '<tr class="admin-empty-row"><td colspan="4">Could not load blocked times.</td></tr>';
        return;
    }
    body.innerHTML = (data || []).map(function (block) {
        const barber = availabilityBarbers.find(item => item.id === block.barber_id);
        return `<tr><td>${escapeAvailability(barber?.name || block.barber_id)}</td><td>${formatAvailabilityDate(block.starts_at)} – ${formatAvailabilityDate(block.ends_at)}</td><td>${escapeAvailability(block.reason || 'Blocked')}</td><td><button type="button" class="admin-action-btn admin-action-delete" data-id="${escapeAvailability(block.id)}" title="Delete"><i class="fas fa-trash" aria-hidden="true"></i></button></td></tr>`;
    }).join('') || '<tr class="admin-empty-row"><td colspan="4">No future blocked times.</td></tr>';
    body.querySelectorAll('[data-id]').forEach(btn => btn.addEventListener('click', () => deleteBlockedTime(btn.dataset.id)));
}

async function addBlockedTime(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const starts = document.getElementById('blockedStartInput').value;
    const ends = document.getElementById('blockedEndInput').value;
    if (!starts || !ends || new Date(ends) <= new Date(starts)) {
        showScheduleError('The blocked-time end must be after the start.');
        return;
    }
    const { error } = await supabaseClient.from('barber_blocked_times').insert({
        barber_id: document.getElementById('blockedBarberSelect').value,
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(ends).toISOString(),
        reason: document.getElementById('blockedReasonInput').value.trim() || 'Blocked time',
        created_by: currentAdminUser?.id || null
    });
    if (error) showScheduleError(error.message);
    else {
        form.reset();
        showScheduleMessage('Blocked time added.');
        await loadBlockedTimes();
    }
}

async function deleteBlockedTime(id) {
    if (!confirm('Remove this blocked time?')) return;
    const { error } = await supabaseClient.from('barber_blocked_times').delete().eq('id', id);
    if (error) showScheduleError(error.message);
    else await loadBlockedTimes();
}

function showScheduleError(message) {
    const el = document.getElementById('scheduleError');
    el.textContent = message || 'Something went wrong.';
    el.hidden = false;
}

function showScheduleMessage(message) {
    const el = document.getElementById('blockedTimeStatus');
    el.textContent = message;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 3000);
}

function formatAvailabilityDate(value) {
    return new Date(value).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeAvailability(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}
