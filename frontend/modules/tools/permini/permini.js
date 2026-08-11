// Permini.n// Permanent mini-invite list: selected friends can auto-receive an invite when
// they send a requestInvite and the local user's status matches their settings.

let perminiList = []; // [{ userId, allowActive, allowAskMe, allowDnD, scheduleEnabled, start, end, days }]
const _pmExpanded = new Set();

const PM_DAYS = [
    { iso: 1, i18n: 'timeline.datepicker.weekday.mon', fallback: 'Mo' },
    { iso: 2, i18n: 'timeline.datepicker.weekday.tue', fallback: 'Tu' },
    { iso: 3, i18n: 'timeline.datepicker.weekday.wed', fallback: 'We' },
    { iso: 4, i18n: 'timeline.datepicker.weekday.thu', fallback: 'Th' },
    { iso: 5, i18n: 'timeline.datepicker.weekday.fri', fallback: 'Fr' },
    { iso: 6, i18n: 'timeline.datepicker.weekday.sat', fallback: 'Sa' },
    { iso: 7, i18n: 'timeline.datepicker.weekday.sun', fallback: 'Su' },
];

// Data.

function onPerminiData(list) {
    perminiList = Array.isArray(list) ? list : [];
    renderPerminiList();
}

function savePermini() {
    sendToCS({ action: 'perminiSave', list: perminiList });
}

// Render main list.

function renderPerminiList() {
    const el = document.getElementById('pmList');
    if (!el) return;

    if (!perminiList.length) {
        el.innerHTML = `<div class="empty-msg">${t('permini.empty')}</div>`;
        return;
    }

    el.innerHTML = perminiList.map(e => {
        const friend = (vrcFriendsData || []).find(f => f.id === e.userId) || {};
        const img    = friend.image || '';
        const name   = friend.displayName || e.userId;
        const uid    = jsq(e.userId);

        const av = img
            ? `<img class="pm-avatar" src="${esc(img)}" onerror="this.outerHTML='<div class=\\'pm-avatar pm-avatar-fallback\\'>${esc((name||'?')[0].toUpperCase())}</div>'">`
            : `<div class="pm-avatar pm-avatar-fallback">${esc((name || '?')[0].toUpperCase())}</div>`;

        const collapsed = _pmExpanded.has(e.userId) ? '' : ' collapsed';

        return `<div class="vrcn-panel-card pm-item${collapsed}" id="pm-entry-${uid}">
            <div class="pm-entry">
            ${av}
            <div class="pm-info">
                <div class="pm-name">${esc(name)}</div>
                <div class="pm-toggles">
                    <label class="pm-toggle-label" title="${esc(t('permini.toggle.active_title'))}">
                        <label class="toggle"><input type="checkbox" ${e.allowActive ? 'checked' : ''} onchange="perminiToggle('${uid}','allowActive',this.checked)"><div class="toggle-track"><div class="toggle-knob"></div></div></label>
                        <span class="pm-status-dot" style="background:var(--status-online);"></span>
                        <span>${t('permini.toggle.active')}</span>
                    </label>
                    <label class="pm-toggle-label" title="${esc(t('permini.toggle.askme_title'))}">
                        <label class="toggle"><input type="checkbox" ${e.allowAskMe ? 'checked' : ''} onchange="perminiToggle('${uid}','allowAskMe',this.checked)"><div class="toggle-track"><div class="toggle-knob"></div></div></label>
                        <span class="pm-status-dot" style="background:var(--status-ask);"></span>
                        <span>${t('permini.toggle.askme')}</span>
                    </label>
                    <label class="pm-toggle-label" title="${esc(t('permini.toggle.dnd_title'))}">
                        <label class="toggle"><input type="checkbox" ${e.allowDnD ? 'checked' : ''} onchange="perminiToggle('${uid}','allowDnD',this.checked)"><div class="toggle-track"><div class="toggle-knob"></div></div></label>
                        <span class="pm-status-dot" style="background:var(--status-busy);"></span>
                        <span>${t('permini.toggle.dnd')}</span>
                    </label>
                </div>
            </div>
            <button class="pm-expand" onclick="perminiToggleExpand('${uid}', this)" title="${esc(t('permini.advanced.title', 'Advanced'))}">
                <span class="msi">expand_more</span>
            </button>
            <button class="pm-remove" onclick="removePerminiEntry('${uid}')" title="${esc(t('common.remove'))}">
                <span class="msi">close</span>
            </button>
            </div>
            <div class="vrcn-card-collapse-body">${perminiAdvancedHtml(e, uid)}</div>
        </div>`;
    }).join('');

    perminiList.forEach(e => {
        if (!e.scheduleEnabled) return;
        const uid = e.userId;
        timeFieldRender(document.getElementById('pmStart-' + cssq(uid)), e.start || '09:00',
            hhmm => { e.start = hhmm; savePermini(); });
        timeFieldRender(document.getElementById('pmEnd-' + cssq(uid)), e.end || '17:00',
            hhmm => { e.end = hhmm; savePermini(); });
    });
}

