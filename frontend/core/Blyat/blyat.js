let _blyatTimer = null;
let _blyatAudio = null;

function runBlyat() {
    if (document.body.classList.contains('blyat-active')) return;

    if (!document.getElementById('blyatOverlay')) {
        const ov = document.createElement('div');
        ov.id = 'blyatOverlay';
        document.body.appendChild(ov);
    }
    document.body.classList.add('blyat-active');

    try {
        _blyatAudio = new Audio('core/Blyat/Meme.mp3');
        _blyatAudio.volume = 0.7;
        _blyatAudio.play().catch(() => {});
    } catch { _blyatAudio = null; }

    _blyatTimer = setTimeout(stopBlyat, 30000);
}

function stopBlyat() {
    document.body.classList.remove('blyat-active');
    const ov = document.getElementById('blyatOverlay');
    if (ov) ov.remove();
    if (_blyatAudio) { try { _blyatAudio.pause(); } catch {} _blyatAudio = null; }
    if (_blyatTimer) { clearTimeout(_blyatTimer); _blyatTimer = null; }
}
