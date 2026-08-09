// Debounce with animated dots indicator.
// Shows 3 pulsing dots in accent color inside the search bar while waiting.
// Dots are appended lazily to the parent .search-bar-row or .inv-search-wrap.

function _showDebAnim(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const row = el.closest('.search-bar-row, .inv-search-wrap, .vrc-friend-search, #ssInputWrap');
    if (!row) return;
    let dot = row.querySelector('.deb-anim');
    if (!dot) {
        dot = document.createElement('span');
        dot.className = 'deb-anim';
        dot.innerHTML = '<i></i><i></i><i></i>';
        row.appendChild(dot);
    }
    dot.classList.add('active');
}

function _hideDebAnim(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const row = el.closest('.search-bar-row, .inv-search-wrap, .vrc-friend-search, #ssInputWrap');
    row?.querySelector('.deb-anim')?.classList.remove('active');
}

// Drop-in replacement for debounce() — same API plus inputId for the animation.
function debounceAnim(fn, ms, inputId) {
    let t;
    return (...args) => {
        clearTimeout(t);
        _showDebAnim(inputId);
        t = setTimeout(() => {
            _hideDebAnim(inputId);
            fn(...args);
        }, ms);
    };
}
