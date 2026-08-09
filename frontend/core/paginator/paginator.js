// 300ms Debounce
function debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function _buildPaginatorBtns(page, totalPages, onPageFn) {
    const btn = (i) => {
        const a = i === page ? ' style="background:var(--accent);color:#fff;"' : '';
        return `<button class="vrcn-button"${a} onclick="${onPageFn}(${i})">${i + 1}</button>`;
    };
    if (totalPages <= 7) {
        let h = '';
        for (let i = 0; i < totalPages; i++) h += btn(i);
        return h;
    }
    const last = totalPages - 1;
    const mid = Math.max(2, Math.min(page, last - 2));
    const m0 = mid - 1, m2 = mid + 1;
    const ell = (show) =>
        `<span style="padding:0 4px;color:var(--tx3);${show ? '' : 'visibility:hidden;'}">…</span>`;
    return btn(0) + ell(m0 > 1) + btn(m0) + btn(mid) + btn(m2) + ell(m2 < last - 1) + btn(last);
}

function buildPaginator(page, totalPages, onPageFn, countHtml = '', hasMore = false) {
    if (totalPages <= 1 && !hasMore) return '';
    const prevDis = page === 0 ? 'disabled' : '';
    const nextDis = (page >= totalPages - 1 && !hasMore) ? 'disabled' : '';
    return `<button class="vrcn-button" ${prevDis} onclick="${onPageFn}(${page - 1})"><span class="msi" style="font-size:16px;">chevron_left</span></button>` +
        `${_buildPaginatorBtns(page, totalPages, onPageFn)}` +
        `<button class="vrcn-button" ${nextDis} onclick="${onPageFn}(${page + 1})"><span class="msi" style="font-size:16px;">chevron_right</span></button>` +
        countHtml;
}

function setPaginator(barId, html) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.innerHTML = html;
    if (typeof initVnSelect === 'function') {
        bar.querySelectorAll('select.vrcn-dropdown').forEach(sel => initVnSelect(sel));
    }
}
