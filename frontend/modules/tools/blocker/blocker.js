// Blocker — filter people in your current VRChat instance by trust rank, then block some or
// all of them. Reuses the same instance-member data as People > Instance / the Adder tool
// (_ipUsers, from instance-players.js) and the shared getTrustRank/_PL_RANK_ORDER helpers
// (people.js) for rank filtering and sorting.

let _blockerSelected = new Set();
let _blockerRankFilter = 'all';

const BLOCKER_RANKS = [
    { key: 'all',           id: 'blockerRankAll' },
    { key: 'rank-visitor',  id: 'blockerRankVisitor' },
    { key: 'rank-new',      id: 'blockerRankNew' },
    { key: 'rank-user',     id: 'blockerRankUser' },
    { key: 'rank-known',    id: 'blockerRankKnown' },
    { key: 'rank-trusted',  id: 'blockerRankTrusted' },
];

function _blockerActive() {
    const tab = document.getElementById('tab35');
    return !!(tab && tab.classList.contains('active'));
}

function onBlockerInstanceLive() {
    if (_blockerActive()) renderBlockerList();
}

function _blockerIsBlocked(userId) {
    return Array.isArray(blockedData) && blockedData.some(e => e.targetUserId === userId);
}

function _blockerTags(u) {
    return (u._friend?.tags?.length ? u._friend.tags : u.tags) || [];
}

function _blockerRankCls(u) {
    return getTrustRank(_blockerTags(u))?.cls || '';
}

function _blockerSortRank(u) {
    if (_blockerIsBlocked(u.id)) return 99; // already-blocked, always last
    const idx = _PL_RANK_ORDER.indexOf(_blockerRankCls(u));
    return idx >= 0 ? idx : 50; // unknown rank sorts after known ranks, before "blocked"
}

function blockerSetRankFilter(rank) {
    _blockerRankFilter = rank;
    BLOCKER_RANKS.forEach(r => document.getElementById(r.id)?.classList.toggle('active', r.key === rank));
    renderBlockerList();
}

// Shared by renderBlockerList and blockerSelectAll so "select all" only ever grabs what's
// actually visible under the current rank filter + search.
function _blockerVisibleCandidates() {
    const { users } = _ipUsers();
    const selfId = (typeof currentVrcUser !== 'undefined' && currentVrcUser) ? currentVrcUser.id : null;
    let candidates = users.filter(u => u.id && u.id !== selfId);

    if (_blockerRankFilter !== 'all') candidates = candidates.filter(u => _blockerRankCls(u) === _blockerRankFilter);

    const q = (document.getElementById('blockerSearch')?.value || '').toLowerCase();
    if (q) candidates = candidates.filter(u => (u.displayName || '').toLowerCase().includes(q));

    return candidates;
}

function renderBlockerList() {
    const grid = document.getElementById('blockerGrid');
    if (!grid) return;
    const titleEl = document.getElementById('blockerInstanceTitle');
    const { data } = _ipUsers();

    if (!data) {
        grid.innerHTML = `<div class="empty-msg">${esc(t('blocker.empty_no_instance', 'You are not in an instance.'))}</div>`;
        if (titleEl) titleEl.textContent = '';
        _blockerSelected.clear();
        _blockerUpdateBar();
        return;
    }
    if (titleEl) titleEl.textContent = data.worldName || '';

    const filtered = _blockerVisibleCandidates();

    const presentIds = new Set(filtered.map(u => u.id));
    for (const id of [..._blockerSelected]) if (!presentIds.has(id)) _blockerSelected.delete(id);

    if (!filtered.length) {
        const anyInInstance = _ipUsers().users.length > 1; // more than just yourself
        grid.innerHTML = `<div class="empty-msg">${esc(anyInInstance
            ? t('blocker.empty_no_matches', 'No one matches this filter.')
            : t('blocker.empty_no_people', 'No one else here yet.'))}</div>`;
        _blockerUpdateBar();
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        const d = _blockerSortRank(a) - _blockerSortRank(b);
        return d !== 0 ? d : (a.displayName || '').localeCompare(b.displayName || '');
    });

    grid.classList.add('blocker-list');
    lvKeepScroll(grid, () => { grid.innerHTML = sorted.map(u => _blockerRowHtml(u)).join(''); });
    _blockerUpdateBar();
}

