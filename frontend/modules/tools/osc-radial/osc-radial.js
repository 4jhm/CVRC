// OSC Radial Menu — a quick-access radial control built from the same shared
// OscService state the OSC Tool already exposes (osc-tool.js). VRChat gives no
// API/OSC access to the real in-game Action Menu's layout, icons, or submenu
// tree (that's baked into the avatar's Unity asset), so this builds its own
// paged 8-slot wheel from the avatar's live parameter list instead.
let oscmConnected = false;
let oscmAvatarId = '';
let oscmParamDefs = [];    // [{Name,Type,HasInput,HasOutput}] — input-capable only
let oscmParamValues = {};  // name -> current value
let oscmPage = 'emotes';   // 'emotes' | 0-based param page index

const OSCM_WEDGES = 8;
const OSCM_PARAMS_PER_PAGE = OSCM_WEDGES - 1; // slot 0 on param pages is reserved for Back
const OSCM_CX = 170, OSCM_CY = 170, OSCM_R_OUTER = 160, OSCM_R_INNER = 62, OSCM_R_GAP = 2;
const OSCM_EMOTE_KEYS  = ['wave', 'clap', 'point', 'cheer', 'dance', 'backflip', 'die', 'sad'];
const OSCM_EMOTE_ICONS = ['waving_hand', 'front_hand', 'touch_app', 'celebration', 'nightlife', 'sports_gymnastics', 'heart_broken', 'sentiment_dissatisfied'];

let _oscmDragIdx = null;
let _oscmSendTimer = null, _oscmSendPending = null;

function oscmConnect() {
    sendToCS({ action: 'oscConnect' });
}

function oscmHandleState(payload) {
    oscmConnected = !!(payload && payload.connected);
    const dot = document.getElementById('oscmDot');
    const txt = document.getElementById('oscmStatusText');
    const btn = document.getElementById('oscmConnBtn');
    if (dot) dot.className = `sf-dot ${oscmConnected ? 'online' : 'offline'}`;
    if (txt) txt.textContent = t(oscmConnected ? 'osc.status.connected' : 'osc.status.not_connected', oscmConnected ? 'Connected' : 'Not connected');
    if (btn) btn.style.display = oscmConnected ? 'none' : '';
    oscmRender();
}

function oscmHandleAvatarParams(payload) {
    oscmAvatarId = (payload && payload.avatarId) || '';
    const list = (payload && payload.paramList) || [];
    oscmParamDefs = list.filter(p => p && p.HasInput && p.Name !== 'VRCEmote');
    oscmParamValues = {};
    if (typeof oscmPage === 'number') oscmPage = 0;
    oscmRender();
}

function oscmHandleParam(payload) {
    if (!payload || !payload.name) return;
    oscmParamValues[payload.name] = payload.value;
    oscmUpdateWedgeVisual(payload.name);
}

function oscmParamPageCount() {
    return Math.max(1, Math.ceil(oscmParamDefs.length / OSCM_PARAMS_PER_PAGE));
}

function oscmCyclePage() {
    if (oscmPage === 'emotes') {
        if (oscmParamDefs.length > 0) oscmPage = 0;
        oscmRender();
        return;
    }
    const pages = oscmParamPageCount();
    oscmPage = (oscmPage + 1 < pages) ? oscmPage + 1 : 'emotes';
    oscmRender();
}

function oscmCurrentWedges() {
    if (oscmPage === 'emotes') {
        return OSCM_EMOTE_KEYS.map((key, i) => ({
            kind: 'emote',
            emote: i + 1,
            icon: OSCM_EMOTE_ICONS[i],
            label: t(`osc.emotes.${key}`, key.charAt(0).toUpperCase() + key.slice(1)),
        }));
    }
    // Slot 0 is always a Back wedge on param pages, mirroring VRChat's own radial menu.
    const wedges = [{ kind: 'back', icon: 'arrow_back', label: t('common.back', 'Back') }];
    const start = oscmPage * OSCM_PARAMS_PER_PAGE;
    oscmParamDefs.slice(start, start + OSCM_PARAMS_PER_PAGE)
        .forEach(p => wedges.push({ kind: p.Type, name: p.Name, label: p.Name }));
    return wedges;
}

function oscmTruncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function oscmValueLabel(w) {
    if (w.kind === 'bool') return oscmParamValues[w.name] ? t('common.on', 'On') : t('common.off', 'Off');
    if (w.kind === 'int') return String(Number(oscmParamValues[w.name]) || 0);
    return '';
}

