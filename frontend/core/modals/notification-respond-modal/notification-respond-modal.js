/* === Notification Respond Modal ===
   Lets the user answer an invite / invite-request notification with a chosen
   message slot (response pool for invite, requestResponse pool for requestInvite),
   optionally attaching a photo. Two tabs: With Message | With Image. */

let _nrModalNotif        = null;   /* the notification object */
let _nrModalPool         = null;   /* 'response' | 'requestResponse' */
let _nrModalMsgs         = [];     /* { slot, message, canBeUpdated, remainingCooldownMinutes } */
let _nrModalSelected     = -1;
let _nrModalTab          = 'message';
let _nrModalPhotoFileId  = null;
let _nrModalPhotoUrl     = null;
let _nrModalSenderName   = '';

function openNotifRespondModal(notifId) {
    closeNotifRespondModal();
    if (typeof toggleNotifPanel === 'function' && typeof notifPanelOpen !== 'undefined' && notifPanelOpen) {
        toggleNotifPanel();
    }
    const n = (typeof notifications !== 'undefined' ? notifications : []).find(x => x.id === notifId);
    if (!n) return;
    if (n.type !== 'invite' && n.type !== 'requestInvite') return;

    _nrModalNotif        = n;
    _nrModalPool         = n.type === 'requestInvite' ? 'requestResponse' : 'response';
    _nrModalMsgs         = [];
    _nrModalSelected     = -1;
    _nrModalTab          = 'message';
    _nrModalPhotoFileId  = null;
    _nrModalPhotoUrl     = null;
    _nrModalSenderName   = n.senderUsername || n.senderUserId || '';

    const det = typeof n.details === 'string'
        ? (() => { try { return JSON.parse(n.details); } catch { return {}; } })()
        : (n.details || {});

    const hasVrcPlus = Array.isArray(currentVrcUser?.tags) && currentVrcUser.tags.includes('system_supporter');

    /* Banner: invite uses world thumb when known; requestInvite uses sender avatar. */
    const senderImg = _resolveNotifImage ? _resolveNotifImage(n) : (n._image || '');
    let bannerImg   = '';
    let titleLine   = '';
    let subLine     = '';
    if (n.type === 'invite') {
        const worldId   = det.worldId ? det.worldId.split(':')[0] : '';
        const worldName = det.worldName || t('notifications.unknown_world', 'unknown world');
        const wCached   = worldId && typeof worldsData !== 'undefined'
            ? (worldsData || []).find(w => w.id === worldId) : null;
        bannerImg = (wCached && (wCached.thumbnailImageUrl || wCached.imageUrl)) || senderImg || '';
        titleLine = tf('notifications.respond.invite_from', { name: esc(_nrModalSenderName) }, 'Invite from {name}');
        subLine   = esc(worldName);
    } else {
        bannerImg = senderImg || '';
        titleLine = tf('notifications.respond.request_from', { name: esc(_nrModalSenderName) }, 'Invite Request from {name}');
        subLine   = det.requestMessage ? esc(det.requestMessage) : '';
    }

    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.style.display = 'flex'; // inline display required by _closeTopModal (Escape)
    /* Notification panel uses z-index 20001 — must sit above it. */
    el.style.zIndex = '20003';
    el.innerHTML = `
        <div class="modal-box inv-single-modal">
            ${renderModalBar(_nrModalSenderName, [modalCloseAction('closeNotifRespondModal()')], { flush: true })}
            <div class="inv-world-banner" style="${bannerImg ? `background-image:url('${cssUrl(bannerImg)}')` : ''}">
                <div class="inv-world-fade"></div>
                <div class="inv-world-info">
                    <div style="font-size:calc(11px + var(--fs-off, 0px));color:rgba(255,255,255,.65);margin-bottom:2px;">${titleLine}</div>
                    <div class="inv-world-name">${tf('notifications.respond.answer', { name: esc(_nrModalSenderName) }, 'Answer {name}')}</div>
                    ${subLine ? `<div style="font-size:calc(11px + var(--fs-off, 0px));color:rgba(255,255,255,.75);margin-top:3px;">${subLine}</div>` : ''}
                </div>
            </div>
            <div class="fd-tabs" style="margin:14px 16px 0;flex-shrink:0;">
                <button class="fd-tab active" id="nrTab_message" onclick="_nrModalSetTab('message')">${t('profiles.invite.tab.message', 'With Message')}</button>
                ${hasVrcPlus ? `<button class="fd-tab" id="nrTab_photo" onclick="_nrModalSetTab('photo')">${t('profiles.invite.tab.photo', 'With Image')}</button>` : ''}
            </div>
            <div class="inv-single-body">
                <div id="nrMsgSection">
                    <div class="fd-info-card">
                        <div class="fd-group-rep-label" id="nrMsgOptLabel">${t('profiles.invite.tab.message', 'With Message')}</div>
                        <div id="nrMsgList"></div>
                    </div>
                </div>
                <div id="nrPhotoSection" style="display:none;">
                    <div class="fd-info-card">
                        <div class="fd-group-rep-label" id="nrPhotoLabel">${t('profiles.invite.image_label', 'Image')} <span style="font-weight:400;text-transform:none;letter-spacing:normal;">(${t('common.required', 'required')})</span></div>
                        <div id="nrLibraryGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;max-height:180px;overflow-y:auto;padding:4px 0;"></div>
                    </div>
                </div>
                <button id="nrSendBtn" class="vrcn-button vrcn-btn-primary inv-action-full" onclick="_nrModalSend()">${t('notifications.respond.send', 'Send Response')}</button>
            </div>
        </div>`;
    el.addEventListener('click', e => { if (e.target === el) closeNotifRespondModal(); });
    document.body.appendChild(el);
    window._nrModalEl = el;

    sendToCS({ action: 'vrcGetRespondMessages', notifType: n.type });
    _nrModalUpdateSendBtn();
}

