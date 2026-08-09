// Media Relay

function renderRelayFolders() {
    const el = document.getElementById('relayFolderList');
    if (!el) return;
    const folders = settings.folders || [];
    if (folders.length === 0) {
        el.innerHTML = `<div class="empty-msg">${t('relay.folders.empty', 'No watch folders configured. Add folders in Settings.')}</div>`;
        return;
    }
    const enabled = settings.relayEnabledFolders; // null = all enabled
    el.innerHTML = folders.map((path, i) => {
        const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
        const isEnabled = enabled === null || enabled.includes(path);
        return `<div class="relay-folder-row">
            <span class="msi relay-folder-icon">folder</span>
            <div class="relay-folder-info">
                <div class="relay-folder-name">${esc(name)}</div>
                <div class="relay-folder-path">${esc(path)}</div>
            </div>
            <label class="toggle"><input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleRelayFolder(${i},this.checked)"><div class="toggle-track"><div class="toggle-knob"></div></div></label>
        </div>`;
    }).join('');
}

function toggleRelayFolder(idx, isEnabled) {
    const folders = settings.folders || [];
    const path = folders[idx];
    if (!path) return;
    // First toggle: initialize from all-enabled
    if (settings.relayEnabledFolders === null) {
        settings.relayEnabledFolders = [...folders];
    }
    if (isEnabled) {
        if (!settings.relayEnabledFolders.includes(path))
            settings.relayEnabledFolders.push(path);
    } else {
        settings.relayEnabledFolders = settings.relayEnabledFolders.filter(p => p !== path);
    }
    autoSave();
}

function addFileToList(f) {
    postedFiles.unshift(f);
    renderFileList();
}

function renderFileList() {
    const e = document.getElementById('fileList');
    if (!postedFiles.length) {
        e.innerHTML = `<div class="empty-msg">${t('relay.empty.posted_files', 'No files posted yet')}</div>`;
        return;
    }
    e.innerHTML = postedFiles.map((f, i) =>
        `<div class="file-row"><span class="file-name">${esc(f.name)}</span><span class="file-channel">${esc(f.channel)}</span><span class="file-size">${f.size}</span><span class="file-time">${f.time}</span><button class="file-del" onclick="deleteFile(${i})" title="${esc(t('common.delete', 'Delete'))}"><span class="msi" style="font-size:16px;">delete</span></button></div>`
    ).join('');
}

function deleteFile(i) {
    const f = postedFiles[i];
    if (f?.messageId) sendToCS({ action: 'deletePost', messageId: f.messageId, webhookUrl: f.webhookUrl });
}

function renderWebhookCards(w) {
    const e = document.getElementById('whCards');
    if (!e) return;
    const s = (w || []).slice(0, 4);
    while (s.length < 4) s.push({});
    const incomingEmpty = s.every(x => !(x.Name || x.name || x.Url || x.url || x.Enabled || x.enabled));
    const domHasValues = [0, 1, 2, 3].some(i => {
        const u = document.getElementById('whUrl' + i), n = document.getElementById('whName' + i);
        return (u && u.value.trim()) || (n && n.value.trim());
    });
    if (incomingEmpty && domHasValues) return;
    e.innerHTML = s.map((w, i) =>
        `<div class="wh-card"><div class="wh-top"><span class="wh-num">#${i + 1}</span><input class="vrcn-edit-field" id="whName${i}" value="${esc(w.Name || w.name || '')}" placeholder="${esc(tf('relay.webhook.channel_placeholder', { index: i + 1 }, `Channel ${i + 1}`))}" style="width:120px;" oninput="autoSave()"><label class="toggle"><input type="checkbox" id="whOn${i}" ${(w.Enabled || w.enabled) ? 'checked' : ''} onchange="autoSave()"><div class="toggle-track"><div class="toggle-knob"></div></div></label></div><input class="vrcn-edit-field" id="whUrl${i}" value="${esc(w.Url || w.url || '')}" placeholder="${esc(t('relay.webhook.url_placeholder', 'https://discord.com/api/webhooks/...'))}" style="width:100%;" oninput="autoSave()"></div>`
    ).join('');
}
