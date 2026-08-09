// Background music — plays on launch, mute state remembered across restarts.
const MUSIC_MUTE_KEY = 'cvrc_music_muted';
let _bgMusic = null;

function isMusicMuted() {
    return localStorage.getItem(MUSIC_MUTE_KEY) === '1';
}

function initBackgroundMusic() {
    _bgMusic = new Audio('sounds/intro.mp3');
    _bgMusic.loop = true;
    _bgMusic.volume = 0.1;

    const userMuted = isMusicMuted();
    // Start muted so the browser always allows autoplay, then unmute right after —
    // toggling .muted on an already-playing element isn't blocked like starting audible playback is.
    _bgMusic.muted = true;
    _bgMusic.play().then(() => {
        _bgMusic.muted = userMuted;
        _updateMusicButton();
    }).catch(() => { _updateMusicButton(); });

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

document.documentElement.addEventListener('languagechange', _updateMusicButton);

initBackgroundMusic();
