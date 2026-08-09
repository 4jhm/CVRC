

let enData    = {};
let transData = {};
let allKeys   = [];
let activeFilter = 'all';
let searchQuery  = '';

let fnrMatches = [];
let fnrCurrent = -1;

const tableBody       = document.getElementById('tableBody');
const searchInput     = document.getElementById('searchInput');
const btnClearSearch  = document.getElementById('btnClearSearch');
const progressLabel   = document.getElementById('progressLabel');
const progressFill    = document.getElementById('progressFill');
const visibleCount    = document.getElementById('visibleCount');
const thLangName      = document.getElementById('thLangName');
const langNameInput   = document.getElementById('langName');
const langCodeInput   = document.getElementById('langCode');
const langAuthorInput = document.getElementById('langAuthor');
const emptyState      = document.getElementById('emptyState');
const loadingState    = document.getElementById('loadingState');
const mainTable       = document.getElementById('mainTable');

const fnrBar          = document.getElementById('fnrBar');
const fnrFindInput    = document.getElementById('fnrFind');
const fnrReplaceInput = document.getElementById('fnrReplace');
const fnrMatchCount   = document.getElementById('fnrMatchCount');
const fnrCaseChk       = document.getElementById('fnrCase');
const fnrRegexChk      = document.getElementById('fnrRegex');
const fnrScopeSelect   = document.getElementById('fnrScope');
const fnrMatchModeSelect = document.getElementById('fnrMatchMode');

function sendToCS(obj) {
  window.external.sendMessage(JSON.stringify(obj));
}

