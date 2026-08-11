let _fpExclude = new Set();
let _fpOnPick  = null;
let _fpEmptyText = '';

function openFriendPicker(opts) {
    const o = opts || {};
    _fpExclude   = new Set(o.exclude || []);
    _fpOnPick    = typeof o.onPick === 'function' ? o.onPick : null;
    _fpEmptyText = o.emptyText || t('permini.picker.empty', 'No friends available.');

    const box = document.getElementById('fpBox');
    if (box) {
        box.innerHTML = `
            ${renderModalBar(o.title || t('permini.picker.title', 'Add Friend'),
                             [modalCloseAction('closeFriendPicker()')], { flush: true })}
            <div class="inv-search-wrap">
                <input class="inv-search-input" type="text" id="fpSearchInput" placeholder="${esc(t('common.search', 'Search...'))}" oninput="filterFriendPicker(this.value)">
            </div>
            <div class="inv-list vrcn-scrollbar" id="fpList"></div>`;
    }

    renderFriendPicker('');
    const modal = document.getElementById('modalFriendPicker');
    if (modal) modal.style.display = 'flex';
    setTimeout(() => document.getElementById('fpSearchInput')?.focus(), 80);
}

function closeFriendPicker() {
    const modal = document.getElementById('modalFriendPicker');
    if (modal) modal.style.display = 'none';
}

function filterFriendPicker(val) {
    renderFriendPicker(val);
}

function renderFriendPicker(filter) {
    const el = document.getElementById('fpList');
    if (!el) return;

    const term = (filter || '').toLowerCase();
    const friends = (typeof vrcFriendsData !== 'undefined' ? vrcFriendsData : []).filter(f => {
        if (!f.id || _fpExclude.has(f.id)) return false;
        if (term) return (f.displayName || '').toLowerCase().includes(term);
        return true;
    });

    if (!friends.length) {
        el.innerHTML = `<div class="inv-empty">${esc(_fpEmptyText)}</div>`;
        return;
    }

    el.innerHTML = friends.map(f => {
        const trailing = `<span class="msi" style="font-size:18px;color:var(--accent);margin-left:auto;flex-shrink:0;">add</span>`;
        return renderUserItem(f, `friendPickerPick('${jsq(f.id)}')`, { trailing });
    }).join('');
}

function friendPickerPick(userId) {
    const cb = _fpOnPick;
    closeFriendPicker();
    if (cb) cb(userId);
}
