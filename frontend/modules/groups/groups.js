/* === Join State === */
function getJoinStateLabel(js) {
    const map = {
        open: ['groups.join_state.open', 'Open'],
        closed: ['groups.join_state.closed', 'Closed'],
        invite: ['groups.join_state.invite_only', 'Invite Only'],
        request: ['groups.join_state.request_invite', 'Request Invite'],
    };
    const entry = map[js];
    return entry ? t(entry[0], entry[1]) : (js || '?');
}

function getGroupMembersText(count) {
    return tf('worlds.groups.members', { count }, '{count} members');
}

function joinStateBadge(js) {
    const map = {
        open:    { label: getJoinStateLabel('open'), cls: 'public'  },
        closed:  { label: getJoinStateLabel('closed'), cls: 'private' },
        invite:  { label: getJoinStateLabel('invite'), cls: 'friends' },
        request: { label: getJoinStateLabel('request'), cls: 'group'   },
    };
    const m = map[js] || { label: getJoinStateLabel(js), cls: 'hidden' };
    return `<span class="vrcn-badge ${m.cls}">${esc(m.label)}</span>`;
}

/* === My Groups === */

function _renderGroupListCard(g) {
    const metaParts = [];
    if (g.shortCode) metaParts.push(esc(g.shortCode));
    metaParts.push(`<span class="msi" style="font-size:12px;">group</span> ${esc(getGroupMembersText(g.memberCount || 0))}`);
    const iconHtml = g.iconUrl ? `<div class="cc-group-icon" style="background-image:url('${cssUrl(imgThumb(g.iconUrl, 64))}')"></div>` : '';
    return `<div class="vrcn-content-card" onclick="openGroupDetail('${esc(g.id)}')">
        <div class="cc-bg"><img src="${imgThumb(g.bannerUrl, 256)||'fallback_cover.png'}" loading="lazy" decoding="async" onerror="this.src='fallback_cover.png'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"></div>
        <div class="cc-scrim"></div>
        <div class="cc-content">
            <div class="cc-name">${esc(g.name)}</div>
            <div class="cc-bottom-row">
                <div class="cc-meta">${iconHtml}${metaParts.join(' · ')}</div>
            </div>
        </div>
    </div>`;
}

let _groupTab = 'joined';

const _GROUP_TAB_BTNS = { joined: 'groupFilterJoined', mine: 'groupFilterMine', mod: 'groupFilterMod', search: 'groupFilterSearch', instances: 'groupFilterInstances' };

function setGroupFilter(filter) {
    if (!_GROUP_TAB_BTNS[filter]) filter = 'joined';
    for (const [key, id] of Object.entries(_GROUP_TAB_BTNS)) {
        document.getElementById(id)?.classList.toggle('active', key === filter);
    }
    const isSearch = filter === 'search';
    const isInstances = filter === 'instances';
    document.getElementById('groupMineArea').style.display      = (isSearch || isInstances) ? 'none' : '';
    document.getElementById('groupSearchArea').style.display    = isSearch ? '' : 'none';
    document.getElementById('groupInstancesArea').style.display = isInstances ? '' : 'none';
    if (isInstances) {
        _groupTab = filter;
        const glBtn2 = document.getElementById('groupViewList');
        if (glBtn2) glBtn2.style.display = '';
        _groupsSyncViewBtns();
        renderGroupInstancesView();
        if (typeof _dashGroupInstances !== 'undefined' && _dashGroupInstances === null && typeof loadDashGroupInstances === 'function') loadDashGroupInstances();
        return;
    }
    const glBtn = document.getElementById('groupViewList');
    if (glBtn) glBtn.style.display = '';
    if (isSearch) {
        renderGroupsListView();
        document.getElementById('searchGroupsInput')?.focus();
        return;
    }
    _groupTab = filter;
    filterMyGroups();
    if (!myGroupsLoaded) loadMyGroups();
}

function _groupIsOwn(g) {
    const meId = (typeof currentVrcUser !== 'undefined' && currentVrcUser) ? currentVrcUser.id : '';
    return !!(meId && g.ownerId === meId);
}

function _groupCanModerate(g) {
    return !!(g.canKick || g.canBan || g.canEdit || g.canManageRoles || g.canAssignRoles
           || g.canViewAudit || g.canModInstance || g.canManageMembers || g.canPost || g.canEvent);
}

