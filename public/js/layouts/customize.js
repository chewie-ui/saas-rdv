// ── Page "Personnaliser" : profil établissement + éditeur "À propos" ─────────
(function () {

  // ════════════════════════════════════════════════════════════════════════
  // 1. Carte "Profil de l'établissement" — bouton Enregistrer
  // ════════════════════════════════════════════════════════════════════════
  const saveBusinessBtn = document.getElementById("saveBusinessInfo");
  const businessNameInput = document.getElementById("businessNameInput");
  const businessTypeInput = document.getElementById("businessTypeInput");
  const descriptionInput  = document.getElementById("descriptionCoach");
  const descCount         = document.getElementById("descCount");

  function flashButton(btn, label, ok) {
    if (!btn) return;
    const span = btn.querySelector("span");
    if (!span) return;
    const orig = span.textContent;
    span.textContent = label;
    btn.classList.toggle("is-error", !ok);
    setTimeout(function () {
      span.textContent = orig;
      btn.classList.remove("is-error");
    }, 2000);
  }

  // Compteur de caractères en direct pour la description courte
  if (descriptionInput && descCount) {
    descCount.textContent = descriptionInput.value.length + "/500";
    descriptionInput.addEventListener("input", function () {
      descCount.textContent = descriptionInput.value.length + "/500";
    });
  }

  if (saveBusinessBtn) {
    saveBusinessBtn.addEventListener("click", async function () {
      saveBusinessBtn.disabled = true;
      try {
        const res = await fetch("/account/business-info", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessName: businessNameInput ? businessNameInput.value.trim() : "",
            description:  descriptionInput  ? descriptionInput.value.trim()  : "",
            businessType: businessTypeInput ? businessTypeInput.value.trim() : "",
          }),
        });
        const data = await res.json();
        flashButton(saveBusinessBtn, data.success ? "✓ Enregistré" : "Erreur", !!data.success);
      } catch (e) {
        flashButton(saveBusinessBtn, "Erreur", false);
      } finally {
        saveBusinessBtn.disabled = false;
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. Carte "À propos" — mini éditeur WYSIWYG (gras / italique / taille)
  // ════════════════════════════════════════════════════════════════════════
  const editor   = document.getElementById("aboutEditor");
  const counter  = document.getElementById("aboutCount");
  const status   = document.getElementById("aboutStatus");
  const saveBtn  = document.getElementById("saveAboutBtn");
  const MAX_LEN  = 4000;
  const MIN_SIZE = 11;
  const MAX_SIZE = 32;
  const STEP     = 2;

  if (editor) {
    function updateCounter() {
      if (!counter) return;
      const len = (editor.textContent || "").length;
      counter.textContent = len + "/" + MAX_LEN;
      counter.classList.toggle("is-over", len > MAX_LEN);
    }

    function refreshToolbarState() {
      [
        ["aboutBoldBtn", "bold"],
        ["aboutItalicBtn", "italic"],
        ["aboutUnderlineBtn", "underline"],
      ].forEach(function (pair) {
        const btn = document.getElementById(pair[0]);
        if (!btn) return;
        let active = false;
        try { active = document.queryCommandState(pair[1]); } catch (_) {}
        btn.classList.toggle("is-active", !!active);
      });
    }

    updateCounter();

    editor.addEventListener("input", function () {
      updateCounter();
      refreshToolbarState();
    });
    editor.addEventListener("keyup", refreshToolbarState);
    editor.addEventListener("mouseup", refreshToolbarState);
    editor.addEventListener("focus", refreshToolbarState);

    // ── Gras / Italique / Souligné via execCommand (mini WYSIWYG classique) ──
    [
      ["aboutBoldBtn", "bold"],
      ["aboutItalicBtn", "italic"],
      ["aboutUnderlineBtn", "underline"],
    ].forEach(function (pair) {
      const btn = document.getElementById(pair[0]);
      if (!btn) return;
      btn.addEventListener("mousedown", function (e) {
        // empêche la perte de la sélection dans l'éditeur au clic du bouton
        e.preventDefault();
      });
      btn.addEventListener("click", function () {
        editor.focus();
        try { document.execCommand(pair[1]); } catch (_) {}
        updateCounter();
        refreshToolbarState();
      });
    });

    // ── Agrandir / réduire la taille du texte sélectionné ─────────────────
    function currentFontSize(node) {
      let el = node && node.nodeType === 3 ? node.parentElement : node;
      if (!el || !editor.contains(el)) el = editor;
      const size = parseInt(window.getComputedStyle(el).fontSize, 10);
      return Number.isNaN(size) ? 14 : size;
    }

    function wrapSelectionWithSize(delta) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;

      const base = currentFontSize(range.startContainer);
      const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, base + delta));

      const span = document.createElement("span");
      span.style.fontSize = next + "px";

      try {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      } catch (_) {
        return;
      }

      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);

      updateCounter();
    }

    const sizeUpBtn   = document.getElementById("aboutSizeUpBtn");
    const sizeDownBtn = document.getElementById("aboutSizeDownBtn");
    [
      [sizeUpBtn, STEP],
      [sizeDownBtn, -STEP],
    ].forEach(function (pair) {
      const btn = pair[0];
      if (!btn) return;
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function () {
        editor.focus();
        wrapSelectionWithSize(pair[1]);
      });
    });

    // ── Sauvegarde ────────────────────────────────────────────────────────
    if (saveBtn) {
      saveBtn.addEventListener("click", async function () {
        saveBtn.disabled = true;
        try {
          const res = await fetch("/account/about", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aboutHtml: editor.innerHTML }),
          });
          const data = await res.json();
          if (status) {
            status.textContent = data.success ? "✓ Enregistré" : "Une erreur est survenue";
            status.classList.add("is-visible");
            setTimeout(function () { status.classList.remove("is-visible"); }, 2200);
          }
          if (data.success && typeof data.aboutHtml === "string") {
            // Le HTML peut avoir été nettoyé côté serveur — on resynchronise
            editor.innerHTML = data.aboutHtml;
            updateCounter();
          }
        } catch (e) {
          if (status) {
            status.textContent = "Une erreur est survenue";
            status.classList.add("is-visible");
            setTimeout(function () { status.classList.remove("is-visible"); }, 2200);
          }
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }
})();
