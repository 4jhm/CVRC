/* === World Modal === */
const _worldBannerImgs = {};
function _getWorldBannerImg(worldId, src) {
    if (!worldId || !src) return null;
    if (!_worldBannerImgs[worldId]) {
        const img = new Image();
        img.src = src;
        img.onerror = () => { if (img.parentElement) img.parentElement.style.display = 'none'; };
        _worldBannerImgs[worldId] = { img, src };
    } else if (_worldBannerImgs[worldId].src !== src) {
        _worldBannerImgs[worldId].img.src = src;
        _worldBannerImgs[worldId].src = src;
    }
    return _worldBannerImgs[worldId].img;
}
let _wdLiveTimer = null;
let _wdCurrentId = '';
let _wdCurrentTab = 'info';
let _wdRefreshing = false;
const _wdRawJsonCache = {};
let _wdInstanceHistory = [];

/* === Detail Modals (shared) === */
function openWorldSearchDetail(id) {
    if (typeof navSetCurrent === 'function') navSetCurrent('worldSearch', id);
    _wdCurrentId = id;
    const el = document.getElementById('detailModalContent');
    el.innerHTML = sk('content-modal-compact');
    const _wdMb = document.querySelector('#modalDetail .modal-box');
    if (_wdMb) _wdMb.classList.remove('narrow');
    const _wdMod = document.getElementById('modalDetail');
    _wdMod.classList.remove('gd-style-compact', 'tl-style-compact');
    _wdMod.classList.add('wd-style-compact');
    _wdMod.style.display = 'flex';
    sendToCS({ action: 'vrcGetWorldDetail', worldId: id });
}

function refreshWorldInstances() {
    if (!_wdCurrentId) return;
    _wdRefreshing = true;
    const btn = document.getElementById('wdInstancesRefreshBtn');
    if (btn) btn.classList.add('spinning');
    sendToCS({ action: 'vrcGetWorldDetail', worldId: _wdCurrentId });
}

function _wdUpdateInstancesInPlace(w) {
    const tab = document.getElementById('wdTabInstances');
    if (!tab) return;
    const thumb = w.imageUrl || w.thumbnailImageUrl || '';

    // Build friend-by-location map
    const worldFriendsByLoc = {};
    if (typeof vrcFriendsData !== 'undefined') {
        vrcFriendsData.forEach(f => {
            const { worldId: fwid } = parseFriendLocation(f.location);
            if (fwid === w.id) {
                if (!worldFriendsByLoc[f.location]) worldFriendsByLoc[f.location] = [];
                worldFriendsByLoc[f.location].push(f);
            }
        });
    }
    const stripNonce = l => (l || '').replace(/~nonce\([^)]*\)/g, '');
    const allInstances = [...(w.instances || [])];
    Object.keys(worldFriendsByLoc).forEach(loc => {
        const existing = allInstances.find(i => stripNonce(i.location) === stripNonce(loc));
        if (existing) { existing.location = loc; }
        else {
            const { instanceType: iType } = parseFriendLocation(loc);
            const regionMatch = loc.match(/region\(([^)]+)\)/);
            allInstances.push({ instanceId: loc.includes(':') ? loc.split(':')[1] : loc, users: worldFriendsByLoc[loc].length, type: iType, region: regionMatch ? regionMatch[1] : 'us', location: loc });
        }
    });
    allInstances.sort((a, b) => ((worldFriendsByLoc[b.location] || []).length) - ((worldFriendsByLoc[a.location] || []).length));

    const makeCard = inst => renderInstanceItem({
        thumb, worldTitle: w.name || '', instanceType: inst.type,
        instanceId: inst.instanceId || '', owner: inst.ownerName || '',
        ownerGroup: inst.ownerGroup || '', ownerId: inst.ownerId || '',
        region: getWorldRegionLabel(inst.region), userCount: inst.users,
        capacity: w.capacity || 0, friends: getInstanceMembers(inst.location),
        location: inst.location, ageGate: inst.ageGate || false,
        languageRatio: inst.languageRatio || {},
    });

    const newIds = new Set(allInstances.map(i => i.instanceId || ''));
    let list = tab.querySelector('.wd-instances-list');

    if (!list) {
        // Currently showing empty-state text; replace with a fresh list
        const after = tab.querySelector('.wd-section-label');
        while (after && after.nextSibling) tab.removeChild(after.nextSibling);
        if (allInstances.length > 0) {
            list = document.createElement('div');
            list.className = 'wd-instances-list';
            list.style.cssText = 'max-height:370px;overflow-y:auto;';
            list.innerHTML = allInstances.map(makeCard).join('');
            tab.appendChild(list);
        } else {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:14px 0;';
            empty.textContent = t('worlds.instances.none_active', 'No active instances');
            tab.appendChild(empty);
        }
    } else {
        // Remove cards whose instance is gone
        [...list.querySelectorAll('[data-iid]')].forEach(card => {
            if (!newIds.has(card.getAttribute('data-iid'))) card.remove();
        });

        // Update existing cards and append new ones
        allInstances.forEach(inst => {
            const iid = inst.instanceId || '';
            const existing = [...list.querySelectorAll('[data-iid]')].find(c => c.getAttribute('data-iid') === iid);
            const tmp = document.createElement('div');
            tmp.innerHTML = makeCard(inst);
            const newCard = tmp.firstElementChild;
            if (!newCard) return;
            if (existing) {
                list.replaceChild(newCard, existing);
            } else {
                list.appendChild(newCard);
            }
        });

        // If list is now empty, show empty state
        if (allInstances.length === 0) {
            list.remove();
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:14px 0;';
            empty.textContent = t('worlds.instances.none_active', 'No active instances');
            tab.appendChild(empty);
        }
    }

    // Update count label and tab button
    const countSpan = tab.querySelector('.wd-section-label span');
    if (countSpan) countSpan.innerHTML = `${t('worlds.instances.active_title_label', 'ACTIVE INSTANCES')} <span class="vrcn-badge fd-tab-badge">${allInstances.length}</span>`;
    const tabBtn = [...document.querySelectorAll('.fd-tab')].find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes("'instances'"));
    if (tabBtn) tabBtn.innerHTML = `${t('worlds.tabs.instances_label', 'Instances')} <span class="vrcn-badge fd-tab-badge">${allInstances.length}</span>`;
}

