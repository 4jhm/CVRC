// Adder — select people out of your current VRChat instance and send friend requests to some
// or all of them, either one at a time (per-row Add button) or in bulk (checkboxes + Add
// Selected). Reuses the same instance-member data as the People > Instance tab (_ipUsers, from
// instance-players.js) rather than re-fetching anything.

let _adderSelected = new Set();
// Requests sent this session, so a row doesn't offer to re-add someone right after you already
// asked — cleared whenever the instance location changes, same idea as _ipAvatarInfoLoc.
let _adderRequestedIds = new Set();
let _adderRequestedLoc = null;

function _adderActive() {
    const tab = document.getElementById('tab34');
    return !!(tab && tab.classList.contains('active'));
}

function onAdderInstanceLive() {
    if (_adderActive()) renderAdderList();
}

function _adderRank(u) {
    if (u._friend) return 2;
    if (_adderRequestedIds.has(u.id)) return 1;
    return 0;
}

function renderAdderList() {
    const grid = document.getElementById('adderGrid');
    if (!grid) return;
    const titleEl = document.getElementById('adderInstanceTitle');
    const { data, users } = _ipUsers();

    if (!data) {
        grid.innerHTML = `<div class="empty-msg">${esc(t('adder.empty_no_instance', 'You are not in an instance.'))}</div>`;
        if (titleEl) titleEl.textContent = '';
        _adderSelected.clear();
        _adderUpdateBar();
        return;
    }
    if (data.location !== _adderRequestedLoc) { _adderRequestedIds.clear(); _adderRequestedLoc = data.location; }
    if (titleEl) titleEl.textContent = data.worldName || '';

    const selfId = (typeof currentVrcUser !== 'undefined' && currentVrcUser) ? currentVrcUser.id : null;
    const candidates = users.filter(u => u.id && u.id !== selfId);

    const presentIds = new Set(candidates.map(u => u.id));
    for (const id of [..._adderSelected]) if (!presentIds.has(id)) _adderSelected.delete(id);

    const q = (document.getElementById('adderSearch')?.value || '').toLowerCase();
    const filtered = q ? candidates.filter(u => (u.displayName || '').toLowerCase().includes(q)) : candidates;

    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-msg">${esc(candidates.length ? t('profiles.people.no_results', 'No results') : t('adder.empty_no_people', 'No one else here yet.'))}</div>`;
        _adderUpdateBar();
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        const d = _adderRank(a) - _adderRank(b);
        return d !== 0 ? d : (a.displayName || '').localeCompare(b.displayName || '');
    });

    grid.classList.add('adder-list');
    lvKeepScroll(grid, () => { grid.innerHTML = sorted.map(u => _adderRowHtml(u)).join(''); });
    _adderUpdateBar();
}

function _adderRowHtml(u) {
    const uid = jsq(u.id || '');
    const openCmd = u.id ? `openFriendDetail('${uid}')` : '';

    if (u._friend) {
        return renderUserItem(u, openCmd, { noWorld: true,
            trailing: `<span class="vrcn-badge" style="flex-shrink:0;">${esc(t('adder.already_friend', 'Friends'))}</span>`,
        });
    }
    if (_adderRequestedIds.has(u.id)) {
        return renderUserItem(u, openCmd, { noWorld: true,
            trailing: `<span class="vrcn-badge" style="flex-shrink:0;">${esc(t('adder.requested', 'Requested'))}</span>`,
        });
    }

    const isSel = _adderSelected.has(u.id);
    const checkIcon = isSel
        ? `<span class="msi" style="font-size:22px;color:var(--accent);">check_circle</span>`
        : `<span class="msi" style="font-size:22px;color:rgba(255,255,255,0.7);">radio_button_unchecked</span>`;
    const trailing = `<div class="adder-row-actions">
        <button class="vrcn-button adder-row-add-btn" onclick="event.stopPropagation();adderSendOne('${uid}')"><span class="msi" style="font-size:14px;">person_add</span> ${esc(t('adder.add_one', 'Add'))}</button>
        <span class="adder-row-check" onclick="event.stopPropagation();adderToggleSelect('${uid}')">${checkIcon}</span>
    </div>`;
    return renderUserItem(u, `adderToggleSelect('${uid}')`, { noWorld: true, trailing });
}

