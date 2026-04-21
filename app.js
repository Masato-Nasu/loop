const RECORD_MS = 3000;
const FPS = 30;

const statusEl = document.getElementById('status');
const openCameraBtn = document.getElementById('openCameraBtn');
const recordBtn = document.getElementById('recordBtn');
const retakeBtn = document.getElementById('retakeBtn');
const saveWebmBtn = document.getElementById('saveWebmBtn');
const saveJpegBtn = document.getElementById('saveJpegBtn');
const viewer = document.getElementById('viewer');
const overlay = document.getElementById('overlay');
const liveVideo = document.getElementById('liveVideo');
const playbackVideo = document.getElementById('playbackVideo');
const recordingBadge = document.getElementById('recordingBadge');
const recordingCountdown = document.getElementById('recordingCountdown');
const workCanvas = document.getElementById('workCanvas');
const chips = [...document.querySelectorAll('.chip')];

let stream = null;
let mediaRecorder = null;
let chunks = [];
let recordTimer = null;
let countdownTimer = null;
let capturedBlob = null;
let capturedURL = null;
let selectedFilter = 'original';

function setStatus(text) {
  statusEl.textContent = text;
}

function updateButtons() {
  const hasStream = !!stream;
  const hasCapture = !!capturedBlob;
  recordBtn.disabled = !hasStream || mediaRecorder?.state === 'recording';
  retakeBtn.disabled = !hasCapture && !hasStream;
  saveWebmBtn.disabled = !hasCapture;
  saveJpegBtn.disabled = !hasCapture;
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

async function openCamera() {
  try {
    stopStream();
    if (capturedURL) {
      URL.revokeObjectURL(capturedURL);
      capturedURL = null;
    }
    capturedBlob = null;
    playbackVideo.pause();
    playbackVideo.classList.add('hidden');
    liveVideo.classList.remove('hidden');
    overlay.classList.add('hidden');
    setStatus('Opening camera...');

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1080 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    liveVideo.srcObject = stream;
    await liveVideo.play();
    setStatus('Camera ready');
  } catch (err) {
    console.error(err);
    overlay.classList.remove('hidden');
    setStatus('Camera error');
    alert('カメラを開けませんでした。HTTPS環境とカメラ許可を確認してください。');
  } finally {
    updateButtons();
  }
}

function beginCountdown() {
  const startedAt = performance.now();
  recordingCountdown.textContent = '3.0';
  recordingBadge.classList.remove('hidden');
  countdownTimer = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const remain = Math.max(0, RECORD_MS - elapsed);
    recordingCountdown.textContent = (remain / 1000).toFixed(1);
  }, 80);
}

function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  recordingBadge.classList.add('hidden');
}

function releaseCapturedURL() {
  if (capturedURL) {
    URL.revokeObjectURL(capturedURL);
    capturedURL = null;
  }
}

async function startRecord() {
  if (!stream) return;
  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm;codecs=vp8';

  mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  mediaRecorder.onstop = async () => {
    stopCountdown();
    capturedBlob = new Blob(chunks, { type: mimeType });
    releaseCapturedURL();
    capturedURL = URL.createObjectURL(capturedBlob);
    playbackVideo.src = capturedURL;
    liveVideo.classList.add('hidden');
    playbackVideo.classList.remove('hidden');
    try {
      await playbackVideo.play();
    } catch (e) {
      console.warn(e);
    }
    setStatus('Loop ready');
    updateButtons();
  };

  mediaRecorder.start();
  setStatus('Recording...');
  beginCountdown();
  updateButtons();
  recordTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, RECORD_MS);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getFilterCss(name) {
  switch (name) {
    case 'bw': return 'grayscale(1) contrast(1.02)';
    case 'soft': return 'saturate(0.85) brightness(1.04) blur(0.35px)';
    case 'contrast': return 'contrast(1.28) saturate(1.04)';
    case 'warm': return 'sepia(0.24) saturate(1.14) hue-rotate(-10deg) brightness(1.03)';
    case 'cool': return 'saturate(0.92) hue-rotate(14deg) contrast(1.03) brightness(1.02)';
    default: return 'none';
  }
}

async function ensurePlaybackReady() {
  if (!capturedBlob) return false;
  if (playbackVideo.readyState < 2) {
    await new Promise(resolve => {
      const onLoaded = () => {
        playbackVideo.removeEventListener('loadeddata', onLoaded);
        resolve();
      };
      playbackVideo.addEventListener('loadeddata', onLoaded);
    });
  }
  return true;
}

