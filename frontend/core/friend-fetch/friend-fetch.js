let _ffState = { running: false, done: 0, total: 0, cooldownMs: 0 };
let _ffStateKnown = false;
let _ffTicker = null;

function friendFetchStart() {
    if (!_ffStateKnown || _ffState.running || _ffState.cooldownMs > 0) {
        friendFetchRequestState();
        return;
    }
    if (typeof netEnsureMutualCache === 'function') netEnsureMutualCache();
    sendToCS({ action: 'vrcFriendFetchStart' });
    friendFetchRequestState();
}


function friendFetchRequestState() {
    sendToCS({ action: 'vrcFriendFetchState' });
}

function ffCooldownText(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m` : `${s}s`;
}

function onFriendFetchProgress(payload) {
    const wasRunning = _ffState.running;
    _ffStateKnown = true;
    _ffState = {
        running: !!payload.running,
        done: payload.done || 0,
        total: payload.total || 0,
        cooldownMs: payload.cooldownMs || 0,
    };
    _ffSyncTicker();
    friendFetchSyncUi();
    if (wasRunning && !_ffState.running) setTimeout(friendFetchRequestState, 400);
}

function _ffSyncTicker() {
    const needs = _ffState.cooldownMs > 0 && !_ffState.running;
    if (needs && !_ffTicker) {
        _ffTicker = setInterval(() => {
            _ffState.cooldownMs = Math.max(0, _ffState.cooldownMs - 1000);
            if (_ffState.cooldownMs === 0) { clearInterval(_ffTicker); _ffTicker = null; }
            friendFetchSyncUi();
        }, 1000);
    } else if (!needs && _ffTicker) {
        clearInterval(_ffTicker);
        _ffTicker = null;
    }
}

const _FF_BUTTONS = ['peopleFetchBtn', 'netFetchBtn'];

function friendFetchSyncUi() {
    const { running, done, total, cooldownMs } = _ffState;
    const label = running ? `${done} / ${total}` : t('friend_fetch.button', 'Fetch');

    _FF_BUTTONS.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !_ffStateKnown || running || cooldownMs > 0;
        btn.classList.toggle('active', running);
        const ico = btn.querySelector('.msi');
        if (ico) ico.textContent = running ? 'sync' : 'cloud_download';
        const txt = btn.querySelector('.ff-btn-label');
        if (txt) txt.textContent = label;
        btn.title = running
            ? t('friend_fetch.running_title', 'Fetching friend profiles')
            : cooldownMs > 0
                ? tf('friend_fetch.cooldown', { time: ffCooldownText(cooldownMs) }, `Available again in ${ffCooldownText(cooldownMs)}`)
                : t('friend_fetch.button_title', 'Fetches all friends information such as biography, images, names, joined date, status, and many more informations.');
    });
}

document.documentElement.addEventListener('languagechange', friendFetchSyncUi);
document.documentElement.addEventListener('tabchange', friendFetchRequestState);

function friendFetchInit() {
    friendFetchSyncUi();
    friendFetchRequestState();
}
