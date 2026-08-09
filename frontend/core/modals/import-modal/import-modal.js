/* === Import Modal (Tools > Import) === */
let _importType    = '';
let _importSets    = [];
let _importGroups  = [];
let _importRunning = false;

function openImportModal(type) {
    _importType = type;
    sendToCS({ action: 'importPickFile', type });
}

function closeImportModal() {
    if (_importRunning) return;
    const modal = document.getElementById('modalImport');
    if (modal) modal.style.display = 'none';
}

// Merges physical lines back together when a quoted name contains a line break.
function _importLogicalLines(text) {
    const out = [];
    let buf = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
        if (buf !== null) {
            buf += '\n' + raw;
            if ((buf.match(/"/g) || []).length % 2 === 0) { out.push(buf); buf = null; }
            continue;
        }
        if ((raw.match(/"/g) || []).length % 2 !== 0) { buf = raw; continue; }
        out.push(raw);
    }
    if (buf !== null) out.push(buf);
    return out;
}

function _importParse(text, idPrefix) {
    const sets = [];
    let cur = null;
    for (const raw of _importLogicalLines(text)) {
        const line = raw.trim();
        if (!line) { cur = null; continue; }
        const m = line.match(/^([A-Za-z0-9_-]+)\s*,\s*([\s\S]*)$/);
        if (m && m[1].indexOf(idPrefix) === 0) {
            if (!cur) { cur = { title: '', items: [] }; sets.push(cur); }
            let name = m[2].trim();
            if (name.length > 1 && name.startsWith('"') && name.endsWith('"'))
                name = name.slice(1, -1).replace(/""/g, '"');
            if (!cur.items.some(it => it.id === m[1])) cur.items.push({ id: m[1], name });
        } else {
            cur = { title: line, items: [] };
            sets.push(cur);
        }
    }
    return sets.filter(s => s.items.length > 0);
}

function _importDefaultTarget(title) {
    const raw = String(title || '');
    const dot = raw.lastIndexOf('·');
    const clean = (dot >= 0 ? raw.slice(dot + 1) : raw).trim().toLowerCase();
    if (!clean) return '';
    const hit = _importGroups.find(g => String(g.displayName || g.name || '').trim().toLowerCase() === clean);
    return hit ? hit.name : '';
}

function renderImportModal(payload) {
    if (!payload || payload.type !== _importType) return;
    _importGroups  = payload.groups || [];
    _importRunning = false;
    _importSets    = _importParse(payload.text, _importType === 'avatars' ? 'avtr_' : 'wrld_');

    const modal   = document.getElementById('modalImport');
    if (!modal) return;
    const titleEl = document.getElementById('importTitle');
    const descEl  = document.getElementById('importDesc');
    const rowsEl  = document.getElementById('importRows');
    const statEl  = document.getElementById('importStatus');
    const btn     = document.getElementById('importStartBtn');

    if (titleEl) titleEl.textContent = t('import.title.' + _importType, _importType);
    if (descEl)  descEl.textContent  = t('import.desc.' + _importType, '');
    if (statEl)  statEl.textContent  = '';
    if (btn)     btn.disabled = _importSets.length === 0;
    if (!rowsEl) return;
    rowsEl.innerHTML = '';

    if (!_importSets.length) {
        const empty = document.createElement('div');
        empty.className = 'imp-empty';
        empty.textContent = t('import.empty', 'Nothing to import');
        rowsEl.appendChild(empty);
        modal.style.display = 'flex';
        return;
    }

    _importSets.forEach((set, i) => {
        const row = document.createElement('div');
        row.className = 'imp-row';

        const info = document.createElement('div');
        info.className = 'imp-row-info';
        const name = document.createElement('div');
        name.className = 'imp-row-title';
        name.textContent = set.title || t('import.untitled', 'Untitled');
        name.title = name.textContent;
        const count = document.createElement('div');
        count.className = 'imp-row-count';
        count.textContent = tf('import.entries', { count: set.items.length }, '{count} entries');
        info.append(name, count);

        const arrow = document.createElement('span');
        arrow.className = 'msi imp-row-arrow';
        arrow.textContent = 'arrow_forward';

        const sel = document.createElement('select');
        sel.className = 'vrcn-dropdown imp-row-select';
        sel.dataset.impIndex = String(i);
        const skip = document.createElement('option');
        skip.value = '';
        skip.textContent = t('import.skip', 'Skip');
        sel.appendChild(skip);
        _importGroups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.name;
            opt.textContent = g.displayName || g.name;
            sel.appendChild(opt);
        });
        sel.value = _importDefaultTarget(set.title);

        row.append(info, arrow, sel);
        rowsEl.appendChild(row);
        if (typeof initVnSelect === 'function') initVnSelect(sel);
    });

    modal.style.display = 'flex';
}

function importStart() {
    if (_importRunning) return;
    const rowsEl = document.getElementById('importRows');
    const statEl = document.getElementById('importStatus');
    if (!rowsEl) return;

    const byName = {};
    _importGroups.forEach(g => { byName[g.name] = g; });

    const entries = [];
    rowsEl.querySelectorAll('select.imp-row-select').forEach(sel => {
        const set = _importSets[parseInt(sel.dataset.impIndex, 10)];
        const grp = byName[sel.value];
        if (!set || !grp) return;
        set.items.forEach(it => entries.push({ id: it.id, groupName: grp.name, groupType: grp.type }));
    });

    if (!entries.length) {
        if (statEl) statEl.textContent = t('import.nothing_selected', 'Select at least one target group');
        return;
    }

    _importRunning = true;
    const btn = document.getElementById('importStartBtn');
    if (btn) btn.disabled = true;
    if (statEl) statEl.textContent = tf('import.running', { done: 0, total: entries.length }, 'Importing... {done}/{total}');
    sendToCS({ action: 'importFavorites', type: _importType, entries });
}

function onImportProgress(payload) {
    if (!payload || payload.type !== _importType) return;
    const statEl = document.getElementById('importStatus');
    if (statEl) statEl.textContent = tf('import.running', { done: payload.done, total: payload.total }, 'Importing... {done}/{total}');
}

function onImportDone(payload) {
    if (!payload || payload.type !== _importType) return;
    _importRunning = false;
    const btn = document.getElementById('importStartBtn');
    if (btn) btn.disabled = false;
    const msg = tf('import.done', { ok: payload.ok, total: payload.total, failed: payload.failed },
        'Imported {ok} of {total}, failed: {failed}');
    const statEl = document.getElementById('importStatus');
    if (statEl) statEl.textContent = msg;
    if (typeof showToast === 'function') showToast(!payload.failed, msg);
}
