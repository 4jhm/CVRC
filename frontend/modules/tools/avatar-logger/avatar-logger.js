// Avatar Logger — watches for freshly-downloaded avatars and posts them to Discord/GoFile.
let _avlogEnabled = false;
let _avlogFeedEntries = {}; // key -> entry, everything tracked in the live feed this session
let _avlogFeedSortField = 'time'; // 'time' | 'size' | 'name'
let _avlogFeedSortDir = -1;       // -1 = newest/largest/Z-A first, 1 = reversed
const AVLOG_FEED_CAP = 100;

function avlogToggle() {
    _avlogEnabled = !_avlogEnabled;
    avlogSaveConfig();
}

function avlogSaveConfig() {
    sendToCS({
        action: 'avlogConfig',
        enabled: _avlogEnabled,
        webhookUrl: document.getElementById('avlogWebhookUrl').value.trim(),
        minSizeMb: parseFloat(document.getElementById('avlogMinSizeMb').value) || 0,
        autoUpload: document.getElementById('avlogAutoUpload').checked,
        autoUploadMinMb: parseFloat(document.getElementById('avlogAutoUploadMinMb').value) || 0,
        deliveryMode: document.getElementById('avlogDeliveryMode').value,
        maxAttachmentMb: parseFloat(document.getElementById('avlogMaxAttachmentMb').value) || 25,
        gofileToken: document.getElementById('avlogGofileToken').value.trim(),
        gofileFolder: document.getElementById('avlogGofileFolder').value.trim(),
        localArchivePath: document.getElementById('avlogLocalArchivePath').value.trim(),
        localOnlyAboveMb: parseFloat(document.getElementById('avlogLocalOnlyAboveMb').value) || 0,
        cachePathOverride: document.getElementById('avlogCachePathOverride').value.trim(),
        cacheFileName: document.getElementById('avlogCacheFileName').value.trim(),
        logMySwitches: document.getElementById('avlogLogMySwitches').checked,
        ignorePeople: document.getElementById('avlogIgnorePeople').value.split('\n').map(s => s.trim()).filter(Boolean),
    });
}

// Opens a native folder picker for the VRChat cache folder override.
function avlogBrowseCachePath() {
    sendToCS({ action: 'avlogBrowseCachePath' });
}

function handleAvlogCachePathResult(path) {
    if (!path) return;
    const input = document.getElementById('avlogCachePathOverride');
    if (input) input.value = path;
    avlogSaveConfig();
}

function avlogTestWebhook() {
    sendToCS({ action: 'avlogTestWebhook', webhookUrl: document.getElementById('avlogWebhookUrl').value.trim() });
}

function avlogClearSeen() {
    sendToCS({ action: 'avlogClearSeen' });
}

// Manual escape hatch for setups where auto-detection isn't finding anything — lists every cache
// file directly into the Live Feed below (unnamed, since there's no log line to read a name
// from), independent of whether the log watcher itself is working.
function avlogBrowseCache() {
    sendToCS({ action: 'avlogBrowseCache' });
}

function avlogManualUpload(key) {
    sendToCS({ action: 'avlogManualUpload', key });
}

// Picks one candidate cache file (out of the full list shown for own-avatar switches, since
// there's no reliable automatic match for those) and runs it through the normal delivery
// pipeline in its place.
function avlogUseCandidate(key, path) {
    sendToCS({ action: 'avlogUseCandidate', key, path });
}

function avlogRevealCandidate(path) {
    sendToCS({ action: 'revealInExplorer', path });
}

// Saves straight to the configured Local Archive Folder, no GoFile/Discord involved.
function avlogUploadToFiles(key) {
    sendToCS({ action: 'avlogUploadToFiles', key });
}

// Opens the OS file browser at the exact cached avatar file (the "__data" asset bundle
// inside VRChat's own disk cache), so you can see/copy it without hunting for it manually.
function avlogRevealFile(key) {
    const entry = _avlogFeedEntries[key];
    if (!entry || !entry.cachePath) return;
    sendToCS({ action: 'revealInExplorer', path: entry.cachePath });
}

