// === Avatar Scaling ===

let _asConnected = false;
let _asCurrentScale = 1.0;
let _asKeyUpCode = 0;
let _asKeyDownCode = 0;
let _asRecordingSlot = null;
let _asRecordHandler = null;

// JS event.code → Windows VK code
const AS_VK = {
    'KeyA':65,'KeyB':66,'KeyC':67,'KeyD':68,'KeyE':69,'KeyF':70,'KeyG':71,'KeyH':72,
    'KeyI':73,'KeyJ':74,'KeyK':75,'KeyL':76,'KeyM':77,'KeyN':78,'KeyO':79,'KeyP':80,
    'KeyQ':81,'KeyR':82,'KeyS':83,'KeyT':84,'KeyU':85,'KeyV':86,'KeyW':87,'KeyX':88,
    'KeyY':89,'KeyZ':90,
    'Digit1':49,'Digit2':50,'Digit3':51,'Digit4':52,'Digit5':53,
    'Digit6':54,'Digit7':55,'Digit8':56,'Digit9':57,'Digit0':48,
    'F1':112,'F2':113,'F3':114,'F4':115,'F5':116,'F6':117,
    'F7':118,'F8':119,'F9':120,'F10':121,'F11':122,'F12':123,
    'ArrowUp':38,'ArrowDown':40,'ArrowLeft':37,'ArrowRight':39,
    'Home':36,'End':35,'PageUp':33,'PageDown':34,
    'Insert':45,'Delete':46,'Backspace':8,'Space':32,'Enter':13,
    'Numpad0':96,'Numpad1':97,'Numpad2':98,'Numpad3':99,'Numpad4':100,
    'Numpad5':101,'Numpad6':102,'Numpad7':103,'Numpad8':104,'Numpad9':105,
    'NumpadAdd':107,'NumpadSubtract':109,'NumpadMultiply':106,'NumpadDivide':111,'NumpadDecimal':110,
    'Minus':189,'Equal':187,'BracketLeft':219,'BracketRight':221,
    'Backslash':220,'Semicolon':186,'Quote':222,'Comma':188,'Period':190,
    'Slash':191,'Backquote':192,'CapsLock':20,'NumLock':144,'ScrollLock':145,
    'PrintScreen':44,'Pause':19,
};

const AS_KEY_NAMES = {
    65:'A',66:'B',67:'C',68:'D',69:'E',70:'F',71:'G',72:'H',73:'I',74:'J',75:'K',76:'L',
    77:'M',78:'N',79:'O',80:'P',81:'Q',82:'R',83:'S',84:'T',85:'U',86:'V',87:'W',88:'X',
    89:'Y',90:'Z',
    49:'1',50:'2',51:'3',52:'4',53:'5',54:'6',55:'7',56:'8',57:'9',48:'0',
    112:'F1',113:'F2',114:'F3',115:'F4',116:'F5',117:'F6',
    118:'F7',119:'F8',120:'F9',121:'F10',122:'F11',123:'F12',
    38:'Arrow Up',40:'Arrow Down',37:'Arrow Left',39:'Arrow Right',
    36:'Home',35:'End',33:'Page Up',34:'Page Down',
    45:'Insert',46:'Delete',8:'Backspace',32:'Space',13:'Enter',
    96:'Num 0',97:'Num 1',98:'Num 2',99:'Num 3',100:'Num 4',
    101:'Num 5',102:'Num 6',103:'Num 7',104:'Num 8',105:'Num 9',
    107:'Num +',109:'Num -',106:'Num *',111:'Num /',110:'Num .',
    189:'-',187:'=',219:'[',221:']',220:'\\',186:';',222:"'",188:',',190:'.',191:'/',192:'`',
    20:'Caps Lock',144:'Num Lock',145:'Scroll Lock',44:'Print Screen',19:'Pause',
};

function asKeyName(code) {
    if (!code) return t('as.keybind.not_set', 'Not set');
    return AS_KEY_NAMES[code] ?? tf('as.keybind.key_fallback', { code }, `Key ${code}`);
}

function asToggleEnabled() {
    if (_asConnected) sendToCS({ action: 'asDisconnect' });
    else sendToCS({ action: 'asConnect' });
    _asAutoStartedByVro = false;
}

