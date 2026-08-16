/* FrameShot */

let _fsLastState = null;

let _fsKeybindMode = 'frame';
const FS_MODE_SELECTS = {
    frame: { left: 'fsLeftButton', right: 'fsRightButton', allowNone: false },
    gif:   { left: 'fsLeftRecord', right: 'fsRightRecord', allowNone: true  },
    video: { left: 'fsLeftVideo',  right: 'fsRightVideo',  allowNone: true  },
};

const FS_BTN_IDS = ['fsLeftButton', 'fsRightButton', 'fsLeftRecord', 'fsRightRecord', 'fsLeftVideo', 'fsRightVideo'];
const FS_BTN_DEFAULTS = { fsLeftButton: 2, fsRightButton: 2, fsLeftRecord: 0, fsRightRecord: 0, fsLeftVideo: 0, fsRightVideo: 0 };

let _fsOtherBtns   = {};
let _fsPendingBtns = null;

function fsReadBtns() {
    const o = {};
    FS_BTN_IDS.forEach(id => {
        o[id] = parseInt(document.getElementById(id)?.value ?? String(FS_BTN_DEFAULTS[id]), 10) || 0;
    });
    return o;
}

function fsWriteBtns(vals) {
    FS_BTN_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const v = String(vals?.[id] ?? 0);
        el.value = el.querySelector(`option[value="${v}"]`) ? v : (el.options[0]?.value ?? '0');
        if (el._vnRefresh) el._vnRefresh();
    });
}

function fsSwapButtonSets() {
    const cur = fsReadBtns();
    _fsPendingBtns = _fsOtherBtns;
    _fsOtherBtns   = cur;
}

function fsApplyInputMode() {
    if (_fsPendingBtns) { fsWriteBtns(_fsPendingBtns); _fsPendingBtns = null; }
    fsRenderKeybind();
    fsSendConfig();
}


function fsSetMode(mode) {
    if (!FS_MODE_SELECTS[mode]) return;
    _fsKeybindMode = mode;
    fsRenderKeybind();
}

function fsRenderKeybind() {
    const pills = { frame: 'fsModeFrame', gif: 'fsModeGif', video: 'fsModeVideo' };
    for (const [m, id] of Object.entries(pills)) {
        document.getElementById(id)?.classList.toggle('active', m === _fsKeybindMode);
    }

    const map = FS_MODE_SELECTS[_fsKeybindMode];
    const leftVal  = parseInt(document.getElementById(map.left)?.value  ?? '0', 10);
    const rightVal = parseInt(document.getElementById(map.right)?.value ?? '0', 10);

    document.querySelectorAll('#fsControllerVisual .vro-btn').forEach(el => {
        const want = el.dataset.side === 'left' ? leftVal : rightVal;
        vriMarkBtn(el, want !== 0 ? [want] : [], 'data-fs-btn-id', true);
    });
}

function fsKeybindClick(el) {
    const side = el.dataset.side;
    const map  = FS_MODE_SELECTS[_fsKeybindMode];
    const sel  = document.getElementById(side === 'left' ? map.left : map.right);
    if (!sel) return;

    vriZoneClick(el, 'data-fs-btn-id', [parseInt(sel.value, 10) || 0], id => {
        const cur = parseInt(sel.value, 10);
        sel.value = (map.allowNone && cur === id) ? '0' : String(id);
        if (sel._vnRefresh) sel._vnRefresh();
        fsRenderKeybind();
        fsAutoSave();
    });
}

let _fsLegacyView = false;
function fsToggleView(btn) {
    _fsLegacyView = !_fsLegacyView;
    const vis  = document.getElementById('fsControllerVisual');
    const pill = document.getElementById('fsKeybindPills');
    const leg  = document.getElementById('fsLegacyView');
    if (vis)  vis.style.display  = _fsLegacyView ? 'none' : '';
    if (pill) pill.style.display = _fsLegacyView ? 'none' : '';
    if (leg)  leg.style.display  = _fsLegacyView ? '' : 'none';
    btn?.classList.toggle('active', _fsLegacyView);
}

function fsConnectBtnHtml() {
    return `<span class="msi" style="font-size:16px;">link</span> ${esc(t('common.connect', 'Connect'))}`;
}

function fsDisconnectBtnHtml() {
    return `<span class="msi" style="font-size:16px;">link_off</span> ${esc(t('common.disconnect', 'Disconnect'))}`;
}

function fsStatusText(state) {
    if (!state?.connected) return state?.error || t('frameshot.status.not_connected', 'Not Connected');
    return state.framing
        ? t('frameshot.status.framing', 'Framing...')
        : t('frameshot.status.connected', 'Connected');
}

function fsConnect() {
    if (fsConnected) {
        sendToCS({ action: 'fsDisconnect' });
    } else {
        sendToCS({ action: 'fsConnect' });
        fsSendConfig();
    }
}