function avlogFormatWhen(whenIso) {
    if (!whenIso) return '';
    const d = new Date(whenIso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// Clicking the thumbnail uploads it (if not delivered yet), or re-opens/copies the
// link it already got (if it was).
function avlogThumbClick(key, downloadLink) {
    if (downloadLink) {
        navigator.clipboard.writeText(downloadLink).catch(() => {});
        showToast(true, t('avlog.row.link_copied', 'Link copied to clipboard!'));
        sendToCS({ action: 'avatarDbOpenLink', url: downloadLink });
    } else {
        avlogManualUpload(key);
    }
}

function handleAvatarLoggerStatus(data) {
    _avlogEnabled = !!data.running;

    document.getElementById('avlogWebhookUrl').value = data.webhookUrl || '';
    document.getElementById('avlogMinSizeMb').value = data.minSizeMb ?? 15;
    document.getElementById('avlogAutoUpload').checked = !!data.autoUpload;
    document.getElementById('avlogAutoUploadMinMb').value = data.autoUploadMinMb ?? 15;
    document.getElementById('avlogDeliveryMode').value = data.deliveryMode || 'discord';
    document.getElementById('avlogMaxAttachmentMb').value = data.maxAttachmentMb ?? 25;
    document.getElementById('avlogGofileToken').value = data.gofileToken || '';
    document.getElementById('avlogGofileFolder').value = data.gofileFolder || '';
    document.getElementById('avlogLocalArchivePath').value = data.localArchivePath || '';
    document.getElementById('avlogLocalOnlyAboveMb').value = data.localOnlyAboveMb ?? 0;
    document.getElementById('avlogCachePathOverride').value = data.cachePathOverride || '';
    document.getElementById('avlogCacheFileName').value = data.cacheFileName || '';
    document.getElementById('avlogLogMySwitches').checked = data.logMySwitches !== false;
    document.getElementById('avlogIgnorePeople').value = (data.ignorePeople || []).join('\n');

    const dot = document.getElementById('avlogDot');
    const statusText = document.getElementById('avlogStatusText');
    const btn = document.getElementById('avlogToggleBtn');
    if (dot) dot.className = 'sf-dot ' + (_avlogEnabled ? 'online' : 'offline');
    if (statusText) statusText.textContent = _avlogEnabled
        ? t('avlog.status.running', 'Running')
        : t('avlog.status.stopped', 'Stopped');
    if (btn) btn.innerHTML = _avlogEnabled
        ? `<span class="msi" style="font-size:16px;">stop</span> ${t('common.stop', 'Stop')}`
        : `<span class="msi" style="font-size:16px;">play_arrow</span> ${t('common.start', 'Start')}`;
}

function _avlogStatusLabel(status) {
    return {
        posted: t('avlog.row.status.posted', 'Posted'),
        local: t('avlog.row.status.local', 'Local only'),
        listed: t('avlog.row.status.listed', 'Listed'),
        error: t('avlog.row.status.error', 'Error'),
        skipped_small: t('avlog.row.status.skipped_small', 'Too small'),
        repeat: t('avlog.row.status.repeat', 'Already logged'),
    }[status] || status;
}

// Anything that hasn't actually been delivered yet can still be force-uploaded manually.
const AVLOG_UPLOADABLE_STATUSES = ['listed', 'skipped_small', 'error', 'repeat'];

function _avlogStatusHtml(entry) {
    if (entry.status === 'uploading') {
        const pct = Math.max(0, Math.min(100, entry.uploadProgress || 0));
        return `<div class="avlog-row-progress" title="${pct}%">
            <div class="avlog-row-progress-bar" style="width:${pct}%;"></div>
            <span class="avlog-row-progress-label">${pct}%</span>
        </div>`;
    }
    return `<span class="avlog-row-status ${esc(entry.status)}">${esc(_avlogStatusLabel(entry.status))}</span>`;
}

function avlogFeedSetSort(field) {
    _avlogFeedSortField = field;
    document.querySelectorAll('#avlogFeedSortTime, #avlogFeedSortSize, #avlogFeedSortName').forEach(b => b.classList.remove('active'));
    document.getElementById('avlogFeedSort' + field.charAt(0).toUpperCase() + field.slice(1))?.classList.add('active');
    avlogRenderFeed();
}

function avlogFeedToggleDirection() {
    _avlogFeedSortDir *= -1;
    const icon = document.getElementById('avlogFeedSortDirIcon');
    if (icon) icon.textContent = _avlogFeedSortDir === -1 ? 'arrow_downward' : 'arrow_upward';
    avlogRenderFeed();
}

function _avlogFeedCompare(a, b) {
    let cmp;
    if (_avlogFeedSortField === 'size') cmp = (a.sizeMb || 0) - (b.sizeMb || 0);
    else if (_avlogFeedSortField === 'name') cmp = (a.name || '').localeCompare(b.name || '');
    else cmp = new Date(a.whenIso || 0) - new Date(b.whenIso || 0);
    return cmp * _avlogFeedSortDir;
}

// Full sorted re-render — used when the sort changes, or a brand-new avatar shows up (its
// position depends on the sort field, so it can't just be prepended). In-place updates to an
// already-rendered row (e.g. upload progress ticking) skip this and patch the row directly.
function avlogRenderFeed() {
    const feed = document.getElementById('avlogFeed');
    if (!feed) return;
    const keys = Object.keys(_avlogFeedEntries);
    if (keys.length === 0) {
        feed.innerHTML = `<div class="osc-empty">${esc(t('avlog.feed.empty', 'No avatars detected yet this session.'))}</div>`;
        return;
    }
    keys.sort((ka, kb) => _avlogFeedCompare(_avlogFeedEntries[ka], _avlogFeedEntries[kb]));
    feed.innerHTML = '';
    keys.forEach(k => feed.appendChild(_avlogBuildRow(_avlogFeedEntries[k])));
}

function _avlogBuildRow(entry) {
    const row = document.createElement('div');
    row.className = 'avlog-row';
    row.id = 'avlogRow-' + cssEscape(entry.key);
    _avlogFillRow(row, entry);
    return row;
}

// Own-avatar switches come with no reliable automatic cache match, so the backend instead sends
// every valid bundle it found in the cache (size + modified time) for the user to eyeball and
// pick the right one from — see AvatarLoggerService.FindCacheCandidates.
function _avlogCandidatesHtml(entry) {
    const list = entry.cacheCandidates || [];
    if (!list.length) return '';
    const rows = list.map(c => {
        const sizeText = c.sizeMb != null ? c.sizeMb.toFixed(1) + ' MB' : '';
        const whenText = avlogFormatWhen(c.modifiedIso);
        return `<div class="avlog-candidate">
            <span class="avlog-candidate-size">${esc(sizeText)}</span>
            <span class="avlog-candidate-when">${esc(whenText)}</span>
            <button class="vrcn-button avlog-candidate-use-btn" data-path="${esc(c.path)}"><span class="msi" style="font-size:13px;">check</span> ${esc(t('avlog.row.candidate_use', 'Use this'))}</button>
            <button class="vrcn-button avlog-candidate-reveal-btn" data-path="${esc(c.path)}"><span class="msi" style="font-size:13px;">folder_open</span> ${esc(t('avlog.row.reveal_file', 'File'))}</button>
        </div>`;
    }).join('');
    return `<details class="avlog-row-candidates">
        <summary>${esc(t('avlog.row.candidates_title', 'Not sure which is yours? Pick from every cache file'))} (${list.length})</summary>
        <div class="avlog-row-candidates-list">${rows}</div>
    </details>`;
}

function _avlogFillRow(row, entry) {
    const thumbHtml = entry.thumbUrl
        ? `<img class="avlog-row-thumb" alt="">`
        : `<div class="avlog-row-thumb-fallback"><span class="msi">checkroom</span></div>`;
    const metaParts = [];
    if (entry.author) metaParts.push(esc(entry.author));
    if (entry.wearer) metaParts.push(t('avlog.row.worn_by', 'worn by') + ' ' + esc(entry.wearer));
    if (entry.sizeMb != null) metaParts.push(entry.sizeMb.toFixed(1) + ' MB');
    if (entry.downloadLink) metaParts.push(t('avlog.row.has_link', 'link ready'));
    const whenText = avlogFormatWhen(entry.whenIso);
    // The label is wrapped in its own span (rather than plain text) so a narrow panel can hide
    // just the text via CSS and collapse the button down to its icon — the title attribute picks
    // up the tooltip at that point so the action stays identifiable.
    const uploadBtnHtml = AVLOG_UPLOADABLE_STATUSES.includes(entry.status)
        ? `<button class="vrcn-button avlog-row-upload-btn" title="${esc(t('avlog.row.upload', 'Upload'))}"><span class="msi" style="font-size:14px;">upload</span><span class="avlog-row-btn-label">${esc(t('avlog.row.upload', 'Upload'))}</span></button>`
        : '';
    const filesBtnHtml = entry.cachePath
        ? `<button class="vrcn-button avlog-row-files-btn" title="${esc(t('avlog.row.upload_to_files', 'Upload to Files'))}"><span class="msi" style="font-size:14px;">drive_file_move</span><span class="avlog-row-btn-label">${esc(t('avlog.row.upload_to_files', 'Upload to Files'))}</span></button>`
        : '';
    const revealBtnHtml = entry.cachePath
        ? `<button class="vrcn-button avlog-row-reveal-btn" title="${esc(t('avlog.row.reveal_file', 'File'))}"><span class="msi" style="font-size:14px;">folder_open</span><span class="avlog-row-btn-label">${esc(t('avlog.row.reveal_file', 'File'))}</span></button>`
        : '';

    row.innerHTML = `
        ${thumbHtml}
        <div class="avlog-row-body">
            <div class="avlog-row-name" title="${esc(entry.name)}">${esc(entry.name || '(unnamed avatar)')}</div>
            <div class="avlog-row-meta" title="${esc(entry.note || '')}">${metaParts.join(' · ')}</div>
            ${whenText ? `<div class="avlog-row-when" title="${esc(whenText)}"><span class="msi" style="font-size:11px;">schedule</span> ${esc(whenText)}</div>` : ''}
        </div>
        ${_avlogStatusHtml(entry)}
        ${uploadBtnHtml}
        ${filesBtnHtml}
        ${revealBtnHtml}
        ${_avlogCandidatesHtml(entry)}
    `;

    // Bound here instead of inline onclick="..." strings — a name/link containing a double
    // quote could otherwise break out of the attribute and corrupt the row's markup, and this
    // also lets us stopPropagation() cleanly so a row click can never bubble to anything else.
    const thumbEl = row.querySelector('.avlog-row-thumb, .avlog-row-thumb-fallback');
    if (thumbEl) {
        if (entry.thumbUrl) thumbEl.src = entry.thumbUrl;
        thumbEl.title = entry.downloadLink
            ? t('avlog.row.thumb_open', 'Open / copy link')
            : t('avlog.row.thumb_upload', 'Click to upload');
        thumbEl.onclick = (e) => {
            e.stopPropagation();
            avlogThumbClick(entry.key, entry.downloadLink || null);
        };
    }
    const uploadBtnEl = row.querySelector('.avlog-row-upload-btn');
    if (uploadBtnEl) {
        uploadBtnEl.onclick = (e) => {
            e.stopPropagation();
            avlogManualUpload(entry.key);
        };
    }
    const filesBtnEl = row.querySelector('.avlog-row-files-btn');
    if (filesBtnEl) {
        filesBtnEl.onclick = (e) => {
            e.stopPropagation();
            avlogUploadToFiles(entry.key);
        };
    }
    const revealBtnEl = row.querySelector('.avlog-row-reveal-btn');
    if (revealBtnEl) {
        revealBtnEl.onclick = (e) => {
            e.stopPropagation();
            avlogRevealFile(entry.key);
        };
    }
    row.querySelectorAll('.avlog-candidate-use-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            avlogUseCandidate(entry.key, btn.dataset.path);
        };
    });
    row.querySelectorAll('.avlog-candidate-reveal-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            avlogRevealCandidate(btn.dataset.path);
        };
    });
}

