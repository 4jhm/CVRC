/* === My Profile Modal === */
let _mypRawJson = null;
let _mypAllWorlds = [];
let _mypAllAvatars = [];
let _mypWorldsPage = 0;
let _mypAvatarsPage = 0;
let _mypWorldsRequested = false;
let _mypAvatarsRequested = false;
let _mypFavsRequested = false;
let _mypHeatmapDays = 30;
let _mypHeatmapView = 'online';
let _mypStatusData = null;
let _mypGroupsSortMode = 'alpha';
let _mypGroupsPage = 0;
let _mypOwnGroupsPage = 0;

const MYP_HM_IDS = {
    icon:   'mypHmRefreshIcon',
    count:  'mypHmCount',
    stats:  'mypHmStats',
    grid:   'mypHmGridWrap',
    status: 'mypHmStatusWrap',
    mostly: 'mypInfoStatusMostly',
};

function _mypIsSelf(userId) {
    return !!currentVrcUser && !!userId && currentVrcUser.id === userId;
}
// My Profile Modal
function openMyProfileModal() {
    if (!currentVrcUser) return;
    const m = document.getElementById('modalMyProfile');
    if (!m) return;
    if (typeof navSetCurrent === 'function') navSetCurrent('myprofile', currentVrcUser.id || 'me');
    if (typeof navUpdateLabel === 'function') navUpdateLabel(currentVrcUser.displayName || '');
    _mypAvatarsRequested = false;
    _mypFavsRequested    = false;
    _mypHeatmapDays      = 30;
    _mypHeatmapView      = 'online';
    _mypStatusData       = null;
    renderMyProfileContent();
    m.style.display = 'flex';
    sendToCS({ action: 'vrcGetRepresentedGroup' });
}

function closeMyProfile(fromNav = false) {
    const m = document.getElementById('modalMyProfile');
    if (m) m.style.display = 'none';
    if (!fromNav && typeof navClear === 'function') navClear();
}

let _profileDecoData = { iconFrame: [], nameplateEffect: [], profileEffect: [] };

function openProfileDecoPicker() {
    let m = document.getElementById('profileDecoModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'profileDecoModal';
        m.className = 'modal-overlay';
        m.addEventListener('click', e => { if (e.target === m) closeProfileDecoPicker(); });
        document.body.appendChild(m);
    }
    m.style.display = 'flex';
    renderProfileDecoPicker(true);
    sendToCS({ action: 'vrcGetProfileDecorations' });
}

function closeProfileDecoPicker() {
    const m = document.getElementById('profileDecoModal');
    if (m) m.style.display = 'none';
}

function onProfileDecorations(data) {
    _profileDecoData = { iconFrame: [], nameplateEffect: [], profileEffect: [] };
    (data.decorations || []).forEach(d => { if (_profileDecoData[d.slot]) _profileDecoData[d.slot].push(d); });
    renderProfileDecoPicker(false);
}

function renderProfileDecoPicker(loading) {
    const m = document.getElementById('profileDecoModal');
    if (!m || m.style.display === 'none') return;
    const u = currentVrcUser || {};
    const slots = [
        { key: 'iconFrame',       label: t('profiles.deco.icon_frame', 'Icon Frame'),       cur: u.iconFrame || '' },
        { key: 'nameplateEffect', label: t('profiles.deco.nameplate', 'Nameplate'),         cur: u.nameplateEffect || '' },
        { key: 'profileEffect',   label: t('profiles.deco.profile_effect', 'Profile Effect'), cur: u.profileEffect || '' },
    ];
    const body = loading
        ? `<div class="pd-loading">${t('common.loading', 'Loading...')}</div>`
        : slots.map(s => {
            const items = _profileDecoData[s.key] || [];
            const noneCell = `<div class="pd-cell${!s.cur ? ' pd-sel' : ''}" onclick="setProfileDeco('${s.key}','')"><div class="pd-none"><span class="msi">block</span></div><div class="pd-name">${t('profiles.deco.none', 'None')}</div></div>`;
            const cells = items.map(it =>
                `<div class="pd-cell${it.templateId === s.cur ? ' pd-sel' : ''}" onclick="setProfileDeco('${s.key}','${jsq(it.templateId)}')" title="${esc(it.name)}"><img src="${esc(it.imageUrl)}" onerror="this.style.display='none'"><div class="pd-name">${esc(it.name)}</div></div>`
            ).join('');
            const empty = items.length === 0 ? `<div class="pd-empty">${t('profiles.deco.empty', 'You do not own any of these')}</div>` : '';
            return `<div class="pd-section"><div class="pd-section-title">${esc(s.label)}</div><div class="pd-grid">${noneCell}${cells}</div>${empty}</div>`;
        }).join('') + _mypThemeSection() + _mypBackgroundSection();
    m.innerHTML = `<div class="gp-modal" style="width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;">
        ${renderModalBar(t('profiles.deco.title', 'Customize Profile'), [modalCloseAction('closeProfileDecoPicker()')])}
        <div class="gp-modal-body" style="flex:1;overflow-y:auto;">${body}</div>
    </div>`;
}

function setProfileDeco(field, value) {
    if (currentVrcUser) currentVrcUser[field] = value;
    renderProfileDecoPicker(false);
    sendToCS({ action: 'vrcSetProfileDecoration', field, value });
}

function onSetProfileDecorationResult(data) {
    if (!data || !data.ok) { showToast(false, t('profiles.deco.failed', 'Could not update decoration')); return; }
    if (currentVrcUser) {
        currentVrcUser[data.field] = data.value;
        const urlField = data.field === 'iconFrame' ? 'iconFrameUrl' : (data.field === 'nameplateEffect' ? 'nameplateUrl' : 'profileEffectUrl');
        currentVrcUser[urlField] = data.url || '';
    }
    showToast(true, t('profiles.deco.updated', 'Profile updated!'));
    const mp = document.getElementById('modalMyProfile');
    if (mp && mp.style.display !== 'none' && typeof renderMyProfileContent === 'function') renderMyProfileContent();
}