function cssq(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '_'); }

function perminiAdvancedHtml(e, uid) {
    const on   = !!e.scheduleEnabled;
    const days = Array.isArray(e.days) ? e.days : [];
    const dayBtns = PM_DAYS.map(d =>
        `<button type="button" class="pm-day${days.includes(d.iso) ? ' active' : ''}"${on ? '' : ' disabled'} onclick="perminiToggleDay('${uid}',${d.iso})">${esc(t(d.i18n, d.fallback))}</button>`
    ).join('');

    return `<div class="pm-advanced">
        <label class="pm-adv-row">
            <label class="toggle"><input type="checkbox" ${on ? 'checked' : ''} onchange="perminiToggle('${uid}','scheduleEnabled',this.checked)"><div class="toggle-track"><div class="toggle-knob"></div></div></label>
            <span>${esc(t('permini.advanced.only_between', 'Only accept during a time window'))}</span>
        </label>
        <div class="pm-adv-body${on ? '' : ' pm-adv-off'}">
            <div class="pm-adv-label">${esc(t('permini.advanced.days', 'Days'))}</div>
            <div class="pm-days">${dayBtns}</div>
            <div class="pm-adv-label">${esc(t('permini.advanced.between', 'Between'))}</div>
            <div class="pm-time-row">
                <div id="pmStart-${cssq(uid)}" class="ss-time-wrap"></div>
                <span class="pm-time-dash">–</span>
                <div id="pmEnd-${cssq(uid)}" class="ss-time-wrap"></div>
            </div>
        </div>
    </div>`;
}

function perminiToggleExpand(userId, btn) {
    if (_pmExpanded.has(userId)) _pmExpanded.delete(userId);
    else _pmExpanded.add(userId);
    vrcnToggleCollapse(btn);
}

function perminiToggleDay(userId, iso) {
    const entry = perminiList.find(e => e.userId === userId);
    if (!entry || !entry.scheduleEnabled) return;
    const days = Array.isArray(entry.days) ? entry.days.slice() : [];
    const i = days.indexOf(iso);
    if (i >= 0) days.splice(i, 1); else days.push(iso);
    days.sort((a, b) => a - b);
    entry.days = days;
    savePermini();
    renderPerminiList();
}

// Toggle a setting for a single entry.

function perminiToggle(userId, field, val) {
    const entry = perminiList.find(e => e.userId === userId);
    if (!entry) return;
    entry[field] = val;
    savePermini();
    if (field === 'scheduleEnabled') renderPerminiList();
}

// Remove an entry.

function removePerminiEntry(userId) {
    perminiList = perminiList.filter(e => e.userId !== userId);
    savePermini();
    renderPerminiList();
}

// Friend picker modal.

// Add entry from picker.

function openPerminiPicker() {
    openFriendPicker({
        title: t('permini.picker.title', 'Add Friend to Permini'),
        exclude: perminiList.map(e => e.userId),
        emptyText: t('permini.picker.empty', 'No friends available.'),
        onPick: addPerminiEntry,
    });
}

function addPerminiEntry(userId) {
    if (perminiList.find(e => e.userId === userId)) return;
    perminiList.push({
        userId, allowActive: false, allowAskMe: true, allowDnD: false,
        scheduleEnabled: false, start: '09:00', end: '17:00', days: [],
    });
    savePermini();
    renderPerminiList();
}

// Called when tab is opened.

function onPerminiTabOpen() {
    sendToCS({ action: 'perminiGet' });
}