function adderToggleSelect(userId) {
    if (!userId) return;
    if (_adderSelected.has(userId)) _adderSelected.delete(userId);
    else _adderSelected.add(userId);
    renderAdderList();
}

function adderSelectAll() {
    const { users } = _ipUsers();
    const selfId = (typeof currentVrcUser !== 'undefined' && currentVrcUser) ? currentVrcUser.id : null;
    users.forEach(u => {
        if (u.id && u.id !== selfId && !u._friend && !_adderRequestedIds.has(u.id)) _adderSelected.add(u.id);
    });
    renderAdderList();
}

function adderSelectNone() {
    _adderSelected.clear();
    renderAdderList();
}

function _adderUpdateBar() {
    const countEl = document.getElementById('adderSelectedCount');
    const addBtn = document.getElementById('adderAddSelectedBtn');
    if (countEl) countEl.textContent = tf('adder.selected_count', { count: _adderSelected.size }, `${_adderSelected.size} selected`);
    if (addBtn) addBtn.disabled = _adderSelected.size === 0;
}

// Instant single request — the generic vrcActionResult toast (fired by vrcSendFriendRequest on
// the backend) reports success/failure, same as everywhere else that sends one.
function adderSendOne(userId) {
    if (!userId) return;
    _adderRequestedIds.add(userId);
    _adderSelected.delete(userId);
    sendToCS({ action: 'vrcSendFriendRequest', userId });
    renderAdderList();
}

function adderAddSelected() {
    const ids = [..._adderSelected];
    if (!ids.length) return;
    vnConfirmModal({
        title: t('adder.confirm_title', 'Send Friend Requests'),
        icon: 'group_add',
        danger: false,
        message: tf('adder.confirm_message', { count: ids.length }, `Send friend requests to ${ids.length} selected people?`),
        confirmLabel: t('adder.confirm_button', 'Send Requests'),
        onConfirm: () => {
            ids.forEach(id => _adderRequestedIds.add(id));
            _adderSelected.clear();
            const res = document.getElementById('adderProgressResult');
            if (res) {
                res.style.display = '';
                res.innerHTML = `<div class="adder-progress-text">${esc(tf('adder.progress', { done: 0, total: ids.length }, `Sending requests... 0/${ids.length}`))}</div>`;
            }
            sendToCS({ action: 'adderSendRequests', userIds: ids });
            renderAdderList();
        },
    });
}

function handleAdderProgress(payload) {
    const res = document.getElementById('adderProgressResult');
    if (!res) return;
    const done = payload?.done || 0, total = payload?.total || 0, failed = payload?.failed || 0;
    res.style.display = '';
    res.innerHTML = `<div class="adder-progress-text">${esc(tf('adder.progress_detail',
        { done, total, failed }, `Sending requests... ${done}/${total}${failed > 0 ? ` (${failed} failed)` : ''}`))}</div>`;
}

function handleAdderDone(payload) {
    const res = document.getElementById('adderProgressResult');
    if (res) {
        const total = payload?.total || 0, ok = payload?.ok || 0, failed = payload?.failed || 0;
        const label = tf('adder.done', { ok, total, failed }, `Sent ${ok}/${total} friend requests${failed > 0 ? ` (${failed} failed)` : ''}`);
        res.innerHTML = `<div class="adder-progress-done"><span class="msi" style="font-size:20px;color:var(--ok);">check_circle</span><span>${esc(label)}</span></div>`;
    }
    renderAdderList();
}

document.documentElement.addEventListener('tabchange', () => { if (_adderActive()) renderAdderList(); });
document.documentElement.addEventListener('languagechange', () => { if (_adderActive()) renderAdderList(); });

renderAdderList();
