// ============================================================
// ADMIN — SUPPORT PAGE
// ============================================================
// Staff side of the "talk to a human" handoff started from the customer
// chat widget (frontend/js/main.js -> supabase/functions/support-chat).
//
// Reads/writes go straight through supabaseClient (not an edge function)
// — access control is entirely RLS + is_admin(), same pattern as
// users.js. See the support_chat_conversations migration for the
// policies this relies on.
//
// Message content (from customers, possibly guests) is always rendered
// with textContent, never innerHTML — same rule as the customer-facing
// widget.

let currentAdmin = null;
let convoFilterValue = 'open';
let allConvos = [];        // [{ id, customer_id, guest_token, status, claimed_by, last_message_at, created_at, _profile, _preview }]
let activeConvoId = null;
let realtimeChannel = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentAdmin = await requireAdminOrRedirect();
    if (!currentAdmin) return; // already redirected

    const emailEl = document.getElementById('adminSidebarEmail');
    if (emailEl) emailEl.textContent = currentAdmin.email;

    initLogout();
    initFilter();
    initReplyBox();
    initClaimClose();

    await loadConversations();
    subscribeRealtime();
});

function initLogout() {
    const btn = document.getElementById('adminLogoutBtn');
    if (btn) btn.addEventListener('click', adminLogOut);
}

// --------------------------------------------
// Load conversation list
// --------------------------------------------
async function loadConversations() {
    const listEl = document.getElementById('convoList');

    let query = supabaseClient
        .from('support_conversations')
        .select('id, customer_id, guest_token, status, claimed_by, last_message_at, created_at')
        .order('last_message_at', { ascending: false })
        .limit(200);

    if (convoFilterValue !== 'all') {
        query = query.eq('status', convoFilterValue);
    }

    const { data, error } = await query;

    if (error) {
        console.error(error);
        listEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'admin-recent-empty';
        empty.textContent = "Couldn't load conversations — " + (error.message || 'please refresh.');
        listEl.appendChild(empty);
        return;
    }

    allConvos = data || [];

    // Attach customer profile info (support_conversations.customer_id has
    // no direct FK to profiles — both reference auth.users independently
    // — so this is a manual join, same reasoning as elsewhere in admin.)
    const customerIds = [...new Set(allConvos.map(c => c.customer_id).filter(Boolean))];
    let profilesById = {};
    if (customerIds.length) {
        const { data: profiles } = await supabaseClient
            .from('profiles')
            .select('id, full_name, email')
            .in('id', customerIds);
        (profiles || []).forEach(p => { profilesById[p.id] = p; });
    }
    allConvos.forEach(c => { c._profile = c.customer_id ? profilesById[c.customer_id] : null; });

    // Attach a one-line preview of the latest message per conversation.
    const convoIds = allConvos.map(c => c.id);
    if (convoIds.length) {
        const { data: recentMsgs } = await supabaseClient
            .from('support_messages')
            .select('conversation_id, sender_type, content, created_at')
            .in('conversation_id', convoIds)
            .order('created_at', { ascending: false })
            .limit(500);

        const previewByConvo = {};
        (recentMsgs || []).forEach(m => {
            if (!previewByConvo[m.conversation_id]) previewByConvo[m.conversation_id] = m;
        });
        allConvos.forEach(c => { c._preview = previewByConvo[c.id] || null; });
    }

    renderConvoList();
    loadStats();

    // Keep the open thread's header state (e.g. claimed_by) fresh if it's
    // still in this filtered set.
    if (activeConvoId && !allConvos.find(c => c.id === activeConvoId)) {
        // Active conversation fell out of the current filter (e.g. it was
        // just closed while viewing "Open") — leave the thread open as-is;
        // the realtime status update already shows it's closed.
    }
}

// --------------------------------------------
// Stats — queried independently of the conversation-list filter, so
// switching to "Closed" (which only loads closed conversations) doesn't
// leave Open/Unclaimed with nothing to count from.
// --------------------------------------------
async function loadStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [openRes, unclaimedRes, closedTodayRes] = await Promise.all([
        supabaseClient.from('support_conversations')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'open'),
        supabaseClient.from('support_conversations')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'open')
            .is('claimed_by', null),
        supabaseClient.from('support_conversations')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'closed')
            .gte('last_message_at', todayStart.toISOString())
    ]);

    if (openRes.error || unclaimedRes.error || closedTodayRes.error) {
        console.error(openRes.error || unclaimedRes.error || closedTodayRes.error);
        return; // leave whatever was last shown rather than blank/dash it out
    }

    setText('statOpenConvos', openRes.count ?? 0);
    setText('statUnclaimed', unclaimedRes.count ?? 0);
    setText('statClosedToday', closedTodayRes.count ?? 0);
}

