/* Space Flight */

let _sfLastState = null;

let _sfKeybindMode = 'reset';
const SF_MODE_SELECTS = {
    reset:   { left: 'sfLeftReset',    right: 'sfRightReset'    },
    drag:    { left: 'sfLeftDrag',     right: 'sfRightDrag'     },
    gravity: { left: 'sfLeftGravity',  right: 'sfRightGravity'  },
};

function sfSetMode(mode) {
    if (!SF_MODE_SELECTS[mode]) return;
    _sfKeybindMode = mode;
    sfRenderKeybind();
}

function sfRenderKeybind() {
    const pills = { reset: 'sfModeReset', drag: 'sfModeDrag', gravity: 'sfModeGravity' };
    for (const [m, id] of Object.entries(pills)) {
        document.getElementById(id)?.classList.toggle('active', m === _sfKeybindMode);
    }

    const map = SF_MODE_SELECTS[_sfKeybindMode];
    const leftVal  = parseInt(document.getElementById(map.left)?.value  ?? '0', 10);
    const rightVal = parseInt(document.getElementById(map.right)?.value ?? '0', 10);

    document.querySelectorAll('#sfControllerVisual .vro-btn').forEach(el => {
        const id   = parseInt(el.dataset.sfBtnId, 10);
        const want = el.dataset.side === 'left' ? leftVal : rightVal;
        el.classList.toggle('active', want !== 0 && id === want);
    });
}

function sfKeybindClick(el) {
    const id   = parseInt(el.dataset.sfBtnId, 10);
    const side = el.dataset.side;
    const map  = SF_MODE_SELECTS[_sfKeybindMode];
    const sel  = document.getElementById(side === 'left' ? map.left : map.right);
    if (!sel) return;

    const cur = parseInt(sel.value, 10);
    sel.value = cur === id ? '0' : String(id);
    if (sel._vnRefresh) sel._vnRefresh();

    sfRenderKeybind();
    sfAutoSave();
}

let _sfLegacyView = false;
function sfToggleView(btn) {
    _sfLegacyView = !_sfLegacyView;
    const vis  = document.getElementById('sfControllerVisual');
    const pill = document.getElementById('sfKeybindPills');
    const leg  = document.getElementById('sfLegacyView');
    if (vis)  vis.style.display  = _sfLegacyView ? 'none' : '';
    if (pill) pill.style.display = _sfLegacyView ? 'none' : '';
    if (leg)  leg.style.display  = _sfLegacyView ? '' : 'none';
    btn?.classList.toggle('active', _sfLegacyView);
}

function sfConnectBtnHtml() {
    return `<span class="msi" style="font-size:16px;">link</span> ${esc(t('common.connect', 'Connect'))}`;
}

function sfDisconnectBtnHtml() {
    return `<span class="msi" style="font-size:16px;">link_off</span> ${esc(t('common.disconnect', 'Disconnect'))}`;
}

function sfStatusText(state) {
    if (!state?.connected) return state?.error || t('steamvr.status.not_connected', 'Not connected');
    return state.dragging
        ? t('steamvr.status.dragging', 'Dragging...')
        : t('steamvr.status.connected', 'Connected to Space');
}

function sfConnect() {
    if (sfConnected) {
        sendToCS({ action: 'sfDisconnect' });
    } else {
        sendToCS({ action: 'sfConnect' });
        sfSendConfig();
    }
}

function sfReset() {
    sendToCS({ action: 'sfReset' });
}

function sfSendConfig() {
    sendToCS({
        action: 'sfConfig',
        dragMultiplier: parseFloat(document.getElementById('sfMultiplier').value) || 1,
        lockX: document.getElementById('sfLockX').checked,
        lockY: document.getElementById('sfLockY').checked,
        lockZ: document.getElementById('sfLockZ').checked,
        leftResetBtn:  parseInt(document.getElementById('sfLeftReset')?.value  ?? '32', 10),
        rightResetBtn: parseInt(document.getElementById('sfRightReset')?.value ?? '0',  10),
        leftDragBtn:   parseInt(document.getElementById('sfLeftDrag')?.value   ?? '0',  10),
        rightDragBtn:  parseInt(document.getElementById('sfRightDrag')?.value  ?? '32', 10),
        leftGravityBtn:  parseInt(document.getElementById('sfLeftGravity')?.value  ?? '0', 10),
        rightGravityBtn: parseInt(document.getElementById('sfRightGravity')?.value ?? '0', 10),
        gravity:       parseFloat(document.getElementById('sfGravity')?.value) || 9.8,
    });
}

let _sfAutoTimer = null;
function sfAutoSave() {
    sfSendConfig();
    clearTimeout(_sfAutoTimer);
    _sfAutoTimer = setTimeout(() => saveSettings(), 600);
}

function handleSfUpdate(data) {
    _sfLastState = { ...data };
    sfConnected = data.connected;
    if (typeof updateDashQuickControls === 'function') updateDashQuickControls();

    const dot = document.getElementById('sfDot');
    const txt = document.getElementById('sfStatusText');
    const btn = document.getElementById('sfConnBtn');
    const badge = document.getElementById('badgeSpace');

    if (data.connected) {
        dot.classList.remove('offline');
        dot.classList.add('online');
        txt.textContent = sfStatusText(data);
        txt.style.color = data.dragging ? 'var(--warn)' : 'var(--ok)';
        btn.innerHTML = sfDisconnectBtnHtml();
        if (badge) badge.classList.add('tb-active');
    } else {
        dot.classList.remove('online');
        dot.classList.add('offline');
        txt.textContent = sfStatusText(data);
        txt.style.color = data.error ? 'var(--err)' : 'var(--tx3)';
        btn.innerHTML = sfConnectBtnHtml();
        if (badge) {
            badge.classList.remove('tb-active');
        }
    }

    document.getElementById('sfOffX').textContent = (data.offsetX ?? 0).toFixed(3);
    document.getElementById('sfOffY').textContent = (data.offsetY ?? 0).toFixed(3);
    document.getElementById('sfOffZ').textContent = (data.offsetZ ?? 0).toFixed(3);

    const lc = document.getElementById('sfCtrlL');
    const rc = document.getElementById('sfCtrlR');
    if (lc) lc.classList.toggle('detected', !!data.leftController);
    if (rc) rc.classList.toggle('detected', !!data.rightController);
}

function rerenderSteamVrTranslations() {
    if (_sfLastState) handleSfUpdate(_sfLastState);
}

document.documentElement.addEventListener('languagechange', rerenderSteamVrTranslations);
