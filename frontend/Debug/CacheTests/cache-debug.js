(function () {
    'use strict';

    const COLOR = {
        disk:    'rgba(0,200,80,0.5)',
        browser: 'rgba(255,140,0,0.5)',
        network: 'rgba(220,40,40,0.5)',
        pending: 'rgba(150,150,150,0.5)',
    };

    const CACHE_DURATION_MS = 8;

    const layer = document.createElement('div');
    layer.id = 'dbg-cache-layer';
    Object.assign(layer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2147483647',
        overflow: 'hidden',
    });

    const legend = document.createElement('div');
    legend.id = 'dbg-cache-legend';

    function updateLegend() {
        let disk = 0, browser = 0, network = 0, pending = 0;
        for (const [, d] of registry) {
            if      (d.source === 'disk')    disk++;
            else if (d.source === 'browser') browser++;
            else if (d.source === 'network') network++;
            else                             pending++;
        }
        legend.innerHTML =
            `<div class="dbg-title">Image Cache Debug</div>` +
            `<div class="dbg-row"><span class="dbg-dot" style="background:#00c850"></span>Disk Cache<span class="dbg-count">${disk}</span></div>` +
            `<div class="dbg-row"><span class="dbg-dot" style="background:#ff8c00"></span>Browser Cache<span class="dbg-count">${browser}</span></div>` +
            `<div class="dbg-row"><span class="dbg-dot" style="background:#dc2828"></span>Network / API<span class="dbg-count">${network}</span></div>` +
            (pending ? `<div class="dbg-row"><span class="dbg-dot" style="background:#969696"></span>Loading…<span class="dbg-count">${pending}</span></div>` : '');
    }

    const registry = new Map();
    const seen = new WeakSet();

    function resolveUrl(raw) {
        try { return new URL(raw, location.href).href; } catch { return raw; }
    }

    function getUrl(el) {
        if (el.tagName === 'IMG') {
            return el.src || null;
        }
        const style = el.getAttribute('style') || '';
        const m = style.match(/background-image\s*:\s*url\((['"]?)([^'")\s]+)\1\)/i);
        return m ? resolveUrl(m[2]) : null;
    }

    function classifyByUrl(url) {
        if (url.includes('/imgcache/')) return 'disk';
        return null;
    }

    function classifyByTiming(url) {
        const entries = performance.getEntriesByName(url, 'resource');
        if (!entries.length) return null;

        const e = entries[entries.length - 1];

        if (e.decodedBodySize > 0 && e.transferSize === 0) return 'browser';
        if (e.transferSize > 0)                             return 'network';

        if (e.duration <= CACHE_DURATION_MS) return 'browser';
        return 'network';
    }

    function makeOverlay() {
        const d = document.createElement('div');
        Object.assign(d.style, {
            position: 'absolute',
            pointerEvents: 'none',
            background: COLOR.pending,
            transition: 'background 0.25s',
        });
        layer.appendChild(d);
        return d;
    }

    function applySource(el, source) {
        const d = registry.get(el);
        if (!d || d.source === source) return;
        d.source = source;
        d.overlay.style.background = COLOR[source] ?? COLOR.pending;
        updateLegend();
    }

    function retryTiming(el, url, attempts) {
        if (attempts <= 0) { applySource(el, 'network'); return; }
        setTimeout(() => {
            const src = classifyByTiming(url);
            if (src) applySource(el, src);
            else     retryTiming(el, url, attempts - 1);
        }, 200);
    }

    function register(el) {
        if (seen.has(el)) return;

        const url = getUrl(el);
        if (!url || url === '' || url.startsWith('data:') || url.startsWith('blob:')) return;

        seen.add(el);

        const overlay = makeOverlay();
        registry.set(el, { overlay, source: 'pending', url });
        updateLegend();

        const byUrl = classifyByUrl(url);
        if (byUrl) { applySource(el, byUrl); return; }

        const byTiming = classifyByTiming(url);
        if (byTiming) { applySource(el, byTiming); return; }

        if (el.tagName === 'IMG') {
            if (el.complete) {
                retryTiming(el, url, 10);
            } else {
                el.addEventListener('load', () => {
                    const t = classifyByTiming(url);
                    if (t) applySource(el, t);
                    else   retryTiming(el, url, 8);
                }, { once: true });
                el.addEventListener('error', () => applySource(el, 'network'), { once: true });
            }
        } else {
            retryTiming(el, url, 15);
        }
    }

    function frame() {
        for (const [el, { overlay }] of registry) {
            if (!document.contains(el)) {
                overlay.remove();
                registry.delete(el);
                continue;
            }
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) {
                overlay.style.display = 'none';
            } else {
                overlay.style.display = '';
                overlay.style.left   = r.left   + 'px';
                overlay.style.top    = r.top    + 'px';
                overlay.style.width  = r.width  + 'px';
                overlay.style.height = r.height + 'px';
            }
        }
        if (_active) _rafId = requestAnimationFrame(frame);
    }

    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.tagName === 'IMG' && root.src) register(root);
        const s = root.getAttribute?.('style') || '';
        if (s.includes('background-image')) register(root);
        root.querySelectorAll('img[src], [style*="background-image"]').forEach(register);
    }

    const mo = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(n => scan(n));
            } else if (m.type === 'attributes') {
                const old = registry.get(m.target);
                if (old) { old.overlay.remove(); registry.delete(m.target); }
                seen.delete(m.target);
                register(m.target);
            }
        }
    });

    try {
        const po = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.entryType !== 'resource') continue;
                for (const [el, d] of registry) {
                    if (d.source !== 'pending' || d.url !== entry.name) continue;
                    let src;
                    if (entry.decodedBodySize > 0 && entry.transferSize === 0) src = 'browser';
                    else if (entry.transferSize > 0)                            src = 'network';
                    else if (entry.duration <= CACHE_DURATION_MS)               src = 'browser';
                    else                                                         src = 'network';
                    applySource(el, src);
                }
            }
        });
        po.observe({ entryTypes: ['resource'] });
    } catch (_) {}

    let _active = false;
    let _rafId  = null;

    function enable() {
        if (_active) return;
        _active = true;
        if (!document.body.contains(layer)) {
            document.body.appendChild(layer);
            document.body.appendChild(legend);
        }
        layer.style.display  = '';
        legend.style.display = '';
        scan(document.body);
        mo.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'style'],
        });
        updateLegend();
        _rafId = requestAnimationFrame(frame);
    }

    function disable() {
        if (!_active) return;
        _active = false;
        layer.style.display  = 'none';
        legend.style.display = 'none';
        cancelAnimationFrame(_rafId);
        _rafId = null;
        mo.disconnect();
        for (const [, d] of registry) d.overlay.remove();
        registry.clear();
    }

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            _active ? disable() : enable();
        }
    });

    window.setImgCacheDebug = function (enabled) {
        enabled ? enable() : disable();
    };
})();
