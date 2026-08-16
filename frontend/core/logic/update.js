/* === Update UI === */

let _updatePanelOpen = false;
let _updateInstalling = false;
let _updateVersion = '';
let _updatePhase = 'idle';
let _updatePct = 0;

function updButtonHtml(icon, key, fallback) {
    return `<span class="msi" style="font-size:16px;">${icon}</span> ${t(key, fallback)}`;
}

function updStatusText() {
    if (_updatePhase === 'starting') return t('update.starting', 'Starting...');
    if (_updatePhase === 'downloading') return tf('update.downloading_progress', { percent: _updatePct }, 'Downloading... {percent}%');
    if (_updatePhase === 'installing') return t('update.installing_restarting', 'Installing & restarting...');
    return t('update.downloading', 'Downloading...');
}

function rerenderUpdateTranslations() {
    const btn = document.getElementById('updBtn');
    const status = document.getElementById('updStatus');
    if (btn) {
        if (_updatePhase === 'installing') btn.innerHTML = updButtonHtml('restart_alt', 'update.restarting', 'Restarting...');
        else if (_updatePhase === 'starting') btn.innerHTML = updButtonHtml('hourglass_empty', 'update.starting', 'Starting...');
        else btn.innerHTML = updButtonHtml('download', 'update.download_install', 'Download & Install');
    }
    if (status && document.getElementById('updProgressWrap')?.style.display !== 'none') {
        status.textContent = updStatusText();
    }
}

document.documentElement.addEventListener('languagechange', rerenderUpdateTranslations);

function showUpdateAvailable(version) {
    _updateVersion = version;
    _updatePhase = 'ready';
    _updatePct = 0;
    document.getElementById('updVersion').textContent = version;
    document.getElementById('btnUpdate').style.display = '';
    setUpdProgress(false);
    document.getElementById('updBtn').disabled = false;
    rerenderUpdateTranslations();
    _setUpdCardAvailable(version);
}

// Settings card helpers.
function _setUpdCardStatus(text) {
    const el = document.getElementById('setUpdStatus');
    if (el) el.textContent = text;
}
function _setUpdCardAvailable(version) {
    const wrap = document.getElementById('setUpdInstallWrap');
    const ver  = document.getElementById('setUpdVersion');
    if (wrap) wrap.style.display = '';
    if (ver)  ver.textContent = version;
    _setUpdCardStatus('');
}
function _setUpdCardProgress(pct) {
    const wrap = document.getElementById('setUpdProgressWrap');
    const fill = document.getElementById('setUpdProgressFill');
    const lbl  = document.getElementById('setUpdProgressStatus');
    const btn  = document.getElementById('setUpdInstallBtn');
    if (wrap) wrap.style.display = '';
    if (fill) fill.style.width = pct + '%';
    if (btn)  btn.disabled = true;
    if (lbl)  lbl.textContent = pct < 100
        ? `${t('update.downloading','Downloading...')} ${pct}%`
        : t('update.installing_restarting','Installing & restarting...');
}

function settingsCheckUpdate() {
    const btn = document.getElementById('setUpdCheckBtn');
    if (btn) { btn.disabled = true; }
    _setUpdCardStatus(t('update.checking', 'Checking...'));
    sendToCS({ action: 'checkUpdate' });
    // re-enable after a few seconds in case nothing found
    setTimeout(() => {
        if (btn) btn.disabled = false;
        const wrap = document.getElementById('setUpdInstallWrap');
        if (!wrap || wrap.style.display === 'none')
            _setUpdCardStatus(t('update.up_to_date', 'You are up to date.'));
    }, 4000);
}

