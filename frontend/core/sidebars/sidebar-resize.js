const SIDEBAR_BASE = { left: 220, right: 260 };
const SIDEBAR_MAX_FACTOR = 1.6;
const SIDEBAR_STORE = { left: 'vrcnext_sidebar_w', right: 'vrcnext_rsidebar_w' };
const SIDEBAR_VAR = { left: '--sidebar-w', right: '--rsidebar-w' };
const SIDEBAR_LOCK_STORE = 'vrcnext_sidebars_locked';

let sidebarsLocked = localStorage.getItem(SIDEBAR_LOCK_STORE) === '1';

function applySidebarLock() {
    document.body.classList.toggle('sidebars-locked', sidebarsLocked);
    const item = document.getElementById('tbLockSidebars');
    if (item) item.classList.toggle('checked', sidebarsLocked);
}

function toggleSidebarLock() {
    sidebarsLocked = !sidebarsLocked;
    localStorage.setItem(SIDEBAR_LOCK_STORE, sidebarsLocked ? '1' : '0');
    applySidebarLock();
}

function _sidebarMax(side) {
    return Math.round(SIDEBAR_BASE[side] * SIDEBAR_MAX_FACTOR);
}

function _clampSidebarWidth(side, px) {
    return Math.min(_sidebarMax(side), Math.max(SIDEBAR_BASE[side], Math.round(px)));
}

function applySidebarWidth(side, px, persist) {
    const w = _clampSidebarWidth(side, px);
    document.documentElement.style.setProperty(SIDEBAR_VAR[side], w + 'px');
    if (persist) {
        if (w === SIDEBAR_BASE[side]) localStorage.removeItem(SIDEBAR_STORE[side]);
        else localStorage.setItem(SIDEBAR_STORE[side], String(w));
    }
    if (typeof _applyLightInterp === 'function') _applyLightInterp();
}

function resetSidebarWidths() {
    ['left', 'right'].forEach(side => {
        localStorage.removeItem(SIDEBAR_STORE[side]);
        document.documentElement.style.removeProperty(SIDEBAR_VAR[side]);
    });
    if (typeof _applyLightInterp === 'function') _applyLightInterp();
    if (typeof syncSlideNavbars === 'function') syncSlideNavbars();
}

function restoreSidebarWidths() {
    ['left', 'right'].forEach(side => {
        const saved = parseInt(localStorage.getItem(SIDEBAR_STORE[side]) || '', 10);
        if (saved > 0) applySidebarWidth(side, saved, false);
    });
}

(function () {
    function isCollapsed(side) {
        const el = document.getElementById(side === 'left' ? 'sidebarEl' : 'rsidebar');
        return !el || el.classList.contains('collapsed') || el.classList.contains('collapsing');
    }

    function startDrag(e, side) {
        if (e.button !== 0 || sidebarsLocked || isCollapsed(side)) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startW = parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue(SIDEBAR_VAR[side])) || SIDEBAR_BASE[side];

        document.body.classList.add('sidebar-resizing');

        const onMove = ev => {
            const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
            applySidebarWidth(side, startW + delta, false);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.classList.remove('sidebar-resizing');
            const cur = parseFloat(getComputedStyle(document.documentElement)
                .getPropertyValue(SIDEBAR_VAR[side])) || SIDEBAR_BASE[side];
            applySidebarWidth(side, cur, true);
            if (typeof syncSlideNavbars === 'function') syncSlideNavbars();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    function start() {
        restoreSidebarWidths();
        applySidebarLock();
        [['sidebarResizer', 'left'], ['rsidebarResizer', 'right']].forEach(([id, side]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('mousedown', e => startDrag(e, side));
            el.addEventListener('dblclick', e => {
                e.preventDefault();
                if (sidebarsLocked) return;
                applySidebarWidth(side, SIDEBAR_BASE[side], true);
            });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
