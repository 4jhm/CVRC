// Direct Access — paste a VRChat profile/avatar/world/group link or bare ID and jump to it.
// Reuses the same detection/open logic as the Ctrl+D keybind and the right-click context menu
// (window.VrcnDirectAccess, defined in core/context-menu/context-menu.js).
let _daLastVrcData = null;

function daHandleInput(value) {
    const access = window.VrcnDirectAccess;
    const icon = document.getElementById('daInputIcon');
    const result = document.getElementById('daResult');
    const text = (value || '').trim();

    if (!text || !access) {
        _daLastVrcData = null;
        icon.classList.remove('da-icon-match');
        icon.textContent = 'link';
        result.style.display = 'none';
        return;
    }

    const vrcData = access.detect(text);
    _daLastVrcData = vrcData;

    if (!vrcData) {
        icon.classList.remove('da-icon-match');
        icon.textContent = 'link';
        result.style.display = 'flex';
        result.className = 'da-result da-result-none';
        result.innerHTML = `
            <div class="da-result-info"><span class="msi">search_off</span><span>${esc(t('da.no_match', 'No VRChat link or ID detected'))}</span></div>
        `;
        return;
    }

    const meta = { avatar: 'checkroom', world: 'travel_explore', group: 'group', user: 'person', instance: 'meeting_room' }[vrcData.type] || 'link';
    icon.classList.add('da-icon-match');
    icon.textContent = meta;
    result.style.display = 'flex';
    result.className = 'da-result';
    const idText = vrcData.type === 'instance' ? `${vrcData.id}:${vrcData.instanceId}` : vrcData.id;
    result.innerHTML = `
        <div class="da-result-info"><span class="msi">${meta}</span><span class="da-result-id">${esc(idText)}</span></div>
        <button class="vrcn-button" onclick="daOpen()"><span class="msi" style="font-size:16px;">open_in_new</span> ${esc(access.getLabel(vrcData))}</button>
    `;
}

function daOpen() {
    if (!_daLastVrcData || !window.VrcnDirectAccess) return;
    window.VrcnDirectAccess.open(_daLastVrcData);
}

async function daPasteFromClipboard() {
    const input = document.getElementById('daInput');
    try {
        const text = await navigator.clipboard.readText();
        input.value = text;
        daHandleInput(text);
        input.focus();
    } catch {
        showToast(false, t('da.clipboard_failed', 'Could not read clipboard.'));
    }
}
