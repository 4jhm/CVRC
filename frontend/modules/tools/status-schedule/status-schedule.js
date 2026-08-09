/* === Status Schedule === */

let ssRules          = [];
let ssEnabledState   = true;
let ssSelectedRuleId = null;
let ssActiveRuleId   = null;
let ssLoaded         = false;

const SS_DAYS = [
    { iso: 1, i18n: 'timeline.datepicker.weekday.mon', fallback: 'Mo' },
    { iso: 2, i18n: 'timeline.datepicker.weekday.tue', fallback: 'Tu' },
    { iso: 3, i18n: 'timeline.datepicker.weekday.wed', fallback: 'We' },
    { iso: 4, i18n: 'timeline.datepicker.weekday.thu', fallback: 'Th' },
    { iso: 5, i18n: 'timeline.datepicker.weekday.fri', fallback: 'Fr' },
    { iso: 6, i18n: 'timeline.datepicker.weekday.sat', fallback: 'Sa' },
    { iso: 7, i18n: 'timeline.datepicker.weekday.sun', fallback: 'Su' },
];

const SS_STATUS_OPTIONS = [
    { value: 'join me', i18n: 'status.join_me',        fallback: 'Join Me',        color: 'var(--status-join)' },
    { value: 'active',  i18n: 'status.online',         fallback: 'Online',         color: 'var(--status-online)' },
    { value: 'ask me',  i18n: 'status.ask_me',         fallback: 'Ask Me',         color: 'var(--status-ask)' },
    { value: 'busy',    i18n: 'status.do_not_disturb', fallback: 'Do Not Disturb', color: 'var(--status-busy)' },
];

function sst(key, fallback) {
    return (typeof t === 'function') ? t(key, fallback) : fallback;
}

// Renders a stored "HH:MM" through the shared time formatter so it follows the
// user's 12h/24h preference instead of inventing a second format.
function ssFmtTime(hhmm) {
    const parts = String(hhmm || '').split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return hhmm || '';
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return (typeof fmtTime === 'function') ? fmtTime(d) : hhmm;
}

function ssStatusMeta(value) {
    return SS_STATUS_OPTIONS.find(o => o.value === value) || SS_STATUS_OPTIONS[1];
}

// Builds a <select> and runs it through the shared vn-select enhancer so it looks
// like every other dropdown in the app.
function ssBuildSelect(host, options, selected, onChange) {
    if (!host) return;
    host.innerHTML = '';
    const sel = document.createElement('select');
    sel.className = 'vrcn-dropdown';
    options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = String(o.value);
        opt.textContent = o.label;
        if (String(o.value) === String(selected)) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    host.appendChild(sel);
    if (typeof initVnSelect === 'function') initVnSelect(sel);
}

function ssHourLabel(h) {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    if (typeof _dtIs24Hour !== 'undefined' && !_dtIs24Hour) {
        const meridiem = h >= 12 ? 'PM' : 'AM';
        return String(h % 12 || 12) + ' ' + meridiem;
    }
    return String(h).padStart(2, '0');
}

function ssSplitTime(hhmm) {
    const parts = String(hhmm || '').split(':');
    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    return [Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m))];
}

