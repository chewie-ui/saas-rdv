// Joli popup de confirmation (remplace window.confirm)
window.confirmModal = function (title, desc) {
  return new Promise((resolve) => {
    const existing = document.getElementById("__confirmModal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "__confirmModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
      <style>
        @keyframes __cmSlideIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
        #__confirmModal .cm{background:#fff;border-radius:20px;max-width:420px;width:100%;box-shadow:0 24px 48px -8px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;animation:__cmSlideIn .18s cubic-bezier(.34,1.4,.64,1)}
        #__confirmModal .cm__head{padding:24px 24px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        #__confirmModal .cm__icon-wrap{width:44px;height:44px;border-radius:50%;background:#fef2f2;border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        #__confirmModal .cm__icon-wrap svg{stroke:#dc2626}
        #__confirmModal .cm__close{background:none;border:none;cursor:pointer;color:#9ca3af;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;padding:0}
        #__confirmModal .cm__close:hover{background:#f3f4f6;color:#111}
        #__confirmModal .cm__body{padding:16px 24px 0;display:flex;flex-direction:column;gap:6px}
        #__confirmModal .cm__title{font-size:17px;font-weight:700;color:#111;margin:0}
        #__confirmModal .cm__desc{font-size:13.5px;color:#6b7280;line-height:1.55;margin:0;white-space:pre-line}
        #__confirmModal .cm__actions{padding:20px 24px 24px;display:flex;gap:8px;justify-content:flex-end}
        #__confirmModal .cm__cancel{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border-radius:10px;font-size:13.5px;font-weight:600;background:#f3f4f6;border:1px solid #e5e7eb;color:#4b5563;cursor:pointer;font-family:inherit;transition:background .15s}
        #__confirmModal .cm__cancel:hover{background:#e9eaec}
        #__confirmModal .cm__confirm{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 20px;border-radius:10px;font-size:13.5px;font-weight:700;background:#dc2626;border:none;color:#fff;cursor:pointer;font-family:inherit;box-shadow:0 1px 3px rgba(220,38,38,.3);transition:background .15s}
        #__confirmModal .cm__confirm:hover{background:#b91c1c}
      </style>
      <div class="cm">
        <div class="cm__head">
          <div class="cm__icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
          </div>
          <button class="cm__close" aria-label="Fermer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="cm__body">
          <p class="cm__title"></p>
          <p class="cm__desc"></p>
        </div>
        <div class="cm__actions">
          <button class="cm__cancel">Annuler</button>
          <button class="cm__confirm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>Supprimer</button>
        </div>
      </div>`;

    overlay.querySelector(".cm__title").textContent = title || "Confirmer la suppression";
    overlay.querySelector(".cm__desc").textContent = desc || "Cette action est irréversible.";

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