window.external.receiveMessage(raw => {
  try {
    const msg = JSON.parse(raw);
    switch (msg.type) {
      case 'en_data':
        enData  = msg.data;
        allKeys = Object.keys(enData);
        showTable();
        buildTable();
        updateProgress();
        break;

      case 'translation_loaded':
        applyTranslationData(msg.data, msg.filename);
        break;

      case 'save_ok':
        showToast(`Saved ${msg.filename}`, 'ok');
        break;

      case 'error':
        showToast(msg.message, 'err');
        break;
    }
  } catch (e) {
    showToast('Message parse error: ' + e.message, 'err');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  sendToCS({ type: 'ready' });
});

function showTable() {
  loadingState.style.display = 'none';
  mainTable.style.display    = '';
}

function applyTranslationData(json, filename) {
  transData = {};
  let loaded = 0;

  Object.entries(json).forEach(([k, v]) => {
    if (k.startsWith('_')) return;
    if (typeof v === 'string' && v.trim()) { transData[k] = v; loaded++; }
  });

  if (json._language) { langNameInput.value = json._language; thLangName.textContent = json._language; }
  if (json._code)     langCodeInput.value  = json._code;
  if (json._author)   langAuthorInput.value = json._author;

  buildTable(true);
  showToast(`Loaded ${loaded} translations from ${filename}`, 'ok');
}

function syncFromDOM() {
  tableBody.querySelectorAll('.vrcn-i18n-cell-input').forEach(inp => {
    const key = inp.dataset.key;
    if (!key) return;
    const val = inp.value;
    if (val.trim().length > 0) transData[key] = val;
    else delete transData[key];
  });
}

function buildTable(skipSync = false) {
  if (!skipSync) syncFromDOM();
  tableBody.innerHTML = '';
  fnrMatches = [];
  fnrCurrent = -1;

  const q = searchQuery.toLowerCase();
  let lastGroup   = null;
  let visibleRows = 0;

  allKeys.forEach((key, idx) => {
    const enVal  = enData[key]  ?? '';
    const trVal  = transData[key] ?? '';
    const isDone = trVal.trim().length > 0;

    if (activeFilter === 'missing' && isDone)  return;
    if (activeFilter === 'done'    && !isDone) return;
    if (q && !key.toLowerCase().includes(q) &&
             !enVal.toLowerCase().includes(q) &&
             !trVal.toLowerCase().includes(q)) return;

    
    if (fnrBar.style.display !== 'none') {
      const rx = buildFnrRegex();
      if (rx) {
        const scope = fnrScopeSelect.value;
        let fnrMatch = false;
        if (scope === 'translations' || scope === 'all') { if (rx.test(trVal))  fnrMatch = true; rx.lastIndex = 0; }
        if (scope === 'keys'         || scope === 'all') { if (rx.test(key))    fnrMatch = true; rx.lastIndex = 0; }
        if (scope === 'english'      || scope === 'all') { if (rx.test(enVal))  fnrMatch = true; rx.lastIndex = 0; }
        if (!fnrMatch) return;
      }
    }

    const group = key.split('.')[0];
    if (group !== lastGroup) {
      const gr = document.createElement('tr');
      gr.className = 'vrcn-i18n-group-row';
      gr.innerHTML = `<td colspan="5">${escHtml(group)}</td>`;
      tableBody.appendChild(gr);
      lastGroup = group;
    }

    const tr = document.createElement('tr');
    tr.className = `vrcn-i18n-row${isDone ? ' vrcn-i18n-row-done' : ' vrcn-i18n-row-missing'}`;
    tr.dataset.key = key;

    tr.innerHTML = `
      <td class="vrcn-i18n-td vrcn-i18n-td-idx">${idx + 1}</td>
      <td class="vrcn-i18n-td vrcn-i18n-td-key" title="${escAttr(key)}">
        <span class="vrcn-i18n-key-text">${escHtml(key)}</span>
      </td>
      <td class="vrcn-i18n-td vrcn-i18n-td-en" title="${escAttr(enVal)}">
        <span class="vrcn-i18n-en-text">${escHtml(enVal)}</span>
      </td>
      <td class="vrcn-i18n-td vrcn-i18n-td-input">
        <input
          class="vrcn-i18n-cell-input${isDone ? ' vrcn-i18n-input-filled' : ''}"
          type="text"
          value="${escAttr(trVal)}"
          placeholder="${escAttr(enVal)}"
          data-key="${escAttr(key)}"
          spellcheck="false"
        />
      </td>
      <td class="vrcn-i18n-td vrcn-i18n-td-status">
        <span class="vrcn-i18n-status-dot${isDone ? ' vrcn-i18n-dot-done' : ' vrcn-i18n-dot-missing'}"></span>
      </td>
    `;

    tableBody.appendChild(tr);

    const cellInp = tr.querySelector('.vrcn-i18n-cell-input');
    if (cellInp) {
      cellInp.addEventListener('input', () => {
        const k = cellInp.dataset.key;
        const v = cellInp.value;
        if (v.trim().length > 0) {
          transData[k] = v;
          cellInp.classList.add('vrcn-i18n-input-filled');
          setRowStatus(tr, true);
        } else {
          delete transData[k];
          cellInp.classList.remove('vrcn-i18n-input-filled');
          setRowStatus(tr, false);
        }
        updateProgress();
      });
    }

    visibleRows++;
  });

  updateProgress();
  updateVisibleCount(visibleRows);
  emptyState.style.display = (visibleRows === 0 && allKeys.length > 0) ? 'flex' : 'none';

  if (fnrBar.style.display !== 'none') fnrRunFind(false);
}

tableBody.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
  const inp = e.target;
  if (!inp.classList.contains('vrcn-i18n-cell-input')) return;
  const all  = Array.from(tableBody.querySelectorAll('.vrcn-i18n-cell-input'));
  const next = e.shiftKey ? all[all.indexOf(inp) - 1] : all[all.indexOf(inp) + 1];
  if (next) { e.preventDefault(); next.focus(); next.select(); next.closest('tr')?.scrollIntoView({ block: 'nearest' }); }
});

function setRowStatus(tr, done) {
  if (!tr) return;
  tr.classList.toggle('vrcn-i18n-row-done',    done);
  tr.classList.toggle('vrcn-i18n-row-missing', !done);
  const dot = tr.querySelector('.vrcn-i18n-status-dot');
  if (dot) {
    dot.classList.toggle('vrcn-i18n-dot-done',    done);
    dot.classList.toggle('vrcn-i18n-dot-missing', !done);
  }
}

function updateProgress() {
  const total = allKeys.length;
  const done  = Object.keys(transData).filter(k => transData[k]?.trim()).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  progressLabel.textContent = `${done} / ${total} translated (${pct}%)`;
  progressFill.style.width  = `${pct}%`;
}

function updateVisibleCount(n) {
  visibleCount.textContent = n > 0 ? `${n} entries` : '';
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  btnClearSearch.classList.toggle('visible', searchQuery.length > 0);
  buildTable();
});

btnClearSearch.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  btnClearSearch.classList.remove('visible');
  buildTable();
  searchInput.focus();
});

