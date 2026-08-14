/* === Create Instance Modal === */
function onCiTypeChange() {
    const type = document.getElementById('ciTypeValue')?.value || '';
    const groupRow = document.getElementById('ciGroupRow');
    if (!groupRow) return;
    const isGroup = type === 'group';
    groupRow.style.display = isGroup ? '' : 'none';
    const subPills = document.getElementById('ciGroupSubPillsWrap');
    if (subPills) subPills.style.display = isGroup ? '' : 'none';
    const queueRow = document.getElementById('ciQueueRow');
    if (queueRow) queueRow.style.display = isGroup ? '' : 'none';
    const ageRow = document.getElementById('ciAgeGateRow');
    if (ageRow) ageRow.style.display = isGroup ? '' : 'none';
    const hidden = document.getElementById('ciGroupId');
    if (hidden) hidden.value = '';
    document.querySelectorAll('.ci-group-card').forEach(c => c.classList.remove('ci-group-selected'));
    if (isGroup) {
        if (!myGroupsLoaded) {
            renderCiGroupPicker(null);
            loadMyGroups();
        } else {
            renderCiGroupPicker(myGroups);
        }
    }
}

function renderCiGroupPicker(groups) {
    const el = document.getElementById('ciGroupList');
    if (!el) return;
    if (groups === null) {
        el.innerHTML = `<div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:6px 0;">${t('worlds.groups.loading', 'Loading groups...')}</div>`;
        return;
    }
    const validGroups = groups.filter(g => g.canCreateInstance !== false);
    if (!validGroups.length) {
        el.innerHTML = `<div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:6px 0;">${t('worlds.groups.none_create_rights', 'No groups with instance creation rights')}</div>`;
        return;
    }
    el.innerHTML = validGroups.map(g => {
        const icon = g.iconUrl
            ? `<img class="fd-group-icon" src="${esc(imgThumb(g.iconUrl, 96))}" onerror="this.style.display='none'">`
            : `<div class="fd-group-icon fd-group-icon-empty"><span class="msi" style="font-size:18px;">group</span></div>`;
        return `<div class="fd-group-card ci-group-card" data-gid="${esc(g.id)}" onclick="ciSelectGroup('${esc(g.id)}',this)">
            ${icon}
            <div class="fd-group-card-info">
                <div class="fd-group-card-name">${esc(g.name)}</div>
                <div class="fd-group-card-meta">${esc(g.shortCode || '')} &middot; ${tf('worlds.groups.members', { count: g.memberCount || 0 }, '{count} members')}</div>
            </div>
        </div>`;
    }).join('');
}

function ciSelectGroup(groupId, el) {
    document.getElementById('ciGroupId').value = groupId;
    document.querySelectorAll('.ci-group-card').forEach(c => c.classList.remove('ci-group-selected'));
    el.classList.add('ci-group-selected');
}

function createInstance(worldId) {
    // Legacy wrapper - open the create instance modal if world is set
    if (worldId && _ciWorld?.id !== worldId) _ciWorld = { id: worldId, name: worldId, thumb: '' };
    openCreateInstanceModal();
}

let _ciWorldId = '';
let _ciWorld = null;

