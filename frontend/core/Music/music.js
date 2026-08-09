// Background music — plays on launch, mute state remembered across restarts.
// A custom track (chosen in Settings > Appearance) is served by the backend at
// /custommusic; if none is configured (404) we fall back to the bundled default track.
const MUSIC_MUTE_KEY = 'cvrc_music_muted';
const MUSIC_DEFAULT_TRACK = 'sounds/cario.mp3';
let _bgMusic = null;
let _bgMusicErrorHandler = null;

function isMusicMuted() {
    return localStorage.getItem(MUSIC_MUTE_KEY) === '1';
}

function initBackgroundMusic() {
    _bgMusic = new Audio();
    _bgMusic.loop = true;
    _bgMusic.volume = 0.1;
    _loadMusicSrc('/custommusic?_=' + Date.now(), /* isFallback */ false);
}

// Always routes src changes through here so a leftover error listener from a previous
// (already-succeeded) load can never misfire and force a later custom track back to the default.
function _loadMusicSrc(src, isFallback) {
    if (typeof addLog === 'function') addLog(`[Music] loading src="${src}" (fallback=${isFallback})`, 'sec');
    if (_bgMusicErrorHandler) {
        _bgMusic.removeEventListener('error', _bgMusicErrorHandler);
        _bgMusicErrorHandler = null;
    }
    _bgMusic.src = src;
    _bgMusic.load();
    if (!isFallback) {
        _bgMusicErrorHandler = () => {
            if (typeof addLog === 'function') {
                const err = _bgMusic.error;
                addLog(`[Music] error event on "${src}" — code=${err ? err.code : '?'}, falling back to default`, 'err');
            }
            _loadMusicSrc(MUSIC_DEFAULT_TRACK, true);
        };
        _bgMusic.addEventListener('error', _bgMusicErrorHandler, { once: true });
    }
    _startMusicPlayback();
}

function _startMusicPlayback() {
    const userMuted = isMusicMuted();
    // Start muted so the browser always allows autoplay, then unmute right after —
    // toggling .muted on an already-playing element isn't blocked like starting audible playback is.
    _bgMusic.muted = true;
    _bgMusic.play().then(() => {
        _bgMusic.muted = userMuted;
        _updateMusicButton();
        if (typeof addLog === 'function') addLog(`[Music] playing "${_bgMusic.currentSrc}" (muted=${userMuted})`, 'sec');
    }).catch((err) => {
        _updateMusicButton();
        if (typeof addLog === 'function') addLog(`[Music] play() rejected for "${_bgMusic.currentSrc}": ${err}`, 'err');
    });
    _updateMusicButton();
}

function toggleAppMusic() {
    if (!_bgMusic) return;
    const muted = !_bgMusic.muted;
    _bgMusic.muted = muted;
    if (!muted) _bgMusic.play().catch(() => {});
    try { localStorage.setItem(MUSIC_MUTE_KEY, muted ? '1' : '0'); } catch {}
    _updateMusicButton();
}

function _updateMusicButton() {
    const btn = document.getElementById('btnMusicMute');
    if (!btn) return;
    const muted = _bgMusic ? _bgMusic.muted : isMusicMuted();
    btn.classList.toggle('tb-active', !muted);
    const icon = btn.querySelector('.msi');
    if (icon) icon.textContent = muted ? 'volume_off' : 'volume_up';
    btn.title = muted ? t('tb.title.music_unmute', 'Unmute Music') : t('tb.title.music_mute', 'Mute Music');
}

// Settings > Appearance — pick/reset the custom background track
function pickCustomMusic() {
    sendToCS({ action: 'pickCustomMusic' });
}

function resetCustomMusic() {
    sendToCS({ action: 'resetCustomMusic' });
}

function applyMusicSettingsUI(customPath) {
    const nameEl = document.getElementById('musicFileName');
    const resetBtn = document.getElementById('musicResetBtn');
    const hasCustom = !!customPath;
    if (nameEl) nameEl.textContent = hasCustom ? customPath.split(/[\\/]/).pop() : t('settings.music.default_track', 'Default (cario.mp3)');
    if (resetBtn) resetBtn.style.display = hasCustom ? '' : 'none';
}

function handleCustomMusicChanged(data) {
    applyMusicSettingsUI(data.hasCustom ? data.fileName : '');

    // Reload playback with the new source, preserving current mute state.
    if (!_bgMusic) return;
    _bgMusic.pause();
    if (data.hasCustom) {
        _loadMusicSrc('/custommusic?_=' + Date.now(), false);
    } else {
        _loadMusicSrc(MUSIC_DEFAULT_TRACK, true);
    }
}

document.documentElement.addEventListener('languagechange', _updateMusicButton);

initBackgroundMusic();
