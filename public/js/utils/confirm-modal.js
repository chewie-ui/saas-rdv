// Composant partagé pour toutes les popups (confirmation / alerte / contenu
// personnalisé), pour ne plus avoir à réimplémenter l'overlay + CSS + fermeture
// (clic dehors / Échap / croix) dans chaque page.
function __buildModalShell(opts) {
  const existing = document.getElementById("__confirmModal");
  if (existing) existing.remove();

  const danger = opts.danger !== false;
  const iconName = opts.icon || (danger ? "delete" : "info");
  const iconBg = danger ? "#fef2f2" : "#eff6ff";
  const iconBorder = danger ? "#fecaca" : "#bfdbfe";
  const iconColor = danger ? "#dc2626" : "#2563eb";
  const confirmBg = danger ? "#dc2626" : "#2563eb";
  const confirmBgHover = danger ? "#b91c1c" : "#1d4ed8";
  const confirmShadow = danger ? "rgba(220,38,38,.3)" : "rgba(37,99,235,.3)";
  const maxWidth = opts.maxWidth || "420px";

  const overlay = document.createElement("div");
  overlay.id = "__confirmModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;";
  overlay.innerHTML = `
    <style>
      @keyframes __cmSlideIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      #__confirmModal .cm{background:#fff;border-radius:20px;max-width:${maxWidth};width:100%;max-height:80vh;box-shadow:0 24px 48px -8px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;animation:__cmSlideIn .18s cubic-bezier(.34,1.4,.64,1)}
      #__confirmModal .cm__head{padding:24px 24px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      #__confirmModal .cm__icon-wrap{width:44px;height:44px;border-radius:50%;background:${iconBg};border:1px solid ${iconBorder};display:flex;align-items:center;justify-content:center;flex-shrink:0}
      #__confirmModal .cm__icon-wrap .material-symbols-outlined{font-size:22px;color:${iconColor}}
      #__confirmModal .cm__close{background:none;border:none;cursor:pointer;color:#9ca3af;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;padding:0}
      #__confirmModal .cm__close .material-symbols-outlined{font-size:18px}
      #__confirmModal .cm__close:hover{background:#f3f4f6;color:#111}
      #__confirmModal .cm__body{padding:16px 24px 24px;display:flex;flex-direction:column;gap:6px;overflow-y:auto}
      #__confirmModal .cm__body:has(+ .cm__actions){padding-bottom:0}
      #__confirmModal .cm__title{font-size:17px;font-weight:700;color:#111;margin:0}
      #__confirmModal .cm__desc{font-size:13.5px;color:#6b7280;line-height:1.55;margin:0;white-space:pre-line}
      #__confirmModal .cm__actions{padding:20px 24px 24px;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}
      #__confirmModal .cm__cancel{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border-radius:10px;font-size:13.5px;font-weight:600;background:#f3f4f6;border:1px solid #e5e7eb;color:#4b5563;cursor:pointer;font-family:inherit;transition:background .15s}
      #__confirmModal .cm__cancel:hover{background:#e9eaec}
      #__confirmModal .cm__confirm{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 20px;border-radius:10px;font-size:13.5px;font-weight:700;background:${confirmBg};border:none;color:#fff;cursor:pointer;font-family:inherit;box-shadow:0 1px 3px ${confirmShadow};transition:background .15s}
      #__confirmModal .cm__confirm:hover{background:${confirmBgHover}}
      #__confirmModal .cm__confirm.loading{opacity:.6;cursor:wait;pointer-events:none}
      #__confirmModal .cm__confirm .material-symbols-outlined{font-size:16px}
    </style>
    <div class="cm">
      <div class="cm__head">
        ${opts.noIcon ? "" : `<div class="cm__icon-wrap"><span class="material-symbols-outlined">${iconName}</span></div>`}
        <button class="cm__close" aria-label="Fermer"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="cm__body">
        ${opts.hasText ? `<p class="cm__title"></p><p class="cm__desc"></p>` : ""}
        ${opts.bodyHtml || ""}
      </div>
      ${opts.noActions ? "" : `
      <div class="cm__actions">
        ${opts.alertOnly ? "" : `<button class="cm__cancel">${opts.cancelLabel || "Annuler"}</button>`}
        <button class="cm__confirm">${opts.confirmIcon === false ? "" : `<span class="material-symbols-outlined">${iconName}</span>`}${opts.confirmLabel || "Confirmer"}</button>
      </div>`}
    </div>`;

  if (opts.hasText) {
    overlay.querySelector(".cm__title").textContent = opts.title || "";
    overlay.querySelector(".cm__desc").textContent = opts.desc || "";
  }

  return overlay;
}

// window.confirmModal(title, desc, opts?) — popup de confirmation.
// Compatible avec les appels existants confirmModal(title, desc) (delete/danger
// par défaut) ; opts permet de personnaliser labels/icône/couleur.
window.confirmModal = function (title, desc, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const overlay = __buildModalShell({
      title,
      desc,
      hasText: true,
      confirmLabel: opts.confirmLabel || "Supprimer",
      cancelLabel: opts.cancelLabel,
      danger: opts.danger !== undefined ? opts.danger : true,
      icon: opts.icon,
    });

    function close(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") close(false);
    }

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    overlay.querySelector(".cm__close").addEventListener("click", () => close(false));
    overlay.querySelector(".cm__cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".cm__confirm").addEventListener("click", () => close(true));

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
  });
};

// window.alertModal(desc, title?, opts?) — popup d'information/erreur (remplace alert()).
window.alertModal = function (desc, title, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const overlay = __buildModalShell({
      title: title || "Information",
      desc,
      hasText: true,
      confirmLabel: opts.confirmLabel || "OK",
      danger: opts.danger || false,
      icon: opts.icon,
      alertOnly: true,
      confirmIcon: false,
    });

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".cm__close").addEventListener("click", close);
    overlay.querySelector(".cm__confirm").addEventListener("click", close);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
  });
};

// window.confirmDelete({url, method, title, desc, confirmLabel, cancelLabel,
// errorMessage, networkErrorMessage}) — confirmation + fetch + alerte d'erreur
// intégrés. Retourne {success, data} ou {success:false, cancelled:true}.
window.confirmDelete = async function (opts) {
  const confirmed = await window.confirmModal(opts.title, opts.desc, {
    confirmLabel: opts.confirmLabel,
    cancelLabel: opts.cancelLabel,
    danger: true,
  });
  if (!confirmed) return { success: false, cancelled: true };
  try {
    const res = await fetch(opts.url, { method: opts.method || "DELETE" });
    const data = await res.json();
    if (!data.success) {
      await window.alertModal(data.message || data.error || opts.errorMessage || "Une erreur est survenue.");
    }
    return { success: !!data.success, data };
  } catch (e) {
    await window.alertModal(opts.networkErrorMessage || "Erreur réseau.");
    return { success: false, error: e };
  }
};

// window.showModal({title, desc, bodyHtml, maxWidth}) — dialogue à contenu
// personnalisé (ex: liste dynamique), sans boutons d'action ; l'appelant gère
// sa propre logique et peut mettre à jour `.cm__body` du retour au besoin.
window.showModal = function (opts) {
  const overlay = __buildModalShell({
    title: opts.title,
    desc: opts.desc,
    hasText: !!(opts.title || opts.desc),
    bodyHtml: opts.bodyHtml,
    maxWidth: opts.maxWidth,
    noIcon: true,
    noActions: true,
  });

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".cm__close").addEventListener("click", () => overlay.remove());
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
  });

  document.body.appendChild(overlay);
  return overlay;
};