function handleAvatarLoggerEvent(entry) {
    const isNewKey = !(entry.key in _avlogFeedEntries);
    _avlogFeedEntries[entry.key] = entry;

    const keys = Object.keys(_avlogFeedEntries);
    if (keys.length > AVLOG_FEED_CAP) {
        keys.sort((a, b) => new Date(_avlogFeedEntries[a].whenIso || 0) - new Date(_avlogFeedEntries[b].whenIso || 0));
        keys.slice(0, keys.length - AVLOG_FEED_CAP).forEach(k => delete _avlogFeedEntries[k]);
    }

    if (isNewKey) { avlogRenderFeed(); return; }

    // Existing entry updated in place (e.g. upload progress ticking) — patch its row directly
    // rather than re-sorting/rebuilding the whole feed on every tick.
    const row = document.getElementById('avlogRow-' + cssEscape(entry.key));
    if (row) _avlogFillRow(row, entry);
    else avlogRenderFeed();
}

let _avlogHistoryEntries = [];
let _avlogHistoryQuery = '';

function handleAvatarLoggerHistory(data) {
    _avlogHistoryEntries = (data.entries || []).slice().reverse();
    _avlogRenderHistory();
}

function avlogHistorySearch(query) {
    _avlogHistoryQuery = (query || '').trim().toLowerCase();
    _avlogRenderHistory();
}

