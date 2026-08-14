// Emoji Maker — converts a GIF/MP4/MOV/WebM clip into a VRChat animated emoji
// sprite sheet (1024x1024, 2x2/4x4/8x8 grid per VRChat's spec) entirely client-side.
let _emojiFile = null;
let _emojiKind = null; // 'gif' | 'video'
let _emojiFrames = [];
let _emojiAnimTimer = null;
let _emojiDuration = 0;

function emojiOnFilePicked(event) {
    const file = event.target.files?.[0];
    if (file) emojiHandleFile(file);
}

function emojiDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('emoji-drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) emojiHandleFile(file);
}

async function emojiHandleFile(file) {
    const name = (file.name || '').toLowerCase();
    _emojiKind = (file.type === 'image/gif' || name.endsWith('.gif')) ? 'gif' : 'video';
    _emojiFile = file;
    _emojiFrames = [];
    _emojiDuration = 0;
    emojiStopAnim();
    emojiSetStatus('', '');
    document.getElementById('emojiSaveBtn').disabled = true;

    document.getElementById('emojiDropText').textContent = file.name;
    document.getElementById('emojiGenerateBtn').disabled = false;

    const previewWrap = document.getElementById('emojiSourcePreviewWrap');
    const previewImg = document.getElementById('emojiSourcePreviewImg');
    previewWrap.style.display = '';

    if (_emojiKind === 'gif') {
        previewImg.src = URL.createObjectURL(file);
    } else {
        const video = document.getElementById('emojiSrcVideo');
        const url = URL.createObjectURL(file);
        video.src = url;
        await new Promise(res => { video.onloadedmetadata = res; video.onerror = res; });
        _emojiDuration = video.duration || 0;
        await emojiSeekTo(video, Math.min(0.1, (_emojiDuration || 1) / 2));
        const cnv = document.createElement('canvas');
        cnv.width = video.videoWidth || 256;
        cnv.height = video.videoHeight || 256;
        cnv.getContext('2d').drawImage(video, 0, 0);
        previewImg.src = cnv.toDataURL('image/png');
    }

    const count = parseInt(document.getElementById('emojiFrameCount').value, 10) || 16;
    const hint = document.getElementById('emojiDurationHint');
    if (_emojiDuration > 0) {
        document.getElementById('emojiFps').value = emojiSuggestFps(_emojiDuration, count);
        hint.style.display = '';
        hint.textContent = `Source is ${_emojiDuration.toFixed(1)}s long`;
    } else {
        hint.style.display = 'none';
    }

    emojiRegenerate();
}

function emojiSuggestFps(durationSeconds, frameCount) {
    if (!durationSeconds || !isFinite(durationSeconds) || durationSeconds <= 0) return 10;
    const fps = Math.round(frameCount / durationSeconds);
    return Math.min(30, Math.max(1, fps || 10));
}

async function emojiRegenerate() {
    if (!_emojiFile) return;
    const genBtn = document.getElementById('emojiGenerateBtn');
    const saveBtn = document.getElementById('emojiSaveBtn');
    genBtn.disabled = true;
    saveBtn.disabled = true;
    emojiStopAnim();
    emojiSetStatus('Generating…', '');

    const count = parseInt(document.getElementById('emojiFrameCount').value, 10) || 16;
    try {
        const frames = _emojiKind === 'gif'
            ? await emojiExtractGifFrames(_emojiFile, count)
            : await emojiExtractVideoFrames(_emojiFile, count);
        if (!frames.length) throw new Error('No frames could be extracted from this file.');
        _emojiFrames = frames;
        emojiComposite(frames, count);
        const fps = parseInt(document.getElementById('emojiFps').value, 10) || 10;
        emojiStartAnim(frames, fps);
        emojiSetStatus(`Ready — ${frames.length} frames`, 'ok');
        saveBtn.disabled = false;
    } catch (err) {
        console.error('[EmojiMaker]', err);
        emojiSetStatus(err.message || 'Failed to generate sprite sheet.', 'err');
    } finally {
        genBtn.disabled = false;
    }
}

function emojiSampleIndices(total, count) {
    if (total <= 0) return [];
    const out = [];
    for (let i = 0; i < count; i++) out.push(Math.min(total - 1, Math.floor(i * total / count)));
    return out;
}

