(function () {
    'use strict';

    const COLOR_DEFS = [
        { key: 'bg-base',   defaultVal: '#0E0E15' },
        { key: 'bg-card',   defaultVal: '#22222D' },
        { key: 'bg-hover',  defaultVal: '#2A2A38' },
        { key: 'bg-input',  defaultVal: '#1A1A24' },
        { key: 'accent',    defaultVal: '#FF66CC' },
        { key: 'accent-lt', defaultVal: '#FFA0DD' },
        { key: 'tx0',       defaultVal: '#FFFFFF' },
        { key: 'tx1',       defaultVal: '#F0F0F5' },
        { key: 'tx2',       defaultVal: '#B0B0BD' },
        { key: 'tx3',       defaultVal: '#7A7A88' },
        { key: 'brd',       defaultVal: '#33333F' },
        { key: 'brd-lt',    defaultVal: '#4A4A58' },
    ];
    const EDITOR_ROWS = [
        { id: 'modal',      group: 'bg',     label: 'Modal Color',         i18n: 'vrcnplus.editor.color.modal',      targetKeys: ['bg-card'] },
        { id: 'card',       group: 'bg',     label: 'Card Color',          i18n: 'vrcnplus.editor.color.card',       targetKeys: ['bg-input'] },
        { id: 'btnActive',  group: 'bg',     label: 'Active Button Color', i18n: 'vrcnplus.editor.color.btn_active', targetKeys: ['bg-hover'] },
        { id: 'base',       group: 'bg',     label: 'Base BG',             i18n: 'vrcnplus.editor.color.base',       targetKeys: ['bg-base'] },
        { id: 'accent',     group: 'accent', label: 'Accent',              i18n: 'vrcnplus.editor.color.accent',     targetKeys: ['accent'] },
        { id: 'accentLt',   group: 'accent', label: 'Accent Light',        i18n: 'vrcnplus.editor.color.accent_lt',  targetKeys: ['accent-lt'] },
        { id: 'text',       group: 'text',   label: 'Text Color',          i18n: 'vrcnplus.editor.color.text',       targetKeys: ['tx0','tx1','tx2','tx3'] },
        { id: 'line',       group: 'border', label: 'Line Color',          i18n: 'vrcnplus.editor.color.line',       targetKeys: ['brd','brd-lt'] },
    ];
    const GROUP_ORDER = ['bg', 'accent', 'text', 'border'];
    const GROUP_LABELS = {
        bg:     { i18n: 'vrcnplus.editor.group.bg',     label: 'Backgrounds' },
        accent: { i18n: 'vrcnplus.editor.group.accent', label: 'Accent' },
        text:   { i18n: 'vrcnplus.editor.group.text',   label: 'Text' },
        border: { i18n: 'vrcnplus.editor.group.border', label: 'Lines' },
    };
    const ALL_KEY_SET    = new Set(COLOR_DEFS.map(d => d.key));
    const ROW_BY_ID      = Object.fromEntries(EDITOR_ROWS.map(r => [r.id, r]));

    const _themeCache    = {};
    const _plusCache     = {};
    const _pendingFetches = new Set();
    let _editingUserId = null;
    let _editorColors  = {};
    let _editorIsPlus  = false;

    window.vrcnPlusIsKnownPlus = function (userId) { return !!_plusCache[userId]; };

    window.vrcnPlusBadgeHtml = function (extraWrapperClass) {
        const cls   = 'fd-vrc-badge-wrap vrcn-plus-badge' + (extraWrapperClass ? ' ' + extraWrapperClass : '');
        const name  = encodeURIComponent('VRCN+ Subscriber');
        const desc  = encodeURIComponent('Awarded for subscribing to VRCN+');
        const img   = 'assets/Badges/VRCNPlus.png';
        return `<div class="${cls}" data-badge-img="${img}" data-badge-name="${name}" data-badge-desc="${desc}">`
             + `<img class="fd-vrc-badge-icon" src="${img}" alt="VRCN+ Subscriber" onerror="this.closest('.fd-vrc-badge-wrap').style.display='none'">`
             + `</div>`;
    };

    function _maybeReRenderProfile(userId) {
        const myp = document.getElementById('modalMyProfile');
        if (typeof currentVrcUser !== 'undefined' && currentVrcUser && currentVrcUser.id === userId
            && myp && myp.style.display !== 'none' && typeof renderMyProfileContent === 'function') {
            try { renderMyProfileContent(); } catch (e) { console.error('[VRCN+] re-render my-profile', e); }
        }
        const fd = document.getElementById('modalFriendDetail');
        if (typeof currentFriendDetail !== 'undefined' && currentFriendDetail && currentFriendDetail.id === userId
            && fd && fd.style.display !== 'none' && typeof renderFriendDetail === 'function') {
            try { renderFriendDetail(currentFriendDetail); } catch (e) { console.error('[VRCN+] re-render friend', e); }
        }
    }

    function _isHex(s) { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s); }
    function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _t(key, fallback) { return (typeof t === 'function') ? t(key, fallback) : fallback; }

    function _normalizeColors(input) {
        const out = {};
        if (!input || typeof input !== 'object') return out;
        for (const k of Object.keys(input)) {
            if (ALL_KEY_SET.has(k) && _isHex(input[k])) out[k] = input[k].toUpperCase();
        }
        return out;
    }

    function vrcnPlusApplyThemeToElement(el, colors) {
        if (!el) return;
        const clean = _normalizeColors(colors);
        for (const def of COLOR_DEFS) el.style.removeProperty('--' + def.key);
        if (Object.keys(clean).length === 0) {
            el.classList.remove('vrcnp-themed');
            return;
        }
        for (const k of Object.keys(clean)) el.style.setProperty('--' + k, clean[k]);
        el.classList.add('vrcnp-themed');
    }
    window.vrcnPlusApplyThemeToElement = vrcnPlusApplyThemeToElement;

    function _applyToProfileTargets(userId) {
        const colors = _themeCache[userId];
        if (typeof currentVrcUser !== 'undefined' && currentVrcUser && currentVrcUser.id === userId) {
            const box = document.querySelector('#modalMyProfile .modal-box');
            if (box) vrcnPlusApplyThemeToElement(box, colors);
        }
        if (typeof currentFriendDetail !== 'undefined' && currentFriendDetail && currentFriendDetail.id === userId) {
            const fd = document.querySelector('#modalFriendDetail .modal-box');
            if (fd) vrcnPlusApplyThemeToElement(fd, colors);
        }
        const fp = document.getElementById('fpPreview');
        if (fp && fp.dataset.uid === userId && fp.classList.contains('visible')) {
            vrcnPlusApplyThemeToElement(fp, colors);
        }
    }

    function vrcnPlusRequestTheme(userId) {
        if (!userId || typeof sendToCS !== 'function') return;
        if (_themeCache[userId] !== undefined) {
            _applyToProfileTargets(userId);
            if (_pendingFetches.has(userId)) return;
        }
        _pendingFetches.add(userId);
        sendToCS({ action: 'vrcnPlusGetTheme', userId });
    }
    window.vrcnPlusRequestTheme = vrcnPlusRequestTheme;

    function vrcnPlusOnProfileOpened(userId, targetEl) {
        if (!userId) return;
        document.querySelectorAll('#modalMyProfile .modal-box, #modalFriendDetail .modal-box').forEach(el => {
            if (el !== targetEl) vrcnPlusApplyThemeToElement(el, null);
        });
        if (targetEl) vrcnPlusApplyThemeToElement(targetEl, _themeCache[userId] || null);
        vrcnPlusRequestTheme(userId);
    }
    window.vrcnPlusOnProfileOpened = vrcnPlusOnProfileOpened;

    window.vrcnPlusTheme = function (payload) {
        if (!payload || !payload.userId) return;
        _pendingFetches.delete(payload.userId);
        const colors = (payload.theme && payload.theme.colors && typeof payload.theme.colors === 'object')
            ? _normalizeColors(payload.theme.colors)
            : null;
        _themeCache[payload.userId] = colors;
        _applyToProfileTargets(payload.userId);
        if (_editingUserId === payload.userId
            && document.getElementById('vrcnPlusEditor')?.style.display === 'flex'
            && !window._vpeDirty && colors) {
            _editorColors = { ...colors };
            _vpeRenderRows();
        }
    };

    window.vrcnPlusEntitlement = function (payload) {
        if (!payload || !payload.userId) return;
        const wasPlus = _plusCache[payload.userId];
        const isPlus  = !!payload.isPlus;
        _plusCache[payload.userId] = isPlus;
        if (_editingUserId === payload.userId) {
            _editorIsPlus = isPlus;
            _vpeUpdateLock();
        }
        if (wasPlus === undefined || wasPlus !== isPlus) _maybeReRenderProfile(payload.userId);
    };

    window.vrcnPlusSaveResult = function (payload) {
        if (!payload) return;
        if (payload.ok) {
            if (typeof showToast === 'function')
                showToast(true, _t('vrcnplus.editor.saved', 'Profile customization saved'));
            window._vpeDirty = false;
            closeVrcnPlusEditor();
        } else {
            if (typeof showToast === 'function')
                showToast(false, payload.error || _t('vrcnplus.editor.save_failed', 'Save failed'));
        }
    };

    function _cssToHex(raw) {
        const s = (raw || '').trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase();
        const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('').toUpperCase();
        return null;
    }

    function _seedColors() {
        const out = {};
        const style = getComputedStyle(document.documentElement);
        for (const def of COLOR_DEFS) {
            const hex = _cssToHex(style.getPropertyValue('--' + def.key));
            out[def.key] = hex || def.defaultVal;
        }
        return out;
    }

    function openVrcnPlusEditor() {
        if (typeof currentVrcUser === 'undefined' || !currentVrcUser || !currentVrcUser.id) {
            if (typeof showToast === 'function') showToast(false, _t('vrcnplus.editor.need_login', 'Sign in first.'));
            return;
        }
        const host = document.getElementById('vrcnPlusEditor');
        if (!host) return;

        _editingUserId = currentVrcUser.id;
        window._vpeDirty = false;
        _editorIsPlus = false;

        const cached = _themeCache[_editingUserId];
        _editorColors = cached ? { ..._seedColors(), ...cached } : _seedColors();

        _vpeRenderRows();
        _vpeUpdateLock();
        host.style.display = 'flex';
        _applyEditorToOwnProfile();

        if (typeof sendToCS === 'function') {
            sendToCS({ action: 'vrcnPlusCheckEntitlement', userId: _editingUserId });
            vrcnPlusRequestTheme(_editingUserId);
        }
        _vpePickerInit();
    }
    window.openVrcnPlusEditor = openVrcnPlusEditor;

    function closeVrcnPlusEditor() {
        _vpePickerClose();
        const host = document.getElementById('vrcnPlusEditor');
        if (host) host.style.display = 'none';
        if (_editingUserId && window._vpeDirty) {
            const box = document.querySelector('#modalMyProfile .modal-box');
            if (box) vrcnPlusApplyThemeToElement(box, _themeCache[_editingUserId]);
        }
        _editingUserId = null;
        window._vpeDirty = false;
    }
    window.closeVrcnPlusEditor = closeVrcnPlusEditor;

    function _applyEditorToOwnProfile() {
        const box = document.querySelector('#modalMyProfile .modal-box');
        if (box) vrcnPlusApplyThemeToElement(box, _editorColors);
    }

    function _vpeUpdateLock() {
        const host = document.getElementById('vrcnPlusEditor');
        const ups  = document.getElementById('vpeUpsell');
        if (!host) return;
        if (_editorIsPlus) {
            host.classList.remove('vpe-locked');
            if (ups) ups.style.display = 'none';
        } else {
            host.classList.add('vpe-locked');
            if (ups) ups.style.display = '';
        }
    }

    function _rowValue(row) {
        const k = row.targetKeys[0];
        return (_editorColors[k] || COLOR_DEFS.find(d => d.key === k)?.defaultVal || '#FFFFFF').toUpperCase();
    }

    function _vpeRenderRows() {
        const box = document.getElementById('vpeRows');
        if (!box) return;
        const byGroup = {};
        for (const row of EDITOR_ROWS) (byGroup[row.group] = byGroup[row.group] || []).push(row);

        let html = '';
        for (const groupKey of GROUP_ORDER) {
            if (!byGroup[groupKey]) continue;
            const g = GROUP_LABELS[groupKey] || { i18n: '', label: groupKey };
            html += `<div class="vpe-group"><div class="vpe-group-title">${_esc(_t(g.i18n, g.label))}</div>`;
            for (const row of byGroup[groupKey]) {
                const val = _rowValue(row);
                html += `<div class="vpe-row">
                    <span class="vpe-row-label">${_esc(_t(row.i18n, row.label))}</span>
                    <div id="vpeSwatch_${row.id}" data-vpe-row="${row.id}" class="vpe-swatch" style="background:${val};"></div>
                    <input type="text" class="vrcn-input vpe-hex" id="vpeHex_${row.id}" value="${val}" maxlength="7"
                        oninput="vpeSetColorFromHex('${row.id}', this.value)">
                </div>`;
            }
            html += `</div>`;
        }
        box.innerHTML = html;
        box.querySelectorAll('.vpe-swatch').forEach(sw => {
            sw.addEventListener('click', function (e) {
                e.stopPropagation();
                _vpePickerOpen(this.getAttribute('data-vpe-row'), this);
            });
        });
    }

    function _vpeApplyColor(rowId, hex) {
        const row = ROW_BY_ID[rowId];
        if (!row) return;
        hex = hex.toUpperCase();
        for (const k of row.targetKeys) _editorColors[k] = hex;
        window._vpeDirty = true;
        const sw   = document.getElementById('vpeSwatch_' + rowId);
        const hexEl = document.getElementById('vpeHex_' + rowId);
        if (sw)    sw.style.background = hex;
        if (hexEl) hexEl.value = hex;
        _applyEditorToOwnProfile();
    }

    window.vpeSetColorFromHex = function (rowId, raw) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) return;
        _vpeApplyColor(rowId, raw);
        if (_vpePickerState.varName === rowId) _vpePickerSyncFromHex(raw.toUpperCase());
    };

    function vrcnPlusResetEditor() {
        _editorColors = _seedColors();
        window._vpeDirty = true;
        _vpeRenderRows();
        _applyEditorToOwnProfile();
    }
    window.vrcnPlusResetEditor = vrcnPlusResetEditor;

    function vrcnPlusSaveFromEditor() {
        if (!_editingUserId) return;
        if (!_editorIsPlus) {
            if (typeof showToast === 'function')
                showToast(false, _t('vrcnplus.editor.locked', 'VRCN+ subscription required.'));
            return;
        }
        if (typeof sendToCS !== 'function') return;
        sendToCS({
            action: 'vrcnPlusSaveTheme',
            userId: _editingUserId,
            colors: _normalizeColors(_editorColors),
        });
    }
    window.vrcnPlusSaveFromEditor = vrcnPlusSaveFromEditor;

    const _vpePickerState = { varName: '', h: 0, s: 1, v: 1, draggingSV: false, draggingHue: false, inited: false };

    function _vpeHsvToHex(h, s, v) {
        const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
        return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    function _vpeHexToHsv(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255,
              g = parseInt(hex.slice(3, 5), 16) / 255,
              b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d + 6) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return { h, s: max ? d / max : 0, v: max };
    }

    function _vpePickerInit() {
        if (_vpePickerState.inited) return;
        const svC  = document.getElementById('vpePickerSV');
        const hueC = document.getElementById('vpePickerHue');
        const picker = document.getElementById('vpeColorPicker');
        if (!svC || !hueC || !picker) return;
        _vpePickerState.inited = true;

        const svPos = e => {
            const r = svC.getBoundingClientRect();
            _vpePickerState.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            _vpePickerState.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
            _vpePickerCommit();
        };
        const huePos = e => {
            const r = hueC.getBoundingClientRect();
            _vpePickerState.h = Math.max(0, Math.min(359.99, ((e.clientX - r.left) / r.width) * 360));
            _vpePickerCommit();
        };

        svC.addEventListener('mousedown',  e => { _vpePickerState.draggingSV  = true; svPos(e);  e.preventDefault(); });
        hueC.addEventListener('mousedown', e => { _vpePickerState.draggingHue = true; huePos(e); e.preventDefault(); });
        document.addEventListener('mousemove', e => {
            if (_vpePickerState.draggingSV)  svPos(e);
            if (_vpePickerState.draggingHue) huePos(e);
        });
        document.addEventListener('mouseup', () => {
            _vpePickerState.draggingSV = false;
            _vpePickerState.draggingHue = false;
        });
        document.addEventListener('mousedown', e => {
            if (picker.style.display === 'none') return;
            if (!picker.contains(e.target) && !e.target.classList.contains('vpe-swatch')) _vpePickerClose();
        });
    }

    function _vpePickerOpen(varName, anchorEl) {
        const picker = document.getElementById('vpeColorPicker');
        if (!picker) return;
        if (_vpePickerState.varName === varName && picker.style.display === 'block') {
            _vpePickerClose();
            return;
        }
        const row = ROW_BY_ID[varName];
        const hex = (row ? _rowValue(row) : '#888888').toUpperCase();
        const hsv = _vpeHexToHsv(hex);
        Object.assign(_vpePickerState, { varName, h: hsv.h, s: hsv.s, v: hsv.v });

        const panel = document.getElementById('vrcnPlusEditor');
        picker.style.display = 'block';
        const pW = picker.offsetWidth || 220;
        const pRect = panel.getBoundingClientRect();
        const aRect = anchorEl.getBoundingClientRect();
        const left = Math.max(8, pRect.left - pW - 8);
        const top  = Math.min(Math.max(8, aRect.top - 10),
                              window.innerHeight - (picker.offsetHeight || 300) - 8);
        picker.style.left = left + 'px';
        picker.style.top  = top + 'px';

        document.getElementById('vpePickerHex').value = hex;
        document.getElementById('vpePickerPreview').style.background = hex;
        _vpePickerDraw();
    }

    function _vpePickerClose() {
        const p = document.getElementById('vpeColorPicker');
        if (p) p.style.display = 'none';
        _vpePickerState.varName = '';
    }

    function _vpePickerDraw() { _vpePickerDrawSV(); _vpePickerDrawHue(); }

    function _vpePickerDrawSV() {
        const c = document.getElementById('vpePickerSV');
        if (!c) return;
        const ctx = c.getContext('2d');
        const W = c.width, H = c.height;
        ctx.fillStyle = _vpeHsvToHex(_vpePickerState.h, 1, 1);
        ctx.fillRect(0, 0, W, H);
        const wg = ctx.createLinearGradient(0, 0, W, 0);
        wg.addColorStop(0, 'rgba(255,255,255,1)');
        wg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, 'rgba(0,0,0,0)');
        bg.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        const cx = _vpePickerState.s * W, cy = (1 - _vpePickerState.v) * H;
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
    }

    function _vpePickerDrawHue() {
        const c = document.getElementById('vpePickerHue');
        if (!c) return;
        const ctx = c.getContext('2d');
        const W = c.width, H = c.height;
        const g = ctx.createLinearGradient(0, 0, W, 0);
        for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const cx = (_vpePickerState.h / 360) * W;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(cx - 5, 0, 10, H);
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.strokeRect(cx - 5, 0, 10, H);
    }

    function _vpePickerCommit() {
        const hex = _vpeHsvToHex(_vpePickerState.h, _vpePickerState.s, _vpePickerState.v);
        const hexEl = document.getElementById('vpePickerHex');
        const prev  = document.getElementById('vpePickerPreview');
        if (hexEl) hexEl.value = hex;
        if (prev)  prev.style.background = hex;
        _vpePickerDraw();
        _vpeApplyColor(_vpePickerState.varName, hex);
    }

    window.vpePickerHexInput = function (raw) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) return;
        _vpePickerSyncFromHex(raw.toUpperCase());
        _vpeApplyColor(_vpePickerState.varName, raw.toUpperCase());
    };

    function _vpePickerSyncFromHex(hex) {
        const hsv = _vpeHexToHsv(hex);
        Object.assign(_vpePickerState, hsv);
        const p = document.getElementById('vpePickerPreview');
        if (p) p.style.background = hex;
        _vpePickerDraw();
    }

    window.vpePickerEyedropper = async function () {
        if (!window.EyeDropper) return;
        try {
            const result = await new EyeDropper().open();
            const hex = result.sRGBHex.toUpperCase();
            const hexEl = document.getElementById('vpePickerHex');
            if (hexEl) hexEl.value = hex;
            _vpePickerSyncFromHex(hex);
            _vpeApplyColor(_vpePickerState.varName, hex);
        } catch {}
    };
})();
