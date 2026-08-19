const WM_MAX = 12;
const WM_Z_BASE = 9000;
const WM_MIN_W = 560;
const WM_MIN_H = 360;
const WM_NARROW_W = 940;
const WM_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const WM_TYPES = {
    friend: {
        overlay: 'modalFriendDetail', content: 'friendDetailContent',
        open: 'openFriendDetail', close: 'closeFriendDetail',
        render: 'renderFriendDetail', state: '_fdWmState',
        icon: 'person', label: () => _wmT('nav.modal.friend', 'Profile'),
    },
    myprofile: {
        overlay: 'modalMyProfile', content: 'myProfileContent',
        open: 'openMyProfileModal', close: 'closeMyProfile',
        state: '_mypWmState', noId: true,
        icon: 'manage_accounts', label: () => _wmT('nav.modal.friend', 'Profile'),
    },
    group: {
        overlay: 'modalDetail', content: 'detailModalContent',
        open: 'openGroupDetail', close: 'closeGroupDetail',
        render: 'renderGroupDetail', state: '_gdWmState',
        icon: 'group', label: () => _wmT('nav.modal.group', 'Group'),
    },
    worldSearch: {
        overlay: 'modalDetail', content: 'detailModalContent',
        open: 'openWorldSearchDetail', close: 'closeWorldSearchDetail',
        render: 'renderWorldSearchDetail', state: '_wdWmState',
        icon: 'public', label: () => _wmT('nav.modal.world', 'World'),
    },
    world: {
        overlay: 'modalWorldDetail', content: 'worldDetailContent',
        open: 'openWorldDetail', close: 'closeWorldDetail',
        state: '_wdWmState',
        icon: 'public', label: () => _wmT('nav.modal.world', 'World'),
    },
    avatar: {
        overlay: 'modalAvatarDetail', content: 'avatarDetailContent',
        open: 'openAvatarDetail', close: 'closeAvatarDetail',
        render: 'renderAvatarDetail', state: '_avWmState',
        icon: 'checkroom', label: () => _wmT('nav.modal.avatar', 'Avatar'),
    },
    event: {
        overlay: 'modalDetail', content: 'detailModalContent',
        open: 'openEventDetail', close: 'closeEventDetail',
        render: 'renderEventDetail', pairId: true,
        icon: 'event', label: () => _wmT('nav.modal.event', 'Event'),
    },
    instance: {
        overlay: 'modalMyInstance', content: 'myInstanceContent',
        open: '_reopenCachedInstance', close: 'closeMyInstanceDetail',
        state: '_miWmState',
        icon: 'sensors', label: () => _wmT('nav.modal.instance', 'Instance'),
    },
};

let _wmWindows   = [];
let _wmFocused   = null;
let _wmScope     = null;
let _wmSeq       = 0;
let _wmZTop      = WM_Z_BASE;
let _wmShift     = false;
let _wmInternal  = false;
let _wmEnabled   = false;
const _wmTemplates = {};

function wmEnabled() {
    return _wmEnabled;
}

function wmSetEnabled(on) {
    on = !!on;
    if (on === _wmEnabled) return;
    _wmEnabled = on;
    if (!on) wmCloseAll();
}

function wmCloseAll() {
    _wmScope = null;
    _wmFocused = null;
    [..._wmWindows].forEach(_wmDestroy);
    _wmWindows = [];
    _wmZTop = WM_Z_BASE;
    _wmSyncDock();
}

function _wmT(key, fallback) {
    return typeof t === 'function' ? t(key, fallback) : fallback;
}

