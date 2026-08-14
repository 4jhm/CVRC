let _navIsLinux = false;

const _navBadgeCache = { worlds: '', groups: '', people: '', avatars: '', calendar: '', library: '' };
let _navMyWorldsRequested = false;
let _navMyWorldsCount = null;

function _navLen(v) { return Array.isArray(v) ? v.length : null; }

function navSetMyWorldsCount(worlds) {
    _navMyWorldsCount = _navLen(worlds) ?? 0;
    navUpdateBadges();
}

function _navCalendarMonthCount() {
    const src = (typeof _calEvents !== 'undefined' && _calEvents.length) ? _calEvents
              : (typeof _calDashRawEvents !== 'undefined' ? _calDashRawEvents : null);
    if (!Array.isArray(src) || !src.length) return null;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    let n = 0;
    for (const evt of src) {
        const d = new Date(evt.startsAt || evt.startDate || '');
        if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m) n++;
    }
    return n;
}

function _navFmtCount(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
    if (n < 1000) return String(n);
    const short = (v, suffix) =>
        (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.floor(v))) + suffix;
    return n < 1000000 ? short(n / 1000, 'k') : short(n / 1000000, 'm');
}

function _navApplyBadge(kind, value) {
    if (value === null || value === undefined) return;
    const text = _navFmtCount(value);
    _navBadgeCache[kind] = text;
    document.querySelectorAll(`[data-nav-badge="${kind}"]`).forEach(el => {
        el.textContent = text;
        el.style.display = '';
    });
}

function navUpdateBadges() {
    if (typeof currentVrcUser === 'undefined' || !currentVrcUser) return;

    if (!_navMyWorldsRequested && typeof sendToCS === 'function') {
        _navMyWorldsRequested = true;
        sendToCS({ action: 'vrcGetMyWorlds' });
    }

    const favW = typeof favWorldsData !== 'undefined' ? _navLen(favWorldsData) : null;
    if (favW !== null || _navMyWorldsCount !== null)
        _navApplyBadge('worlds', (favW ?? 0) + (_navMyWorldsCount ?? 0));

    _navApplyBadge('people', typeof vrcFriendsData !== 'undefined' ? _navLen(vrcFriendsData) : null);
    _navApplyBadge('groups', typeof myGroups !== 'undefined' ? _navLen(myGroups) : null);

    const ownA = typeof avatarsData    !== 'undefined' ? _navLen(avatarsData)    : null;
    const favA = typeof favAvatarsData !== 'undefined' ? _navLen(favAvatarsData) : null;
    if (ownA !== null || favA !== null)
        _navApplyBadge('avatars', (ownA ?? 0) + (favA ?? 0));

    _navApplyBadge('calendar', _navCalendarMonthCount());
    _navApplyBadge('library', typeof libraryFiles !== 'undefined' ? _navLen(libraryFiles) : null);
}

function navUpdatePlaySubtitle() {
    const el = document.getElementById('playSubText');
    if (!el) return;
    if (typeof window !== 'undefined' && window.vrcGameRunning) {
        el.textContent = (typeof t === 'function')
            ? t('sidebar.currently_playing', 'Currently playing…')
            : 'Currently playing…';
        return;
    }
    const name = (typeof currentVrcUser !== 'undefined' && currentVrcUser)
        ? (currentVrcUser.displayName || '') : '';
    el.textContent = name
        ? (typeof tf === 'function' ? tf('sidebar.play_with', { name }, `Start with ${name}`) : `Start with ${name}`)
        : '';
}

(function () {
    function pollGameRunning() {
        if (typeof sendToCS === 'function') sendToCS({ action: 'afGetGameRunning' });
    }
    pollGameRunning();
    setInterval(pollGameRunning, 5000);
}());

function navSetLinux(v) {
    _navIsLinux = v;
    navRender();
}

function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('vrcnext_sidebar', sidebarCollapsed ? '1' : '0');
    const sidebar = document.getElementById('sidebarEl');
    const sbEl = document.getElementById('sbIcon'); if (sbEl) sbEl.textContent = sidebarCollapsed ? 'chevron_right' : 'chevron_left';
    if (sidebarCollapsed) {
        sidebar.classList.add('collapsing');
        setTimeout(() => {
            sidebar.classList.remove('collapsing');
            sidebar.classList.add('collapsed');
            if (typeof _applyLightInterp === 'function') _applyLightInterp();
        }, 230);
    } else {
        sidebar.classList.remove('collapsed');
    }
    if (typeof _applyLightInterp === 'function') _applyLightInterp();
}

document.documentElement.addEventListener('languagechange', () => {
    if (document.getElementById('navEl')) navRender();
});

