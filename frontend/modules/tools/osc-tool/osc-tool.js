// OSC Tool - live avatar parameter viewer and editor

let _oscBannerState = 'none';
let _oscLastNoOutputCount = 0;
let _oscLastOutputTotal = 0;
let _oscLastFilesUpdated = 0;
let _oscConnMode = 'idle';
let _oscEnableBtnMode = 'idle';
let _oscEmoteCooldownUntil = 0;
const OSC_EMOTE_COOLDOWN_MS = 2000;

function oscStatusNotConnectedText() {
    return t('osc.status.not_connected', 'Not connected');
}

function oscStatusConnectedHintText() {
    return t('osc.status.connected_hint', 'Connected | toggle OSC in VRChat to load params');
}

function oscStatusConnectedLoadedText(total) {
    return tf('osc.status.connected_loaded', { total }, `Connected | ${total} params loaded`);
}

function oscStatusConnectedLiveText(total, live) {
    return tf('osc.status.connected_live', { total, live }, `Connected | ${total} params (${live} live)`);
}

function oscConnectBtnHtml() {
    return `<span class="msi" style="font-size:16px;">link</span> ${esc(t('common.connect', 'Connect'))}`;
}

function oscDisconnectBtnHtml() {
    return `<span class="msi" style="font-size:16px;">link_off</span> ${esc(t('common.disconnect', 'Disconnect'))}`;
}

function oscConnectingBtnHtml() {
    return `<span class="msi" style="font-size:16px;">hourglass_empty</span> ${esc(t('osc.status.connecting', 'Connecting...'))}`;
}

function oscEnableOutputsBtnHtml() {
    return `<span class="msi" style="font-size:14px;">output</span> ${esc(t('osc.outputs.enable_all', 'Enable All Outputs'))}`;
}

function oscUpdatingOutputsBtnHtml() {
    return esc(t('osc.outputs.updating', 'Updating...'));
}

function oscDoneOutputsBtnHtml() {
    return `<span class="msi" style="font-size:14px;">check</span> ${esc(t('osc.outputs.done', 'Done'))}`;
}

function oscBannerMissingText(missing, total) {
    return tf('osc.outputs.missing', { missing, total }, `${missing} of ${total} params have no OSC output | VRChat will not send live updates for them.`);
}

function oscBannerUpdatedText(count) {
    return tf('osc.outputs.updated_files', { count }, `Updated ${count} config file(s). Reload your avatar in VRChat to receive all params.`);
}

function oscBannerAlreadyEnabledText() {
    return t('osc.outputs.already_enabled', 'All parameters already have output enabled.');
}

function oscParamCountZeroText() {
    return t('osc.parameters.count.zero', '0 params');
}

function oscParamCountLoadedText(total) {
    return tf('osc.parameters.count.loaded', { total }, `${total} params`);
}

function oscParamCountLiveText(total, live) {
    return tf('osc.parameters.count.live', { total, live }, `${total} params (${live} live)`);
}

function oscEmptyConnectHintHtml() {
    return `<div class="osc-empty" id="oscEmptyMsg">${esc(t('osc.empty.connect_hint', "Connect, then toggle OSC off/on in VRChat's Action Menu to load all parameters."))}</div>`;
}

function oscEmptyNoParamsHtml() {
    return `<div class="osc-empty" id="oscEmptyMsg">${esc(t('osc.empty.no_params', 'No parameters received yet.'))}<br>${esc(t('osc.empty.no_params_hint', 'Connect and load your avatar in VRChat.'))}</div>`;
}

function oscEmptyNoMatchHtml() {
    return `<div class="osc-empty" id="oscEmptyMsg">${esc(t('osc.empty.no_match', 'No parameters match your search.'))}</div>`;
}

function oscCurrentSearch() {
    return (document.getElementById('oscSearch')?.value || '').toLowerCase();
}

function oscUpdateStatusText(total, live) {
    const txt = document.getElementById('oscStatusText');
    if (!txt) return;

    if (!oscConnected) {
        txt.textContent = oscStatusNotConnectedText();
        return;
    }

    if (live > 0) txt.textContent = oscStatusConnectedLiveText(total, live);
    else if (total > 0) txt.textContent = oscStatusConnectedLoadedText(total);
    else txt.textContent = oscStatusConnectedHintText();
}

function oscApplyConnectButton() {
    const btn = document.getElementById('oscConnBtn');
    if (!btn) return;

    if (_oscConnMode === 'connecting') {
        btn.disabled = true;
        btn.innerHTML = oscConnectingBtnHtml();
        return;
    }

    btn.disabled = false;
    btn.innerHTML = oscConnected ? oscDisconnectBtnHtml() : oscConnectBtnHtml();
}