function renderMyProfileContent() {
    const u = currentVrcUser;
    const box = document.getElementById('mypBox');
    const c   = document.getElementById('myProfileContent');
    if (!u || !box || !c) return;

    const _mypPrevTab = document.querySelector('#mypBox .fd-tab.active')?.dataset.myptab || '';

    if (typeof vrcnPlusOnProfileOpened === 'function' && u.id) {
        vrcnPlusOnProfileOpened(u.id, box);
    }

    const useCompact = (typeof settings !== 'undefined' && settings.profileModalStyle === 'compact');
    const _mypModal = document.getElementById('modalMyProfile');
    if (_mypModal) _mypModal.classList.toggle('fd-style-compact', useCompact);

    const changeBannerTitle = t('profiles.my_profile.change_banner', 'Change banner');
    const addBannerTitle    = t('profiles.my_profile.add_banner', 'Add banner');
    const bannerLabel       = t('profiles.my_profile.banner', 'Banner');
    const changeIconTitle   = t('profiles.my_profile.change_icon', 'Change icon');
    const noLanguagesLabel  = t('profiles.my_profile.empty.no_languages', 'No languages set');
    const noLinksLabel      = t('profiles.my_profile.empty.no_links', 'No links added');
    const noPronounsLabel   = t('profiles.my_profile.empty.no_pronouns', 'No pronouns set');
    const noBioLabel        = t('profiles.my_profile.empty.no_bio', 'No bio written yet');
    const addLanguageLabel  = t('profiles.my_profile.add_language', 'Add language...');

    // Banner
    const bannerSrc = u.bannerUrl || u.profilePicOverride || u.currentAvatarImageUrl || u.image || '';
    const _mypEffect = (typeof profileEffectHtml === 'function') ? profileEffectHtml(u.profileEffectUrl) : '';
    const bannerHtml = bannerSrc
        ? `<div class="fd-banner" id="myp-banner-slot"><div class="fd-banner-fade"></div>${_mypEffect}</div>`
        : `<div style="display:flex;justify-content:flex-end;padding:4px 0 2px 0;"><button class="myp-edit-btn" onclick="openImagePicker('profile-banner')" title="${esc(addBannerTitle)}"><span class="msi" style="font-size:13px;">edit</span><span style="font-size:calc(11px + var(--fs-off, 0px));margin-left:3px;">${esc(bannerLabel)}</span></button></div>`;
    const bannerCompactHtml = `<div class="fd-left-banner" id="myp-banner-slot">${bannerSrc ? `<div class="fd-banner-fade"></div>` : ''}${_mypEffect}<span class="vrcn-keybind" style="position:absolute;top:8px;right:8px;z-index:3;border-radius:5px;">CTRL P</span></div>`;
    const mypHeaderActions = renderModalActions([
        { icon: 'edit', title: changeBannerTitle, onclick: `openImagePicker('profile-banner')` },
        { icon: 'filter_frames', title: t('profiles.deco.title', 'Customize Profile'), onclick: `openProfileDecoPicker()` },
        {
            label: 'VRCN+',
            title: t('vrcnplus.dropdown.title', 'VRCN+'),
            icon: 'auto_awesome',
            dropdown: [
                { icon: 'palette', label: t('vrcnplus.dropdown.customize_profile', 'Customize Profile'), onclick: 'openVrcnPlusEditor()' },
            ],
        },
        { icon: 'link_2', title: t('common.share', 'Share'), onclick: `navigator.clipboard.writeText('https://vrchat.com/home/user/${esc(u.id)}').then(()=>showToast(true,t('common.link_copied','Link copied!')))` },
        { icon: 'close', title: t('common.close', 'Close'), onclick: `closeMyProfile()` },
    ]);

    // Avatar with edit overlay
    const avatarImg = useCompact
        ? (u.image
            ? `<img class="fd-avatar" src="${esc(u.image)}" onerror="this.style.display='none'">`
            : `<div class="fd-avatar" style="display:flex;align-items:center;justify-content:center;font-size:calc(20px + var(--fs-off, 0px));font-weight:700;color:var(--tx3)">${esc((u.displayName||'?')[0])}</div>`)
        : (u.image
            ? `<img class="myp-avatar" src="${esc(u.image)}" onerror="this.outerHTML='<div class=\\'myp-avatar myp-avatar-fb\\'>${esc((u.displayName||'?')[0])}</div>'">`
            : `<div class="myp-avatar myp-avatar-fb">${esc((u.displayName||'?')[0])}</div>`);
    const _mypFrame = (typeof iconFrameHtml === 'function') ? iconFrameHtml(u.iconFrameUrl, true) : '';
    const _editBtnPos = useCompact ? 'top:-4px;left:-4px;' : 'bottom:-4px;right:-4px;';
    const imgTag = `<div style="position:relative;display:inline-block;flex-shrink:0;line-height:0;">${avatarImg}${_mypFrame}<button class="myp-edit-btn" style="position:absolute;${_editBtnPos}z-index:5;padding:2px;min-width:0;width:18px;height:18px;display:flex;align-items:center;justify-content:center;" onclick="openImagePicker('profile-icon')" title="${esc(changeIconTitle)}"><span class="msi" style="font-size:11px;">edit</span></button></div>`;

    // Trust rank & badges row
    const rank = getTrustRank(u.tags || []);
    const vrcPlusBadge = (u.tags || []).includes('system_supporter') ? `<span class="vrcn-supporter-badge">VRC+</span>` : '';
    const platBadge = getPlatformBadgeHtml(u.platform || u.lastPlatform || '');
    let badgesRowHtml = '<div class="fd-badges-row">';
    if (platBadge) badgesRowHtml += platBadge;
    if (u.ageVerified) badgesRowHtml += `<span class="vrcn-badge ok"><span class="msi" style="font-size:11px;">verified</span>${t('profiles.meta.age_verified', 'Age Verified')}</span>`;
    if (u.ageVerificationStatus === '18+') badgesRowHtml += `<span class="vrcn-badge ok"><span class="msi" style="font-size:11px;">verified</span>18+</span>`;
    if (rank) badgesRowHtml += `<span class="vrcn-badge ${rank.cls}">${esc(rank.label)}</span>`;
    if (u.id) badgesRowHtml += idBadge(u.id);
    if (!useCompact) badgesRowHtml += `<span class="vrcn-keybind" style="margin-left:auto;border-radius:5px;">CTRL P</span>`;
    badgesRowHtml += '</div>';

    const _bioBadgesHtml = useCompact
        ? badgesRowHtml.replace('<div class="fd-badges-row">', '<div class="fd-badges-row fd-bio-badges-row" style="margin-bottom:10px;">')
        : '';

    // Representing group — prefer dedicated endpoint result, fall back to myGroups
    const _repG = myRepresentedGroup || ((typeof myGroups !== 'undefined') && myGroups.find(g => g.isRepresenting === true));
    let repGroupBadgeHtml = '';
    let repGroupCardHtml  = '';
    if (_repG) {
        const _rbi = _repG.iconUrl
            ? `<img class="fd-rep-group-badge-icon" src="${esc(imgThumb(_repG.iconUrl, 64))}" onerror="this.style.display='none'">`
            : `<span class="msi" style="font-size:13px;flex-shrink:0;">group</span>`;
        repGroupBadgeHtml = `<div class="fd-rep-group-badge" onclick="closeMyProfile();openGroupDetail('${esc(_repG.id)}')">${_rbi}<span class="fd-rep-group-badge-name">${esc(_repG.name || '')}</span></div>`;
        const _ri = _repG.iconUrl
            ? `<img class="fd-group-icon" src="${esc(imgThumb(_repG.iconUrl, 96))}" onerror="this.style.display='none'">`
            : `<div class="fd-group-icon fd-group-icon-empty"><span class="msi" style="font-size:18px;">group</span></div>`;
        repGroupCardHtml = `<div class="fd-info-card">
            <div class="fd-group-rep-label">${t('profiles.badges.representing', 'Representing')}</div>
            <div class="fd-group-card fd-group-rep" onclick="closeMyProfile();openGroupDetail('${esc(_repG.id)}')">
                ${_ri}<div class="fd-group-card-info"><div class="fd-group-card-name">${esc(_repG.name)}</div><div class="fd-group-card-meta">${esc(_repG.shortCode || '')}${_repG.discriminator ? '.' + esc(_repG.discriminator) : ''}${_repG.memberCount ? ' &middot; ' + esc(getGroupMemberText(_repG.memberCount)) : ''}</div></div>
            </div>
        </div>`;
    }

    const badges = u.badges || [];
    const _isVrcnPlus = (typeof vrcnPlusIsKnownPlus === 'function') && vrcnPlusIsKnownPlus(u.id);
    let _badgesCard = '';
    if (badges.length > 0 || _isVrcnPlus) {
        const vrcnPlusBadgeHtml = _isVrcnPlus && typeof window.vrcnPlusBadgeHtml === 'function'
            ? window.vrcnPlusBadgeHtml('myp-badge-item') : '';
        const iconsHtml = badges.map(b => {
            const hidden = !b.showcased;
            return `<div class="myp-badge-item fd-vrc-badge-wrap${hidden ? ' myp-badge-hidden' : ''}${_myBadgesEditing ? ' myp-badge-editing' : ''}" data-badge-id="${esc(b.id)}" data-badge-img="${esc(b.imageUrl)}" data-badge-name="${encodeURIComponent(b.name)}" data-badge-desc="${encodeURIComponent(b.description || '')}" onclick="${_myBadgesEditing ? `toggleMyBadge('${esc(b.id)}')` : ''}"><img class="fd-vrc-badge-icon" src="${esc(imgThumb(b.imageUrl, 64))}" alt="${esc(b.name)}" onerror="this.closest('.myp-badge-item').style.display='none'"></div>`;
        }).join('');
        _badgesCard = `<div class="fd-info-card">
            <div class="fd-group-rep-label" style="display:flex;align-items:center;justify-content:space-between;">${t('profiles.my_profile.sections.badges', 'Badges')}<button class="myp-edit-btn" onclick="toggleBadgeEditMode()"><span class="msi" style="font-size:14px;">${_myBadgesEditing ? 'check' : 'edit'}</span></button></div>
            <div class="myp-badges-row">${vrcnPlusBadgeHtml}${iconsHtml}</div>
        </div>`;
    }

    // Biography card (left) — bio, links, languages each editable
    const langTags = (u.tags||[]).filter(t => t.startsWith('language_'));
    const langsViewHtml = langTags.length
        ? `<div class="fd-lang-tags">${langTags.map(t => `<span class="vrcn-badge">${esc(LANG_MAP[t]||t.replace('language_','').toUpperCase())}</span>`).join('')}</div>`
        : `<div class="myp-empty">${noLanguagesLabel}</div>`;
    const bioLinksViewHtml = (u.bioLinks||[]).length
        ? `<div class="fd-bio-links">${u.bioLinks.map(bl => renderBioLink(bl)).join('')}</div>`
        : `<div class="myp-empty">${noLinksLabel}</div>`;
    const _bioCard = `<div class="fd-info-card">
        <div class="myp-section-header">
            <span class="myp-section-title">${t('profiles.my_profile.sections.bio', 'Bio')}</span>
            <button class="myp-edit-btn" onclick="editMyField('bio')"><span class="msi" style="font-size:14px;">edit</span></button>
        </div>
        ${_bioBadgesHtml}
        <div id="mypBioView">${u.bio ? `<div class="fd-bio">${esc(u.bio)}</div>` : `<div class="myp-empty">${noBioLabel}</div>`}</div>
        <div id="mypBioEdit" style="display:none;">
            <textarea id="mypBioInput" class="myp-textarea" rows="4" maxlength="512" placeholder="${esc(t('profiles.my_profile.bio_placeholder', 'Write your bio...'))}">${esc(u.bio||'')}</textarea>
            <div class="myp-char-count"><span id="mypBioCount">${(u.bio||'').length}</span>/512</div>
            <div class="myp-edit-actions">
                <button class="vrcn-button" onclick="cancelMyField('bio')">${t('common.cancel', 'Cancel')}</button>
                <button class="vrcn-button vrcn-btn-primary" onclick="saveMyField('bio')">${t('common.save', 'Save')}</button>
            </div>
        </div>
        <div class="myp-section-header" style="margin-top:10px;">
            <span class="myp-section-title">${t('profiles.my_profile.sections.links', 'Links')}</span>
            <button class="myp-edit-btn" onclick="editMyField('links')"><span class="msi" style="font-size:14px;">edit</span></button>
        </div>
        <div id="mypLinksView">${bioLinksViewHtml}</div>
        <div id="mypLinksEdit" style="display:none;">
            <div id="mypLinksInputs"></div>
            <div class="myp-edit-actions">
                <button class="vrcn-button" onclick="cancelMyField('links')">${t('common.cancel', 'Cancel')}</button>
                <button class="vrcn-button vrcn-btn-primary" onclick="saveMyField('links')">${t('common.save', 'Save')}</button>
            </div>
        </div>
        <div class="myp-section-header" style="margin-top:10px;">
            <span class="myp-section-title">${t('profiles.my_profile.sections.languages', 'Languages')}</span>
            <button class="myp-edit-btn" onclick="editMyField('languages')"><span class="msi" style="font-size:14px;">edit</span></button>
        </div>
        <div id="mypLangsView">${langsViewHtml}</div>
        <div id="mypLangsEdit" style="display:none;">
            <div id="mypLangsChips" class="myp-lang-chips"></div>
            <div class="myp-lang-add-row">
                <select id="mypLangSelect" class="myp-lang-select"><option value="">${addLanguageLabel}</option></select>
                <button class="myp-add-lang-btn" onclick="addMyLanguage()"><span class="msi" style="font-size:15px;">add</span></button>
            </div>
            <div class="myp-edit-actions">
                <button class="vrcn-button" onclick="cancelMyField('languages')">${t('common.cancel', 'Cancel')}</button>
                <button class="vrcn-button vrcn-btn-primary" onclick="saveMyField('languages')">${t('common.save', 'Save')}</button>
            </div>
        </div>
    </div>`;

    // Infos card (right) — platform, joined date, pronouns
    const _mr = (label, valueHtml) =>
        `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:calc(11px + var(--fs-off, 0px));"><span style="color:var(--tx3);">${label}</span><span style="color:var(--tx1);text-align:right;">${valueHtml}</span></div>`;
    const _infosRows = [
        _mr(t('profiles.meta.joined',        'Joined'),         u.dateJoined  ? fmtShortDate(new Date(u.dateJoined + 'T00:00:00')) : '—'),
        _mr(t('profiles.meta.last_login',    'Last Login'),     u.lastLogin   ? fmtShortDate(new Date(u.lastLogin)) : '—'),
        _mr(t('profiles.meta.platform',      'Platform'),       esc(u.platform || u.lastPlatform || '—')),
        _mr(t('profiles.meta.last_platform', 'Last Platform'),  esc(u.lastPlatform || '—')),
        _mr(t('profiles.meta.age_verified',  'Age Verified'),   u.ageVerified       ? t('common.yes','Yes') : t('common.no','No')),
        _mr(t('profiles.meta.avatar_cloning','Avatar Cloning'), u.allowAvatarCopying ? t('common.on','On')  : t('common.off','Off')),
        _mr(t('profiles.meta.booping',       'Booping'),        u.isBoopingEnabled   ? t('common.on','On')  : t('common.off','Off')),
    ].join('');
    const _pronounsSection = `<div class="myp-section-header">
            <span class="myp-section-title">${t('profiles.my_profile.sections.pronouns', 'Pronouns')}</span>
            <button class="myp-edit-btn" onclick="editMyField('pronouns')"><span class="msi" style="font-size:14px;">edit</span></button>
        </div>
        <div id="mypPronounsView">${u.pronouns ? `<div style="font-size:calc(13px + var(--fs-off, 0px));color:var(--tx1);">${esc(u.pronouns)}</div>` : `<div class="myp-empty">${noPronounsLabel}</div>`}</div>
        <div id="mypPronounsEdit" style="display:none;">
            <input type="text" id="mypPronounsInput" class="vrcn-edit-field" placeholder="${esc(t('profiles.my_profile.pronouns_placeholder', 'e.g. he/him, she/her, they/them...'))}" maxlength="32" value="${esc(u.pronouns||'')}" style="width:100%;">
            <div class="myp-edit-actions">
                <button class="vrcn-button" onclick="cancelMyField('pronouns')">${t('common.cancel', 'Cancel')}</button>
                <button class="vrcn-button vrcn-btn-primary" onclick="saveMyField('pronouns')">${t('common.save', 'Save')}</button>
            </div>
        </div>`;

    const _infosCard = `<div class="fd-info-card">
        <div class="fd-group-rep-label">${t('profiles.meta.infos_title', 'Infos')}</div>
        <div style="display:grid;gap:6px;${useCompact ? '' : 'margin-bottom:10px;'}">${_infosRows}</div>
        ${useCompact ? '' : _pronounsSection}
    </div>`;

    const _pronounsCard = useCompact ? `<div class="fd-info-card">${_pronounsSection}</div>` : '';

    // Trust & Safety card (right)
    const _trustCard = rank ? `<div class="fd-info-card">
        <div class="fd-group-rep-label">${t('profiles.trust.title', 'Trust &amp; Safety')}</div>
        <span class="vrcn-badge ${rank.cls}">${esc(rank.label)}</span>
        <p style="margin:10px 0 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);line-height:1.45;">${t('profiles.trust.description', 'This user has a trusted user standing within the community.')}</p>
    </div>` : '';

    const pronounsHtml = u.pronouns ? `<div class="fd-pronouns">${esc(u.pronouns)}</div>` : '';

    const statusRowHtml = `<div class="fd-status-row">
        <div class="myp-status-row" onclick="openStatusModal()">
            <span class="${u.vrcRunning ? 'vrc-status-dot' : 'vrc-status-ring'} ${statusDotClass(u.status)}" style="width:7px;height:7px;flex-shrink:0;"></span>
            <span>${getStatusText(u.status, u.statusDescription)}</span>
            <span class="msi" style="font-size:13px;opacity:.45;">edit</span>
        </div>
    </div>`;

    const _mypTlCard = `<div class="fd-info-card">
        <div class="fd-group-rep-label">${t('nav.timeline', 'Timeline')}</div>
        <div id="mypMiniTl" style="max-height:160px;overflow-y:auto;"><div style="padding:4px 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('profiles.insights.loading', 'Loading...')}</div></div>
    </div>`;

    const _mypInsightsCard = `<div class="fd-info-card">
        <div class="fd-content-pills" style="margin-bottom:10px;">
            <button class="fd-tab myp-insights-pill active" onclick="switchMypInsightsPill('worlds',this)">${t('profiles.insights.most_visited_worlds', 'Most Visited Worlds')}</button>
            <button class="fd-tab myp-insights-pill" onclick="switchMypInsightsPill('persons',this)">${t('profiles.insights.interacted_most', 'Interacted the most with')}</button>
        </div>
        <div id="mypInsightsWorlds" style="max-height:280px;overflow-y:auto;"><div style="padding:4px 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('profiles.insights.loading', 'Loading...')}</div></div>
        <div id="mypInsightsPersons" style="max-height:280px;overflow-y:auto;display:none;"></div>
    </div>`;

    const _hmOnline    = _mypHeatmapView === 'online';
    const _hmViewOpt   = (v, label) => `<option value="${esc(v)}"${_mypHeatmapView === v ? ' selected' : ''}>${esc(label)}</option>`;
    const _hmDaysOpt   = (d, label) => `<option value="${d}"${_mypHeatmapDays === d ? ' selected' : ''}>${esc(label)}</option>`;
    const _mypHeatmapCard = `<div class="fd-info-card">
        <div class="fd-hm-header">
            <div class="fd-hm-head-left">
                <button class="vrcn-button" onclick="mypReloadHeatmap()" title="${esc(t('common.refresh', 'Refresh'))}"><span class="msi" id="mypHmRefreshIcon" style="font-size:14px;">refresh</span></button>
                <span class="fd-hm-count" id="mypHmCount">&nbsp;</span>
            </div>
            <div class="fd-hm-head-right">
                <select id="mypHmView" class="vrcn-dropdown" onchange="mypChangeHeatmapView(this.value)">
                    ${_hmViewOpt('online', t('profiles.heatmap.view_online', 'Online'))}
                    ${_hmViewOpt('all', t('profiles.heatmap.view_all_statuses', 'All Statuses'))}
                    ${_hmViewOpt('join me', t('status.join_me', 'Join Me'))}
                    ${_hmViewOpt('active', t('status.online', 'Online'))}
                    ${_hmViewOpt('ask me', t('status.ask_me', 'Ask Me'))}
                    ${_hmViewOpt('busy', t('status.do_not_disturb', 'Do Not Disturb'))}
                </select>
                <select id="mypHmPeriod" class="vrcn-dropdown" onchange="mypChangeHeatmapPeriod(this.value)">
                    ${_hmDaysOpt(7, t('profiles.heatmap.last_7', 'Last 7 Days'))}
                    ${_hmDaysOpt(30, t('profiles.heatmap.last_30', 'Last 30 Days'))}
                    ${_hmDaysOpt(90, t('profiles.heatmap.last_90', 'Last 90 Days'))}
                    ${_hmDaysOpt(0, t('profiles.heatmap.all_time', 'All Time'))}
                </select>
            </div>
        </div>
        <div class="fd-hm-stats" id="mypHmStats"></div>
        <div class="fd-hm-grid-wrap" id="mypHmGridWrap"${_hmOnline ? '' : ' style="display:none;"'}><div style="padding:16px 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);text-align:center;">${t('profiles.insights.loading', 'Loading...')}</div></div>
        <div class="fd-hm-status-wrap" id="mypHmStatusWrap"${_hmOnline ? ' style="display:none;"' : ''}></div>
    </div>`;

    const infoContent = useCompact
        ? `<div class="fd-info-wrap">
            <div class="fd-info-cols">
                <div class="fd-info-left">${_bioCard}</div>
                <div class="fd-info-right">${repGroupCardHtml}${_pronounsCard}${_trustCard}</div>
            </div>
            ${_mypTlCard}
            ${_mypInsightsCard}
            ${_mypHeatmapCard}
        </div>`
        : `<div class="fd-info-wrap" style="margin-top:10px;">
            <div class="fd-info-cols">
                <div class="fd-info-left">${_badgesCard}${_bioCard}</div>
                <div class="fd-info-right">${repGroupCardHtml}${_infosCard}${_trustCard}</div>
            </div>
            ${_mypTlCard}
            ${_mypInsightsCard}
            ${_mypHeatmapCard}
        </div>`;

    const _mypAllGroups = (typeof myGroups !== 'undefined' && Array.isArray(myGroups)) ? myGroups : [];
    const _mypSelfId    = u.id || '';
    window._mypOwnGroups = _mypAllGroups.filter(g => g.ownerId && g.ownerId === _mypSelfId);
    window._mypGroups    = _mypAllGroups;

    let groupsContent = '';
    if (_mypAllGroups.length > 0) {
        groupsContent += `<div class="search-bar-row" style="margin-bottom:6px;">
            <span class="msi search-ico">search</span>
            <input id="mypGroupsSearch" type="text" class="vrcn-input" placeholder="${esc(t('profiles.groups.search_placeholder', 'Search groups by name...'))}" style="background:var(--bg-input);" oninput="_dbMypGroups()">
            <select id="mypGroupsSort" class="vrcn-dropdown" style="flex-shrink:0;" onchange="setMypGroupsSort(this.value)">
                <option value="alpha">${esc(t('profiles.sort.alphabetical', 'Alphabetical'))}</option>
                <option value="members">${esc(t('profiles.sort.members', 'Members'))}</option>
            </select>
        </div>`;
        if (window._mypOwnGroups.length > 0) {
            groupsContent += `<div class="fd-group-rep-label">${t('profiles.groups.own_groups', 'Own Groups')}</div>`;
            groupsContent += `<div id="mypOwnGroupsGrid" style="display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:6px;"></div>`;
            groupsContent += `<div id="mypOwnGroupsPaginatorBar" class="mini-paginator"></div>`;
        }
        groupsContent += `<div class="fd-group-rep-label" style="margin-top:${window._mypOwnGroups.length > 0 ? '14' : '0'}px;">${t('profiles.badges.groups', 'Groups')}</div>`;
        groupsContent += `<div id="mypGroupsGrid" style="display:grid;grid-template-columns:1fr 1fr 1fr;column-gap:6px;"></div>`;
        groupsContent += `<div id="mypGroupsPaginatorBar" class="mini-paginator"></div>`;
    } else {
        groupsContent = `<div style="padding:20px;text-align:center;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('profiles.badges.no_groups', 'No groups')}</div>`;
    }

    const contentHtml = `
        <div class="fd-content-pills">
            <button class="fd-tab myp-content-pill active" id="mypWorldsPill" onclick="switchMypContentPill('worlds',this)">${t('profiles.content.worlds_pill_label', 'Worlds')} <span class="vrcn-badge fd-tab-badge">0</span></button>
            <button class="fd-tab myp-content-pill" id="mypAvatarsPill" onclick="switchMypContentPill('avatars',this)">${t('profiles.content.avatars_pill_label', 'Avatars')} <span class="vrcn-badge fd-tab-badge">0</span></button>
        </div>
        <div id="mypContentWorlds">
            <div id="mypWorldsGrid"><div class="empty-msg">${t('profiles.insights.loading', 'Loading...')}</div></div>
            <div id="mypWorldsPageBar" class="mini-paginator"></div>
        </div>
        <div id="mypContentAvatars" style="display:none;">
            <div id="mypAvatarsGrid"><div class="empty-msg">${t('profiles.content.loading_avatars', 'Loading avatars...')}</div></div>
            <div id="mypAvatarsPageBar" class="mini-paginator"></div>
        </div>`;

    const _tabBadge = (n) => `<span class="vrcn-badge fd-tab-badge">${n}</span>`;
    const _mypGroupCount = (typeof myGroups !== 'undefined' && Array.isArray(myGroups)) ? myGroups.length : 0;
    const tabsHtml = `<div class="fd-tabs"${useCompact ? '' : ' style="margin-bottom:14px;"'}>
        <button class="fd-tab active" data-myptab="info" onclick="switchMypTab('info',this)">${t('profiles.tabs.info', 'Info')}</button>
        <button class="fd-tab" data-myptab="groups" onclick="switchMypTab('groups',this)">${t('profiles.tabs.groups_label', 'Groups')} ${_tabBadge(_mypGroupCount)}</button>
        <button class="fd-tab" id="mypTabContentBtn" data-myptab="content" onclick="switchMypTab('content',this)">${t('profiles.tabs.content_label', 'Content')} ${_tabBadge(0)}</button>
        <button class="fd-tab" data-myptab="favs" onclick="switchMypTab('favs',this)">${t('profiles.tabs.favs', 'Favs.')}</button>
        <button class="fd-tab" data-myptab="json" onclick="switchMypTab('json',this)">Json</button>
    </div>`;

    const tabPanesHtml = `
        <div id="mypTabInfo">${infoContent}</div>
        <div id="mypTabGroups" style="display:none;">${groupsContent}</div>
        <div id="mypTabContent" style="display:none;">${contentHtml}</div>
        <div id="mypTabFavs" style="display:none;"></div>
        <div id="mypTabJson" style="display:none;"><div class="json-viewer">${jsonHighlight(_mypRawJson || {})}</div></div>`;

    if (useCompact) {
        const _dotHtml = `<span class="${u.vrcRunning ? 'vrc-status-dot' : 'vrc-status-ring'} ${statusDotClass(u.status)} fd-left-status-dot"></span>`;
        c.innerHTML = `${mypHeaderActions}<div class="fd-layout">
            <div class="fd-left">
                ${bannerCompactHtml}
                <div class="fd-left-body">
                    <div class="fd-left-id">
                        <div class="fd-left-avatar-wrap">${imgTag}${_dotHtml}</div>
                        <div class="fd-left-name-wrap">
                            <div class="fd-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${esc(u.displayName)}${vrcPlusBadge}</div>
                            ${pronounsHtml}
                            ${statusRowHtml}
                        </div>
                    </div>
                    ${_badgesCard}
                    ${_infosCard}
                </div>
            </div>
            <div class="fd-right"><div class="fd-right-scroll">${tabsHtml}${tabPanesHtml}</div></div>
        </div>`;
    } else {
        c.innerHTML = `
            ${mypHeaderActions}
            ${bannerHtml}
            <div class="fd-content${bannerSrc ? ' fd-has-banner' : ''}">
                <div class="fd-header">
                    ${imgTag}
                    <div>
                        <div class="fd-name" style="display:flex;align-items:center;gap:6px;">${esc(u.displayName)}${vrcPlusBadge}</div>
                        ${pronounsHtml}
                        ${statusRowHtml}
                        ${repGroupBadgeHtml}
                    </div>
                </div>
                ${badgesRowHtml}
                ${tabsHtml}
                ${tabPanesHtml}
            </div>`;
    }

    if (bannerSrc) {
        const bannerSlot = document.getElementById('myp-banner-slot');
        const bannerImg = (typeof _getFdBannerImg === 'function') ? _getFdBannerImg(u.id, bannerSrc) : null;
        if (bannerSlot && bannerImg) bannerSlot.insertBefore(bannerImg, bannerSlot.firstChild);
    }

    ['mypHmView', 'mypHmPeriod', 'mypGroupsSort'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel && typeof initVnSelect === 'function') initVnSelect(sel);
    });

    filterMypGroups();
    filterMypOwnGroups();
    _mypUpdateContentCounts();
    if (_mypAllWorlds.length)  renderMypWorldsPage(0);
    if (_mypAllAvatars.length) renderMypAvatarsPage(0);

    if (_mypPrevTab && _mypPrevTab !== 'info') {
        const _restoreBtn = document.querySelector(`#mypBox .fd-tab[data-myptab="${_mypPrevTab}"]`);
        if (_restoreBtn) switchMypTab(_mypPrevTab, _restoreBtn);
    }

    const _uid = u.id || '';
    if (_uid) {
        sendToCS({ action: 'getTimelineForUser', userId: _uid });
        sendToCS({ action: 'getProfileInsights', userId: _uid });
        mypRequestHeatmap();
        if (!_mypAvatarsRequested) { _mypAvatarsRequested = true; sendToCS({ action: 'vrcGetUserAvatars', userId: _uid }); }
    }
    if (!_mypWorldsRequested) { _mypWorldsRequested = true; sendToCS({ action: 'vrcGetMyWorlds' }); }
    if (typeof myGroupsLoaded !== 'undefined' && !myGroupsLoaded) sendToCS({ action: 'vrcGetMyGroups' });

    const bioInput = document.getElementById('mypBioInput');
    if (bioInput) bioInput.oninput = () => {
        const cnt = document.getElementById('mypBioCount');
        if (cnt) cnt.textContent = bioInput.value.length;
    };

    // Own VRC+ profile background, same treatment as other profiles.
    if (typeof applyProfileBg === 'function') {
        const _bgLeft = c.querySelector('.fd-left');
        applyProfileBg(box,     useCompact ? null : u);
        applyProfileBg(_bgLeft, useCompact ? u : null);
    }
    if (typeof applyProfileTheme === 'function') applyProfileTheme(box, u);
}

