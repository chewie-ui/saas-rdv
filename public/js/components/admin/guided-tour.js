/* ════════════════════════════════════════════════════════════════════════
   Visite guidée — met en évidence (spotlight) un élément réel de la page et
   affiche une bulle d'explication, en pilotant l'utilisateur à travers
   plusieurs pages admin. Plusieurs visites nommées (onboarding, employés,
   cours collectifs, congés, disponibilités, paramètres...) cohabitent dans
   le même moteur — cf. window.BkTour.start(nomDuTour).
   État persisté en localStorage pour survivre à la navigation entre pages.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var STORAGE_ACTIVE = "bk_tour_active";
  var STORAGE_NAME = "bk_tour_name";
  var STORAGE_STEP = "bk_tour_step";
  var DEFAULT_TOUR = "onboarding";

  function $(sel, root) { return (root || document).querySelector(sel); }

  function firstDayRow() { return $(".row-weekday"); }

  function isVisible(el) {
    if (!el) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // Beaucoup de formulaires admin vivent dans une modale présente dans le DOM
  // mais masquée jusqu'à l'ajout d'une classe "show" par le JS de la page —
  // si l'utilisateur arrive sur l'étape via "Suivant" sans avoir cliqué le
  // vrai déclencheur, on l'ouvre nous-même pour rester cohérent.
  function ensureModalOpen(modalSel, triggerSel) {
    return function () {
      var modal = $(modalSel);
      if (modal && !modal.classList.contains("show")) {
        var btn = $(triggerSel);
        if (btn) btn.click();
      }
    };
  }

  var TOURS = {
    // ── Visite d'accueil (depuis /welcome) ────────────────────────────────
    onboarding: [
      {
        page: "/availability",
        find: function () {
          var row = firstDayRow();
          return row && row.querySelector("input.input-weekday");
        },
        title: "Activez vos jours d'ouverture",
        text: "Ce bouton active ou désactive un jour. Cliquez-le pour tester — vos clients ne pourront réserver que sur les jours activés.",
        placement: "right",
        advanceOnEvent: "change",
      },
      {
        page: "/availability",
        find: function () {
          var row = firstDayRow();
          return row && row.querySelector('[data-hours="start"]');
        },
        title: "Réglez les horaires",
        text: "Cliquez ici pour changer l'heure de début de ce jour (et son heure de fin juste à côté).",
        placement: "right",
      },
      {
        page: "/services",
        find: function () { return $("#addServiceBtn"); },
        title: "Ajoutez votre premier service",
        text: "Cliquez ici pour créer un service — une coupe, un massage, une consultation... ce que vous proposez à vos clients.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/services",
        preStep: ensureModalOpen("#serviceModal", "#addServiceBtn"),
        find: function () { return $("#serviceModalName"); },
        title: "Donnez-lui un nom",
        text: "Indiquez le nom de ce service, par exemple «Coupe homme».",
        placement: "bottom",
      },
      {
        page: "/services",
        preStep: ensureModalOpen("#serviceModal", "#addServiceBtn"),
        find: function () { return $("#saveServiceBtn"); },
        title: "Enregistrez",
        text: "Cliquez ici pour enregistrer votre service.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 400,
      },
      {
        page: "/customize-calendar",
        preStep: function () {
          var tab = $("#czTabDesign");
          var panel = $("#czPanelDesign");
          if (tab && panel && panel.style.display === "none") tab.click();
        },
        find: function () { return $(".cz-color-picker__swatch"); },
        title: "Personnalisez votre couleur",
        text: "Cliquez ici pour choisir la couleur principale de votre page de réservation — celle que verront vos clients.",
        placement: "bottom",
        isLast: true,
      },
    ],

    // ── Assistance : créer un employé ─────────────────────────────────────
    employee: [
      {
        page: "/employees",
        find: function () { return $("#addEmpBtn"); },
        title: "Ajoutez un employé",
        text: "Cliquez ici pour ajouter un membre de votre équipe — un coiffeur, un coach, une assistante... toute personne qui reçoit des clients ou vous aide au quotidien.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/employees",
        preStep: ensureModalOpen("#empModal", "#addEmpBtn"),
        find: function () { return $("#empModalFirstName"); },
        title: "Son prénom et son nom",
        text: "Indiquez son prénom ici (par exemple « Marie »), puis son nom dans le champ juste à côté (par exemple « Dupont »). Vous pouvez aussi ajouter une photo en haut, son âge, et une courte description (spécialités, expérience...) — ces champs sont optionnels.",
        placement: "bottom",
      },
      {
        page: "/employees",
        preStep: ensureModalOpen("#empModal", "#addEmpBtn"),
        find: function () { return $("#saveEmpBtn"); },
        title: "Enregistrez",
        text: "Cliquez ici pour l'ajouter à votre équipe. Vous pourrez ensuite lui assigner des services et régler ses propres disponibilités depuis sa fiche.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 400,
        isLast: true,
      },
    ],

    // ── Assistance : créer un cours collectif ─────────────────────────────
    groupSessions: [
      {
        page: "/group-sessions",
        find: function () { return $("#addCourseBtn"); },
        title: "Créez un cours collectif",
        text: "Cliquez ici pour créer un cours avec plusieurs participants en même temps (yoga, sport, atelier, cours de cuisine...) — à la différence d'un rendez-vous classique qui n'accueille qu'une personne.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/group-sessions",
        preStep: ensureModalOpen("#courseModal", "#addCourseBtn"),
        find: function () { return $("#courseName"); },
        title: "Nom et description",
        text: "Donnez un nom clair à votre cours, par exemple « Yoga débutant » ou « Atelier poterie ». Juste en dessous, le champ description vous permet de préciser le déroulement pour vos participants — par exemple « Cours adapté à tous les niveaux, tapis fournis sur place ».",
        placement: "bottom",
      },
      {
        page: "/group-sessions",
        preStep: ensureModalOpen("#courseModal", "#addCourseBtn"),
        find: function () { return $("#coursePrice"); },
        title: "Prix, durée et places",
        text: "Vous pouvez indiquer le prix par participant (ex: 15€), la durée en minutes (ex: 60) et le nombre de places disponibles (ex: 10). Le prix n'est pas obligatoire à afficher — laissez le champ vide si vous préférez le communiquer autrement à vos participants.",
        placement: "bottom",
      },
      {
        page: "/group-sessions",
        preStep: ensureModalOpen("#courseModal", "#addCourseBtn"),
        find: function () { return $("#courseLocation"); },
        title: "Lieu (si différent du vôtre)",
        text: "Si ce cours se déroule à une autre adresse que celle de votre établissement, notez-la ici — par exemple « Parc municipal, 12 rue des Lilas ». Si vous laissez ce champ vide, c'est votre adresse habituelle qui sera utilisée.",
        placement: "bottom",
      },
      {
        page: "/group-sessions",
        preStep: ensureModalOpen("#courseModal", "#addCourseBtn"),
        find: function () { return $("#courseModeOptions"); },
        title: "Récurrent ou dates ponctuelles ?",
        text: "Deux façons de planifier : « Cours récurrent » s'il revient chaque semaine aux mêmes jours et à la même heure — par exemple tous les lundis et mercredis à 18h00. Ou « Dates ponctuelles » si chaque séance a sa propre date — par exemple le 27 juin, puis le 30 juin — avec l'heure à indiquer pour chacune.",
        placement: "bottom",
      },
      {
        page: "/group-sessions",
        preStep: ensureModalOpen("#courseModal", "#addCourseBtn"),
        find: function () { return $("#saveCourseBtn"); },
        title: "Enregistrez",
        text: "Cliquez ici pour créer votre cours collectif. Il apparaîtra immédiatement sur votre page de réservation, ouvert aux inscriptions.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 400,
        isLast: true,
      },
    ],

    // ── Assistance : ajouter un congé ──────────────────────────────────────
    daysOff: [
      {
        page: "/availability",
        find: function () { return $("#addDaysOffBtn"); },
        title: "Ajoutez un congé",
        text: "Cliquez ici pour bloquer une date — vacances, jour férié, absence imprévue... Un calendrier va s'ouvrir pour choisir le jour concerné.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/availability",
        find: function () {
          var cal = $("#renderCalendar");
          if (!cal || !cal.classList.contains("show")) return null;
          return cal.querySelector(".avail-cal-cell.day");
        },
        title: "Choisissez le jour",
        text: "Cliquez sur le jour à bloquer — par exemple aujourd'hui, ou une date à venir comme le 14 juillet. Vous pouvez cliquer sur plusieurs jours à la suite si vous avez plusieurs dates à bloquer d'un coup, puis valider votre sélection.",
        placement: "right",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/availability",
        find: function () { return $("#multiDayOffConfirm"); },
        title: "Validez votre sélection",
        text: "Cliquez ici pour confirmer le ou les jours choisis.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 300,
      },
      {
        page: "/availability",
        find: function () { return $(".avail-doff-addtime"); },
        title: "Toute la journée, ou juste une plage horaire ?",
        text: "Par défaut, le jour choisi est bloqué en entier. Si vous voulez seulement fermer une partie de la journée — par exemple de 9h00 à 18h00 — et laisser le reste réservable, cliquez ici pour ajouter une plage horaire précise. Vous pouvez en ajouter plusieurs si besoin.",
        placement: "top",
        isLast: true,
      },
    ],

    // ── Assistance : disponibilités ────────────────────────────────────────
    availability: [
      {
        page: "/availability",
        find: function () {
          var row = firstDayRow();
          return row && row.querySelector("input.input-weekday");
        },
        title: "Activez vos jours d'ouverture",
        text: "Ce bouton active ou désactive un jour. Cliquez-le pour tester — vos clients ne pourront réserver que sur les jours activés.",
        placement: "right",
        advanceOnEvent: "change",
      },
      {
        page: "/availability",
        find: function () {
          var row = firstDayRow();
          return row && row.querySelector('[data-hours="start"]');
        },
        title: "Réglez les horaires",
        text: "Cliquez ici pour changer l'heure de début de ce jour (et son heure de fin juste à côté).",
        placement: "right",
        isLast: true,
      },
    ],

    // ── Assistance : changer les paramètres (nom, etc.) ────────────────────
    settings: [
      {
        page: "/settings",
        find: function () { return $("#fullname"); },
        title: "Votre profil personnel",
        text: "Modifiez votre nom complet ici. Juste à côté, vous pouvez changer votre photo de profil, votre numéro de téléphone, ou modifier votre adresse email.",
        placement: "bottom",
      },
      {
        page: "/settings",
        find: function () { return $("#saveChanges"); },
        title: "Enregistrez",
        text: "Cliquez ici pour sauvegarder vos modifications. Plus bas sur cette page, vous trouverez aussi votre établissement, votre mot de passe et la langue de l'interface.",
        placement: "top",
        isLast: true,
      },
    ],

    // ── Assistance : inviter un collaborateur ─────────────────────────────
    collaborators: [
      {
        page: function () { return "/etablissement/" + (window.__companyId || "") + "/collaborateurs"; },
        find: function () { return $("#inviteBtn"); },
        title: "Invitez un collaborateur",
        text: "Cliquez ici pour inviter un membre de votre équipe. La personne doit déjà avoir un compte BranShee — elle aura immédiatement accès à votre espace.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: function () { return "/etablissement/" + (window.__companyId || "") + "/collaborateurs"; },
        preStep: function () {
          var overlay = $("#inviteModalOverlay");
          if (overlay && overlay.style.display === "none") { var btn = $("#inviteBtn"); if (btn) btn.click(); }
        },
        find: function () { return $("#inviteEmailInput"); },
        title: "Adresse email",
        text: "Entrez l'adresse email du collaborateur à inviter — il doit déjà avoir un compte BranShee.",
        placement: "bottom",
      },
      {
        page: function () { return "/etablissement/" + (window.__companyId || "") + "/collaborateurs"; },
        preStep: function () {
          var overlay = $("#inviteModalOverlay");
          if (overlay && overlay.style.display === "none") { var btn = $("#inviteBtn"); if (btn) btn.click(); }
        },
        find: function () { return $("#inviteGradeInput"); },
        title: "Choisissez son grade",
        text: "Sélectionnez le grade à assigner — il définit les fonctionnalités auxquelles ce collaborateur aura accès. Vous pouvez le modifier à tout moment.",
        placement: "bottom",
      },
      {
        page: function () { return "/etablissement/" + (window.__companyId || "") + "/collaborateurs"; },
        preStep: function () {
          var overlay = $("#inviteModalOverlay");
          if (overlay && overlay.style.display === "none") { var btn = $("#inviteBtn"); if (btn) btn.click(); }
        },
        find: function () { return $("#inviteModalConfirm"); },
        title: "Envoyez l'invitation",
        text: "Cliquez ici pour envoyer l'invitation. Le collaborateur aura immédiatement accès à votre espace avec les droits du grade choisi.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 300,
        isLast: true,
      },
    ],

    // ── Assistance : créer un questionnaire ───────────────────────────────
    questionnaire: [
      {
        page: "/forms",
        find: function () { return $("#addQuestionBtn"); },
        title: "Créez votre questionnaire",
        text: "Cliquez ici pour ajouter une question à votre formulaire de réservation — vos clients y répondront avant de confirmer leur rendez-vous.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/forms",
        preStep: ensureModalOpen("#modalOverlay", "#addQuestionBtn"),
        find: function () { return $("#questionLabelInput"); },
        title: "Libellé de la question",
        text: "Tapez votre question ici, par exemple « Avez-vous des allergies ? » ou « Quel est votre objectif principal ? ».",
        placement: "bottom",
      },
      {
        page: "/forms",
        preStep: ensureModalOpen("#modalOverlay", "#addQuestionBtn"),
        find: function () { return $(".forms-type-selector"); },
        title: "Type de réponse",
        text: "Choisissez comment le client doit répondre : texte libre, oui/non, ou choix multiple. Sélectionnez le type qui correspond le mieux à votre question.",
        placement: "bottom",
      },
      {
        page: "/forms",
        preStep: ensureModalOpen("#modalOverlay", "#addQuestionBtn"),
        find: function () { return $("#confirmModalBtn"); },
        title: "Confirmez la question",
        text: "Cliquez ici pour ajouter la question à votre formulaire. Vous pouvez en ajouter plusieurs et les réordonner par glisser-déposer.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 300,
      },
      {
        page: "/forms",
        find: function () { return $("#saveFormBtn"); },
        title: "Sauvegardez le formulaire",
        text: "Cliquez ici pour enregistrer votre formulaire. Activez-le ensuite depuis le bouton en haut à droite pour qu'il soit présenté à vos clients lors de la réservation.",
        placement: "bottom",
        isLast: true,
      },
    ],

    // ── Assistance : créer un dossier client ──────────────────────────────
    clientDossier: [
      {
        page: "/clients",
        find: function () { return $("#clientsSearchInput"); },
        title: "Retrouvez un client",
        text: "Tapez le nom, l'email ou le téléphone d'un client pour le retrouver rapidement. Tous les clients ayant réservé apparaissent ici avec leur historique.",
        placement: "bottom",
      },
      {
        page: "/clients",
        find: function () { return $(".client-card"); },
        title: "Ouvrez un dossier client",
        text: "Cliquez sur un client pour accéder à son dossier complet — ses rendez-vous passés et à venir, ses informations de contact, et les notes que vous avez prises sur lui.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 400,
      },
      {
        page: "/clients",
        pageMatch: function (path) { return /^\/clients\/.+/.test(path); },
        find: function () { return $("#addEntryBtn"); },
        title: "Ajoutez une note",
        text: "Cliquez ici pour ajouter une note après la séance — observations, suivi, prochain objectif... Ces notes sont privées, visibles uniquement par vous et vos collaborateurs.",
        placement: "bottom",
        advanceOnEvent: "click",
        advanceDelay: 200,
      },
      {
        page: "/clients",
        pageMatch: function (path) { return /^\/clients\/.+/.test(path); },
        preStep: ensureModalOpen("#entryModal", "#addEntryBtn"),
        find: function () { return $("#entryModalNote"); },
        title: "Rédigez votre note",
        text: "Écrivez votre observation ou compte-rendu ici. Vous pouvez aussi ajouter une tâche à faire au prochain rendez-vous dans le champ en dessous.",
        placement: "top",
      },
      {
        page: "/clients",
        pageMatch: function (path) { return /^\/clients\/.+/.test(path); },
        preStep: ensureModalOpen("#entryModal", "#addEntryBtn"),
        find: function () { return $("#saveEntryBtn"); },
        title: "Enregistrez la note",
        text: "Cliquez ici pour sauvegarder. La note apparaîtra dans la chronologie du dossier, horodatée automatiquement.",
        placement: "top",
        advanceOnEvent: "click",
        advanceDelay: 300,
        isLast: true,
      },
    ],
  };

  // ── Fonctionnalités verrouillées par le plan ──────────────────────────────
  // Pas la peine de pointer un bouton que l'utilisateur ne peut pas utiliser
  // — on lui dit directement quel forfait débloque la fonctionnalité visée
  // par CE tour, avant même d'afficher la 1ère étape normale.
  var LOCK_CHECKS = {
    employee: function () {
      if (typeof window.__maxEmployees === "number" && window.__maxEmployees === 0) {
        return { message: "Ajouter des employés nécessite le plan Pro ou Business. Passez à un forfait supérieur pour débloquer cette fonctionnalité." };
      }
      return null;
    },
    groupSessions: function () {
      var btn = $("#addCourseBtn");
      if (btn && btn.disabled) {
        return { message: "Les cours collectifs ne sont pas inclus dans votre forfait actuel. Passez à un forfait supérieur pour les débloquer." };
      }
      return null;
    },
  };

  var state = { tourName: DEFAULT_TOUR, stepIndex: -1, pollTimer: null, target: null, advanceHandler: null };

  function currentSteps() { return TOURS[state.tourName] || TOURS[DEFAULT_TOUR]; }

  function isActive() { return localStorage.getItem(STORAGE_ACTIVE) === "1"; }
  function getTourName() { return localStorage.getItem(STORAGE_NAME) || DEFAULT_TOUR; }
  function getStepIndex() { return parseInt(localStorage.getItem(STORAGE_STEP) || "0", 10); }
  function setStepIndex(n) { localStorage.setItem(STORAGE_STEP, String(n)); }

  function stopTour() {
    localStorage.removeItem(STORAGE_ACTIVE);
    localStorage.removeItem(STORAGE_NAME);
    localStorage.removeItem(STORAGE_STEP);
    teardown();
  }

  function teardown() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    if (state.target && state.advanceHandler && state._evtName) {
      state.target.removeEventListener(state._evtName, state.advanceHandler);
    }
    var root = document.getElementById("bkTourRoot");
    if (root) root.remove();
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  }

  function buildRoot() {
    var root = document.createElement("div");
    root.id = "bkTourRoot";
    root.innerHTML =
      '<div class="bk-tour-mask" data-pos="top"></div>' +
      '<div class="bk-tour-mask" data-pos="bottom"></div>' +
      '<div class="bk-tour-mask" data-pos="left"></div>' +
      '<div class="bk-tour-mask" data-pos="right"></div>' +
      '<div class="bk-tour-ring"></div>' +
      '<div class="bk-tour-tip">' +
      '  <div class="bk-tour-tip__head">' +
      '    <span class="bk-tour-tip__step"></span>' +
      '    <button type="button" class="bk-tour-tip__skip">Ignorer le tutoriel</button>' +
      "  </div>" +
      '  <h4 class="bk-tour-tip__title"></h4>' +
      '  <p class="bk-tour-tip__text"></p>' +
      '  <div class="bk-tour-tip__foot">' +
      '    <button type="button" class="bk-tour-tip__next">Suivant →</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(root);
    root.querySelector(".bk-tour-tip__skip").addEventListener("click", stopTour);
    return root;
  }

  function reposition() {
    if (!state.target) return;
    renderAt(state.target);
  }

  function renderAt(el) {
    var root = document.getElementById("bkTourRoot");
    if (!root) return;
    var r = el.getBoundingClientRect();
    var pad = 8;
    var top = r.top - pad, left = r.left - pad, right = r.right + pad, bottom = r.bottom + pad;
    var vw = window.innerWidth, vh = window.innerHeight;

    var maskTop = root.querySelector('[data-pos="top"]');
    var maskBottom = root.querySelector('[data-pos="bottom"]');
    var maskLeft = root.querySelector('[data-pos="left"]');
    var maskRight = root.querySelector('[data-pos="right"]');

    maskTop.style.cssText = "top:0;left:0;width:100%;height:" + Math.max(0, top) + "px;";
    maskBottom.style.cssText = "top:" + bottom + "px;left:0;width:100%;height:" + Math.max(0, vh - bottom) + "px;";
    maskLeft.style.cssText = "top:" + top + "px;left:0;width:" + Math.max(0, left) + "px;height:" + (bottom - top) + "px;";
    maskRight.style.cssText = "top:" + top + "px;left:" + right + "px;width:" + Math.max(0, vw - right) + "px;height:" + (bottom - top) + "px;";

    var ring = root.querySelector(".bk-tour-ring");
    ring.style.cssText = "top:" + top + "px;left:" + left + "px;width:" + (right - left) + "px;height:" + (bottom - top) + "px;";

    var tip = root.querySelector(".bk-tour-tip");
    var placement = state.placement || "bottom";
    var tipTop, tipLeft;
    var tipW = 300;
    if (placement === "bottom") { tipTop = bottom + 14; tipLeft = Math.min(vw - tipW - 16, Math.max(16, left)); }
    else if (placement === "top") { tipTop = top - 14; tipLeft = Math.min(vw - tipW - 16, Math.max(16, left)); tip.style.transform = "translateY(-100%)"; }
    else if (placement === "right") { tipTop = top; tipLeft = right + 14; }
    else { tipTop = top; tipLeft = Math.max(16, left - tipW - 14); }
    if (placement !== "top") tip.style.transform = "";
    tip.style.top = tipTop + "px";
    tip.style.left = tipLeft + "px";
  }

  function findWithRetry(step, cb) {
    var tries = 0;
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () {
      tries++;
      var el = step.find ? step.find() : null;
      if (el && isVisible(el)) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        cb(el);
      } else if (tries > 30) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        // Sélecteur introuvable (page changée, élément renommé...) — on
        // n'immobilise jamais l'utilisateur : on passe simplement à l'étape
        // suivante plutôt que de laisser le tour bloqué silencieusement.
        goToStep(state.stepIndex + 1);
      }
    }, 100);
  }

  function showStep(index) {
    teardown();
    var steps = currentSteps();
    if (index >= steps.length) { stopTour(); return; }
    var step = steps[index];

    var stepPage = typeof step.page === "function" ? step.page() : step.page;
    var onRightPage = step.pageMatch ? step.pageMatch(location.pathname) : location.pathname === stepPage;
    if (!onRightPage) {
      setStepIndex(index);
      location.href = stepPage;
      return;
    }

    state.stepIndex = index;
    setStepIndex(index);

    var lockCheck = index === 0 ? LOCK_CHECKS[state.tourName] : null;
    var lockInfo = lockCheck ? lockCheck() : null;

    if (!lockInfo && step.preStep) step.preStep();

    findWithRetry(step, function (el) {
      state.target = el;
      state.placement = step.placement;
      var root = buildRoot();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(function () {
        renderAt(el);
        var stepLabel = root.querySelector(".bk-tour-tip__step");
        var titleEl = root.querySelector(".bk-tour-tip__title");
        var textEl = root.querySelector(".bk-tour-tip__text");
        var nextBtn = root.querySelector(".bk-tour-tip__next");

        if (lockInfo) {
          root.querySelector(".bk-tour-tip").classList.add("bk-tour-tip--locked");
          stepLabel.textContent = "🔒 Fonctionnalité verrouillée";
          titleEl.textContent = "Passez à un forfait supérieur";
          textEl.textContent = lockInfo.message;
          nextBtn.textContent = "Voir les forfaits →";
          nextBtn.addEventListener("click", function () {
            stopTour();
            window.location.href = "/subscription";
          });
          return;
        }

        stepLabel.textContent = "Étape " + (index + 1) + " / " + steps.length;
        titleEl.textContent = step.title;
        textEl.textContent = step.text;
        nextBtn.textContent = step.isLast ? "Terminer la visite" : "Suivant →";
        nextBtn.addEventListener("click", function () {
          if (step.isLast) { stopTour(); return; }
          if (state.target && step.advanceOnEvent) {
            if (state.advanceHandler && state._evtName) {
              state.target.removeEventListener(state._evtName, state.advanceHandler);
              state.advanceHandler = null;
            }
            state.target.click();
            setTimeout(function () { goToStep(index + 1); }, step.advanceDelay || 200);
          } else {
            goToStep(index + 1);
          }
        });
      }, 260);

      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);

      if (!lockInfo && step.advanceOnEvent) {
        state._evtName = step.advanceOnEvent;
        state.advanceHandler = function () {
          setTimeout(function () { goToStep(index + 1); }, step.advanceDelay || 0);
        };
        el.addEventListener(step.advanceOnEvent, state.advanceHandler, { once: true });
      }
    });
  }

  function goToStep(index) { showStep(index); }

  function startTour(name) {
    var tourName = (name && TOURS[name]) ? name : DEFAULT_TOUR;
    state.tourName = tourName;
    localStorage.setItem(STORAGE_ACTIVE, "1");
    localStorage.setItem(STORAGE_NAME, tourName);
    setStepIndex(0);
    showStep(0);
  }

  window.BkTour = { start: startTour, stop: stopTour };

  document.addEventListener("DOMContentLoaded", function () {
    if (!isActive()) return;
    state.tourName = getTourName();
    var idx = getStepIndex();
    var steps = currentSteps();
    var step = steps[idx];
    if (!step) { stopTour(); return; }
    var stepPage2 = typeof step.page === "function" ? step.page() : step.page;
    var onPage2 = step.pageMatch ? step.pageMatch(location.pathname) : location.pathname === stepPage2;
    if (!onPage2) return; // l'utilisateur navigue librement — on n'impose rien
    showStep(idx);
  });
})();