async function emojiExtractGifFrames(file, count) {
    if (typeof ImageDecoder === 'undefined') {
        throw new Error('GIF decoding is not supported in this app build (ImageDecoder unavailable).');
    }
    const buf = await file.arrayBuffer();
    const decoder = new ImageDecoder({ data: buf, type: file.type || 'image/gif' });
    await decoder.tracks.ready;
    const total = decoder.tracks.selectedTrack.frameCount;
    const frames = [];
    for (const idx of emojiSampleIndices(total, count)) {
        const { image } = await decoder.decode({ frameIndex: idx });
        const cnv = document.createElement('canvas');
        cnv.width = image.displayWidth;
        cnv.height = image.displayHeight;
        cnv.getContext('2d').drawImage(image, 0, 0);
        frames.push({ canvas: cnv, w: image.displayWidth, h: image.displayHeight });
        image.close();
    }
    decoder.close?.();
    return frames;
}

function emojiSeekTo(video, t) {
    return new Promise(res => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); res(); };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = t;
        setTimeout(() => { video.removeEventListener('seeked', onSeeked); res(); }, 2000);
    });
}

async function emojiExtractVideoFrames(file, count) {
    // The <video> element already has this file loaded from emojiHandleFile().
    const video = document.getElementById('emojiSrcVideo');
    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) throw new Error('Video has no readable duration.');
    const frames = [];
    for (let i = 0; i < count; i++) {
        const t = Math.min(duration - 0.01, (i + 0.5) * duration / count);
        await emojiSeekTo(video, Math.max(0, t));
        const cnv = document.createElement('canvas');
        cnv.width = video.videoWidth;
        cnv.height = video.videoHeight;
        cnv.getContext('2d').drawImage(video, 0, 0);
        frames.push({ canvas: cnv, w: video.videoWidth, h: video.videoHeight });
    }
    return frames;
}

function emojiGridFor(count) {
    if (count <= 4) return { dim: 2, cell: 512 };
    if (count <= 16) return { dim: 4, cell: 256 };
    return { dim: 8, cell: 128 };
}

function emojiDrawCover(ctx, source, sw, sh, dx, dy, dSize) {
    const scale = Math.max(dSize / sw, dSize / sh);
    const dw = sw * scale, dh = sh * scale;
    const ox = dx + (dSize - dw) / 2;
    const oy = dy + (dSize - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dSize, dSize);
    ctx.clip();
    ctx.drawImage(source, ox, oy, dw, dh);
    ctx.restore();
}

function emojiComposite(frames, count) {
    const canvas = document.getElementById('emojiSheetCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { dim, cell } = emojiGridFor(count);
    frames.forEach((f, i) => {
        if (i >= dim * dim) return;
        const col = i % dim, row = Math.floor(i / dim);
        emojiDrawCover(ctx, f.canvas, f.w, f.h, col * cell, row * cell, cell);
    });
}

function emojiStartAnim(frames, fps) {
    const canvas = document.getElementById('emojiAnimPreview');
    const ctx = canvas.getContext('2d');
    let i = 0;
    const step = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const f = frames[i % frames.length];
        emojiDrawCover(ctx, f.canvas, f.w, f.h, 0, 0, canvas.width);
        i++;
    };
    step();
    _emojiAnimTimer = setInterval(step, Math.max(16, 1000 / Math.max(1, fps)));
}

function emojiStopAnim() {
    if (_emojiAnimTimer) { clearInterval(_emojiAnimTimer); _emojiAnimTimer = null; }
}

function emojiSetStatus(text, cls) {
    const el = document.getElementById('emojiStatusText');
    el.textContent = text;
    el.className = 'emoji-status' + (cls ? ' ' + cls : '');
}

function emojiSaveSheet() {
    if (!_emojiFrames.length) return;
    const canvas = document.getElementById('emojiSheetCanvas');
    const dataUrl = canvas.toDataURL('image/png');
    const count = parseInt(document.getElementById('emojiFrameCount').value, 10) || 16;
    const fps = parseInt(document.getElementById('emojiFps').value, 10) || 10;
    const base = (_emojiFile?.name || 'emoji').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'emoji';
    const fileName = `${base}_${count}frames_${fps}fps.png`;
    sendToCS({ action: 'emojiSaveSheet', data: dataUrl, fileName });
}

function onEmojiSheetSaved(payload) {
    if (payload?.path) emojiSetStatus(`Saved: ${payload.path}`, 'ok');
}