function fsSendConfig() {
    sendToCS({
        action: 'fsConfig',
        leftButton:        parseInt(document.getElementById('fsLeftButton')?.value        ?? '2',  10),
        rightButton:       parseInt(document.getElementById('fsRightButton')?.value       ?? '2',  10),
        leftRecordButton:  parseInt(document.getElementById('fsLeftRecord')?.value        ?? '0',  10),
        rightRecordButton: parseInt(document.getElementById('fsRightRecord')?.value       ?? '0',  10),
        activationRadius:  parseInt(document.getElementById('fsActivationRadius')?.value  ?? '15', 10),
        gifMaxResolution:  parseInt(document.getElementById('fsGifMaxResolution')?.value  ?? '512', 10),
        gifMaxFps:         parseInt(document.getElementById('fsGifMaxFps')?.value         ?? '10', 10),
        useHmdRotations:   !!document.getElementById('fsUseHmdRotations')?.checked,
        leftVideoButton:   parseInt(document.getElementById('fsLeftVideo')?.value         ?? '0', 10),
        rightVideoButton:  parseInt(document.getElementById('fsRightVideo')?.value        ?? '0', 10),
        videoDeviceA:      fsCurrentVideoDeviceA(),
        videoDeviceB:      fsCurrentVideoDeviceB(),
        videoFps:          parseInt(document.getElementById('fsVideoFps')?.value           ?? '30', 10),
        videoQuality:      document.getElementById('fsVideoQuality')?.value               ?? '1080p',
        videoBitrateQuality: document.getElementById('fsVideoBitrateQuality')?.value      ?? 'medium',
        audioKbps:         parseInt(document.getElementById('fsAudioKbps')?.value         ?? '256', 10),
    });
}

let _fsSavedAudioA = '';
let _fsSavedAudioB = '';
let _fsAudioDevicesReady = false;
function fsRequestAudioDevices() { sendToCS({ action: 'fsGetAudioDevices' }); }
function fsCurrentVideoDeviceA() {
    return _fsAudioDevicesReady ? (document.getElementById('fsVideoDeviceA')?.value ?? '') : _fsSavedAudioA;
}
function fsCurrentVideoDeviceB() {
    return _fsAudioDevicesReady ? (document.getElementById('fsVideoDeviceB')?.value ?? '') : _fsSavedAudioB;
}

function handleFsAudioDevices(payload) {
    const list = Array.isArray(payload?.devices) ? payload.devices : [];
    if (typeof payload?.savedA === 'string' && !_fsSavedAudioA) _fsSavedAudioA = payload.savedA;
    if (typeof payload?.savedB === 'string' && !_fsSavedAudioB) _fsSavedAudioB = payload.savedB;
    const selA = document.getElementById('fsVideoDeviceA');
    const selB = document.getElementById('fsVideoDeviceB');
    const wantA = (selA?.value) || _fsSavedAudioA || '';
    const wantB = (selB?.value) || _fsSavedAudioB || '';
    for (const [sel, want] of [[selA, wantA], [selB, wantB]]) {
        if (!sel) continue;
        sel.innerHTML = '';
        const def = document.createElement('option');
        def.value = '';
        def.textContent = t('frameshot.video.no_input', 'No input');
        sel.appendChild(def);
        for (const d of list) {
            const o = document.createElement('option');
            o.value = d.id;
            o.textContent = d.label;
            sel.appendChild(o);
        }
        if (want && !list.some(d => d.id === want)) {
            const o = document.createElement('option');
            o.value = want;
            o.textContent = want + ' ' + t('audio.unavailable', '(Unavailable)');
            sel.appendChild(o);
        }
        sel.value = want;
        if (sel._vnRefresh) sel._vnRefresh();
    }
    _fsSavedAudioA = wantA;
    _fsSavedAudioB = wantB;
    _fsAudioDevicesReady = true;
}

function fsUpdateActivationRadius() {
    const input = document.getElementById('fsActivationRadius');
    const label = document.getElementById('fsActivationRadiusVal');
    if (input && label) label.textContent = `${input.value} cm`;
    fsAutoSave();
}

let _fsSavedDeviceId = '';
let _fsSavedDeviceName = '';
let _fsSavedDeviceKnown = false;
let _fsDevicesReady = false;
function fsRequestDevices() { sendToCS({ action: 'fsGetDevices' }); }

let _fsDevicesRequested = false;
function fsEnsureDeviceLists() {
    if (_fsDevicesRequested) return;
    _fsDevicesRequested = true;
    fsRequestAudioDevices();
    fsRequestDevices();
}

function fsApplySavedOutputDevice(s) {
    _fsSavedDeviceId = s.FsOutputDeviceId ?? s.fsOutputDeviceId ?? '';
    _fsSavedDeviceName = s.FsOutputDevice ?? s.fsOutputDevice ?? '';
    _fsSavedDeviceKnown = true;
    if (!_fsDevicesReady) {
        audioPrefillDeviceSelect(document.getElementById('fsOutputDevice'), audioSelectionFromSaved(_fsSavedDeviceId, _fsSavedDeviceName));
    }
}

function fsCurrentOutputDevice() {
    if (_fsDevicesReady) return audioDeviceValue('fsOutputDevice');
    return _fsSavedDeviceKnown ? { id: _fsSavedDeviceId, name: _fsSavedDeviceName } : null;
}