let _myBadgesEditing = false;

function _renderMyBadgesSection(u) {
    const badges = u.badges || [];
    if (badges.length === 0) return '';
    const noBadgesLabel = t('profiles.my_profile.empty.no_badges', 'No badges');
    const badgesTitle = t('profiles.my_profile.sections.badges', 'Badges');
    const iconsHtml = badges.map(b => {
        const hidden = !b.showcased;
        return `<div class="myp-badge-item fd-vrc-badge-wrap${hidden ? ' myp-badge-hidden' : ''}${_myBadgesEditing ? ' myp-badge-editing' : ''}" data-badge-id="${esc(b.id)}" data-badge-img="${esc(b.imageUrl)}" data-badge-name="${encodeURIComponent(b.name)}" data-badge-desc="${encodeURIComponent(b.description || '')}" onclick="${_myBadgesEditing ? `toggleMyBadge('${esc(b.id)}')` : ''}"><img class="fd-vrc-badge-icon" src="${esc(imgThumb(b.imageUrl, 64))}" alt="${esc(b.name)}" onerror="this.closest('.myp-badge-item').style.display='none'"></div>`;
    }).join('');
    return `<div class="myp-section">
        <div class="myp-section-header">
            <span class="myp-section-title">${badgesTitle}</span>
            <button class="myp-edit-btn" onclick="toggleBadgeEditMode()"><span class="msi" style="font-size:14px;">${_myBadgesEditing ? 'check' : 'edit'}</span></button>
        </div>
        <div class="myp-badges-row">${iconsHtml}</div>
    </div>`;
}

