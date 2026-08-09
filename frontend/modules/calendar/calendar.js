/* === Calendar Tab === */

let calendarLoaded = false;
let calendarFilter = 'all';
let _calEvents = [];
let _calSelectedDay = null;
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calLoading = false;
var _calDashPending = 0;
var _calDashRawEvents = [];


function _calDateLocale() {
    return getLanguageLocale();
}

function _renderCalUI() {
    const tab = document.getElementById('tab17');
    if (!tab) return;

    const refreshTitle = esc(t('calendar.refresh_title', 'Refresh calendar'));
    const refreshIcon = _calLoading ? 'hourglass_empty' : 'refresh';
    const refreshDisabled = _calLoading ? ' disabled' : '';

    tab.innerHTML = `<div id="calInner">
        <div class="tab-toolbar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:4px;">
                <button class="vrcn-button" onclick="_calNavMonth(-1)"><span class="msi" style="font-size:18px;">chevron_left</span></button>
                <span id="calMonthLabel" style="min-width:140px;text-align:center;font-size:calc(14px + var(--fs-off, 0px));font-weight:700;color:var(--tx0);"></span>
                <button class="vrcn-button" onclick="_calNavMonth(1)"><span class="msi" style="font-size:18px;">chevron_right</span></button>
                <button class="vrcn-button sub-tab-btn cal-filter-btn${calendarFilter === 'all' ? ' active' : ''}" data-filter="all" onclick="setCalFilter('all')"><span class="msi" style="font-size:14px;">calendar_month</span> ${esc(t('calendar.filters.all', 'All'))}</button>
                <button class="vrcn-button sub-tab-btn cal-filter-btn${calendarFilter === 'featured' ? ' active' : ''}" data-filter="featured" onclick="setCalFilter('featured')"><span class="msi" style="font-size:14px;">star</span> ${esc(t('calendar.filters.featured', 'Featured'))}</button>
                <button class="vrcn-button sub-tab-btn cal-filter-btn${calendarFilter === 'following' ? ' active' : ''}" data-filter="following" onclick="setCalFilter('following')"><span class="msi" style="font-size:14px;">notifications_active</span> ${esc(t('calendar.filters.following', 'Following'))}</button>
                <button class="vrcn-button" id="calRefreshBtn" onclick="refreshCalendar()" title="${refreshTitle}"${refreshDisabled}><span class="msi" style="font-size:18px;">${refreshIcon}</span></button>
            </div>
        </div>
        <div id="calGridArea"></div>
        <div id="calDayPanel" style="display:none;"></div>
    </div>`;

    _updateMonthLabel();
}

function _syncCalView() {
    if (!document.getElementById('tab17')) return;
    _renderCalUI();
    if (_calLoading) {
        const gridArea = document.getElementById('calGridArea');
        if (gridArea) {
            gridArea.innerHTML = `<div class="empty-msg" style="padding:40px 0;">${esc(t('calendar.loading', 'Loading events...'))}</div>`;
        }
        return;
    }
    _buildGrid();
    const dayEvents = _calSelectedDay ? _eventsForDay(_calSelectedDay) : [];
    _buildDayPanel(dayEvents, _calSelectedDay);
}

function _initCalUI() {
    const tab = document.getElementById('tab17');
    if (!tab || document.getElementById('calInner')) return;
    _renderCalUI();
}

function _updateMonthLabel() {
    const el = document.getElementById('calMonthLabel');
    if (!el) return;
    el.textContent = new Date(_calYear, _calMonth, 1).toLocaleDateString(_calDateLocale(), { month: 'long', year: 'numeric' });
}

function refreshCalendar() {
    _initCalUI();
    _calLoading = true;
    _syncCalView();
    sendToCS({ action: 'vrcGetCalendarEvents', filter: calendarFilter, year: _calYear, month: _calMonth + 1 });
}

function setCalFilter(filter) {
    if (calendarFilter === filter) return;
    calendarFilter = filter;
    _calEvents = [];
    _calSelectedDay = null;
    refreshCalendar();
}

function renderCalendarEvents(payload) {
    let raw = payload;
    if (raw?.events) raw = raw.events;
    else if (raw?.results) raw = raw.results;
    else if (raw?.data) raw = raw.data;
    let all = Array.isArray(raw) ? raw : [];

    // Dashboard-only fetch: accumulate but don't touch calendar state or UI
    if (_calDashPending > 0) {
        _calDashRawEvents = _calDashRawEvents.concat(all);
        _calDashPending--;
        if (_calDashPending <= 0 && typeof onCalendarEventsForDash === 'function') {
            onCalendarEventsForDash(_calDashRawEvents);
        }
        return;
    }

    // Normal calendar flow
    calendarLoaded = true;
    _calLoading = false;

    if (calendarFilter === 'featured') {
        all = all.filter(e => e.featured === true || _isFeatured(e));
    }

    _calEvents = all;
    _calSelectedDay = null;
    _syncCalView();
}

