// Background music — plays on launch, mute state remembered across restarts.
// A custom track (chosen in Settings > Appearance) is sent by the backend as a base64 data
// URI over the normal message channel (see getCustomMusicData / customMusicChanged) rather
// than fetched over HTTP — an earlier /custommusic-based version silently never reached the
// backend at all in practice, for reasons that weren't pinned down, so this sidesteps that
// entire path instead of chasing it further.
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
    _suppressMediaSession();
    if (typeof addLog === 'function') addLog('[Music] requesting custom track data from backend...', 'sec');
    sendToCS({ action: 'getCustomMusicData' });
}

// Without this, Chromium registers the <audio> element with Windows' System Media
// Transport Controls — which this app's own OSC "Now Playing" chatbox feature reads,
// so the background music shows up in VRChat as if it were a song someone is playing.
function _suppressMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        const actions = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto',
            'previoustrack', 'nexttrack', 'skipad', 'togglemicrophone', 'togglecamera', 'hangup'];
        for (const action of actions) {
            try { navigator.mediaSession.setActionHandler(action, null); } catch {}
        }
    } catch {}
}

// Data URIs for a whole mp3 can be several MB of base64 text — never dump that into the log.
function _musicSrcLabel(src) {
    if (src.startsWith('data:')) return `data-uri (${(src.length / 1024).toFixed(0)} KB)`;
    return src;
}

// Always routes src changes through here so a leftover error listener from a previous
// (already-succeeded) load can never misfire and force a later custom track back to the default.
function _loadMusicSrc(src, isFallback) {
    if (typeof addLog === 'function') addLog(`[Music] loading src=${_musicSrcLabel(src)} (fallback=${isFallback})`, 'sec');
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
                addLog(`[Music] error event on ${_musicSrcLabel(src)} — code=${err ? err.code : '?'}, falling back to default`, 'err');
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
        _suppressMediaSession();
        if (typeof addLog === 'function') addLog(`[Music] playing ${_musicSrcLabel(_bgMusic.currentSrc)} (muted=${userMuted})`, 'sec');
    }).catch((err) => {
        _updateMusicButton();
        if (typeof addLog === 'function') addLog(`[Music] play() rejected for ${_musicSrcLabel(_bgMusic.currentSrc)}: ${err}`, 'err');
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

// Applies the saved volume (0-1) to both the live player and the Settings slider UI.
function applyMusicVolumeUI(volume) {
    const pct = Math.round(Math.max(0, Math.min(1, volume ?? 0.1)) * 100);
    if (_bgMusic) _bgMusic.volume = pct / 100;
    const slider = document.getElementById('setMusicVolume');
    const label = document.getElementById('musicVolumeVal');
    if (slider) slider.value = pct;
    if (label) label.textContent = pct + '%';
}

// Live-preview while dragging the slider — actual persistence happens via autoSave().
function setMusicVolumeLive(pct) {
    if (_bgMusic) _bgMusic.volume = Math.max(0, Math.min(100, pct)) / 100;
}

function handleCustomMusicChanged(data) {
    applyMusicSettingsUI(data.hasCustom ? data.fileName : '');
    if (data.error && typeof addLog === 'function') addLog(`[Music] backend error: ${data.error}`, 'err');

    // Reload playback with the new source, preserving current mute state. This also runs once
    // at startup (triggered by initBackgroundMusic's getCustomMusicData request), so _bgMusic
    // is guaranteed to already exist by the time any response can arrive.
    if (!_bgMusic) return;
    _bgMusic.pause();
    if (data.hasCustom && data.dataUri) {
        _loadMusicSrc(data.dataUri, false);
    } else {
        _loadMusicSrc(MUSIC_DEFAULT_TRACK, true);
    }
}

document.documentElement.addEventListener('languagechange', _updateMusicButton);

initBackgroundMusic();