function toggleBadgeEditMode() {
    _myBadgesEditing = !_myBadgesEditing;
    renderMyProfileContent();
}

function toggleMyBadge(badgeId) {
    if (!currentVrcUser?.badges) return;
    const b = currentVrcUser.badges.find(x => x.id === badgeId);
    if (!b) return;
    const newShowcased = !b.showcased;
    // Optimistic update
    b.showcased = newShowcased;
    const wrap = document.querySelector(`.myp-badge-item[data-badge-id="${badgeId}"]`);
    if (wrap) wrap.classList.toggle('myp-badge-hidden', !newShowcased);
    sendToCS({ action: 'vrcUpdateBadge', badgeId, showcased: newShowcased });
}

function editMyField(field) {
    const VIEWS = { pronouns: 'mypPronounsView', bio: 'mypBioView', links: 'mypLinksView', languages: 'mypLangsView' };
    const EDITS = { pronouns: 'mypPronounsEdit', bio: 'mypBioEdit', links: 'mypLinksEdit', languages: 'mypLangsEdit' };
    // Close other open edit panels
    Object.keys(VIEWS).forEach(f => {
        if (f !== field) {
            const v = document.getElementById(VIEWS[f]); if (v) v.style.display = '';
            const e = document.getElementById(EDITS[f]); if (e) e.style.display = 'none';
        }
    });
    const viewEl = document.getElementById(VIEWS[field]);
    const editEl = document.getElementById(EDITS[field]);
    if (viewEl) viewEl.style.display = 'none';
    if (editEl) editEl.style.display = '';

    if (field === 'pronouns') {
        const inp = document.getElementById('mypPronounsInput');
        if (inp) { inp.value = currentVrcUser.pronouns || ''; inp.focus(); }
    } else if (field === 'bio') {
        const inp = document.getElementById('mypBioInput');
        if (inp) { inp.focus(); const cnt = document.getElementById('mypBioCount'); if (cnt) cnt.textContent = inp.value.length; }
    } else if (field === 'links') {
        _renderMyLinksInputs();
    } else if (field === 'languages') {
        _renderMyLangsEdit();
    }
}