function _nrModalSetTab(tab) {
    _nrModalTab = tab;
    ['message', 'photo'].forEach(t => {
        const btn = document.getElementById(`nrTab_${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
    });
    const msgSect   = document.getElementById('nrMsgSection');
    const optLabel  = document.getElementById('nrMsgOptLabel');
    const photoSect = document.getElementById('nrPhotoSection');
    if (msgSect)   msgSect.style.display   = (tab === 'message' || tab === 'photo') ? '' : 'none';
    if (optLabel)  optLabel.textContent    = tab === 'photo'
        ? t('profiles.invite.optional_message', 'Optional message')
        : t('profiles.invite.tab.message', 'With Message');
    if (photoSect) photoSect.style.display = tab === 'photo' ? '' : 'none';
    if (tab === 'photo') {
        const cached = (typeof invFilesCache !== 'undefined') && invFilesCache['gallery'];
        if (cached && cached.length > 0) _nrModalRenderLibrary(cached);
        else sendToCS({ action: 'invGetFiles', tag: 'gallery' });
    }
    _nrModalUpdateSendBtn();
}

function _nrModalRenderMsgs() {
    const list = document.getElementById('nrMsgList');
    if (!list) return;
    if (!_nrModalMsgs.length) {
        list.innerHTML = `<div class="inv-msg-loading"><span class="msi" style="font-size:16px;animation:spin 1s linear infinite;">progress_activity</span> ${t('profiles.invite.loading_messages', 'Loading messages...')}</div>`;
        return;
    }
    list.innerHTML = _nrModalMsgs.map(m => {
        const i        = m.slot;
        const canEdit  = m.canBeUpdated;
        const cooldown = m.remainingCooldownMinutes || 0;
        const isSelected = _nrModalSelected === i;
        return `
        <div class="inv-msg-item${isSelected ? ' selected' : ''}" id="nrMsg_${i}" onclick="_nrModalSelectMsg(${i})">
            <span class="inv-msg-text" id="nrMsgText_${i}">${esc(m.message)}</span>
            ${canEdit
                ? `<button class="inv-msg-edit" onclick="event.stopPropagation();_nrModalEditMsg(${i})" title="${esc(t('common.edit', 'Edit'))}"><span class="msi" style="font-size:14px;">edit</span></button>`
                : `<span class="inv-msg-cooldown" title="${esc(tf('profiles.invite.cooldown_title', { count: cooldown }, '{count} min cooldown'))}"><span class="msi" style="font-size:13px;">schedule</span></span>`}
        </div>`;
    }).join('');
}

function handleVrcRespondMessages(payload) {
    if (!payload || payload.pool !== _nrModalPool) return;
    _nrModalMsgs = (payload.messages || []).slice().sort((a, b) => a.slot - b.slot);
    _nrModalRenderMsgs();
}

function handleVrcRespondMessageUpdateFailed(payload) {
    if (!payload || payload.pool !== _nrModalPool) return;
    const itemEl = document.getElementById(`nrMsg_${payload.slot}`);
    if (itemEl) { delete itemEl.dataset.editing; _nrModalRenderMsgs(); }
    showToast(false, tf('profiles.invite.cooldown_toast', { count: payload.cooldown || 60 }, 'Cooldown: {count} min remaining'));
}

function _nrModalSelectMsg(idx) {
    _nrModalSelected = _nrModalSelected === idx ? -1 : idx;
    document.querySelectorAll('#nrMsgList .inv-msg-item').forEach(el => {
        el.classList.toggle('selected', parseInt(el.id.replace('nrMsg_', '')) === _nrModalSelected);
    });
    _nrModalUpdateSendBtn();
}

function _nrModalEditMsg(idx) {
    const itemEl = document.getElementById(`nrMsg_${idx}`);
    const textEl = document.getElementById(`nrMsgText_${idx}`);
    if (!itemEl || !textEl || itemEl.dataset.editing) return;
    itemEl.dataset.editing = '1';
    const cur = (_nrModalMsgs.find(m => m.slot === idx) || {}).message || '';
    textEl.outerHTML = `<input class="inv-msg-input" id="nrMsgText_${idx}" value="${cur.replace(/"/g, '&quot;')}"
        onblur="_nrModalSaveMsg(${idx},this)"
        onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}">`;
    const inp = document.getElementById(`nrMsgText_${idx}`);
    if (inp) { inp.focus(); inp.select(); }
    const icon = itemEl.querySelector('.inv-msg-edit .msi');
    if (icon) icon.textContent = 'check';
}

