const VrcnKeybinds = (() => {
    let _inited = false;

    function _label(key, fallback) {
        return typeof t === 'function' ? t(key, fallback) : fallback;
    }

    function _toast(ok, message) {
        if (typeof showToast === 'function') showToast(ok, message);
    }

    function _isCtrlChord(e, key) {
        return e.ctrlKey
            && !e.altKey
            && !e.metaKey
            && !e.shiftKey
            && !e.isComposing
            && (e.key || '').toLowerCase() === key;
    }

    function _isAltChord(e, key) {
        return e.altKey
            && !e.ctrlKey
            && !e.metaKey
            && !e.shiftKey
            && !e.isComposing
            && (e.key || '').toLowerCase() === key;
    }

    function _openSmartSearch() {
        if (window.SmartSearch && typeof window.SmartSearch.open === 'function') {
            window.SmartSearch.open();
            return;
        }
        document.getElementById('ssBadge')?.click();
    }

    async function _openDirectAccess() {
        const access = window.VrcnDirectAccess;
        if (!access || typeof access.detect !== 'function' || typeof access.open !== 'function') {
            _toast(false, _label('keybinds.direct_access_unavailable', 'Direct Access is not ready yet.'));
            return;
        }

        let clipText = '';
        try {
            clipText = await navigator.clipboard.readText();
        } catch {
            _toast(false, _label('keybinds.direct_access_clipboard_failed', 'Could not read clipboard.'));
            return;
        }

        const vrcData = access.detect(clipText);
        if (!vrcData) {
            _toast(false, _label('keybinds.direct_access_no_match', 'No VRChat ID or link in clipboard.'));
            return;
        }

        if (window.SmartSearch && typeof window.SmartSearch.close === 'function') {
            window.SmartSearch.close();
        }

        access.open(vrcData);
    }

    function _navStep(direction) {
        const all = [...document.querySelectorAll('#navEl .nav-btn[onclick]')].filter(btn => {
            if (!btn.getAttribute('onclick')?.match(/showTab\(\d+\)/)) return false;
            const group = btn.closest('.nav-group');
            return !(group && group.classList.contains('collapsed'));
        });
        if (!all.length) return;
        const activeBtn = document.querySelector('#navEl .nav-btn.active');
        const currentIdx = activeBtn ? all.indexOf(activeBtn) : -1;
        const nextIdx = direction === 'down'
            ? Math.min(currentIdx + 1, all.length - 1)
            : Math.max(currentIdx - 1, 0);
        if (nextIdx !== currentIdx) all[nextIdx].click();
    }

    function _closeTopModal() {
        const overlays = [...document.querySelectorAll('.modal-overlay')]
            .filter(el => el.style.display !== 'none' && el.style.display !== '');
        if (!overlays.length) return false;
        const top = overlays.reduce((a, b) => {
            const za = parseInt(getComputedStyle(a).zIndex) || 0;
            const zb = parseInt(getComputedStyle(b).zIndex) || 0;
            return zb > za ? b : a;
        });
        top.click();
        return true;
    }

    function _onKeyDown(e) {
        if (e.defaultPrevented || e.repeat) return;

        if (e.key === 'Escape') {
            _closeTopModal();
            return;
        }

        if (_isCtrlChord(e, 'k')) {
            e.preventDefault();
            e.stopPropagation();
            _openSmartSearch();
        } else if (_isCtrlChord(e, 'i')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof openStatusModal === 'function') openStatusModal();
        } else if (_isCtrlChord(e, 'p')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof openMyProfileModal === 'function') openMyProfileModal();
        } else if (_isCtrlChord(e, 'h')) {
            e.preventDefault();
            e.stopPropagation();
            document.getElementById('modalKeybinds')?.style && (document.getElementById('modalKeybinds').style.display = 'flex');
        } else if (_isCtrlChord(e, 't')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof showTab === 'function') showTab(12);
        } else if (_isCtrlChord(e, 'r')) {
            e.preventDefault();
            e.stopPropagation();
            location.reload();
        } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            _navStep('up');
        } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            _navStep('down');
        } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof toggleSidebar === 'function') toggleSidebar();
        } else if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof toggleRsidebar === 'function') toggleRsidebar();
        } else if (_isCtrlChord(e, 'd')) {
            e.preventDefault();
            e.stopPropagation();
            _openDirectAccess();
        } else if (_isAltChord(e, 'd')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof launchAndJoin === 'function') launchAndJoin('', false);
        } else if (_isAltChord(e, 'v')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof launchAndJoin === 'function') launchAndJoin('', true);
        }
    }

    function init() {
        if (_inited) return;
        _inited = true;
        document.addEventListener('keydown', _onKeyDown, true);
    }

    return { init };
})();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VrcnKeybinds.init());
} else {
    VrcnKeybinds.init();
}