async function saveJpeg() {
  const ok = await ensurePlaybackReady();
  if (!ok) return;
  const vw = playbackVideo.videoWidth || 1080;
  const vh = playbackVideo.videoHeight || 1080;
  const side = Math.min(vw, vh);
  workCanvas.width = 1536;
  workCanvas.height = 1536;
  const ctx = workCanvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, workCanvas.width, workCanvas.height);
  ctx.filter = getFilterCss(selectedFilter);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  ctx.drawImage(playbackVideo, sx, sy, side, side, 0, 0, workCanvas.width, workCanvas.height);
  ctx.restore();
  workCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `loop-${Date.now()}.jpg`);
  }, 'image/jpeg', 0.94);
}

async function saveWebm() {
  const ok = await ensurePlaybackReady();
  if (!ok) return;
  const vw = playbackVideo.videoWidth || 1080;
  const vh = playbackVideo.videoHeight || 1080;
  const side = Math.min(vw, vh);
  workCanvas.width = 720;
  workCanvas.height = 720;
  const ctx = workCanvas.getContext('2d', { alpha: false });
  const streamOut = workCanvas.captureStream(FPS);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm;codecs=vp8';
  const rec = new MediaRecorder(streamOut, {
    mimeType,
    videoBitsPerSecond: 6_000_000
  });
  const localChunks = [];
  rec.ondataavailable = e => {
    if (e.data && e.data.size > 0) localChunks.push(e.data);
  };
  rec.onstop = () => {
    const blob = new Blob(localChunks, { type: mimeType });
    downloadBlob(blob, `loop-${Date.now()}.webm`);
    streamOut.getTracks().forEach(track => track.stop());
  };

  const durationMs = Math.max(500, Math.min(RECORD_MS, (playbackVideo.duration || 3) * 1000));
  let rafId = 0;
  let stopTimer = null;
  const wasLoop = playbackVideo.loop;
  const wasMuted = playbackVideo.muted;
  const prevTime = 0;

  const drawFrame = () => {
    ctx.save();
    ctx.clearRect(0, 0, workCanvas.width, workCanvas.height);
    ctx.filter = getFilterCss(selectedFilter);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;
    ctx.drawImage(playbackVideo, sx, sy, side, side, 0, 0, workCanvas.width, workCanvas.height);
    ctx.restore();
    rafId = requestAnimationFrame(drawFrame);
  };

  try {
    playbackVideo.pause();
    playbackVideo.currentTime = 0;
    await new Promise(resolve => {
      const done = () => {
        playbackVideo.removeEventListener('seeked', done);
        resolve();
      };
      playbackVideo.addEventListener('seeked', done, { once: true });
    });
  } catch (e) {
    // ignore if seeked does not fire consistently
  }

  playbackVideo.loop = true;
  playbackVideo.muted = true;
  rec.start(100);
  drawFrame();

  try {
    await playbackVideo.play();
  } catch (e) {
    cancelAnimationFrame(rafId);
    rec.stop();
    streamOut.getTracks().forEach(track => track.stop());
    throw e;
  }

  stopTimer = setTimeout(() => {
    cancelAnimationFrame(rafId);
    playbackVideo.pause();
    playbackVideo.currentTime = 0;
    playbackVideo.loop = wasLoop;
    playbackVideo.muted = wasMuted;
    rec.stop();
    playbackVideo.play().catch(() => {});
  }, durationMs);
}

function selectFilter(filter) {
  selectedFilter = filter;
  viewer.className = `viewer ${filter}`;
  chips.forEach(chip => chip.classList.toggle('active', chip.dataset.filter === filter));
}

function resetToCamera() {
  if (capturedBlob) {
    releaseCapturedURL();
    capturedBlob = null;
  }
  playbackVideo.pause();
  playbackVideo.removeAttribute('src');
  playbackVideo.load();
  playbackVideo.classList.add('hidden');
  liveVideo.classList.remove('hidden');
  overlay.classList.toggle('hidden', !!stream);
  setStatus(stream ? 'Camera ready' : 'Ready');
  updateButtons();
}

openCameraBtn.addEventListener('click', openCamera);
recordBtn.addEventListener('click', startRecord);
retakeBtn.addEventListener('click', async () => {
  clearTimeout(recordTimer);
  stopCountdown();
  if (!stream) await openCamera();
  resetToCamera();
});
saveJpegBtn.addEventListener('click', saveJpeg);
saveWebmBtn.addEventListener('click', saveWebm);
chips.forEach(chip => chip.addEventListener('click', () => selectFilter(chip.dataset.filter)));

window.addEventListener('beforeunload', stopStream);
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
});

selectFilter('original');
updateButtons();