function openCreateInstanceModal() {
    if (!_ciWorld) return;
    _ciWorldId = _ciWorld.id;
    const worldName = _ciWorld.name;
    const thumb = _ciWorld.thumb || '';

    const el = document.getElementById('createInstanceContent');
    if (!el) return;

    el.innerHTML = `
        ${renderModalBar(worldName, [modalCloseAction('closeCreateInstanceModal()')], { flush: true })}
        ${thumb ? `<div class="fd-banner"><img src="${esc(thumb)}" onerror="this.parentElement.style.display='none'"><div class="fd-banner-fade"></div></div>` : ''}
        <div class="fd-content${thumb ? ' fd-has-banner' : ''}" style="padding:20px 32px;">
            <h2 style="margin:0 0 16px;color:var(--tx0);font-size:calc(18px + var(--fs-off, 0px));">${esc(worldName)}</h2>

            <div class="wd-section-label">${t('timeline.detail.instance_type', 'Instance Type')}</div>
            <div class="fd-tabs" id="ciTypePills" style="margin-bottom:0;">
                <button class="fd-tab active" data-type="private" onclick="setCiType('private',this)">${t('worlds.instances.types.invite', 'Invite')}</button>
                <button class="fd-tab" data-type="invite_plus" onclick="setCiType('invite_plus',this)">${t('worlds.instances.types.invite_plus', 'Invite+')}</button>
                <button class="fd-tab" data-type="friends" onclick="setCiType('friends',this)">${t('worlds.instances.types.friends', 'Friends')}</button>
                <button class="fd-tab" data-type="hidden" onclick="setCiType('hidden',this)">${t('worlds.instances.types.friends_plus', 'Friends+')}</button>
                <button class="fd-tab" data-type="group" onclick="setCiType('group',this)">${t('worlds.instances.types.group_root', 'Group')}</button>
                <button class="fd-tab" data-type="public" onclick="setCiType('public',this)">${t('worlds.instances.types.public', 'Public')}</button>
            </div>

            <div id="ciGroupSubPillsWrap" style="margin-top:6px;">
                <div class="fd-tabs" id="ciGroupSubPills" style="margin-bottom:0;">
                    <button class="fd-tab active" data-type="group_members" onclick="setCiGroupType('group_members',this)">${t('worlds.instances.types.group', 'Members')}</button>
                    <button class="fd-tab" data-type="group_plus" onclick="setCiGroupType('group_plus',this)">${t('worlds.instances.types.group_plus', 'Group+')}</button>
                    <button class="fd-tab" data-type="group_public" onclick="setCiGroupType('group_public',this)">${t('worlds.instances.types.group_public', 'Group Public')}</button>
                </div>
            </div>

            <div class="ci-toggle-row" id="ciQueueRow">
                <span>${t('worlds.instances.queue', 'Queue')}</span>
                <label class="ci-toggle"><input type="checkbox" id="ciQueueEnabled"><span class="ci-toggle-slider"></span></label>
            </div>
            <div class="ci-toggle-row" id="ciAgeGateRow">
                <span>${t('worlds.instances.age_gate', 'Age Gate')}</span>
                <label class="ci-toggle"><input type="checkbox" id="ciAgeGateEnabled"><span class="ci-toggle-slider"></span></label>
            </div>

            <div style="margin-top:14px;">
                <div class="wd-section-label">${t('worlds.instances.instance_name', 'Instance Name')} <span class="vrcn-supporter-badge" style="vertical-align:middle;margin-left:4px;">VRC+</span></div>
                <input type="text" id="ciInstanceName" class="ci-instance-name-input" placeholder="${t('worlds.instances.instance_name_placeholder', 'Optional name...')}" maxlength="64">
            </div>

            <div id="ciGroupRow" style="margin-top:12px;">
                <div class="wd-section-label" style="margin-bottom:6px;">${t('worlds.instances.select_group', 'Select Group')}</div>
                <input type="hidden" id="ciGroupId" value="">
                <div class="ci-group-list" id="ciGroupList"></div>
            </div>

            <div style="margin-top:14px;">
                <div class="wd-section-label" style="margin-bottom:6px;">${t('worlds.instances.region', 'Region')}</div>
                <select id="ciRegion" class="wd-create-select">
                    <option value="eu">${getWorldRegionLabel('eu')}</option>
                    <option value="us">${getWorldRegionLabel('us')}</option>
                    <option value="use">${getWorldRegionLabel('use')}</option>
                    <option value="jp">${getWorldRegionLabel('jp')}</option>
                </select>
            </div>

            <input type="hidden" id="ciTypeValue" value="private">
            <input type="hidden" id="ciGroupTypeValue" value="group_members">

            <div class="fd-actions" style="margin-top:20px;flex-wrap:wrap;gap:8px;">
                <button class="vrcn-button-round" id="ciCreateBtn" onclick="doCreateInstance(false)">
                    <span class="msi" style="font-size:14px;">add_circle_outline</span> ${t('worlds.instances.create_only', 'Create Instance')}
                </button>
                <button class="vrcn-button-round vrcn-btn-primary" id="ciCreateJoinBtn" onclick="doCreateInstance(true)">
                    <span class="msi" style="font-size:14px;">play_circle</span> ${t('worlds.instances.create_join', 'Create &amp; Join')}
                </button>
            </div>
        </div>`;

    initVnSelect(document.getElementById('ciRegion'));
    onCiTypeChange();
    document.getElementById('modalCreateInstance').style.display = 'flex';
}