function navRender() {
    const navEl = document.getElementById('navEl');
    if (!navEl) return;
    const { layout, hidden } = navLoadLayout();
    const hiddenSet = new Set(hidden);

    navEl.innerHTML = '';

    for (const entry of layout) {
        if (entry.type === 'separator') {
            navEl.appendChild(_navMakeSeparator(entry));
        } else if (entry.type === 'item') {
            const def = NAV_ITEMS_DEF[entry.key];
            if (!def || hiddenSet.has(entry.key)) continue;
            if (def.windowsOnly && _navIsLinux) continue;
            navEl.appendChild(_navMakeItemBtn(entry.key, entry.icon || def.icon, def.tab, def.i18n, def.label));
        } else if (entry.type === 'folder') {
            const visItems = (entry.items || []).filter(k => {
                const d = NAV_ITEMS_DEF[k];
                return d && !hiddenSet.has(k) && !(d.windowsOnly && _navIsLinux);
            });
            if (!visItems.length) continue;
            navEl.appendChild(_navMakeFolderGroup(entry, visItems));
        }
    }

    if (typeof applyTranslations === 'function') applyTranslations(navEl);

    navEl.querySelectorAll('.nav-group[data-group-id]').forEach(g => {
        if (localStorage.getItem('vrcnext_navgroup_' + g.dataset.groupId) === '1')
            g.classList.add('collapsed');
    });

    const activeTab = (typeof _prevTab !== 'undefined' && _prevTab >= 0) ? _prevTab : 0;
    navEl.querySelectorAll('.nav-btn[onclick]').forEach(b => {
        const match = b.getAttribute('onclick')?.match(/showTab\((\d+)\)/);
        if (match && parseInt(match[1]) === activeTab) {
            b.classList.add('active');
            const parentGroup = b.closest('.nav-group');
            if (parentGroup) { parentGroup.classList.add('has-active'); parentGroup.classList.remove('collapsed'); }
        }
    });

    applyNavFolderMode();
}

function navIsModernFolders() {
    return typeof settings === 'undefined' ? true : settings.modernFolderLayout !== false;
}

function applyNavFolderMode() {
    const navEl = document.getElementById('navEl');
    if (!navEl) return;
    const modern = navIsModernFolders();
    navEl.classList.toggle('modern-folders', modern);
    if (!modern) closeNavFolderPopout();
}

let _navFolderPopoutId = null;

function closeNavFolderPopout() {
    document.getElementById('navFolderPopout')?.remove();
    document.removeEventListener('mousedown', _navPopoutOutside, true);
    document.removeEventListener('keydown', _navPopoutKey, true);
    document.querySelectorAll('.nav-group.popout-open').forEach(g => g.classList.remove('popout-open'));
    _navFolderPopoutId = null;
}

function _navPopoutOutside(e) {
    const pop = document.getElementById('navFolderPopout');
    if (!pop || pop.contains(e.target)) return;
    if (e.target.closest('.nav-group-btn')) return;
    closeNavFolderPopout();
}

function _navPopoutKey(e) {
    if (e.key === 'Escape') closeNavFolderPopout();
}

function openNavFolderPopout(groupId, anchorEl) {
    if (!anchorEl) return;
    if (_navFolderPopoutId === groupId) { closeNavFolderPopout(); return; }
    closeNavFolderPopout();

    const { layout, hidden } = navLoadLayout();
    const hiddenSet = new Set(hidden);
    const entry = layout.find(e => e.type === 'folder' && e.id === groupId);
    if (!entry) return;
    const visItems = (entry.items || []).filter(k => {
        const d = NAV_ITEMS_DEF[k];
        return d && !hiddenSet.has(k) && !(d.windowsOnly && _navIsLinux);
    });
    if (!visItems.length) return;

    const activeTab = (typeof _prevTab !== 'undefined' && _prevTab >= 0) ? _prevTab : -1;

    const pop = document.createElement('div');
    pop.className = 'nav-folder-popout vrcn-scrollbar';
    pop.id = 'navFolderPopout';

    const title = document.createElement('div');
    title.className = 'nav-folder-popout-title';
    title.textContent = navEntryLabel(entry) || 'Folder';
    pop.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'nav-folder-popout-grid';
    if (visItems.length > 15) grid.classList.add('has-scroll');
    for (const key of visItems) {
        const def = NAV_ITEMS_DEF[key];
        if (!def) continue;
        const cell = document.createElement('button');
        cell.className = 'nav-folder-cell';
        cell.dataset.navKey = key;
        if (def.tab === activeTab) cell.classList.add('active');
        if (def.locked) {
            cell.classList.add('locked');
            cell.disabled = true;
            cell.title = t('nav.locked_soon', 'Coming soon');
        } else {
            cell.addEventListener('click', () => { showTab(def.tab); closeNavFolderPopout(); });
        }

        const ic = document.createElement('span');
        ic.className = 'nav-folder-cell-icon msi';
        ic.textContent = def.icon;
        cell.appendChild(ic);

        const lbl = document.createElement('span');
        lbl.className = 'nav-folder-cell-label';
        lbl.dataset.i18n = def.i18n;
        lbl.textContent = def.label || '';
        cell.appendChild(lbl);

        if (def.locked) {
            const lockIc = document.createElement('span');
            lockIc.className = 'nav-folder-cell-lock msi';
            lockIc.textContent = 'lock';
            cell.appendChild(lockIc);

            const soon = document.createElement('span');
            soon.className = 'nav-folder-cell-soon';
            soon.dataset.i18n = 'nav.soon';
            soon.textContent = t('nav.soon', 'Soon');
            cell.appendChild(soon);
        }

        grid.appendChild(cell);
    }
    pop.appendChild(grid);

    document.body.appendChild(pop);
    if (typeof applyTranslations === 'function') applyTranslations(pop);

    const sidebar = document.getElementById('sidebarEl');
    const aRect = anchorEl.getBoundingClientRect();
    const sRect = (sidebar || anchorEl).getBoundingClientRect();
    const gap = 6;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = sRect.right + gap;
    let top = aRect.top;
    if (left + pw > window.innerWidth - 8) left = aRect.left - pw - gap; 
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    if (top < 8) top = 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    anchorEl.closest('.nav-group')?.classList.add('popout-open');
    _navFolderPopoutId = groupId;

    setTimeout(() => {
        document.addEventListener('mousedown', _navPopoutOutside, true);
        document.addEventListener('keydown', _navPopoutKey, true);
    }, 0);
}

