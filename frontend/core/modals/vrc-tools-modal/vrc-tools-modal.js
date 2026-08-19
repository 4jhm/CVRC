var _vrcCfgRaw = {};

var VRC_CFG_RES_SCREENSHOT = [
    { name: '1280x720 (720p)', width: 1280, height: 720 },
    { name: '1920x1080 (1080p Default)', width: '', height: '' },
    { name: '2560x1440 (1440p)', width: 2560, height: 1440 },
    { name: '3840x2160 (4K)', width: 3840, height: 2160 },
];

var VRC_CFG_RES_CAMERA = VRC_CFG_RES_SCREENSHOT.concat([
    { name: '7680x4320 (8K)', width: 7680, height: 4320 },
]);

function _vrcCfgResKey(width, height) {
    var w = Number(width), h = Number(height);
    return (w > 0 && h > 0) ? (w + 'x' + h) : '__default__';
}

function _vrcCfgFillResSelect(id, rows) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = rows.map(function (r) {
        return '<option value="' + _vrcCfgResKey(r.width, r.height) + '">' + esc(r.name) + '</option>';
    }).join('');
}

function _vrcCfgPrintsStatus(p) {
    var ico = document.getElementById('vrcCfgPrintsStatusIco');
    var txt = document.getElementById('vrcCfgPrintsStatus');
    var btn = document.getElementById('vrcCfgPrintsFlagBtn');
    if (!txt) return;
    var state = p.logOk ? 'ok' : (p.flagSet ? 'pending' : 'off');
    if (state === 'ok') {
        txt.textContent = t('vrc_config.prints_status_ok', 'VRChat is logging the required data. Prints will be saved.');
        if (ico) { ico.textContent = 'check_circle'; ico.style.color = 'var(--ok)'; }
    } else if (state === 'pending') {
        txt.textContent = t('vrc_config.prints_status_pending', 'Launch option is set. Restart VRChat through VRCNext so it takes effect.');
        if (ico) { ico.textContent = 'restart_alt'; ico.style.color = 'var(--tx3)'; }
    } else {
        txt.textContent = t('vrc_config.prints_requires_flag', 'VRChat only logs the required data with the launch option --enable-sdk-log-levels.');
        if (ico) { ico.textContent = 'error'; ico.style.color = 'var(--err)'; }
    }
    if (btn) btn.style.display = p.flagSet ? 'none' : '';
}

function vrcCfgAddSdkLogFlag() {
    sendToCS({ action: 'vrcAddSdkLogFlag' });
    setTimeout(function () { sendToCS({ action: 'vrcConfigGet' }); }, 300);
}

function vrcCfgSavePrintsToggle() {
    var on = document.getElementById('vrcCfgSavePrints')?.checked;
    var field = document.getElementById('vrcCfgPrintsDir')?.closest('.vrc-cfg-field');
    if (field) field.style.opacity = on ? '1' : '.5';
    var inp = document.getElementById('vrcCfgPrintsDir');
    if (inp) inp.disabled = !on;
}

function vrcCfgPickFolder(targetId) {
    sendToCS({ action: 'pickFolder', target: targetId });
}

function openVrcConfigModal() {
    document.getElementById('modalVrcConfig').style.display = 'flex';
    document.getElementById('vrcCfgCacheSize').textContent = '...';
    document.getElementById('vrcCfgMaxCacheSize').value = '';
    document.getElementById('vrcCfgCacheExpiry').value = '';
    document.getElementById('vrcCfgSteadycamFov').value = '';
    document.getElementById('vrcCfgCacheDir').value = '';
    document.getElementById('vrcCfgPictureDir').value = '';
    document.getElementById('vrcCfgPrintsDir').value = '';
    _vrcCfgFillResSelect('vrcCfgCameraRes', VRC_CFG_RES_CAMERA);
    _vrcCfgFillResSelect('vrcCfgSpoutRes', VRC_CFG_RES_SCREENSHOT);
    _vrcCfgFillResSelect('vrcCfgScreenshotRes', VRC_CFG_RES_SCREENSHOT);
    sendToCS({ action: 'vrcConfigGet' });
}

function openVrcLaunchOptionsModal() {
    document.getElementById('modalVrcLaunchOptions').style.display = 'flex';
    document.getElementById('vrcLaArgs').value = '';
    document.getElementById('vrcLaPath').value = '';
    sendToCS({ action: 'vrcLaunchOptionsGet' });
}

