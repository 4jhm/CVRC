/* === Export Modal (Tools > Export) === */
let _exportType = '';

function openExportModal(type) {
    _exportType = type;
    const modal = document.getElementById('modalExport');
    if (!modal) return;
    const titleEl = document.getElementById('exportTitle');
    const descEl = document.getElementById('exportDesc');
    const ta = document.getElementById('exportText');
    if (titleEl) titleEl.textContent = t('export.title.' + type, type);
    if (descEl) descEl.textContent = t('export.desc.' + type, '');
    if (ta) ta.value = t('export.loading', 'Loading...');
    modal.style.display = 'flex';
    sendToCS({ action: 'exportList', type });
}

function _exportRow(id, name) {
    const safe = /[",\n]/.test(name) ? `"${name.replace(/"/g, '""')}"` : name;
    return `${id}, ${safe}`;
}

function buildExportText(categories) {
    return (categories || []).map(cat => {
        let title = cat.title ? cat.title : t('export.cat.' + cat.key, cat.key);
        if (cat.local) title = t('export.local_prefix', 'Local') + ' · ' + title;
        const items = cat.items || [];
        const rows = items.length
            ? items.map(it => _exportRow(it.id || '', it.name || '')).join('\n')
            : t('export.cat_empty', '(none)');
        return `${title}\n${rows}`;
    }).join('\n\n');
}

function renderExportModal(payload) {
    if (!payload || payload.type !== _exportType) return;
    const ta = document.getElementById('exportText');
    if (!ta) return;
    const text = buildExportText(payload.categories);
    ta.value = text.trim() ? text : t('export.empty', 'Nothing to export');
}

function exportCopy() {
    const ta = document.getElementById('exportText');
    if (!ta || !ta.value) return;
    navigator.clipboard.writeText(ta.value).then(() => {
        if (typeof showToast === 'function') showToast(true, t('export.copied', 'Copied to clipboard'));
    }).catch(() => {
        if (typeof showToast === 'function') showToast(false, t('export.copy_failed', 'Copy failed'));
    });
}

function exportSaveCsv() {
    const ta = document.getElementById('exportText');
    if (!ta || !ta.value) return;
    sendToCS({ action: 'exportSaveCsv', text: ta.value });
}
