// Avatar Database — browses/sorts a Gofile folder of downloadable avatar files.
// Password gate note: this is a plain client-side check for friendly friction, not real
// security — the frontend ships as readable JS, so anyone with the app files can read this
// string. Don't rely on it to keep the folder actually private.
const AVDB_PASSWORD = 'YEahYuhThanksForAvi31';
const AVDB_UNLOCK_KEY = 'vrcnext_avdb_unlocked';

let _avdbFiles = [];
let _avdbSortField = 'name'; // 'name' | 'size' | 'date'
let _avdbSortDir = 1;        // 1 = ascending, -1 = descending

function avdbTryUnlock() {
    const input = document.getElementById('avdbPasswordInput');
    const val = input ? input.value : '';
    if (val === AVDB_PASSWORD) {
        avdbUnlock();
        return;
    }
    const err = document.getElementById('avdbLockError');
    if (err) err.style.display = '';
    if (input) { input.value = ''; input.focus(); }
}

function avdbUnlock() {
    try { localStorage.setItem(AVDB_UNLOCK_KEY, '1'); } catch { }
    const lockCard = document.getElementById('avdbLockCard');
    const content = document.getElementById('avdbUnlockedContent');
    if (lockCard) lockCard.style.display = 'none';
    if (content) content.style.display = '';
    avdbLoad(false);
    sendToCS({ action: 'avatarDbGetMyFolder' });
}

function handleAvatarDbMyFolder(data) {
    const link = data?.link || '';
    const input = document.getElementById('avdbMyFolderInput');
    const openBtn = document.getElementById('avdbMyFolderOpenBtn');
    if (input && document.activeElement !== input) input.value = link;
    if (openBtn) openBtn.disabled = !link;
}

function avdbSaveMyFolder() {
    const input = document.getElementById('avdbMyFolderInput');
    const link = input ? input.value.trim() : '';
    sendToCS({ action: 'avatarDbSaveMyFolder', link });
    if (typeof showToast === 'function') showToast(true, t('avdb.myfolder.saved', 'Folder link saved.'));
}

function avdbOpenMyFolder() {
    const input = document.getElementById('avdbMyFolderInput');
    const link = input ? input.value.trim() : '';
    if (!link) return;
    sendToCS({ action: 'avatarDbOpenLink', url: link });
}

function avdbCheckUnlockState() {
    let unlocked = false;
    try { unlocked = localStorage.getItem(AVDB_UNLOCK_KEY) === '1'; } catch { }
    if (unlocked) avdbUnlock();
}

function avdbLoad(force) {
    sendToCS({ action: 'avatarDbLoad', force: !!force });
}

function handleAvatarDbResult(data) {
    if (!data.ok) {
        const grid = document.getElementById('avdbGrid');
        if (grid) grid.innerHTML = `<div class="osc-empty">${esc(data.message || t('avdb.error', 'Could not load the avatar database.'))}</div>`;
        return;
    }
    _avdbFiles = data.files || [];
    avdbRender();
}

function avdbSetSort(field) {
    _avdbSortField = field;
    document.querySelectorAll('.avdb-sort-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('avdbSort' + field.charAt(0).toUpperCase() + field.slice(1));
    if (btn) btn.classList.add('active');
    avdbRender();
}

function avdbToggleDirection() {
    _avdbSortDir *= -1;
    const icon = document.getElementById('avdbSortDirIcon');
    if (icon) icon.textContent = _avdbSortDir === 1 ? 'arrow_upward' : 'arrow_downward';
    avdbRender();
}

function _avdbSortedFiles() {
    const arr = _avdbFiles.slice();
    arr.sort((a, b) => {
        let cmp;
        if (_avdbSortField === 'size') cmp = (a.sizeBytes || 0) - (b.sizeBytes || 0);
        else if (_avdbSortField === 'date') cmp = (a.createTime || 0) - (b.createTime || 0);
        else cmp = (a.name || '').localeCompare(b.name || '');
        return cmp * _avdbSortDir;
    });
    return arr;
}

function _avdbFormatSize(bytes) {
    bytes = bytes || 0;
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB', 'MB', 'GB'];
    let val = bytes / 1024, i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return val.toFixed(val >= 10 ? 0 : 1) + ' ' + units[i];
}

function _avdbFormatDate(unixSeconds) {
    if (!unixSeconds) return t('avdb.unknown_date', 'Unknown date');
    return new Date(unixSeconds * 1000).toLocaleDateString();
}

function _avdbExtIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
    if (['zip', 'rar', '7z'].includes(ext)) return 'folder_zip';
    if (ext === 'unitypackage') return 'inventory_2';
    return 'draft';
}

function avdbRender() {
    const grid = document.getElementById('avdbGrid');
    if (!grid) return;
    const files = _avdbSortedFiles();
    if (files.length === 0) {
        grid.innerHTML = `<div class="osc-empty">${esc(t('avdb.empty', 'No files found.'))}</div>`;
        return;
    }
    grid.innerHTML = files.map(f => `
        <div class="avdb-card">
            <span class="msi avdb-card-icon">${_avdbExtIcon(f.name)}</span>
            <div class="avdb-card-name" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="avdb-card-meta">${esc(_avdbFormatSize(f.sizeBytes))} · ${esc(_avdbFormatDate(f.createTime))}</div>
            <button class="vrcn-button avdb-card-download" onclick="avdbDownload()"><span class="msi" style="font-size:15px;">open_in_new</span> <span data-i18n="avdb.download">Open in Gofile</span></button>
        </div>
    `).join('');
}

function avdbDownload() {
    sendToCS({ action: 'avatarDbOpenLink' });
}

function rerenderAvatarDbTranslations() {
    avdbRender();
}
document.documentElement.addEventListener('languagechange', rerenderAvatarDbTranslations);

avdbCheckUnlockState();