function renderWorldSearchDetail(w) {
    if (w.id && w.rawJson) _wdRawJsonCache[w.id] = w.rawJson;
    if (typeof navUpdateLabel === 'function') navUpdateLabel(w.name || '');
    // Stop refresh spinner if running
    const refreshBtn = document.getElementById('wdInstancesRefreshBtn');
    if (refreshBtn) refreshBtn.classList.remove('spinning');
    // During a refresh: skip the cached response entirely (it has no instances),
    // and intercept the live response to update in-place without clearing the list.
    if (_wdRefreshing) {
        if (w.fromCache) return; // ignore cached response during refresh — it has empty instances
        _wdRefreshing = false;
        if (w.id) worldInfoCache[w.id] = w;
        _wdUpdateInstancesInPlace(w);
        return;
    }
    // Cache full world data so favorites grid can render it immediately after favoriting
    if (w.id) worldInfoCache[w.id] = w;
    const el = document.getElementById('detailModalContent');
    const thumb = w.imageUrl || w.thumbnailImageUrl || '';
    const desc = w.description || '';
    const wid = w.id || '';
    const authorTags = (w.tags || []).filter(t => t.startsWith('author_tag_')).map(t => t.replace('author_tag_', ''));
    const systemTags = (w.tags || []).filter(t => !t.startsWith('author_tag_') && !t.startsWith('system_') && !t.startsWith('admin_'));

    // Tags HTML
    let tagsHtml = '';
    if (authorTags.length || systemTags.length) {
        const allTags = [...authorTags, ...systemTags].slice(0, 12);
        tagsHtml = `<div class="fd-lang-tags">${allTags.map(t => `<span class="vrcn-badge">${esc(t)}</span>`).join('')}</div>`;
    }

    // Build friend-by-location map for this world (for friend badges + inferred instances)
    const worldFriendsByLoc = {};
    if (typeof vrcFriendsData !== 'undefined') {
        vrcFriendsData.forEach(f => {
            const { worldId: fwid } = parseFriendLocation(f.location);
            if (fwid === w.id) {
                if (!worldFriendsByLoc[f.location]) worldFriendsByLoc[f.location] = [];
                worldFriendsByLoc[f.location].push(f);
            }
        });
    }

    // Merge API instances with friend-inferred non-public instances
    // Strip nonce for comparison: API instances don't have ~nonce(...) but friend locations do
    const stripNonce = l => (l || '').replace(/~nonce\([^)]*\)/g, '');
    const allInstances = [...(w.instances || [])];
    Object.keys(worldFriendsByLoc).forEach(loc => {
        const existing = allInstances.find(i => stripNonce(i.location) === stripNonce(loc));
        if (existing) {
            // Update location to friend's key so friend badges + sort work correctly
            existing.location = loc;
        } else {
            const { instanceType: iType } = parseFriendLocation(loc);
            const regionMatch = loc.match(/region\(([^)]+)\)/);
            allInstances.push({
                instanceId: loc.includes(':') ? loc.split(':')[1] : loc,
                users: worldFriendsByLoc[loc].length,
                type: iType,
                region: regionMatch ? regionMatch[1] : 'us',
                location: loc
            });
        }
    });

    // Instances with friends first
    allInstances.sort((a, b) => ((worldFriendsByLoc[b.location] || []).length) - ((worldFriendsByLoc[a.location] || []).length));

    let instancesHtml = '';
    if (allInstances.length > 0) {
        instancesHtml = `<div class="wd-instances-list" style="max-height:370px;overflow-y:auto;">${allInstances.map(inst => renderInstanceItem({
            thumb:         thumb,
            worldTitle:    w.name || '',
            instanceType:  inst.type,
            instanceId:    inst.instanceId || '',
            owner:         inst.ownerName  || '',
            ownerGroup:    inst.ownerGroup || '',
            ownerId:       inst.ownerId    || '',
            region:        getWorldRegionLabel(inst.region),
            userCount:     inst.users,
            capacity:      w.capacity || 0,
            friends:       getInstanceMembers(inst.location),
            location:      inst.location,
            ageGate:       inst.ageGate || false,
            languageRatio: inst.languageRatio || {},
        })).join('')}</div>`;
    } else {
        instancesHtml = `<div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:14px 0;">${t('worlds.instances.none_active', 'No active instances')}</div>`;
    }

    const isFavWorld = favWorldsData.some(fw => fw.id === w.id);

    const isOwnWorld = currentVrcUser && w.authorId === currentVrcUser.id;
    _wdCurrentWorldId = wid;
    window._currentWorldDetailFull = w;
    _ciWorld = { id: w.id, name: w.name, thumb };
    const hasWorldPhotos = typeof libraryFiles !== 'undefined' && libraryFiles.some(x => x.worldId === wid && (x.type === 'image' || x.type === 'gif'));

    const tabsHtml = `<div class="fd-tabs" style="margin-bottom:14px;">
        <button class="fd-tab active" onclick="switchWdTab('info',this)">${t('worlds.tabs.info', 'Info')}</button>
        <button class="fd-tab" onclick="switchWdTab('instances',this)">${t('worlds.tabs.instances_label', 'Instances')} <span class="vrcn-badge fd-tab-badge">${allInstances.length}</span></button>
        ${hasWorldPhotos ? `<button class="fd-tab" onclick="switchWdTab('photos',this)">${t('worlds.tabs.photos', 'Photos')}</button>` : ''}
        ${isOwnWorld ? `<button class="fd-tab" onclick="switchWdTab('insights',this)">${t('worlds.tabs.insights', 'Insights')}</button>` : ''}
        <button class="fd-tab" onclick="switchWdTab('json',this)">Json</button>
    </div>`;

    const _wmr = (label, val) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:calc(11px + var(--fs-off, 0px));"><span style="color:var(--tx3);">${label}</span><span style="color:var(--tx1);text-align:right;">${val}</span></div>`;
    const _wdInstCount = (w.instances || []).length;
    const wdInfosRows = [
        w.recommendedCapacity ? _wmr(t('worlds.meta.recommended', 'Recommended'), esc(getWorldPlayersLabel(w.recommendedCapacity))) : '',
        _wmr(t('worlds.meta.max_capacity', 'Max Capacity'), esc(getWorldPlayersLabel(w.capacity))),
        w.createdAt ? _wmr(t('worlds.meta.published', 'Published'), fmtShortDate(new Date(w.createdAt + 'T00:00:00'))) : '',
        w.updatedAt ? _wmr(t('worlds.meta.updated', 'Updated'), fmtShortDate(new Date(w.updatedAt + 'T00:00:00'))) : '',
        w.version != null ? _wmr(t('worlds.meta.version', 'Version'), String(w.version)) : '',
    ].join('');
    const wdCommunityRows = [
        _wmr(t('worlds.meta.instances', 'Instances'), String(_wdInstCount)),
        _wmr(t('worlds.meta.public_players', 'Public Players'), String(w.publicOccupants ?? 0)),
        _wmr(t('worlds.meta.private_players', 'Private Players'), String(w.privateOccupants ?? 0)),
    ].join('');
    const wdPopularityRows = [
        w.heat != null ? _wmr(t('worlds.meta.heat', 'Heat'), String(w.heat)) : '',
        w.popularity != null ? _wmr(t('worlds.meta.popularity', 'Popularity'), String(w.popularity)) : '',
    ].join('');

    const wdHeaderActions = renderModalActions([
        { icon: 'refresh', iconClass: 'fd-refresh-spin', title: t('common.refresh', 'Refresh'), onclick: `triggerModalRefresh({action:'vrcGetWorldDetail',worldId:'${jsq(wid)}',force:true})` },
        { icon: 'link_2', title: t('common.share', 'Share'), onclick: `navigator.clipboard.writeText('https://vrchat.com/home/world/${esc(wid)}').then(()=>showToast(true,t('common.link_copied','Link copied!')))` },
        { icon: 'close', title: t('common.close', 'Close'), onclick: `closeWorldSearchDetail()` },
    ]);

    const wdStatsBadges = `<span class="vrcn-badge"><span class="msi" style="font-size:11px;">person</span> ${w.occupants} ${t('worlds.meta.active', 'Active')}</span>
            <span class="vrcn-badge"><span class="msi" style="font-size:11px;">favorite</span> ${w.favorites}</span>
            <span class="vrcn-badge"><span class="msi" style="font-size:11px;">visibility</span> ${w.visits}</span>
            ${w.pcSize > 0 ? `<span class="vrcn-badge"><span class="msi" style="font-size:11px;">computer</span> ${formatFileSize(w.pcSize)}</span>` : ''}
            ${w.androidSize > 0 ? `<span class="vrcn-badge"><span class="msi" style="font-size:11px;">android</span> ${formatFileSize(w.androidSize)}</span>` : ''}
            ${w.iosSize > 0 ? `<span class="vrcn-badge"><span class="msi" style="font-size:11px;">phone_iphone</span> ${formatFileSize(w.iosSize)}</span>` : ''}`;
    const wdFavPickerHtml = `<div id="wdFavPicker" style="display:none;margin-bottom:14px;">
            <div class="wd-section-label" style="margin-bottom:6px;">${t('worlds.favorites.add_group_title', 'ADD TO FAVORITE GROUP')}</div>
            <div class="ci-group-list" id="wdFavGroupList"><div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:8px 0;">${t('worlds.favorites.loading_groups', 'Loading groups...')}</div></div>
        </div>`;
    const wdTagsCard = tagsHtml ? `<div class="fd-info-card"><div class="fd-group-rep-label">${t('worlds.meta.tags_title', 'Tags')}</div>${tagsHtml}</div>` : '';
    const wdTimeCard = (w.worldTimeSeconds > 0 || currentInstanceData?.worldId === wid) ? `<div class="fd-info-card"><div class="wd-your-time"><span class="msi" style="font-size:15px;">schedule</span><div><div style="font-size:calc(12px + var(--fs-off, 0px));font-weight:600;color:var(--tx1);">${t('worlds.time_spent.label', 'Your Time Spent')}</div><div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);"><span id="wdTimeSpent">${formatDuration(w.worldTimeSeconds || 0)}</span>${w.worldVisitCount > 0 ? ' &middot; ' + getWorldVisitCountLabel(w.worldVisitCount) : ''}</div></div></div></div>` : '';
    const wdInfosCard = `<div class="fd-info-card"><div class="fd-group-rep-label">${t('worlds.meta.infos_title', 'Infos')}</div><div style="display:grid;gap:6px;">${wdInfosRows}</div></div>`;
    const wdCommunityCard = wdCommunityRows ? `<div class="fd-info-card"><div class="fd-group-rep-label">${t('worlds.meta.community_title', 'Community')}</div><div style="display:grid;gap:6px;">${wdCommunityRows}</div></div>` : '';
    const wdPopularityCard = wdPopularityRows ? `<div class="fd-info-card"><div class="fd-group-rep-label">${t('worlds.meta.popularity_title', 'Popularity')}</div><div style="display:grid;gap:6px;">${wdPopularityRows}</div></div>` : '';
    const wdHistoryInner = `<div class="fd-group-rep-label">${t('worlds.instance_history.title', 'Instance History')}</div>
            <div id="wdInstanceHistory" style="max-height:160px;overflow-y:auto;"><div style="padding:4px 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('profiles.insights.loading', 'Loading...')}</div></div>`;
    const wdNameAuthor = `<h2 style="margin:0 0 4px;color:var(--tx0);font-size:calc(18px + var(--fs-off, 0px));">${esc(w.name)}</h2>
        <div style="font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);margin-bottom:12px;">${t('worlds.meta.by', 'by')} ${w.authorId ? `<span onclick="navOpenModal('friend','${jsq(w.authorId)}','${jsq(w.authorName || '')}')" style="display:inline-flex;align-items:center;padding:1px 8px;border-radius:20px;background:var(--bg-hover);font-size:calc(11px + var(--fs-off, 0px));font-weight:600;color:var(--tx1);cursor:pointer;line-height:1.8;">${esc(w.authorName)}</span>` : esc(w.authorName)}</div>`;
    const wdStatsBadgesRow = `<div class="fd-badges-row">${wdStatsBadges}</div>`;
    const wdActionsCompact = `<div class="fd-actions">
            <button class="vrcn-button-round" onclick="openCreateInstanceModal()" title="${esc(t('worlds.instances.create_title', 'Create Instance'))}"><span class="msi" style="font-size:16px;">add_circle_outline</span></button>
            <button class="vrcn-button-round${isFavWorld ? ' active' : ''}" id="wdFavBtn" onclick="toggleWorldFavPicker('${wid}')" title="${isFavWorld ? esc(t('worlds.favorites.unfavorite', 'Unfavorite')) : esc(t('worlds.favorites.favorite', 'Favorite'))}"><span class="msi" style="font-size:16px;">${isFavWorld ? 'favorite' : 'favorite_border'}</span></button>
        </div>`;
    const wdDescTransBtn = (desc && window._kxdProfileTranslationEnabled !== false) ? `<button class="fd-bio-translate myp-edit-btn" onclick="fdTranslateBio(this)" title="${esc(t('profiles.bio.translate', 'Translate'))}"><span class="msi" style="font-size:14px;">translate</span></button>` : '';
    const wdDescCardCompact = `<div class="fd-info-card">
            <div class="fd-group-rep-label">${t('worlds.meta.description_title', 'Description')}${wdDescTransBtn}</div>
            <div class="fd-badges-row fd-bio-badges-row" style="margin-bottom:10px;">${idBadge(wid)}</div>
            ${desc ? `<div class="fd-bio" style="font-size:calc(12px + var(--fs-off, 0px));color:var(--tx2);max-height:150px;overflow-y:auto;line-height:1.5;white-space:pre-wrap;margin-bottom:0;">${esc(desc)}</div>` : ''}
        </div>`;
    const wdComPopRow = (wdCommunityCard && wdPopularityCard)
        ? `<div class="wd-compact-row">${wdCommunityCard}${wdPopularityCard}</div>`
        : `${wdCommunityCard}${wdPopularityCard}`;
    const wdInfoCompactRight = `<div class="fd-info-wrap">${wdDescCardCompact}${wdComPopRow}<div class="fd-info-card">${wdHistoryInner}</div></div>`;

    const wdInstancesTab = `<div id="wdTabInstances" style="display:none;">
            <div class="wd-section-label wd-instances-label" style="margin-top:4px;"><span>${t('worlds.instances.active_title_label', 'ACTIVE INSTANCES')} <span class="vrcn-badge fd-tab-badge">${allInstances.length}</span></span><button class="mi-refresh-btn" id="wdInstancesRefreshBtn" onclick="refreshWorldInstances()" title="Refresh instances"><span class="msi">refresh</span></button></div>
            ${instancesHtml}
        </div>`;
    const wdPhotosTab = `<div id="wdTabPhotos" style="display:none;"><div id="wdPhotosGrid"></div><div id="wdPhotosPaginatorBar" class="mini-paginator"></div></div>`;
    const wdInsightsTab = isOwnWorld ? `<div id="wdTabInsights" style="display:none;"><div id="wiContainer"></div></div>` : '';
    const wdJsonTab = `<div id="wdTabJson" style="display:none;"><div class="json-viewer">${jsonHighlight((w.id && _wdRawJsonCache[w.id]) || {})}</div></div>`;

    {
        const wdLeftHtml = `<div class="fd-left">
            <div class="fd-left-banner" id="wd-banner-slot">${thumb ? '<div class="fd-banner-fade"></div>' : ''}</div>
            <div class="fd-left-body">
                <div>${wdNameAuthor}</div>
                ${wdStatsBadgesRow}
                ${wdActionsCompact}
                ${wdFavPickerHtml}
                ${wdTimeCard}
                ${wdInfosCard}
                ${wdTagsCard}
            </div>
        </div>`;
        const wdRightHtml = `<div class="fd-right"><div class="fd-right-scroll">
            ${tabsHtml}
            <div id="wdTabInfo">${wdInfoCompactRight}</div>
            ${wdInstancesTab}${wdPhotosTab}${wdInsightsTab}${wdJsonTab}
        </div></div>`;
        el.innerHTML = `${wdHeaderActions}<div class="fd-layout">${wdLeftHtml}${wdRightHtml}</div>`;
    }

    const _wdModal = document.getElementById('modalDetail');
    if (_wdModal) {
        _wdModal.classList.remove('gd-style-compact', 'tl-style-compact');
        _wdModal.classList.add('wd-style-compact');
    }
    if (thumb) { const s = document.getElementById('wd-banner-slot'); const bi = _getWorldBannerImg(wid, thumb); if (s && bi) s.insertBefore(bi, s.firstChild); }
    if (hasWorldPhotos) { _wdPreloadPhotos(wid); _wdLoadPhotos(wid); }
    if (wid) { _wdInstanceHistory = []; sendToCS({ action: 'getTimelineForWorld', worldId: wid }); }
    if (_wdCurrentTab !== 'info') {
        if (_wdCurrentTab === 'photos' && !hasWorldPhotos) {
            _wdCurrentTab = 'info';
        } else {
            const activeTabBtn = el.querySelector(`.fd-tab[onclick*="'${_wdCurrentTab}'"]`);
            switchWdTab(_wdCurrentTab, activeTabBtn);
        }
    }
    // Live timer - only when currently in this world
    if (_wdLiveTimer) { clearInterval(_wdLiveTimer); _wdLiveTimer = null; }
    if (currentInstanceData?.worldId === wid) {
        let liveSecs = w.worldTimeSeconds || 0;
        _wdLiveTimer = setInterval(() => {
            liveSecs++;
            const el = document.getElementById('wdTimeSpent');
            if (el) el.textContent = formatDuration(liveSecs);
            else { clearInterval(_wdLiveTimer); _wdLiveTimer = null; }
        }, 1000);
    }
}

