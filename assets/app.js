/* assets/app.js — VISUAL_FUMAÇA_FOLHA_00
 * Painel (interação + aparência + modo imersivo) e service worker.
 * Render e sensores são delegados a shaders.js e interaction.js.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const panel       = $('panel');
  const toggle      = $('interaction-toggle');
  const status      = $('interaction-status');
  const collapseBtn = $('panel-collapse');
  const focusBtn    = $('panel-focus');
  const restoreBtn  = $('panel-restore');
  const audioRange  = $('audio-sens');
  const orientRange = $('orient-sens');
  const audioOut    = $('audio-sens-value');
  const orientOut   = $('orient-sens-value');
  const morphRange  = $('morph');
  const morphOut    = $('morph-value');
  const speedRange  = $('speed');
  const speedOut    = $('speed-value');
  const colorBtns   = document.querySelectorAll('[data-color-mode]');
  const chromaticEl = $('chromatic');

  function setStatus(msg, kind) {
    if (!status) return;
    status.textContent = msg || '';
    status.dataset.kind = kind || 'ok';
  }
  function paintButton() {
    const api = window.VISUAL_FUMAÇA_FOLHA_00Interaction;
    const on = api && typeof api.isActive === 'function' ? api.isActive() : false;
    if (!toggle) return;
    toggle.textContent = on ? 'Desativar interações' : 'Ativar interações';
    toggle.setAttribute('aria-pressed', String(on));
  }
  function bindRange(input, out, apply) {
    if (!input) return;
    const sync = () => {
      const v = parseFloat(input.value);
      if (out) out.textContent = v.toFixed(2);
      if (apply) apply(v);
    };
    input.addEventListener('input', sync);
    sync();
  }

  bindRange(audioRange, audioOut, (v) => {
    const api = window.VISUAL_FUMAÇA_FOLHA_00Interaction;
    if (api) api.audioSens = v;
  });
  bindRange(orientRange, orientOut, (v) => {
    const api = window.VISUAL_FUMAÇA_FOLHA_00Interaction;
    if (api) api.orientSens = v;
  });
  bindRange(morphRange, morphOut, (v) => {
    const s = window.VISUAL_FUMAÇA_FOLHA_00;
    if (s && s.setOptions) s.setOptions({ morph: v });
  });
  bindRange(speedRange, speedOut, (v) => {
    const s = window.VISUAL_FUMAÇA_FOLHA_00;
    if (s && s.setOptions) s.setOptions({ speed: v });
  });

  colorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      colorBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      const s = window.VISUAL_FUMAÇA_FOLHA_00;
      if (s && s.setOptions) s.setOptions({ colorMode: btn.dataset.colorMode });
    });
  });

  if (chromaticEl) {
    chromaticEl.checked = true;
    chromaticEl.addEventListener('change', () => {
      const s = window.VISUAL_FUMAÇA_FOLHA_00;
      if (s && s.setOptions) s.setOptions({ chromatic: chromaticEl.checked });
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
      collapseBtn.setAttribute('aria-label', collapsed ? 'Mostrar controles' : 'Recolher controles');
    });
  }

  /* ---------- modo imersivo ---------- */
  function enterFocus() {
    panel.classList.add('is-focused');
    if (restoreBtn) restoreBtn.hidden = false;
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      try { el.webkitRequestFullscreen(); } catch (e) { /* ignora */ }
    }
  }
  function exitFocus() {
    panel.classList.remove('is-focused');
    if (restoreBtn) restoreBtn.hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      try { document.webkitExitFullscreen(); } catch (e) { /* ignora */ }
    }
  }
  if (focusBtn)   focusBtn.addEventListener('click', enterFocus);
  if (restoreBtn) restoreBtn.addEventListener('click', exitFocus);

  // se o usuário sair do fullscreen (Esc), reexibe o painel
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && panel.classList.contains('is-focused')) {
      panel.classList.remove('is-focused');
      if (restoreBtn) restoreBtn.hidden = true;
    }
  });

  if (toggle) {
    toggle.addEventListener('click', () => {
      const api = window.VISUAL_FUMAÇA_FOLHA_00Interaction;
      if (api && typeof api.start === 'function') {
        if (api.isActive()) api.stop(); else api.start();
      }
      setTimeout(paintButton, 200);
    });
  }
  paintButton();

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js')
        .catch((err) => console.warn('SW não registrado:', err));
    });
  }
})();