function ssJoinTime(h, m) {
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Hour + minute dropdowns rather than a native time input, so the control matches
// the rest of the app. Minutes step by 5.
function ssRenderTimeField(hostId, field, value) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';
    const [h, m] = ssSplitTime(value);

    const hourHost = document.createElement('div');
    const minHost  = document.createElement('div');
    hourHost.className = 'ss-time-part';
    minHost.className  = 'ss-time-part';
    host.appendChild(hourHost);
    const sep = document.createElement('span');
    sep.className = 'ss-time-sep';
    sep.textContent = ':';
    host.appendChild(sep);
    host.appendChild(minHost);

    const hours = [];
    for (let i = 0; i < 24; i++) hours.push({ value: i, label: ssHourLabel(i) });
    const minutes = [];
    for (let i = 0; i < 60; i += 5) minutes.push({ value: i, label: String(i).padStart(2, '0') });
    if (m % 5 !== 0) minutes.push({ value: m, label: String(m).padStart(2, '0') });
    minutes.sort((a, b) => a.value - b.value);

    ssBuildSelect(hourHost, hours, h, v => {
        const rule = ssSelectedRule();
        if (!rule) return;
        ssUpdateField(field, ssJoinTime(parseInt(v, 10), ssSplitTime(rule[field])[1]));
    });
    ssBuildSelect(minHost, minutes, m, v => {
        const rule = ssSelectedRule();
        if (!rule) return;
        ssUpdateField(field, ssJoinTime(ssSplitTime(rule[field])[0], parseInt(v, 10)));
    });
}

function ssSelectedRule() {
    return ssRules.find(r => r.id === ssSelectedRuleId) || null;
}

function onStatusScheduleTabOpen() {
    if (!ssLoaded) sendToCS({ action: 'ssLoadRules' });
    else ssRenderAll();
}

// Incoming state

function ssOnRules(payload) {
    ssLoaded       = true;
    ssRules        = Array.isArray(payload?.rules) ? payload.rules : [];
    ssEnabledState = payload?.enabled !== false;
    ssActiveRuleId = payload?.activeRuleId || null;

    if (ssSelectedRuleId && !ssRules.some(r => r.id === ssSelectedRuleId)) ssSelectedRuleId = null;
    ssRenderAll();
}

function ssOnApplied(payload) {
    ssActiveRuleId = payload?.ruleId || null;
    ssRenderStatusBar();
    ssRenderList();
}

// Rendering

function ssRenderAll() {
    const enabledEl = document.getElementById('ssEnabled');
    if (enabledEl) enabledEl.checked = ssEnabledState;
    ssRenderStatusBar();
    ssRenderList();
    ssRenderEditor();
}

function ssRenderStatusBar() {
    const dot  = document.getElementById('ssDot');
    const text = document.getElementById('ssStatusText');
    if (!dot || !text) return;

    const active = ssRules.find(r => r.id === ssActiveRuleId);
    const on = ssEnabledState && !!active;
    dot.classList.toggle('offline', !on);
    dot.classList.toggle('online', on);

    if (!ssEnabledState)  text.textContent = sst('status_schedule.status.disabled', 'Disabled');
    else if (active)      text.textContent = active.name || sst('status_schedule.unnamed', 'Unnamed rule');
    else                  text.textContent = sst('status_schedule.status.idle', 'No rule active');
}

function ssRuleSummary(rule) {
    const days = (!rule.days || !rule.days.length)
        ? sst('status_schedule.every_day', 'Every day')
        : SS_DAYS.filter(d => rule.days.includes(d.iso)).map(d => sst(d.i18n, d.fallback)).join(' ');
    return `${ssFmtTime(rule.start)} – ${ssFmtTime(rule.end)} · ${days}`;
}

function ssRenderList() {
    const list = document.getElementById('ssRuleList');
    if (!list) return;

    if (!ssRules.length) {
        list.innerHTML = `<div class="ss-list-empty">${esc(sst('status_schedule.no_rules', 'No rules yet.'))}</div>`;
        return;
    }

    list.innerHTML = ssRules.map(rule => {
        const meta   = ssStatusMeta(rule.status);
        const isSel  = rule.id === ssSelectedRuleId;
        const isLive = rule.id === ssActiveRuleId && ssEnabledState;
        const off    = rule.enabled === false;
        return `
            <div class="ss-rule-item${isSel ? ' active' : ''}${off ? ' disabled' : ''}" onclick="ssSelectRule('${jsq(rule.id)}')">
                <span class="ss-rule-dot" style="background:${meta.color};"></span>
                <span class="ss-rule-main">
                    <span class="ss-rule-name">${esc(rule.name || sst('status_schedule.unnamed', 'Unnamed rule'))}</span>
                    <span class="ss-rule-sub">${esc(ssRuleSummary(rule))}</span>
                </span>
                ${isLive ? `<span class="ss-rule-live">${esc(sst('status_schedule.live', 'LIVE'))}</span>` : ''}
                <label class="toggle ss-rule-toggle" onclick="event.stopPropagation()" title="${esc(sst('status_schedule.enabled', 'Enabled'))}">
                    <input type="checkbox" ${off ? '' : 'checked'} onchange="ssToggleRuleEnabled('${jsq(rule.id)}', this.checked)">
                    <div class="toggle-track"><div class="toggle-knob"></div></div>
                </label>
            </div>`;
    }).join('');
}

