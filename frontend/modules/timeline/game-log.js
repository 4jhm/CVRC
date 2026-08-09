/* === Game Log === */

const GL_MAX = 1000;
let _glEntries = [];
let _glFilter  = 'all';

const GL_META = {
    gl_world_join:      { icon: 'travel_explore',    color: 'var(--accent)',  label: 'World'       },
    gl_player_join:     { icon: 'person_add',         color: 'var(--ok)',     label: 'Player +'    },
    gl_player_left:     { icon: 'person_remove',      color: 'var(--tx3)',    label: 'Player -'    },
    gl_video_url:       { icon: 'play_circle',         color: 'var(--warn)',   label: 'Video'       },
    gl_screenshot:      { icon: 'photo_camera',       color: 'var(--cyan)',   label: 'Screenshot'  },
    gl_portal:          { icon: 'blur_circular',      color: '#AB47BC',       label: 'Portal'      },
    gl_avatar_blocked:  { icon: 'block',              color: 'var(--warn)',   label: 'Blocked'     },
    gl_image_error:     { icon: 'broken_image',       color: 'var(--err)',    label: 'Error'       },
    gl_connection_lost: { icon: 'wifi_off',           color: 'var(--err)',    label: 'Disconnect'  },
    gl_instance_closed: { icon: 'lock',               color: 'var(--warn)',   label: 'Closed'      },
};

const GL_FILTER_GROUPS = {
    all:        null,
    world:      ['gl_world_join', 'gl_instance_closed'],
    players:    ['gl_player_join', 'gl_player_left'],
    media:      ['gl_video_url', 'gl_screenshot'],
    portal:     ['gl_portal'],
    errors:     ['gl_avatar_blocked', 'gl_image_error', 'gl_connection_lost'],
};

function setGlFilter(f) {
    _glFilter = f;
    document.querySelectorAll('#glFilters .sub-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
    renderGameLog();
}

function _glKey(e) {
    return `${e.timestamp}|${e.type}|${e.message || ''}|${e.detail || ''}`;
}

function setGameLogHistory(entries) {
    _glEntries = (entries || []).map(e => {
        e.id = e.id || ('gl_' + _glKey(e));
        return e;
    });
    if (_glEntries.length > GL_MAX) _glEntries.length = GL_MAX;
    if (tlMode === 'gamelog') renderGameLog();
}

function addGameLogEntry(entry) {
    if (_glEntries.some(e => _glKey(e) === _glKey(entry))) return;
    entry.id = entry.id || ('gl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    _glEntries.unshift(entry);
    if (_glEntries.length > GL_MAX) _glEntries.length = GL_MAX;
    if (tlMode === 'gamelog') renderGameLog();
}

function renderGameLog() {
    const el = document.getElementById('glContent');
    if (!el) return;
    const search = (document.getElementById('tlSearchInput')?.value ?? '').toLowerCase().trim();
    let entries = _glFilter === 'all'
        ? _glEntries
        : _glEntries.filter(e => (GL_FILTER_GROUPS[_glFilter] || []).includes(e.type));
    if (search) entries = entries.filter(e =>
        (e.message || '').toLowerCase().includes(search) ||
        (e.detail  || '').toLowerCase().includes(search));

    if (tlViewMode === 'list') {
        el.innerHTML = buildGlListHtml(entries);
    } else {
        el.innerHTML = buildGlTimelineHtml(entries);
    }
}

// ── List view ────────────────────────────────────────────────────────

function buildGlListHtml(entries) {
    if (!entries.length) return `<div class="empty-msg">${esc(t('gamelog.empty', 'No game log entries yet.'))}</div>`;

    const glMeta = ev => GL_META[ev.type] ?? { icon: 'circle', color: 'var(--tx3)', label: ev.type };
    const sorted = tlTableSortLocal('gamelog', entries, {
        dt:    e => e.timestamp || '',
        type:  e => (glMeta(e).label || '').toLowerCase(),
        event: e => (e.message || '').toLowerCase(),
    });

    let rows = '';
    sorted.forEach(ev => {
        const meta  = glMeta(ev);
        const dateStr = tlFormatShortDate(ev.timestamp);
        const timeStr = tlFormatTime(ev.timestamp);
        rows += tlTableRow('gamelog', '', {
            dt:    `<td class="tl-list-dt">${esc(`${dateStr} | ${timeStr}`)}</td>`,
            type:  `<td class="tl-list-type"><span class="msi tl-list-icon" style="color:${meta.color}">${meta.icon}</span><span>${esc(meta.label)}</span></td>`,
            event: `<td class="tl-list-detail">${esc(ev.message || '')}${ev.detail ? `<span class="tl-list-na" style="margin-left:6px;font-size:calc(10px + var(--fs-off, 0px));">${esc(ev.detail.length > 80 ? ev.detail.slice(0, 80) + '…' : ev.detail)}</span>` : ''}</td>`,
        });
    });

    return tlTableHtml('gamelog', rows);
}

// ── Card / Timeline view ──────────────────────────────────────────────

function buildGlTimelineHtml(entries) {
    if (!entries.length) return `<div class="empty-msg">${esc(t('gamelog.empty', 'No game log entries yet.'))}</div>`;

    const byDate = {};
    entries.forEach(e => {
        const key = tlFormatLongDate(e.timestamp);
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(e);
    });

    let html = '<div class="tl-wrap">';
    let idx  = 0;
    Object.entries(byDate).forEach(([date, evs]) => {
        html += `<div class="tl-date-sep"><span class="tl-date-label">${esc(date)}</span></div>`;
        evs.forEach(ev => {
            const side    = idx % 2 === 0 ? 'left' : 'right';
            const meta    = GL_META[ev.type] ?? { icon: 'circle', color: 'var(--tx3)', label: ev.type };
            const dotHtml = `<div class="tl-dot" style="background:${meta.color}"></div>`;
            const card    = buildGlCard(ev, meta);
            if (side === 'left') {
                html += `<div class="tl-row"><div class="tl-card-side tl-side-left">${card}</div><div class="tl-center-col">${dotHtml}</div><div class="tl-card-side tl-side-right"></div></div>`;
            } else {
                html += `<div class="tl-row"><div class="tl-card-side tl-side-left"></div><div class="tl-center-col">${dotHtml}</div><div class="tl-card-side tl-side-right">${card}</div></div>`;
            }
            idx++;
        });
    });
    html += '</div>';
    return html;
}

function buildGlCard(ev, meta) {
    if (!meta) meta = GL_META[ev.type] ?? { icon: 'circle', color: 'var(--tx3)', label: ev.type };
    const time   = tlFormatTime(ev.timestamp);
    const date   = tlFormatShortDate(ev.timestamp);
    const detail = ev.detail && ev.detail.length > 0
        ? `<div class="tl-sub-label">${esc(ev.detail.length > 80 ? ev.detail.slice(0, 80) + '…' : ev.detail)}</div>`
        : '';
    const header = `<div class="tl-card-header">
        <span class="msi tl-type-icon" style="color:${meta.color}">${meta.icon}</span>
        <span class="tl-type-label">${esc(meta.label)}</span>
        <div class="tl-time-col"><span class="tl-time">${esc(time)}</span><span class="tl-date">${esc(date)}</span></div>
    </div>`;
    const body = `<div class="tl-card-body"><div class="tl-card-info">
        <div class="tl-main-label">${esc(ev.message || '')}</div>${detail}
    </div></div>`;
    return `<div class="tl-card">${header}${body}</div>`;
}