function _groupTabList() {
    if (_groupTab === 'mine') return myGroups.filter(_groupIsOwn);
    if (_groupTab === 'mod')  return myGroups.filter(g => !_groupIsOwn(g) && _groupCanModerate(g));
    return myGroups;
}

function _groupEmptyMsg() {
    if (_groupTab === 'mine') return t('groups.mine.empty_owned', 'You have not created any groups');
    if (_groupTab === 'mod')  return t('groups.mine.empty_moderate', 'No groups where you have moderation rights');
    return t('groups.mine.empty_joined', 'No groups joined');
}

document.documentElement.addEventListener('languagechange', () => {
    if (typeof myGroupsLoaded !== 'undefined' && myGroupsLoaded && typeof myGroups !== 'undefined' && Array.isArray(myGroups)) {
        filterMyGroups();
    }
    if (document.getElementById('gdTabInfo') && window._currentGroupDetailFull) {
        renderGroupDetail(window._currentGroupDetailFull);
    }
});

let _groupsPage = 0;

function setGroupsViewMode(mode) {
    lvSetViewMode('groups', mode);
    _groupsPage = 0; _groupInstPage = 0;
    _groupsSyncViewBtns();
    renderGroupsListView();
}

function renderGroupsListView() {
    if (document.getElementById('groupFilterSearch')?.classList.contains('active')) {
        const st = searchState?.groups;
        if (st && st.results && st.results.length) renderSearchResults('groups', st.results, 0, st.hasMore);
        return;
    }
    if (_groupTab === 'instances') { renderGroupInstancesView(); return; }
    filterMyGroups();
}

function _groupsSyncViewBtns() {
    const isList = lvViewMode('groups') === 'list';
    document.getElementById('groupViewList')?.classList.toggle('active', isList);
    if (isList) {
        document.getElementById('groupGridLarge')?.classList.remove('active');
        document.getElementById('groupGridSmall')?.classList.remove('active');
    } else {
        const compact = localStorage.getItem('vrcn_gridSize_groups') === 'compact';
        document.getElementById('groupGridLarge')?.classList.toggle('active', !compact);
        document.getElementById('groupGridSmall')?.classList.toggle('active', compact);
    }
}

function setGroupsListPageSize(v) { lvSetPageSize('groups', v, () => { _groupsPage = 0; _groupInstPage = 0; renderGroupsListView(); }); }
function groupsGoPage(p) { if (p < 0) return; _groupsPage = p; filterMyGroups(); document.getElementById('myGroupsGrid')?.scrollTo(0, 0); }

function _glValue(g, field) {
    switch (field) {
        case 'name':    return (g.name || '').toLowerCase();
        case 'short':   return (g.shortCode || '').toLowerCase();
        case 'members': return g.memberCount || 0;
        default:        return (g.name || '').toLowerCase();
    }
}

function buildGroupsListHtml(groups) {
    let rows = '';
    groups.forEach(g => {
        const gid = jsq(g.id || '');
        rows += tlTableRow('groupsList', ` onclick="openGroupDetail('${gid}')"`, {
            icon:    `<td>${lvIcon(g.iconUrl, g.name, true)}</td>`,
            name:    `<td class="lv-name">${esc(g.name || '')}</td>`,
            short:   `<td class="lv-sub">${esc(g.shortCode || '')}</td>`,
            members: `<td class="lv-num">${esc((g.memberCount || 0).toLocaleString())}</td>`,
        });
    });
    return `<div class="lv-scroll">${tlTableHtml('groupsList', rows)}</div>`;
}