function _vrcCfgFormatBytes(b) {
    var n = Number(b) || 0;
    if (n <= 0) return '0 GB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function _vrcCfgApplyData(payload) {
    if (payload.config && typeof payload.config === 'object') {
        _vrcCfgRaw = payload.config || {};
        document.getElementById('vrcCfgMaxCacheSize').value = _vrcCfgRaw.cache_size != null ? _vrcCfgRaw.cache_size : '';
        document.getElementById('vrcCfgCacheExpiry').value = _vrcCfgRaw.cache_expiry_delay != null ? _vrcCfgRaw.cache_expiry_delay : '';
        document.getElementById('vrcCfgSteadycamFov').value = _vrcCfgRaw.fpv_steadycam_fov != null ? _vrcCfgRaw.fpv_steadycam_fov : '';
        document.getElementById('vrcCfgCacheDir').value = _vrcCfgRaw.cache_directory || '';
        document.getElementById('vrcCfgPictureDir').value = _vrcCfgRaw.picture_output_folder || '';
        _vrcCfgSetRes('vrcCfgCameraRes', _vrcCfgRaw.camera_res_width, _vrcCfgRaw.camera_res_height);
        _vrcCfgSetRes('vrcCfgSpoutRes', _vrcCfgRaw.camera_spout_res_width, _vrcCfgRaw.camera_spout_res_height);
        _vrcCfgSetRes('vrcCfgScreenshotRes', _vrcCfgRaw.screenshot_res_width, _vrcCfgRaw.screenshot_res_height);
        document.getElementById('vrcCfgSplitByDate').checked = _vrcCfgRaw.picture_output_split_by_date !== false;
        document.getElementById('vrcCfgDisableRichPresence').checked = _vrcCfgRaw.disableRichPresence === true;
    }
    if (payload.inGame) {
        var hint = document.getElementById('vrcCfgCameraResHint');
        var res = (payload.inGame.cameraRes || '').trim();
        if (hint) {
            hint.textContent = res ? tf('vrc_config.in_game_value', { value: res + 'p' }, 'Currently set in VRChat: ' + res + 'p') : '';
            hint.style.display = res ? '' : 'none';
        }
    }
    if (payload.prints) {
        document.getElementById('vrcCfgSavePrints').checked = !!payload.prints.enabled;
        document.getElementById('vrcCfgPrintsDir').value = payload.prints.path || '';
        document.getElementById('vrcCfgPrintsDir').placeholder = payload.prints.defaultPath || '';
        _vrcCfgPrintsStatus(payload.prints);
        vrcCfgSavePrintsToggle();
    }
    if (payload.cacheBytes != null) {
        document.getElementById('vrcCfgCacheSize').textContent = _vrcCfgFormatBytes(payload.cacheBytes);
    }
}

function vrcCfgRefreshCache() {
    document.getElementById('vrcCfgCacheSize').textContent = '...';
    sendToCS({ action: 'vrcCacheRefresh' });
}

function vrcCfgDeleteCache() {
    vnConfirmModal({
        title: t('vrc_config.confirm_delete_title', 'Delete Asset Cache'),
        icon: 'delete_sweep',
        message: esc(t('vrc_config.confirm_delete', 'Delete the entire VRChat asset cache?')),
        confirmLabel: t('common.delete', 'Delete'),
        onConfirm: () => {
            document.getElementById('vrcCfgCacheSize').textContent = '...';
            sendToCS({ action: 'vrcCacheDeleteAll' });
        },
    });
}

function vrcCfgSweepCache() {
    document.getElementById('vrcCfgCacheSize').textContent = '...';
    sendToCS({ action: 'vrcCacheSweep' });
}

function _vrcCfgParseNum(v) {
    if (v == null || v === '') return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
}

function _vrcCfgSetRes(id, width, height) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var key = _vrcCfgResKey(width, height);
    sel.value = [].some.call(sel.options, function (o) { return o.value === key; }) ? key : '__default__';
    if (sel._vnRefresh) sel._vnRefresh();
}

function _vrcCfgApplyRes(merged, id, prefix) {
    var val = document.getElementById(id)?.value || '__default__';
    if (val === '__default__') {
        delete merged[prefix + '_width'];
        delete merged[prefix + '_height'];
        return;
    }
    var parts = val.split('x');
    merged[prefix + '_width'] = parseInt(parts[0], 10) || 0;
    merged[prefix + '_height'] = parseInt(parts[1], 10) || 0;
}

function vrcCfgSave() {
    var merged = Object.assign({}, _vrcCfgRaw);
    var max = _vrcCfgParseNum(document.getElementById('vrcCfgMaxCacheSize').value);
    var exp = _vrcCfgParseNum(document.getElementById('vrcCfgCacheExpiry').value);
    var fov = _vrcCfgParseNum(document.getElementById('vrcCfgSteadycamFov').value);
    if (max != null) merged.cache_size = max; else delete merged.cache_size;
    if (exp != null) merged.cache_expiry_delay = exp; else delete merged.cache_expiry_delay;
    if (fov != null) merged.fpv_steadycam_fov = fov; else delete merged.fpv_steadycam_fov;

    var cacheDir = (document.getElementById('vrcCfgCacheDir').value || '').trim();
    var picDir = (document.getElementById('vrcCfgPictureDir').value || '').trim();
    if (cacheDir) merged.cache_directory = cacheDir; else delete merged.cache_directory;
    if (picDir) merged.picture_output_folder = picDir; else delete merged.picture_output_folder;

    _vrcCfgApplyRes(merged, 'vrcCfgCameraRes', 'camera_res');
    _vrcCfgApplyRes(merged, 'vrcCfgSpoutRes', 'camera_spout_res');
    _vrcCfgApplyRes(merged, 'vrcCfgScreenshotRes', 'screenshot_res');

    if (document.getElementById('vrcCfgSplitByDate').checked) delete merged.picture_output_split_by_date;
    else merged.picture_output_split_by_date = false;
    if (document.getElementById('vrcCfgDisableRichPresence').checked) merged.disableRichPresence = true;
    else delete merged.disableRichPresence;

    sendToCS({
        action: 'vrcConfigSave',
        config: merged,
        prints: {
            enabled: document.getElementById('vrcCfgSavePrints').checked,
            path: (document.getElementById('vrcCfgPrintsDir').value || '').trim(),
        },
    });
    document.getElementById('modalVrcConfig').style.display = 'none';
}

function _vrcLaApplyData(payload) {
    document.getElementById('vrcLaArgs').value = payload.args || '';
    document.getElementById('vrcLaPath').value = payload.path || '';
}

function vrcLaSave() {
    var args = document.getElementById('vrcLaArgs').value || '';
    var path = document.getElementById('vrcLaPath').value || '';
    sendToCS({ action: 'vrcLaunchOptionsSave', args: args, path: path });
    document.getElementById('modalVrcLaunchOptions').style.display = 'none';
}