function settingsInstallUpdate() {
    if (window._isLinuxUi) {
        sendToCS({ action: 'openUrl', url: 'https://github.com/shinyflvre/VRCNext/releases/latest' });
        return;
    }
    if (_updateInstalling) return;
    _updateInstalling = true;
    _updatePhase = 'starting';
    _updatePct = 0;
    const btn = document.getElementById('updBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = updButtonHtml('hourglass_empty','update.starting','Starting...'); }
    _setUpdCardProgress(0);
    rerenderUpdateTranslations();
    setUpdProgress(true, 0);
    sendToCS({ action: 'installUpdate' });
}

let _updDismiss = null;

function toggleUpdatePanel() {
    if (_updateInstalling) return;
    _updatePanelOpen = !_updatePanelOpen;
    const panel = document.getElementById('updatePanel');
    if (_updatePanelOpen) {
        panel.style.display = '';
        requestAnimationFrame(() => panel.classList.add('panel-open'));
        // close other panels
        const np = document.getElementById('notifPanel');
        if (np?.classList.contains('panel-open')) toggleNotifPanel();
        const cp = document.getElementById('chatPanel');
        if (cp?.classList.contains('panel-open')) toggleChatPanel();
        setTimeout(() => {
            _updDismiss = e => {
                const p = document.getElementById('updatePanel');
                const b = document.getElementById('btnUpdate');
                if (!p?.contains(e.target) && !b?.contains(e.target)) toggleUpdatePanel();
            };
            document.addEventListener('click', _updDismiss);
        }, 0);
    } else {
        if (_updDismiss) { document.removeEventListener('click', _updDismiss); _updDismiss = null; }
        panel.classList.remove('panel-open');
        setTimeout(() => { if (!_updatePanelOpen) panel.style.display = 'none'; }, 90);
    }
}

function startUpdate() {
    if (window._isLinuxUi) {
        sendToCS({ action: 'openUrl', url: 'https://github.com/shinyflvre/VRCNext/releases/latest' });
        return;
    }
    if (_updateInstalling) return;
    _updateInstalling = true;
    _updatePhase = 'starting';
    _updatePct = 0;
    document.getElementById('updBtn').disabled = true;
    rerenderUpdateTranslations();
    setUpdProgress(true, 0);
    _setUpdCardProgress(0);
    sendToCS({ action: 'installUpdate' });
}

function setUpdProgress(visible, pct = 0) {
    _updatePct = pct;
    document.getElementById('updProgressWrap').style.display = visible ? '' : 'none';
    document.getElementById('updProgressFill').style.width = pct + '%';
    document.getElementById('updStatus').textContent = updStatusText();
}

function onUpdateProgress(pct) {
    _updatePhase = 'downloading';
    setUpdProgress(true, pct);
    _setUpdCardProgress(pct);
}

function onUpdateReady() {
    _updatePhase = 'installing';
    _updatePct = 100;
    setUpdProgress(true, 100);
    rerenderUpdateTranslations();
    _setUpdCardProgress(100);
}

function onDbMigrationProgress(payload) {
    const pct   = payload?.percent ?? 0;
    const el    = document.getElementById('dbMigrationIndicator');
    const fill  = document.getElementById('dbMigrationFill');
    const label = document.getElementById('dbMigrationPct');
    if (!el) return;
    if (pct < 0 || pct >= 100) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'flex';
    if (fill)  fill.style.width  = pct + '%';
    if (label) label.textContent = pct + '%';
}

// ===== Changelog Modal =====

const CHANGELOG_GROUP_ID = 'grp_36c812a1-0146-4eb8-ab73-4df11c7fc0e3';
let _changelogNotes = '';
let _changelogLoading = false;
let _changelogVersionShown = '';

let _changelogPayload = null;

function openChangelogModal() {
    if (_changelogPayload) {
        onShowChangelog(_changelogPayload);
        return;
    }
    if (_changelogLoading) return;
    _changelogLoading = true;
    sendToCS({ action: 'getChangelog' });
}

function onShowChangelog(payload) {
    _changelogLoading = false;
    _changelogPayload = payload || {};
    _changelogNotes = payload?.notes || '';
    _changelogVersionShown = payload?.version || '';
    const ver = document.getElementById('changelogVersion');
    if (ver) ver.textContent = _changelogVersionShown ? 'v' + _changelogVersionShown : '';
    const banner = document.getElementById('changelogGroupBanner');
    if (banner && payload?.groupBanner) banner.src = payload.groupBanner;
    const icon = document.getElementById('changelogGroupIcon');
    if (icon && payload?.groupIcon) icon.src = payload.groupIcon;
    const name = document.getElementById('changelogGroupName');
    if (name) name.textContent = payload?.groupName || 'VRCN';
    const meta = document.getElementById('changelogGroupMeta');
    if (meta) {
        const count = payload?.groupMembers || 0;
        meta.textContent = count > 0
            ? (typeof getGroupMembersText === 'function' ? getGroupMembersText(count) : count + ' ' + t('groups.members', 'Members'))
            : '';
    }
    const joinBtn = document.getElementById('changelogJoinBtn');
    if (joinBtn && payload?.groupJoined) {
        joinBtn.disabled = true;
        joinBtn.innerHTML = `<span class="msi">check</span> ${t('changelog.joined', 'Joined!')}`;
    }
    const body = document.getElementById('changelogBody');
    if (body) {
        body.innerHTML = _changelogNotes
            ? changelogMdToHtml(_changelogNotes)
            : `<div class="cl-md-empty">${t('changelog.load_failed', 'Could not load the release notes.')}<br><a href="#" onclick="sendToCS({action:'openUrl',url:'https://github.com/shinyflvre/VRCNext/releases'});return false;">${t('changelog.view_on_github', 'View them on GitHub')}</a></div>`;
        body.scrollTop = 0;
    }
    const modal = document.getElementById('modalChangelog');
    if (modal) modal.style.display = 'flex';
}

function closeChangelogModal() {
    const modal = document.getElementById('modalChangelog');
    if (modal) modal.style.display = 'none';
}

function changelogInline(s) {
    return esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function changelogMdToHtml(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '';
    let inList = false;
    let first = true;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { closeList(); continue; }
        if (first) {
            first = false;
            if (_changelogVersionShown && /^(\*\*|#)/.test(line) && line.includes(_changelogVersionShown)) continue;
        }
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) { closeList(); html += `<div class="cl-md-h">${changelogInline(heading[1])}</div>`; continue; }
        if (/^\*\*[^*]+\*\*:?$/.test(line)) { closeList(); html += `<div class="cl-md-h">${changelogInline(line.replace(/\*\*/g, ''))}</div>`; continue; }
        if (/^[-*]\s+/.test(line)) {
            if (!inList) { html += '<ul class="cl-md-ul">'; inList = true; }
            html += `<li>${changelogInline(line.replace(/^[-*]\s+/, ''))}</li>`;
            continue;
        }
        closeList();
        html += `<p class="cl-md-p">${changelogInline(line)}</p>`;
    }
    closeList();
    return html;
}

function changelogJoinGroup() {
    const btn = document.getElementById('changelogJoinBtn');
    if (btn) btn.disabled = true;
    sendToCS({ action: 'vrcJoinGroup', groupId: CHANGELOG_GROUP_ID });
}

function onChangelogJoinResult(success) {
    const btn = document.getElementById('changelogJoinBtn');
    if (!btn) return;
    if (success) {
        btn.innerHTML = `<span class="msi" style="font-size:16px;">check</span>${t('changelog.joined', 'Joined!')}`;
    } else {
        btn.disabled = false;
    }
}
