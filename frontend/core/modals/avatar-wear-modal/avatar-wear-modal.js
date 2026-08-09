function showAvatarWearModal(avatarId, name, thumb, author) {
    closeAvatarWearModal();
    if (!avatarId) return;

    const label = name || t('avatars.labels.unnamed', 'Unnamed');
    const sub = author || t('avatars.wear.sub_fallback', 'Choose what to do with this avatar');

    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.style.display = 'flex';
    el.style.zIndex = '10004';
    el.innerHTML = `
        <div class="launch-modal" role="dialog" aria-labelledby="_awTitle">
            <div class="launch-head">
                <div class="launch-head-txt">
                    <div class="launch-title" id="_awTitle">${esc(t('avatars.wear.title', 'Avatar'))}</div>
                    <div class="launch-sub">${esc(tf('avatars.wear.question', { name: label }, `You want to wear ${label}?`))}</div>
                </div>
                <button class="launch-close" id="_awClose" title="${esc(t('common.close', 'Close'))}" aria-label="${esc(t('common.close', 'Close'))}">
                    <span class="msi">close</span>
                </button>
            </div>
            <div class="launch-modes aw-modes">
                <button class="launch-mode" id="_awUse">
                    <span class="msi">checkroom</span>
                    <span class="launch-mode-label">${esc(t('avatars.wear.use', 'Use Avatar'))}</span>
                </button>
                <button class="launch-mode" id="_awOpen">
                    <span class="msi">open_in_new</span>
                    <span class="launch-mode-label">${esc(t('avatars.wear.open', 'Open Avatar'))}</span>
                </button>
            </div>
            <div class="launch-foot">
                ${thumb ? `<span class="aw-thumb" style="background-image:url('${cssUrl(thumb)}')"></span>` : ''}
                <span class="aw-meta">${esc(sub)}</span>
                <div class="launch-foot-spacer"></div>
                <button class="launch-icon-btn" id="_awCopy" title="${esc(t('avatars.wear.copy_link', 'Copy Avatar Link'))}" aria-label="${esc(t('avatars.wear.copy_link', 'Copy Avatar Link'))}">
                    <span class="msi">link</span>
                </button>
            </div>
        </div>`;

    const on = (id, fn) => { const b = el.querySelector(id); if (b) b.addEventListener('click', fn); };
    on('#_awClose', closeAvatarWearModal);
    on('#_awUse', () => {
        closeAvatarWearModal();
        if (typeof avatarWearNow === 'function') avatarWearNow(avatarId);
    });
    on('#_awOpen', () => {
        closeAvatarWearModal();
        if (typeof openAvatarDetail === 'function') openAvatarDetail(avatarId);
    });
    on('#_awCopy', () => {
        navigator.clipboard.writeText('https://vrchat.com/home/avatar/' + avatarId)
            .then(() => showToast(true, t('avatars.wear.link_copied', 'Avatar link copied!')))
            .catch(() => showToast(false, t('timeline.toast.copy_failed', 'Failed to copy')));
    });

    el.addEventListener('click', e => { if (e.target === el) closeAvatarWearModal(); });
    document.body.appendChild(el);
    window._avatarWearModalEl = el;
}

function closeAvatarWearModal() {
    const el = window._avatarWearModalEl;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity .15s';
    setTimeout(() => el.remove(), 150);
    window._avatarWearModalEl = null;
}
