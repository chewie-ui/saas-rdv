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
  // Champs "auto" (def: '') : vides par défaut, ils suivent une autre couleur
  // (voir effectiveColor()) tant que l'utilisateur n'a pas choisi explicitement
  // une couleur — pour ne jamais "figer" une teinte pour qui n'a jamais touché
  // ce champ (ça casserait le rendu au prochain Enregistrer d'un autre champ).
  var COLOR_FIELDS = [
    { key: 'accentColor', def: '#22c55e' },
    { key: 'accentText',  def: '#ffffff' },
    { key: 'pageBg',      def: '#f7f8f7' },
    { key: 'calBg',       def: '#ffffff' },
    { key: 'dayBg',       def: '#ffffff' },
    { key: 'dayAvailableColor', def: '#16a34a' },
    { key: 'dayBusyColor',      def: '#ea580c' },
    { key: 'dayFullColor',      def: '#ef4444' },
    { key: 'daySelectedBg',   def: '', fallback: 'accentColor' },
    { key: 'daySelectedText', def: '', fallback: 'accentText' },
    { key: 'dayHoverBg',      def: '', fallback: 'dayAvailableColor' },
    { key: 'btnHoverBg',      def: '', fallback: 'accentColor' },
  ];
  var COLOR_FIELDS_BY_KEY = {};
  COLOR_FIELDS.forEach(function (f) { COLOR_FIELDS_BY_KEY[f.key] = f; });

  // Couleur à AFFICHER dans le picker — la valeur réelle stockée si elle
  // existe, sinon la couleur qu'elle suit automatiquement (jamais de blanc/
  // swatch vide à l'écran, même quand rien n'a encore été choisi).
  function effectiveColor(key) {
    if (current[key]) return current[key];
    var f = COLOR_FIELDS_BY_KEY[key];
    if (f && f.fallback) return effectiveColor(f.fallback);
    return '#000000';
  }

  /* ── État courant ───────────────────────────────────────────────────────── */
  var current = {};
  COLOR_FIELDS.forEach(function (f) {
    current[f.key] = CS[f.key] || f.def;
  });
  current.font         = CS.font         || 'Inter';
  current.customFontUrl    = CS.customFontUrl    || '';
  current.customFontFamily = CS.customFontFamily || '';
  current.borderRadius = CS.borderRadius || 'md';
  current.borderStyle  = CS.borderStyle  || 'subtle';
  current.shadowStyle  = CS.shadowStyle  || 'subtle';
  current.textCalendarHelp = CS.textCalendarHelp || '';
  current.textSlotHeading  = CS.textSlotHeading  || '';
  current.textTimezone     = CS.textTimezone     || '';

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
    COLOR_FIELDS.forEach(function (f) { syncPickerUI(f.key, effectiveColor(f.key)); });
    // Textes
    if ($('czTextCalendarHelp')) $('czTextCalendarHelp').value = current.textCalendarHelp || '';
    if ($('czTextSlotHeading'))  $('czTextSlotHeading').value  = current.textSlotHeading  || '';
    if ($('czTextTimezone'))     $('czTextTimezone').value     = current.textTimezone     || '';
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
    updateDayPreviewSwatch(); // indépendant de l'iframe — toujours à jour
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

    // Police personnalisée importée par l'utilisateur (prioritaire)
    if (current.customFontFamily) {
      fontVal = "'" + current.customFontFamily + "', " + fontVal;
    }
    if (current.customFontUrl) {
      var linkId = '__cz_custom_font';
      var fontLink = doc.getElementById(linkId);
      if (!fontLink) {
        fontLink = doc.createElement('link');
        fontLink.id = linkId;
        fontLink.rel = 'stylesheet';
        (doc.head || doc.documentElement).appendChild(fontLink);
      }
      if (fontLink.href !== current.customFontUrl) fontLink.href = current.customFontUrl;
    }

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
      '--bk-day-available-color': current.dayAvailableColor,
      '--bk-day-available-bg':       'rgba(' + hexToRgb(current.dayAvailableColor) + ',0.08)',
      '--bk-day-available-bg-hover': 'rgba(' + hexToRgb(current.dayAvailableColor) + ',0.16)',
      '--bk-day-busy-color': current.dayBusyColor,
      '--bk-day-busy-bg':       'rgba(' + hexToRgb(current.dayBusyColor) + ',0.10)',
      '--bk-day-busy-bg-hover': 'rgba(' + hexToRgb(current.dayBusyColor) + ',0.18)',
      '--bk-day-full-color': current.dayFullColor,
      '--bk-day-full-bg':    'rgba(' + hexToRgb(current.dayFullColor) + ',0.08)',
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
    // États "auto" — uniquement injectés quand l'admin a choisi une couleur
    // explicite, sinon on laisse le fallback CSS (var(--a, var(--b))) suivre
    // accent / la teinte de dispo. automatiquement.
    if (current.daySelectedBg)   vars['--bk-day-selected-bg']   = current.daySelectedBg;
    if (current.daySelectedText) vars['--bk-day-selected-text'] = current.daySelectedText;
    if (current.dayHoverBg)      vars['--bk-day-hover-bg']      = current.dayHoverBg;
    if (current.btnHoverBg) {
      vars['--bk-btn-hover-bg']      = current.btnHoverBg;
      vars['--bk-btn-hover-opacity'] = '1';
    }
    Object.keys(vars).forEach(function (k) {
      htmlEl.style.setProperty(k, vars[k]);
    });
    // Si l'utilisateur revient en arrière (undo/reset) sur un champ "auto",
    // il faut explicitement RETIRER la variable inline pour que le fallback
    // CSS reprenne la main — setProperty ne suffit pas à "désinjecter".
    [
      ['daySelectedBg',   '--bk-day-selected-bg'],
      ['daySelectedText', '--bk-day-selected-text'],
      ['dayHoverBg',      '--bk-day-hover-bg'],
    ].forEach(function (pair) {
      if (!current[pair[0]]) htmlEl.style.removeProperty(pair[1]);
    });
    if (!current.btnHoverBg) {
      htmlEl.style.removeProperty('--bk-btn-hover-bg');
      htmlEl.style.removeProperty('--bk-btn-hover-opacity');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     Aperçu statique des 3 états de disponibilité — indépendant des
     vraies données du calendrier (pas besoin d'avoir un jour complet
     réel pour voir le rendu). Mêmes teintes que client-booking.css.
     ═══════════════════════════════════════════════════════════════ */
  function updateDayPreviewSwatch() {
    var availCell = $('czPreviewAvailable');
    var busyCell  = $('czPreviewBusy');
    var fullCell  = $('czPreviewFull');
    var availDot  = $('czLegendAvailable');
    var busyDot   = $('czLegendBusy');
    var fullDot   = $('czLegendFull');

    var availRgb = hexToRgb(current.dayAvailableColor);
    var busyRgb  = hexToRgb(current.dayBusyColor);
    var fullRgb  = hexToRgb(current.dayFullColor);

    if (availCell) {
      availCell.style.color = current.dayAvailableColor;
      availCell.style.background = 'rgba(' + availRgb + ',0.08)';
    }
    if (busyCell) {
      busyCell.style.color = current.dayBusyColor;
      busyCell.style.background = 'rgba(' + busyRgb + ',0.10)';
      busyCell.style.fontWeight = '700';
    }
    if (fullCell) {
      fullCell.style.color = current.dayFullColor;
      fullCell.style.background = 'rgba(' + fullRgb + ',0.08)';
      fullCell.style.textDecoration = 'line-through';
    }
    if (availDot) availDot.style.background = current.dayAvailableColor;
    if (busyDot)  busyDot.style.background  = current.dayBusyColor;
    if (fullDot)  fullDot.style.background  = current.dayFullColor;
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
    // Initialiser avec la couleur actuelle (ou celle suivie automatiquement)
    var initHex = normalizeHex(effectiveColor(key)) || '#22c55e';
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
    syncPickerUI(f.key, effectiveColor(f.key));

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

    // Bouton reset — pour les champs "auto" (def: ''), ça revient à suivre
    // à nouveau la couleur dont ils dépendent, pas à un hex figé.
    if (resetBtn) {
      resetBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        current[f.key] = f.def;
        var display = effectiveColor(f.key);
        syncPickerUI(f.key, display);
        if (_cpKey === f.key) {
          _cpHsv = hexToHsv(display); cpHue.value = Math.round(_cpHsv.h);
          _cpUpdateSpectrumBg(); _cpUpdateThumb(); _cpUpdateHex(display);
        }
        injectPreviewCss(); snapshotState();
      });
    }
  }

  COLOR_FIELDS.forEach(initColorPicker);

  /* ═══════════════════════════════════════════════════════════════
     THÈMES — palettes complètes prêtes à l'emploi. Un clic fusionne tous
     les champs du thème dans `current`, met à jour tous les contrôles à
     l'écran (comme applySnapshot) et déclenche un nouveau point d'undo.
     ═══════════════════════════════════════════════════════════════ */
  var THEMES = [
    { id: 'noir', name: 'Noir', values: {
        accentColor:'#111111', accentText:'#ffffff', pageBg:'#f5f5f5', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#111111', daySelectedText:'#ffffff', dayHoverBg:'#ececec', btnHoverBg:'#2b2b2b',
        font:'Inter', borderRadius:'sm', borderStyle:'subtle', shadowStyle:'medium' } },
    { id: 'emeraude', name: 'Émeraude', values: {
        accentColor:'#16a34a', accentText:'#ffffff', pageBg:'#f3faf5', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#16a34a', daySelectedText:'#ffffff', dayHoverBg:'#dcf5e6', btnHoverBg:'#15803d',
        font:'Inter', borderRadius:'md', borderStyle:'subtle', shadowStyle:'subtle' } },
    { id: 'marine', name: 'Bleu Marine', values: {
        accentColor:'#1e3a8a', accentText:'#ffffff', pageBg:'#f4f6fb', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#1e3a8a', daySelectedText:'#ffffff', dayHoverBg:'#e2e8f7', btnHoverBg:'#1b3175',
        font:'Montserrat', borderRadius:'md', borderStyle:'medium', shadowStyle:'medium' } },
    { id: 'ocean', name: 'Océan', values: {
        accentColor:'#0284c7', accentText:'#ffffff', pageBg:'#f0f9ff', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#0284c7', daySelectedText:'#ffffff', dayHoverBg:'#dff1fb', btnHoverBg:'#026da3',
        font:'Lato', borderRadius:'lg', borderStyle:'subtle', shadowStyle:'subtle' } },
    { id: 'rubis', name: 'Rouge Rubis', values: {
        accentColor:'#be123c', accentText:'#ffffff', pageBg:'#fbf4f5', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#be123c', daySelectedText:'#ffffff', dayHoverBg:'#f7dfe4', btnHoverBg:'#9f0f32',
        font:'Montserrat', borderRadius:'sm', borderStyle:'medium', shadowStyle:'medium' } },
    { id: 'corail', name: 'Corail', values: {
        accentColor:'#f25c54', accentText:'#ffffff', pageBg:'#fff5f3', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#f25c54', daySelectedText:'#ffffff', dayHoverBg:'#fde3e0', btnHoverBg:'#d9483f',
        font:'Nunito', borderRadius:'lg', borderStyle:'none', shadowStyle:'subtle' } },
    { id: 'lavande', name: 'Lavande', values: {
        accentColor:'#7c3aed', accentText:'#ffffff', pageBg:'#f7f5fc', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#7c3aed', daySelectedText:'#ffffff', dayHoverBg:'#ebe3fa', btnHoverBg:'#6526d0',
        font:'Poppins', borderRadius:'lg', borderStyle:'subtle', shadowStyle:'subtle' } },
    { id: 'rose', name: 'Rose Poudré', values: {
        accentColor:'#db2777', accentText:'#ffffff', pageBg:'#fdf2f8', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#db2777', daySelectedText:'#ffffff', dayHoverBg:'#fbe0ee', btnHoverBg:'#bb1c63',
        font:'Poppins', borderRadius:'lg', borderStyle:'none', shadowStyle:'subtle' } },
    { id: 'champagne', name: 'Or Champagne', values: {
        accentColor:'#b8924a', accentText:'#ffffff', pageBg:'#faf6ee', calBg:'#fffdf8', dayBg:'#fffdf8',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#b8924a', daySelectedText:'#ffffff', dayHoverBg:'#f1e6d0', btnHoverBg:'#9c7a3a',
        font:'Playfair Display', borderRadius:'lg', borderStyle:'subtle', shadowStyle:'subtle' } },
    { id: 'foret', name: 'Forêt', values: {
        accentColor:'#2f5233', accentText:'#ffffff', pageBg:'#f5f3ea', calBg:'#fffefb', dayBg:'#fffefb',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#2f5233', daySelectedText:'#ffffff', dayHoverBg:'#e3e8d6', btnHoverBg:'#23401f',
        font:'Nunito', borderRadius:'md', borderStyle:'medium', shadowStyle:'subtle' } },
    { id: 'ardoise', name: 'Ardoise', values: {
        accentColor:'#475569', accentText:'#ffffff', pageBg:'#f1f5f9', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#475569', daySelectedText:'#ffffff', dayHoverBg:'#e2e8f0', btnHoverBg:'#334155',
        font:'Inter', borderRadius:'sm', borderStyle:'subtle', shadowStyle:'none' } },
    { id: 'sarcelle', name: 'Sarcelle', values: {
        accentColor:'#0d9488', accentText:'#ffffff', pageBg:'#f0fbf9', calBg:'#ffffff', dayBg:'#ffffff',
        dayAvailableColor:'#16a34a', dayBusyColor:'#ea580c', dayFullColor:'#ef4444',
        daySelectedBg:'#0d9488', daySelectedText:'#ffffff', dayHoverBg:'#d8f3ef', btnHoverBg:'#0b7a70',
        font:'Lato', borderRadius:'md', borderStyle:'subtle', shadowStyle:'subtle' } },
  ];

  function applyTheme(theme) {
    Object.assign(current, theme.values);
    COLOR_FIELDS.forEach(function (f) { syncPickerUI(f.key, effectiveColor(f.key)); });
    document.querySelectorAll('.cz-font-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.font === current.font);
    });
    document.querySelectorAll('.cz-radius-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.radius === current.borderRadius);
    });
    document.querySelectorAll('[data-border]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.border === current.borderStyle);
    });
    document.querySelectorAll('[data-shadow]').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.shadow === current.shadowStyle);
    });
    injectPreviewCss();
    snapshotState();
  }

  var themeGrid = $('czThemeGrid');
  if (themeGrid) {
    THEMES.forEach(function (theme) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-theme-btn';
      b.title = theme.name;
      var v = theme.values;
      b.innerHTML =
        '<span class="cz-theme-btn__swatch">' +
          '<span style="background:' + v.pageBg + '"></span>' +
          '<span style="background:' + v.accentColor + '"></span>' +
          '<span style="background:' + v.dayAvailableColor + '"></span>' +
        '</span>' +
        '<span class="cz-theme-btn__name">' + theme.name + '</span>';
      b.addEventListener('click', function () { applyTheme(theme); });
      themeGrid.appendChild(b);
    });
  }

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

  /* ── Police personnalisée (importée par l'utilisateur) ────────── */
  var customFontUrlInput    = $('czCustomFontUrl');
  var customFontFamilyInput = $('czCustomFontFamily');
  if (customFontUrlInput) {
    customFontUrlInput.addEventListener('input', function () {
      current.customFontUrl = customFontUrlInput.value.trim();
      snapshotState();
      scheduleInject();
    });
  }
  if (customFontFamilyInput) {
    customFontFamilyInput.addEventListener('input', function () {
      current.customFontFamily = customFontFamilyInput.value.trim();
      snapshotState();
      scheduleInject();
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     TEXTES DU PARCOURS DE RÉSERVATION — pas de live preview DOM (le texte
     vit dans le HTML généré par le serveur, pas dans une variable CSS) ;
     l'aperçu se mettra à jour au prochain rechargement de l'iframe (bouton
     Rafraîchir, changement d'onglet, ou après Enregistrer).
     ═══════════════════════════════════════════════════════════════ */
  var TEXT_FIELDS = [
    { id: 'czTextCalendarHelp', key: 'textCalendarHelp' },
    { id: 'czTextSlotHeading',  key: 'textSlotHeading'  },
    { id: 'czTextTimezone',     key: 'textTimezone'      },
  ];
  var _textTimer;
  TEXT_FIELDS.forEach(function (tf) {
    var input = $(tf.id);
    if (!input) return;
    input.addEventListener('input', function () {
      current[tf.key] = input.value;
      clearTimeout(_textTimer);
      _textTimer = setTimeout(snapshotState, 800);
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
      // `span:not(.material-symbols-outlined)` et non `span` : le PREMIER span
      // du bouton est l'icône. Écrire dedans remplaçait la ligature « save » par
      // le mot « Enregistrer », que la police Material Symbols affiche en
      // toutes lettres — d'où le « ENREGISTRER Enregistrer » à chaque clic, et
      // l'icône définitivement perdue ensuite.
      var span = saveBtn.querySelector('span:not(.material-symbols-outlined)');
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
            dayAvailableColor: current.dayAvailableColor,
            dayBusyColor:      current.dayBusyColor,
            dayFullColor:      current.dayFullColor,
            daySelectedBg:   current.daySelectedBg,
            daySelectedText: current.daySelectedText,
            dayHoverBg:      current.dayHoverBg,
            btnHoverBg:      current.btnHoverBg,
            font:         current.font,
            customFontUrl:    current.customFontUrl,
            customFontFamily: current.customFontFamily,
            borderRadius: current.borderRadius,
            borderStyle:  current.borderStyle,
            shadowStyle:  current.shadowStyle,
            textCalendarHelp: current.textCalendarHelp,
            textSlotHeading:  current.textSlotHeading,
            textTimezone:     current.textTimezone,
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
          // Rechargement complet (pas juste injectPreviewCss) : nécessaire
          // pour refléter les textes personnalisés, rendus côté serveur.
          loadPreview();
        } else {
          if (saveStatus) { saveStatus.textContent = 'Erreur'; saveStatus.style.color = '#ef4444'; }
        }
      } catch (_) {
        var lbl = saveBtn.querySelector('span:not(.material-symbols-outlined)');
        if (lbl) lbl.textContent = 'Enregistrer';
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
      });
      // Deuxième passe : les champs "auto" dépendent d'accentColor/etc.,
      // qui viennent eux-mêmes d'être réinitialisés ci-dessus.
      COLOR_FIELDS.forEach(function (f) {
        syncPickerUI(f.key, effectiveColor(f.key));
      });
      TEXT_FIELDS.forEach(function (tf) {
        current[tf.key] = '';
        if ($(tf.id)) $(tf.id).value = '';
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

  /* ── Sections cochées → paramètre URL (pour le code à copier) ── */
  function getSelectedSections() {
    var all = ['booking','profile','reviews','about','hours'];
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
    var all = ['booking','profile','reviews','about','hours'];
    // Si tout est coché → URL simple
    if (secs.length >= all.length) return FULL_URL;
    return FULL_URL + '?sections=' + secs.join(',');
  }

  // Étapes vérifiées sur les documentations officielles (août 2026), et non
  // écrites de mémoire : les noms d'éléments et les formules requises changent
  // souvent, et une consigne fausse fait perdre plus de temps qu'elle n'en
  // fait gagner.
  //
  // `script: false` ne veut PAS dire « la plateforme interdit le JavaScript »,
  // mais « l'ajustement automatique de la hauteur n'y sert à rien ». Sur Wix
  // le JavaScript s'exécute bel et bien, mais dans un cadre sandboxé à hauteur
  // fixe : notre message de redimensionnement n'atteint jamais la page.
  // Résultat identique à un blocage, cause différente.
  var PLATEFORMES = {
    wordpress: {
      nom: 'WordPress',
      script: true,
      etapes: [
        'Ouvrez la page voulue, puis cliquez sur « Modifier ».',
        'Cliquez sur le « + » pour ajouter un bloc, et cherchez « HTML personnalisé ».',
        'Collez le code ci-dessous dans le bloc.',
        'Cliquez sur « Mettre à jour » : c’est en ligne.',
      ],
      note: 'Sur WordPress.com (l’hébergé, pas le WordPress installé chez vous), les formules d’entrée retirent le JavaScript : cochez alors « hauteur fixe » ci-dessous.',
    },
    wix: {
      nom: 'Wix',
      script: false,
      etapes: [
        'Dans l’éditeur, cliquez sur « + Ajouter des éléments » puis « Intégrer le code ».',
        'Choisissez « Code d’intégration HTML » (Embed HTML).',
        'Cliquez sur « Entrer le code » et collez le code ci-dessous.',
        'Faites glisser les bords du cadre pour lui donner la hauteur voulue, puis publiez.',
      ],
      note: 'Wix place toute intégration dans un cadre à hauteur fixe : l’ajustement automatique n’y fonctionne pas, quelle que soit la formule. Réglez la hauteur ci-dessous, ou étirez le cadre dans l’éditeur.',
    },
    webador: {
      nom: 'Webador',
      script: true,
      etapes: [
        'Dans l’éditeur, faites glisser l’élément « Code intégré » depuis le menu de gauche sur votre page.',
        'Cliquez sur l’élément, puis sur « Modifier le code intégré ».',
        'Collez le code ci-dessous dans le champ, et enregistrez.',
      ],
      note: 'L’élément « Code intégré » demande une formule Lite, Pro ou Business : il n’existe pas sur la formule gratuite.',
    },
    squarespace: {
      nom: 'Squarespace',
      script: true,
      etapes: [
        'Ouvrez la page, cliquez sur « Modifier », puis sur un « + » pour ajouter un bloc.',
        'Choisissez le bloc « Code ».',
        'Collez le code ci-dessous et laissez le type sur « HTML ».',
        'Enregistrez, puis publiez.',
      ],
      note: 'Le bloc « Code » accepte du HTML sur toutes les formules, mais le JavaScript et les iframes demandent une formule payante (Core ou supérieure). Sur la formule d’entrée, mettez plutôt un simple lien vers votre page de réservation.',
    },
    jimdo: {
      nom: 'Jimdo',
      script: true,
      etapes: [
        'Passez le site en mode édition, survolez l’endroit voulu et cliquez sur « Ajouter un élément ».',
        'Ouvrez « Autres éléments et modules », puis choisissez « Widget/HTML ».',
        'Collez le code ci-dessous dans l’élément et enregistrez.',
      ],
      note: '',
    },
    shopify: {
      nom: 'Shopify',
      script: true,
      etapes: [
        'Administration Shopify → Boutique en ligne → Pages.',
        'Ouvrez la page voulue, puis passez l’éditeur en mode HTML (bouton « <> »).',
        'Collez le code ci-dessous.',
        'Enregistrez.',
      ],
      note: '',
    },
    webflow: {
      nom: 'Webflow',
      script: true,
      etapes: [
        'Dans le Designer, glissez un élément « Embed » à l’endroit voulu.',
        'Collez le code ci-dessous dans la fenêtre qui s’ouvre, puis enregistrez.',
        'Publiez le site pour que l’intégration soit visible en ligne.',
      ],
      note: '',
    },
    autre: {
      nom: 'Autre site',
      script: true,
      etapes: [
        'Ouvrez le fichier ou l’éditeur HTML de la page voulue.',
        'Collez le code ci-dessous à l’endroit où le calendrier doit apparaître.',
        'Enregistrez et publiez.',
      ],
      note: 'Si votre outil refuse le JavaScript, ou si le calendrier apparaît coupé, cochez « hauteur fixe » ci-dessous : l’iframe seule fonctionne partout.',
    },
  };

  var platPills   = document.getElementById('czPlatPills');
  var platSteps   = document.getElementById('czPlatSteps');
  var platWarn    = document.getElementById('czPlatWarn');
  var platWarnTxt = document.getElementById('czPlatWarnText');
  var heightCtrl  = document.getElementById('czHeightCtrl');
  var noScriptCb  = document.getElementById('czNoScript');
  var platCourante = 'wordpress';

  function platActuelle() { return PLATEFORMES[platCourante] || PLATEFORMES.autre; }
  // Hauteur automatique si la plateforme accepte le JavaScript ET que le pro
  // n'a pas dit le contraire (formules bridées : WordPress.com gratuit,
  // Squarespace Personal…).
  function hauteurAuto() {
    if (noScriptCb && noScriptCb.checked) return false;
    return !!platActuelle().script;
  }

  function rendrePlateforme() {
    var p = platActuelle();
    if (platSteps) {
      platSteps.innerHTML = '';
      var ol = document.createElement('ol');
      ol.className = 'cz-plat__list';
      p.etapes.forEach(function (t) {
        var li = document.createElement('li');
        li.textContent = t;
        ol.appendChild(li);
      });
      platSteps.appendChild(ol);
    }
    if (platWarn && platWarnTxt) {
      platWarn.hidden = !p.note;
      platWarnTxt.textContent = p.note || '';
    }
    // Le champ hauteur n'a de sens que si l'iframe ne s'ajuste pas seule.
    if (heightCtrl) heightCtrl.hidden = hauteurAuto();
  }

  if (platPills) {
    platPills.querySelectorAll('.cz-plat__pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        platPills.querySelectorAll('.cz-plat__pill').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        platCourante = btn.dataset.plat;
        // La case suit la plateforme choisie : cochée d'office pour celles
        // qu'on sait bloquantes, décochée sinon. Le pro garde la main après.
        if (noScriptCb) noScriptCb.checked = !platActuelle().script;
        rendrePlateforme();
        updatePreview();
      });
    });
  }

  if (noScriptCb) {
    noScriptCb.addEventListener('change', function () {
      rendrePlateforme();
      updatePreview();
    });
  }

  /* ── Construire le code iframe ───────────────────────────────── */
  function buildIframeCode() {
    var url = buildEmbedUrl();
    if (!url) return '<!-- Configurez votre URL d\'abord -->';
    var w   = (widthInput  ? widthInput.value.trim()  : '100%') || '100%';
    var wPx = /^\d+$/.test(w) ? w + 'px' : w;

    // Plateforme sans JavaScript : iframe seule, à la hauteur choisie. C'est
    // le seul code qui survit à un Wix ou un WordPress.com gratuit.
    if (!hauteurAuto()) {
      var h = (heightInput && parseInt(heightInput.value, 10)) || 800;
      return '<iframe\n' +
        '  src="' + url + '"\n' +
        '  width="' + wPx + '"\n' +
        '  height="' + h + '"\n' +
        '  frameborder="0"\n' +
        '  style="border-radius:12px;border:none;display:block;"\n' +
        '  title="Réservation en ligne"\n' +
        '  loading="lazy"\n' +
        '  allow="payment"\n' +
        '></iframe>';
    }

    // L'iframe se redimensionne automatiquement via postMessage — hauteur initiale
    // généreuse pour éviter le flash, puis ajustée par le script ci-dessous.
    return '<iframe\n' +
      '  id="branshee-iframe"\n' +
      '  src="' + url + '"\n' +
      '  width="' + wPx + '"\n' +
      '  height="700px"\n' +
      '  frameborder="0"\n' +
      '  scrolling="no"\n' +
      '  style="border-radius:12px;border:none;display:block;overflow:hidden;"\n' +
      '  title="Réservation en ligne"\n' +
      '  loading="lazy"\n' +
      '  allow="payment"\n' +
      '></iframe>\n' +
      '<script>\n' +
      '(function(){\n' +
      '  var _lh=0;\n' +
      '  window.addEventListener(\'message\',function(e){\n' +
      '    if(!e.data||e.data.type!==\'branshee-resize\')return;\n' +
      '    var h=Math.min(e.data.height+24,6000);\n' +
      '    if(Math.abs(h-_lh)<4)return;\n' +
      '    _lh=h;\n' +
      '    var fr=document.getElementsByTagName(\'iframe\');\n' +
      '    for(var i=0;i<fr.length;i++){\n' +
      '      if(fr[i].contentWindow===e.source){\n' +
      '        fr[i].style.height=h+\'px\';\n' +
      '        break;\n' +
      '      }\n' +
      '    }\n' +
      '  });\n' +
      '})();\n' +
      '<\/script>';
  }

  /* ── Ajuster automatiquement la hauteur du textarea (pas de scroll) ── */
  function autosizeCodeArea() {
    if (!codeArea) return;
    codeArea.style.height = 'auto';
    codeArea.style.height = (codeArea.scrollHeight + 2) + 'px';
  }

  /* ── Mettre à jour le preview instantanément ─────────────────── */
  function updatePreview() {
    // 1. Mettre à jour le code à copier
    if (codeArea) {
      codeArea.value = buildIframeCode();
      autosizeCodeArea();
    }

    // 2. Hauteur gérée automatiquement par postMessage — pas de reset manuel

    // 3. Largeur de l'iframe preview
    if (embedFrameWrap && widthInput) {
      var w = widthInput.value.trim() || '100%';
      var wCss = /^\d+$/.test(w) ? w + 'px' : w;
      embedFrameWrap.style.maxWidth = (wCss === '100%') ? '100%' : wCss;
    }
  }

  /* ── Construit l'URL de l'aperçu : exactement la même que l'iframe générée
     (mêmes sections, donc même comportement embed : header retiré, badge
     "Propulsé par BranShee", contenu centré...) + anti-cache. ───────────── */
  function buildPreviewUrl() {
    var url = buildEmbedUrl();
    if (!url) return '';
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + '_t=' + Date.now();
  }

  // Auto-resize du preview iframe via postMessage (même mécanisme que l'embed réel)
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'branshee-resize') return;
    if (!embedFrame || embedFrame.contentWindow !== e.source) return;
    embedFrame.style.height = (e.data.height + 20) + 'px';
  });

  // Charger l'iframe embed (src vide dans le HTML, on la charge ici)
  if (embedFrame && BOOKING_PATH) {
    embedFrame.src = buildPreviewUrl();
  }

  // À chaque affichage de l'onglet "Intégration" : recharger l'aperçu (pour
  // refléter les changements de design enregistrés entre-temps) + corriger
  // la hauteur du textarea du code (caché donc mal mesuré au chargement).
  document.addEventListener('czIntegrationVisible', function () {
    if (embedFrame && BOOKING_PATH) {
      embedFrame.src = buildPreviewUrl();
    }
    setTimeout(autosizeCodeArea, 0);
  });

  // Étapes et code de la plateforme sélectionnée au chargement.
  rendrePlateforme();

  // Écouter les changements de taille
  if (widthInput)  widthInput.addEventListener('input', updatePreview);
  if (heightInput) heightInput.addEventListener('input', updatePreview);

  // Checkboxes sections → on recharge l'aperçu avec la nouvelle URL
  // (?sections=...). Un simple masquage CSS depuis le parent ne suffit pas :
  // la page booking masque déjà elle-même ses sections au chargement selon
  // l'URL (même logique que sur un vrai site externe) — sans recharger, ce
  // masquage déjà posé par la page elle-même reste actif et la section cochée
  // ne réapparaît jamais, même si on essaie de l'annuler depuis le parent.
  document.querySelectorAll('input[name="embedSection"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      if (codeArea) {
        codeArea.value = buildIframeCode();
        autosizeCodeArea();
      }
      if (embedFrame && BOOKING_PATH) {
        embedFrame.src = buildPreviewUrl();
      }
    });
  });

  // Init code + hauteur
  if (codeArea) {
    codeArea.value = buildIframeCode();
    autosizeCodeArea();
  }
  if (embedFrame) embedFrame.style.height = '800px';

  if (iframeCopyBtn) {
    iframeCopyBtn.addEventListener('click', function () { copyText(buildIframeCode(), iframeCopyBtn); });
  }

  /* ── Personnalisation embed : titre + police ─────────────────── */
  var embedTitleInput      = document.getElementById('czEmbedTitle');
  var embedFontUrlInput    = document.getElementById('czEmbedFontUrl');
  var embedFontFamilyInput = document.getElementById('czEmbedFontFamily');
  var embedCustomSaveBtn   = document.getElementById('czEmbedCustomSave');
  var embedCustomStatus    = document.getElementById('czEmbedCustomStatus');

  if (embedCustomSaveBtn) {
    embedCustomSaveBtn.addEventListener('click', function () {
      var payload = {
        embedTitle:      embedTitleInput      ? embedTitleInput.value.trim()      : '',
        embedFontUrl:    embedFontUrlInput    ? embedFontUrlInput.value.trim()    : '',
        embedFontFamily: embedFontFamilyInput ? embedFontFamilyInput.value.trim() : '',
      };
      embedCustomSaveBtn.disabled = true;
      fetch('/account/embed-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          embedCustomSaveBtn.disabled = false;
          if (data && data.success) {
            if (embedCustomStatus) {
              embedCustomStatus.textContent = 'Enregistré ✓';
              embedCustomStatus.classList.add('is-visible');
              setTimeout(function () { embedCustomStatus.classList.remove('is-visible'); }, 2000);
            }
            // Recharger l'aperçu pour refléter le nouveau titre/police
            if (embedFrame && BOOKING_PATH) {
              embedFrame.src = buildPreviewUrl();
            }
          } else if (embedCustomStatus) {
            embedCustomStatus.textContent = 'Erreur lors de l\'enregistrement';
            embedCustomStatus.style.color = '#ef4444';
            embedCustomStatus.classList.add('is-visible');
          }
        })
        .catch(function () {
          embedCustomSaveBtn.disabled = false;
          if (embedCustomStatus) {
            embedCustomStatus.textContent = 'Erreur réseau';
            embedCustomStatus.style.color = '#ef4444';
            embedCustomStatus.classList.add('is-visible');
          }
        });
    });
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

  // Affiche l'aperçu disponibilité dès le chargement, sans attendre l'iframe.
  updateDayPreviewSwatch();

})();