function handleAsState(d) {
    _asConnected = !!d.connected;

    const dot = document.getElementById('asDot');
    const txt = document.getElementById('asStatusText');
    const btn = document.getElementById('asConnBtn');

    if (dot) dot.className = `sf-dot ${_asConnected ? 'online' : 'offline'}`;
    if (txt) txt.textContent = _asConnected ? t('as.status.connected', 'Connected') : t('as.status.not_connected', 'Not connected');
    if (btn) btn.innerHTML = _asConnected
        ? `<span class="msi" style="font-size:16px;">link_off</span> ${t('common.disconnect', 'Disconnect')}`
        : `<span class="msi" style="font-size:16px;">link</span> ${t('common.connect', 'Connect')}`;

    if (d.scale !== undefined) {
        _asCurrentScale = d.scale;
        const slider = document.getElementById('asScaleSlider');
        const val = document.getElementById('asScaleVal');
        if (slider && document.activeElement !== slider) slider.value = d.scale;
        if (val) val.textContent = tf('as.scale.value', { value: Number(d.scale).toFixed(2) }, `${Number(d.scale).toFixed(2)} m`);
    }

    if (d.keyUp !== undefined) _asKeyUpCode = d.keyUp;
    if (d.keyDown !== undefined) _asKeyDownCode = d.keyDown;

    const keyUpEl = document.getElementById('asKeyUpDisplay');
    if (keyUpEl && !keyUpEl.classList.contains('as-recording'))
        keyUpEl.textContent = asKeyName(_asKeyUpCode);

    const keyDownEl = document.getElementById('asKeyDownDisplay');
    if (keyDownEl && !keyDownEl.classList.contains('as-recording'))
        keyDownEl.textContent = asKeyName(_asKeyDownCode);
}

function asScaleSliderInput() {
    const slider = document.getElementById('asScaleSlider');
    if (!slider) return;
    const v = parseFloat(slider.value) || 1.0;
    const val = document.getElementById('asScaleVal');
    if (val) val.textContent = tf('as.scale.value', { value: v.toFixed(2) }, `${v.toFixed(2)} m`);
    _asCurrentScale = v;
    if (_asConnected) sendToCS({ action: 'asSetScale', value: v });
    asSaveSettings();
}

function asSmoothnessInput() {
    const slider = document.getElementById('asSmoothSlider');
    if (!slider) return;
    const val = document.getElementById('asSmoothVal');
    if (val) val.textContent = slider.value;
    asSaveSettings();
}

function asSaveSettings() {
    sendToCS({
        action: 'asSaveSettings',
        autoStartVR:      !!document.getElementById('setAsAutoStartVR')?.checked,
        autoStartDesktop: !!document.getElementById('setAsAutoStartDesktop')?.checked,
        useSafety:        !!document.getElementById('asUseSafety')?.checked,
        scale:            parseFloat(document.getElementById('asScaleSlider')?.value) || 1.0,
        saveScale:        !!document.getElementById('asSaveScale')?.checked,
        keyUp:            _asKeyUpCode,
        keyDown:          _asKeyDownCode,
        smoothing:        parseInt(document.getElementById('asSmoothSlider')?.value) || 30,
    });
}

function asStartRecord(slot) {
    if (_asRecordingSlot) asCancelRecord();
    _asRecordingSlot = slot;

    const el = document.getElementById(slot === 'up' ? 'asKeyUpDisplay' : 'asKeyDownDisplay');
    if (el) { el.textContent = t('as.keybind.recording', 'Press a key...'); el.classList.add('as-recording'); }

    _asRecordHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const currentSlot = _asRecordingSlot;

        if (e.code === 'Escape') {
            asCancelRecord();
            return;
        }

        const code = AS_VK[e.code] ?? 0;
        if (!code) return;

        document.removeEventListener('keydown', _asRecordHandler, true);
        _asRecordHandler = null;
        _asRecordingSlot = null;

        const name = asKeyName(code);
        const dispEl = document.getElementById(currentSlot === 'up' ? 'asKeyUpDisplay' : 'asKeyDownDisplay');
        if (dispEl) { dispEl.textContent = name; dispEl.classList.remove('as-recording'); }

        if (currentSlot === 'up') _asKeyUpCode = code;
        else _asKeyDownCode = code;

        asSaveSettings();
    };

    document.addEventListener('keydown', _asRecordHandler, true);
}

function asCancelRecord() {
    if (_asRecordHandler) {
        document.removeEventListener('keydown', _asRecordHandler, true);
        _asRecordHandler = null;
    }
    if (_asRecordingSlot) {
        const el = document.getElementById(_asRecordingSlot === 'up' ? 'asKeyUpDisplay' : 'asKeyDownDisplay');
        if (el) {
            el.classList.remove('as-recording');
            el.textContent = asKeyName(_asRecordingSlot === 'up' ? _asKeyUpCode : _asKeyDownCode);
        }
        _asRecordingSlot = null;
    }
}

function asClearKey(slot) {
    if (slot === 'up') {
        _asKeyUpCode = 0;
        const el = document.getElementById('asKeyUpDisplay');
        if (el) el.textContent = t('as.keybind.not_set', 'Not set');
    } else {
        _asKeyDownCode = 0;
        const el = document.getElementById('asKeyDownDisplay');
        if (el) el.textContent = t('as.keybind.not_set', 'Not set');
    }
    asSaveSettings();
}

function asToggleSafety() {
    const useSafety = !!document.getElementById('asUseSafety')?.checked;
    const card = document.getElementById('asSafetyRangeCard');
    if (card) card.style.display = useSafety ? '' : 'none';
    _asApplySliderRange(useSafety);
    asSaveSettings();
}