function _avlogRenderHistory() {
    const grid = document.getElementById('avlogHistoryGrid');
    if (!grid) return;

    const q = _avlogHistoryQuery;
    const entries = q
        ? _avlogHistoryEntries.filter(e =>
            (e.name || '').toLowerCase().includes(q) ||
            (e.wearer || '').toLowerCase().includes(q) ||
            (e.account || '').toLowerCase().includes(q))
        : _avlogHistoryEntries;

    if (entries.length === 0) {
        grid.innerHTML = `<div class="osc-empty">${esc(q
            ? t('avlog.history.no_matches', 'No logged avatars match your search.')
            : t('avlog.history.empty', 'No avatars logged yet.'))}</div>`;
        return;
    }
    grid.innerHTML = entries.map(e => {
        const whenText = avlogFormatWhen(e.whenIso);
        const sizeText = e.sizeMb != null ? e.sizeMb.toFixed(1) + ' MB' : null;
        return `
        <div class="avlog-history-card">
            <div class="avlog-history-thumb-wrap">
                ${e.thumbUrl ? `<img class="avlog-history-thumb" src="${esc(e.thumbUrl)}" alt="">` : '<div class="avlog-history-thumb-fallback"><span class="msi">checkroom</span></div>'}
                ${sizeText ? `<div class="avlog-history-size-badge">${esc(sizeText)}</div>` : ''}
            </div>
            <div class="avlog-history-name" title="${esc(e.name)}">${esc(e.name || '(unnamed avatar)')}</div>
            <div class="avlog-history-meta">${esc(e.author || '')}</div>
            ${e.wearer ? `<div class="avlog-history-meta">${esc(t('avlog.row.worn_by', 'worn by'))} ${esc(e.wearer)}</div>` : ''}
            ${e.account ? `<div class="avlog-history-meta">${esc(t('avlog.row.logged_on', 'logged on'))} ${esc(e.account)}</div>` : ''}
            ${whenText ? `<div class="avlog-history-when" title="${esc(whenText)}"><span class="msi" style="font-size:11px;">schedule</span> ${esc(whenText)}</div>` : ''}
            ${e.downloadLink ? `<a class="vrcn-button" href="#" onclick="sendToCS({action:'avatarDbOpenLink', url:'${jsq(e.downloadLink)}'});return false;"><span class="msi" style="font-size:14px;">download</span> ${t('avdb.download', 'Download')}</a>` : ''}
        </div>
    `;
    }).join('');
}