function _calNavMonth(delta) {
    _calMonth += delta;
    if (_calMonth > 11) {
        _calMonth = 0;
        _calYear++;
    }
    if (_calMonth < 0) {
        _calMonth = 11;
        _calYear--;
    }
    _calSelectedDay = null;
    _calEvents = [];
    _calLoading = true;
    _syncCalView();
    sendToCS({ action: 'vrcGetCalendarEvents', filter: calendarFilter, year: _calYear, month: _calMonth + 1 });
}

function _calClickDay(key) {
    _calSelectedDay = _calSelectedDay === key ? null : key;
    _buildGrid();
    const dayEvents = _calSelectedDay ? _eventsForDay(_calSelectedDay) : [];
    _buildDayPanel(dayEvents, _calSelectedDay);
}

function _calDayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _eventKey(evt) {
    const date = new Date(evt.startsAt || evt.startDate || '');
    if (isNaN(date)) return null;
    return _calDayKey(date);
}

function _eventDayKeys(evt) {
    const start = new Date(evt.startsAt || evt.startDate || '');
    if (isNaN(start)) return [];
    let end = new Date(evt.endsAt || evt.endDate || '');
    if (isNaN(end) || end < start) end = start;
    const keys = [];
    const cur  = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    let guard = 0;
    while (cur <= last && guard++ < 366) {
        keys.push(_calDayKey(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return keys;
}

function _eventsForDay(key) {
    return _calEvents.filter(evt => _eventDayKeys(evt).includes(key));
}

function _isFeatured(evt) {
    return Array.isArray(evt.tags) && evt.tags.some(tag => /featured/i.test(tag));
}

function _buildGrid() {
    const wrap = document.getElementById('calGridArea');
    if (!wrap) return;

    const DAY = 86400000;
    const today = new Date();
    const todayKey = _calDayKey(today);
    const firstDay = new Date(_calYear, _calMonth, 1).getDay();
    const firstDayMon = (firstDay + 6) % 7;
    const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
    const weeks = Math.ceil((firstDayMon + daysInMonth) / 7);
    const totalCells = weeks * 7;
    const gridStart = new Date(_calYear, _calMonth, 1 - firstDayMon);
    gridStart.setHours(0, 0, 0, 0);

    const gIndex = d => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - gridStart) / DAY);

    const segs = [];
    _calEvents.forEach(evt => {
        const start = new Date(evt.startsAt || evt.startDate || '');
        if (isNaN(start)) return;
        let end = new Date(evt.endsAt || evt.endDate || '');
        if (isNaN(end) || end < start) end = start;
        const rawS = gIndex(start), rawE = gIndex(end);
        if (rawE < 0 || rawS > totalCells - 1) return;
        segs.push({ evt, gS: Math.max(0, rawS), gE: Math.min(totalCells - 1, rawE), trueStart: rawS >= 0, trueEnd: rawE <= totalCells - 1 });
    });

    segs.sort((a, b) => a.gS - b.gS || (b.gE - b.gS) - (a.gE - a.gS));
    const laneEnd = [];
    segs.forEach(seg => {
        let lane = 0;
        while (lane < laneEnd.length && laneEnd[lane] >= seg.gS) lane++;
        seg.lane = lane;
        laneEnd[lane] = seg.gE;
    });

    // 2024-01-08 was a Monday, matching the Monday-first grid above. Built in local
    // time on purpose: Date.UTC() would put midnight UTC on the previous day for
    // anyone west of UTC, shifting every header label back by one.
    const hdr = Array.from({ length: 7 }, (_, idx) => {
        const label = new Date(2024, 0, 8 + idx).toLocaleDateString(_calDateLocale(), { weekday: 'short' });
        return `<div class="cal-day-hdr">${esc(label.toUpperCase())}</div>`;
    }).join('');

    let weeksHtml = '';
    for (let w = 0; w < weeks; w++) {
        const wStart = w * 7, wEnd = w * 7 + 6;
        let lanes = 0;
        segs.forEach(seg => { if (seg.gE >= wStart && seg.gS <= wEnd) lanes = Math.max(lanes, seg.lane + 1); });

        let dayCells = '';
        for (let c = 0; c < 7; c++) {
            const cellDate = new Date(gridStart.getTime() + (wStart + c) * DAY);
            const inMonth = cellDate.getMonth() === _calMonth && cellDate.getFullYear() === _calYear;
            const key = _calDayKey(cellDate);
            let cls = 'cal-day';
            if (!inMonth) cls += ' cal-out';
            if (key === todayKey) cls += ' cal-today';
            if (key === _calSelectedDay) cls += ' cal-sel';
            dayCells += `<div class="${cls}" style="grid-column:${c + 1};grid-row:1/-1;" onclick="_calClickDay('${key}')"><div class="cal-day-num">${cellDate.getDate()}</div></div>`;
        }

        let bars = '';
        segs.forEach(seg => {
            if (seg.gE < wStart || seg.gS > wEnd) return;
            const colStart = Math.max(seg.gS, wStart) - wStart + 1;
            const colEnd = Math.min(seg.gE, wEnd) - wStart + 1;
            const openLeft = !(seg.gS >= wStart && seg.trueStart);
            const openRight = !(seg.gE <= wEnd && seg.trueEnd);
            const showLabel = seg.gS >= wStart;
            const evt = seg.evt;
            const barCls = _isFeatured(evt) ? 'cal-bar-f' : 'cal-bar-g';
            const edge = (openLeft ? ' cal-bar-openl' : '') + (openRight ? ' cal-bar-openr' : '');
            const title = evt.title || t('calendar.event_fallback', 'Event');
            bars += `<div class="cal-bar ${barCls}${edge}" data-pin-event-id="${esc(evt.id || '')}" data-pin-event-owner="${esc(evt.ownerId || '')}" data-pin-event-name="${esc(evt.title || '')}" data-pin-event-image="${esc(evt.imageUrl || '')}" style="grid-column:${colStart}/${colEnd + 1};grid-row:${seg.lane + 2};" onclick="event.stopPropagation();openEventDetail('${esc(evt.ownerId || '')}','${esc(evt.id || '')}')" title="${esc(title)}">${showLabel ? esc(title) : ''}</div>`;
        });

        const rows = `26px ${lanes > 0 ? `repeat(${lanes}, 22px) ` : ''}1fr`;
        weeksHtml += `<div class="cal-week" style="grid-template-rows:${rows};">${dayCells}${bars}</div>`;
    }

    wrap.innerHTML = `<div class="cal-hdr-row">${hdr}</div><div class="cal-month">${weeksHtml}</div>`;
}

function _buildDayPanel(events, key) {
    const el = document.getElementById('calDayPanel');
    if (!el) return;

    if (!key || events.length === 0) {
        el.style.display = 'none';
        return;
    }

    const dayLabel = fmtLongDate(new Date(`${key}T12:00:00Z`));

    const cards = events
        .sort((a, b) => new Date(a.startsAt || a.startDate || 0) - new Date(b.startsAt || b.startDate || 0))
        .map(evt => {
            const date = new Date(evt.startsAt || evt.startDate || '');
            const timeStr = !isNaN(date) ? fmtTime(date) : '';
            const tags = Array.isArray(evt.tags) ? evt.tags : [];
            const tagHtml = tags.slice(0, 4).map(tag => {
                const featured = /featured/i.test(tag);
                return `<span class="vrcn-badge${featured ? ' warn' : ''}">${esc(tag)}</span>`;
            }).join('');
            const imgHtml = evt.imageUrl
                ? `<img class="cal-evlist-thumb" src="${evt.imageUrl}" onerror="this.style.display='none'">`
                : `<div class="cal-evlist-thumb"><span class="msi" style="font-size:22px;color:var(--tx3);">event</span></div>`;

            return `<div class="cal-evlist-card" data-pin-event-id="${esc(evt.id || '')}" data-pin-event-owner="${esc(evt.ownerId || '')}" data-pin-event-name="${esc(evt.title || '')}" data-pin-event-image="${esc(evt.imageUrl || '')}" onclick="openEventDetail('${esc(evt.ownerId || '')}','${esc(evt.id || '')}')">
                ${imgHtml}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:calc(12px + var(--fs-off, 0px));font-weight:600;color:var(--tx0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;">${esc(evt.title || t('calendar.untitled_event', 'Untitled Event'))}</div>
                    ${timeStr ? `<div style="font-size:calc(10px + var(--fs-off, 0px));color:var(--tx2);margin-bottom:4px;">${esc(timeStr)}</div>` : ''}
                    <div style="display:flex;flex-wrap:wrap;gap:3px;">${tagHtml}</div>
                </div>
            </div>`;
        }).join('');

    el.innerHTML = `<div class="cal-day-panel">
        <div class="cal-day-panel-hdr">
            <span class="msi" style="font-size:16px;color:var(--accent-lt);">calendar_today</span>${esc(dayLabel)}
            <button class="vrcn-button" onclick="_calClickDay('${key}')" style="margin-left:auto;padding:2px 8px;font-size:calc(11px + var(--fs-off, 0px));" title="${esc(t('common.close', 'Close'))}"><span class="msi" style="font-size:14px;">close</span></button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">${cards}</div>
    </div>`;
    el.style.display = 'block';
}

function rerenderCalendarTranslations() {
    if (!document.getElementById('calInner')) return;
    _syncCalView();
}

document.documentElement.addEventListener('languagechange', rerenderCalendarTranslations);
