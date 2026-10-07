// assets/interaction.js — VISUAL_FUMAÇA_FOLHA_00
;(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const toggle = $('interaction-toggle');
  const status = $('interaction-status');
  const audioSens = $('audio-sens');
  const orientSens = $('orient-sens');
  const audioVal = $('audio-sens-value');
  const orientVal = $('orient-sens-value');

  let audioCtx = null, analyser = null, source = null;
  let dataArray = null, timeArray = null;
  let raf = 0, active = false, stream = null;

  let onset = 0, prevRms = 0, bassAvg = 0;
  let pitch01 = 0.5, pitchConfidence = 0;
  const onsetTimes = [];
  let bpm = 0, beatPhase = 0;
  let lastTilt = [0, 0];

  function setStatus(msg, kind) {
    if (!status) return;
    status.textContent = msg || '';
    status.dataset.kind = kind || 'ok';
  }
  function paintButton() {
    if (!toggle) return;
    toggle.textContent = active ? 'Desativar interações' : 'Ativar interações';
    toggle.setAttribute('aria-pressed', String(active));
  }

  function computeBands(freq) {
    const len = freq.length;
    let bass = 0, mid = 0, treble = 0, sum = 0;
    for (let i = 0; i < len; i++) {
      const v = freq[i] / 255;
      sum += v;
      const f = i / len;
      if (f < 0.15) bass += v;
      else if (f < 0.6) mid += v;
      else treble += v;
    }
    const total = sum / len;
    bass = bass / (len * 0.15) || 0;
    mid = mid / (len * 0.45) || 0;
    treble = treble / (len * 0.4) || 0;
    return { audio: total, bass: Math.min(1, bass), mid: Math.min(1, mid), treble: Math.min(1, treble) };
  }

  function estimatePitch(timeData, sampleRate) {
    const SIZE = timeData.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
      const v = (timeData[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return { pitch01: 0.5, conf: 0 };
    const minF = 80, maxF = 1200;
    const minLag = Math.floor(sampleRate / maxF);
    const maxLag = Math.floor(sampleRate / minF);
    let bestLag = -1, bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < SIZE - lag; i++) {
        s += ((timeData[i] - 128) / 128) * ((timeData[i + lag] - 128) / 128);
      }
      s /= (SIZE - lag);
      if (s > bestVal) { bestVal = s; bestLag = lag; }
    }
    if (bestLag < 0 || bestVal < 0.15) return { pitch01: 0.5, conf: 0 };
    const freq = sampleRate / bestLag;
    const lo = Math.log2(80), hi = Math.log2(1200);
    const p = (Math.log2(Math.max(80, Math.min(1200, freq))) - lo) / (hi - lo);
    return { pitch01: Math.max(0, Math.min(1, p)), conf: Math.min(1, bestVal * 2.5) };
  }

  function loop() {
    if (!active) return;
    if (!analyser) { raf = requestAnimationFrame(loop); return; }
    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(timeArray);

    const bands = computeBands(dataArray);
    const sens = parseFloat(audioSens ? audioSens.value : 1.0);

    const a = Math.pow(bands.audio  * sens, 1.0);
    const b = Math.pow(bands.bass   * sens, 1.1);
    const m = Math.pow(bands.mid    * sens, 1.0);
    const t = Math.pow(bands.treble * sens, 0.9);

    const rms = a;
    const flux = Math.max(0, rms - prevRms);
    onset = Math.max(onset * 0.90, flux * 6.0);
    prevRms = rms;
    bassAvg += (b - bassAvg) * 0.08;
    if (b - bassAvg > 0.16) onset = Math.max(onset, 1.0);

    const p = estimatePitch(timeArray, audioCtx.sampleRate);
    pitch01 = pitch01 * 0.85 + p.pitch01 * 0.15;
    pitchConfidence = pitchConfidence * 0.9 + p.conf * 0.1;

    const now = performance.now() / 1000;
    if (onset > 0.7) {
      const last = onsetTimes[onsetTimes.length - 1];
      if (!last || now - last > 0.25) {
        onsetTimes.push(now);
        if (onsetTimes.length > 5) onsetTimes.shift();
      }
    }
    if (onsetTimes.length >= 3) {
      const intervals = [];
      for (let i = 1; i < onsetTimes.length; i++) intervals.push(onsetTimes[i] - onsetTimes[i - 1]);
      const mean = intervals.reduce((x, y) => x + y, 0) / intervals.length;
      const variance = intervals.reduce((x, y) => x + (y - mean) ** 2, 0) / intervals.length;
      const sd = Math.sqrt(variance);
      if (sd / mean < 0.30 && mean > 0.25 && mean < 2.5) {
        bpm = 60 / mean;
        const t0 = onsetTimes[onsetTimes.length - 1];
        beatPhase = ((now - t0) * (bpm / 60)) % 1;
      }
    }

    const api = window.VISUAL_FUMAÇA_FOLHA_00;
    if (api && typeof api.setAudio === 'function') {
      api.setAudio({
        audio: Math.min(1.6, a),
        bass:  Math.min(1.6, b),
        mid:   Math.min(1.6, m),
        treble:Math.min(1.6, t),
        onset: Math.min(1.5, onset),
        pitch: pitch01,
        pitchStr: pitchConfidence,
        tilt: lastTilt,
        zoom: 1.0,
      });
    }
    raf = requestAnimationFrame(loop);
  }

  async function startAudio() {
    if (active) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      timeArray = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      active = true;
      setStatus('Microfone ativo.', 'ok');
      paintButton();
      loop();
    } catch (err) {
      console.error('erro audio', err);
      setStatus('Microfone não disponível.', 'warn');
      active = false;
      paintButton();
    }
  }

  function stopAudio() {
    active = false;
    if (raf) cancelAnimationFrame(raf);
    if (source) try { source.disconnect(); } catch (e) {}
    if (analyser) try { analyser.disconnect(); } catch (e) {}
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
    audioCtx = analyser = source = null;
    dataArray = timeArray = null;
    setStatus('');
    paintButton();
  }

  function onDevice(e) {
    if (!e) return;
    const gx = (e.gamma || 0) / 90;
    const gy = (e.beta  || 0) / 90;
    const sens = parseFloat(orientSens ? orientSens.value : 1.0);
    lastTilt = [gx * sens, gy * sens];
    const api = window.VISUAL_FUMAÇA_FOLHA_00;
    if (api && typeof api.setAudio === 'function') api.setAudio({ tilt: lastTilt });
  }
  function onPointer(e) {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -((e.clientY / window.innerHeight) * 2 - 1);
    const sens = parseFloat(orientSens ? orientSens.value : 1.0);
    lastTilt = [x * sens, y * sens];
    const api = window.VISUAL_FUMAÇA_FOLHA_00;
    if (api && typeof api.setAudio === 'function') api.setAudio({ tilt: lastTilt });
  }

  if (toggle) {
    toggle.addEventListener('click', async () => {
      if (active) { stopAudio(); return; }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const resp = await DeviceOrientationEvent.requestPermission();
          if (resp !== 'granted') setStatus('Permissão de movimento não concedida.', 'warn');
        } catch (e) { /* ignore */ }
      }
      startAudio();
    });
  }
  if (audioSens) {
    audioSens.addEventListener('input', () => { if (audioVal) audioVal.textContent = parseFloat(audioSens.value).toFixed(2); });
    audioSens.dispatchEvent(new Event('input'));
  }
  if (orientSens) {
    orientSens.addEventListener('input', () => { if (orientVal) orientVal.textContent = parseFloat(orientSens.value).toFixed(2); });
    orientSens.dispatchEvent(new Event('input'));
  }
  window.addEventListener('deviceorientation', onDevice);
  window.addEventListener('pointermove', onPointer);
  window.addEventListener('pointerdown', onPointer);

  window.VISUAL_FUMAÇA_FOLHA_00Interaction = {
    start: startAudio, stop: stopAudio, isActive: () => active,
  };
})();