function closeCreateInstanceModal() {
    document.getElementById('modalCreateInstance').style.display = 'none';
}

function setCiType(type, btn) {
    document.querySelectorAll('#ciTypePills .fd-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const hidden = document.getElementById('ciTypeValue');
    if (hidden) hidden.value = type;
    onCiTypeChange();
}

function setCiGroupType(type, btn) {
    document.querySelectorAll('#ciGroupSubPills .fd-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const hidden = document.getElementById('ciGroupTypeValue');
    if (hidden) hidden.value = type;
}

function doCreateInstance(andJoin) {
    const worldId = _ciWorldId;
    const type = document.getElementById('ciTypeValue')?.value || 'public';
    const region = document.getElementById('ciRegion')?.value || 'eu';
    const instanceName = (document.getElementById('ciInstanceName')?.value || '').trim();
    const queueEnabled = document.getElementById('ciQueueEnabled')?.checked ?? false;
    const ageGateEnabled = document.getElementById('ciAgeGateEnabled')?.checked ?? false;

    const createBtn = document.getElementById('ciCreateBtn');
    const joinBtn = document.getElementById('ciCreateJoinBtn');
    const loadHtml = `<span class="msi" style="font-size:14px;">hourglass_empty</span> ${t('worlds.instances.creating', 'Creating...')}`;
    if (createBtn) { createBtn.disabled = true; createBtn.innerHTML = loadHtml; }
    if (joinBtn) { joinBtn.disabled = true; joinBtn.innerHTML = loadHtml; }

    if (type === 'group') {
        const groupSubType = document.getElementById('ciGroupTypeValue')?.value || 'group_members';
        const groupId = document.getElementById('ciGroupId')?.value || '';
        if (!groupId) {
            if (createBtn) { createBtn.disabled = false; createBtn.innerHTML = `<span class="msi" style="font-size:14px;">add_circle_outline</span> ${t('worlds.instances.create_only', 'Create Instance')}`; }
            if (joinBtn) { joinBtn.disabled = false; joinBtn.innerHTML = `<span class="msi" style="font-size:14px;">play_circle</span> ${t('worlds.instances.create_join', 'Create & Join')}`; }
            return;
        }
        const accessType = groupSubType === 'group_public' ? 'public' : groupSubType === 'group_plus' ? 'plus' : 'members';
        sendToCS({ action: 'vrcCreateGroupInstance', worldId, groupId, groupAccessType: accessType, region, instanceName, queueEnabled, ageGateEnabled, andJoin });
    } else {
        sendToCS({ action: 'vrcCreateInstance', worldId, type, region, instanceName, andJoin });
    }
}

let _pendingCreateInstance = null;

function createWorldInstance(worldId) {
    if (!worldId) return;
    const cached = (typeof dashWorldCache !== 'undefined' && dashWorldCache[worldId]) || {};
    if (cached.name) {
        _ciWorld = { id: worldId, name: cached.name, thumb: cached.thumbnailImageUrl || cached.imageUrl || '' };
        openCreateInstanceModal();
    } else {
        // World not in cache yet - fetch it, then open the modal
        _pendingCreateInstance = worldId;
        sendToCS({ action: 'vrcResolveWorlds', worldIds: [worldId] });
    }
}

function onCreateInstanceWorldResolved(dict) {
    if (!_pendingCreateInstance) return;
    const worldId = _pendingCreateInstance;
    _pendingCreateInstance = null;
    const w = dict[worldId];
    _ciWorld = { id: worldId, name: w?.name || worldId, thumb: w?.thumbnailImageUrl || w?.imageUrl || '' };
    openCreateInstanceModal();
}