function cancelMyField(field) {
    const VIEWS = { pronouns: 'mypPronounsView', bio: 'mypBioView', links: 'mypLinksView', languages: 'mypLangsView' };
    const EDITS = { pronouns: 'mypPronounsEdit', bio: 'mypBioEdit', links: 'mypLinksEdit', languages: 'mypLangsEdit' };
    const v = document.getElementById(VIEWS[field]); if (v) v.style.display = '';
    const e = document.getElementById(EDITS[field]); if (e) e.style.display = 'none';
}

function saveMyField(field) {
    const u = currentVrcUser;
    if (!u) return;
    const EDITS = { pronouns: 'mypPronounsEdit', bio: 'mypBioEdit', links: 'mypLinksEdit', languages: 'mypLangsEdit' };
    const saveBtn = document.querySelector(`#${EDITS[field]} .vrcn-btn-primary`);
    if (saveBtn) saveBtn.disabled = true;

    if (field === 'pronouns') {
        const pronouns = document.getElementById('mypPronounsInput')?.value ?? '';
        sendToCS({ action: 'vrcUpdateProfile', pronouns });
    } else if (field === 'bio') {
        const bio = document.getElementById('mypBioInput')?.value ?? '';
        sendToCS({ action: 'vrcUpdateProfile', bio });
    } else if (field === 'links') {
        const inputs = document.querySelectorAll('#mypLinksInputs .vrcn-edit-field');
        const bioLinks = Array.from(inputs).map(i => i.value.trim()).filter(Boolean).slice(0, 3);
        sendToCS({ action: 'vrcUpdateProfile', bioLinks });
    } else if (field === 'languages') {
        const chips = document.querySelectorAll('#mypLangsChips [data-lang]');
        const selectedLangs = Array.from(chips).map(c => c.dataset.lang);
        const nonLangTags = (u.tags||[]).filter(t => !t.startsWith('language_'));
        sendToCS({ action: 'vrcUpdateProfile', tags: [...nonLangTags, ...selectedLangs] });
    }
}

function _renderMyLinksInputs() {
    const container = document.getElementById('mypLinksInputs');
    if (!container) return;
    const links = currentVrcUser.bioLinks || [];
    container.innerHTML = [0, 1, 2].map(i =>
        `<div class="myp-link-row">
            <span class="myp-link-num">${i + 1}</span>
            <input type="url" class="vrcn-edit-field" placeholder="https://..." value="${esc(links[i]||'')}" maxlength="512" style="flex:1;">
        </div>`
    ).join('');
}

function _renderMyLangsEdit() {
    const selectedLangs = (currentVrcUser.tags||[]).filter(t => t.startsWith('language_'));
    _renderMyLangChips(selectedLangs, document.getElementById('mypLangsChips'));
    const sel = document.getElementById('mypLangSelect');
    if (!sel) return;
    sel.innerHTML = `<option value="">${t('profiles.my_profile.add_language', 'Add language...')}</option>`;
    Object.entries(LANG_MAP).forEach(([key, name]) => {
        if (!selectedLangs.includes(key))
            sel.insertAdjacentHTML('beforeend', `<option value="${key}">${esc(name)}</option>`);
    });
}

function _renderMyLangChips(langs, el) {
    if (!el) return;
    el.innerHTML = langs.map(tag =>
        `<span class="myp-lang-chip" data-lang="${tag}">${esc(LANG_MAP[tag]||tag.replace('language_','').toUpperCase())}<button class="myp-lang-remove" onclick="removeMyLanguage('${tag}')"><span class="msi" style="font-size:11px;">close</span></button></span>`
    ).join('');
}

function addMyLanguage() {
    const sel = document.getElementById('mypLangSelect');
    const key = sel?.value;
    if (!key) return;
    const chips = Array.from(document.querySelectorAll('#mypLangsChips [data-lang]')).map(c => c.dataset.lang);
    if (chips.includes(key)) return;
    chips.push(key);
    _renderMyLangChips(chips, document.getElementById('mypLangsChips'));
    const opt = sel.querySelector(`option[value="${key}"]`);
    if (opt) opt.remove();
    sel.value = '';
}

function removeMyLanguage(tag) {
    const chips = Array.from(document.querySelectorAll('#mypLangsChips [data-lang]')).map(c => c.dataset.lang).filter(t => t !== tag);
    _renderMyLangChips(chips, document.getElementById('mypLangsChips'));
    const sel = document.getElementById('mypLangSelect');
    if (sel) sel.insertAdjacentHTML('beforeend', `<option value="${tag}">${esc(LANG_MAP[tag]||tag.replace('language_','').toUpperCase())}</option>`);
}