function oscApplyEnableOutputsButton() {
    const btn = document.getElementById('oscEnableBtn');
    if (!btn) return;

    if (_oscEnableBtnMode === 'updating') {
        btn.disabled = true;
        btn.textContent = oscUpdatingOutputsBtnHtml();
        return;
    }

    if (_oscEnableBtnMode === 'done') {
        btn.disabled = false;
        btn.innerHTML = oscDoneOutputsBtnHtml();
        return;
    }

    btn.disabled = false;
    btn.innerHTML = oscEnableOutputsBtnHtml();
}

function oscApplyBannerText() {
    const banner = document.getElementById('oscOutputBanner');
    if (!banner) return;

    const text = banner.querySelector('.osc-banner-text');
    if (!text) return;

    if (_oscBannerState === 'missing' && _oscLastNoOutputCount > 0) {
        banner.style.display = '';
        text.textContent = oscBannerMissingText(_oscLastNoOutputCount, _oscLastOutputTotal);
        return;
    }

    if (_oscBannerState === 'updated') {
        banner.style.display = '';
        text.textContent = oscBannerUpdatedText(_oscLastFilesUpdated);
        return;
    }

    if (_oscBannerState === 'enabled') {
        banner.style.display = '';
        text.textContent = oscBannerAlreadyEnabledText();
        return;
    }

    banner.style.display = 'none';
}

function oscConnect() {
    if (oscConnected) {
        sendToCS({ action: 'oscDisconnect' });
        return;
    }

    _oscConnMode = 'connecting';
    oscApplyConnectButton();
    sendToCS({ action: 'oscConnect' });
}

function handleOscState(data) {
    oscConnected = !!data.connected;
    _oscConnMode = 'idle';

    const dot = document.getElementById('oscDot');
    if (dot) dot.className = `sf-dot ${oscConnected ? 'online' : 'offline'}`;

    const total = Object.keys(oscParams).length;
    const live = Object.values(oscParams).filter(p => p.live).length;
    oscUpdateStatusText(total, live);
    oscApplyConnectButton();
    _oscUpdateActionControls();

    if (!oscConnected) {
        oscParams = {};
        _oscBannerState = 'none';
        _oscLastNoOutputCount = 0;
        _oscLastOutputTotal = 0;
        _oscLastFilesUpdated = 0;
        _oscEnableBtnMode = 'idle';
        renderOscParams('');
        oscApplyBannerText();
        oscApplyEnableOutputsButton();
    }
}

// Called when VRChat sends /avatar/change. C# reads config and sends full param list.
function handleOscAvatarParams(data) {
    const { paramList } = data;
    oscParams = {};

    for (const p of (paramList || [])) {
        const defaultVal = p.Type === 'bool' ? false : 0;
        oscParams[p.Name] = { value: defaultVal, type: p.Type, live: false, hasOutput: p.HasOutput };
    }

    const search = oscCurrentSearch();
    renderOscParams(search);

    const noOutput = (paramList || []).filter(p => !p.HasOutput).length;
    _updateOutputBanner(noOutput, (paramList || []).length);

    const total = Object.keys(oscParams).length;
    const live = Object.values(oscParams).filter(p => p.live).length;
    oscUpdateStatusText(total, live);
}

function _updateOutputBanner(noOutputCount, total) {
    _oscLastNoOutputCount = noOutputCount;
    _oscLastOutputTotal = total;
    _oscLastFilesUpdated = 0;
    _oscBannerState = noOutputCount > 0 ? 'missing' : 'none';
    oscApplyBannerText();
}

function oscEnableOutputs() {
    _oscEnableBtnMode = 'updating';
    oscApplyEnableOutputsButton();
    sendToCS({ action: 'oscEnableOutputs' });
}

function handleOscOutputsEnabled(data) {
    const count = data.filesUpdated || 0;
    _oscLastFilesUpdated = count;
    _oscBannerState = count > 0 ? 'updated' : 'enabled';
    _oscEnableBtnMode = 'done';
    oscApplyEnableOutputsButton();
    oscApplyBannerText();

    setTimeout(() => {
        _oscEnableBtnMode = 'idle';
        oscApplyEnableOutputsButton();
    }, 3000);
}

function handleOscParam(data) {
    const { name, value, type } = data;
    if (name === '/avatar/eyeheight' && type === 'float') _oscSyncHeightControls(parseFloat(value));
    const wasNew = !oscParams[name];
    oscParams[name] = { value, type, live: true, hasOutput: true };

    const search = oscCurrentSearch();
    const visible = !search || name.toLowerCase().includes(search);
    if (!visible) {
        _updateOscParamCount();
        oscUpdateStatusText(Object.keys(oscParams).length, Object.values(oscParams).filter(p => p.live).length);
        return;
    }

    const empty = document.getElementById('oscEmptyMsg');
    if (empty) empty.remove();

    const row = document.querySelector(`[data-osc-param="${CSS.escape(name)}"]`);
    if (row) {
        if (row.classList.contains('osc-row-pending')) row.classList.remove('osc-row-pending');
        _updateOscParamRowEl(row, name, type, value);
    } else if (wasNew) {
        _insertOscParamRow(name, type, value, true);
    }

    _updateOscParamCount();
    oscUpdateStatusText(Object.keys(oscParams).length, Object.values(oscParams).filter(p => p.live).length);
}