function _asApplySliderRange(useSafety) {
    const slider = document.getElementById('asScaleSlider');
    if (!slider) return;
    const min = useSafety ? 0.1 : 0.01;
    const max = useSafety ? 100 : 10000;
    slider.min = min;
    slider.max = max;
    const clamped = Math.max(min, Math.min(max, parseFloat(slider.value) || 1));
    slider.value = clamped;
    _asCurrentScale = clamped;
    const val = document.getElementById('asScaleVal');
    if (val) val.textContent = tf('as.scale.value', { value: clamped.toFixed(2) }, `${clamped.toFixed(2)} m`);
    const minLabel = document.getElementById('asScaleMinLabel');
    const maxLabel = document.getElementById('asScaleMaxLabel');
    if (minLabel) minLabel.textContent = useSafety ? tf('as.scale.value', { value: '0.1' }, '0.1 m') : tf('as.scale.value', { value: '0.01' }, '0.01 m');
    if (maxLabel) maxLabel.textContent = useSafety ? tf('as.scale.value', { value: '100' }, '100 m') : tf('as.scale.value', { value: '10000' }, '10000 m');
}

function rerenderAsTranslations() {
    const statusText = document.getElementById('asStatusText');
    if (statusText) {
        statusText.textContent = _asConnected
            ? t('as.status.connected', 'Connected')
            : t('as.status.not_connected', 'Not connected');
    }

    const connBtn = document.getElementById('asConnBtn');
    if (connBtn) {
        connBtn.innerHTML = _asConnected
            ? `<span class="msi" style="font-size:16px;">link_off</span> ${t('common.disconnect', 'Disconnect')}`
            : `<span class="msi" style="font-size:16px;">link</span> ${t('common.connect', 'Connect')}`;
    }

    const scaleVal = document.getElementById('asScaleVal');
    if (scaleVal) scaleVal.textContent = tf('as.scale.value', { value: _asCurrentScale.toFixed(2) }, `${_asCurrentScale.toFixed(2)} m`);

    const useSafety = !!document.getElementById('asUseSafety')?.checked;
    const minLabel = document.getElementById('asScaleMinLabel');
    const maxLabel = document.getElementById('asScaleMaxLabel');
    if (minLabel) minLabel.textContent = useSafety ? tf('as.scale.value', { value: '0.1' }, '0.1 m') : tf('as.scale.value', { value: '0.01' }, '0.01 m');
    if (maxLabel) maxLabel.textContent = useSafety ? tf('as.scale.value', { value: '100' }, '100 m') : tf('as.scale.value', { value: '10000' }, '10000 m');

    const keyUpEl = document.getElementById('asKeyUpDisplay');
    if (keyUpEl && !keyUpEl.classList.contains('as-recording'))
        keyUpEl.textContent = asKeyName(_asKeyUpCode);

    const keyDownEl = document.getElementById('asKeyDownDisplay');
    if (keyDownEl && !keyDownEl.classList.contains('as-recording'))
        keyDownEl.textContent = asKeyName(_asKeyDownCode);
}

document.documentElement.addEventListener('languagechange', rerenderAsTranslations);

function asLoadSettings(s) {
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    setChk('setAsAutoStartVR', s.autoStartVR);
    setChk('setAsAutoStartDesktop', s.autoStartDesktop);
    setChk('asUseSafety', s.useSafety);
    setChk('asSaveScale', s.saveScale);
    _asKeyUpCode   = s.keyUp   ?? 0;
    _asKeyDownCode = s.keyDown ?? 0;
    const keyUpEl   = document.getElementById('asKeyUpDisplay');
    const keyDownEl = document.getElementById('asKeyDownDisplay');
    if (keyUpEl)   keyUpEl.textContent   = asKeyName(_asKeyUpCode);
    if (keyDownEl) keyDownEl.textContent = asKeyName(_asKeyDownCode);

    const useSafety = !!s.useSafety;
    const scaleMin = useSafety ? 0.1 : 0.01;
    const scaleMax = useSafety ? 100 : 10000;
    const scale = Math.max(scaleMin, Math.min(scaleMax, s.scale ?? 1.0));
    _asCurrentScale = scale;
    setVal('asScaleSlider', scale);
    const scaleVal = document.getElementById('asScaleVal');
    if (scaleVal) scaleVal.textContent = tf('as.scale.value', { value: scale.toFixed(2) }, `${scale.toFixed(2)} m`);
    _asApplySliderRange(useSafety);

    const smoothing = s.smoothing ?? 30;
    setVal('asSmoothSlider', smoothing);
    const smoothVal = document.getElementById('asSmoothVal');
    if (smoothVal) smoothVal.textContent = smoothing;

    const safetyCard = document.getElementById('asSafetyRangeCard');
    if (safetyCard) safetyCard.style.display = s.useSafety ? '' : 'none';
}