function _nrModalSaveMsg(idx, input) {
    const itemEl = document.getElementById(`nrMsg_${idx}`);
    if (!itemEl) return;
    delete itemEl.dataset.editing;
    const m = _nrModalMsgs.find(x => x.slot === idx);
    const newText = input.value.trim();
    if (!input.dataset.cancel && newText && m && newText !== m.message) {
        sendToCS({ action: 'vrcUpdateRespondMessage', notifType: _nrModalNotif?.type, slot: idx, message: newText });
        m.message = newText;
        m.canBeUpdated = false;
        m.remainingCooldownMinutes = 60;
    }
    _nrModalRenderMsgs();
}

function _nrModalRenderLibrary(files) {
    const grid = document.getElementById('nrLibraryGrid');
    if (!grid) return;
    const uploadTile = (typeof getInviteUploadTileHtml === 'function') ? getInviteUploadTileHtml() : '';
    if (!files || !files.length) { grid.innerHTML = uploadTile; return; }
    grid.innerHTML = uploadTile + files.map(f => {
        const url = f.fileUrl || '';
        const fid = jsq(f.id || '');
        if (!url) return '';
        return `<img src="${esc(url)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer;opacity:0.85;transition:opacity .15s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.85" onclick="_nrModalSelectLibraryPhoto(this,'${jsq(url)}','${fid}')" onerror="this.style.display='none'">`;
    }).join('');
}

function _nrModalOnGalleryLoaded(files) {
    if (!document.getElementById('nrLibraryGrid')) return;
    _nrModalRenderLibrary(files);
}

function _nrModalSelectLibraryPhoto(el, url, fileId) {
    document.querySelectorAll('#nrLibraryGrid img').forEach(i => i.style.outline = 'none');
    el.style.outline = '2px solid var(--accent)';
    _nrModalPhotoFileId = fileId;
    _nrModalPhotoUrl    = url;
    _nrModalUpdateSendBtn();
}

function _nrModalUpdateSendBtn() {
    const btn = document.getElementById('nrSendBtn');
    if (!btn) return;
    /* Message tab needs a selected slot. Photo tab needs an image AND a selected slot
       (VRChat's /response/photo endpoint requires responseSlot per InviteResponse schema). */
    btn.disabled = (_nrModalTab === 'message' && _nrModalSelected < 0)
                || (_nrModalTab === 'photo'   && (!_nrModalPhotoUrl || _nrModalSelected < 0));
}

function _nrModalSend() {
    const n = _nrModalNotif;
    if (!n) return;
    if (_nrModalTab === 'message') {
        if (_nrModalSelected < 0) return;
        sendToCS({ action: 'vrcRespondToNotification', notifId: n.id, responseSlot: _nrModalSelected });
    } else if (_nrModalTab === 'photo') {
        if (!_nrModalPhotoUrl || _nrModalSelected < 0) return;
        sendToCS({ action: 'vrcRespondToNotificationWithPhoto', notifId: n.id, responseSlot: _nrModalSelected, fileUrl: _nrModalPhotoUrl });
    }
    /* Optimistically drop the notification from the local list — the backend will
       hide it on success (or re-add via REST refresh on failure). */
    if (typeof notifications !== 'undefined') {
        notifications = notifications.filter(x => x.id !== n.id);
        if (typeof renderNotifications === 'function') renderNotifications(notifications);
    }
    closeNotifRespondModal();
}

function closeNotifRespondModal() {
    const el = window._nrModalEl;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity .15s';
    setTimeout(() => el.remove(), 150);
    window._nrModalEl = null;
}