function switchMypTab(tab, btn) {
    const box = document.querySelector('#modalMyProfile .modal-box');
    const apply = () => {
        ['info', 'groups', 'content', 'favs', 'json'].forEach(name => {
            const el = document.getElementById('mypTab' + name.charAt(0).toUpperCase() + name.slice(1));
            if (el) el.style.display = tab === name ? '' : 'none';
        });
        document.querySelectorAll('#mypBox .fd-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
    };
    if (typeof animateModalBox === 'function') animateModalBox(box, apply);
    else apply();

    if (tab === 'favs' && !_mypFavsRequested && currentVrcUser?.id) {
        _mypFavsRequested = true;
        const el = document.getElementById('mypTabFavs');
        if (el) el.innerHTML = `<div class="empty-msg">${t('profiles.favs.loading', 'Loading favorites...')}</div>`;
        sendToCS({ action: 'vrcGetUserFavWorlds', userId: currentVrcUser.id });
    }
}

function switchMypInsightsPill(pill, btn) {
    const w = document.getElementById('mypInsightsWorlds');
    const p = document.getElementById('mypInsightsPersons');
    if (w) w.style.display = pill === 'worlds'  ? '' : 'none';
    if (p) p.style.display = pill === 'persons' ? '' : 'none';
    document.querySelectorAll('.myp-insights-pill').forEach(x => x.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function switchMypContentPill(pill, btn) {
    const w = document.getElementById('mypContentWorlds');
    const a = document.getElementById('mypContentAvatars');
    if (w) w.style.display = pill === 'worlds'  ? '' : 'none';
    if (a) a.style.display = pill === 'avatars' ? '' : 'none';
    document.querySelectorAll('.myp-content-pill').forEach(x => x.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function _mypGroupCard(g) {
    const gIcon = g.iconUrl
        ? `<img class="fd-group-icon" src="${esc(imgThumb(g.iconUrl, 96))}" onerror="this.style.display='none'">`
        : `<div class="fd-group-icon fd-group-icon-empty"><span class="msi" style="font-size:18px;">group</span></div>`;
    return `<div class="fd-group-card" onclick="navOpenModal('group','${jsq(g.id)}','${jsq(g.name || '')}')">
        ${gIcon}<div class="fd-group-card-info"><div class="fd-group-card-name">${esc(g.name || '')}</div><div class="fd-group-card-meta">${g.memberCount ? esc(getGroupMemberText(g.memberCount, false)) : ''}</div></div>
    </div>`;
}

function setMypGroupsSort(v) {
    _mypGroupsSortMode = v;
    _mypGroupsPage = 0;
    _mypOwnGroupsPage = 0;
    filterMypGroups();
    filterMypOwnGroups();
}

function filterMypGroups() {
    const grid = document.getElementById('mypGroupsGrid');
    if (!grid) return;
    const q = document.getElementById('mypGroupsSearch')?.value.trim().toLowerCase() || '';
    const all = window._mypGroups || [];
    const filtered = q ? all.filter(g => (g.name || '').toLowerCase().includes(q)) : all;
    const sorted = _fdSortGroups(filtered, _mypGroupsSortMode);
    const totalPages = Math.ceil(sorted.length / MINI_PG_SIZE) || 1;
    if (_mypGroupsPage >= totalPages) _mypGroupsPage = totalPages - 1;
    const page = _mypGroupsPage;
    const slice = sorted.slice(page * MINI_PG_SIZE, (page + 1) * MINI_PG_SIZE);
    grid.innerHTML = slice.length
        ? slice.map(_mypGroupCard).join('')
        : `<div style="padding:12px;grid-column:1/-1;text-align:center;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('profiles.groups.no_results', 'No results')}</div>`;
    setMiniPaginator('mypGroupsPaginatorBar', buildMiniPaginator(page, totalPages, 'mypGroupsGoPage'));
}

function mypGroupsGoPage(page) {
    if (page < 0) return;
    _mypGroupsPage = page;
    filterMypGroups();
}

function filterMypOwnGroups() {
    const grid = document.getElementById('mypOwnGroupsGrid');
    if (!grid) return;
    const all = _fdSortGroups(window._mypOwnGroups || [], _mypGroupsSortMode);
    const totalPages = Math.ceil(all.length / MINI_PG_SIZE) || 1;
    if (_mypOwnGroupsPage >= totalPages) _mypOwnGroupsPage = totalPages - 1;
    const page = _mypOwnGroupsPage;
    const slice = all.slice(page * MINI_PG_SIZE, (page + 1) * MINI_PG_SIZE);
    grid.innerHTML = slice.length
        ? slice.map(_mypGroupCard).join('')
        : `<div style="padding:12px;grid-column:1/-1;text-align:center;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);">${t('profiles.groups.no_results', 'No results')}</div>`;
    setMiniPaginator('mypOwnGroupsPaginatorBar', buildMiniPaginator(page, totalPages, 'mypOwnGroupsGoPage'));
}

function mypOwnGroupsGoPage(page) {
    if (page < 0) return;
    _mypOwnGroupsPage = page;
    filterMypOwnGroups();
}

function _mypUpdateContentCounts() {
    const wp = document.getElementById('mypWorldsPill');
    if (wp) wp.innerHTML = `${t('profiles.content.worlds_pill_label', 'Worlds')} <span class="vrcn-badge fd-tab-badge">${_mypAllWorlds.length}</span>`;
    const ap = document.getElementById('mypAvatarsPill');
    if (ap) ap.innerHTML = `${t('profiles.content.avatars_pill_label', 'Avatars')} <span class="vrcn-badge fd-tab-badge">${_mypAllAvatars.length}</span>`;
    const tab = document.getElementById('mypTabContentBtn');
    if (tab) tab.innerHTML = `${t('profiles.tabs.content_label', 'Content')} <span class="vrcn-badge fd-tab-badge">${_mypAllWorlds.length + _mypAllAvatars.length}</span>`;
}

function renderMypWorldsPage(page) {
    const grid = document.getElementById('mypWorldsGrid');
    if (!grid) return;
    const totalPages = Math.ceil(_mypAllWorlds.length / MINI_CONTENT_PG_SIZE) || 1;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;
    _mypWorldsPage = page;
    const slice = _mypAllWorlds.slice(page * MINI_CONTENT_PG_SIZE, (page + 1) * MINI_CONTENT_PG_SIZE);
    if (!slice.length) {
        grid.innerHTML = `<div class="empty-msg">${t('profiles.content.no_public_worlds', 'No public worlds found.')}</div>`;
        setMiniPaginator('mypWorldsPageBar', '');
        return;
    }
    grid.innerHTML = '<div class="vrcn-mini-content-grid">' + slice.map(w => {
        const thumb = w.thumbnailImageUrl || w.imageUrl || '';
        const tags = (w.tags || []).filter(tag => tag.startsWith('author_tag_')).map(tag => tag.replace('author_tag_', '')).slice(0, 2);
        const tagsHtml = tags.map(tag => `<span class="vrcn-badge">${esc(tag)}</span>`).join('');
        const isPublic = w.releaseStatus === 'public';
        const pubBadge = `<span class="vrcn-badge" style="${isPublic ? '' : 'background:rgba(255,100,100,.15);color:var(--err);'}">${isPublic ? t('avatars.labels.public','Public') : t('avatars.labels.private','Private')}</span>`;
        return `<div class="vrcn-mini-content" data-world-id="${esc(w.id || '')}" onclick="navOpenModal('worldSearch','${jsq(w.id || '')}','${jsq(w.name || '')}')">
            <div class="vrcn-mini-content-thumb" style="background-image:url('${cssUrl(imgThumb(thumb, 128))}')"></div>
            <div class="vrcn-mini-content-info">
                <div class="vrcn-mini-content-name">${esc(w.name || '')}</div>
                <div class="vrcn-mini-content-meta">${esc(w.authorName || '')}<span class="msi">person</span>${w.occupants ?? ''}<span class="msi">favorite</span>${w.favorites ?? ''}</div>
                <div class="vrcn-mini-content-badges">${tagsHtml}${pubBadge}</div>
            </div>
        </div>`;
    }).join('') + '</div>';
    setMiniPaginator('mypWorldsPageBar', buildMiniPaginator(page, totalPages, 'mypWorldsGoPage'));
}

function mypWorldsGoPage(page) {
    if (page < 0) return;
    const totalPages = Math.ceil(_mypAllWorlds.length / MINI_CONTENT_PG_SIZE) || 1;
    if (page >= totalPages) return;
    renderMypWorldsPage(page);
}

function renderMypAvatarsPage(page) {
    const grid = document.getElementById('mypAvatarsGrid');
    if (!grid) return;
    const totalPages = Math.ceil(_mypAllAvatars.length / MINI_CONTENT_PG_SIZE) || 1;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;
    _mypAvatarsPage = page;
    const slice = _mypAllAvatars.slice(page * MINI_CONTENT_PG_SIZE, (page + 1) * MINI_CONTENT_PG_SIZE);
    if (!slice.length) {
        grid.innerHTML = `<div class="empty-msg">${t('profiles.content.no_public_avatars', 'No public avatars found.')}</div>`;
        setMiniPaginator('mypAvatarsPageBar', '');
        return;
    }
    grid.innerHTML = '<div class="vrcn-mini-content-grid">' + slice.map(a => {
        const thumb = a.thumbnailImageUrl || a.imageUrl || '';
        const isPublic = a.releaseStatus === 'public';
        const platBadges = (typeof _avPlatformBadges === 'function') ? _avPlatformBadges(a) : '';
        const pubBadge = `<span class="vrcn-badge" style="${isPublic ? '' : 'background:rgba(255,100,100,.15);color:var(--err);'}">${isPublic ? t('avatars.labels.public','Public') : t('avatars.labels.private','Private')}</span>`;
        return `<div class="vrcn-mini-content" data-avatar-id="${esc(a.id || '')}" onclick="navOpenModal('avatar','${jsq(a.id || '')}','${jsq(a.name || '')}')">
            <div class="vrcn-mini-content-thumb" style="background-image:url('${cssUrl(imgThumb(thumb, 128))}')"></div>
            <div class="vrcn-mini-content-info">
                <div class="vrcn-mini-content-name">${esc(a.name || t('avatars.labels.unnamed','Unnamed'))}</div>
                <div class="vrcn-mini-content-meta">${esc(a.authorName || '')}</div>
                <div class="vrcn-mini-content-badges">${platBadges}${pubBadge}</div>
            </div>
        </div>`;
    }).join('') + '</div>';
    setMiniPaginator('mypAvatarsPageBar', buildMiniPaginator(page, totalPages, 'mypAvatarsGoPage'));
}

function mypAvatarsGoPage(page) {
    if (page < 0) return;
    const totalPages = Math.ceil(_mypAllAvatars.length / MINI_CONTENT_PG_SIZE) || 1;
    if (page >= totalPages) return;
    renderMypAvatarsPage(page);
}

function onMypMyWorlds(worlds) {
    _mypAllWorlds = Array.isArray(worlds) ? worlds : [];
    _mypUpdateContentCounts();
    renderMypWorldsPage(0);
}

function onMypUserAvatars(payload) {
    if (!_mypIsSelf(payload.userId)) return;
    _mypAllAvatars = payload.avatars || [];
    _mypUpdateContentCounts();
    renderMypAvatarsPage(0);
}

function renderMypFavWorlds(payload) {
    const el = document.getElementById('mypTabFavs');
    if (!el || !_mypIsSelf(payload.userId)) return;
    const groups = payload.groups || [];
    if (!groups.length) {
        el.innerHTML = `<div class="empty-msg">${t('profiles.favs.none', 'No public favorite worlds.')}</div>`;
        return;
    }

    let activePill = 0;
    const existingPill = el.querySelector('.fd-content-pill.active');
    if (existingPill) {
        const idx = [...el.querySelectorAll('.fd-content-pill')].indexOf(existingPill);
        if (idx >= 0) activePill = idx;
    }

    let pillsHtml = `<div class="fd-content-pills">`;
    groups.forEach((g, i) => {
        const count = g.worlds ? g.worlds.length : 0;
        pillsHtml += `<button class="fd-tab fd-content-pill${i === activePill ? ' active' : ''}" onclick="switchMypFavPill(${i},this)">${esc(g.displayName || g.name)} <span class="vrcn-badge fd-tab-badge">${count}</span></button>`;
    });
    pillsHtml += `</div>`;

    let panelsHtml = '';
    groups.forEach((g, i) => {
        panelsHtml += `<div id="mypFavPanel_${i}" style="${i !== activePill ? 'display:none;' : ''}">`;
        if (!g.worlds || !g.worlds.length) {
            panelsHtml += `<div class="empty-msg">${t('profiles.favs.empty_group', 'Empty.')}</div>`;
        } else {
            panelsHtml += `<div class="vrcn-world-grid-small">`;
            for (const w of g.worlds) {
                const thumb = w.thumbnailImageUrl || '';
                panelsHtml += `<div class="vrcn-world-card-small" onclick="navOpenModal('worldSearch','${jsq(w.id)}','${jsq(w.name || '')}')">
                    <div class="vwcs-bg"${thumb ? ` style="background-image:url('${cssUrl(imgThumb(thumb, 256))}')"` : ''}></div>
                    <div class="vwcs-scrim"></div>
                    <div class="vwcs-info">
                        <div class="vwcs-name">${esc(w.name)}</div>
                        <div class="vwcs-meta"><span class="msi" style="font-size:11px;">person</span>${w.occupants} <span class="msi" style="font-size:11px;">favorite</span>${w.favorites}</div>
                    </div>
                </div>`;
            }
            panelsHtml += `</div>`;
        }
        panelsHtml += `</div>`;
    });

    el.innerHTML = pillsHtml + panelsHtml;
}

function switchMypFavPill(idx, btn) {
    const el = document.getElementById('mypTabFavs');
    if (!el) return;
    el.querySelectorAll('[id^="mypFavPanel_"]').forEach((p, i) => p.style.display = i === idx ? '' : 'none');
    el.querySelectorAll('.fd-content-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function renderMypTimeline(userId, events) {
    if (!_mypIsSelf(userId)) return;
    if (typeof drawMiniTimeline === 'function') drawMiniTimeline(events || [], document.getElementById('mypMiniTl'));
}

function renderMypProfileInsights(payload) {
    if (!_mypIsSelf(payload.userId)) return;
    if (typeof renderFdInsightsWorlds === 'function') renderFdInsightsWorlds(payload.worlds || [], 'mypInsightsWorlds');
    if (typeof renderFdInsightsPersons === 'function') renderFdInsightsPersons(payload.persons || [], 'mypInsightsPersons');
}

function mypRequestHeatmap() {
    const uid = currentVrcUser?.id;
    if (!uid) return;
    const icon = document.getElementById('mypHmRefreshIcon');
    if (icon) icon.classList.add('ts-spin');
    const isStatus = _mypHeatmapView !== 'online';
    if (isStatus) {
        const sw = document.getElementById('mypHmStatusWrap');
        if (sw && !sw.querySelector('.fd-hm-grid'))
            sw.innerHTML = `<div style="padding:16px 0;font-size:calc(12px + var(--fs-off, 0px));color:var(--tx3);text-align:center;">${t('profiles.insights.loading', 'Loading...')}</div>`;
    }
    sendToCS({ action: isStatus ? 'getUserStatusTime' : 'getUserOnlineHeatmap', userId: uid, days: _mypHeatmapDays });
}

function mypChangeHeatmapPeriod(v) {
    _mypHeatmapDays = parseInt(v, 10) || 0;
    _mypStatusData = null;
    mypRequestHeatmap();
}

function mypChangeHeatmapView(v) {
    _mypHeatmapView = v;
    const isOnline = v === 'online';
    const grid = document.getElementById('mypHmGridWrap');
    const status = document.getElementById('mypHmStatusWrap');
    if (grid) grid.style.display = isOnline ? '' : 'none';
    if (status) status.style.display = isOnline ? 'none' : '';
    if (isOnline) { mypRequestHeatmap(); return; }
    if (_mypStatusData && _mypStatusData.days === _mypHeatmapDays) renderMypStatusTime(_mypStatusData);
    else mypRequestHeatmap();
}

function mypReloadHeatmap() {
    if (_mypHeatmapView !== 'online') _mypStatusData = null;
    mypRequestHeatmap();
}

function renderMypOnlineHeatmap(payload) {
    if (!_mypIsSelf(payload.userId) || !document.getElementById('mypHmGridWrap')) return;
    if (typeof drawOnlineHeatmap === 'function') drawOnlineHeatmap(payload, MYP_HM_IDS);
}

function renderMypStatusTime(payload) {
    if (!_mypIsSelf(payload.userId) || !document.getElementById('mypHmStatusWrap')) return;
    _mypStatusData = payload;
    if (typeof drawStatusHeatmap === 'function') drawStatusHeatmap(payload, MYP_HM_IDS, _mypHeatmapView);
}

function openStatusModal() {
    if (!currentVrcUser) return;
    selectedStatus = currentVrcUser.status || 'active';
    const m = document.getElementById('modalStatus');
    const opts = document.getElementById('statusOptions');
    opts.innerHTML = STATUS_LIST.map(s =>
        `<div class="status-option${selectedStatus === s.key ? ' selected' : ''}" data-status-key="${s.key}" onclick="selectStatusOption('${s.key}')"><div class="status-option-dot" style="background:${s.color}"></div><div><div class="status-option-label">${t(s.labelKey || '', s.label)}</div><div class="status-option-desc">${t(s.descKey || '', s.desc)}</div></div></div>`
    ).join('');

    const curDesc = currentVrcUser.statusDescription || '';
    const history = Array.isArray(currentVrcUser.statusHistory) ? currentVrcUser.statusHistory : [];
    const seen = new Set();
    const entries = [];
    [curDesc, ...history].forEach(s => {
        const v = (s || '').trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        entries.push(v);
    });

    const sel = document.getElementById('statusDescSelect');
    sel.innerHTML = `<option value="">${esc(t('profiles.status.no_message', 'No status message'))}</option>`
        + entries.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = curDesc && entries.includes(curDesc) ? curDesc : '';
    sel.onchange = () => updateStatusDescCount(sel.value.length);
    if (typeof initVnSelect === 'function') {
        initVnSelect(sel);
        if (sel._vnRefresh) sel._vnRefresh();
    }

    const inp = document.getElementById('statusDescInput');
    inp.value = curDesc;
    inp.oninput = () => updateStatusDescCount(inp.value.length);

    // Default to the dropdown. Fall back to free-text only when there are no recent statuses.
    setStatusDescMode(entries.length === 0);
    updateStatusDescCount((entries.length === 0 ? inp.value : sel.value).length);
    m.style.display = 'flex';
}

function updateStatusDescCount(len) {
    const el = document.getElementById('statusDescCount');
    if (!el) return;
    const remaining = 32 - (len || 0);
    el.textContent = remaining;
    el.className = 'status-desc-count' + (remaining <= 5 ? ' warn' : remaining <= 10 ? ' low' : '');
}

function setStatusDescMode(textMode) {
    const sel = document.getElementById('statusDescSelect');
    const inp = document.getElementById('statusDescInput');
    const btn = document.getElementById('statusDescEditBtn');
    const wrap = sel.parentElement && sel.parentElement.classList.contains('vn-select') ? sel.parentElement : sel;
    wrap.style.display = textMode ? 'none' : '';
    inp.style.display = textMode ? '' : 'none';
    const cnt = document.getElementById('statusDescCount');
    if (cnt) cnt.style.display = textMode ? '' : 'none';
    btn.classList.toggle('active', textMode);
    if (textMode) setTimeout(() => inp.focus(), 50);
}

function toggleStatusDescEdit() {
    const inp = document.getElementById('statusDescInput');
    const sel = document.getElementById('statusDescSelect');
    const goingToText = inp.style.display === 'none';
    if (goingToText) {
        inp.value = sel.value;
        updateStatusDescCount(inp.value.length);
    } else {
        updateStatusDescCount(sel.value.length);
    }
    setStatusDescMode(goingToText);
}

function selectStatusOption(key) {
    selectedStatus = key;
    document.querySelectorAll('.status-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.statusKey === key);
    });
}

function submitStatusChange() {
    const inp = document.getElementById('statusDescInput');
    const sel = document.getElementById('statusDescSelect');
    const textMode = inp.style.display !== 'none';
    const desc = (textMode ? inp.value : sel.value).trim();
    sendToCS({ action: 'vrcUpdateStatus', status: selectedStatus, statusDescription: desc });
    document.getElementById('modalStatus').style.display = 'none';
}

// VRC+ profile background. Written through PUT profile/{userId}, which is a different
// endpoint from the decoration slots above, hence its own action.
function _mypBackgroundSection() {
    if (typeof PROFILE_BG_FILES === 'undefined') return '';
    const u = currentVrcUser || {};
    const type = u.backgroundType || 'default';
    const curTex = type === 'texture' ? (u.backgroundTextureId || '') : '';

    const noneCell = `<div class="pd-cell${type === 'default' ? ' pd-sel' : ''}" onclick="setProfileBackground('default')"><div class="pd-none"><span class="msi">block</span></div><div class="pd-name">${t('profiles.deco.none', 'None')}</div></div>`;

    const gradCell = `<div class="pd-cell${type === 'gradient' ? ' pd-sel' : ''}" onclick="setProfileBackgroundGradient()" title="${esc(t('profiles.deco.gradient', 'Gradient'))}"><div class="pd-none" style="background:linear-gradient(180deg,${esc(u.backgroundGradientTop || '#5d3f86')},${esc(u.backgroundGradientBottom || '#21385b')});"></div><div class="pd-name">${esc(t('profiles.deco.gradient', 'Gradient'))}</div></div>`;

    const texCells = Object.keys(PROFILE_BG_FILES).map(id => {
        const url = PROFILE_BG_ASSET_URL + PROFILE_BG_FILES[id];
        const label = id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `<div class="pd-cell${curTex === id ? ' pd-sel' : ''}" onclick="setProfileBackground('texture','${jsq(id)}')" title="${esc(label)}"><img src="${esc(url)}" loading="lazy" onerror="this.style.display='none'"><div class="pd-name">${esc(label)}</div></div>`;
    }).join('');

    return `<div class="pd-section"><div class="pd-section-title">${esc(t('profiles.deco.background', 'Profile Background'))}</div><div class="pd-grid">${noneCell}${gradCell}${texCells}</div></div>`;
}

function setProfileBackground(type, textureId) {
    if (currentVrcUser) {
        currentVrcUser.backgroundType = type;
        currentVrcUser.backgroundTextureId = type === 'texture' ? (textureId || '') : '';
    }
    renderProfileDecoPicker(false);
    sendToCS({ action: 'vrcUpdateProfileBackground', backgroundType: type, backgroundTextureId: textureId || '' });
}

let _pbgGradTop = '#5d3f86';
let _pbgGradBottom = '#21385b';

function _pbgHex(v, fallback) {
    const c = String(v || '').trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : fallback;
}

// Gradient editor in the same shell as the decoration picker, with a live preview so
// the two colours can be judged together rather than one hex field at a time.
function setProfileBackgroundGradient() {
    const u = currentVrcUser || {};
    _pbgGradTop    = _pbgHex(u.backgroundGradientTop, '#5d3f86');
    _pbgGradBottom = _pbgHex(u.backgroundGradientBottom, '#21385b');

    let m = document.getElementById('profileGradModal');
    if (m) m.remove();
    m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'profileGradModal';
    m.style.zIndex = '10004';
    m.style.display = 'flex';
    m.innerHTML = `<div class="gp-modal" style="width:380px;max-width:92vw;">
        ${renderModalBar(t('profiles.deco.gradient', 'Gradient'), [modalCloseAction('closeProfileGradPicker()')])}
        <div class="gp-modal-body">
            <div id="pbgPreview" class="pbg-preview"></div>
            <div class="pbg-row">
                <span class="pbg-label">${esc(t('profiles.deco.gradient_top', 'Top'))}</span>
                <input type="color" id="pbgTopColor" class="pbg-swatch" value="${esc(_pbgGradTop)}" oninput="pbgSetGrad('top', this.value)">
                <input type="text" id="pbgTopHex" class="vrcn-edit-field pbg-hex" maxlength="7" value="${esc(_pbgGradTop)}" oninput="pbgSetGrad('top', this.value)">
            </div>
            <div class="pbg-row">
                <span class="pbg-label">${esc(t('profiles.deco.gradient_bottom', 'Bottom'))}</span>
                <input type="color" id="pbgBottomColor" class="pbg-swatch" value="${esc(_pbgGradBottom)}" oninput="pbgSetGrad('bottom', this.value)">
                <input type="text" id="pbgBottomHex" class="vrcn-edit-field pbg-hex" maxlength="7" value="${esc(_pbgGradBottom)}" oninput="pbgSetGrad('bottom', this.value)">
            </div>
        </div>
        <div class="modal-btns" style="padding:0 16px 16px;">
            <button class="vrcn-button vrcn-btn-primary" onclick="applyProfileGradient()">${esc(t('common.apply', 'Apply'))}</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) closeProfileGradPicker(); });
    _pbgRenderPreview();
}

function _pbgRenderPreview() {
    const el = document.getElementById('pbgPreview');
    if (el) el.style.background = `linear-gradient(180deg, ${_pbgGradTop}, ${_pbgGradBottom})`;
}

function pbgSetGrad(which, value) {
    const cur = which === 'top' ? _pbgGradTop : _pbgGradBottom;
    const hex = _pbgHex(value, cur);
    if (which === 'top') _pbgGradTop = hex; else _pbgGradBottom = hex;

    const colorEl = document.getElementById(which === 'top' ? 'pbgTopColor' : 'pbgBottomColor');
    const hexEl   = document.getElementById(which === 'top' ? 'pbgTopHex'   : 'pbgBottomHex');
    if (colorEl) colorEl.value = hex;
    // Leave the text field alone while it is being typed in, otherwise the caret jumps.
    if (hexEl && document.activeElement !== hexEl) hexEl.value = hex;
    _pbgRenderPreview();
}

function closeProfileGradPicker() {
    document.getElementById('profileGradModal')?.remove();
}

function applyProfileGradient() {
    if (currentVrcUser) {
        currentVrcUser.backgroundType = 'gradient';
        currentVrcUser.backgroundGradientTop = _pbgGradTop;
        currentVrcUser.backgroundGradientBottom = _pbgGradBottom;
    }
    closeProfileGradPicker();
    renderProfileDecoPicker(false);
    sendToCS({
        action: 'vrcUpdateProfileBackground',
        backgroundType: 'gradient',
        backgroundGradientTop: _pbgGradTop,
        backgroundGradientBottom: _pbgGradBottom,
    });
}

function onProfileBackgroundUpdated(data) {
    if (!data?.success) { showToast(false, t('profiles.deco.failed', 'Could not update decoration')); return; }
    if (currentVrcUser) Object.assign(currentVrcUser, {
        backgroundType:           data.backgroundType || 'default',
        backgroundTextureId:      data.backgroundTextureId || '',
        backgroundTextureUrl:     data.backgroundTextureUrl || '',
        backgroundGradientTop:    data.backgroundGradientTop || '',
        backgroundGradientBottom: data.backgroundGradientBottom || '',
    });
    showToast(true, t('profiles.deco.updated', 'Profile updated!'));
    if (typeof renderMyProfileContent === 'function') renderMyProfileContent();
    renderProfileDecoPicker(false);
}

function onProfileBannerUpdated(data) {
    if (!data?.success) { showToast(false, t('profiles.banner.failed', 'Could not update banner')); return; }
    if (currentVrcUser) currentVrcUser.bannerUrl = data.bannerUrl || '';
    showToast(true, t('profiles.banner.updated', 'Banner updated!'));
    if (typeof renderMyProfileContent === 'function') renderMyProfileContent();
}

function _mypThemeSection() {
    if (typeof profileThemeStripes !== 'function') return '';
    const u = currentVrcUser || {};
    const themes = Array.isArray(u.themes) ? u.themes : [];
    const cur = u.themeId || '';

    const noneCell = `<div class="pd-cell${!cur ? ' pd-sel' : ''}" onclick="setActiveProfileTheme('')"><div class="pd-none"><span class="msi">block</span></div><div class="pd-name">${t('profiles.deco.none', 'None')}</div></div>`;

    const cells = themes.map(th => `<div class="pd-cell${th.id === cur ? ' pd-sel' : ''}" title="${esc(th.name || '')}">
        <div onclick="setActiveProfileTheme('${jsq(th.id)}')">${profileThemeStripes(th)}<div class="pd-name">${esc(th.name || t('profiles.theme.unnamed', 'Unnamed'))}</div></div>
        <div class="pt-cell-actions">
            <button class="vrcn-button" style="padding:2px 6px;" onclick="event.stopPropagation();openProfileThemeEditor('${jsq(th.id)}')"><span class="msi" style="font-size:13px;">edit</span></button>
            <button class="vrcn-button" style="padding:2px 6px;" onclick="event.stopPropagation();deleteProfileTheme('${jsq(th.id)}')"><span class="msi" style="font-size:13px;">delete</span></button>
        </div>
    </div>`).join('');

    const addCell = `<div class="pd-cell" onclick="openProfileThemeEditor('')"><div class="pd-none"><span class="msi">add</span></div><div class="pd-name">${t('profiles.theme.add', 'New Theme')}</div></div>`;

    return `<div class="pd-section"><div class="pd-section-title">${esc(t('profiles.theme.title', 'Profile Theme'))}</div><div class="pd-grid">${noneCell}${cells}${addCell}</div></div>`;
}

function setActiveProfileTheme(themeId) {
    if (currentVrcUser) currentVrcUser.themeId = themeId;
    _mypApplyActiveThemeColors();
    renderProfileDecoPicker(false);
    sendToCS({ action: 'vrcSetActiveProfileTheme', themeId });
}

function _mypApplyActiveThemeColors() {
    const u = currentVrcUser;
    if (!u) return;
    const th = (Array.isArray(u.themes) ? u.themes : []).find(x => x.id === u.themeId);
    u.themeButtonColor  = th ? (th.buttonColor  || '') : '';
    u.themeIconColor    = th ? (th.iconColor    || '') : '';
    u.themeSubtextColor = th ? (th.subtextColor || '') : '';
    if (typeof renderMyProfileContent === 'function') renderMyProfileContent();
}

let _ptEditId = '';
let _ptEditColors = { button: '#064b5c', icon: '#6ae3f9', subtext: '#a9a9a9' };

function openProfileThemeEditor(themeId, preset) {
    const u = currentVrcUser || {};
    const th = (Array.isArray(u.themes) ? u.themes : []).find(x => x.id === themeId);
    _ptEditId = themeId || '';
    _ptEditColors = preset ? {
        button:  ptHex(preset.button,  '#064b5c'),
        icon:    ptHex(preset.icon,    '#6ae3f9'),
        subtext: ptHex(preset.subtext, '#a9a9a9'),
    } : {
        button:  ptHex(th && th.buttonColor,  '#064b5c'),
        icon:    ptHex(th && th.iconColor,    '#6ae3f9'),
        subtext: ptHex(th && th.subtextColor, '#a9a9a9'),
    };

    document.getElementById('profileThemeModal')?.remove();
    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'profileThemeModal';
    m.style.zIndex = '10004';
    m.style.display = 'flex';

    const rows = [
        ['button',  t('profiles.theme.button_color',  'Button')],
        ['icon',    t('profiles.theme.icon_color',    'Icons')],
        ['subtext', t('profiles.theme.subtext_color', 'Text')],
    ].map(pair => `<div class="pt-row">
        <span class="pt-label">${esc(pair[1])}</span>
        <input type="color" id="ptColor_${pair[0]}" class="pbg-swatch" value="${esc(_ptEditColors[pair[0]])}" oninput="ptSetColor('${pair[0]}', this.value)">
        <input type="text" id="ptHex_${pair[0]}" class="vrcn-edit-field pbg-hex" maxlength="7" value="${esc(_ptEditColors[pair[0]])}" oninput="ptSetColor('${pair[0]}', this.value)">
    </div>`).join('');

    m.innerHTML = `<div class="gp-modal" style="width:400px;max-width:92vw;">
        ${renderModalBar(themeId ? t('profiles.theme.edit', 'Edit Theme') : t('profiles.theme.add', 'New Theme'), [modalCloseAction('closeProfileThemeEditor()')])}
        <div class="gp-modal-body">
            <div class="pt-preview" id="ptPreview"></div>
            <div class="pt-row">
                <span class="pt-label">${esc(t('profiles.theme.name', 'Name'))}</span>
                <input type="text" id="ptName" class="vrcn-edit-field" style="flex:1;" maxlength="32" value="${esc(preset ? (preset.name || '') : ((th && th.name) || ''))}">
            </div>
            ${rows}
        </div>
        <div class="modal-btns" style="padding:0 16px 16px;">
            <button class="vrcn-button vrcn-btn-primary" onclick="saveProfileThemeFromEditor()">${esc(t('common.save', 'Save'))}</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) closeProfileThemeEditor(); });
    _ptRenderPreview();
}

function _ptRenderPreview() {
    const el = document.getElementById('ptPreview');
    if (el) el.innerHTML = profileThemeStripes({
        buttonColor: _ptEditColors.button,
        iconColor: _ptEditColors.icon,
        subtextColor: _ptEditColors.subtext,
    });
}

function ptSetColor(key, value) {
    const hex = ptHex(value, _ptEditColors[key]);
    _ptEditColors[key] = hex;
    const c = document.getElementById('ptColor_' + key);
    const h = document.getElementById('ptHex_' + key);
    if (c) c.value = hex;
    if (h && document.activeElement !== h) h.value = hex;
    _ptRenderPreview();
}

function closeProfileThemeEditor() {
    document.getElementById('profileThemeModal')?.remove();
}

function saveProfileThemeFromEditor() {
    const name = (document.getElementById('ptName')?.value || '').trim();
    if (!name) { showToast(false, t('profiles.theme.name_required', 'Please enter a theme name')); return; }
    sendToCS({
        action: 'vrcSaveProfileTheme',
        themeId: _ptEditId,
        name,
        buttonColor: _ptEditColors.button,
        iconColor: _ptEditColors.icon,
        subtextColor: _ptEditColors.subtext,
    });
    closeProfileThemeEditor();
}

function deleteProfileTheme(themeId) {
    sendToCS({ action: 'vrcDeleteProfileTheme', themeId });
}

function onProfileThemeSaved(data) {
    if (!data || !data.success || !data.theme) { showToast(false, t('profiles.theme.save_failed', 'Could not save theme')); return; }
    if (currentVrcUser) {
        if (!Array.isArray(currentVrcUser.themes)) currentVrcUser.themes = [];
        const i = currentVrcUser.themes.findIndex(x => x.id === data.theme.id);
        if (i >= 0) currentVrcUser.themes[i] = data.theme; else currentVrcUser.themes.push(data.theme);
        if (data.created) currentVrcUser.themeId = data.theme.id;
        _mypApplyActiveThemeColors();
    }
    showToast(true, t('profiles.deco.updated', 'Profile updated!'));
    renderProfileDecoPicker(false);
}

function onProfileThemeDeleted(data) {
    if (!data || !data.success) { showToast(false, t('profiles.theme.delete_failed', 'Could not delete theme')); return; }
    if (currentVrcUser && Array.isArray(currentVrcUser.themes)) {
        currentVrcUser.themes = currentVrcUser.themes.filter(x => x.id !== data.themeId);
        if (currentVrcUser.themeId === data.themeId) currentVrcUser.themeId = '';
        _mypApplyActiveThemeColors();
    }
    renderProfileDecoPicker(false);
}
