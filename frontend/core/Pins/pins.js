/* === Pins === */

const PINS_MAX = 10;
const _PINS_KEY = 'vrcnext_pins_v1';

let _pins = [];

function _pinsLoad() {
    try {
        const raw = localStorage.getItem(_PINS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        _pins = Array.isArray(arr) ? arr.filter(p => p && p.type && p.id).slice(0, PINS_MAX) : [];
    } catch { _pins = []; }
}

function _pinsSave() {
    try { localStorage.setItem(_PINS_KEY, JSON.stringify(_pins)); } catch { }
}

function pinsKey(type, id) { return type + ':' + id; }

function pinsHas(type, id) {
    return _pins.some(p => p.type === type && p.id === id);
}

function pinsList() { return _pins.slice(); }

// Data lookup

// Pulls name/image from the caches SmartSearch already reads, so a pin created from a
// context menu that only knows an id still gets a label and a thumbnail.
function _pinsResolve(type, id) {
    const find = (arr, key = 'id') => Array.isArray(arr) ? arr.find(x => x && x[key] === id) : null;
    let m = null;

    switch (type) {
        case 'user':
            m = (typeof vrcFriendsData !== 'undefined') ? find(vrcFriendsData) : null;
            return m ? { name: m.displayName || '', image: m.image || '' } : null;
        case 'world':
            m = (typeof favWorldsData !== 'undefined') ? find(favWorldsData) : null;
            return m ? { name: m.name || '', image: m.thumbnailImageUrl || m.imageUrl || '' } : null;
        case 'group':
            m = (typeof myGroups !== 'undefined') ? find(myGroups) : null;
            return m ? { name: m.name || '', image: m.iconUrl || '', sub: m.shortCode || '' } : null;
        case 'avatar':
            m = (typeof avatarsData !== 'undefined') ? find(avatarsData) : null;
            if (!m && typeof favAvatarsData !== 'undefined') m = find(favAvatarsData);
            return m ? { name: m.name || '', image: m.thumbnailImageUrl || m.imageUrl || '' } : null;
        default:
            return null;
    }
}

const _PINS_TYPE_ICON = {
    user: 'person', world: 'public', avatar: 'checkroom',
    group: 'groups', event: 'event', feature: 'widgets',
};

function _pinsTypeLabel(type) {
    switch (type) {
        case 'user':    return t('pins.type.user', 'Profile');
        case 'world':   return t('pins.type.world', 'World');
        case 'avatar':  return t('pins.type.avatar', 'Avatar');
        case 'group':   return t('pins.type.group', 'Group');
        case 'event':   return t('pins.type.event', 'Event');
        case 'feature': return t('pins.type.feature', 'Feature');
        default:        return '';
    }
}

// Mutations

function pinsAdd(entry) {
    if (!entry || !entry.type || !entry.id) return false;
    if (pinsHas(entry.type, entry.id)) return false;

    if (_pins.length >= PINS_MAX) {
        if (typeof showToast === 'function')
            showToast(false, tf('pins.toast.limit', { max: PINS_MAX }, `Pin limit reached (${PINS_MAX})`));
        return false;
    }

    const resolved = _pinsResolve(entry.type, entry.id) || {};
    _pins.push({
        type:    entry.type,
        id:      entry.id,
        // Left empty on purpose when unknown - the id is only a display fallback, and an
        // empty name is what marks the pin as still needing a lookup.
        name:    entry.name || resolved.name || '',
        image:   entry.image || resolved.image || '',
        sub:     entry.sub || resolved.sub || '',
        ownerId: entry.ownerId || '',
        tab:     typeof entry.tab === 'number' ? entry.tab : null,
        icon:    entry.icon || '',
    });
    _pinsSave();
    _pinsBackfill();
    _pinsRenderMenu();
    if (typeof showToast === 'function') showToast(true, t('pins.toast.added', 'Pinned'));
    return true;
}

// Profiles pinned from search or a group log are not in any local cache, so ask the
// backend for the display name and avatar and patch the pin once it answers.
function _pinsBackfill() {
    if (typeof sendToCS !== 'function') return;
    _pins.forEach(p => {
        if (p.type === 'user' && !p.name) {
            sendToCS({ action: 'vrcGetUserBasic', userId: p.id, contextId: 'pin' });
        }
    });
}

function pinsOnUserBasic(payload) {
    if (!payload || payload.contextId !== 'pin') return;
    const pin = _pins.find(p => p.type === 'user' && p.id === payload.id);
    if (!pin) return;
    if (!payload.displayName && !payload.image) return;
    if (payload.displayName) pin.name = payload.displayName;
    if (payload.image) pin.image = payload.image;
    _pinsSave();
    _pinsRenderMenu();
}

function pinsRemove(type, id) {
    const before = _pins.length;
    _pins = _pins.filter(p => !(p.type === type && p.id === id));
    if (_pins.length === before) return false;
    _pinsSave();
    _pinsRenderMenu();
    if (typeof showToast === 'function') showToast(true, t('pins.toast.removed', 'Pin removed'));
    return true;
}

function pinsOpen(type, id) {
    const pin = _pins.find(p => p.type === type && p.id === id);
    if (!pin) return;
    _pinsCloseMenu();

    switch (pin.type) {
        case 'user':
            if (typeof openFriendDetail === 'function') openFriendDetail(pin.id);
            break;
        case 'world':
            if (typeof openWorldSearchDetail === 'function') openWorldSearchDetail(pin.id);
            break;
        case 'group':
            if (typeof openGroupDetail === 'function') openGroupDetail(pin.id);
            break;
        case 'avatar':
            if (typeof openAvatarDetail === 'function') openAvatarDetail(pin.id);
            break;
        case 'event':
            if (typeof openEventDetail === 'function') openEventDetail(pin.ownerId || '', pin.id);
            break;
        case 'feature':
            if (typeof showTab === 'function' && typeof pin.tab === 'number') showTab(pin.tab);
            break;
    }
}

// Context menu contract

// Returns the pin/unpin entry for a context menu, or null when the type is unknown.
function pinsContextItem(type, id, data) {
    if (!type || !id) return null;
    if (pinsHas(type, id)) {
        return {
            icon: 'push_pin',
            label: t('pins.remove', 'Remove pin'),
            action: () => pinsRemove(type, id),
        };
    }
    return {
        icon: 'push_pin',
        label: t('pins.add', 'Add to pins'),
        action: () => pinsAdd({ type, id, ...(data || {}) }),
    };
}

// Menu

// Open/close and positioning are handled by the shared .tb-menu-item wiring in
// taskbar.js; this only needs to close the menu after a pin was activated.
function _pinsCloseMenu() {
    document.getElementById('tbMenuPins')?.classList.remove('open');
}

// Built via DOM rather than innerHTML so pinned names cannot inject markup.
function _pinsRenderMenu() {
    const drop = document.getElementById('pinsDropdown');
    if (!drop) return;
    drop.innerHTML = '';

    if (!_pins.length) {
        const empty = document.createElement('div');
        empty.className = 'pins-empty';
        empty.textContent = t('pins.empty', 'No pins yet.');
        drop.appendChild(empty);
        return;
    }

    _pins.forEach(pin => {
        const row = document.createElement('div');
        row.className = 'pins-item ss-item';
        row.dataset.pinType = pin.type;
        row.dataset.pinId   = pin.id;
        const label = pin.name || pin.id;

        if (pin.type === 'feature') {
            const ph = document.createElement('div');
            ph.className = 'ss-item-img-placeholder';
            ph.style.borderRadius = '8px';
            const span = document.createElement('span');
            span.className = 'msi';
            span.style.cssText = 'font-size:16px;color:var(--accent);';
            span.textContent = pin.icon || _PINS_TYPE_ICON.feature;
            ph.appendChild(span);
            row.appendChild(ph);
        } else if (pin.image) {
            const img = document.createElement('img');
            img.className = 'ss-item-img';
            img.src = pin.image;
            img.onerror = function () {
                const ph = document.createElement('div');
                ph.className = 'ss-item-img-placeholder';
                ph.textContent = (label[0] || '?').toUpperCase();
                this.parentNode.replaceChild(ph, this);
            };
            row.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'ss-item-img-placeholder';
            ph.textContent = (label[0] || '?').toUpperCase();
            row.appendChild(ph);
        }

        const info = document.createElement('div');
        info.className = 'ss-item-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'ss-item-name';
        nameEl.textContent = label;
        info.appendChild(nameEl);
        const subEl = document.createElement('div');
        subEl.className = 'ss-item-sub';
        subEl.textContent = pin.sub ? `${_pinsTypeLabel(pin.type)} · ${pin.sub}` : _pinsTypeLabel(pin.type);
        info.appendChild(subEl);
        row.appendChild(info);

        const badge = document.createElement('span');
        badge.className = 'msi pins-item-type';
        badge.textContent = _PINS_TYPE_ICON[pin.type] || 'push_pin';
        row.appendChild(badge);

        row.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            pinsOpen(pin.type, pin.id);
        });

        drop.appendChild(row);
    });
}

function pinsInit() {
    _pinsLoad();
    _pinsBackfill();
    _pinsRenderMenu();
}

window.pinsContextItem  = pinsContextItem;
window.pinsOpen         = pinsOpen;
window.pinsAdd          = pinsAdd;
window.pinsRemove       = pinsRemove;
window.pinsHas          = pinsHas;
window.pinsList         = pinsList;
window.pinsInit         = pinsInit;
window.pinsOnUserBasic  = pinsOnUserBasic;

// Self-initialise: this file loads after init.js, so init.js cannot call pinsInit.
pinsInit();

// Rows are built with textContent, so the [data-i18n] sweep in applyTranslations()
// cannot reach them. The translation bundle also arrives asynchronously after this
// file first renders, which is why the initial pass still shows English fallbacks.
document.documentElement.addEventListener('languagechange', () => _pinsRenderMenu());