function cssEscape(s) {
    return (s || '').replace(/[^a-zA-Z0-9_-]/g, c => '_' + c.charCodeAt(0));
}

function rerenderAvatarLoggerTranslations() {
    if (document.getElementById('avlogStatusText')) handleAvatarLoggerStatus({
        running: _avlogEnabled,
        webhookUrl: document.getElementById('avlogWebhookUrl')?.value,
        minSizeMb: document.getElementById('avlogMinSizeMb')?.value,
        autoUpload: document.getElementById('avlogAutoUpload')?.checked,
        autoUploadMinMb: document.getElementById('avlogAutoUploadMinMb')?.value,
        deliveryMode: document.getElementById('avlogDeliveryMode')?.value,
        maxAttachmentMb: document.getElementById('avlogMaxAttachmentMb')?.value,
        gofileToken: document.getElementById('avlogGofileToken')?.value,
        gofileFolder: document.getElementById('avlogGofileFolder')?.value,
        localArchivePath: document.getElementById('avlogLocalArchivePath')?.value,
        localOnlyAboveMb: document.getElementById('avlogLocalOnlyAboveMb')?.value,
        cachePathOverride: document.getElementById('avlogCachePathOverride')?.value,
        cacheFileName: document.getElementById('avlogCacheFileName')?.value,
        logMySwitches: document.getElementById('avlogLogMySwitches')?.checked,
        ignorePeople: (document.getElementById('avlogIgnorePeople')?.value || '').split('\n').filter(Boolean),
    });
    avlogRenderFeed();
    _avlogRenderHistory();
}
document.documentElement.addEventListener('languagechange', rerenderAvatarLoggerTranslations);

sendToCS({ action: 'avlogStatus' });
sendToCS({ action: 'avlogGetHistory' });