function renderConvoList() {
    const listEl = document.getElementById('convoList');
    const countEl = document.getElementById('convoListCount');
    listEl.innerHTML = '';

    if (countEl) countEl.textContent = `${allConvos.length} conversation${allConvos.length === 1 ? '' : 's'}`;

    if (!allConvos.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-recent-empty';
        empty.innerHTML = '<i class="fas fa-headset" aria-hidden="true"></i><p>No conversations here.</p>';
        listEl.appendChild(empty);
        return;
    }

    allConvos.forEach(c => {
        const card = document.createElement('div');
        card.className = 'admin-support-convo' + (c.id === activeConvoId ? ' active' : '');
        card.dataset.id = c.id;

        const top = document.createElement('div');
        top.className = 'admin-support-convo-top';

        const name = document.createElement('span');
        name.textContent = c._profile ? (c._profile.full_name || c._profile.email || 'Customer') : 'Guest';
        top.appendChild(name);

        const pill = document.createElement('span');
        pill.className = 'admin-support-pill ' + c.status;
        pill.textContent = c.status;
        top.appendChild(pill);

        const preview = document.createElement('div');
        preview.className = 'admin-support-convo-preview';
        preview.textContent = c._preview
            ? `${c._preview.sender_type === 'staff' ? 'You: ' : ''}${c._preview.content}`
            : 'No messages yet';

        const meta = document.createElement('div');
        meta.className = 'admin-support-convo-meta';
        const claimSpan = document.createElement('span');
        claimSpan.textContent = c.claimed_by ? 'Claimed' : 'Unclaimed';
        const timeSpan = document.createElement('span');
        timeSpan.textContent = formatRelativeTime(c.last_message_at);
        meta.append(claimSpan, timeSpan);

        card.append(top, preview, meta);
        card.addEventListener('click', () => openConversation(c.id));
        listEl.appendChild(card);
    });
}

// --------------------------------------------
// Filter dropdown
// --------------------------------------------
function initFilter() {
    const select = document.getElementById('convoFilter');
    if (!select) return;
    select.value = convoFilterValue;
    select.addEventListener('change', async function () {
        convoFilterValue = select.value;
        await loadConversations();
    });
}