function _navMakeSeparator(entry) {
    const sep = document.createElement('div');
    sep.className = 'nav-sep';
    sep.dataset.sepId = entry.id || '';

    const lbl = document.createElement('span');
    lbl.className = 'nav-sep-label nl';
    lbl.textContent = navEntryLabel(entry);
    sep.appendChild(lbl);

    return sep;
}

function _navMakeItemBtn(key, icon, tab, i18nKey, labelFallback) {
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.dataset.navKey = key;
    const locked = !!NAV_ITEMS_DEF[key]?.locked;
    if (locked) {
        btn.classList.add('locked');
        btn.disabled = true;
        btn.title = t('nav.locked_soon', 'Coming soon');
    } else {
        btn.setAttribute('onclick', `showTab(${tab})`);
    }

    const ni = document.createElement('span');
    ni.className = 'ni msi';
    ni.textContent = icon;
    btn.appendChild(ni);

    const nl = document.createElement('span');
    nl.className = 'nl';
    nl.dataset.i18n = i18nKey;
    nl.textContent = labelFallback || '';
    btn.appendChild(nl);

    if (locked) {
        const lockIc = document.createElement('span');
        lockIc.className = 'nav-btn-lock msi';
        lockIc.textContent = 'lock';
        btn.appendChild(lockIc);
    }

    const badgeKind = NAV_ITEMS_DEF[key]?.badge;
    if (badgeKind) {
        const nb = document.createElement('span');
        nb.className = 'nav-badge nl';
        nb.dataset.navBadge = badgeKind;
        nb.textContent = _navBadgeCache[badgeKind] ?? '';
        if (!nb.textContent) nb.style.display = 'none';
        btn.appendChild(nb);
    }

    if (key === 'dashboard') btn.dataset.nav = 'dashboard';
    if (key === 'vr-overlay') {
        const dot = document.createElement('span');
        dot.className = 'sf-dot offline nl';
        dot.id = 'badgeVro';
        dot.style.cssText = 'margin-left:auto;margin-right:4px;width:7px;height:7px;flex-shrink:0;';
        btn.appendChild(dot);
    }
    if (key === 'event-snipe') {
        const dot = document.createElement('span');
        dot.id = 'snipeNavDot';
        dot.style.cssText = 'display:none;width:7px;height:7px;border-radius:50%;background:var(--ok,#4caf50);margin-left:auto;margin-right:4px;flex-shrink:0;';
        btn.appendChild(dot);
    }
    return btn;
}

function _navMakeFolderGroup(entry, visItems) {
    const group = document.createElement('div');
    group.className = 'nav-group';
    group.id = entry.id;
    group.dataset.groupId = entry.id;

    const hdr = document.createElement('button');
    hdr.className = 'nav-btn nav-group-btn';
    hdr.setAttribute('onclick', `toggleNavGroup('${entry.id}')`);

    const ni = document.createElement('span');
    ni.className = 'ni msi';
    ni.textContent = entry.icon || 'folder';
    hdr.appendChild(ni);

    const nl = document.createElement('span');
    nl.className = 'nl';
    nl.textContent = navEntryLabel(entry) || 'Folder';
    hdr.appendChild(nl);

    const arrow = document.createElement('span');
    arrow.className = 'nav-group-arrow msi nl';
    arrow.textContent = 'expand_more';
    hdr.appendChild(arrow);

    group.appendChild(hdr);

    const items = document.createElement('div');
    items.className = 'nav-group-items';
    for (const key of visItems) {
        const def = NAV_ITEMS_DEF[key];
        if (!def) continue;
        const btn = _navMakeItemBtn(key, def.icon, def.tab, def.i18n, def.label);
        btn.classList.add('nav-sub');
        items.appendChild(btn);
    }
    group.appendChild(items);
    return group;
}

navRender();