function handleFsDevices(payload) {
    const sel = document.getElementById('fsOutputDevice');
    if (!sel) return;
    const list = Array.isArray(payload?.devices) ? payload.devices : [];
    let selection;
    if (_fsDevicesReady) selection = audioSelectionFromSelect(sel);
    else if (payload?.saved) selection = payload.saved;
    else selection = audioSelectionFromSaved(_fsSavedDeviceId, _fsSavedDeviceName);
    audioFillDeviceSelect(sel, list, selection);
    _fsDevicesReady = true;
}

function fsOutputDeviceChange() {
    const dev = audioDeviceValue('fsOutputDevice');
    if (!dev) return;
    _fsSavedDeviceId = dev.id;
    _fsSavedDeviceName = dev.name;
    sendToCS({ action: 'fsSetOutput', deviceId: dev.id, deviceName: dev.name });
    clearTimeout(_fsAutoTimer);
    _fsAutoTimer = setTimeout(() => saveSettings(), 600);
}

let _fsAutoTimer = null;
function fsAutoSave() {
    fsSendConfig();
    clearTimeout(_fsAutoTimer);
    _fsAutoTimer = setTimeout(() => saveSettings(), 600);
}

function handleFsUpdate(data) {
    _fsLastState = { ...data };
    fsConnected = !!data.connected;

    const badge = document.getElementById('badgeFrameShot');
    if (badge) badge.classList.toggle('tb-active', !!data.connected);

    const dot = document.getElementById('fsDot');
    const txt = document.getElementById('fsStatusText');
    const btn = document.getElementById('fsConnBtn');

    if (!dot || !txt || !btn) return;

    if (data.connected) {
        dot.classList.remove('offline');
        dot.classList.add('online');
        txt.textContent = fsStatusText(data);
        txt.style.color = data.framing ? 'var(--warn)' : 'var(--ok)';
        btn.innerHTML = fsDisconnectBtnHtml();
    } else {
        dot.classList.remove('online');
        dot.classList.add('offline');
        txt.textContent = fsStatusText(data);
        txt.style.color = data.error ? 'var(--err)' : 'var(--tx3)';
        btn.innerHTML = fsConnectBtnHtml();
    }

    const lc = document.getElementById('fsCtrlL');
    const rc = document.getElementById('fsCtrlR');
    if (lc) lc.classList.toggle('detected', !!data.leftController);
    if (rc) rc.classList.toggle('detected', !!data.rightController);
}

function rerenderFrameShotTranslations() {
    if (_fsLastState) handleFsUpdate(_fsLastState);
}

document.documentElement.addEventListener('languagechange', rerenderFrameShotTranslations);

let _fsFfmpegLastState = null;
function fsRequestFfmpegState() { sendToCS({ action: 'fsGetFfmpegState' }); }
function fsInstallFfmpeg() {
    const btn = document.getElementById('fsFfmpegInstallBtn');
    if (btn) btn.disabled = true;
    sendToCS({ action: 'fsInstallFfmpeg' });
}
function handleFsFfmpegState(d) {
    _fsFfmpegLastState = d || {};
    const status   = document.getElementById('fsFfmpegStatus');
    const wrap     = document.getElementById('fsFfmpegProgressWrap');
    const bar      = document.getElementById('fsFfmpegProgressBar');
    const label    = document.getElementById('fsFfmpegProgressLabel');
    const btn      = document.getElementById('fsFfmpegInstallBtn');
    const btnLabel = btn?.querySelector('span:last-child');

    if (d.error) {
        if (status) { status.textContent = t('frameshot.ffmpeg.error', 'Error: ') + d.error; status.style.color = 'var(--err)'; }
        if (wrap) wrap.style.display = 'none';
        if (btn) btn.disabled = false;
        return;
    }

    if (d.downloading) {
        if (wrap)  wrap.style.display = '';
        if (bar)   bar.style.width = (d.progress || 0) + '%';
        if (label) label.textContent = d.installing
            ? t('frameshot.ffmpeg.installing', 'Installing...')
            : t('frameshot.ffmpeg.downloading_percent', 'Downloading... ') + (d.progress || 0) + '%';
        if (status) { status.textContent = ''; status.style.color = ''; }
        if (btn) btn.disabled = true;
        return;
    }

    if (wrap) wrap.style.display = 'none';
    if (btn) btn.disabled = false;
    if (status) {
        status.style.color = d.installed ? 'var(--ok)' : 'var(--tx3)';
        status.textContent = d.installed
            ? t('frameshot.ffmpeg.installed', 'Installed')
            : t('frameshot.ffmpeg.not_installed', 'Not installed');
    }
    if (btnLabel) btnLabel.textContent = d.installed
        ? t('frameshot.ffmpeg.reinstall', 'Reinstall ffmpeg')
        : t('frameshot.ffmpeg.install', 'Install ffmpeg');
}
function rerenderFsFfmpegTranslations() { if (_fsFfmpegLastState) handleFsFfmpegState(_fsFfmpegLastState); }
document.documentElement.addEventListener('languagechange', rerenderFsFfmpegTranslations);