function ssRenderEditor() {
    const empty  = document.getElementById('ssEditorEmpty');
    const editor = document.getElementById('ssEditor');
    const rule   = ssSelectedRule();
    if (!empty || !editor) return;

    empty.style.display  = rule ? 'none' : '';
    editor.style.display = rule ? '' : 'none';
    if (!rule) return;

    const set = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
    set('ssFieldName',       'value',   rule.name || '');
    set('ssFieldSetMessage', 'checked', !!rule.setStatusMessage);
    set('ssFieldMessage',    'value',   rule.statusMessage || '');
    set('ssFieldOnlyInGame',      'checked', !!rule.onlyWhileInGame);
    set('ssFieldOnlyOutsideGame', 'checked', !!rule.onlyWhileOutsideGame);
    set('ssFieldRestore',         'checked', rule.restorePreviousStatus !== false);

    const msgInput = document.getElementById('ssFieldMessage');
    if (msgInput) msgInput.style.display = rule.setStatusMessage ? '' : 'none';

    ssBuildSelect(
        document.getElementById('ssFieldPriorityWrap'),
        [
            { value: 700, label: sst('status_schedule.priority.high',   'High') },
            { value: 400, label: sst('status_schedule.priority.medium', 'Medium') },
            { value: 100, label: sst('status_schedule.priority.low',    'Low') },
        ],
        rule.priority ?? 400,
        v => ssUpdateField('priority', parseInt(v, 10)),
    );

    ssRenderTimeField('ssFieldStartWrap', 'start', rule.start || '09:00');
    ssRenderTimeField('ssFieldEndWrap',   'end',   rule.end   || '17:00');

    const note = document.getElementById('ssMidnightNote');
    if (note) note.style.display = ssCrossesMidnight(rule) ? '' : 'none';

    const days = document.getElementById('ssFieldDays');
    if (days) {
        const sel = Array.isArray(rule.days) ? rule.days : [];
        days.innerHTML = SS_DAYS.map(d =>
            `<button type="button" class="ss-day${sel.includes(d.iso) ? ' active' : ''}" onclick="ssToggleDay(${d.iso})">${esc(sst(d.i18n, d.fallback))}</button>`
        ).join('');
    }

    const status = document.getElementById('ssFieldStatus');
    if (status) {
        status.innerHTML = SS_STATUS_OPTIONS.map(o =>
            `<button type="button" class="ss-status-opt${rule.status === o.value ? ' active' : ''}" onclick="ssSetStatus('${jsq(o.value)}')">
                <span class="ss-rule-dot" style="background:${o.color};"></span>${esc(sst(o.i18n, o.fallback))}
            </button>`
        ).join('');
    }
}

function ssCrossesMidnight(rule) {
    const s = String(rule.start || '');
    const e = String(rule.end || '');
    if (!s || !e) return false;
    return e <= s;
}

// Mutations

function ssSelectRule(id) {
    ssSelectedRuleId = id;
    ssRenderList();
    ssRenderEditor();
}