function oscmPolar(cx, cy, r, angleDeg) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function oscmWedgePath(cx, cy, rInner, rOuter, startDeg, endDeg) {
    const p1 = oscmPolar(cx, cy, rOuter, startDeg);
    const p2 = oscmPolar(cx, cy, rOuter, endDeg);
    const p3 = oscmPolar(cx, cy, rInner, endDeg);
    const p4 = oscmPolar(cx, cy, rInner, startDeg);
    return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 0 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 0 0 ${p4.x} ${p4.y} Z`;
}

function oscmWedgeAngles(idx) {
    const step = 360 / OSCM_WEDGES;
    return { start: idx * step + OSCM_R_GAP / 2, end: (idx + 1) * step - OSCM_R_GAP / 2 };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function oscmRender() {
    const svg = document.getElementById('oscmWheel');
    const hint = document.getElementById('oscmHint');
    if (!svg) return;
    svg.innerHTML = '';

    const wedges = oscmCurrentWedges();
    const interactive = oscmConnected && (oscmPage === 'emotes' || oscmParamDefs.length > 0);

    if (hint) {
        if (!oscmConnected) {
            hint.style.display = '';
            hint.textContent = t('oscm.hint.connect', 'Connect to OSC above, then load into an avatar with parameters to fill this menu.');
        } else if (oscmPage !== 'emotes' && oscmParamDefs.length === 0) {
            hint.style.display = '';
            hint.textContent = t('oscm.hint.no_params', 'No input-capable parameters found for the current avatar yet.');
        } else {
            hint.style.display = 'none';
        }
    }

    wedges.forEach((w, i) => {
        const { start, end } = oscmWedgeAngles(i);
        const mid = (start + end) / 2;

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', oscmWedgePath(OSCM_CX, OSCM_CY, OSCM_R_INNER, OSCM_R_OUTER, start, end));
        path.setAttribute('class', 'oscm-wedge' + (w.kind === 'bool' && oscmParamValues[w.name] ? ' on' : '') + (interactive ? '' : ' disabled'));
        path.dataset.idx = String(i);
        svg.appendChild(path);

        if (w.kind === 'float') {
            const val = Math.max(0, Math.min(1, Number(oscmParamValues[w.name]) || 0));
            const fillR = OSCM_R_INNER + val * (OSCM_R_OUTER - OSCM_R_INNER);
            const fill = document.createElementNS(SVG_NS, 'path');
            fill.setAttribute('d', oscmWedgePath(OSCM_CX, OSCM_CY, OSCM_R_INNER, Math.max(OSCM_R_INNER + 1, fillR), start, end));
            fill.setAttribute('class', 'oscm-wedge-fill');
            fill.dataset.fillIdx = String(i);
            svg.appendChild(fill);
        }

        const hasIcon = w.kind === 'emote' || w.kind === 'back';
        if (hasIcon) {
            const iconPos = oscmPolar(OSCM_CX, OSCM_CY, (OSCM_R_INNER + OSCM_R_OUTER) / 2 - 14, mid);
            const iconEl = document.createElementNS(SVG_NS, 'text');
            iconEl.setAttribute('x', iconPos.x);
            iconEl.setAttribute('y', iconPos.y);
            iconEl.setAttribute('class', 'oscm-wedge-icon msi');
            iconEl.textContent = w.icon;
            svg.appendChild(iconEl);
        }

        let labelROffset = 0; // float/no-icon default: centered in the wedge
        if (hasIcon) labelROffset = 14;       // below the icon (further from center)
        else if (w.kind === 'bool' || w.kind === 'int') labelROffset = -12; // make room for the value text below
        const labelPos = oscmPolar(OSCM_CX, OSCM_CY, (OSCM_R_INNER + OSCM_R_OUTER) / 2 + labelROffset, mid);
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', labelPos.x);
        label.setAttribute('y', labelPos.y);
        label.setAttribute('class', 'oscm-wedge-label');
        label.textContent = oscmTruncate(w.label, 12);
        svg.appendChild(label);

        if (w.kind === 'bool' || w.kind === 'int') {
            const valPos = oscmPolar(OSCM_CX, OSCM_CY, (OSCM_R_INNER + OSCM_R_OUTER) / 2 + 13, mid);
            const valEl = document.createElementNS(SVG_NS, 'text');
            valEl.setAttribute('x', valPos.x);
            valEl.setAttribute('y', valPos.y);
            valEl.setAttribute('class', 'oscm-wedge-value');
            valEl.dataset.valIdx = String(i);
            valEl.textContent = oscmValueLabel(w);
            svg.appendChild(valEl);
        }

        path.addEventListener('click', () => oscmWedgeClick(i));
        if (w.kind === 'float') {
            path.addEventListener('pointerdown', e => oscmWedgeDragStart(e, i));
        }
    });

    const hubIcon = document.getElementById('oscmHubIcon');
    const hubLabel = document.getElementById('oscmHubLabel');
    const hubPage = document.getElementById('oscmHubPage');
    if (hubIcon) hubIcon.textContent = oscmPage === 'emotes' ? 'theater_comedy' : 'tune';
    if (hubLabel) hubLabel.textContent = oscmPage === 'emotes' ? t('osc.emotes.title', 'Emotes') : t('oscm.hub.params', 'Params');
    if (hubPage) hubPage.textContent = oscmPage === 'emotes' ? '' : `${oscmPage + 1}/${oscmParamPageCount()}`;
}

function oscmUpdateWedgeVisual(name) {
    const wedges = oscmCurrentWedges();
    const idx = wedges.findIndex(w => w.kind !== 'emote' && w.name === name);
    if (idx === -1) return;
    const w = wedges[idx];
    const { start, end } = oscmWedgeAngles(idx);

    if (w.kind === 'float') {
        const fillEl = document.querySelector(`.oscm-wedge-fill[data-fill-idx="${idx}"]`);
        const val = Math.max(0, Math.min(1, Number(oscmParamValues[w.name]) || 0));
        const fillR = OSCM_R_INNER + val * (OSCM_R_OUTER - OSCM_R_INNER);
        if (fillEl) fillEl.setAttribute('d', oscmWedgePath(OSCM_CX, OSCM_CY, OSCM_R_INNER, Math.max(OSCM_R_INNER + 1, fillR), start, end));
    } else {
        const path = document.querySelector(`.oscm-wedge[data-idx="${idx}"]`);
        if (path) path.classList.toggle('on', w.kind === 'bool' && !!oscmParamValues[w.name]);
        const valEl = document.querySelector(`[data-val-idx="${idx}"]`);
        if (valEl) valEl.textContent = oscmValueLabel(w);
    }
}

function oscmWedgeClick(idx) {
    if (!oscmConnected) return;
    const w = oscmCurrentWedges()[idx];
    if (!w) return;
    if (w.kind === 'emote') {
        sendToCS({ action: 'oscTriggerEmote', emote: w.emote });
        return;
    }
    if (w.kind === 'back') {
        oscmPage = 'emotes';
        oscmRender();
        return;
    }
    if (w.kind === 'bool') {
        const next = !oscmParamValues[w.name];
        oscmParamValues[w.name] = next;
        sendToCS({ action: 'oscSend', name: w.name, type: 'bool', value: next });
        oscmUpdateWedgeVisual(w.name);
    } else if (w.kind === 'int') {
        const next = ((Number(oscmParamValues[w.name]) || 0) + 1) % 8;
        oscmParamValues[w.name] = next;
        sendToCS({ action: 'oscSend', name: w.name, type: 'int', value: next });
        oscmUpdateWedgeVisual(w.name);
    }
}

function oscmWedgeDragStart(e, idx) {
    if (!oscmConnected) return;
    e.preventDefault();
    _oscmDragIdx = idx;
    const svg = document.getElementById('oscmWheel');
    try { svg.setPointerCapture(e.pointerId); } catch { /* no-op if unsupported */ }
    oscmWedgeDragMove(e);
    svg.addEventListener('pointermove', oscmWedgeDragMove);
    svg.addEventListener('pointerup', oscmWedgeDragEnd);
    svg.addEventListener('pointercancel', oscmWedgeDragEnd);
}

function oscmWedgeDragMove(e) {
    if (_oscmDragIdx === null) return;
    const svg = document.getElementById('oscmWheel');
    const rect = svg.getBoundingClientRect();
    const scale = (OSCM_CX * 2) / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const dist = Math.hypot(x - OSCM_CX, y - OSCM_CY);
    const val = Math.max(0, Math.min(1, (dist - OSCM_R_INNER) / (OSCM_R_OUTER - OSCM_R_INNER)));

    const w = oscmCurrentWedges()[_oscmDragIdx];
    if (!w || w.kind !== 'float') return;
    oscmParamValues[w.name] = val;
    oscmUpdateWedgeVisual(w.name);
    oscmThrottledSend(w.name, val);
}

function oscmThrottledSend(name, val) {
    _oscmSendPending = { name, val };
    if (_oscmSendTimer) return;
    _oscmSendTimer = setTimeout(() => {
        _oscmSendTimer = null;
        if (_oscmSendPending) {
            sendToCS({ action: 'oscSend', name: _oscmSendPending.name, type: 'float', value: _oscmSendPending.val });
            _oscmSendPending = null;
        }
    }, 60);
}

function oscmWedgeDragEnd() {
    const svg = document.getElementById('oscmWheel');
    svg.removeEventListener('pointermove', oscmWedgeDragMove);
    svg.removeEventListener('pointerup', oscmWedgeDragEnd);
    svg.removeEventListener('pointercancel', oscmWedgeDragEnd);
    if (_oscmDragIdx !== null) {
        const w = oscmCurrentWedges()[_oscmDragIdx];
        if (w && w.kind === 'float') {
            if (_oscmSendTimer) { clearTimeout(_oscmSendTimer); _oscmSendTimer = null; }
            sendToCS({ action: 'oscSend', name: w.name, type: 'float', value: oscmParamValues[w.name] || 0 });
            _oscmSendPending = null;
        }
    }
    _oscmDragIdx = null;
}

document.documentElement.addEventListener('languagechange', () => oscmRender());
oscmRender();