document.querySelectorAll('.vrcn-i18n-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vrcn-i18n-chip').forEach(b => b.classList.remove('vrcn-i18n-chip-active'));
    btn.classList.add('vrcn-i18n-chip-active');
    activeFilter = btn.dataset.filter;
    buildTable();
  });
});

langNameInput.addEventListener('input', () => {
  thLangName.textContent = langNameInput.value.trim() || '';
});

document.getElementById('btnLoad').addEventListener('click', () => {
  sendToCS({ type: 'load_translation' });
});

document.getElementById('btnSave').addEventListener('click', () => {
  if (allKeys.length === 0) { showToast('No keys loaded yet.', 'warn'); return; }

  const out = {};
  allKeys.forEach(key => { out[key] = transData[key] ?? ''; });

  sendToCS({
    type: 'save',
    data: out,
    meta: {
      _language: langNameInput.value.trim()   || 'Unknown',
      _code:     langCodeInput.value.trim()   || 'xx',
      _author:   langAuthorInput.value.trim() || '',
    },
  });
});

document.getElementById('btnClear').addEventListener('click', () => {
  syncFromDOM();
  if (!Object.keys(transData).length) { showToast('Nothing to clear.', 'warn'); return; }
  if (!confirm(`Clear all ${Object.keys(transData).length} translations? This cannot be undone.`)) return;
  transData = {};
  buildTable(true);
  showToast('All translations cleared.', 'warn');
});

document.getElementById('btnToggleFnr').addEventListener('click', () => toggleFnr());
document.getElementById('btnFnrClose').addEventListener('click', () => closeFnr());

function toggleFnr() {
  if (fnrBar.style.display === 'none') {
    fnrBar.style.display = 'flex';
    fnrFindInput.focus();
    fnrFindInput.select();
    buildTable();
  } else {
    closeFnr();
  }
}

function closeFnr() {
  fnrBar.style.display = 'none';
  fnrMatches = [];
  fnrCurrent = -1;
  fnrMatchCount.textContent = '';
  fnrFindInput.value = '';
  fnrFindInput.classList.remove('vrcn-i18n-fnr-no-match');
  buildTable(); 
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); toggleFnr(); }
  if (e.key === 'Escape' && fnrBar.style.display !== 'none') closeFnr();
});

fnrFindInput.addEventListener('input',         () => buildTable());
fnrCaseChk.addEventListener('change',         () => buildTable());
fnrRegexChk.addEventListener('change',        () => buildTable());
fnrScopeSelect.addEventListener('change',     () => buildTable());
fnrMatchModeSelect.addEventListener('change', () => buildTable());

fnrFindInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? fnrStep(-1) : fnrStep(1); }
});

document.getElementById('btnFindNext').addEventListener('click', () => fnrStep(1));
document.getElementById('btnFindPrev').addEventListener('click', () => fnrStep(-1));
document.getElementById('btnReplaceOne').addEventListener('click', fnrReplaceOne);
document.getElementById('btnReplaceAll').addEventListener('click', fnrReplaceAll);
document.getElementById('btnMassPlace').addEventListener('click', fnrMassPlace);

function buildFnrRegex() {
  let raw = fnrFindInput.value;
  if (!raw) return null;

  if (!fnrRegexChk.checked) {
    raw = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    
    switch (fnrMatchModeSelect.value) {
      case 'word':   raw = `^${raw}$`;        break; 
      case 'starts': raw = `^${raw}`;         break;
      case 'ends':   raw = `${raw}$`;         break;
      
    }
  }

  try { return new RegExp(raw, fnrCaseChk.checked ? 'gm' : 'gim'); } catch { return null; }
}

