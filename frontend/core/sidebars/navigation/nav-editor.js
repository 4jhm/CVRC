let _edLayout = [];
let _edHidden = [];
let _edStartPage = 'dashboard';
let _edIconPickerClose = null;
let _edDragCleanup = null;

function _edT(key, fallback) {
    return (typeof t === 'function') ? t(key, fallback) : fallback;
}

// ===== Open / Close / Confirm =====

function openNavEditor() {
    const state = navLoadLayout();
    _edLayout = _navClone(state.layout);
    _edHidden = [...state.hidden];
    _edStartPage = state.start || 'dashboard';
    const overlay = document.getElementById('navEditorOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    _edRenderList();
}

function closeNavEditor() {
    const overlay = document.getElementById('navEditorOverlay');
    if (overlay) overlay.style.display = 'none';
    if (_edIconPickerClose) { _edIconPickerClose(); _edIconPickerClose = null; }
}

function _edConfirm() {
    _edSyncLayoutFromDom();
    navSaveLayout(_edLayout, _edHidden, _edStartPage);
    navRender();
    closeNavEditor();
    if (typeof _prevTab !== 'undefined' && typeof showTab === 'function') showTab(_prevTab);
}

function _edRestoreDefault() {
    _edLayout = _navClone(NAV_DEFAULT_LAYOUT);
    _edHidden = [];
    _edStartPage = 'dashboard';
    _edRenderList();
}

function _edAddFolder() {
    _edSyncLayoutFromDom();
    _edLayout.push({ type: 'folder', id: _navMakeFolderId(), name: 'New Folder', icon: 'folder', items: [] });
    _edRenderList();
    setTimeout(() => {
        const inputs = document.querySelectorAll('#navEditorList .ne-folder-name');
        if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    }, 30);
}

function _edAddSeparator() {
    _edSyncLayoutFromDom();
    _edLayout.push({ type: 'separator', id: _navMakeSeparatorId(), name: _edT('nav.editor.new_separator', 'New Section') });
    _edRenderList();
    setTimeout(() => {
        const inputs = document.querySelectorAll('#navEditorList .ne-sep-name');
        if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    }, 30);
}

// ===== Render =====

function _edRenderList() {
    const list = document.getElementById('navEditorList');
    if (!list) return;
    list.innerHTML = '';

    for (let i = 0; i < _edLayout.length; i++) {
        const entry = _edLayout[i];
        if (entry.type === 'separator') {
            list.appendChild(_edMakeSeparatorRow(entry));
        } else if (entry.type === 'item') {
            list.appendChild(_edMakeItemRow(entry.key, entry.icon, i, null));
        } else if (entry.type === 'folder') {
            list.appendChild(_edMakeFolderSection(entry, i));
        }
    }

    const hiddenKeys = _edHidden.filter(k => k in NAV_ITEMS_DEF
        && !(NAV_ITEMS_DEF[k].windowsOnly && typeof _navIsLinux !== 'undefined' && _navIsLinux));
    if (hiddenKeys.length) {
        const sep = document.createElement('div');
        sep.className = 'ne-hidden-sep';
        sep.textContent = _edT('nav.editor.hidden', 'Hidden');
        list.appendChild(sep);
        for (const key of hiddenKeys) list.appendChild(_edMakeHiddenRow(key));
    }

    if (typeof applyTranslations === 'function') applyTranslations(list);

    _edInitDrag(list);
}

function _edMakeItemRow(key, iconOverride, topIdx, folderId) {
    const def = NAV_ITEMS_DEF[key];
    if (!def) return document.createElement('div');
    if (def.windowsOnly && typeof _navIsLinux !== 'undefined' && _navIsLinux) return document.createElement('div');
    const isSubItem = folderId !== null;
    const icon = iconOverride || def.icon;

    const row = document.createElement('div');
    row.className = 'ne-row' + (isSubItem ? ' ne-sub' : '');
    row.dataset.key = key;

    const handle = document.createElement('span');
    handle.className = 'ne-handle msi';
    handle.textContent = 'drag_indicator';
    row.appendChild(handle);

    const iconEl = document.createElement('span');
    iconEl.className = 'ne-icon msi';
    iconEl.textContent = icon;
    iconEl.title = _edT('nav.editor.change_icon', 'Change icon');
    iconEl.addEventListener('click', e => {
        e.stopPropagation();
        _edOpenIconPicker(iconEl, iconEl.textContent, newIcon => {
            iconEl.textContent = newIcon;
        });
    });
    row.appendChild(iconEl);

    const lbl = document.createElement('span');
    lbl.className = 'ne-label';
    lbl.dataset.i18n = def.i18n;
    lbl.textContent = def.label;
    row.appendChild(lbl);

    row.appendChild(Object.assign(document.createElement('span'), { className: 'ne-spacer' }));

    const homeBtn = document.createElement('button');
    homeBtn.className = 'ne-btn ne-home-btn' + (key === _edStartPage ? ' active' : '');
    homeBtn.title = _edT('nav.editor.set_home', 'Set as start page');
    homeBtn.innerHTML = '<span class="msi">home</span>';
    homeBtn.addEventListener('click', () => {
        _edSyncLayoutFromDom();
        _edStartPage = (_edStartPage === key) ? 'dashboard' : key;
        _edRenderList();
    });
    row.appendChild(homeBtn);

    if (key !== 'dashboard') {
        const hideBtn = document.createElement('button');
        hideBtn.className = 'ne-btn';
        hideBtn.title = _edT('nav.editor.hide', 'Hide');
        hideBtn.innerHTML = '<span class="msi">visibility_off</span>';
        hideBtn.addEventListener('click', () => {
            _edSyncLayoutFromDom();
            _edHideItem(key, folderId);
        });
        row.appendChild(hideBtn);
    }

    return row;
}

function _edMakeSeparatorRow(entry) {
    const row = document.createElement('div');
    row.className = 'ne-row ne-sep-row';
    row.dataset.sepId = entry.id;

    const handle = document.createElement('span');
    handle.className = 'ne-handle msi';
    handle.textContent = 'drag_indicator';
    row.appendChild(handle);

    const iconEl = document.createElement('span');
    iconEl.className = 'ne-icon msi ne-sep-icon';
    iconEl.textContent = 'horizontal_rule';
    row.appendChild(iconEl);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ne-sep-name vrcn-edit-field';
    nameInput.value = navEntryLabel(entry);
    nameInput.dataset.defaultLabel = navEntryLabel(entry);
    nameInput.placeholder = _edT('nav.editor.separator_name', 'Separator name');
    nameInput.addEventListener('mousedown', e => e.stopPropagation());
    row.appendChild(nameInput);

    row.appendChild(Object.assign(document.createElement('span'), { className: 'ne-spacer' }));

    const delBtn = document.createElement('button');
    delBtn.className = 'ne-btn ne-del-btn';
    delBtn.title = _edT('nav.editor.delete_separator', 'Delete separator');
    delBtn.innerHTML = '<span class="msi">delete</span>';
    delBtn.addEventListener('click', () => {
        _edSyncLayoutFromDom();
        _edLayout = _edLayout.filter(e => !(e.type === 'separator' && e.id === entry.id));
        _edRenderList();
    });
    row.appendChild(delBtn);

    return row;
}

function _edMakeFolderSection(entry, topIdx) {
    const section = document.createElement('div');
    section.className = 'ne-folder-section';
    section.dataset.folderId = entry.id;

    const row = document.createElement('div');
    row.className = 'ne-row ne-folder-row';
    row.dataset.folderId = entry.id;

    const handle = document.createElement('span');
    handle.className = 'ne-handle msi';
    handle.textContent = 'drag_indicator';
    row.appendChild(handle);

    const iconEl = document.createElement('span');
    iconEl.className = 'ne-icon msi';
    iconEl.textContent = entry.icon || 'folder';
    iconEl.title = _edT('nav.editor.change_icon', 'Change icon');
    iconEl.addEventListener('click', e => {
        e.stopPropagation();
        _edOpenIconPicker(iconEl, iconEl.textContent, newIcon => {
            iconEl.textContent = newIcon;
        });
    });
    row.appendChild(iconEl);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ne-folder-name vrcn-edit-field';
    nameInput.value = navEntryLabel(entry) || 'Folder';
    nameInput.dataset.defaultLabel = navEntryLabel(entry) || 'Folder';
    nameInput.placeholder = 'Folder name';
    nameInput.addEventListener('mousedown', e => e.stopPropagation());
    row.appendChild(nameInput);

    row.appendChild(Object.assign(document.createElement('span'), { className: 'ne-spacer' }));

    const delBtn = document.createElement('button');
    delBtn.className = 'ne-btn ne-del-btn';
    delBtn.title = _edT('nav.editor.delete_folder', 'Delete folder');
    delBtn.innerHTML = '<span class="msi">folder_delete</span>';
    delBtn.addEventListener('click', () => {
        _edSyncLayoutFromDom();
        const folderIdx = _edLayout.findIndex(e => e.type === 'folder' && e.id === entry.id);
        if (folderIdx < 0) return;
        const promoted = _edLayout[folderIdx].items.map(k => ({ type: 'item', key: k, icon: null }));
        _edLayout.splice(folderIdx, 1, ...promoted);
        _edRenderList();
    });
    row.appendChild(delBtn);

    section.appendChild(row);

    for (const key of entry.items) {
        if (!(key in NAV_ITEMS_DEF)) continue;
        section.appendChild(_edMakeItemRow(key, null, topIdx, entry.id));
    }

    if (entry.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ne-folder-empty';
        empty.textContent = _edT('nav.editor.drop_here', 'Drop items here');
        section.appendChild(empty);
    }

    return section;
}

function _edMakeHiddenRow(key) {
    const def = NAV_ITEMS_DEF[key];
    if (!def) return document.createElement('div');

    const row = document.createElement('div');
    row.className = 'ne-row ne-hidden-row';

    const iconEl = document.createElement('span');
    iconEl.className = 'ne-icon msi';
    iconEl.textContent = def.icon;
    row.appendChild(iconEl);

    const lbl = document.createElement('span');
    lbl.className = 'ne-label';
    lbl.dataset.i18n = def.i18n;
    lbl.textContent = def.label;
    row.appendChild(lbl);

    row.appendChild(Object.assign(document.createElement('span'), { className: 'ne-spacer' }));

    const showBtn = document.createElement('button');
    showBtn.className = 'ne-btn';
    showBtn.title = _edT('nav.editor.show', 'Show');
    showBtn.innerHTML = '<span class="msi">visibility</span>';
    showBtn.addEventListener('click', () => {
        _edSyncLayoutFromDom();
        _edHidden = _edHidden.filter(k => k !== key);
        const settingsIdx = _edLayout.findIndex(e => e.type === 'item' && e.key === 'settings');
        const at = settingsIdx >= 0 ? settingsIdx : _edLayout.length;
        _edLayout.splice(at, 0, { type: 'item', key, icon: null });
        _edRenderList();
    });
    row.appendChild(showBtn);
    return row;
}

function _edHideItem(key, folderId) {
    if (folderId) {
        const folder = _edLayout.find(e => e.type === 'folder' && e.id === folderId);
        if (folder) folder.items = folder.items.filter(k => k !== key);
    } else {
        _edLayout = _edLayout.filter(e => !(e.type === 'item' && e.key === key));
    }
    if (!_edHidden.includes(key)) _edHidden.push(key);
    if (key === _edStartPage) _edStartPage = 'dashboard';
    _edRenderList();
}

// ===== Sync layout from DOM =====

function _edKeepName(input, entryId, fallback) {
    if (!input) return fallback;
    const def = NAV_DEFAULT_NAMES[entryId];
    if (def && input.value === (input.dataset.defaultLabel || '')) return def[1];
    return input.value;
}

function _edSyncLayoutFromDom() {
    const list = document.getElementById('navEditorList');
    if (!list || !list.children.length) return;
    const newLayout = [];
    for (const child of list.children) {
        if (child.classList.contains('ne-hidden-sep')) break;
        if (child.classList.contains('ne-sep-row')) {
            const nameInput = child.querySelector('.ne-sep-name');
            const sepId = child.dataset.sepId || _navMakeSeparatorId();
            newLayout.push({
                type: 'separator',
                id: sepId,
                name: _edKeepName(nameInput, sepId, ''),
            });
        } else if (child.classList.contains('ne-folder-section')) {
            const folderId = child.dataset.folderId;
            const old = _edLayout.find(e => e.type === 'folder' && e.id === folderId);
            if (!old) continue;
            const nameInput = child.querySelector('.ne-folder-name');
            const iconEl = child.querySelector(':scope > .ne-folder-row .ne-icon');
            const items = [...child.children]
                .filter(s => s.classList.contains('ne-sub') && s.dataset.key)
                .map(s => s.dataset.key);
            newLayout.push({
                type: 'folder',
                id: folderId,
                name: _edKeepName(nameInput, folderId, old.name || 'Folder'),
                icon: iconEl ? iconEl.textContent.trim() : (old.icon || 'folder'),
                items,
            });
        } else if (child.classList.contains('ne-row') && child.dataset.key && !child.classList.contains('ne-hidden-row')) {
            const key = child.dataset.key;
            const def = NAV_ITEMS_DEF[key];
            if (!def) continue;
            const iconEl = child.querySelector('.ne-icon');
            const domIcon = iconEl ? iconEl.textContent.trim() : null;
            newLayout.push({ type: 'item', key, icon: (domIcon && domIcon !== def.icon) ? domIcon : null });
        }
    }
    _edLayout = newLayout;
}

// ===== FLIP Drag System =====

function _edInitDrag(list) {
    if (_edDragCleanup) { _edDragCleanup(); _edDragCleanup = null; }

    const ANIM_MS = 200;
    const EASE = 'cubic-bezier(.2,.7,.3,1)';
    let drag = null;

    const isFolderSection = el => el && el.classList.contains('ne-folder-section');
    const isFolderRow     = el => el && el.classList.contains('ne-folder-row');
    const isSubRow        = el => el && el.classList.contains('ne-sub');
    const isSepRow        = el => el && el.classList.contains('ne-sep-row');
    const isHiddenRow     = el => el && el.classList.contains('ne-hidden-row');
    const isHiddenSep     = el => el && el.classList.contains('ne-hidden-sep');

    function blockOf(row) {
        if (isFolderRow(row)) return row.closest('.ne-folder-section');
        return row;
    }

    function collectBlocks() {
        const out = [];
        for (const child of list.children) {
            if (isHiddenSep(child)) break;
            if (isFolderSection(child)) {
                const header = child.querySelector(':scope > .ne-folder-row');
                out.push({ el: child, type: 'folder', row: header });
                for (const sub of child.children) {
                    if (isSubRow(sub)) out.push({ el: sub, type: 'sub', row: sub });
                }
            } else if (child.classList.contains('ne-row') && !isHiddenRow(child)) {
                out.push({ el: child, type: 'top', row: child });
            }
        }
        return out;
    }

    function snap() {
        const map = new Map();
        list.querySelectorAll('.ne-row, .ne-folder-section').forEach(el => {
            map.set(el, el.getBoundingClientRect().top);
        });
        return map;
    }

    function flip(prev) {
        list.querySelectorAll('.ne-row, .ne-folder-section').forEach(el => {
            if (!prev.has(el)) return;
            const dy = prev.get(el) - el.getBoundingClientRect().top;
            if (!dy) return;
            el.animate(
                [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
                { duration: ANIM_MS, easing: EASE }
            );
        });
    }

    function resolveTarget(clientY, draggedBlock) {
        const blocks = collectBlocks().filter(b => b.el !== draggedBlock);
        const noNest = isFolderSection(draggedBlock) || isSepRow(draggedBlock);
        let best = null;

        for (const b of blocks) {
            const rect = b.row.getBoundingClientRect();
            const mid  = rect.top + rect.height / 2;

            if (b.type === 'folder' && !noNest) {
                const hasOtherItems = [...b.el.querySelectorAll(':scope > .ne-sub')]
                    .some(s => s !== draggedBlock);
                const intoTop = rect.top + rect.height * 0.25;
                const intoBot = hasOtherItems
                    ? rect.top + rect.height * 0.75
                    : b.el.getBoundingClientRect().bottom - 4;
                if (clientY >= intoTop && clientY <= intoBot) {
                    return { mode: 'into', target: b.el, block: b };
                }
            }

            if (clientY < mid) return { mode: 'before', target: b.el, block: b };
            best = { mode: 'after', target: b.el, block: b };
        }
        return best;
    }

    function applyMove(draggedBlock, drop) {
        if (!drop) return;
        const { mode, target, block } = drop;
        const noNest = isFolderSection(draggedBlock) || isSepRow(draggedBlock);

        if (mode === 'into') {
            if (noNest) return;
            draggedBlock.classList.add('ne-sub');
            const placeholder = target.querySelector('.ne-folder-empty');
            if (placeholder) target.insertBefore(draggedBlock, placeholder);
            else target.appendChild(draggedBlock);
            return;
        }

        const targetIsSub = block && block.type === 'sub';
        const targetParent = target.parentElement;

        if (!noNest) {
            if (targetIsSub) draggedBlock.classList.add('ne-sub');
            else             draggedBlock.classList.remove('ne-sub');
        } else {
            if (targetIsSub) {
                const section = target.closest('.ne-folder-section');
                const ref = mode === 'before' ? section : section.nextSibling;
                list.insertBefore(draggedBlock, ref || null);
                return;
            }
        }

        if (mode === 'before') targetParent.insertBefore(draggedBlock, target);
        else                   targetParent.insertBefore(draggedBlock, target.nextSibling);
    }

    function onDown(e) {
        if (e.button !== 0) return;
        const handle = e.target.closest('.ne-handle');
        if (!handle) return;
        const row = handle.closest('.ne-row');
        if (!row || isHiddenRow(row)) return;
        e.preventDefault();

        const block = blockOf(row);
        const rect  = block.getBoundingClientRect();

        const ghost = block.cloneNode(true);
        Object.assign(ghost.style, {
            position: 'fixed',
            top: rect.top + 'px',
            left: rect.left + 'px',
            width: rect.width + 'px',
            pointerEvents: 'none',
            zIndex: '10020',
            opacity: '0.92',
            boxShadow: '0 14px 40px rgba(0,0,0,.55)',
            borderRadius: '8px',
            background: 'var(--bg-card)',
            transform: 'scale(1.01)',
        });
        document.body.appendChild(ghost);
        block.classList.add('ne-dragging');

        drag = {
            block, ghost,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            lastKey: null,
        };

        handle.setPointerCapture?.(e.pointerId);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup',   onUp);
        window.addEventListener('pointercancel', onUp);
        document.body.style.cursor = 'grabbing';
    }

    function onMove(e) {
        if (!drag) return;
        drag.ghost.style.top  = (e.clientY - drag.offsetY) + 'px';
        drag.ghost.style.left = (e.clientX - drag.offsetX) + 'px';

        const drop = resolveTarget(e.clientY, drag.block);
        const key  = drop
            ? `${drop.mode}:${drop.target.dataset.folderId || drop.target.dataset.key || ''}`
            : 'none';
        if (key === drag.lastKey) return;
        drag.lastKey = key;

        const prev = snap();
        if (drop) applyMove(drag.block, drop);
        flip(prev);
    }

    function onUp() {
        if (!drag) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup',   onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.style.cursor = '';

        const { block, ghost } = drag;
        drag = null;

        const finalRect = block.getBoundingClientRect();
        const ghostRect = ghost.getBoundingClientRect();
        const dx = finalRect.left - ghostRect.left;
        const dy = finalRect.top  - ghostRect.top;

        ghost.animate(
            [
                { transform: 'translate(0,0) scale(1.01)', opacity: 0.92 },
                { transform: `translate(${dx}px,${dy}px) scale(1)`, opacity: 1 },
            ],
            { duration: ANIM_MS, easing: EASE, fill: 'forwards' }
        ).onfinish = () => {
            ghost.remove();
            block.classList.remove('ne-dragging');
            _edSyncLayoutFromDom();
            _edRenderList();
        };
    }

    list.addEventListener('pointerdown', onDown);
    _edDragCleanup = () => list.removeEventListener('pointerdown', onDown);
}

// ===== Icon Picker =====

function _edOpenIconPicker(anchorEl, currentIcon, onSelect) {
    if (_edIconPickerClose) { _edIconPickerClose(); _edIconPickerClose = null; }

    const picker = document.createElement('div');
    picker.className = 'ne-icon-picker';

    for (const icon of NAV_ICON_OPTIONS) {
        const btn = document.createElement('button');
        btn.className = 'ne-icon-opt msi' + (icon === currentIcon ? ' active' : '');
        btn.textContent = icon;
        btn.title = icon;
        btn.addEventListener('click', e => {
            e.stopPropagation();
            onSelect(icon);
            cleanup();
        });
        picker.appendChild(btn);
    }

    document.body.appendChild(picker);

    const rect = anchorEl.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top  = (rect.bottom + 4) + 'px';

    requestAnimationFrame(() => {
        const pr = picker.getBoundingClientRect();
        if (pr.right  > window.innerWidth  - 8) picker.style.left = (window.innerWidth  - pr.width  - 8) + 'px';
        if (pr.bottom > window.innerHeight - 8) picker.style.top  = (rect.top - pr.height - 4) + 'px';
    });

    function cleanup() {
        picker.remove();
        document.removeEventListener('mousedown', onOutside, true);
        _edIconPickerClose = null;
    }
    function onOutside(e) {
        if (!picker.contains(e.target) && e.target !== anchorEl) cleanup();
    }
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 10);
    _edIconPickerClose = cleanup;
}