let _myGroupsDirty = false;
function filterMyGroups() {
    const tab = document.getElementById('tab2');
    if (tab && !tab.classList.contains('active')) { _myGroupsDirty = true; return; }
    _myGroupsDirty = false;
    const q = (document.getElementById('filterGroupsInput')?.value || '').toLowerCase();
    const el = document.getElementById('myGroupsGrid');
    if (!el) return;
    const base = _groupTabList();
    const filtered = q
        ? base.filter(g => (g.name||'').toLowerCase().includes(q) || (g.shortCode||'').toLowerCase().includes(q))
        : base;
    if (!filtered.length) {
        el.classList.add('search-grid');
        el.innerHTML = `<div class="empty-msg">${esc(q ? t('groups.mine.empty_match', 'No groups match') : _groupEmptyMsg())}</div>`;
        setPaginator('groupsPaginatorBar', '');
        return;
    }
    if (lvViewMode('groups') === 'list' && lvReady()) {
        const sorted = lvSort(filtered, 'groupsList', _glValue);
        const size = lvPageSize('groups');
        const totalPages = Math.ceil(sorted.length / size) || 1;
        if (_groupsPage >= totalPages) _groupsPage = totalPages - 1;
        if (_groupsPage < 0) _groupsPage = 0;
        el.classList.remove('search-grid');
        el.innerHTML = buildGroupsListHtml(sorted.slice(_groupsPage * size, (_groupsPage + 1) * size));
        setPaginator('groupsPaginatorBar', lvPaginator('groups', _groupsPage, totalPages, 'groupsGoPage', sorted.length, 'setGroupsListPageSize'));
        return;
    }
    setPaginator('groupsPaginatorBar', '');
    el.classList.add('search-grid');
    el.innerHTML = filtered.map(_renderGroupListCard).join('');
}

function loadMyGroups() {
    sendToCS({ action: 'vrcGetMyGroups' });
}


function _groupInstValue(inst, field) {
    switch (field) {
        case 'group':   return (inst.groupName || '').toLowerCase();
        case 'world':   return (inst.worldName || '').toLowerCase();
        case 'type':    return (typeof parseFriendLocation === 'function' ? parseFriendLocation(inst.location || '').instanceType : '');
        case 'players': return inst.userCount || 0;
        default:        return inst.userCount || 0;
    }
}

let _groupInstPage = 0;
let _groupInstDirty = false;

function groupInstGoPage(p) { if (p < 0) return; _groupInstPage = p; renderGroupInstancesView(); document.getElementById('groupInstancesGrid')?.scrollTo(0, 0); }

function buildGroupInstancesListHtml(list) {
    let rows = '';
    list.forEach(inst => {
        const loc = jsq(inst.location || '');
        const { cls, label } = getInstanceBadge(parseFriendLocation(inst.location || '').instanceType);
        const users = inst.capacity > 0 ? `${inst.userCount}/${inst.capacity}` : String(inst.userCount || 0);
        rows += tlTableRow('groupInstList', ` onclick="openGroupInstanceDetail('${loc}')"`, {
            icon:    `<td>${lvIcon(inst.groupIcon, inst.groupName, true)}</td>`,
            group:   `<td class="lv-name">${esc(inst.groupName || '?')}</td>`,
            world:   `<td class="lv-name">${esc(inst.worldName || '')}</td>`,
            type:    `<td>${label ? `<span class="vrcn-badge ${cls}">${esc(label)}</span>` : ''}</td>`,
            players: `<td class="lv-num">${esc(users)}</td>`,
        });
    });
    return `<div class="lv-scroll">${tlTableHtml('groupInstList', rows)}</div>`;
}

function _groupInstCardHtml(inst) {
    const loc = jsq(inst.location || '');
    const thumbStyle = inst.worldThumb ? `background-image:url('${cssUrl(imgThumb(inst.worldThumb, 256))}')` : '';
    const { instanceType } = parseFriendLocation(inst.location || '');
    const { cls, label } = getInstanceBadge(instanceType);
    const region = ((inst.location || '').match(/~region\(([^)]+)\)/) || [])[1] || '';
    const regionBadge = region ? `<span class="vrcn-badge" style="background:rgba(0,0,0,.45);color:rgba(255,255,255,.85);">${esc(region.toUpperCase())}</span>` : '';
    const ageGate = (inst.location || '').includes('~ageGate')
        ? `<span class="vrcn-badge" style="background:rgba(255,75,85,.15);color:var(--err);">${esc(t('worlds.instances.age_gated', 'Age Gated'))}</span>` : '';
    const groupAvatar = inst.groupIcon
        ? `<img class="cc-friend-av" src="${imgThumb(inst.groupIcon, 64)}" title="${esc(inst.groupName || '')}" onerror="this.style.display='none'">`
        : `<div class="cc-friend-av" style="display:flex;align-items:center;justify-content:center;"><span class="msi" style="font-size:10px;color:var(--tx3)">group</span></div>`;
    const users = inst.capacity > 0 ? `${inst.userCount}/${inst.capacity}` : String(inst.userCount || 0);
    return `<div class="vrcn-content-card" onclick="openGroupInstanceDetail('${loc}')">
        <div class="cc-bg" style="${thumbStyle}"></div>
        <div class="cc-scrim"></div>
        <div class="cc-badges-top">${label ? `<span class="vrcn-badge ${cls}">${esc(label)}</span>` : ''}${regionBadge}${ageGate}</div>
        <div class="cc-content">
            <div class="cc-name">${esc(inst.worldName || '?')}</div>
            <div class="cc-friends-row">${groupAvatar}<span class="cc-extra" style="background:transparent;color:rgba(255,255,255,.85);padding-left:4px;">${esc(inst.groupName || '')}</span></div>
            <div class="cc-bottom-row">
                <div class="cc-meta"><span class="msi">person</span>${esc(users)}</div>
            </div>
        </div>
    </div>`;
}