function _updateOscParamRowEl(row, name, type, value) {
    const activeEl = document.activeElement;
    if (row.contains(activeEl)) return;

    const readonly = row.querySelector('.osc-readonly-val');
    if (readonly) {
        readonly.textContent = type === 'bool' ? (value ? 'true' : 'false') : (parseFloat(value) || 0).toFixed(4);
        return;
    }

    if (type === 'bool') {
        const inp = row.querySelector('input[type="checkbox"]');
        if (inp) inp.checked = !!value;
    } else if (type === 'float') {
        const slider = row.querySelector('.osc-float-slider');
        const num = row.querySelector('.osc-float-num');
        const v = parseFloat(value) || 0;
        if (slider) slider.value = v;
        if (num) num.value = v.toFixed(3);
    } else if (type === 'int') {
        const inp = row.querySelector('.osc-int-inp');
        if (inp) inp.value = parseInt(value) || 0;
    }
}

function _insertOscParamRow(name, type, value, live) {
    const list = document.getElementById('oscParamList');
    if (!list) return;

    const html = _oscRowHtml(name, type, value, live);
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const newRow = tmp.firstElementChild;
    if (!newRow) return;

    const rows = list.querySelectorAll('[data-osc-param]');
    let inserted = false;
    for (const row of rows) {
        if (row.getAttribute('data-osc-param').localeCompare(name) > 0) {
            list.insertBefore(newRow, row);
            inserted = true;
            break;
        }
    }
    if (!inserted) list.appendChild(newRow);
}

function _oscRowHtml(name, type, value, live) {
    const escName = esc(name);
    const jsName = jsq(name);
    const badgeClass = `osc-${type}`;
    const pendingClass = live ? '' : ' osc-row-pending';

    const isSystemParam = name.startsWith('/avatar/') && !name.startsWith('/avatar/parameters/');

    let ctrl = '';
    if (isSystemParam && type === 'float') {
        const v = (parseFloat(value) || 0).toFixed(4);
        ctrl = `<input type="number" class="osc-float-num" min="0.01" max="10000" step="0.01" value="${v}"
            onchange="oscSetParam('${jsName}','float',parseFloat(this.value)||0)">`;
    } else if (type === 'bool') {
        const checked = value ? 'checked' : '';
        ctrl = `<label class="toggle osc-toggle">
            <input type="checkbox" ${checked} onchange="oscSetParam('${jsName}','bool',this.checked)">
            <div class="toggle-track"><div class="toggle-knob"></div></div>
        </label>`;
    } else if (type === 'float') {
        const v = (parseFloat(value) || 0).toFixed(3);
        ctrl = `<div class="osc-float-wrap">
            <input type="range" class="osc-float-slider" min="-1" max="1" step="0.001" value="${v}"
                oninput="this.closest('.osc-float-wrap').querySelector('.osc-float-num').value=parseFloat(this.value).toFixed(3);oscSetParam('${jsName}','float',parseFloat(this.value))">
            <input type="number" class="osc-float-num" min="-1" max="1" step="0.001" value="${v}"
                oninput="this.closest('.osc-float-wrap').querySelector('.osc-float-slider').value=this.value;oscSetParam('${jsName}','float',parseFloat(this.value))">
        </div>`;
    } else if (type === 'int') {
        const v = parseInt(value) || 0;
        ctrl = `<input type="number" class="osc-int-inp" min="0" max="255" step="1" value="${v}"
            onchange="oscSetParam('${jsName}','int',parseInt(this.value)||0)">`;
    }

    return `<div class="osc-row${pendingClass}" data-osc-param="${escName}">
        <div class="osc-row-left">
            <span class="vrcn-badge ${badgeClass}">${type.toUpperCase()}</span>
            <span class="osc-param-name" title="${escName}">${escName}</span>
        </div>
        <div class="osc-ctrl">${ctrl}</div>
    </div>`;
}

function filterOscParams() {
    renderOscParams(oscCurrentSearch());
}