function renderWdInstanceHistory(worldId, events) {
    if (_wdCurrentId !== worldId) return;
    const el = document.getElementById('wdInstanceHistory');
    if (!el) return;

    _wdInstanceHistory = events || [];

    if (!_wdInstanceHistory.length) {
        el.innerHTML = `<div style="padding:4px 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('timeline.empty.initial', 'No events yet')}</div>`;
        return;
    }

    el.innerHTML = _wdInstanceHistory.map(ev => {
        const meta   = typeof tlTypeMeta === 'function' ? tlTypeMeta(ev.type) : { icon: 'event', label: ev.type };
        const color  = { instance_join:'var(--accent)', photo:'var(--ok)', first_meet:'var(--cyan)', meet_again:'#6554FF', notification:'var(--warn)', avatar_switch:'#FF7043', video_url:'#29B6F6' }[ev.type] || 'var(--tx3)';
        const d      = new Date(ev.timestamp);
        const dt     = `${fmtShortDate(d)} | ${fmtTime(d)}`;
        const ei     = ev.id.replace(/'/g, "\\'");
        const detail = typeof _tlListData === 'function' ? (_tlListData(ev).detail || '') : '';
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 2px;border-bottom:1px solid var(--brd);cursor:pointer;" onclick="openTlDetail('${ei}', true)">
            <span style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);white-space:nowrap;">${esc(dt)}</span>
            <span class="msi" style="font-size:14px;color:${color};flex-shrink:0;">${meta.icon}</span>
            <span style="font-size:calc(12px + var(--fs-off, 0px));">${esc(meta.label)}</span>
            ${detail ? `<span style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${detail}</span>` : ''}
        </div>`;
    }).join('');
}

let _wdCurrentWorldId = '';
let _wdPhotosPage = 0;
let _wdPhotosItems = [];
let _wdPreloadedThumbs = [];

function _wdPreloadPhotos(worldId) {
    _wdPreloadedThumbs.forEach(img => { img.src = typeof PLACEHOLDER !== 'undefined' ? PLACEHOLDER : ''; });
    _wdPreloadedThumbs = [];
    const photos = (typeof libraryFiles !== 'undefined' ? libraryFiles : [])
        .filter(x => x.worldId === worldId && (x.type === 'image' || x.type === 'gif') && x.url);
    photos.slice(0, MINI_IMAGE_PG_SIZE).forEach(x => {
        const img = new Image();
        img.src = x.url + '?thumb=1';
        _wdPreloadedThumbs.push(img);
    });
}

function _wdLoadPhotos(worldId) {
    _wdPhotosPage = 0;
    _wdPhotosItems = (typeof libraryFiles !== 'undefined' ? libraryFiles : [])
        .filter(x => x.worldId === worldId && (x.type === 'image' || x.type === 'gif'));
    _wdPhotosItems.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    _wdRenderPhotosPage();
}

function _wdPhotosGoPage(page) {
    const totalPages = Math.ceil(_wdPhotosItems.length / MINI_IMAGE_PG_SIZE) || 1;
    if (page < 0 || page >= totalPages) return;
    _wdPhotosPage = page;
    _wdRenderPhotosPage();
}

function _wdRenderPhotosPage() {
    const grid = document.getElementById('wdPhotosGrid');
    if (!grid) return;
    const start = _wdPhotosPage * MINI_IMAGE_PG_SIZE;
    const pageItems = _wdPhotosItems.slice(start, start + MINI_IMAGE_PG_SIZE);
    const totalPages = Math.ceil(_wdPhotosItems.length / MINI_IMAGE_PG_SIZE) || 1;
    if (!pageItems.length) {
        grid.innerHTML = `<div class="empty-msg">${t('worlds.photos.empty', 'No photos taken in this world.')}</div>`;
        const emptyBar = document.getElementById('wdPhotosPaginatorBar');
        if (emptyBar) emptyBar.innerHTML = '';
        return;
    }
    let h = `<div class="lib-date-group-cards" style="grid-template-columns:repeat(auto-fill,minmax(126px,1fr));">`;
    pageItems.forEach(x => { h += _buildWdPhotoCard(x); });
    h += `</div>`;
    grid.innerHTML = h;
    const bar = document.getElementById('wdPhotosPaginatorBar');
    if (bar) bar.innerHTML = buildMiniPaginator(_wdPhotosPage, totalPages, '_wdPhotosGoPage');
}

function _wdOnFileDeleted(path) {
    if (!_wdCurrentWorldId) return;
    if (!document.getElementById('wdPhotosGrid')) return;
    const idx = _wdPhotosItems.findIndex(x => x.path === path);
    if (idx < 0) return;
    _wdPhotosItems.splice(idx, 1);
    const totalPages = Math.ceil(_wdPhotosItems.length / MINI_IMAGE_PG_SIZE) || 1;
    if (_wdPhotosPage >= totalPages) _wdPhotosPage = totalPages - 1;
    _wdRenderPhotosPage();
}

function _wdOpenInLibrary(path) {
    closeWorldSearchDetail();
    showTab(7);
    if (typeof _libViewMode !== 'undefined' && _libViewMode === 'folder') setLibViewMode('grid');
    if (typeof showFavOnly !== 'undefined' && showFavOnly) {
        showFavOnly = false;
        document.getElementById('libFavBtn')?.classList.remove('active');
    }
    if (typeof _libFriendFilter !== 'undefined') _libFriendFilter = '__all__';
    if (typeof _libWorldFilter  !== 'undefined') _libWorldFilter  = '__all__';
    const folderEl = document.getElementById('libFolderFilter');
    if (folderEl) folderEl.value = '__all__';
    const typeEl = document.getElementById('libTypeFilter');
    if (typeEl) typeEl.value = 'all';
    filterLibrary();
    const idx = (typeof _libFiltered !== 'undefined' ? _libFiltered : []).findIndex(x => x.path === path);
    if (idx >= 0) libGoPage(Math.floor(idx / LIB_PAGE_SIZE));
    requestAnimationFrame(() => {
        const card = document.querySelector(`.lib-card[data-path="${CSS.escape(path)}"]`);
        if (card) card.scrollIntoView({ block: 'nearest' });
    });
}

function _buildWdPhotoCard(x) {
    const su        = x.url || '';
    const suAttr    = esc(su);
    const sp        = jsq(x.path || '');
    const iH        = (typeof hiddenMedia !== 'undefined') && hiddenMedia.has(x.path);
    const blurClass = iH ? ' lib-blurred' : '';
    const players   = x.players || [];
    let playersOverlay = '';
    if (players.length > 0) {
        const show      = players.slice(0, 3);
        const remaining = players.length - show.length;
        playersOverlay  = `<div class="lib-players-overlay">` +
            show.map(p => {
                const isOwn = currentVrcUser && p.userId === currentVrcUser.id;
                const fr    = isOwn ? currentVrcUser : vrcFriendsData.find(f => f.id === p.userId);
                const img   = fr?.image || p.image || '';
                return img
                    ? `<div class="lib-player-av" style="background-image:url('${cssUrl(imgThumb(img, 64))}')" title="${esc(p.displayName)}"></div>`
                    : `<div class="lib-player-av lib-player-av-letter" title="${esc(p.displayName)}">${esc((p.displayName || '?')[0])}</div>`;
            }).join('') +
            (remaining > 0 ? `<div class="lib-player-av lib-player-av-more">+${remaining}</div>` : '') +
            `</div>`;
    }
    const thumbSrc = suAttr ? suAttr + '?thumb=1' : '';
    const resTag   = (typeof _resTag === 'function') ? _resTag(x) : '';
    const resBadge = resTag ? `<span class="vrcn-badge accent" style="margin-left:4px;">${resTag}</span>` : '';
    return `<div class="lib-card" data-path="${esc(x.path||'')}" style="cursor:pointer;" onclick="_wdOpenInLibrary('${sp}')"><div class="lib-thumb-wrap${blurClass}"><img class="lib-thumb" src="${thumbSrc}" loading="lazy" onerror="this.outerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:calc(11px + var(--fs-off, 0px));font-weight:700\\'>${jsq(t('library.no_preview', 'No Preview'))}</div>'">${iH ? '<div class="lib-blur-hint"><span class="msi" style="font-size:18px;">visibility_off</span></div>' : ''}${playersOverlay}</div><div class="lib-info"><div class="lib-name">${esc(x.name)}</div><div class="lib-meta"><span style="display:flex;align-items:center;">${x.size}${resBadge}</span><span>${x.time}</span></div></div></div>`;
}

function switchWdTab(tab, btn) {
    _wdCurrentTab = tab;
    const box = document.querySelector('#modalDetail .modal-box');
    animateModalBox(box, () => {
        const info      = document.getElementById('wdTabInfo');
        const instances = document.getElementById('wdTabInstances');
        const photos    = document.getElementById('wdTabPhotos');
        const insights  = document.getElementById('wdTabInsights');
        const jsonEl    = document.getElementById('wdTabJson');
        if (info)      info.style.display      = tab === 'info'      ? '' : 'none';
        if (instances) instances.style.display = tab === 'instances' ? '' : 'none';
        if (photos)    photos.style.display    = tab === 'photos'    ? '' : 'none';
        if (insights)  insights.style.display  = tab === 'insights'  ? '' : 'none';
        if (jsonEl)    jsonEl.style.display    = tab === 'json'      ? '' : 'none';
        document.querySelectorAll('#detailModalContent .fd-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (tab === 'insights' && _wdCurrentWorldId) {
            wiLoadInsights(_wdCurrentWorldId);
        }
    });
}

function closeWorldSearchDetail(fromNav = false) {
    if (_wdLiveTimer) { clearInterval(_wdLiveTimer); _wdLiveTimer = null; }
    _wdPreloadedThumbs.forEach(img => { img.src = typeof PLACEHOLDER !== 'undefined' ? PLACEHOLDER : ''; });
    _wdPreloadedThumbs = [];
    _wdCurrentWorldId = '';
    _wdCurrentTab = 'info';
    if (typeof _wiReset === 'function') _wiReset();
    document.getElementById('modalDetail').classList.remove('wd-style-compact');
    document.getElementById('modalDetail').style.display = 'none';
    if (!fromNav && typeof navClear === 'function') navClear();
}

function toggleWorldFavPicker(worldId) {
    const entry = favWorldsData.find(fw => fw.id === worldId);
    if (entry) {
        removeWorldFavorite(worldId, entry.favoriteId);
        return;
    }
    const picker = document.getElementById('wdFavPicker');
    if (!picker) return;
    const open = picker.style.display !== 'none';
    picker.style.display = open ? 'none' : '';
    if (!open) renderWorldFavPicker(worldId);
}

function removeWorldFavorite(worldId, fvrtId) {
    const btn = document.getElementById('wdFavBtn');
    if (btn) btn.disabled = true;
    sendToCS({ action: 'vrcRemoveWorldFavorite', worldId, fvrtId });
}

function onWorldUnfavoriteResult(data) {
    const btn = document.getElementById('wdFavBtn');
    if (data.ok) {
        const removed = favWorldsData.find(fw => fw.id === data.worldId);
        const worldName = removed?.name || worldInfoCache[data.worldId]?.name || '';
        showToast(true, worldName
            ? tf('worlds.favorites.toast.removed.named', { world: worldName }, '"{world}" removed from favorites')
            : t('worlds.favorites.toast.removed', 'Removed from favorites'));
        favWorldsData = favWorldsData.filter(fw => fw.id !== data.worldId);
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('active');
            btn.innerHTML = `<span class="msi" style="font-size:16px;">favorite_border</span>${t('worlds.favorites.favorite', 'Favorite')}`;
        }
        filterFavWorlds();
        _scheduleBgFavRefresh();
    } else {
        if (btn) btn.disabled = false;
    }
}

function renderWorldFavPicker(worldId) {
    const list = document.getElementById('wdFavGroupList');
    if (!list) return;
    // If groups not loaded yet, request them
    if (favWorldGroups.length === 0) {
        list.innerHTML = `<div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:8px 0;">${t('worlds.favorites.loading_groups', 'Loading groups...')}</div>`;
        sendToCS({ action: 'vrcGetWorldFavGroups' });
        // Store pending worldId so we can render when groups arrive
        list.dataset.pendingWorldId = worldId;
        return;
    }
    const currentEntry = favWorldsData.find(fw => fw.id === worldId);
    const currentGroup = currentEntry?.favoriteGroup || '';
    list.innerHTML = favWorldGroups.map(g => {
        const count = favWorldsData.filter(fw => fw.favoriteGroup === g.name).length;
        const isCurrent = g.name === currentGroup;
        const vrcBadge = favGroupBadge(g);
        const check = isCurrent
            ? `<span class="msi" style="color:var(--accent);font-size:18px;flex-shrink:0;">check_circle</span>`
            : '';
        const gn = jsq(g.name), gt = jsq(g.type), wid = jsq(worldId);
        const oldFvrt = isCurrent ? jsq(currentEntry?.favoriteId || '') : '';
        return `<div class="fd-group-card ci-group-card${isCurrent ? ' ci-group-selected' : ''}"
            onclick="addWorldToFavGroup('${wid}','${gn}','${gt}','${oldFvrt}',this)" style="cursor:pointer;">
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                    <span style="font-size:calc(12px + var(--fs-off, 0px));font-weight:600;color:var(--tx1);">${esc(g.displayName || g.name)}</span>
                    ${vrcBadge}
                </div>
                <div style="font-size:calc(10px + var(--fs-off, 0px));color:var(--tx3);margin-top:1px;">${isLocalFavGroup(g) ? `${count}/${g.capacity || 200}` : tf('worlds.favorites.group_count', { count }, '{count}/100 worlds')}</div>
            </div>
            ${check}
        </div>`;
    }).join('');
}

function addWorldToFavGroup(worldId, groupName, groupType, oldFvrtId, rowEl) {
    // Optimistic UI: mark as selected
    document.querySelectorAll('#wdFavGroupList .ci-group-card').forEach(c => {
        c.classList.remove('ci-group-selected');
        const chk = c.querySelector('.msi');
        if (chk && chk.textContent === 'check_circle') chk.remove();
    });
    rowEl.classList.add('ci-group-selected');
    rowEl.insertAdjacentHTML('beforeend', '<span class="msi" style="color:var(--accent);font-size:18px;flex-shrink:0;">check_circle</span>');
    sendToCS({ action: 'vrcAddWorldFavorite', worldId, groupName, groupType, oldFvrtId });
}

function onWorldFavoriteResult(data) {
    if (data.ok) {
        const cached = worldInfoCache[data.worldId] || {};
        const worldName  = cached.name || favWorldsData.find(w => w.id === data.worldId)?.name || '';
        const group      = (typeof favWorldGroups !== 'undefined') && favWorldGroups.find(g => g.name === data.groupName);
        const groupLabel = group?.displayName || data.groupName;
        showToast(
            true,
            worldName
                ? tf('worlds.favorites.saved_to_group.named', { world: worldName, group: groupLabel }, '"{world}" saved to {group}')
                : tf('worlds.favorites.saved_to_group.unnamed', { group: groupLabel }, 'Saved to {group}')
        );

        const existing = favWorldsData.find(w => w.id === data.worldId);
        if (existing) {
            existing.favoriteGroup = data.groupName;
            existing.favoriteId   = data.newFvrtId;
        } else {
            favWorldsData.push({
                id: data.worldId,
                favoriteGroup:     data.groupName,
                favoriteId:        data.newFvrtId,
                name:              cached.name              || '',
                thumbnailImageUrl: cached.thumbnailImageUrl || cached.imageUrl || '',
                imageUrl:          cached.imageUrl          || '',
                authorName:        cached.authorName        || '',
                authorId:          cached.authorId          || '',
                occupants:         cached.occupants         || 0,
                favorites:         cached.favorites         || 0,
                visits:            cached.visits            || 0,
                capacity:          cached.capacity          || 0,
                tags:              cached.tags              || [],
                worldTimeSeconds:  cached.worldTimeSeconds  || 0,
                worldVisitCount:   cached.worldVisitCount   || 0,
            });
        }
        const btn = document.getElementById('wdFavBtn');
        if (btn) {
            btn.classList.add('active');
            btn.innerHTML = `<span class="msi" style="font-size:16px;">favorite</span>${t('worlds.favorites.unfavorite', 'Unfavorite')}`;
        }
        const list = document.getElementById('wdFavGroupList');
        if (list) renderWorldFavPicker(data.worldId);
        filterFavWorlds();
        _scheduleBgFavRefresh();
    } else {
        if (data.error) showToast(false, localFavErrorText(data.error));
        const list = document.getElementById('wdFavGroupList');
        if (list) {
            list.innerHTML = `<div style="font-size:calc(11px + var(--fs-off, 0px));color:var(--err,#e55);padding:6px 0;">${t('worlds.favorites.failed_add', 'Failed to add to favorites. Try again.')}</div>`;
            setTimeout(() => { if (document.getElementById('wdFavGroupList')) renderWorldFavPicker(data.worldId); }, 1800);
        }
    }
}

function onWorldFavGroupsLoaded(groups) {
    favWorldGroups = groups;
    // Check if picker is open and waiting
    const list = document.getElementById('wdFavGroupList');
    if (list && list.dataset.pendingWorldId) {
        const wid = list.dataset.pendingWorldId;
        delete list.dataset.pendingWorldId;
        renderWorldFavPicker(wid);
    }
}


/* === World Detail Modal === */
function openWorldDetail(worldId) {
    if (!worldId) return;
    if (typeof navSetCurrent === 'function') navSetCurrent('world', worldId);
    const m = document.getElementById('modalWorldDetail');
    const c = document.getElementById('worldDetailContent');

    // Enrich friends whose location is hidden but are known to be in our current instance
    const _instLoc = currentInstanceData?.worldId === worldId ? currentInstanceData.location : null;
    const _instUserIds = _instLoc ? new Set((currentInstanceData.users || []).map(u => u.id).filter(Boolean)) : new Set();
    const friendsRaw = vrcFriendsData.map(f =>
        (_instUserIds.has(f.id) && (!f.location || f.location === 'private')) ? { ...f, location: _instLoc } : f
    );

    // Find all friends in this world (plus self, so you can spot your own instance)
    const friends = friendsRaw.filter(f => {
        const { worldId: wid } = parseFriendLocation(f.location);
        return wid === worldId;
    });
    const _selfM = typeof _selfInstanceMember === 'function' ? _selfInstanceMember() : null;
    if (_selfM && parseFriendLocation(_selfM.location).worldId === worldId && !friends.some(f => f.id === _selfM.id)) {
        friends.unshift(_selfM);
    }

    const cached = dashWorldCache[worldId];
    const worldName = cached?.name || worldId;
    // Prefer full-res imageUrl for the large modal banner; thumbnailImageUrl is only a small preview
    const thumb = cached?.imageUrl || cached?.thumbnailImageUrl || '';

    // Group friends by instance (full location string)
    const instanceMap = {};
    friends.forEach(f => {
        const loc = (f.location || '').replace(/~nonce\([^)]*\)/, '');
        if (!instanceMap[loc]) {
            const { instanceType: iType, ownerId: iOwner } = parseFriendLocation(loc);
            const numMatch = loc.match(/:(\d+)/);
            instanceMap[loc] = { location: loc, instanceType: iType, ownerId: iOwner || '', instanceNum: numMatch ? numMatch[1] : '', friends: [] };
        }
        instanceMap[loc].friends.push(f);
    });
    const instanceList = Object.values(instanceMap);
    const multiInstance = instanceList.length > 1;

    // Resolve myInst early - needed for instance separation below
    const myInst = (typeof _myInstancesData !== 'undefined')
        ? _myInstancesData.find(i => i.worldId === worldId)
        : null;

    // Build header with banner fade (matching profiles/groups)
    const bannerHtml = thumb ? `<div class="fd-banner" id="wi-banner-slot"><div class="fd-banner-fade"></div></div>` : '';

    // Separate friends in MY instance from friends in other instances
    const myInstNum = myInst ? (myInst.location?.match(/:(\d+)/)?.[1] || '') : '';
    let myInstFriends = [];
    const otherInstMap = {};
    instanceList.forEach(inst => {
        if (myInstNum && inst.instanceNum === myInstNum) {
            myInstFriends = inst.friends;
        } else {
            otherInstMap[inst.location] = inst;
        }
    });
    const otherInstList = Object.values(otherInstMap);
    const totalSections = (myInst ? 1 : 0) + otherInstList.length;

    let friendsHtml = `<div class="wd-friends-label">${totalSections > 1
        ? tf('instance.sections.friends_in_world', { count: totalSections }, 'FRIENDS IN THIS WORLD ({count} instances)')
        : t('instance.sections.friends_here', 'FRIENDS IN THIS INSTANCE')}</div>`;

    // Render MY instance first (always, if it exists)
    if (myInst) {
        const { cls: iCls, label: iLabel } = getInstanceBadge(myInst.instanceType);
        const mnum = myInstNum;
        const mCopyBadge = mnum
            ? `<span class="vrcn-id-clip" style="font-size:calc(10px + var(--fs-off, 0px));" onclick="copyInstanceLink('${jsq(myInst.location)}')"><span class="msi" style="font-size:10px;">content_copy</span>#${esc(mnum)}</span>`
            : '';
        const myInstOwnerId = myInst.ownerId || parseFriendLocation(myInst.location).ownerId || '';
        const myInstOwnerBadge = getOwnerBadgeHtml(myInstOwnerId, myInst.ownerName || '', myInst.ownerGroup || '', 'closeWorldDetail()');
        if (totalSections > 1) {
            const _myRegion = getWorldRegionLabel((myInst.location?.match(/~region\(([^)]+)\)/) || [])[1] || '');
            const myRegionBadge = _myRegion ? `<span class="vrcn-badge accent">${esc(_myRegion)}</span>` : '';
            friendsHtml += `<div class="wd-instance-header">
                <span class="vrcn-badge ${iCls}">${iLabel}</span>
                ${myRegionBadge}
                ${myInstOwnerBadge}
                ${mCopyBadge}
            </div>`;
        }
        friendsHtml += '<div class="wd-friends-list">';
        if (myInstFriends.length > 0) {
            myInstFriends.forEach(f => {
                friendsHtml += renderProfileItem(f, `navOpenModal('friend','${jsq(f.id || '')}','${jsq(f.displayName || '')}')`);
            });
        } else {
            friendsHtml += `<div class="vrcn-user-item" style="pointer-events:none;opacity:0.55;">
                <div class="vrcn-user-item-avatar vrcn-user-item-avatar-letter"><span class="msi" style="font-size:20px;color:var(--tx3);">person</span></div>
                <div class="vrcn-user-item-info">
                    <div class="vrcn-user-item-name">${t('dashboard.instances.no_friends_title', 'No friends here yet!')}</div>
                    <div class="vrcn-user-item-status">${t('dashboard.instances.no_friends_desc', 'Invite friends to this instance!')}</div>
                </div>
            </div>`;
        }
        friendsHtml += '</div>';
    }

    // Render other instances
    otherInstList.forEach(inst => {
        let iResolvedType = inst.instanceType;
        const { cls: iCls, label: iLabel } = getInstanceBadge(iResolvedType);
        const canJoinInst = iResolvedType !== 'private' && iResolvedType !== 'invite_plus';
        const instLoc = inst.location.replace(/'/g, "\\'");
        const instCopyBadge = inst.instanceNum
            ? `<span class="vrcn-id-clip" style="font-size:calc(10px + var(--fs-off, 0px));" onclick="copyInstanceLink('${jsq(inst.location)}')"><span class="msi" style="font-size:10px;">content_copy</span>#${esc(inst.instanceNum)}</span>`
            : '';
        const instOwnerBadge = getOwnerBadgeHtml(inst.ownerId || '', '', '', 'closeWorldDetail()');
        if (totalSections > 1) {
            const _instRegion = getWorldRegionLabel((inst.location.match(/~region\(([^)]+)\)/) || [])[1] || '');
            const instRegionBadge = _instRegion ? `<span class="vrcn-badge accent">${esc(_instRegion)}</span>` : '';
            friendsHtml += `<div class="wd-instance-header">
                <span class="vrcn-badge ${iCls}">${iLabel}</span>
                ${instRegionBadge}
                ${instOwnerBadge}
                ${instCopyBadge}
                ${canJoinInst ? `<button class="vrcn-button-round vrcn-btn-join" style="margin-left:auto;" onclick="worldJoinAction('${instLoc}')">${t('common.join', 'Join')}</button>` : ''}
            </div>`;
        }
        friendsHtml += '<div class="wd-friends-list">';
        inst.friends.forEach(f => {
            friendsHtml += renderProfileItem(f, `navOpenModal('friend','${jsq(f.id || '')}','${jsq(f.displayName || '')}')`);
        });
        friendsHtml += '</div>';
    });

    // Actions - single instance: show Join World button; multi-instance: join buttons are per-instance above
    const anyLoc = otherInstList.length > 0 ? otherInstList[0].location : '';
    const anyInstType = otherInstList.length > 0 ? otherInstList[0].instanceType : 'public';
    const wid = worldId.replace(/'/g, "\\'");
    // Use myInst.instanceType (API-verified) when available - parseFriendLocation cannot detect Invite+
    const displayInstType = myInst?.instanceType || anyInstType;
    const { cls: instClass, label: instLabel } = getInstanceBadge(displayInstType);
    const loc = anyLoc.replace(/'/g, "\\'");
    const canJoin = !myInst && !multiInstance && anyLoc && anyInstType !== 'private' && anyInstType !== 'invite_plus';

    // Single-instance copy badge + owner badge - shown in fd-badges-row
    const instanceLoc = myInst?.location || anyLoc;
    const singleInstNum = instanceLoc.match(/:(\d+)/)?.[1] || '';
    const singleInstCopy = singleInstNum
        ? `<span class="vrcn-id-clip" onclick="copyInstanceLink('${jsq(instanceLoc)}')"><span class="msi" style="font-size:12px;">content_copy</span>#${esc(singleInstNum)}</span>`
        : '';
    const singleOwnerId = instanceList.length === 1 ? (instanceList[0].ownerId || '') : '';
    const singleOwnerBadge = singleOwnerId ? getOwnerBadgeHtml(singleOwnerId, '', '', 'closeWorldDetail()') : '';
    const _singleRegion = getWorldRegionLabel((instanceLoc.match(/~region\(([^)]+)\)/) || [])[1] || '');
    const singleRegionBadge = _singleRegion ? `<span class="vrcn-badge accent">${esc(_singleRegion)}</span>` : '';

    const wiBar = renderModalActions([
        canJoin ? { icon: 'login', title: t('dashboard.instances.join_world', 'Join World'), onclick: `worldJoinAction('${loc}')` } : null,
        { icon: 'public', title: t('dashboard.instances.open_world', 'Open World'), onclick: `navOpenModal('worldSearch','${wid}','${esc(cached?.name || '')}')` },
        { icon: 'close', title: t('common.close', 'Close'), onclick: `closeWorldDetail()` },
    ]);

    c.innerHTML = `${wiBar}${bannerHtml}<div class="fd-content${thumb ? ' fd-has-banner' : ''}" style="padding:16px 0;">
        <h2 style="margin:0 0 4px;color:var(--tx0);font-size:calc(18px + var(--fs-off, 0px));">${esc(worldName)}</h2>
        <div class="fd-badges-row">${multiInstance ? '' : (() => {
            const _oid = myInst ? (myInst.ownerId || parseFriendLocation(myInst.location).ownerId || '') : singleOwnerId;
            const _ob = getOwnerBadgeHtml(_oid, myInst?.ownerName || '', myInst?.ownerGroup || '', 'closeWorldDetail()');
            return `<span class="vrcn-badge ${instClass}">${instLabel}</span>${singleRegionBadge}${_ob}${singleInstCopy}`;
        })()}</div>
        ${friendsHtml}</div>`;
    if (thumb) { const s = document.getElementById('wi-banner-slot'); const bi = _getWorldBannerImg(worldId, thumb); if (s && bi) s.insertBefore(bi, s.firstChild); }
    m.style.display = 'flex';
}

