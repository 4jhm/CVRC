const LV_PAGE_SIZES = [10, 15, 20, 25, 50, 100];

function lvPageSize(key) {
    try {
        const v = parseInt(localStorage.getItem('vrcn_lv_size_' + key), 10);
        return LV_PAGE_SIZES.includes(v) ? v : 25;
    } catch { return 25; }
}

function lvSetPageSize(key, value, onChange) {
    const n = parseInt(value, 10);
    if (!LV_PAGE_SIZES.includes(n)) return;
    try { localStorage.setItem('vrcn_lv_size_' + key, String(n)); } catch {}
    if (typeof onChange === 'function') onChange();
}

function lvPageSizeSelectHtml(key, onChangeFn) {
    const cur = lvPageSize(key);
    const opts = LV_PAGE_SIZES.map(n => `<option value="${n}"${n === cur ? ' selected' : ''}>${n}</option>`).join('');
    return `<select class="vrcn-dropdown tl-page-size" onchange="${onChangeFn}(this.value)" title="${esc(t('timeline.page_size', 'Entries per page'))}">${opts}</select>`;
}

function lvPaginator(key, page, totalPages, onPageFn, total, onSizeFn) {
    const countHtml = `<span style="font-size:calc(11px + var(--fs-off, 0px));color:var(--tx3);padding:0 8px;">${total.toLocaleString()} total</span>`;
    const bar = buildPaginator(page, totalPages, onPageFn, countHtml);
    return lvPageSizeSelectHtml(key, onSizeFn) + (bar || countHtml);
}

function lvViewMode(key) {
    return localStorage.getItem('vrcn_lv_view_' + key) === 'list' ? 'list' : 'grid';
}

function lvSetViewMode(key, mode) {
    localStorage.setItem('vrcn_lv_view_' + key, mode === 'list' ? 'list' : 'grid');
}

function lvReady() {
    return typeof tlTableHtml === 'function' && typeof tlTableRow === 'function';
}

function lvSyncViewButtons(key, gridBtnId, listBtnId) {
    const isList = lvViewMode(key) === 'list';
    document.getElementById(gridBtnId)?.classList.toggle('active', !isList);
    document.getElementById(listBtnId)?.classList.toggle('active', isList);
}

function lvKeepScroll(startEl, render) {
    const saved = [];
    let n = startEl instanceof Element ? startEl : null;
    while (n && n !== document.body) {
        if (n.scrollTop > 0 || n.scrollLeft > 0) saved.push([n, n.scrollTop, n.scrollLeft]);
        n = n.parentElement;
    }
    render();
    saved.forEach(([el, top, left]) => { el.scrollTop = top; el.scrollLeft = left; });
}

function lvSort(list, listId, valueFn) {
    const { field, dir } = tlTableSortField(listId);
    const mul = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
        const va = valueFn(a, field), vb = valueFn(b, field);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
        return String(va ?? '').localeCompare(String(vb ?? '')) * mul;
    });
}

function lvDuration(seconds) {
    const s = Number(seconds) || 0;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ds = t('timespent.unit.day_short', 'd');
    const hs = t('timespent.unit.hour_short', 'h');
    const ms = t('timespent.unit.minute_short', 'm');
    const parts = [];
    if (d > 0) parts.push(`${d}${ds}`);
    if (h > 0) parts.push(`${h}${hs}`);
    if (m > 0 && d === 0) parts.push(`${m}${ms}`);
    return parts.length ? parts.join(' ') : '';
}

function lvDate(v) {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d) ? '' : fmtShortDate(d);
}

function lvDateTime(v) {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d) ? '' : `${fmtShortDate(d)} | ${fmtTime(d)}`;
}

function lvIcon(url, name, round) {
    const cls = 'lv-icon' + (round ? ' lv-icon-round' : '');
    return url
        ? `<span class="${cls}" style="background-image:url('${cssUrl(imgThumb(url, 96))}')"></span>`
        : `<span class="${cls} lv-icon-letter">${esc((name || '?')[0].toUpperCase())}</span>`;
}

function lvScrollBox(target) {
    let el = target instanceof Element ? target : null;
    while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 1) {
            const ox = getComputedStyle(el).overflowX;
            if (ox === 'auto' || ox === 'scroll') return el;
        }
        el = el.parentElement;
    }
    return null;
}

document.addEventListener('wheel', e => {
    if (!e.altKey || e.ctrlKey) return;
    const box = lvScrollBox(e.target);
    if (!box) return;
    e.preventDefault();
    box.scrollLeft += (e.deltaY || e.deltaX);
}, { passive: false });