function fnrRunFind(keepCurrent) {
  clearFnrHighlights();
  fnrMatches = [];
  const rx = buildFnrRegex();
  fnrFindInput.classList.toggle('vrcn-i18n-fnr-no-match', false);

  if (!rx) { fnrMatchCount.textContent = ''; fnrCurrent = -1; return; }

  const scope = fnrScopeSelect.value;

  tableBody.querySelectorAll('tr.vrcn-i18n-row').forEach(tr => {
    const key   = tr.dataset.key;
    const enVal = enData[key] ?? '';
    const trInp = tr.querySelector('.vrcn-i18n-cell-input');

    let matched = false;

    if (scope === 'translations' || scope === 'all') {
      if (trInp && rx.test(trInp.value)) matched = true;
      rx.lastIndex = 0;
    }
    if (scope === 'keys' || scope === 'all') {
      if (rx.test(key)) matched = true;
      rx.lastIndex = 0;
    }
    if (scope === 'english' || scope === 'all') {
      if (rx.test(enVal)) matched = true;
      rx.lastIndex = 0;
    }

    if (matched) {
      fnrMatches.push({ key, inputEl: trInp, tr });
    }
  });

  const count = fnrMatches.length;
  if (count === 0) {
    fnrFindInput.classList.add('vrcn-i18n-fnr-no-match');
    fnrMatchCount.textContent = 'no matches';
    fnrCurrent = -1;
    return;
  }

  if (!keepCurrent || fnrCurrent < 0 || fnrCurrent >= count) fnrCurrent = 0;
  highlightCurrent(false);
  fnrMatchCount.textContent = `${fnrCurrent + 1} / ${count}`;
}

function fnrStep(dir) {
  if (!fnrMatches.length) { fnrRunFind(false); return; }
  fnrCurrent = (fnrCurrent + dir + fnrMatches.length) % fnrMatches.length;
  highlightCurrent(true);
  fnrMatchCount.textContent = `${fnrCurrent + 1} / ${fnrMatches.length}`;
}

function highlightCurrent(moveFocus = false) {
  fnrMatches.forEach((m, i) => {
    m.tr.classList.toggle('vrcn-i18n-match-current', i === fnrCurrent);
  });
  const cur = fnrMatches[fnrCurrent];
  if (cur) {
    cur.tr.scrollIntoView({ block: 'nearest' });
    if (moveFocus && cur.inputEl) { cur.inputEl.focus(); cur.inputEl.select(); }
  }
}

function clearFnrHighlights() {
  tableBody.querySelectorAll('.vrcn-i18n-match-current')
    .forEach(el => el.classList.remove('vrcn-i18n-match-current'));
}

function fnrReplaceOne() {
  if (!fnrMatches.length || fnrCurrent < 0) { showToast('No match selected.', 'warn'); return; }
  const rx  = buildFnrRegex();
  if (!rx)  return;
  const cur = fnrMatches[fnrCurrent];
  if (!cur.inputEl) { showToast('Cannot replace — match is not in translation column.', 'warn'); return; }
  cur.inputEl.value = cur.inputEl.value.replace(rx, fnrReplaceInput.value);
  cur.inputEl.dispatchEvent(new Event('input'));
  fnrRunFind(true);
  fnrFindInput.focus();
  showToast('Replaced 1 match.', 'ok');
}

function fnrReplaceAll() {
  const rx          = buildFnrRegex();
  const replacement = fnrReplaceInput.value;
  if (!rx || !fnrMatches.length) { showToast('No matches to replace.', 'warn'); return; }

  let replaced = 0;
  fnrMatches.forEach(m => {
    if (!m.inputEl) return;
    const before = m.inputEl.value;
    if (before.trim() === '') return; 
    const after = before.replace(rx, replacement);
    if (after !== before) {
      m.inputEl.value = after;
      m.inputEl.dispatchEvent(new Event('input'));
      replaced++;
    }
  });

  fnrRunFind(false);
  fnrFindInput.focus();
  showToast(`Replaced ${replaced} of ${fnrMatches.length} entries.`, replaced > 0 ? 'ok' : 'warn');
}

function fnrMassPlace() {
  const replacement = fnrReplaceInput.value;
  if (!replacement.trim()) { showToast('Enter a replacement text first.', 'warn'); return; }
  if (!fnrMatches.length)  { showToast('No matches to fill.', 'warn'); return; }

  let filled = 0;
  fnrMatches.forEach(m => {
    if (!m.inputEl) return;
    if (m.inputEl.value.trim() !== '') return; 
    m.inputEl.value = replacement;
    m.inputEl.dispatchEvent(new Event('input'));
    filled++;
  });

  fnrRunFind(false);
  fnrFindInput.focus();
  showToast(`Filled ${filled} empty translation${filled !== 1 ? 's' : ''}.`, filled > 0 ? 'ok' : 'warn');
}

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `vrcn-i18n-toast vrcn-i18n-toast-show${type ? ` vrcn-i18n-toast-${type}` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'vrcn-i18n-toast'; }, 2800);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
