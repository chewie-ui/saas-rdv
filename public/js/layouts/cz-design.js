/* ═══════════════════════════════════════════════════════════════
   ONGLET DESIGN & COULEURS
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  // throttle : exécute immédiatement puis ignore pendant `ms` ms
  // Contrairement au debounce, il ne skip jamais si on drag vite
  function throttle(fn, ms) {
    var last = 0;
    return function () {
      var now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(this, arguments); }
    };
  }
  function hexToRgb(hex) {
    if (!hex || hex.length < 7) return '34,197,94';
    return parseInt(hex.slice(1,3),16)+','+parseInt(hex.slice(3,5),16)+','+parseInt(hex.slice(5,7),16);
  }

  /* ── Données initiales ──────────────────────────────────────────────────── */
  var CS = window.__czCs || {};
  var BOOKING_URL = window.__czBookingUrl || '';

  /* ── Color fields mapping ───────────────────────────────────────────────── */
  var COLOR_FIELDS = [
    { key: 'accentColor', def: '#22c55e' },
    { key: 'accentText',  def: '#ffffff' },
    { key: 'pageBg',      def: '#f7f8f7' },
    { key: 'calBg',       def: '#ffffff' },
    { key: 'dayBg',       def: '#ffffff' },
    { key: 'dayText',     def: '#111111' },
    { key: 'btnBg',       def: '#111111' },
    { key: 'btnText',     def: '#ffffff' },
  ];

  /* ── État courant ───────────────────────────────────────────────────────── */
  var current = {};
  COLOR_FIELDS.forEach(function (f) {
    current[f.key] = CS[f.key] || f.def;
  });
  current.font         = CS.font         || 'Inter';
  current.borderRadius = CS.borderRadius || 'md';
  current.borderStyle  = CS.borderStyle  || 'subtle';
  current.shadowStyle  = CS.shadowStyle  || 'subtle';

  /* ═══════════════════════════════════════════════════════════════
     UNDO / REDO
     ═══════════════════════════════════════════════════════════════ */
  var history   = [JSON.stringify(current)];
  var historyIdx = 0;
  var MAX_HIST  = 50;

  function snapshotState() {
    // Tronquer le futur si on est au milieu
    history = history.slice(0, historyIdx + 1);
    history.push(JSON.stringify(current));
    if (history.length > MAX_HIST) history.shift();
    historyIdx = history.length - 1;
    updateUndoRedoBtns();
  }

  function updateUndoRedoBtns() {
    var undoBtn = $('czDesignUndo');
    var redoBtn = $('czDesignRedo');
    if (undoBtn) undoBtn.disabled = historyIdx <= 0;
    if (redoBtn) redoBtn.disabled = historyIdx >= history.length - 1;
  }

  function applySnapshot(snap) {
    var s = JSON.parse(snap);
    Object.assign(current, s);
    // Mettre à jour tous les pickers
    COLOR_FIELDS.forEach(function (f) { syncPickerUI(f.key, current[f.key]); });
    // Font
    document.querySelectorAll('.cz-font-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.font === current.font);
    });
    // Radius
    document.querySelectorAll('.cz-radius-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.radius === current.borderRadius);
    });
    // Border
    document.querySelectorAll('[data-border]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.border === current.borderStyle);
    });
    // Shadow
    document.querySelectorAll('[data-shadow]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.shadow === current.shadowStyle);
    });
    injectPreviewCss();
  }

  /* ─── Boutons Undo / Redo ──────────────────────────────────────────────── */
  var undoBtn = $('czDesignUndo');
  var redoBtn = $('czDesignRedo');

  if (undoBtn) {
    undoBtn.addEventListener('click', function () {
      if (historyIdx <= 0) return;
      historyIdx--;
      applySnapshot(history[historyIdx]);
      updateUndoRedoBtns();
    });
  }
  if (redoBtn) {
    redoBtn.addEventListener('click', function () {
      if (historyIdx >= history.length - 1) return;
      historyIdx++;
      applySnapshot(history[historyIdx]);
      updateUndoRedoBtns();
    });
  }

  // Ctrl+Z / Ctrl+Y raccourcis clavier
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if ($('czPanelDesign') && $('czPanelDesign').style.display !== 'none') {
        e.preventDefault();
        if (undoBtn) undoBtn.click();
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      if ($('czPanelDesign') && $('czPanelDesign').style.display !== 'none') {
        e.preventDefault();
        if (redoBtn) redoBtn.click();
      }
    }
  });

  /* ═══════════════════════════════════════════════════════════════
     LIVE PREVIEW — injection CSS same-origin dans l'iframe
     ═══════════════════════════════════════════════════════════════ */
  var previewIframe = $('czDesignPreviewIframe');
  var previewUrlBar = $('czDesignPreviewUrl');
  var refreshBtn    = $('czDesignRefresh');
  var iframeReady   = false;
  var _injectRetryTimer = null;

  /* ── Mapping police → font-family ──────────────────────────────── */
  var FONT_MAP = {
    'Inter':            "'Inter', system-ui, -apple-system, sans-serif",
    'Poppins':          "'Poppins', system-ui, sans-serif",
    'Lato':             "'Lato', system-ui, sans-serif",
    'Montserrat':       "'Montserrat', system-ui, sans-serif",
    'Playfair Display': "'Playfair Display', Georgia, serif",
    'Nunito':           "'Nunito', system-ui, sans-serif",
  };

  /* ── Mapping radius → valeurs CSS ──────────────────────────────── */
  var RADIUS_MAP = {
    'none': { xs:'0px',  sm:'0px',  md:'0px',  lg:'0px',  xl:'0px',  pill:'0px'   },
    'sm':   { xs:'4px',  sm:'6px',  md:'8px',  lg:'10px', xl:'14px', pill:'999px' },
    'md':   { xs:'6px',  sm:'8px',  md:'12px', lg:'16px', xl:'24px', pill:'999px' },
    'lg':   { xs:'8px',  sm:'12px', md:'18px', lg:'24px', xl:'36px', pill:'999px' },
  };

  /* ── Mapping bordure → valeurs CSS ──────────────────────────────── */
  var BORDER_MAP = {
    'none':   { color: 'transparent',       strong: 'transparent' },
    'subtle': { color: '#e3e8e4',            strong: '#c8d4ca'     },
    'medium': { color: '#c4cfc6',            strong: '#9aab9d'     },
    'strong': { color: '#8a9e8d',            strong: '#4d6651'     },
  };

  /* ── Mapping ombre → valeurs CSS ────────────────────────────────── */
  var SHADOW_MAP = {
    'none':   {
      xs: 'none', sm: 'none', md: 'none', lg: 'none'
    },
    'subtle': {
      xs: '0 1px 2px rgba(15,23,25,0.04)',
      sm: '0 1px 3px rgba(15,23,25,0.06),0 1px 2px rgba(15,23,25,0.04)',
      md: '0 4px 12px rgba(15,23,25,0.08),0 2px 4px rgba(15,23,25,0.04)',
      lg: '0 12px 32px rgba(15,23,25,0.12),0 4px 8px rgba(15,23,25,0.05)',
    },
    'medium': {
      xs: '0 1px 4px rgba(0,0,0,0.10)',
      sm: '0 2px 6px rgba(0,0,0,0.12)',
      md: '0 6px 18px rgba(0,0,0,0.14)',
      lg: '0 16px 40px rgba(0,0,0,0.16)',
    },
    'strong': {
      xs: '0 2px 6px rgba(0,0,0,0.18)',
      sm: '0 4px 12px rgba(0,0,0,0.22)',
      md: '0 10px 28px rgba(0,0,0,0.26)',
      lg: '0 24px 56px rgba(0,0,0,0.30)',
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     injectPreviewCss — applique les variables CSS directement sur
     l'élément <html> de l'iframe via setProperty() (spécificité max,
     impossible à écraser par n'importe quel stylesheet).
     Si l'iframe n'est pas encore prête, on schedule un retry.
     ═══════════════════════════════════════════════════════════════ */
  function injectPreviewCss() {
    clearTimeout(_injectRetryTimer);
    if (!previewIframe) return;

    var doc, htmlEl;
    try {
      doc    = previewIframe.contentDocument;
      htmlEl = doc && doc.documentElement;
    } catch (e) { return; } // cross-origin (ne devrait pas arriver)

    // Iframe pas encore chargée → retry dans 80ms
    if (!doc || !htmlEl || doc.readyState !== 'complete') {
      _injectRetryTimer = setTimeout(injectPreviewCss, 80);
      return;
    }

    iframeReady = true;

    var rgb     = hexToRgb(current.accentColor);
    var fontVal = FONT_MAP[current.font]           || FONT_MAP['Inter'];
    var R       = RADIUS_MAP[current.borderRadius] || RADIUS_MAP['md'];
    var BD      = BORDER_MAP[current.borderStyle]  || BORDER_MAP['subtle'];
    var SH      = SHADOW_MAP[current.shadowStyle]  || SHADOW_MAP['subtle'];

    // Applique chaque variable directement sur <html> (inline style → priorité absolue)
    var vars = {
      '--bk-accent':        current.accentColor,
      '--bk-accent-text':   current.accentText,
      '--bk-accent-soft':   'rgba(' + rgb + ',0.10)',
      '--bk-accent-border': 'rgba(' + rgb + ',0.35)',
      '--bk-accent-ink':    current.accentColor,
      '--bk-bg':            current.pageBg,
      '--bk-surface':       current.calBg,
      '--bk-day-bg':        current.dayBg,
      '--bk-day-text':      current.dayText,
      '--bk-btn-bg':        current.btnBg,
      '--bk-btn-text':      current.btnText,
      '--bk-font':          fontVal,
      '--bk-r-xs':          R.xs,
      '--bk-r-sm':          R.sm,
      '--bk-r-md':          R.md,
      '--bk-r-lg':          R.lg,
      '--bk-r-xl':          R.xl,
      '--bk-r-pill':        R.pill,
      '--bk-border':        BD.color,
      '--bk-border-strong': BD.strong,
      '--bk-shadow-xs':     SH.xs,
      '--bk-shadow-sm':     SH.sm,
      '--bk-shadow-md':     SH.md,
      '--bk-shadow-lg':     SH.lg,
    };
    Object.keys(vars).forEach(function (k) {
      htmlEl.style.setProperty(k, vars[k]);
    });
  }

  // scheduleInject = throttle pour les sliders (drag continu)
  var scheduleInject = throttle(injectPreviewCss, 30);

  function loadPreview() {
    if (!previewIframe || !BOOKING_URL) return;
    iframeReady = false;
    // 'load' event → injectPreviewCss dès que la page est prête
    previewIframe.src = BOOKING_URL + '?_czpreview=1&t=' + Date.now();
  }

  if (previewIframe) {
    previewIframe.addEventListener('load', function () {
      // Petit délai pour laisser le JS de la page s'exécuter
      setTimeout(injectPreviewCss, 50);
    });
  }
  if (previewUrlBar && BOOKING_URL) {
    previewUrlBar.textContent = BOOKING_URL.replace(/^\//, 'branshee.com/');
  }
  if (refreshBtn) refreshBtn.addEventListener('click', loadPreview);

  // Charger au premier affichage de l'onglet Design
  document.addEventListener('czDesignVisible', loadPreview);

  /* ═══════════════════════════════════════════════════════════════
     COLOR PICKER PANEL (custom)
     ═══════════════════════════════════════════════════════════════ */

  /* ── Conversions couleur ──────────────────────────────────────── */
  function hexToHsv(hex) {
    var r = parseInt(hex.slice(1,3),16)/255;
    var g = parseInt(hex.slice(3,5),16)/255;
    var b = parseInt(hex.slice(5,7),16)/255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r)      h = ((g-b)/d + 6) % 6;
      else if (max === g) h = (b-r)/d + 2;
      else                h = (r-g)/d + 4;
      h *= 60;
    }
    return { h: h, s: max === 0 ? 0 : d/max*100, v: max*100 };
  }

  function hsvToHex(h, s, v) {
    s /= 100; v /= 100;
    function f(n) {
      var k = (n + h/60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4-k, 1));
    }
    function toHex(n) { return Math.round(n*255).toString(16).padStart(2,'0'); }
    return '#' + toHex(f(5)) + toHex(f(3)) + toHex(f(1));
  }

  function normalizeHex(hex) {
    hex = hex.trim();
    if (!/^#/.test(hex)) hex = '#' + hex;
    if (hex.length === 4) hex = '#'+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
    return hex.toUpperCase();
  }

  /* ═══════════════════════════════════════════════════════════════
     PANEL COULEUR — singleton partagé, sans bouton OK
     Tout changement s'applique immédiatement en live
     ═══════════════════════════════════════════════════════════════ */
  var PRESETS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899',
                 '#06b6d4','#f97316','#111111','#ffffff','#6b7280','#e5e7eb'];

  /* ── Créer le DOM du panel ────────────────────────────────────── */
  var panel = document.createElement('div');
  panel.className = 'czcp';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="czcp__spectrum" id="czCpSpectrum"><div class="czcp__thumb" id="czCpThumb"></div></div>' +
    '<div class="czcp__hue-wrap"><input type="range" class="czcp__hue" id="czCpHue" min="0" max="359" step="1" value="0"></div>' +
    '<div class="czcp__bottom">' +
      '<div class="czcp__preview" id="czCpPreview"></div>' +
      '<input type="text" class="czcp__hex" id="czCpHexInput" maxlength="7" spellcheck="false" placeholder="#000000">' +
    '</div>' +
    '<div class="czcp__presets" id="czCpPresets"></div>';
  document.body.appendChild(panel);

  var cpSpectrum = document.getElementById('czCpSpectrum');
  var cpThumb    = document.getElementById('czCpThumb');
  var cpHue      = document.getElementById('czCpHue');
  var cpPreview  = document.getElementById('czCpPreview');
  var cpHexInput = document.getElementById('czCpHexInput');
  var cpPresets  = document.getElementById('czCpPresets');

  /* ── État du panel ────────────────────────────────────────────── */
  var _cpKey = null;          // clé du champ en cours (ex: 'accentColor')
  var _cpHsv = {h:0,s:0,v:0};
  var _specDragging = false;

  /* ── Fonctions UI interne ─────────────────────────────────────── */
  function _cpUpdateSpectrumBg() {
    cpSpectrum.style.background = 'hsl(' + Math.round(_cpHsv.h) + ',100%,50%)';
  }
  function _cpUpdateThumb() {
    cpThumb.style.left = _cpHsv.s + '%';
    cpThumb.style.top  = (100 - _cpHsv.v) + '%';
  }
  function _cpUpdateHex(hex) {
    cpPreview.style.background = hex;
    cpHexInput.value = hex.toUpperCase();
  }

  /* ── Application LIVE (gauche + droite simultanément) ────────── */
  function _cpLiveApply(hex, isSnapshot) {
    if (!_cpKey) return;
    var clean = normalizeHex(hex);
    if (!clean) return;

    // 1. Mettre à jour l'état global
    current[_cpKey] = clean;

    // 2. Mettre à jour le panel interne
    _cpUpdateHex(clean);

    // 3. Mettre à jour la swatch + hex input dans le panneau gauche
    var swatch   = document.querySelector('[data-color="' + _cpKey + '"] .cz-color-picker__swatch');
    var hexInput = document.querySelector('[data-color="' + _cpKey + '"] .cz-color-picker__hex');
    if (swatch)   swatch.style.background = clean;
    if (hexInput) hexInput.value = clean;

    // 4. Mettre à jour l'aperçu droit (iframe) — directement, pas de throttle
    injectPreviewCss();

    // 5. Snapshot undo seulement sur mouseup/touchend/preset
    if (isSnapshot) snapshotState();
  }

  /* ── Drag spectre ─────────────────────────────────────────────── */
  function _cpSpectrumAt(clientX, clientY) {
    var rect = cpSpectrum.getBoundingClientRect();
    _cpHsv.s = Math.max(0, Math.min(100, (clientX - rect.left)  / rect.width  * 100));
    _cpHsv.v = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    _cpUpdateThumb();
    _cpLiveApply(hsvToHex(_cpHsv.h, _cpHsv.s, _cpHsv.v), false);
  }

  cpSpectrum.addEventListener('mousedown', function (e) {
    e.preventDefault(); e.stopPropagation();
    _specDragging = true;
    _cpSpectrumAt(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function (e) {
    if (_specDragging) _cpSpectrumAt(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', function () {
    if (_specDragging) {
      _specDragging = false;
      _cpLiveApply(hsvToHex(_cpHsv.h, _cpHsv.s, _cpHsv.v), true); // snapshot
    }
  });
  cpSpectrum.addEventListener('touchstart', function (e) {
    e.preventDefault(); _specDragging = true;
    _cpSpectrumAt(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  document.addEventListener('touchmove', function (e) {
    if (_specDragging) _cpSpectrumAt(e.touches[0].clientX, e.touches[0].clientY);
  });
  document.addEventListener('touchend', function () {
    if (_specDragging) {
      _specDragging = false;
      _cpLiveApply(hsvToHex(_cpHsv.h, _cpHsv.s, _cpHsv.v), true);
    }
  });

  /* ── Slider teinte ────────────────────────────────────────────── */
  cpHue.addEventListener('input', function () {
    _cpHsv.h = parseInt(cpHue.value, 10);
    _cpUpdateSpectrumBg();
    _cpLiveApply(hsvToHex(_cpHsv.h, _cpHsv.s, _cpHsv.v), false);
  });
  cpHue.addEventListener('change', function () {
    _cpLiveApply(hsvToHex(_cpHsv.h, _cpHsv.s, _cpHsv.v), true);
  });

  /* ── Hex input ────────────────────────────────────────────────── */
  cpHexInput.addEventListener('input', function () {
    var h = normalizeHex(cpHexInput.value);
    if (h) {
      _cpHsv = hexToHsv(h);
      cpHue.value = Math.round(_cpHsv.h);
      _cpUpdateSpectrumBg();
      _cpUpdateThumb();
      _cpLiveApply(h, false);
    }
  });
  cpHexInput.addEventListener('change', function () {
    var h = normalizeHex(cpHexInput.value);
    if (h) _cpLiveApply(h, true);
  });
  cpHexInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var h = normalizeHex(cpHexInput.value); if (h) { _cpLiveApply(h, true); closePanel(); } }
    e.stopPropagation();
  });
  cpHexInput.addEventListener('click', function (e) { e.stopPropagation(); });

  /* ── Préréglages ──────────────────────────────────────────────── */
  PRESETS.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'czcp__preset';
    b.style.background = c; b.title = c;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      _cpHsv = hexToHsv(c);
      cpHue.value = Math.round(_cpHsv.h);
      _cpUpdateSpectrumBg(); _cpUpdateThumb();
      _cpLiveApply(c, true); // preset = snapshot immédiat
    });
    cpPresets.appendChild(b);
  });

  /* ── Ouvrir / fermer le panel ─────────────────────────────────── */
  function closePanel() {
    panel.style.display = 'none';
    if (_cpKey) {
      var picker = document.querySelector('[data-color="' + _cpKey + '"] .cz-color-picker');
      if (picker) picker.classList.remove('is-open');
    }
    _cpKey = null;
  }

  function openPanel(key, anchorEl) {
    _cpKey = key;
    // Initialiser avec la couleur actuelle
    var initHex = normalizeHex(current[key]) || '#22c55e';
    _cpHsv = hexToHsv(initHex);
    cpHue.value = Math.round(_cpHsv.h);
    _cpUpdateSpectrumBg();
    _cpUpdateThumb();
    _cpUpdateHex(initHex);

    // Positionner
    var rect = anchorEl.getBoundingClientRect();
    var panW = 260, panH = 320;
    var top  = rect.bottom + 6;
    var left = rect.left;
    if (left + panW > window.innerWidth  - 8) left = window.innerWidth  - panW - 8;
    if (top  + panH > window.innerHeight - 8) top  = rect.top - panH - 6;
    panel.style.top  = top  + 'px';
    panel.style.left = left + 'px';
    panel.style.display = 'flex';

    var picker = anchorEl.closest('.cz-color-picker');
    if (picker) picker.classList.add('is-open');
  }

  document.addEventListener('click', function (e) {
    if (panel.style.display !== 'none' && !panel.contains(e.target)) closePanel();
  });
  panel.addEventListener('click', function (e) { e.stopPropagation(); });

  /* ── Init chaque champ couleur ────────────────────────────────── */
  function syncPickerUI(key, hex) {
    var swatch   = document.querySelector('[data-color="' + key + '"] .cz-color-picker__swatch');
    var hexInput = document.querySelector('[data-color="' + key + '"] .cz-color-picker__hex');
    if (swatch)   swatch.style.background = hex;
    if (hexInput) hexInput.value = hex.toUpperCase();
  }

  function initColorPicker(f) {
    var swatch   = document.querySelector('[data-color="' + f.key + '"] .cz-color-picker__swatch');
    var hexInput = document.querySelector('[data-color="' + f.key + '"] .cz-color-picker__hex');
    var resetBtn = document.querySelector('[data-color="' + f.key + '"] .cz-color-reset');

    // Initialiser l'affichage
    syncPickerUI(f.key, current[f.key]);

    // Clic swatch → ouvrir/fermer le panel
    if (swatch) {
      swatch.addEventListener('click', function (e) {
        e.stopPropagation();
        if (panel.style.display !== 'none' && _cpKey === f.key) { closePanel(); return; }
        openPanel(f.key, swatch);
      });
    }

    // Hex input direct (hors panel)
    if (hexInput) {
      hexInput.addEventListener('change', function () {
        var clean = normalizeHex(hexInput.value); if (!clean) return;
        current[f.key] = clean; syncPickerUI(f.key, clean);
        injectPreviewCss(); snapshotState();
      });
      hexInput.addEventListener('click',   function (e) { e.stopPropagation(); });
      hexInput.addEventListener('keydown', function (e) { e.stopPropagation(); });
    }

    // Bouton reset
    if (resetBtn) {
      resetBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        current[f.key] = f.def; syncPickerUI(f.key, f.def);
        if (_cpKey === f.key) {
          _cpHsv = hexToHsv(f.def); cpHue.value = Math.round(_cpHsv.h);
          _cpUpdateSpectrumBg(); _cpUpdateThumb(); _cpUpdateHex(f.def);
        }
        injectPreviewCss(); snapshotState();
      });
    }
  }

  COLOR_FIELDS.forEach(initColorPicker);

  /* ═══════════════════════════════════════════════════════════════
     FONT PICKER
     ═══════════════════════════════════════════════════════════════ */
  document.querySelectorAll('.cz-font-btn').forEach(function (btn) {
    if (btn.dataset.font === current.font) btn.classList.add('is-active');
    btn.addEventListener('click', function () {
      document.querySelectorAll('.cz-font-btn').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      current.font = btn.dataset.font;
      snapshotState();
      scheduleInject();
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     RADIUS PICKER
     ═══════════════════════════════════════════════════════════════ */
  document.querySelectorAll('.cz-radius-btn').forEach(function (btn) {
    if (btn.dataset.radius === current.borderRadius) btn.classList.add('is-active');
    btn.addEventListener('click', function () {
      document.querySelectorAll('.cz-radius-btn').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      current.borderRadius = btn.dataset.radius;
      snapshotState(); injectPreviewCss();
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     BORDER STYLE PICKER
     ═══════════════════════════════════════════════════════════════ */
  document.querySelectorAll('[data-border]').forEach(function (btn) {
    if (btn.dataset.border === current.borderStyle) btn.classList.add('is-active');
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-border]').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      current.borderStyle = btn.dataset.border;
      snapshotState(); injectPreviewCss();
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     SHADOW STYLE PICKER
     ═══════════════════════════════════════════════════════════════ */
  document.querySelectorAll('[data-shadow]').forEach(function (btn) {
    if (btn.dataset.shadow === current.shadowStyle) btn.classList.add('is-active');
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-shadow]').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      current.shadowStyle = btn.dataset.shadow;
      snapshotState(); injectPreviewCss();
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     SAVE
     ═══════════════════════════════════════════════════════════════ */
  var saveBtn    = $('czDesignSave');
  var saveStatus = $('czDesignSaveStatus');

  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      var span = saveBtn.querySelector('span');
      saveBtn.disabled = true;
      if (span) span.textContent = 'Enregistrement…';
      if (saveStatus) { saveStatus.textContent = ''; saveStatus.style.color = ''; }
      try {
        var res = await fetch('/account/calendar-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accentColor:  current.accentColor,
            accentText:   current.accentText,
            pageBg:       current.pageBg,
            calBg:        current.calBg,
            dayBg:        current.dayBg,
            dayText:      current.dayText,
            btnBg:        current.btnBg,
            btnText:      current.btnText,
            font:         current.font,
            borderRadius: current.borderRadius,
            borderStyle:  current.borderStyle,
            shadowStyle:  current.shadowStyle,
            lang:         CS.lang         || 'fr',
            showInfo:     CS.showInfo     !== false,
            showSocials:  CS.showSocials  !== false,
            layoutStyle:  CS.layoutStyle  || 'classic',
            pageBgType:   CS.pageBgType   || 'color',
            pageBgImage:  CS.pageBgImage  || '',
          }),
        });
        var data = await res.json();
        if (span) span.textContent = 'Enregistrer';
        saveBtn.disabled = false;
        if (data.success) {
          if (saveStatus) {
            saveStatus.textContent = '✓ Appliqué';
            saveStatus.style.color = '#22c55e';
            setTimeout(function () { saveStatus.textContent = ''; }, 2500);
          }
          // Re-inject dans l'iframe (au cas où elle a rechargé)
          injectPreviewCss();
        } else {
          if (saveStatus) { saveStatus.textContent = 'Erreur'; saveStatus.style.color = '#ef4444'; }
        }
      } catch (_) {
        if (saveBtn.querySelector('span')) saveBtn.querySelector('span').textContent = 'Enregistrer';
        saveBtn.disabled = false;
        if (saveStatus) { saveStatus.textContent = 'Erreur réseau'; saveStatus.style.color = '#ef4444'; }
      }
    });
  }

  /* ── Reset tout ─────────────────────────────────────────────────────────── */
  var resetAllBtn = $('czDesignResetAll');
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', function () {
      if (!confirm('Réinitialiser tous les réglages de design ?')) return;
      COLOR_FIELDS.forEach(function (f) {
        current[f.key] = f.def;
        syncPickerUI(f.key, f.def);
      });
      current.font = 'Inter';
      document.querySelectorAll('.cz-font-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.font === 'Inter');
      });
      current.borderRadius = 'md';
      document.querySelectorAll('.cz-radius-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.radius === 'md');
      });
      current.borderStyle = 'subtle';
      document.querySelectorAll('[data-border]').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.border === 'subtle');
      });
      current.shadowStyle = 'subtle';
      document.querySelectorAll('[data-shadow]').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.shadow === 'subtle');
      });
      snapshotState();
      injectPreviewCss();
    });
  }

  updateUndoRedoBtns();

})();