function closeWorldDetail(fromNav = false) {
    document.getElementById('modalWorldDetail').style.display = 'none';
    if (!fromNav && typeof navClear === 'function') navClear();
}

function worldJoinAction(location) {
    const btns = document.querySelectorAll('#worldDetailContent button');
    btns.forEach(b => b.disabled = true);
    sendToCS({ action: 'vrcJoinFriend', location: location });
}

let _wiWorldId = '';
let _wiMode = 'week';      
let _wiAnchor = null;        
let _wiData = [];          
let _wiLoading = false;
let _wiInitialized = false; 
let _wiDpYear = 0, _wiDpMonth = 0; 

function wiLocale() {
    return getLanguageLocale();
}

function wiWeekdayLabels() {
        const fmt = new Intl.DateTimeFormat(wiLocale(), { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 8 + i)));
}

// public entry points
function wiLoadInsights(worldId) {
    _wiWorldId = worldId;
    if (!_wiAnchor) _wiAnchor = new Date();
    // Re-render shell if DOM was destroyed (e.g., modal reopened)
    if (_wiInitialized && !document.getElementById('wiToolbar')) {
        _wiInitialized = false;
        _wiLoading = false;
    }
    if (!_wiInitialized) _wiRenderShell();
    _wiRequestData();
}

