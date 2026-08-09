// 300ms Debounce
if (typeof debounce === 'undefined') {
    window.debounce = function(fn, ms = 300) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    };
}

const MINI_PG_SIZE = 36;         // groups, mutuals old was 18
const MINI_CONTENT_PG_SIZE = 36; // worlds, avatars old was 18
const MINI_IMAGE_PG_SIZE = 15;   // images old was 10

function _buildMiniPaginatorBtns(page, totalPages, onPageFn) {
    const btn = (i) => {
        const active = i === page ? ' mini-pg-active' : '';
        return `<button class="vrcn-button${active}" onclick="${onPageFn}(${i})">${i + 1}</button>`;
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
        `<span class="mini-pg-ell" style="${show ? '' : 'visibility:hidden;'}">…</span>`;
    return btn(0) + ell(m0 > 1) + btn(m0) + btn(mid) + btn(m2) + ell(m2 < last - 1) + btn(last);
}

function buildMiniPaginator(page, totalPages, onPageFn, countHtml = '') {
    if (totalPages <= 1) return '';
    const prevDis = page === 0 ? 'disabled' : '';
    const nextDis = page >= totalPages - 1 ? 'disabled' : '';
    return `<button class="vrcn-button" ${prevDis} onclick="${onPageFn}(${page - 1})"><span class="msi" style="font-size:13px;">chevron_left</span></button>` +
        _buildMiniPaginatorBtns(page, totalPages, onPageFn) +
        `<button class="vrcn-button" ${nextDis} onclick="${onPageFn}(${page + 1})"><span class="msi" style="font-size:13px;">chevron_right</span></button>` +
        countHtml;
}

function setMiniPaginator(barId, html) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.innerHTML = html;
    const content = bar.previousElementSibling;
    if (content && html) {
        content.classList.remove('mini-page-fade-in');
        void content.offsetWidth;
        content.classList.add('mini-page-fade-in');
    }
}
