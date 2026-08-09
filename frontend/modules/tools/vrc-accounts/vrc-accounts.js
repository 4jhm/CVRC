// VRChat Accounts — launches independent VRChat instances on separate "--profile=N" slots,
// each with its own local login session, so multiple accounts can be logged in side by side.
let vrcAccountLabels = [];
let _vrcaLaunchTimers = {};

function applyVrcAccountLabels(labels) {
    vrcAccountLabels = Array.isArray(labels) ? labels.slice(0, 10) : [];
    while (vrcAccountLabels.length < 10) vrcAccountLabels.push(`Account ${vrcAccountLabels.length + 1}`);
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