// date range helpers
function _wiRange() {
    const a = new Date(_wiAnchor);
    let from, to;
    if (_wiMode === 'day') {
        from = new Date(a.getFullYear(), a.getMonth(), a.getDate());
        to = new Date(from);
        to.setHours(23, 59, 59, 999);
    } else if (_wiMode === 'week') {
        // Monday, Sunday (ISO week)
        const dow = a.getDay(); // 0=Sun
        const diffToMon = dow === 0 ? -6 : 1 - dow;
        from = new Date(a.getFullYear(), a.getMonth(), a.getDate() + diffToMon);
        to = new Date(from);
        to.setDate(to.getDate() + 6);
        to.setHours(23, 59, 59, 999);
    } else if (_wiMode === 'month') {
        from = new Date(a.getFullYear(), a.getMonth(), 1);
        to = new Date(a.getFullYear(), a.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
        from = new Date(a.getFullYear(), 0, 1);
        to = new Date(a.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
    return { from, to };
}

function _wiFmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _wiRangeLabel() {
    const { from, to } = _wiRange();
    if (_wiMode === 'day') return fmtShortDate(to);
    if (_wiMode === 'week') {
        return fmtShortDate(from) + ' - ' + fmtShortDate(to);
    }
    if (_wiMode === 'month') return from.toLocaleDateString(getLanguageLocale(), { month: 'long', year: 'numeric' });
    return String(from.getFullYear());
}

// navigation
function wiSetMode(mode) {
    _wiMode = mode;
    _wiUpdateToolbar();
    _wiRequestData();
}

function wiNav(dir) {
    const d = _wiAnchor;
    if (_wiMode === 'day') d.setDate(d.getDate() + dir);
    else if (_wiMode === 'week') d.setDate(d.getDate() + dir * 7);
    else if (_wiMode === 'month') d.setMonth(d.getMonth() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    _wiUpdateToolbar();
    _wiRequestData();
}


// date picker
function wiToggleDatePicker() {
    const picker = document.getElementById('wiDatePicker');
    if (!picker) return;
    if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        document.removeEventListener('click', _wiCloseDpOutside);
        return;
    }
    _wiDpYear = _wiAnchor.getFullYear();
    _wiDpMonth = _wiAnchor.getMonth();
    picker.style.display = '';
    _wiRenderDpCalendar();
    setTimeout(() => document.addEventListener('click', _wiCloseDpOutside), 0);
}

function _wiCloseDpOutside(e) {
    const picker = document.getElementById('wiDatePicker');
    const btn = document.getElementById('wiDateBtn');
    if (picker && !picker.contains(e.target) && btn && !btn.contains(e.target)) {
        picker.style.display = 'none';
        document.removeEventListener('click', _wiCloseDpOutside);
    }
}

function _wiRenderDpCalendar() {
    const grid = document.getElementById('wiDpGrid');
    const label = document.getElementById('wiDpMonthLabel');
    if (!grid || !label) return;

    label.textContent = new Date(_wiDpYear, _wiDpMonth, 1).toLocaleDateString(wiLocale(), { month: 'long', year: 'numeric' });

    const todayStr = _wiFmt(new Date());
    const selStr = _wiFmt(_wiAnchor);
    const firstDow = new Date(_wiDpYear, _wiDpMonth, 1).getDay();
    const firstDowMon = (firstDow + 6) % 7;
    const daysInMonth = new Date(_wiDpYear, _wiDpMonth + 1, 0).getDate();
    const daysInPrevMo = new Date(_wiDpYear, _wiDpMonth, 0).getDate();

    let html = '';
    for (let i = firstDowMon - 1; i >= 0; i--) {
        const d = daysInPrevMo - i;
        const ds = _wiFmt(new Date(_wiDpYear, _wiDpMonth - 1, d));
        html += `<button class="tl-dp-day other-month${ds === selStr ? ' selected' : ''}" onclick="wiSelectDate('${ds}')">${d}</button>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = _wiFmt(new Date(_wiDpYear, _wiDpMonth, d));
        const cls = (ds === todayStr ? ' today' : '') + (ds === selStr ? ' selected' : '');
        html += `<button class="tl-dp-day${cls}" onclick="wiSelectDate('${ds}')">${d}</button>`;
    }
    const used = firstDowMon + daysInMonth;
    const remaining = used % 7 === 0 ? 0 : 7 - (used % 7);
    for (let d = 1; d <= remaining; d++) {
        const ds = _wiFmt(new Date(_wiDpYear, _wiDpMonth + 1, d));
        html += `<button class="tl-dp-day other-month${ds === selStr ? ' selected' : ''}" onclick="wiSelectDate('${ds}')">${d}</button>`;
    }
    grid.innerHTML = html;
}

function wiDpNav(dir) {
    _wiDpMonth += dir;
    if (_wiDpMonth < 0) { _wiDpMonth = 11; _wiDpYear--; }
    if (_wiDpMonth > 11) { _wiDpMonth = 0; _wiDpYear++; }
    _wiRenderDpCalendar();
}

function wiSelectDate(dateStr) {
    _wiAnchor = new Date(dateStr + 'T12:00:00');
    document.getElementById('wiDatePicker').style.display = 'none';
    document.removeEventListener('click', _wiCloseDpOutside);
    _wiUpdateToolbar();
    _wiRequestData();
}

// fetching
function _wiRequestData() {
    _wiLoading = true;
    const { from, to } = _wiRange();
    sendToCS({ action: 'getWorldInsights', worldId: _wiWorldId, from: from.toISOString(), to: to.toISOString() });
}

function wiRefresh() {
    _wiLoading = true;
    const { from, to } = _wiRange();
    const btn = document.getElementById('wiRefreshBtn');
    if (btn) btn.classList.add('wi-spin');
    sendToCS({ action: 'refreshWorldInsights', worldId: _wiWorldId, from: from.toISOString(), to: to.toISOString() });
}

function wiHandleData(payload) {
    if (payload.worldId !== _wiWorldId) return;
    _wiData = payload.stats || [];
    _wiLoading = false;
    const btn = document.getElementById('wiRefreshBtn');
    if (btn) btn.classList.remove('wi-spin');
    _wiRenderCharts();
}

// Bucket data for chart points

function _wiBucket() {
    const { from, to } = _wiRange();
    const points = [];

    if (_wiMode === 'day') {
        for (let h = 0; h < 24; h++) {
            points.push({ label: String(h).padStart(2, '0') + ':00', active: 0, favorites: 0, visits: 0, count: 0 });
        }
        _wiData.forEach(p => {
            const d = new Date(p.Timestamp || p.timestamp);
            const h = d.getHours();
            if (h >= 0 && h < 24) {
                points[h].active = Math.max(points[h].active, p.Active ?? p.active ?? 0);
                points[h].favorites = Math.max(points[h].favorites, p.Favorites ?? p.favorites ?? 0);
                points[h].visits = Math.max(points[h].visits, p.Visits ?? p.visits ?? 0);
                points[h].count++;
            }
        });
    } else if (_wiMode === 'year') {
        // 12 monthly buckets
        const year = from.getFullYear();
        for (let i = 0; i < 12; i++) {
            const key = year + '-' + String(i + 1).padStart(2, '0');
            const label = new Date(year, i, 1).toLocaleDateString(wiLocale(), { month: 'short' });
            points.push({ label, monthKey: key, active: 0, favorites: 0, visits: 0, count: 0 });
        }
        _wiData.forEach(p => {
            const d = new Date(p.Timestamp || p.timestamp);
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const pt = points.find(x => x.monthKey === key);
            if (pt) {
                pt.active = Math.max(pt.active, p.Active ?? p.active ?? 0);
                pt.favorites = Math.max(pt.favorites, p.Favorites ?? p.favorites ?? 0);
                pt.visits = Math.max(pt.visits, p.Visits ?? p.visits ?? 0);
                pt.count++;
            }
        });
    } else {
        // week (7 days Mon, Sun) or month (actual days in month)
        const start = new Date(from);
        const days = Math.floor((to - from) / (1000 * 60 * 60 * 24)) + 1;
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const dayStr = _wiFmt(d);
            const shortLabel = _wiMode === 'week'
                ? d.toLocaleDateString(wiLocale(), { weekday: 'short' })
                : String(d.getDate());
            points.push({ label: shortLabel, dateStr: dayStr, active: 0, favorites: 0, visits: 0, count: 0 });
        }
        _wiData.forEach(p => {
            const d = new Date(p.Timestamp || p.timestamp);
            const dayStr = _wiFmt(d);
            const pt = points.find(x => x.dateStr === dayStr);
            if (pt) {
                pt.active = Math.max(pt.active, p.Active ?? p.active ?? 0);
                pt.favorites = Math.max(pt.favorites, p.Favorites ?? p.favorites ?? 0);
                pt.visits = Math.max(pt.visits, p.Visits ?? p.visits ?? 0);
                pt.count++;
            }
        });
    }
    return points;
}

function _wiComputeStats(points) {
    const withData = points.filter(p => p.count > 0);
    const peakActive = points.reduce((m, p) => Math.max(m, p.active), 0);
    const avgActive = withData.length
        ? Math.round(withData.reduce((s, p) => s + p.active, 0) / withData.length)
        : 0;

    const visitsSeries = withData.map(p => p.visits).filter(v => v > 0);
    const favSeries    = withData.map(p => p.favorites).filter(v => v > 0);
    const newVisits = visitsSeries.length ? visitsSeries[visitsSeries.length - 1] - visitsSeries[0] : 0;
    const newFavorites = favSeries.length ? favSeries[favSeries.length - 1] - favSeries[0] : 0;

    const lastVisits = visitsSeries.length ? visitsSeries[visitsSeries.length - 1] : 0;
    const lastFavs   = favSeries.length ? favSeries[favSeries.length - 1] : 0;
    const conversion = lastVisits > 0 ? (lastFavs / lastVisits) * 100 : 0;

    return { peakActive, avgActive, newVisits, newFavorites, conversion };
}

function _wiRenderShell() {
    const container = document.getElementById('wiContainer');
    if (!container) return;
    _wiInitialized = true;
    const weekdayHtml = wiWeekdayLabels().map(label => `<div class="tl-dp-wd">${esc(label)}</div>`).join('');

    container.innerHTML = `
        <div class="wi-toolbar" id="wiToolbar">
            <div class="wi-modes" id="wiModes"></div>
            <div class="wi-nav">
                <button class="vrcn-button" onclick="wiNav(-1)"><span class="msi" style="font-size:16px;">chevron_left</span></button>
                <button class="vrcn-button wi-today-btn" id="wiDateBtn" onclick="wiToggleDatePicker()"><span class="msi" style="font-size:14px;">today</span></button>
                <span class="wi-range-label" id="wiRangeLabel"></span>
                <button class="vrcn-button" onclick="wiNav(1)"><span class="msi" style="font-size:16px;">chevron_right</span></button>
                <button class="vrcn-button" id="wiRefreshBtn" onclick="wiRefresh()" title="${esc(t('world_insights.refresh_title', 'Refresh current data'))}"><span class="msi" style="font-size:14px;">refresh</span></button>
            </div>
        </div>
        <div class="wi-dp-wrap" style="position:relative;">
            <div id="wiDatePicker" class="tl-date-picker wi-date-picker" style="display:none;">
                <div class="tl-dp-header">
                    <button class="tl-dp-nav" onclick="wiDpNav(-1)"><span class="msi" style="font-size:16px;">chevron_left</span></button>
                    <span id="wiDpMonthLabel" class="tl-dp-month-label"></span>
                    <button class="tl-dp-nav" onclick="wiDpNav(1)"><span class="msi" style="font-size:16px;">chevron_right</span></button>
                </div>
                <div class="tl-dp-weekdays">${weekdayHtml}</div>
                <div id="wiDpGrid" class="tl-dp-days"></div>
                <div class="tl-dp-footer">
                    <button class="vrcn-button" style="flex:1;justify-content:center;font-size:calc(11px + var(--fs-off, 0px));" onclick="wiSelectDate('${_wiFmt(new Date())}')">${t('world_insights.today', 'Today')}</button>
                </div>
            </div>
        </div>
        <div id="wiCharts">${_wiSkeletonHtml()}</div>`;

    const area = document.getElementById('wiCharts');
    if (area) {
        area.innerHTML = _wiSkeletonHtml();
    }
    _wiUpdateToolbar();
}

function _wiSkeletonHtml() {
    const stat = '<div class="wi-stat"><span class="wi-skel wi-skel-stat-val"></span><span class="wi-skel wi-skel-stat-lbl"></span></div>';
    const card = '<div class="wi-chart-card"><div class="wi-skel wi-skel-title"></div><div class="wi-skel wi-skel-chart"></div></div>';
    return `
        <div class="wi-stats">${stat.repeat(5)}</div>
        <div class="wi-charts-grid">${card}${card}</div>
        ${card}`;
}

// Toolbar Updates

function _wiUpdateToolbar() {
    const modeBtn = (m, label) =>
        `<button class="vrcn-button wi-mode-btn${_wiMode === m ? ' wi-active' : ''}" onclick="wiSetMode('${m}')">${label}</button>`;

    const modes = document.getElementById('wiModes');
    if (modes) {
        modes.innerHTML =
            modeBtn('day', t('world_insights.mode.day', 'Day')) +
            modeBtn('week', t('world_insights.mode.week', 'Week')) +
            modeBtn('month', t('world_insights.mode.month', 'Month')) +
            modeBtn('year', t('world_insights.mode.year', 'Year'));
    }

    const rangeLabel = document.getElementById('wiRangeLabel');
    if (rangeLabel) rangeLabel.textContent = _wiRangeLabel();
}

// Charts

function _wiRenderCharts() {
    const area = document.getElementById('wiCharts');
    if (!area) return;

    if (!_wiData.length) {
        area.innerHTML = `<div class="empty-msg" style="margin-top:20px;">${t('world_insights.empty', 'No data collected yet for this period.')}</div>`;
        return;
    }

    const pts = _wiBucket();
    const stats = _wiComputeStats(pts);
    const fmt = n => Number(n).toLocaleString();
    const signed = n => (n >= 0 ? '+' : '') + fmt(n);

    area.innerHTML = `
        <div class="wi-stats">
            <div class="wi-stat"><span class="wi-stat-val">${fmt(stats.peakActive)}</span><span class="wi-stat-lbl">${t('world_insights.stat.peak_players', 'Peak players')}</span></div>
            <div class="wi-stat"><span class="wi-stat-val">${fmt(stats.avgActive)}</span><span class="wi-stat-lbl">${t('world_insights.stat.avg_players', 'Avg players')}</span></div>
            <div class="wi-stat"><span class="wi-stat-val">${signed(stats.newVisits)}</span><span class="wi-stat-lbl">${t('world_insights.stat.new_visits', 'New visits')}</span></div>
            <div class="wi-stat"><span class="wi-stat-val">${signed(stats.newFavorites)}</span><span class="wi-stat-lbl">${t('world_insights.stat.new_favorites', 'New favorites')}</span></div>
            <div class="wi-stat"><span class="wi-stat-val">${stats.conversion.toFixed(1)}%</span><span class="wi-stat-lbl">${t('world_insights.stat.conversion', 'Favorite rate')}</span></div>
        </div>
        <div class="wi-charts-grid">
            <div class="wi-chart-card">
                <div class="wi-chart-title"><span class="msi" style="font-size:13px;color:var(--accent);">person</span> ${t('world_insights.chart.active_players', 'Active Players')}</div>
                <canvas id="wiChartActive" height="120"></canvas>
            </div>
            <div class="wi-chart-card">
                <div class="wi-chart-title"><span class="msi" style="font-size:13px;color:var(--ok);">favorite</span> ${t('world_insights.chart.favorites', 'Favorites')}</div>
                <canvas id="wiChartFavorites" height="120"></canvas>
            </div>
        </div>
        <div class="wi-chart-card">
            <div class="wi-chart-title"><span class="msi" style="font-size:13px;color:var(--cyan);">visibility</span> ${t('world_insights.chart.visits', 'Visits')}</div>
            <canvas id="wiChartVisits" height="120"></canvas>
        </div>`;

    _wiDrawChart('wiChartActive',    pts, 'active',    'var(--accent)');
    _wiDrawChart('wiChartFavorites', pts, 'favorites', 'var(--ok)');
    _wiDrawChart('wiChartVisits',    pts, 'visits',    'var(--cyan)');
}

// Canvas Bar Chart
function _wiDrawChart(canvasId, points, key, cssColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !points.length) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 14, right: 10, bottom: 22, left: 36 };
    const cw = W - pad.left - pad.right;
    const ch = H - pad.top - pad.bottom;

    const color = _wiResolveColor(cssColor);
    const values = points.map(p => p[key]);
    const maxVal = Math.max(1, ...values);

    // Grid lines
    ctx.strokeStyle = _wiResolveColor('var(--bg-hover)');
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
        const y = pad.top + (ch / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
    }

    // Y-axis labels
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = _wiResolveColor('var(--tx3)');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
        const y = pad.top + (ch / gridLines) * i;
        const v = Math.round(maxVal * (1 - i / gridLines));
        ctx.fillText(_wiShortNum(v), pad.left - 6, y);
    }

    // X-axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const slot = cw / points.length;
    const step = points.length > 14 ? Math.ceil(points.length / 10) : 1;
    points.forEach((p, i) => {
        if (i % step !== 0 && i !== points.length - 1) return;
        const x = pad.left + slot * i + slot / 2;
        ctx.fillText(p.label, x, H - pad.bottom + 8);
    });

    // Bars
    const barW = Math.max(1, Math.min(slot * 0.7, 22));
    const baseY = pad.top + ch;
    const bars = [];
    ctx.fillStyle = color;
    points.forEach((p, i) => {
        const v = values[i];
        const barH = (v / maxVal) * ch;
        const x = pad.left + slot * i + (slot - barW) / 2;
        const y = baseY - barH;
        bars.push({
            x0: pad.left + slot * i,
            x1: pad.left + slot * (i + 1),
            bx: x,
            w: barW,
            top: barH > 0 ? y : baseY,
            text: `${p.label}: ${Number(v).toLocaleString()}`,
        });
        if (barH <= 0) return;
        const r = Math.min(barW / 2, 3, barH);
        ctx.beginPath();
        ctx.moveTo(x, y + barH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + barH);
        ctx.closePath();
        ctx.fill();
    });

    canvas._wiBars = bars;
    if (!canvas._wiHoverBound) {
        canvas._wiHoverBound = true;
        canvas.addEventListener('mousemove', e => {
            const bs = canvas._wiBars;
            if (!bs || !bs.length) return;
            const cr = canvas.getBoundingClientRect();
            const mx = e.clientX - cr.left;
            const hit = bs.find(b => mx >= b.x0 && mx < b.x1);
            if (!hit) { if (window.vnTooltip) window.vnTooltip.hide(); return; }
            if (window.vnTooltip) window.vnTooltip.show(hit.text, {
                left:   cr.left + hit.bx,
                right:  cr.left + hit.bx + hit.w,
                width:  hit.w,
                top:    cr.top + hit.top,
                bottom: cr.top + hit.top,
                height: 0,
            });
        });
        canvas.addEventListener('mouseleave', () => { if (window.vnTooltip) window.vnTooltip.hide(); });
    }
}

// Helpers

function _wiResolveColor(css) {
    if (!css.startsWith('var(')) return css;
    const prop = css.slice(4, -1);
    return getComputedStyle(document.documentElement).getPropertyValue(prop).trim() || '#888';
}

function _wiShortNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// Reset state when modal closes
function _wiReset() {
    _wiInitialized = false;
    _wiData = [];
    _wiLoading = false;
}

function rerenderWorldInsightsTranslations() {
    if (!_wiInitialized || !document.getElementById('wiContainer')) return;
    _wiRenderShell();
    if (!_wiLoading) _wiRenderCharts();
}

document.documentElement.addEventListener('languagechange', rerenderWorldInsightsTranslations);