// --------------------------------------------
// Thread view
// --------------------------------------------
async function openConversation(id) {
    activeConvoId = id;
    renderConvoList(); // re-render to highlight the active card

    document.getElementById('threadEmptyState').hidden = true;
    document.getElementById('threadWrap').hidden = false;

    const convo = allConvos.find(c => c.id === id);
    document.getElementById('threadCustomerName').textContent =
        convo && convo._profile ? (convo._profile.full_name || convo._profile.email || 'Customer') : 'Guest';
    document.getElementById('threadCustomerMeta').textContent =
        convo && convo._profile && convo._profile.email ? convo._profile.email : (convo ? `Started ${formatRelativeTime(convo.created_at)}` : '');

    updateClaimCloseUI(convo);

    const threadEl = document.getElementById('threadMessages');
    threadEl.innerHTML = '';
    const loading = document.createElement('div');
    loading.style.opacity = '0.6';
    loading.style.fontSize = '0.8rem';
    loading.textContent = 'Loading messages…';
    threadEl.appendChild(loading);

    const { data, error } = await supabaseClient
        .from('support_messages')
        .select('id, sender_type, content, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });

    threadEl.innerHTML = '';
    if (error) {
        console.error(error);
        const errEl = document.createElement('div');
        errEl.textContent = "Couldn't load messages — " + (error.message || 'please retry.');
        threadEl.appendChild(errEl);
        return;
    }

    (data || []).forEach(m => appendThreadMessage(m));
    threadEl.scrollTop = threadEl.scrollHeight;
}

function appendThreadMessage(m) {
    const threadEl = document.getElementById('threadMessages');
    if (!threadEl || threadEl.querySelector(`[data-msg-id="${m.id}"]`)) return; // dedupe

    const bubble = document.createElement('div');
    bubble.className = 'admin-support-msg ' + m.sender_type;
    bubble.dataset.msgId = m.id;

    const text = document.createElement('div');
    text.textContent = m.content; // never innerHTML — this may be raw customer input
    bubble.appendChild(text);

    const time = document.createElement('small');
    time.className = 'admin-support-msg-time';
    time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    bubble.appendChild(time);

    threadEl.appendChild(bubble);
    threadEl.scrollTop = threadEl.scrollHeight;
}

// --------------------------------------------
// Claim / Close
// --------------------------------------------
function updateClaimCloseUI(convo) {
    const claimBtn = document.getElementById('claimBtn');
    const closeBtn = document.getElementById('closeConvoBtn');
    if (!convo) return;

    if (convo.claimed_by) {
        claimBtn.innerHTML = '<i class="fas fa-user-check" aria-hidden="true"></i> ' +
            (convo.claimed_by === currentAdmin.id ? 'Claimed by you' : 'Claimed');
        claimBtn.disabled = convo.claimed_by !== currentAdmin.id;
    } else {
        claimBtn.innerHTML = '<i class="fas fa-hand" aria-hidden="true"></i> Claim';
        claimBtn.disabled = false;
    }

    closeBtn.disabled = convo.status === 'closed';
    closeBtn.innerHTML = convo.status === 'closed'
        ? '<i class="fas fa-circle-check" aria-hidden="true"></i> Closed'
        : '<i class="fas fa-circle-check" aria-hidden="true"></i> Close';
}

function initClaimClose() {
    const claimBtn = document.getElementById('claimBtn');
    const closeBtn = document.getElementById('closeConvoBtn');

    if (claimBtn) {
        claimBtn.addEventListener('click', async function () {
            if (!activeConvoId) return;
            const { error } = await supabaseClient
                .from('support_conversations')
                .update({ claimed_by: currentAdmin.id })
                .eq('id', activeConvoId);
            if (error) { console.error(error); return; }

            const convo = allConvos.find(c => c.id === activeConvoId);
            if (convo) convo.claimed_by = currentAdmin.id;
            updateClaimCloseUI(convo);
            renderConvoList();
            loadStats();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', async function () {
            if (!activeConvoId) return;
            if (!confirm('Close this conversation? The customer will be returned to the AI assistant.')) return;

            const { error } = await supabaseClient
                .from('support_conversations')
                .update({ status: 'closed' })
                .eq('id', activeConvoId);
            if (error) { console.error(error); return; }

            const convo = allConvos.find(c => c.id === activeConvoId);
            if (convo) convo.status = 'closed';
            updateClaimCloseUI(convo);
            renderConvoList();
            loadStats();
        });
    }
}

// --------------------------------------------
// Reply
// --------------------------------------------
function initReplyBox() {
    const sendBtn = document.getElementById('replySendBtn');
    const textarea = document.getElementById('replyInput');
    if (!sendBtn || !textarea) return;

    async function send() {
        const content = textarea.value.trim();
        if (!content || !activeConvoId) return;

        sendBtn.disabled = true;
        const { data, error } = await supabaseClient
            .from('support_messages')
            .insert({
                conversation_id: activeConvoId,
                sender_type: 'staff',
                sender_id: currentAdmin.id,
                content
            })
            .select()
            .single();
        sendBtn.disabled = false;

        if (error) {
            console.error(error);
            alert(error.message || 'Could not send reply.');
            return;
        }

        textarea.value = '';
        appendThreadMessage(data); // optimistic — realtime echo is deduped by message id

        await supabaseClient
            .from('support_conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', activeConvoId);
    }

    sendBtn.addEventListener('click', send);
    textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });
}

// --------------------------------------------
// Realtime — new conversations, new messages, status/claim changes
// --------------------------------------------
function subscribeRealtime() {
    realtimeChannel = supabaseClient
        .channel('admin-support')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, async () => {
            await loadConversations();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
            const m = payload.new;
            if (m.conversation_id === activeConvoId) {
                appendThreadMessage(m);
            }
            // Refresh the list so previews/ordering stay current without a
            // full reload on every keystroke-level event.
            loadConversations();
        })
        .subscribe();
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatRelativeTime(iso) {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}