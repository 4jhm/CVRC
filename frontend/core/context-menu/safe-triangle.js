(function () {
    "use strict";

    var CFG = {
        enabled: true,
        tolerance: 0,
        timeout: 300,
        openDelay: 0,
        closeDelay: 200
    };

    var activeSub = null;
    var activeRef = null;
    var anchor = null;
    var insideSince = 0;
    var protectedNow = false;
    var last = null;

    function sign(p1, p2, p3) {
        return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    }

    function inTriangle(p, a, b, c) {
        var d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
        var neg = d1 < 0 || d2 < 0 || d3 < 0;
        var pos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(neg && pos);
    }

    function corners() {
        var r = activeSub.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        var mr = activeRef.getBoundingClientRect();
        var side = r.left >= mr.left ? "right" : "left";
        var edge = side === "left" ? r.right : r.left;
        var t = CFG.tolerance;
        return [{ x: edge, y: r.top - t }, { x: edge, y: r.bottom + t }];
    }

    function visible(el) {
        return el && el.isConnected && el.getClientRects().length > 0;
    }

    document.addEventListener("mousemove", function (e) {
        var p = { x: e.clientX, y: e.clientY };
        last = p;

        if (!CFG.enabled || !visible(activeSub) || !activeRef) {
            anchor = p; insideSince = 0; protectedNow = false;
            return;
        }

        if (activeSub.contains(e.target)) {
            anchor = p; insideSince = 0; protectedNow = false;
            return;
        }

        if (anchor) {
            var c = corners();
            if (c && inTriangle(p, anchor, c[0], c[1])) {
                if (!insideSince) insideSince = Date.now();
                if (Date.now() - insideSince < CFG.timeout) {
                    protectedNow = true;
                    return;
                }
            } else {
                insideSince = 0;
            }
        }

        anchor = p; insideSince = 0; protectedNow = false;
    }, true);

    function register(subEl, refEl) {
        activeSub = subEl;
        activeRef = refEl;
        anchor = last;
        insideSince = 0;
        protectedNow = false;
    }

    function reset() {
        activeSub = null;
        activeRef = null;
        anchor = null;
        insideSince = 0;
        protectedNow = false;
    }

    window.safeTriangle = {
        cfg: CFG,
        isProtected: function () { return protectedNow; },
        register: register,
        reset: reset
    };
})();