function _blockerRowHtml(u) {
    const uid = jsq(u.id || '');
    const openCmd = u.id ? `openFriendDetail('${uid}')` : '';
    const rank = getTrustRank(_blockerTags(u));
    const rankBadge = rank ? `<span class="vrcn-badge ${rank.cls}" style="flex-shrink:0;">${esc(rank.label)}</span>` : '';

    if (_blockerIsBlocked(u.id)) {
        return renderUserItem(u, openCmd, { noWorld: true,
            trailing: `${rankBadge}<span class="vrcn-badge" style="flex-shrink:0;">${esc(t('blocker.already_blocked', 'Blocked'))}</span>`,
        });
    }

    const isSel = _blockerSelected.has(u.id);
    const checkIcon = isSel
        ? `<span class="msi" style="font-size:22px;color:var(--accent);">check_circle</span>`
        : `<span class="msi" style="font-size:22px;color:rgba(255,255,255,0.7);">radio_button_unchecked</span>`;
    const trailing = `${rankBadge}<div class="blocker-row-actions">
        <button class="vrcn-button vrcn-btn-danger blocker-row-block-btn" onclick="event.stopPropagation();blockerBlockOne('${uid}')"><span class="msi" style="font-size:14px;">block</span> ${esc(t('blocker.block_one', 'Block'))}</button>
        <span class="blocker-row-check" onclick="event.stopPropagation();blockerToggleSelect('${uid}')">${checkIcon}</span>
    </div>`;
    return renderUserItem(u, `blockerToggleSelect('${uid}')`, { noWorld: true, trailing });
}

function blockerToggleSelect(userId) {
    if (!userId) return;
    if (_blockerSelected.has(userId)) _blockerSelected.delete(userId);
    else _blockerSelected.add(userId);
    renderBlockerList();
}

function blockerSelectAll() {
    _blockerVisibleCandidates().forEach(u => { if (!_blockerIsBlocked(u.id)) _blockerSelected.add(u.id); });
    renderBlockerList();
}

function blockerSelectNone() {
    _blockerSelected.clear();
    renderBlockerList();
}

function _blockerUpdateBar() {
    const countEl = document.getElementById('blockerSelectedCount');
    const btn = document.getElementById('blockerBlockSelectedBtn');
    if (countEl) countEl.textContent = tf('blocker.selected_count', { count: _blockerSelected.size }, `${_blockerSelected.size} selected`);
    if (btn) btn.disabled = _blockerSelected.size === 0;
}

// Instant single block — vrcModDone (fired by the backend on success) updates blockedData and
// re-renders this list on its own, same as every other block button in the app.
function blockerBlockOne(userId) {
    if (!userId) return;
    _blockerSelected.delete(userId);
    sendToCS({ action: 'vrcBlock', userId });
    renderBlockerList();
}

function blockerBlockSelected() {
    const ids = [..._blockerSelected];
    if (!ids.length) return;
    vnConfirmModal({
        title: t('blocker.confirm_title', 'Block Selected People'),
        icon: 'block',
        danger: true,
        message: tf('blocker.confirm_message', { count: ids.length }, `Block ${ids.length} selected people? You can undo this later from People > Blocked.`),
        confirmLabel: t('blocker.confirm_button', 'Block Them'),
        onConfirm: () => {
            _blockerSelected.clear();
            const res = document.getElementById('blockerProgressResult');
            if (res) {
                res.style.display = '';
                res.innerHTML = `<div class="blocker-progress-text">${esc(tf('blocker.progress', { done: 0, total: ids.length }, `Blocking... 0/${ids.length}`))}</div>`;
            }
            sendToCS({ action: 'blockerSendBlocks', userIds: ids });
            renderBlockerList();
        },
    });
}

function handleBlockerProgress(payload) {
    const res = document.getElementById('blockerProgressResult');
    if (!res) return;
    const done = payload?.done || 0, total = payload?.total || 0, failed = payload?.failed || 0;
    res.style.display = '';
    res.innerHTML = `<div class="blocker-progress-text">${esc(tf('blocker.progress_detail',
        { done, total, failed }, `Blocking... ${done}/${total}${failed > 0 ? ` (${failed} failed)` : ''}`))}</div>`;
}

function handleBlockerDone(payload) {
    const res = document.getElementById('blockerProgressResult');
    if (res) {
        const total = payload?.total || 0, ok = payload?.ok || 0, failed = payload?.failed || 0;
        const label = tf('blocker.done', { ok, total, failed }, `Blocked ${ok}/${total}${failed > 0 ? ` (${failed} failed)` : ''}`);
        res.innerHTML = `<div class="blocker-progress-done"><span class="msi" style="font-size:20px;color:var(--ok);">check_circle</span><span>${esc(label)}</span></div>`;
    }
    renderBlockerList();
}

document.documentElement.addEventListener('tabchange', () => {
    if (!_blockerActive()) return;
    sendToCS({ action: 'vrcGetBlocked' });
    renderBlockerList();
});
document.documentElement.addEventListener('languagechange', () => { if (_blockerActive()) renderBlockerList(); });

sendToCS({ action: 'vrcGetBlocked' });
renderBlockerList();