function _wmEscAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _wmIdSel(id) {
    return '[id="' + String(id).replace(/(["\\])/g, '\\$1') + '"]';
}

function _wmTrunc(s, max) {
    s = String(s || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
}

const _wmRawGetById = Document.prototype.getElementById;
const _wmDocQS      = Document.prototype.querySelector;
const _wmDocQSA     = Document.prototype.querySelectorAll;
const _wmRawQS      = Element.prototype.querySelector;
const _wmRawQSA     = Element.prototype.querySelectorAll;

function _wmScopeRoot() {
    if (_wmScope) return _wmScope.el;
    if (_wmFocused && !_wmFocused.minimized) return _wmFocused.el;
    return null;
}

function _wmOwned(el) {
    return !!(el && el.closest && el.closest('.wm-window'));
}

function _wmOutsideWindows(sel, native) {
    const all = _wmDocQSA.call(document, sel);
    for (const el of all) if (!_wmOwned(el)) return el;
    return native;
}

let _wmLookupDepth = 0;

document.getElementById = function (id) {
    if (_wmLookupDepth) return _wmRawGetById.call(document, id);
    _wmLookupDepth++;
    try {
        const root = _wmScopeRoot();
        const sel = _wmIdSel(id);
        if (root) {
            const scoped = _wmRawQS.call(root, sel);
            if (scoped) return scoped;
        }
        const native = _wmRawGetById.call(document, id);
        if (!_wmOwned(native)) return native;
        return root ? null : _wmOutsideWindows(sel, native);
    } finally {
        _wmLookupDepth--;
    }
};

document.querySelector = function (sel) {
    if (_wmLookupDepth) return _wmDocQS.call(document, sel);
    _wmLookupDepth++;
    try {
        const root = _wmScopeRoot();
        if (root) {
            let scoped = null;
            try { scoped = _wmRawQS.call(root, sel); } catch (e) { scoped = null; }
            if (scoped) return scoped;
        }
        let native = null;
        try { native = _wmDocQS.call(document, sel); } catch (e) { return null; }
        if (!_wmOwned(native)) return native;
        return root ? null : _wmOutsideWindows(sel, native);
    } finally {
        _wmLookupDepth--;
    }
};

document.querySelectorAll = function (sel) {
    if (_wmLookupDepth) return _wmDocQSA.call(document, sel);
    _wmLookupDepth++;
    try {
        const root = _wmScopeRoot();
        if (root) {
            let scoped = null;
            try { scoped = _wmRawQSA.call(root, sel); } catch (e) { scoped = null; }
            if (scoped && scoped.length) return scoped;
        }
        const native = _wmDocQSA.call(document, sel);
        if (root && native.length && [...native].every(_wmOwned)) return _wmDocQSA.call(document, ':not(*)');
        return native;
    } finally {
        _wmLookupDepth--;
    }
};

function _wmStateFn(type) {
    const d = WM_TYPES[type];
    const fn = d && d.state ? window[d.state] : null;
    return typeof fn === 'function' ? fn : null;
}

function _wmSaveState(win) {
    const fn = _wmStateFn(win.type);
    if (fn) win.state = fn();
}

function _wmLoadState(win) {
    const fn = _wmStateFn(win.type);
    if (fn) fn(win.state || null);
}

function _wmRunIn(win, fn) {
    const prevScope = _wmScope;
    const prevFocus = _wmFocused;
    const swap = prevFocus !== win;
    if (swap) {
        if (prevFocus) _wmSaveState(prevFocus);
        _wmLoadState(win);
    }
    _wmScope = win;
    _wmFocused = win;
    try {
        return fn();
    } finally {
        _wmSaveState(win);
        _wmScope = prevScope;
        _wmFocused = prevFocus;
        if (swap && prevFocus) _wmLoadState(prevFocus);
    }
}

function _wmTemplate(type) {
    const d = WM_TYPES[type];
    if (!_wmTemplates[d.overlay]) {
        const src = _wmRawGetById.call(document, d.overlay);
        if (!src) return null;
        const tpl = src.cloneNode(true);
        tpl.removeAttribute('onclick');
        tpl.removeAttribute('style');
        tpl.classList.remove('fd-style-compact', 'wd-style-compact', 'gd-style-compact', 'av-style-compact', 'tl-style-compact');
        const body = _wmRawQS.call(tpl, _wmIdSel(d.content));
        if (body) body.innerHTML = '';
        _wmTemplates[d.overlay] = tpl;
    }
    const clone = _wmTemplates[d.overlay].cloneNode(true);
    clone.style.display = 'flex';
    return clone;
}

function _wmApplyChrome(win) {
    if (!win.el) return;
    const bar = _wmRawQS.call(win.el, '.fd-modal-bar');
    if (!bar) return;

    const actions = _wmRawQS.call(bar, '.fd-modal-bar-actions');
    if (actions && !_wmRawQS.call(actions, '.wm-btn-min')) {
        const btn = document.createElement('button');
        btn.className = 'btn-notif fd-action-btn wm-btn-min';
        btn.title = _wmT('common.minimize', 'Minimize');
        btn.innerHTML = `<span class="msi" style="font-size:20px;">remove</span>`;
        btn.addEventListener('click', e => { e.stopPropagation(); wmMinimize(win); });
        actions.insertBefore(btn, actions.firstChild);
    }
    _wmRenderCrumbs(win, bar);
}

function _wmRenderCrumbs(win, bar) {
    bar = bar || (win.el && _wmRawQS.call(win.el, '.fd-modal-bar'));
    const host = bar && _wmRawQS.call(bar, '.fd-modal-bar-crumbs');
    if (!host) return;

    const entries = win.stack.slice(0, win.idx + 1);
    const sig = win.idx + '|' + entries.map(e => e.type + ':' + e.id + ':' + e.id2 + ':' + e.label).join('|');
    if (host.dataset.wmCrumbs === sig) return;

    const start = Math.max(0, entries.length - 5);
    let html = '';
    if (start > 0) html += `<button class="tb-crumb" data-wm-go="0">···</button><span class="tb-crumb-sep">›</span>`;
    html += entries.slice(start).map((e, j) => {
        const idx = start + j;
        const name = e.label || WM_TYPES[e.type].label();
        const short = _wmTrunc(name, 14);
        if (idx === entries.length - 1) return `<span class="tb-crumb-current" title="${_wmEscAttr(name)}">${_wmEscAttr(short)}</span>`;
        return `<button class="tb-crumb" data-wm-go="${idx}" title="${_wmEscAttr(name)}">${_wmEscAttr(short)}</button>`;
    }).join('<span class="tb-crumb-sep">›</span>');
    host.innerHTML = html;
    host.dataset.wmCrumbs = sig;

    _wmRawQSA.call(host, '[data-wm-go]').forEach(b => {
        b.addEventListener('click', e => {
            e.stopPropagation();
            wmNavGoTo(win, parseInt(b.getAttribute('data-wm-go'), 10));
        });
    });
}

const WM_TILE_MS = 220;
const WM_ARROW_DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

let _wmTiling     = true;
let _wmHeldArrows = [];

function wmSetTiling(on) {
    _wmTiling = !!on;
}

function wmTilingEnabled() {
    return _wmTiling;
}

function wmIsEnabled() {
    return _wmEnabled;
}

function wmSyncKeybindHelp() {
    const rows = _wmDocQSA.call(document, '.kb-tiling');
    const show = _wmEnabled && _wmTiling;
    for (let i = 0; i < rows.length; i++) rows[i].style.display = show ? '' : 'none';
}

function _wmIsTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
}

function _wmHoldArrow(dir) {
    _wmHeldArrows = _wmHeldArrows.filter(d => d !== dir);
    _wmHeldArrows.push(dir);
}

function _wmReleaseArrow(dir) {
    _wmHeldArrows = _wmHeldArrows.filter(d => d !== dir);
}

function _wmChordDir() {
    let h = null, v = null;
    for (let i = _wmHeldArrows.length - 1; i >= 0; i--) {
        const d = _wmHeldArrows[i];
        if (!h && (d === 'left' || d === 'right')) h = d;
        if (!v && (d === 'up'   || d === 'down'))  v = d;
    }
    if (h && v) return v + '-' + h;
    return h || v;
}

function _wmTileRect(dir, box) {
    const halfW  = Math.max(WM_MIN_W, Math.round(box.w / 2));
    const halfH  = Math.max(WM_MIN_H, Math.round(box.h / 2));
    const fullW  = Math.max(WM_MIN_W, box.w);
    const fullH  = Math.max(WM_MIN_H, box.h);
    const right  = Math.max(0, box.w - halfW);
    const bottom = Math.max(0, box.h - halfH);
    switch (dir) {
        case 'left':       return { x: 0,     y: 0,      w: halfW, h: fullH };
        case 'right':      return { x: right, y: 0,      w: halfW, h: fullH };
        case 'up':         return { x: 0,     y: 0,      w: fullW, h: halfH };
        case 'down':       return { x: 0,     y: bottom, w: fullW, h: halfH };
        case 'up-left':    return { x: 0,     y: 0,      w: halfW, h: halfH };
        case 'up-right':   return { x: right, y: 0,      w: halfW, h: halfH };
        case 'down-left':  return { x: 0,     y: bottom, w: halfW, h: halfH };
        case 'down-right': return { x: right, y: bottom, w: halfW, h: halfH };
        case 'max':        return { x: 0,     y: 0,      w: fullW, h: fullH };
    }
    return null;
}

function _wmTileAnimate(win) {
    if (!win.el) return;
    win.el.classList.add('wm-tiling');
    if (win.tileAnim) clearTimeout(win.tileAnim);
    win.tileAnim = setTimeout(() => {
        win.tileAnim = null;
        if (win.el) win.el.classList.remove('wm-tiling');
    }, WM_TILE_MS + 80);
}

function _wmTileAnimStop(win) {
    if (!win) return;
    if (win.tileAnim) clearTimeout(win.tileAnim);
    win.tileAnim = null;
    if (win.el) win.el.classList.remove('wm-tiling');
}

function wmTile(win, dir, animate) {
    if (!win || !win.el || win.minimized) return false;
    const box = _wmLayerBox();
    if (!box) return false;
    const rect = _wmTileRect(dir, box);
    if (!rect) return false;

    win.userPlaced = true;
    win.tile = dir;
    if (animate === false) _wmTileAnimStop(win);
    else _wmTileAnimate(win);
    _wmApplySize(win, rect.w, rect.h);
    _wmMoveTo(win, rect.x, rect.y);
    return true;
}


function _wmMoveTo(win, x, y) {
    win.x = Math.round(x);
    win.y = Math.round(y);
    win.el.style.left = win.x + 'px';
    win.el.style.top  = win.y + 'px';
}

function _wmSizeOf(win) {
    return {
        w: win.w || win.el.offsetWidth,
        h: win.h || win.el.offsetHeight,
    };
}

function _wmClampInto(win, box) {
    box = box || _wmLayerBox();
    if (!box || !win.el) return;
    let { w, h } = _wmSizeOf(win);
    if (w > box.w || h > box.h) {
        _wmApplySize(win, Math.max(WM_MIN_W, Math.min(w, box.w)), Math.max(WM_MIN_H, Math.min(h, box.h)));
        w = win.w;
        h = win.h;
    }
    _wmMoveTo(win, Math.max(0, Math.min(win.x, box.w - w)), Math.max(0, Math.min(win.y, box.h - h)));
}

function _wmCenter(win) {
    const box = _wmLayerBox();
    if (!box || !win.el) return;
    const { w, h } = _wmSizeOf(win);
    const off = (win.cascade || 0) * 26;
    _wmMoveTo(win, (box.w - w) / 2 + off, (box.h - h) / 2 + off);
    _wmClampInto(win, box);
}

function _wmRecenter(win) {
    if (win && win.el && !win.userPlaced) _wmCenter(win);
}

function _wmCreate(type) {
    const layer = _wmRawGetById.call(document, 'wmLayer');
    if (!layer) return null;
    const body = _wmTemplate(type);
    if (!body) return null;

    const el = document.createElement('div');
    el.className = 'wm-window';
    el.appendChild(body);

    el.style.left = '0px';
    el.style.top  = '0px';

    const win = {
        id: ++_wmSeq, type, el, body,
        entityId: '', entityId2: '', label: '',
        stack: [], idx: -1,
        minimized: false, state: null,
        x: 0, y: 0, w: 0, h: 0,
        cascade: _wmWindows.length % 6, userPlaced: false,
    };
    el._wmWin = win;

    WM_DIRS.forEach(dir => {
        const g = document.createElement('div');
        g.className = 'wm-resize wm-resize-' + dir;
        g.addEventListener('pointerdown', e => _wmResizeStart(win, dir, e));
        el.appendChild(g);
    });

    el.addEventListener('pointerdown', e => _wmDragStart(win, e), true);

    win.observer = new MutationObserver(() => _wmApplyChrome(win));
    win.observer.observe(el, { childList: true, subtree: true });

    if (typeof ResizeObserver === 'function') {
        win.sizeObserver = new ResizeObserver(() => _wmRecenter(win));
        win.sizeObserver.observe(el);
    }

    layer.appendChild(el);
    _wmWindows.push(win);
    return win;
}

function _wmDestroy(win) {
    if (win.observer) { win.observer.disconnect(); win.observer = null; }
    if (win.sizeObserver) { win.sizeObserver.disconnect(); win.sizeObserver = null; }
    if (win.el && win.el.parentNode) win.el.parentNode.removeChild(win.el);
    win.el = null;
    win.body = null;
    win.state = null;
}

function wmClose(win) {
    if (!win) return;
    const i = _wmWindows.indexOf(win);
    if (i >= 0) _wmWindows.splice(i, 1);
    if (_wmFocused === win) _wmFocused = null;
    if (_wmScope === win) _wmScope = null;
    _wmDestroy(win);
    _wmSyncDock();
}

function wmMinimize(win) {
    if (!win || win.minimized || !win.el) return;
    if (_wmFocused === win) { _wmSaveState(win); _wmFocused = null; }
    win.minimized = true;
    win.el.classList.add('wm-minimized');
    _wmSyncDock();
}

function wmRestore(win) {
    if (!win || !win.el) return;
    win.minimized = false;
    win.el.classList.remove('wm-minimized');
    if (win.tile) wmTile(win, win.tile, false);
    else _wmClampInto(win);
    _wmSyncDock();
    wmFocus(win);
}

function wmFocus(win) {
    if (!win || win.minimized || !win.el) return;
    win.el.style.zIndex = String(++_wmZTop);
    const i = _wmWindows.indexOf(win);
    if (i >= 0) { _wmWindows.splice(i, 1); _wmWindows.push(win); }
    if (_wmFocused === win) return;
    if (_wmFocused) _wmSaveState(_wmFocused);
    _wmFocused = win;
    _wmLoadState(win);
}

let _wmDrag = null;
let _wmResize = null;

function _wmLayerBox() {
    const layer = _wmRawGetById.call(document, 'wmLayer');
    if (!layer) return null;
    return { el: layer, w: layer.clientWidth, h: layer.clientHeight, top: layer.getBoundingClientRect().top };
}

function _wmApplySize(win, w, h) {
    win.w = Math.round(w);
    win.h = Math.round(h);
    win.el.classList.add('wm-sized');
    win.el.classList.toggle('wm-narrow', win.w < WM_NARROW_W);
    win.el.style.width  = win.w + 'px';
    win.el.style.height = win.h + 'px';
}

function _wmResizeStart(win, dir, e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    wmFocus(win);
    if (!win.w || !win.h) _wmApplySize(win, win.el.offsetWidth, win.el.offsetHeight);
    _wmResize = { win, dir, sx: e.clientX, sy: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    _wmTileAnimStop(win);
    win.el.classList.add('wm-resizing');
}

function _wmResizeMove(e) {
    if (!_wmResize) return;
    const r = _wmResize, win = r.win;
    if (!win.el) return;
    const box = _wmLayerBox();
    if (!box) return;

    win.userPlaced = true;
    win.tile = null;
    const dx = e.clientX - r.sx;
    const dy = e.clientY - r.sy;
    let x = r.x, y = r.y, w = r.w, h = r.h;

    if (r.dir.indexOf('e') >= 0) w = Math.max(WM_MIN_W, r.w + dx);
    if (r.dir.indexOf('s') >= 0) h = Math.max(WM_MIN_H, r.h + dy);
    if (r.dir.indexOf('w') >= 0) { w = Math.max(WM_MIN_W, r.w - dx); x = r.x + (r.w - w); }
    if (r.dir.indexOf('n') >= 0) { h = Math.max(WM_MIN_H, r.h - dy); y = r.y + (r.h - h); }

    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.max(WM_MIN_W, Math.min(w, box.w - x));
    h = Math.max(WM_MIN_H, Math.min(h, box.h - y));

    win.x = x;
    win.y = y;
    win.el.style.left = x + 'px';
    win.el.style.top  = y + 'px';
    _wmApplySize(win, w, h);
}

function _wmResizeEnd() {
    if (!_wmResize) return;
    _wmResize.win.el?.classList.remove('wm-resizing');
    _wmResize = null;
}

function _wmDragStart(win, e) {
    wmFocus(win);
    if (e.button !== 0) return;
    if (!e.target.closest || !e.target.closest('.fd-modal-bar')) return;
    if (e.target.closest('button, input, a, select, textarea, .tb-crumb, .vn-select')) return;

    const layer = _wmRawGetById.call(document, 'wmLayer');
    _wmDrag = {
        win,
        dx: e.clientX - win.x,
        dy: e.clientY - win.y - (layer ? layer.getBoundingClientRect().top : 0),
    };
    _wmTileAnimStop(win);
    win.el.classList.add('wm-dragging');
    e.preventDefault();
}

function _wmDragMove(e) {
    if (!_wmDrag) return;
    const win = _wmDrag.win;
    if (!win.el) return;
    const box = _wmLayerBox();
    if (!box) return;
    const { w, h } = _wmSizeOf(win);
    const maxX = Math.max(0, box.w - w);
    const maxY = Math.max(0, box.h - h);
    win.userPlaced = true;
    win.tile = null;
    _wmMoveTo(win,
        Math.min(maxX, Math.max(0, e.clientX - _wmDrag.dx)),
        Math.min(maxY, Math.max(0, e.clientY - box.top - _wmDrag.dy)));
}

function _wmDragEnd() {
    if (!_wmDrag) return;
    _wmDrag.win.el?.classList.remove('wm-dragging');
    _wmDrag = null;
}

document.addEventListener('pointermove', e => { _wmDragMove(e); _wmResizeMove(e); });
document.addEventListener('pointerup', () => { _wmDragEnd(); _wmResizeEnd(); });
document.addEventListener('pointercancel', () => { _wmDragEnd(); _wmResizeEnd(); });

let _wmReflowPending = false;

function wmReflow() {
    if (_wmReflowPending) return;
    _wmReflowPending = true;
    requestAnimationFrame(() => {
        _wmReflowPending = false;
        const box = _wmLayerBox();
        if (!box) return;
        _wmWindows.forEach(win => {
            if (!win.el) return;
            if (win.tile) wmTile(win, win.tile, false);
            else _wmClampInto(win, box);
        });
    });
}

window.addEventListener('resize', wmReflow);

function _wmWatchLayer() {
    if (typeof ResizeObserver !== 'function') return;
    const layer = _wmRawGetById.call(document, 'wmLayer');
    if (!layer) { document.addEventListener('DOMContentLoaded', _wmWatchLayer, { once: true }); return; }
    new ResizeObserver(wmReflow).observe(layer);
}
_wmWatchLayer();

function _wmSyncDock() {
    const dock = _wmRawGetById.call(document, 'wmDock');
    if (!dock) return;
    const mins = _wmWindows.filter(w => w.minimized);
    dock.classList.toggle('wm-dock-shown', mins.length > 0);
    dock.innerHTML = mins.map(w => {
        const d = WM_TYPES[w.type];
        const name = w.label || d.label();
        return `<button class="wm-dock-item" data-wm-id="${w.id}" title="${_wmEscAttr(name)}">
            <span class="msi">${_wmEscAttr(d.icon)}</span>
            <span class="wm-dock-label">${_wmEscAttr(_wmTrunc(name, 22))}</span>
            <span class="wm-dock-close" data-wm-close="1"><span class="msi">close</span></span>
        </button>`;
    }).join('');
    _wmRawQSA.call(dock, '.wm-dock-item').forEach(btn => {
        btn.addEventListener('click', e => {
            const win = _wmWindows.find(w => String(w.id) === btn.getAttribute('data-wm-id'));
            if (!win) return;
            if (e.target.closest('[data-wm-close]')) { e.stopPropagation(); wmClose(win); return; }
            wmRestore(win);
        });
    });
}

function _wmMount(win, type, id, id2) {
    if (win.type !== type) {
        if (WM_TYPES[win.type].overlay !== WM_TYPES[type].overlay) {
            const body = _wmTemplate(type);
            if (!body) return false;
            win.el.replaceChild(body, win.body);
            win.body = body;
        }
        win.type = type;
        win.state = null;
    }
    win.entityId  = id  || '';
    win.entityId2 = id2 || '';

    const d = WM_TYPES[type];
    const openFn = window[d.open];
    if (typeof openFn !== 'function') return false;

    _wmRunIn(win, () => {
        _wmInternal = true;
        try {
            if (d.pairId)    openFn(id, id2);
            else if (d.noId) openFn();
            else             openFn(id);
        } finally {
            _wmInternal = false;
        }
    });
    return true;
}

function wmNavPush(win, type, id, label, id2) {
    if (!win || !win.el || !WM_TYPES[type]) return false;
    win.stack = win.stack.slice(0, win.idx + 1);
    win.stack.push({ type, id: id || '', id2: id2 || '', label: label || '' });
    win.idx = win.stack.length - 1;
    win.label = label || '';
    if (!_wmMount(win, type, id, id2)) return false;
    _wmApplyChrome(win);
    _wmSyncDock();
    return true;
}

function wmNavGoTo(win, idx) {
    if (!win || idx < 0 || idx >= win.stack.length || idx === win.idx) return;
    win.idx = idx;
    const e = win.stack[idx];
    win.label = e.label || '';
    _wmMount(win, e.type, e.id, e.id2);
    _wmApplyChrome(win);
    _wmSyncDock();
}

function wmSetLabel(win, label) {
    if (!win || !label || win.label === label) return;
    win.label = label;
    if (win.stack[win.idx]) win.stack[win.idx].label = label;
    _wmRenderCrumbs(win);
    _wmSyncDock();
}

function wmOpen(type, id, label, id2) {
    if (!_wmEnabled || !WM_TYPES[type]) return false;

    const existing = _wmFindByEntity(type, id, id2);
    if (existing) {
        if (existing.minimized) wmRestore(existing);
        else wmFocus(existing);
        const name = existing.label || label || WM_TYPES[type].label();
        if (typeof showToast === 'function') {
            showToast(false, typeof tf === 'function'
                ? tf('wm.already_open', { name }, name + ' is already open')
                : name + ' is already open');
        }
        return true;
    }

    if (_wmWindows.length >= WM_MAX) {
        if (typeof showToast === 'function') {
            showToast(false, _wmT('wm.limit_reached', 'Maximum of 12 windows reached'));
        }
        return true;
    }
    const win = _wmCreate(type);
    if (!win) return false;
    wmFocus(win);
    if (!wmNavPush(win, type, id, label, id2)) { wmClose(win); return false; }
    _wmCenter(win);
    return true;
}

function _wmCurrent() {
    if (_wmScope) return _wmScope;
    return (_wmFocused && !_wmFocused.minimized && _wmFocused.el) ? _wmFocused : null;
}

function _wmFindByEntity(type, id, id2) {
    const hit = w => w && w.el && w.type === type &&
        w.entityId === (id || '') && (!id2 || w.entityId2 === id2);
    if (hit(_wmScope)) return _wmScope;
    if (hit(_wmFocused)) return _wmFocused;
    return _wmWindows.find(hit) || null;
}

document.addEventListener('pointerdown', e => {
    _wmShift = e.shiftKey;
    if (!e.target.closest || e.target.closest('.wm-window')) return;
    if (_wmFocused && !e.target.closest('#wmDock')) {
        _wmSaveState(_wmFocused);
        _wmFocused = null;
    }
}, true);

document.addEventListener('keydown', e => {
    _wmShift = e.shiftKey;
    if (e.key === 'Escape' && _wmCurrent()) {
        e.stopPropagation();
        wmClose(_wmCurrent());
        return;
    }

    if (!_wmEnabled || !_wmTiling) return;
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (_wmIsTypingTarget(e.target)) return;
    const tileWin = _wmCurrent();
    if (!tileWin) return;

    let done = true;
    const arrow = WM_ARROW_DIRS[e.key];
    if (arrow) {
        _wmHoldArrow(arrow);
        done = wmTile(tileWin, _wmChordDir());
    } else if (e.key === 'M' || e.key === 'm') {
        wmMinimize(tileWin);
    } else if (e.key === 'F' || e.key === 'f') {
        wmTile(tileWin, 'max');
    } else {
        done = false;
    }
    if (done) { e.preventDefault(); e.stopPropagation(); }
}, true);

document.addEventListener('keyup', e => {
    _wmShift = e.shiftKey;
    const arrow = WM_ARROW_DIRS[e.key];
    if (arrow) _wmReleaseArrow(arrow);
    else if (e.key === 'Shift') _wmHeldArrows = [];
}, true);

window.addEventListener('blur', () => { _wmHeldArrows = []; });

document.addEventListener('focusin', e => {
    const host = e.target.closest ? e.target.closest('.wm-window') : null;
    if (host && host._wmWin) wmFocus(host._wmWin);
}, true);

function _wmRouteOpen(type, id, id2, label) {
    if (_wmInternal) return false;
    if (_wmShift && _wmEnabled) {
        _wmShift = false;
        return wmOpen(type, id, label, id2);
    }
    const cur = _wmCurrent();
    if (cur) return wmNavPush(cur, type, id, label, id2);
    return false;
}

function _wmWrapOpen(type) {
    const d = WM_TYPES[type];
    const orig = window[d.open];
    if (typeof orig !== 'function') return;
    window[d.open] = function (...args) {
        const id  = d.noId ? '' : (args[0] || '');
        const id2 = d.pairId ? (args[1] || '') : '';
        if ((d.noId || id) && _wmRouteOpen(type, id, id2, '')) return;
        return orig.apply(this, args);
    };
}

function _wmWrapClose(type) {
    const d = WM_TYPES[type];
    const orig = window[d.close];
    if (typeof orig !== 'function') return;
    window[d.close] = function (...args) {
        const cur = _wmCurrent();
        if (!_wmInternal && cur && cur.type === type) { wmClose(cur); return; }
        return orig.apply(this, args);
    };
}

function _wmWrapRender(type) {
    const d = WM_TYPES[type];
    const orig = window[d.render];
    if (typeof orig !== 'function') return;
    window[d.render] = function (payload, ...rest) {
        if (!_wmWindows.length || !payload || !payload.id) return orig.call(this, payload, ...rest);
        const win = d.pairId
            ? _wmFindByEntity(type, payload.ownerId || payload.groupId || '', payload.id)
            : _wmFindByEntity(type, payload.id, '');
        if (!win) return orig.call(this, payload, ...rest);
        return _wmRunIn(win, () => {
            const r = orig.call(this, payload, ...rest);
            wmSetLabel(win, payload.displayName || payload.name || payload.title || '');
            _wmApplyChrome(win);
            _wmRecenter(win);
            return r;
        });
    };
}

function _wmWrapNav() {
    const origOpen = window.navOpenModal;
    if (typeof origOpen === 'function') {
        window.navOpenModal = function (type, id, label, id2) {
            if (id && WM_TYPES[type] && _wmRouteOpen(type, id, id2, label)) return;
            return origOpen.call(this, type, id, label, id2);
        };
    }

    const origLabel = window.navUpdateLabel;
    if (typeof origLabel === 'function') {
        window.navUpdateLabel = function (label) {
            const cur = _wmCurrent();
            if (cur) { wmSetLabel(cur, label); return; }
            return origLabel.call(this, label);
        };
    }

    const origSet = window.navSetCurrent;
    if (typeof origSet === 'function') {
        window.navSetCurrent = function (...args) {
            if (_wmCurrent()) return;
            return origSet.apply(this, args);
        };
    }

    const origClear = window.navClear;
    if (typeof origClear === 'function') {
        window.navClear = function (...args) {
            if (_wmCurrent()) return;
            return origClear.apply(this, args);
        };
    }
}

(function _wmInit() {
    Object.keys(WM_TYPES).forEach(type => {
        _wmWrapOpen(type);
        _wmWrapClose(type);
        if (WM_TYPES[type].render) _wmWrapRender(type);
    });
    _wmWrapNav();
})();
