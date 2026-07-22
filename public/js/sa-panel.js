/* Comportements communs à toutes les pages du panel superadmin :
   pastilles de la barre latérale, menus « ⋮ », toast, confirmation. */
(function () {
  "use strict";

  // ── Pastilles (signalements à traiter, messages support non lus) ──────────
  function pastille(id, url, champ) {
    var el = document.getElementById(id);
    if (!el) return;
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var n = d[champ] || 0;
        if (n > 0) { el.textContent = n > 99 ? "99+" : n; el.style.display = ""; }
        else { el.style.display = "none"; }
      })
      .catch(function () {});
  }
  function rafraichirPastilles() {
    pastille("saReportBadge", "/superadmin/signalements-count", "pending");
    pastille("saChatBadge", "/superadmin/support-chat-unread-total", "unread");
  }
  rafraichirPastilles();
  setInterval(rafraichirPastilles, 60000);

  // ── Message de confirmation en bas d'écran ────────────────────────────────
  window.saToast = function (texte, type) {
    var t = document.getElementById("saToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "saToast";
      t.className = "sa-toast";
      document.body.appendChild(t);
    }
    t.textContent = texte;
    t.style.color = type === "err" ? "#fca5a5" : "";
    t.classList.add("is-on");
    clearTimeout(t._minuteur);
    t._minuteur = setTimeout(function () { t.classList.remove("is-on"); }, 2800);
  };

  // ── Menus « ⋮ » : un seul ouvert à la fois ────────────────────────────────
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-sa-menu]");
    var ouverts = document.querySelectorAll(".sa-menu.is-open");
    if (!btn) {
      ouverts.forEach(function (m) { m.classList.remove("is-open"); });
      return;
    }
    e.stopPropagation();
    var menu = btn.closest(".sa-menu");
    var etaitOuvert = menu.classList.contains("is-open");
    ouverts.forEach(function (m) { m.classList.remove("is-open"); });
    if (!etaitOuvert) menu.classList.add("is-open");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".sa-menu.is-open").forEach(function (m) { m.classList.remove("is-open"); });
  });

  // ── Barre latérale sur mobile ─────────────────────────────────────────────
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-sa-burger]")) {
      var side = document.getElementById("saSide");
      if (side) side.classList.toggle("is-open");
    }
  });
})();
