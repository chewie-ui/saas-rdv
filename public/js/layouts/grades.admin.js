/* Page Grades — tableau (design commun) + modale d'édition des permissions. */
(function () {
  "use strict";

  var ctx       = window.__gradesCtx || {};
  var companyId = ctx.companyId;
  var canManage = !!ctx.canManage;
  var editingId = null;

  // ── Menus « ⋮ » ─────────────────────────────────────────────────────────
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-gr-menu]");
    var ouverts = document.querySelectorAll(".ds-menu.is-open");
    if (!btn) { ouverts.forEach(function (m) { m.classList.remove("is-open"); }); return; }
    e.stopPropagation();
    var menu = btn.closest(".ds-menu");
    var etait = menu.classList.contains("is-open");
    ouverts.forEach(function (m) { m.classList.remove("is-open"); });
    if (!etait) menu.classList.add("is-open");
  });

  // ── Helpers niveau de zone (identiques à l'ancien éditeur) ───────────────
  function computeZoneLevel(zoneCard) {
    var viewInput = zoneCard.querySelector('input[data-key="view"]');
    var manageInputs = Array.prototype.filter.call(
      zoneCard.querySelectorAll('input[type="checkbox"]'),
      function (i) { return i.dataset.key !== "view"; }
    );
    var viewChecked = viewInput && viewInput.checked;
    var anyManage = manageInputs.some(function (i) { return i.checked; });
    if (viewChecked && anyManage) return "manage";
    if (viewChecked) return "view";
    if (anyManage) return "manage";
    return "none";
  }
  function setZoneLevel(zoneCard, level) {
    var viewInput = zoneCard.querySelector('input[data-key="view"]');
    var manageInputs = Array.prototype.filter.call(
      zoneCard.querySelectorAll('input[type="checkbox"]'),
      function (i) { return i.dataset.key !== "view"; }
    );
    var optsEl = zoneCard.querySelector(".grade-perm-zone-card__manage-opts");
    zoneCard.querySelectorAll(".grade-perm-level-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.level === level);
    });
    if (level === "none") {
      if (viewInput) viewInput.checked = false;
      manageInputs.forEach(function (i) { i.checked = false; });
      if (optsEl) optsEl.style.display = "none";
    } else if (level === "view") {
      if (viewInput) viewInput.checked = true;
      manageInputs.forEach(function (i) { i.checked = false; });
      if (optsEl) optsEl.style.display = "none";
    } else if (level === "manage") {
      if (viewInput) viewInput.checked = true;
      if (optsEl) {
        optsEl.style.display = "";
        if (!manageInputs.some(function (i) { return i.checked; })) {
          manageInputs.forEach(function (i) { i.checked = true; });
        }
      } else {
        manageInputs.forEach(function (i) { i.checked = true; });
      }
    }
  }
  function getZoneMaxLevel(zoneCard) {
    if (zoneCard.querySelector('[data-level="manage"]')) return "manage";
    if (zoneCard.querySelector('[data-level="view"]')) return "view";
    return "none";
  }
  function updateGroupCheckAllLabel(groupEl) {
    var btn = groupEl && groupEl.querySelector(".grade-perm-group__check-all");
    if (!btn) return;
    var zones = btn.dataset.group.split(",");
    var allMax = zones.every(function (z) {
      var card = groupEl.querySelector('.grade-perm-zone-card[data-zone="' + z + '"]');
      return !card || computeZoneLevel(card) === getZoneMaxLevel(card);
    });
    btn.textContent = allMax ? "Tout désactiver" : "Tout activer";
  }

  document.querySelectorAll("#gradePermissionsList .grade-perm-zone-card").forEach(function (zoneCard) {
    zoneCard.querySelectorAll(".grade-perm-level-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!canManage) return;
        setZoneLevel(zoneCard, btn.dataset.level);
        updateGroupCheckAllLabel(zoneCard.closest(".grade-perm-group"));
      });
    });
  });
  document.querySelectorAll(".grade-perm-group__check-all").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!canManage) return;
      var groupEl = btn.closest(".grade-perm-group");
      var zones = btn.dataset.group.split(",");
      var allMax = zones.every(function (z) {
        var card = groupEl.querySelector('.grade-perm-zone-card[data-zone="' + z + '"]');
        return !card || computeZoneLevel(card) === getZoneMaxLevel(card);
      });
      zones.forEach(function (z) {
        var card = groupEl.querySelector('.grade-perm-zone-card[data-zone="' + z + '"]');
        if (card) setZoneLevel(card, allMax ? "none" : getZoneMaxLevel(card));
      });
      updateGroupCheckAllLabel(groupEl);
    });
  });

  function setGradeCheckboxes(perms) {
    document.querySelectorAll("#gradePermissionsList input[type=checkbox]").forEach(function (cb) {
      var zone = cb.dataset.zone, key = cb.dataset.key;
      cb.checked = !!(perms && perms[zone] && perms[zone][key]);
    });
    document.querySelectorAll("#gradePermissionsList .grade-perm-zone-card").forEach(function (zoneCard) {
      var level = computeZoneLevel(zoneCard);
      var optsEl = zoneCard.querySelector(".grade-perm-zone-card__manage-opts");
      zoneCard.querySelectorAll(".grade-perm-level-btn").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.dataset.level === level);
      });
      if (optsEl) optsEl.style.display = level === "manage" ? "" : "none";
    });
    document.querySelectorAll(".grade-perm-group").forEach(function (g) { updateGroupCheckAllLabel(g); });
  }

  // Lecture seule si l'utilisateur n'a que grades.view
  if (!canManage) {
    document.querySelectorAll("#gradePermissionsList .grade-perm-level-btn").forEach(function (b) {
      b.style.pointerEvents = "none"; b.style.opacity = "0.85";
    });
    document.querySelectorAll(".grade-perm-group__check-all").forEach(function (b) { b.style.display = "none"; });
  }

  // ── Modale d'édition ──────────────────────────────────────────────────────
  var overlay     = document.getElementById("gradeOverlay");
  var editorTitle = document.getElementById("gradeEditorTitle");
  var nameInput   = document.getElementById("gradeNameInput");
  var gradeError  = document.getElementById("gradeError");
  var saveBtn     = document.getElementById("gradeSaveBtn");

  function openEditor(id, name, perms) {
    editingId = id || null;
    editorTitle.textContent = id ? "Modifier le grade — " + name : "Nouveau grade";
    nameInput.value = name || "";
    setGradeCheckboxes(perms || null);
    gradeError.style.display = "none";
    nameInput.readOnly = !canManage;
    saveBtn.style.display = canManage ? "" : "none";
    overlay.style.display = "flex";
    setTimeout(function () { if (canManage) nameInput.focus(); }, 40);
  }
  function closeEditor() { overlay.style.display = "none"; editingId = null; }

  document.querySelectorAll(".gr-row").forEach(function (row) {
    row.addEventListener("click", function (e) {
      if (e.target.closest(".ds-menu")) return; // clic sur le menu ⋮
      openEditor(row.dataset.id, row.dataset.name, JSON.parse(row.dataset.permissions || "{}"));
    });
    var edit = row.querySelector(".js-edit");
    if (edit) edit.addEventListener("click", function (e) {
      e.stopPropagation();
      row.closest(".ds-menu").classList.remove("is-open");
      openEditor(row.dataset.id, row.dataset.name, JSON.parse(row.dataset.permissions || "{}"));
    });
  });

  ["createGradeBtn", "createGradeBtn2"].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener("click", function () { openEditor(null, "", null); });
  });
  document.getElementById("gradeCancelBtn").addEventListener("click", closeEditor);
  document.getElementById("gradeCloseBtn").addEventListener("click", closeEditor);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeEditor(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay.style.display === "flex") closeEditor(); });

  // ── Enregistrer ───────────────────────────────────────────────────────────
  saveBtn.addEventListener("click", function () {
    var name = nameInput.value.trim();
    if (!name) { gradeError.textContent = "Le nom du grade est requis."; gradeError.style.display = "block"; return; }
    var perms = {};
    document.querySelectorAll("#gradePermissionsList input[type=checkbox]").forEach(function (cb) {
      var zone = cb.dataset.zone, key = cb.dataset.key;
      perms[zone] = perms[zone] || {};
      perms[zone][key] = cb.checked;
    });
    var base = "/account/establishments/" + companyId + "/grades";
    var url = editingId ? base + "/" + editingId : base;
    saveBtn.disabled = true;
    fetch(url, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, permissions: perms }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        saveBtn.disabled = false;
        if (d.success) window.location.reload();
        else { gradeError.textContent = d.error || "Erreur."; gradeError.style.display = "block"; }
      })
      .catch(function () { saveBtn.disabled = false; gradeError.textContent = "Erreur réseau."; gradeError.style.display = "block"; });
  });

  // ── Suppression ──────────────────────────────────────────────────────────
  var deleteOverlay   = document.getElementById("deleteGradeOverlay");
  var deleteInfo      = document.getElementById("deleteGradeInfo");
  var deleteField     = document.getElementById("deleteGradeReassignField");
  var deleteSelect    = document.getElementById("deleteGradeReassignSelect");
  var deleteError     = document.getElementById("deleteGradeError");
  var deleteConfirmBtn = document.getElementById("deleteGradeConfirm");
  var deleteTargetId  = null;

  document.querySelectorAll(".js-delete-grade").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      btn.closest(".ds-menu").classList.remove("is-open");
      deleteTargetId = btn.dataset.id;
      deleteInfo.textContent = 'Vous êtes sur le point de supprimer le grade « ' + btn.dataset.name + ' ».';
      deleteField.style.display = "none";
      deleteError.style.display = "none";
      Array.prototype.forEach.call(deleteSelect.options, function (opt) {
        opt.style.display = opt.value === deleteTargetId ? "none" : "";
      });
      deleteOverlay.style.display = "flex";
    });
  });
  document.getElementById("deleteGradeClose").addEventListener("click", function () {
    deleteOverlay.style.display = "none"; deleteTargetId = null;
  });
  deleteConfirmBtn.addEventListener("click", function () {
    if (!deleteTargetId) return;
    deleteConfirmBtn.disabled = true;
    fetch("/account/establishments/" + companyId + "/grades/" + deleteTargetId, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reassignToGradeId: deleteField.style.display === "block" ? deleteSelect.value : null }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        deleteConfirmBtn.disabled = false;
        if (d.success) { window.location.reload(); return; }
        if (d.error === "grade_in_use") { deleteInfo.textContent = d.message; deleteField.style.display = "block"; }
        else { deleteError.textContent = d.error || "Erreur."; deleteError.style.display = "block"; }
      })
      .catch(function () { deleteConfirmBtn.disabled = false; deleteError.textContent = "Erreur réseau."; deleteError.style.display = "block"; });
  });
})();