function ssAddRule() {
    const rule = {
        id: 'rule_' + Math.random().toString(36).slice(2, 10),
        name: sst('status_schedule.default_rule_name', 'Scheduled status'),
        enabled: true,
        priority: 400,
        start: '09:00',
        end: '17:00',
        days: [],
        onlyWhileInGame: false,
        onlyWhileOutsideGame: false,
        restorePreviousStatus: true,
        status: 'active',
        setStatusMessage: false,
        statusMessage: '',
    };
    ssRules.push(rule);
    ssSelectedRuleId = rule.id;
    ssRenderList();
    ssRenderEditor();
}

function ssDeleteRule() {
    const rule = ssSelectedRule();
    if (!rule) return;
    ssRules = ssRules.filter(r => r.id !== rule.id);
    ssSelectedRuleId = null;
    ssRenderList();
    ssRenderEditor();
    ssSaveRules();
}

function ssUpdateField(key, value) {
    const rule = ssSelectedRule();
    if (!rule) return;
    rule[key] = value;

    // The two game-state filters are mutually exclusive; switching one on clears the
    // other. Both off means the rule applies whether VRChat runs or not.
    if (key === 'onlyWhileInGame' || key === 'onlyWhileOutsideGame') {
        const other = key === 'onlyWhileInGame' ? 'onlyWhileOutsideGame' : 'onlyWhileInGame';
        if (value) rule[other] = false;
        const otherEl = document.getElementById(
            other === 'onlyWhileInGame' ? 'ssFieldOnlyInGame' : 'ssFieldOnlyOutsideGame');
        if (otherEl) otherEl.checked = !!rule[other];
    }

    if (key === 'setStatusMessage') {
        const msgInput = document.getElementById('ssFieldMessage');
        if (msgInput) msgInput.style.display = value ? '' : 'none';
    }
    if (key === 'start' || key === 'end') {
        const note = document.getElementById('ssMidnightNote');
        if (note) note.style.display = ssCrossesMidnight(rule) ? '' : 'none';
    }
    ssRenderList();
}

function ssToggleDay(iso) {
    const rule = ssSelectedRule();
    if (!rule) return;
    const days = Array.isArray(rule.days) ? rule.days.slice() : [];
    const idx = days.indexOf(iso);
    if (idx >= 0) days.splice(idx, 1);
    else days.push(iso);
    days.sort((a, b) => a - b);
    rule.days = days;
    ssRenderEditor();
    ssRenderList();
}

// Applies immediately, same as deleting a rule - a per-rule switch that needs a
// separate Save press would be easy to lose track of.
function ssToggleRuleEnabled(id, on) {
    const rule = ssRules.find(r => r.id === id);
    if (!rule) return;
    rule.enabled = !!on;
    ssRenderList();
    ssSaveRules();
}

function ssSetStatus(value) {
    const rule = ssSelectedRule();
    if (!rule) return;
    rule.status = value;
    ssRenderEditor();
    ssRenderList();
}

function ssSetEnabled(on) {
    ssEnabledState = !!on;
    sendToCS({ action: 'ssSetEnabled', enabled: ssEnabledState });
    ssRenderStatusBar();
}

function ssSaveRules() {
    sendToCS({ action: 'ssSaveRules', rules: ssRules });
}

function ssOnSaveResult(payload) {
    if (typeof showToast !== 'function') return;
    if (payload?.ok) showToast(true, sst('status_schedule.toast.saved', 'Rules saved'));
    else showToast(false, sst('status_schedule.toast.save_failed', 'Failed to save rules') + (payload?.error ? ': ' + payload.error : ''));
}

window.onStatusScheduleTabOpen = onStatusScheduleTabOpen;
window.ssSelectRule  = ssSelectRule;
window.ssAddRule     = ssAddRule;
window.ssDeleteRule  = ssDeleteRule;
window.ssUpdateField = ssUpdateField;
window.ssToggleDay   = ssToggleDay;
window.ssSetStatus   = ssSetStatus;
window.ssToggleRuleEnabled = ssToggleRuleEnabled;
window.ssSetEnabled  = ssSetEnabled;
window.ssSaveRules   = ssSaveRules;
