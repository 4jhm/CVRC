// VRChat Accounts — launches independent VRChat instances on separate "--profile=N" slots,
// each with its own local login session, so multiple accounts can be logged in side by side.
let vrcAccountLabels = [];
let vrcAccountExePaths = [];
let vrcAccountOfflineMode = [];
let _vrcaLaunchTimers = {};

function applyVrcAccountLabels(labels, exePaths, offlineMode) {
    vrcAccountLabels = Array.isArray(labels) ? labels.slice(0, 10) : [];
    while (vrcAccountLabels.length < 10) vrcAccountLabels.push(`Account ${vrcAccountLabels.length + 1}`);
    vrcAccountExePaths = Array.isArray(exePaths) ? exePaths.slice(0, 10) : [];
    while (vrcAccountExePaths.length < 10) vrcAccountExePaths.push('');
    vrcAccountOfflineMode = Array.isArray(offlineMode) ? offlineMode.slice(0, 10) : [];
    while (vrcAccountOfflineMode.length < 10) vrcAccountOfflineMode.push(false);
    renderVrcAccountsGrid();
}

function renderVrcAccountsGrid() {
    const grid = document.getElementById('vrcaGrid');
    if (!grid) return;
    grid.innerHTML = vrcAccountLabels.map((label, i) => `
        <div class="vrca-card">
            <div class="vrca-slot-num">${esc(t('vrca.slot', 'Slot'))} ${i + 1}</div>
            <input type="text" class="vrca-label-input vrcn-edit-field" id="vrcaLabel${i}" value="${esc(label)}"
                maxlength="40" onchange="vrcaSaveLabel(${i}, this.value)">
            <div class="vrca-path-row">
                <input type="text" class="vrca-path-input vrcn-edit-field" id="vrcaPath${i}" value="${esc(vrcAccountExePaths[i] || '')}"
                    placeholder="${esc(t('vrca.path_placeholder', 'Optional — uses the default VRChat path if blank'))}"
                    onchange="vrcaSavePath(${i}, this.value)">
                <button class="vrcn-button vrca-path-browse" type="button" onclick="vrcaBrowsePath(${i})" title="${esc(t('vrca.path_browse', 'Browse...'))}" data-i18n-title="vrca.path_browse">
                    <span class="msi" style="font-size:16px;">folder_open</span>
                </button>
            </div>
            <label class="sf-toggle-row vrca-offline-row">
                <span data-i18n="vrca.offline_mode">Launch in Steam Offline Mode</span>
                <label class="toggle">
                    <input type="checkbox" id="vrcaOffline${i}" ${vrcAccountOfflineMode[i] ? 'checked' : ''} onchange="vrcaSaveOffline(${i}, this.checked)">
                    <div class="toggle-track"><div class="toggle-knob"></div></div>
                </label>
            </label>
            <button class="vrcn-button vrca-launch-btn" id="vrcaLaunchBtn${i}" onclick="vrcaLaunch(${i})">
                <span class="msi" style="font-size:16px;">play_arrow</span> <span data-i18n="vrca.launch">Launch</span>
            </button>
        </div>
    `).join('');
}

function vrcaSaveLabel(slot, value) {
    const v = (value || '').trim() || `Account ${slot + 1}`;
    vrcAccountLabels[slot] = v;
    sendToCS({ action: 'vrcAccountsSaveLabel', slot, label: v });
}

function vrcaSavePath(slot, value) {
    const v = (value || '').trim();
    vrcAccountExePaths[slot] = v;
    sendToCS({ action: 'vrcAccountsSavePath', slot, path: v });
}

function vrcaBrowsePath(slot) {
    sendToCS({ action: 'vrcAccountsBrowsePath', slot });
}

function handleVrcAccountsPathResult(data) {
    if (!data || typeof data.slot !== 'number') return;
    vrcAccountExePaths[data.slot] = data.path || '';
    const input = document.getElementById('vrcaPath' + data.slot);
    if (input) input.value = data.path || '';
}

function vrcaSaveOffline(slot, checked) {
    vrcAccountOfflineMode[slot] = !!checked;
    sendToCS({ action: 'vrcAccountsSaveOffline', slot, offline: !!checked });
}

function vrcaLaunch(slot) {
    const btn = document.getElementById('vrcaLaunchBtn' + slot);
    if (btn) {
        btn.classList.add('vrca-launching');
        clearTimeout(_vrcaLaunchTimers[slot]);
        _vrcaLaunchTimers[slot] = setTimeout(() => btn.classList.remove('vrca-launching'), 4000);
    }
    sendToCS({ action: 'vrcAccountsLaunch', slot });
}

function handleVrcAccountsLaunchResult(data) {
    const btn = document.getElementById('vrcaLaunchBtn' + data.slot);
    if (!btn) return;
    clearTimeout(_vrcaLaunchTimers[data.slot]);
    btn.classList.remove('vrca-launching');
}

document.documentElement.addEventListener('languagechange', renderVrcAccountsGrid);