function renderGroupInstancesView() {
    const tab = document.getElementById('tab2');
    if (tab && !tab.classList.contains('active')) { _groupInstDirty = true; return; }
    _groupInstDirty = false;
    const el = document.getElementById('groupInstancesGrid');
    if (!el) return;
    const raw = (typeof _dashGroupInstances !== 'undefined') ? _dashGroupInstances : null;
    const q = (document.getElementById('filterGroupInstancesInput')?.value || '').toLowerCase();
    const data = (raw && q)
        ? raw.filter(i => (i.groupName || '').toLowerCase().includes(q) || (i.worldName || '').toLowerCase().includes(q))
        : raw;
    if (data === null) {
        el.classList.add('search-grid');
        el.innerHTML = `<div class="empty-msg">${t('dashboard.discovery.loading', 'Loading worlds...')}</div>`;
        setPaginator('groupInstancesPaginatorBar', '');
        return;
    }
    if (!data.length) {
        el.classList.add('search-grid');
        el.innerHTML = `<div class="empty-msg">${t('dashboard.section.group_activity_empty', 'No active group instances right now')}</div>`;
        setPaginator('groupInstancesPaginatorBar', '');
        return;
    }
    if (lvViewMode('groups') === 'list' && lvReady()) {
        const sorted = lvSort(data, 'groupInstList', _groupInstValue);
        const size = lvPageSize('groups');
        const totalPages = Math.ceil(sorted.length / size) || 1;
        if (_groupInstPage >= totalPages) _groupInstPage = totalPages - 1;
        if (_groupInstPage < 0) _groupInstPage = 0;
        el.classList.remove('search-grid');
        el.innerHTML = buildGroupInstancesListHtml(sorted.slice(_groupInstPage * size, (_groupInstPage + 1) * size));
        setPaginator('groupInstancesPaginatorBar', lvPaginator('groups', _groupInstPage, totalPages, 'groupInstGoPage', sorted.length, 'setGroupsListPageSize'));
        return;
    }
    setPaginator('groupInstancesPaginatorBar', '');
    el.classList.add('search-grid');
    el.innerHTML = data.map(_groupInstCardHtml).join('');
}

function refreshGroups() {
    const btn = document.getElementById('groupsRefreshBtn');
    if (btn) { btn.disabled = true; btn.querySelector('.msi').textContent = 'hourglass_empty'; }
    if (_groupTab === 'instances') {
        window._groupInstInFlight = true;
        sendToCS({ action: 'vrcGetDashGroupInstances' });
        return;
    }
    sendToCS({ action: 'vrcGetMyGroups', force: true });
}

function renderMyGroups(list) {
    const btn = document.getElementById('groupsRefreshBtn');
    if (btn) { btn.disabled = false; btn.querySelector('.msi').textContent = 'refresh'; }
    myGroups = list || [];
    myGroupsLoaded = true;
    lvKeepScroll(document.getElementById('myGroupsGrid'), () => filterMyGroups());
    if (typeof renderDashUpcomingEvents === 'function') renderDashUpcomingEvents();
}


_groupsSyncViewBtns();