function renderOscParams(search) {
    const list = document.getElementById('oscParamList');
    if (!list) return;

    list.innerHTML = '';

    const keys = Object.keys(oscParams).sort((a, b) => a.localeCompare(b));
    const filtered = search ? keys.filter(k => k.toLowerCase().includes(search)) : keys;

    if (filtered.length === 0) {
        if (keys.length === 0) {
            list.innerHTML = oscConnected ? oscEmptyNoParamsHtml() : oscEmptyConnectHintHtml();
        } else {
            list.innerHTML = oscEmptyNoMatchHtml();
        }
    } else {
        const frag = document.createDocumentFragment();
        for (const name of filtered) {
            const { value, type, live } = oscParams[name];
            const tmp = document.createElement('div');
            tmp.innerHTML = _oscRowHtml(name, type, value, live);
            if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
        }
        list.appendChild(frag);
    }

    _updateOscParamCount();
}

function _updateOscParamCount() {
    const total = Object.keys(oscParams).length;
    const live = Object.values(oscParams).filter(p => p.live).length;
    const el = document.getElementById('oscParamCount');
    if (!el) return;

    if (total === 0) {
        el.textContent = oscParamCountZeroText();
        return;
    }

    el.textContent = live < total
        ? oscParamCountLiveText(total, live)
        : oscParamCountLoadedText(total);
}

function oscSetParam(name, type, value) {
    if (!oscConnected) return;
    if (name.startsWith('/avatar/') && !name.startsWith('/avatar/parameters/')) {
        if (type === 'float') value = parseFloat(value) || 0;
        if (type === 'bool') value = !!value;
        if (oscParams[name]) oscParams[name].value = value;
        sendToCS({ action: 'oscSendRaw', address: name, type, value });
        return;
    }
    if (type === 'float') value = Math.max(-1, Math.min(1, parseFloat(value) || 0));
    if (type === 'int') value = Math.max(0, Math.min(255, parseInt(value) || 0));
    if (oscParams[name]) oscParams[name].value = value;
    sendToCS({ action: 'oscSend', name, type, value });
}

function oscTriggerEmote(n) {
    if (!oscConnected) return;
    if (Date.now() < _oscEmoteCooldownUntil) return;
    _oscEmoteCooldownUntil = Date.now() + OSC_EMOTE_COOLDOWN_MS;
    sendToCS({ action: 'oscTriggerEmote', emote: n });
    _oscUpdateActionControls();
    setTimeout(_oscUpdateActionControls, OSC_EMOTE_COOLDOWN_MS);
}

function _oscUpdateActionControls() {
    const emoteDisabled = !oscConnected || Date.now() < _oscEmoteCooldownUntil;
    document.querySelectorAll('.osc-emote-btn').forEach(b => b.disabled = emoteDisabled);

    const heightSlider = document.getElementById('oscHeightSlider');
    const heightNum = document.getElementById('oscHeightNum');
    const heightApplyBtn = document.getElementById('oscHeightApplyBtn');
    if (heightSlider) heightSlider.disabled = !oscConnected;
    if (heightNum) heightNum.disabled = !oscConnected;
    if (heightApplyBtn) heightApplyBtn.disabled = !oscConnected;
}

function oscHeightSet(value) {
    if (!oscConnected) return;
    let v = parseFloat(value);
    if (isNaN(v)) return;
    v = Math.max(0.01, Math.min(10000, v));
    sendToCS({ action: 'oscSendRaw', address: '/avatar/eyeheight', type: 'float', value: v });
}

// Explicit apply from the text box (Enter key or the check button) — deliberately not sent on
// every keystroke like the slider is, so a half-typed number never gets sent mid-edit.
function oscHeightApply() {
    if (!oscConnected) return;
    const num = document.getElementById('oscHeightNum');
    if (!num) return;
    const v = parseFloat(num.value);
    if (isNaN(v)) return;
    oscHeightSet(v);
    const slider = document.getElementById('oscHeightSlider');
    const label = document.getElementById('oscHeightVal');
    if (slider) slider.value = Math.max(0.2, Math.min(5, v));
    if (label) label.textContent = v.toFixed(2) + ' m';
}

function _oscSyncHeightControls(v) {
    if (isNaN(v)) return;
    const slider = document.getElementById('oscHeightSlider');
    const num = document.getElementById('oscHeightNum');
    const label = document.getElementById('oscHeightVal');
    if (slider) slider.value = Math.max(0.2, Math.min(5, v));
    if (label) label.textContent = v.toFixed(2) + ' m';
    if (num && document.activeElement !== num) num.value = v.toFixed(2);
}

function rerenderOscTranslations() {
    oscUpdateStatusText(Object.keys(oscParams).length, Object.values(oscParams).filter(p => p.live).length);
    oscApplyConnectButton();
    oscApplyEnableOutputsButton();
    oscApplyBannerText();
    renderOscParams(oscCurrentSearch());
}

document.documentElement.addEventListener('languagechange', rerenderOscTranslations);