/* ═══════════════════════════════════════════════════════════════
   ONGLET INTÉGRATION
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // URL de la page publique — on construit la version absolue ici
  var BOOKING_PATH = window.__czBookingUrl || ''; // ex: "/6a27fd..."
  // Utiliser branshee.com en prod, ou localhost en dev
  var origin = window.location.origin;
  // Si l'origin contient "localhost" ou "127.0.0.1", utiliser tel quel
  // Sinon, forcer le vrai domaine si fourni
  var FULL_URL = BOOKING_PATH ? (origin + BOOKING_PATH) : '';

  /* ── Helper copier ───────────────────────────────────────────── */
  function copyText(text, btn) {
    if (!text || !btn) return;
    var orig = btn.innerHTML;
    navigator.clipboard.writeText(text).then(function () {
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>&nbsp;Copié !';
      btn.style.color = '#22c55e';
      setTimeout(function () { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
    }).catch(function () {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      btn.innerHTML = '✓ Copié';
      setTimeout(function () { btn.innerHTML = orig; }, 1800);
    });
  }

  /* ── Lien direct ─────────────────────────────────────────────── */
  var linkInput  = document.getElementById('czIntLink');
  var linkCopyBtn = document.getElementById('czIntLinkCopy');
  var openBtn    = document.getElementById('czIntOpenPage');

  if (linkInput) {
    linkInput.value = FULL_URL || '— Configurez une URL dans l\'onglet Général';
  }
  if (linkCopyBtn) {
    linkCopyBtn.addEventListener('click', function () { copyText(FULL_URL, linkCopyBtn); });
  }
  if (openBtn && FULL_URL) {
    openBtn.addEventListener('click', function () { window.open(FULL_URL, '_blank'); });
  } else if (openBtn) {
    openBtn.disabled = true;
    openBtn.style.opacity = '0.4';
  }

  /* ── iFrame embed ────────────────────────────────────────────── */
  var widthInput    = document.getElementById('czIframeWidth');
  var heightInput   = document.getElementById('czIframeHeight');
  var codeArea      = document.getElementById('czIframeCode');
  var iframeCopyBtn = document.getElementById('czIframeCodeCopy');
  var embedFrame    = document.getElementById('czEmbedPreviewFrame');
  var embedFrameWrap = document.getElementById('czEmbedFrameWrap');

  /* ── Mapping section → sélecteurs CSS dans la page booking ─── */
  var SECTION_SELECTORS = {
    'profile':  '.bk-head',
    'services': '#bkCart',
    'reviews':  'section.bk-reviews, .bk-reviews',
    'about':    '.bk-about-card, .bk-info-section, .bk-location-card',
  };

  /* ── Injecter le masquage des sections dans l'iframe embed ─── */
  var _embedRetry = null;
  function injectEmbedSections() {
    clearTimeout(_embedRetry);
    if (!embedFrame) return;
    var doc;
    try {
      doc = embedFrame.contentDocument;
    } catch(e) { return; }
    if (!doc || doc.readyState !== 'complete') {
      _embedRetry = setTimeout(injectEmbedSections, 100);
      return;
    }

    // Construire le CSS de masquage
    var hidden = [];
    Object.keys(SECTION_SELECTORS).forEach(function (key) {
      var cb = document.getElementById('embedSec' + key.charAt(0).toUpperCase() + key.slice(1));
      var checked = cb ? cb.checked : true;
      if (!checked) hidden.push(SECTION_SELECTORS[key] + ' { display:none !important; }');
    });

    var styleId = '__cz_embed_sections';
    var style = doc.getElementById(styleId);
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      (doc.head || doc.documentElement).appendChild(style);
    }
    style.textContent = hidden.join('\n');
  }

  /* ── Sections cochées → paramètre URL (pour le code à copier) ── */
  function getSelectedSections() {
    var all = ['booking','profile','services','reviews','about'];
    var checked = [];
    all.forEach(function (key) {
      var id = 'embedSec' + key.charAt(0).toUpperCase() + key.slice(1);
      var cb = document.getElementById(id);
      // booking est toujours inclus (disabled + checked)
      if (!cb || cb.checked) checked.push(key);
    });
    return checked;
  }

  function buildEmbedUrl() {
    if (!FULL_URL) return '';
    var secs = getSelectedSections();
    var all = ['booking','profile','services','reviews','about'];
    // Si tout est coché → URL simple
    if (secs.length >= all.length) return FULL_URL;
    return FULL_URL + '?sections=' + secs.join(',');
  }

  /* ── Construire le code iframe ───────────────────────────────── */
  function buildIframeCode() {
    var url = buildEmbedUrl();
    if (!url) return '<!-- Configurez votre URL d\'abord -->';
    var w   = (widthInput  ? widthInput.value.trim()  : '100%') || '100%';
    var h   = (heightInput ? heightInput.value.trim() : '780')  || '780';
    var hPx = /^\d+$/.test(h) ? h + 'px' : h;
    var wPx = /^\d+$/.test(w) ? w + 'px' : w;
    return '<iframe\n' +
      '  src="' + url + '"\n' +
      '  width="' + wPx + '"\n' +
      '  height="' + hPx + '"\n' +
      '  frameborder="0"\n' +
      '  style="border-radius:12px;border:none;"\n' +
      '  title="Réservation en ligne"\n' +
      '  loading="lazy"\n' +
      '  allow="payment"\n' +
      '></iframe>';
  }

  /* ── Mettre à jour le preview instantanément ─────────────────── */
  function updatePreview() {
    // 1. Mettre à jour le code à copier
    if (codeArea) codeArea.value = buildIframeCode();

    // 2. Hauteur de l'iframe preview (transition CSS)
    if (embedFrame) {
      var h = parseInt(heightInput ? heightInput.value : '780', 10) || 780;
      h = Math.max(400, Math.min(900, h));
      embedFrame.style.height = h + 'px';
    }

    // 3. Masquer/afficher les sections dans l'iframe (sans rechargement)
    injectEmbedSections();
  }

  // Charger l'iframe embed (src vide dans le HTML, on la charge ici)
  if (embedFrame && BOOKING_PATH) {
    embedFrame.addEventListener('load', function () {
      // Après chargement : appliquer immédiatement les sections cochées
      setTimeout(injectEmbedSections, 60);
    });
    embedFrame.src = BOOKING_PATH;
  }

  // Écouter les changements de taille
  if (widthInput)  widthInput.addEventListener('input', updatePreview);
  if (heightInput) heightInput.addEventListener('input', updatePreview);

  // Checkboxes sections → masquage INSTANTANÉ sans rechargement
  document.querySelectorAll('input[name="embedSection"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      // Met à jour le code à copier
      if (codeArea) codeArea.value = buildIframeCode();
      // Masque/affiche la section dans l'iframe immédiatement
      injectEmbedSections();
    });
  });

  // Init code + hauteur
  if (codeArea) codeArea.value = buildIframeCode();
  if (embedFrame) embedFrame.style.height = '780px';

  if (iframeCopyBtn) {
    iframeCopyBtn.addEventListener('click', function () { copyText(buildIframeCode(), iframeCopyBtn); });
  }

  /* ── QR code ─────────────────────────────────────────────────── */
  var qrCanvas = document.getElementById('czQrCanvas');
  var qrImg    = document.getElementById('czQrImg');
  var qrDlBtn  = document.getElementById('czQrDownload');
  var qrEmpty  = qrCanvas && qrCanvas.querySelector('.cz-qr-empty');

  if (FULL_URL && qrImg) {
    var qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=' + encodeURIComponent(FULL_URL);
    qrImg.src   = qrApiUrl;
    qrImg.style.cssText = 'width:100px;height:100px;border-radius:6px;display:block;';
    qrImg.onerror = function () {
      qrImg.style.display = 'none';
      if (qrCanvas) qrCanvas.innerHTML = '<span style="font-size:12px;color:#9ca3af;text-align:center;padding:8px;">Erreur de génération</span>';
    };
    if (qrEmpty) qrEmpty.style.display = 'none';
  } else if (qrCanvas) {
    qrCanvas.innerHTML = '<span style="font-size:11.5px;color:#9ca3af;text-align:center;padding:8px;line-height:1.4">Configurez votre URL pour générer le QR code</span>';
  }

  if (qrDlBtn) {
    if (!FULL_URL) {
      qrDlBtn.disabled = true;
      qrDlBtn.style.opacity = '0.4';
    } else {
      qrDlBtn.addEventListener('click', function () {
        // Télécharger en haute résolution
        var hdUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data=' + encodeURIComponent(FULL_URL);
        var a = document.createElement('a');
        a.href     = hdUrl;
        a.download = 'qr-reservation.png';
        a.target   = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    }
  }

})();
