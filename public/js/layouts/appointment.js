import {
  initDeleteAppointment,
  initCalendarHeader,
  initAppointmentPopup,
} from "../components/admin/appointment.admin.js";
import { createTimePicker } from "../utils/time-picker.js";

initDeleteAppointment();
initCalendarHeader();
initAppointmentPopup();

function toMinutes(timeStr) {
  const [h, m] = timeStr.trim().split(":").map(Number);
  return h * 60 + m;
}

function updateTimeline() {
  const timeline = document.getElementById("current-time-line");
  if (!timeline) return;

  // N'afficher la ligne que si aujourd'hui est dans la semaine visible
  const todayHeader = document.querySelector(".cell.day-header.today");
  if (!todayHeader) {
    timeline.style.display = "none";
    return;
  }

  // Use data-time attribute so half-hour cells (empty text) are also included
  const timeCells = Array.from(document.querySelectorAll(".cell.time[data-time]"));
  if (!timeCells.length) {
    timeline.style.display = "none";
    return;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const firstMinutes = toMinutes(timeCells[0].dataset.time);
  const lastMinutes  = toMinutes(timeCells[timeCells.length - 1].dataset.time);

  if (nowMinutes < firstMinutes || nowMinutes > lastMinutes + 60) {
    timeline.style.display = "none";
    return;
  }

  const gridSection = document.querySelector(".grid-section");
  if (!gridSection) return;
  const gridRect = gridSection.getBoundingClientRect();

  // Positionnement horizontal : la ligne couvre la colonne d'AUJOURD'HUI, et
  // elle seule. Sur téléphone elle était étalée sur toute la largeur
  // (`calc(100% - 56px)`), donc en travers des sept jours : elle affirmait
  // qu'il est 14h30 un jeudi comme un dimanche. L'heure courante n'existe que
  // dans une colonne — c'est ce qui la rend lisible d'un coup d'œil.
  const todayRect = todayHeader.getBoundingClientRect();
  timeline.style.left  = `${todayRect.left - gridRect.left}px`;
  timeline.style.width = `${todayRect.width}px`;
  timeline.style.right = "auto";

  // Positionnement vertical — works with any row granularity (30 min, 60 min…)
  for (let i = 0; i < timeCells.length; i++) {
    const cellMin = toMinutes(timeCells[i].dataset.time);
    const nextMin =
      i < timeCells.length - 1
        ? toMinutes(timeCells[i + 1].dataset.time)
        : cellMin + 30;

    if (nowMinutes >= cellMin && nowMinutes < nextMin) {
      const cellRect = timeCells[i].getBoundingClientRect();
      const fraction = (nowMinutes - cellMin) / (nextMin - cellMin);
      const top = cellRect.top - gridRect.top + fraction * cellRect.height;
      timeline.style.top = `${top}px`;
      timeline.style.display = "block";
      return;
    }
  }

  timeline.style.display = "none";
}

updateTimeline();
setInterval(updateTimeline, 60000);

// ---- Mini month calendar ----
(function initMiniCalendar() {
  const trigger = document.getElementById("miniCalTrigger");
  const dropdown = document.getElementById("miniCalDropdown");
  const prevBtn = document.getElementById("miniCalPrev");
  const nextBtn = document.getElementById("miniCalNext");
  const title = document.getElementById("miniCalTitle");
  const daysEl = document.getElementById("miniCalDays");

  if (!trigger || !dropdown) return;

  // Portal: move dropdown to <body> to escape any overflow / transform / stacking context
  document.body.appendChild(dropdown);

  // Init current display month from URL param or today
  const params = new URLSearchParams(window.location.search);
  const paramDate = params.get("date") ? new Date(params.get("date") + "T12:00:00") : new Date();

  let displayYear = paramDate.getFullYear();
  let displayMonth = paramDate.getMonth(); // 0-based

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const focusedStr = `${paramDate.getFullYear()}-${String(paramDate.getMonth() + 1).padStart(2, "0")}-${String(paramDate.getDate()).padStart(2, "0")}`;

  const __t = window.__t || {};
  const MONTHS_FR = (__t.months && __t.months.length === 12)
    ? __t.months
    : ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  function renderCalendar() {
    title.textContent = `${MONTHS_FR[displayMonth]} ${displayYear}`;
    daysEl.innerHTML = "";

    const firstDay = new Date(displayYear, displayMonth, 1);
    const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon
    const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();

    for (let i = 0; i < startDow; i++) {
      const empty = document.createElement("span");
      empty.className = "mini-cal-cell empty";
      daysEl.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-cal-cell";
      btn.textContent = d;

      const isoDate = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

      if (isoDate === todayStr) btn.classList.add("today");
      if (isoDate === focusedStr) btn.classList.add("focused");

      btn.addEventListener("click", () => {
        window.location.href = `/appointment?date=${isoDate}`;
      });

      daysEl.appendChild(btn);
    }
  }

  function positionDropdown() {
    const rect = trigger.getBoundingClientRect();
    const dropW = 264;
    // Aligner sur la gauche du trigger, sans déborder à droite
    let left = rect.left;
    if (left + dropW > window.innerWidth - 8) {
      left = window.innerWidth - dropW - 8;
    }
    if (left < 8) left = 8;
    dropdown.style.top  = `${rect.bottom + 6}px`;
    dropdown.style.left = `${left}px`;
  }

  // Toggle
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains("open");
    if (!isOpen) {
      renderCalendar();
      positionDropdown();
    }
    dropdown.classList.toggle("open", !isOpen);
  });

  // Repositionner si resize (pas besoin de scroll car le trigger ne bouge pas)
  window.addEventListener("resize", () => {
    if (dropdown.classList.contains("open")) positionDropdown();
  });

  // Fermer au clic hors du dropdown (un seul handler, vérifie le DOM)
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== trigger) {
      dropdown.classList.remove("open");
    }
  });

  // Prev / Next month
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    displayMonth--;
    if (displayMonth < 0) { displayMonth = 11; displayYear--; }
    renderCalendar();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    displayMonth++;
    if (displayMonth > 11) { displayMonth = 0; displayYear++; }
    renderCalendar();
  });

  renderCalendar();
})();

// ── Nouveau rendez-vous (panel admin) ─────────────────────────────────────
(function () {
  const openBtn  = document.getElementById("newApptBtn");
  const overlay  = document.getElementById("newApptOverlay");
  const closeBtn = document.getElementById("newApptClose");
  const cancelBtn = document.getElementById("newApptCancel");
  const submitBtn = document.getElementById("newApptSubmit");
  const errorEl  = document.getElementById("newApptError");

  if (!openBtn || !overlay) return;

  const dateInput    = document.getElementById("newApptDate");
  const serviceSel   = document.getElementById("newApptService");
  const employeeSel  = document.getElementById("newApptEmployee");
  const nameInput    = document.getElementById("newApptName");
  const surnameInput = document.getElementById("newApptSurname");
  const emailInput   = document.getElementById("newApptEmail");
  const phoneInput   = document.getElementById("newApptPhone");
  const messageInput = document.getElementById("newApptMessage");
  const durationEl   = document.getElementById("newApptDuration");
  const durationPick = document.getElementById("newApptDurationPick");
  const endTimeEl    = document.getElementById("newApptEndTime");
  const serviceDurationHint = document.getElementById("newApptServiceDuration");
  const clientSearch  = document.getElementById("newApptClientSearch");
  const clientResults = document.getElementById("newApptClientResults");
  const clientChosen  = document.getElementById("newApptClientChosen");
  const clientChosenTxt = document.getElementById("newApptClientChosenTxt");
  const clientClear   = document.getElementById("newApptClientClear");
  const clientHint    = document.getElementById("newApptClientHint");
  const defaultSlotTime = window.__defaultSlotTime || 60;
  // Durée "glissée" sur le calendrier (clic-glisser) — prioritaire sur la
  // durée par défaut tant qu'aucun service n'est choisi (un service choisi
  // reprend la main, comme avant).
  let manualDurationOverride = null;

  function minutesOf(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function hhmmOf(totalMinutes) {
    const m = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  function durationLabel(diff) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return h > 0 ? `${h} h${m ? String(m).padStart(2, "0") : ""}` : `${m} min`;
  }

  // Heure de fin et durée ne se choisissent pas à la main : elles découlent
  // toujours de l'heure de début + la durée du service sélectionné, ou — si
  // aucun service n'est choisi — de la durée par défaut des rendez-vous
  // définie dans les paramètres de l'entreprise (`defaultSlotTime`).
  // Service à durée variable (« 30-45 min ») : on propose de choisir la durée
  // réelle entre les deux bornes, par pas de 5 minutes. Le rendez-vous était
  // sinon figé sur la borne basse, sans aucun moyen de dire qu'il durerait
  // plus longtemps — et le créneau suivant se retrouvait réservable trop tôt.
  function remplirChoixDuree(min, max) {
    if (!durationPick) return;
    const actuel = Number(durationPick.value) || null;
    durationPick.innerHTML = "";
    for (let d = min; d <= max; d += 5) {
      const o = document.createElement("option");
      o.value = String(d);
      o.textContent = durationLabel(d);
      durationPick.appendChild(o);
    }
    // La borne haute n'est pas forcément sur un multiple de 5 depuis le min.
    if ((max - min) % 5 !== 0) {
      const o = document.createElement("option");
      o.value = String(max);
      o.textContent = durationLabel(max);
      durationPick.appendChild(o);
    }
    durationPick.value = actuel && actuel >= min && actuel <= max ? String(actuel) : String(min);
  }

  function recomputeEndAndDuration() {
    const opt = serviceSel && serviceSel.options[serviceSel.selectedIndex];
    const serviceDuration = opt && opt.dataset.duration ? Number(opt.dataset.duration) : null;
    const serviceMax = opt && opt.dataset.durationMax ? Number(opt.dataset.durationMax) : null;
    const fourchette = !!(serviceDuration && serviceMax && serviceMax > serviceDuration);

    if (durationPick) {
      if (fourchette) {
        // Ne reconstruire la liste que si les bornes ont changé : sinon on
        // écraserait le choix de l'utilisateur à chaque changement d'heure.
        if (durationPick.dataset.min !== String(serviceDuration) || durationPick.dataset.max !== String(serviceMax)) {
          durationPick.dataset.min = String(serviceDuration);
          durationPick.dataset.max = String(serviceMax);
          remplirChoixDuree(serviceDuration, serviceMax);
        }
        durationPick.hidden = false;
        durationEl.hidden = true;
      } else {
        durationPick.hidden = true;
        durationPick.dataset.min = "";
        durationPick.dataset.max = "";
        durationEl.hidden = false;
      }
    }

    const dureeChoisie = fourchette && durationPick ? Number(durationPick.value) : null;
    const duration = dureeChoisie || serviceDuration || manualDurationOverride || defaultSlotTime;

    if (serviceDurationHint) {
      serviceDurationHint.textContent = serviceDuration
        ? (fourchette ? ` · ${serviceDuration}-${serviceMax} min` : ` · ${serviceDuration} min`)
        : "";
    }

    const start = minutesOf(startPicker.get());
    if (start === null) {
      endTimeEl.textContent = "--:--";
      durationEl.textContent = "—";
      return;
    }
    endTimeEl.textContent = hhmmOf(start + duration);
    durationEl.textContent = durationLabel(duration);
  }

  const startPicker = createTimePicker(
    document.getElementById("newApptStartBox"),
    document.getElementById("newApptStartPanel"),
    document.getElementById("newApptStartList"),
    () => { recomputeEndAndDuration(); rendreCreneaux(); }
  );

  if (serviceSel) serviceSel.addEventListener("change", recomputeEndAndDuration);
  if (durationPick) durationPick.addEventListener("change", recomputeEndAndDuration);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  // ── Plusieurs rendez-vous d'un coup ───────────────────────────────────────
  // Caler quatre séances de suivi demandait quatre fois la même saisie : même
  // client, même prestation, seule la date changeait. On peut désormais
  // empiler des dates libres (ce n'est pas une récurrence : elles n'ont aucun
  // rapport entre elles). Chaque date devient un rendez-vous INDÉPENDANT —
  // annuler ou déplacer l'un ne touche pas les autres.
  // Sans clic sur « Ajouter cette date », rien ne change : un seul rendez-vous
  // est créé, exactement comme avant.
  const addDateBtn = document.getElementById("newApptAddDate");
  const datesList  = document.getElementById("newApptDatesList");
  const datesHint  = document.getElementById("newApptDatesHint");
  const submitLabel = submitBtn.querySelector("span");
  const submitLabelDefaut = submitLabel ? submitLabel.textContent : "";
  let creneauxEnAttente = [];
  // Un rendez-vous créé mais suivi d'un échec sur une autre date : la page
  // affiche encore l'ancien calendrier. On la rafraîchit à la fermeture.
  let calendrierPerime = false;

  function libelleDate(iso) {
    try {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    } catch (e) {
      return iso;
    }
  }

  // Le créneau encore dans les champs compte comme un rendez-vous à créer :
  // ajouter trois dates puis en saisir une quatrième sans cliquer « Ajouter »
  // en crée bien quatre, et ne rien saisir après avoir ajouté n'en crée que
  // trois. Aucun clic obligatoire, donc, dans un sens comme dans l'autre.
  function creneauxAcreer() {
    const liste = creneauxEnAttente.slice();
    const date = dateInput.value;
    const time = startPicker.get();
    if (date && time && !liste.some((c) => c.date === date && c.time === time)) {
      liste.push({ date, time });
    }
    return liste;
  }

  function rendreCreneaux() {
    if (!datesList) return;
    datesList.innerHTML = "";
    datesList.hidden = creneauxEnAttente.length === 0;
    creneauxEnAttente.forEach((c, i) => {
      const chip = document.createElement("span");
      chip.className = "multidate__chip";
      const txt = document.createElement("span");
      txt.textContent = `${libelleDate(c.date)} · ${c.time}`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "multidate__chip-x";
      del.setAttribute("aria-label", "Retirer cette date");
      del.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">close</span>';
      del.addEventListener("click", () => {
        creneauxEnAttente.splice(i, 1);
        rendreCreneaux();
      });
      chip.appendChild(txt);
      chip.appendChild(del);
      datesList.appendChild(chip);
    });

    const total = creneauxAcreer().length;
    if (datesHint) {
      datesHint.textContent = total > 1
        ? `${total} rendez-vous indépendants seront créés.`
        : "Pour créer plusieurs rendez-vous d'un coup.";
    }
    if (submitLabel) {
      submitLabel.textContent = total > 1 ? `Créer ${total} rendez-vous` : submitLabelDefaut;
    }
  }

  if (addDateBtn) {
    addDateBtn.addEventListener("click", () => {
      const date = dateInput.value;
      const time = startPicker.get();
      if (!date || !time) {
        showError("Choisissez une date et une heure de début avant de l'ajouter à la liste.");
        return;
      }
      if (!creneauxEnAttente.some((c) => c.date === date && c.time === time)) {
        creneauxEnAttente.push({ date, time });
      }
      errorEl.style.display = "none";
      // L'heure repart à zéro : la ligne du haut sert alors à saisir la date
      // SUIVANTE, et le créneau qu'on vient d'ajouter n'est pas compté deux
      // fois par creneauxAcreer().
      startPicker.set("");
      recomputeEndAndDuration();
      rendreCreneaux();
    });
  }

  if (dateInput) dateInput.addEventListener("change", rendreCreneaux);

  function resetForm() {
    dateInput.value = "";
    startPicker.set("");
    if (serviceSel) serviceSel.value = "";
    // Ne réinitialise que si le select a une option vide (mode multi-employés).
    // En mode 1 seul employé, le select est caché avec une seule option pré-sélectionnée.
    if (employeeSel && employeeSel.querySelector('option[value=""]')) employeeSel.value = "";
    nameInput.value = "";
    surnameInput.value = "";
    emailInput.value = "";
    phoneInput.value = "";
    messageInput.value = "";
    errorEl.style.display = "none";
    errorEl.textContent = "";
    if (serviceDurationHint) serviceDurationHint.textContent = "";
    endTimeEl.textContent = "--:--";
    durationEl.textContent = "—";
    manualDurationOverride = null;
    creneauxEnAttente = [];
    rendreCreneaux();
    deselectionnerClient();
  }

  // ── Choix d'un client déjà connu ──────────────────────────────────────────
  // `clientChoisi` non nul = identité reprise d'une fiche existante : inutile
  // alors de prévenir d'un doublon, c'est justement ce qu'on évite.
  let clientChoisi = null;

  function deselectionnerClient() {
    clientChoisi = null;
    if (clientSearch) { clientSearch.value = ""; clientSearch.parentElement.hidden = false; }
    if (clientResults) { clientResults.hidden = true; clientResults.innerHTML = ""; }
    if (clientChosen) clientChosen.hidden = true;
    if (clientHint) clientHint.hidden = false;
  }

  function selectionnerClient(c) {
    clientChoisi = c;
    nameInput.value = c.name || "";
    surnameInput.value = c.surname || "";
    emailInput.value = c.email || "";
    phoneInput.value = c.phone || "";
    if (clientChosenTxt) {
      const nom = ((c.name || "") + " " + (c.surname || "")).trim() || c.email || "Client";
      clientChosenTxt.textContent = c.email ? `${nom} · ${c.email}` : nom;
    }
    if (clientChosen) clientChosen.hidden = false;
    if (clientSearch) clientSearch.parentElement.hidden = true;
    if (clientResults) { clientResults.hidden = true; clientResults.innerHTML = ""; }
    if (clientHint) clientHint.hidden = true;
  }

  if (clientClear) clientClear.addEventListener("click", () => {
    deselectionnerClient();
    nameInput.value = ""; surnameInput.value = ""; emailInput.value = ""; phoneInput.value = "";
    clientSearch.focus();
  });

  if (clientSearch) {
    let minuteur = null;
    let requeteEnCours = 0;
    clientSearch.addEventListener("input", () => {
      clearTimeout(minuteur);
      const motif = clientSearch.value.trim();
      if (motif.length < 2) {
        clientResults.hidden = true;
        clientResults.innerHTML = "";
        return;
      }
      minuteur = setTimeout(async () => {
        const monTour = ++requeteEnCours;
        try {
          const res = await fetch(`/clients-hub/search?q=${encodeURIComponent(motif)}`);
          const data = await res.json();
          // Une réponse plus ancienne ne doit pas écraser une plus récente.
          if (monTour !== requeteEnCours) return;
          clientResults.innerHTML = "";
          if (!data.clients || !data.clients.length) {
            const vide = document.createElement("div");
            vide.className = "appt-client-result appt-client-result--empty";
            vide.textContent = "Aucun client trouvé — remplissez les champs ci-dessous.";
            clientResults.appendChild(vide);
          } else {
            data.clients.forEach((c) => {
              const el = document.createElement("button");
              el.type = "button";
              el.className = "appt-client-result";
              const nom = document.createElement("span");
              nom.className = "appt-client-result__name";
              nom.textContent = ((c.name || "") + " " + (c.surname || "")).trim() || "(sans nom)";
              const sous = document.createElement("span");
              sous.className = "appt-client-result__sub";
              sous.textContent = [c.email, c.phone].filter(Boolean).join(" · ");
              el.appendChild(nom);
              el.appendChild(sous);
              el.addEventListener("click", () => selectionnerClient(c));
              clientResults.appendChild(el);
            });
          }
          clientResults.hidden = false;
        } catch (e) { /* recherche indisponible : la saisie manuelle reste possible */ }
      }, 250);
    });
    // Clic hors de la liste = on la referme.
    document.addEventListener("click", (e) => {
      if (clientResults && !clientResults.hidden && !e.target.closest(".appt-client-pick")) {
        clientResults.hidden = true;
      }
    });
  }

  function open(prefill) {
    resetForm();
    const today = new Date();
    dateInput.value = (prefill && prefill.date) ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (prefill && prefill.time) startPicker.set(prefill.time);
    if (prefill && prefill.duration) manualDurationOverride = prefill.duration;

    // Pré-sélectionne l'employé déjà filtré dans le calendrier, sauf si le
    // clic sur une case précise visait un employé différent.
    if (employeeSel) {
      const empFilter = document.getElementById("empFilterSelect");
      const wantedEmployeeId = (prefill && prefill.employeeId) ||
        (empFilter && empFilter.value !== "all" ? empFilter.value : "");
      if (wantedEmployeeId) employeeSel.value = wantedEmployeeId;
    }

    overlay.classList.add("show");
    recomputeEndAndDuration();
    nameInput.focus();
  }

  // Exposé pour le clic-glisser sur le calendrier (autre IIFE plus bas).
  window.__openNewApptModal = open;

  // « Nouveau rendez-vous » depuis le Dashboard, la fiche client ou la liste
  // des clients : ces boutons pointaient vers /appointment/new, une route qui
  // n'a jamais existé — d'où le « Cannot GET /appointment/new ». Le formulaire
  // est cette modale : on arrive donc sur le calendrier avec ?new=1 et on
  // l'ouvre directement.
  try {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      open();
      // Nettoie l'URL : un rafraîchissement ou un retour arrière ne doit pas
      // rouvrir la modale en boucle.
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState({}, "", url);
    }
  } catch (e) {
    // URL exotique : on ignore, le bouton de la page reste utilisable.
  }

  function close() {
    overlay.classList.remove("show");
    document.querySelectorAll(".appt-time-panel.open").forEach((p) => p.classList.remove("open"));
    // Création partielle (une date sur trois refusée) : le calendrier derrière
    // la modale n'affiche pas les rendez-vous déjà créés.
    if (calendrierPerime) window.location.reload();
  }

  openBtn.addEventListener("click", () => open());
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) close();
  });

  // Le clic simple ET le clic-glisser sur une case vide du calendrier sont
  // gérés ensemble plus bas (voir "Clic-glisser pour créer un RDV") — ça
  // appelle window.__openNewApptModal(...) défini juste au-dessus.

  // ── Vue Mois : bouton "+" sur une case jour (sans heure précise) ──────────
  document.querySelectorAll(".cal-month__add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open({ date: btn.dataset.iso });
    });
  });

  submitBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";

    const creneaux = creneauxAcreer();
    // Réassignables : reprendre la fiche d'un client existant met les champs à
    // jour, et c'est cette identité-là qu'il faut envoyer.
    let name  = nameInput.value.trim();
    let email = emailInput.value.trim();

    if (!creneaux.length || !name || !email) {
      showError("Veuillez remplir les champs obligatoires (date, heure de début, prénom, email).");
      return;
    }

    // Identité tapée à la main alors qu'un client du même nom (ou du même
    // téléphone) existe déjà sous un autre e-mail : on le signale, sinon le
    // pro se retrouve avec deux fiches et un historique coupé en deux. Un
    // client choisi dans la liste ne déclenche évidemment rien.
    if (!clientChoisi) {
      try {
        const q = new URLSearchParams({
          email,
          phone: phoneInput.value.trim(),
          name: (name + " " + surnameInput.value.trim()).trim(),
        });
        const res = await fetch(`/clients-hub/lookup?${q.toString()}`);
        const data = await res.json();
        if (data && data.doublon && typeof window.confirmModal === "function") {
          const d = data.doublon;
          const nomExistant = ((d.name || "") + " " + (d.surname || "")).trim() || d.email;
          const details = [d.email, d.phone].filter(Boolean).join(" · ");
          const utiliserExistant = await window
            .confirmModal(
              "Ce client existe déjà",
              `Vous avez déjà ${nomExistant}${details ? " (" + details + ")" : ""} dans vos clients. ` +
                "Utiliser sa fiche regroupe ses rendez-vous ; créer un nouveau client en fera une seconde fiche séparée.",
              { confirmLabel: "Utiliser sa fiche", cancelLabel: "Créer un nouveau client", danger: false }
            )
            .then(() => true)
            .catch(() => false);
          if (utiliserExistant) {
            selectionnerClient(d);
            name = nameInput.value.trim();
            email = emailInput.value.trim();
          }
        }
      } catch (e) { /* vérification indisponible : on n'empêche pas la création */ }
    }

    const payload = {
      name,
      surname: surnameInput.value.trim(),
      email,
      phone: phoneInput.value.trim(),
      message: messageInput.value.trim(),
      serviceId: serviceSel ? serviceSel.value : "",
      employeeId: employeeSel ? employeeSel.value : "",
      // Durée envoyée au serveur, par ordre de priorité :
      //   1. celle choisie dans la liste, pour un service à durée variable ;
      //   2. celle glissée sur le calendrier (clic-glisser) ;
      //   3. sinon rien : le serveur applique la durée du service ou le défaut.
      // Sans le premier cas, choisir « 45 min » sur un service « 30-45 »
      // n'avait aucun effet : le rendez-vous durait 30 minutes.
      duration:
        (durationPick && !durationPick.hidden && Number(durationPick.value)) ||
        manualDurationOverride ||
        undefined,
    };

    // Un appel par créneau, en série : chaque rendez-vous passe ainsi par les
    // mêmes contrôles que d'habitude (chevauchement, horaires, quota du
    // forfait, e-mail de confirmation, synchro Google Agenda) et reste
    // indépendant des autres. En série et non en parallèle, sinon deux dates
    // proches peuvent se chevaucher sans qu'aucune ne voie l'autre.
    submitBtn.disabled = true;
    const echecs = [];
    let crees = 0;

    // `forcer` passe à true dès que le pro a accepté de poser un rendez-vous
    // par-dessus une absence : on ne lui repose plus la question pour les
    // dates suivantes de la même série.
    let forcer = false;
    const envoyer = (c, forcerSurAbsence) =>
      fetch("/appointment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.assign({ date: c.date, startTime: c.time, forcerSurAbsence }, payload)
        ),
      }).then((r) => r.json());

    for (const c of creneaux) {
      try {
        let data = await envoyer(c, forcer);

        // Le créneau n'est bloqué que par une absence que le pro s'est posée
        // lui-même : on lui dit LAQUELLE et on le laisse trancher, au lieu du
        // message trompeur « cet employé a déjà un rendez-vous ».
        if (!data.success && data.error === "absence_conflict") {
          const abs = data.absence || {};
          const quand = abs.start && abs.end ? "de " + abs.start + " à " + abs.end : "sur ce créneau";
          const accepte = await window
            .confirmModal(
              "Vous êtes en absence " + quand,
              (abs.motif ? "Motif noté : « " + abs.motif + " ». " : "") +
                "Ce rendez-vous tombe pendant cette absence. Voulez-vous le placer quand même ? " +
                "L'absence est conservée : le rendez-vous se pose simplement par-dessus.",
              { confirmLabel: "Oui, placer le rendez-vous", cancelLabel: "Non, annuler", danger: false }
            )
            .then(() => true)
            .catch(() => false);
          if (accepte) {
            forcer = true;
            data = await envoyer(c, true);
          }
        }

        if (data.success) { crees++; calendrierPerime = true; }
        // `motif` = étiquette courte, accolée à la date quand il y en a
        // plusieurs ; `seul` = le message exact affiché pour un rendez-vous
        // unique, inchangé par rapport à avant le multi-dates.
        else echecs.push({ c, motif: data.message || "refusé", seul: data.message || "Erreur lors de la création du rendez-vous." });
      } catch (e) {
        echecs.push({ c, motif: "erreur réseau", seul: "Erreur réseau." });
      }
    }

    if (!echecs.length) {
      window.location.reload();
      return;
    }

    // Échec partiel : ne restent que les dates refusées, pour que « Créer » ne
    // redouble pas celles déjà passées. La première revient dans les champs,
    // sinon elle serait figée dans une puce et impossible à corriger.
    const premier = echecs[0].c;
    creneauxEnAttente = echecs.slice(1).map((e) => e.c);
    dateInput.value = premier.date;
    startPicker.set(premier.time);
    recomputeEndAndDuration();
    rendreCreneaux();
    if (creneaux.length === 1) {
      // Rendez-vous unique : dater l'échec de la seule date saisie n'apprend
      // rien, on garde le message d'avant.
      showError(echecs[0].seul);
    } else {
      const detail = echecs.map((e) => `${libelleDate(e.c.date)} ${e.c.time} (${e.motif})`).join(" · ");
      showError(
        crees
          ? `${crees} rendez-vous créé${crees > 1 ? "s" : ""}. Impossible pour : ${detail}`
          : `Impossible de créer : ${detail}`
      );
    }
    submitBtn.disabled = false;
  });
})();

// ── Marquer une absence (panel admin) ───────────────────────────────────────
// Ouverte depuis le choix "Absence" après un clic-glisser sur le calendrier
// (voir "Clic-glisser pour créer un RDV" plus bas, qui appelle
// window.__openBlockApptModal). Occupe le créneau comme un vrai RDV côté
// serveur (mêmes règles de chevauchement) mais sans client.
(function () {
  const overlay   = document.getElementById("blockApptOverlay");
  const closeBtn  = document.getElementById("blockApptClose");
  const cancelBtn = document.getElementById("blockApptCancel");
  const submitBtn = document.getElementById("blockApptSubmit");
  const deleteBtn = document.getElementById("blockApptDelete");
  const errorEl   = document.getElementById("blockApptError");
  if (!overlay || !submitBtn) return;

  const dateEl      = document.getElementById("blockApptDate");
  const durationEl  = document.getElementById("blockApptDuration");
  const employeeSel = document.getElementById("blockApptEmployee");
  const noteInput   = document.getElementById("blockApptNote");
  const startBox    = document.getElementById("blockApptStartBox");
  const endBox      = document.getElementById("blockApptEndBox");

  let current = null; // { date }

  const toMin = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return h * 60 + m;
  };

  function refreshDuration() {
    if (!durationEl) return;
    const start = startPicker && startPicker.get();
    const end = endPicker && endPicker.get();
    if (!start || !end) { durationEl.textContent = "—"; return; }
    const mins = toMin(end) - toMin(start);
    if (!(mins > 0)) { durationEl.textContent = "—"; return; }
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    durationEl.textContent = h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  }

  // Si le gabarit n'a pas (encore) les champs heure — page servie depuis une
  // version antérieure, cache navigateur — on ne construit aucun sélecteur et
  // on retombe sur les horaires du glisser. Sans ce garde-fou, createTimePicker
  // recevrait null et lèverait une exception qui tuerait TOUT le module, donc
  // le calendrier entier.
  const startPicker = startBox
    ? createTimePicker(startBox, document.getElementById("blockApptStartPanel"),
        document.getElementById("blockApptStartList"), refreshDuration)
    : null;
  const endPicker = endBox
    ? createTimePicker(endBox, document.getElementById("blockApptEndPanel"),
        document.getElementById("blockApptEndList"), refreshDuration)
    : null;

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function close() {
    overlay.classList.remove("show");
  }

  function open(info) {
    // `editId` absent = création. Remis à zéro à chaque ouverture, sinon une
    // création lancée après une modification irait écraser l'absence
    // précédente au lieu d'en créer une nouvelle.
    current = { ...info, editId: null };
    const t = document.getElementById("blockApptTitle");
    const sl = document.getElementById("blockApptSubmitLabel");
    if (t) t.textContent = "Marquer une absence";
    if (sl) sl.textContent = "Marquer absent";
    errorEl.style.display = "none";
    errorEl.textContent = "";
    noteInput.value = "";
    if (employeeSel) employeeSel.value = "";
    if (dateEl) {
      const [y, m, d] = info.date.split("-");
      dateEl.textContent = `${d}/${m}/${y}`;
    }
    if (startPicker) startPicker.set(info.time);
    if (endPicker) endPicker.set(info.endTime);
    if (deleteBtn) deleteBtn.hidden = true; // création : rien à supprimer
    refreshDuration();
    overlay.classList.add("show");
    noteInput.focus();
  }

  // Exposé pour le clic-glisser sur le calendrier (autre IIFE plus bas).
  window.__openBlockApptModal = open;

  // Ouverture en MODIFICATION depuis le popover d'une absence existante.
  // Même modale, même validation : seule la destination de l'envoi change.
  const titleEl = document.getElementById("blockApptTitle");
  const submitLabel = document.getElementById("blockApptSubmitLabel");
  window.__openBlockApptEdit = function (info) {
    open({ date: info.date, time: info.time, endTime: info.endTime });
    current.editId = info.id;
    if (titleEl) titleEl.textContent = "Modifier l'absence";
    if (submitLabel) submitLabel.textContent = "Enregistrer";
    if (noteInput) noteInput.value = info.note || "";
    if (employeeSel && info.employeeId) employeeSel.value = info.employeeId;
    if (deleteBtn) deleteBtn.hidden = false;
    refreshDuration();
  };

  // Suppression : même route que celle d'un rendez-vous, l'absence étant une
  // réservation marquée `isBlock`. Confirmation obligatoire — le geste est
  // définitif et le bouton est juste à côté de « Enregistrer ».
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!current || !current.editId) return;
      const ok =
        typeof window.confirmModal === "function"
          ? await window
              .confirmModal("Supprimer cette absence ?", "Le créneau redeviendra réservable.", {
                confirmLabel: "Supprimer",
                danger: true,
              })
              .then(() => true)
              .catch(() => false)
          : window.confirm("Supprimer cette absence ? Le créneau redeviendra réservable.");
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`/appointment/${current.editId}/delete`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) window.location.reload();
        else {
          showError(data.message || "Suppression impossible.");
          deleteBtn.disabled = false;
        }
      } catch (e) {
        showError("Erreur réseau.");
        deleteBtn.disabled = false;
      }
    });
  }

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) close();
  });

  submitBtn.addEventListener("click", async () => {
    if (!current) return;
    errorEl.style.display = "none";

    // Repli sur les horaires du glisser si les sélecteurs sont absents.
    const startTime = (startPicker && startPicker.get()) || current.time;
    const endTime = (endPicker && endPicker.get()) || current.endTime;
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      showError("Choisissez une heure de début et une heure de fin.");
      return;
    }
    if (toMin(endTime) <= toMin(startTime)) {
      showError("L'heure de fin doit être après l'heure de début.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const modification = !!current.editId;
      const res = await fetch(
        modification ? `/appointment/block/${current.editId}` : "/appointment/block",
        {
          method: modification ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: current.date,
            startTime,
            endTime,
            employeeId: employeeSel ? employeeSel.value : "",
            note: noteInput.value.trim(),
          }),
        }
      );
      const data = await res.json();
      if (data.success) {
        // Des rendez-vous déjà pris sont recouverts : on le dit AVANT de
        // recharger, pour que le pro sache qu'ils sont maintenus et qu'il doit
        // les honorer — sinon il croirait les avoir annulés.
        if (data.coveredBookings > 0) {
          const n = data.coveredBookings;
          const titre = n === 1 ? "1 rendez-vous est maintenu" : `${n} rendez-vous sont maintenus`;
          const texte =
            "Cette absence empêche toute NOUVELLE réservation sur ce créneau, mais " +
            (n === 1 ? "le rendez-vous déjà pris n'a pas été annulé" : "les rendez-vous déjà pris n'ont pas été annulés") +
            " : ils restent dans votre agenda et vous devez les honorer.";
          // L'absence est DÉJÀ enregistrée à ce stade : cet avertissement ne
          // doit jamais pouvoir la faire passer pour un échec. Sans ce garde-fou,
          // `confirmModal` absent de la page levait une erreur happée par le
          // `catch` plus bas → « Erreur réseau » sur une absence pourtant créée.
          try {
            if (typeof window.confirmModal === "function") {
              await window.confirmModal(titre, texte, { confirmLabel: "J'ai compris", danger: false });
            } else {
              window.alert(`${titre}\n\n${texte}`);
            }
          } catch (_) { /* avertissement refusé ou indisponible : on continue */ }
        }
        window.location.reload();
      } else {
        showError(data.message || "Erreur lors de l'enregistrement de l'absence.");
        submitBtn.disabled = false;
      }
    } catch (e) {
      showError("Erreur réseau.");
      submitBtn.disabled = false;
    }
  });
})();

// ---- Densité du calendrier (Confort / Compact) ---------------------------
// Les RDV sont positionnés en continu (top + height) à partir de leur heure
// de début exacte (`data-start-minutes`) et de leur durée (`data-slot-minutes`),
// rapportées à la hauteur réelle (rendue) d'une ligne de 30 min — jamais une
// valeur figée — afin que TOUT s'adapte automatiquement : durée de service,
// RDV à une minute "impaire" (9h20 reste positionné dans sa case 9h–9h30 sans
// jamais resserrer toute la grille), mode Confort/Compact, redimensionnement.
(function initCalendarDensity() {
  const section = document.getElementById("calendarSection");
  if (!section) return;

  const STORAGE_KEY = "branshee_calendar_density";
  const gridStep = Number(section.dataset.gridStep) || 30;
  const minHourMinutes = (Number(section.dataset.minHour) || 0) * 60;
  const toggle = document.getElementById("calDensityToggle");

  function currentRowHeightPx() {
    const sample = section.querySelector(".cell.time:not(.time--half)") || section.querySelector(".cell.time");
    if (!sample) return 52;
    const h = sample.getBoundingClientRect().height;
    return h > 0 ? h : 52;
  }

  // Positionne chaque colonne "RDV" (une par jour) en mesurant la vraie
  // cellule correspondante — pas de placement CSS Grid, qui perturbait
  // l'auto-placement des cellules de fond.
  function positionDayColumns() {
    const gridSection = section.querySelector(".grid-section");
    if (!gridSection) return;
    const gridRect = gridSection.getBoundingClientRect();
    const headerCell = section.querySelector(".cell.time-header, .cell.day-header");
    const headerH = headerCell ? headerCell.getBoundingClientRect().height : 0;

    section.querySelectorAll(".day-events-col").forEach((col) => {
      const iso = col.dataset.iso;
      // NB: on mesure une cellule ".cell.day" (grille de fond), PAS
      // ".cell.day-header" — sur mobile, TOUS les en-têtes sont cachés en
      // display:none sans condition (remplacés par la bande de jours du
      // haut), donc leur offsetParent est toujours null, quel que soit le
      // jour affiché. Ça faisait disparaître la colonne du jour sélectionné
      // (et donc ses RDV) sur mobile, systématiquement. ".cell.day", lui,
      // reste correctement visible/caché selon ".focused" sur mobile comme
      // sur desktop.
      const dayCell = gridSection.querySelector(`.cell.day[data-iso="${iso}"]`);
      if (!dayCell || dayCell.offsetParent === null) {
        col.style.display = "none";
        return;
      }
      const dayRect = dayCell.getBoundingClientRect();
      col.style.display = "block";
      col.style.left = `${Math.round(dayRect.left - gridRect.left)}px`;
      col.style.width = `${Math.round(dayRect.width)}px`;
      col.style.top = `${Math.round(headerH)}px`;
      col.style.height = `${Math.round(gridRect.height - headerH)}px`;
    });
  }

  function applyApptHeights() {
    positionDayColumns();
    const rowH = currentRowHeightPx();
    const pxPerMin = rowH / gridStep;
    // Inset haut ET bas (pas juste en bas) pour que le RDV ne touche jamais
    // la ligne de grille du dessus — sinon ça colle visuellement à la case.
    const inset = Math.min(3, rowH * 0.06);
    section.querySelectorAll("[data-start-minutes]").forEach((el) => {
      const startMin = Number(el.dataset.startMinutes) || 0;
      const slotMin = Number(el.dataset.slotMinutes) || gridStep;
      const top = Math.round((startMin - minHourMinutes) * pxPerMin) + inset;
      const rawH = Math.round(slotMin * pxPerMin);
      const h = Math.max(rawH - inset * 2, Math.min(20, rowH - 2));
      el.style.top = `${top}px`;
      el.style.height = `${h}px`;
    });
  }

  function setCompact(enabled) {
    section.classList.toggle("is-compact", enabled);
    if (toggle) {
      toggle.querySelectorAll(".cal-view-btn").forEach((btn) => {
        btn.classList.toggle("is-active", (btn.dataset.density === "compact") === enabled);
      });
    }

    if (enabled) {
      const headerCell = section.querySelector(".cell.time-header, .cell.day-header");
      const headerH = headerCell ? headerCell.getBoundingClientRect().height : 0;
      const rowCells = section.querySelectorAll(".cell.time");
      const numRows = rowCells.length || 1;

      // Hauteur minimale de 22px par ligne — sous cette limite, le libellé
      // d'heure (ex: "08:00") n'a plus la place de s'afficher proprement.
      const MIN_ROW_H = 22;
      const top = section.getBoundingClientRect().top;
      const available = Math.max(window.innerHeight - top - 24, 200);
      const neededBody = numRows * MIN_ROW_H;
      const fitsWithoutScroll = headerH + neededBody <= available;

      // Si même à la hauteur minimale les heures ne rentrent pas (plage de
      // disponibilité très large), on autorise un léger scroll interne plutôt
      // que de couper silencieusement les heures en fin de journée.
      const bodyHeight = fitsWithoutScroll ? Math.max(available - headerH, neededBody) : neededBody;
      const rowH = Math.max(Math.floor(bodyHeight / numRows), MIN_ROW_H);

      // La hauteur réelle du contenu (numRows * rowH, arrondi par le floor
      // ci-dessus) est presque toujours < bodyHeight à cause de l'arrondi —
      // si on fixe `section.style.height` à `available`, cet écart devient
      // une zone vide en bas sur laquelle on peut quand même scroller
      // (visible notamment sur Safari/macOS où les arrondis sub-pixel
      // diffèrent). On borne donc la hauteur du conteneur à la hauteur
      // réellement occupée par le contenu (+ son padding vertical CSS,
      // sinon ce padding déborde et recrée le même écart scrollable) quand
      // tout rentre déjà sans scroll.
      const sectionStyle = getComputedStyle(section);
      const verticalPadding = parseFloat(sectionStyle.paddingTop || "0") + parseFloat(sectionStyle.paddingBottom || "0");
      const actualHeight = fitsWithoutScroll ? headerH + rowH * numRows + verticalPadding : available;

      section.style.height = `${actualHeight}px`;
      section.style.overflowY = fitsWithoutScroll ? "hidden" : "auto";
      section.style.setProperty("--cal-row-h", `${rowH}px`);
    } else {
      section.style.height = "";
      section.style.overflowY = "";
      section.style.removeProperty("--cal-row-h");
    }

    // Attendre que le reflow CSS soit appliqué avant de mesurer les lignes.
    // updateTimeline() doit être rappelée ici aussi : elle ne tourne sinon
    // que toutes les 60s, donc le trait "maintenant" restait figé à son
    // ancienne position (mauvaise heure affichée) juste après un bascule
    // Confort/Compact, le temps que le prochain tick minute arrive.
    requestAnimationFrame(() => {
      applyApptHeights();
      if (typeof updateTimeline === "function") updateTimeline();
    });
  }

  if (toggle) {
    toggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".cal-view-btn");
      if (!btn) return;
      const compact = btn.dataset.density === "compact";
      localStorage.setItem(STORAGE_KEY, compact ? "compact" : "comfort");
      setCompact(compact);
    });
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  setCompact(saved === "compact");

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setCompact(section.classList.contains("is-compact"));
    }, 150);
  });

  // Exposé pour le refresh silencieux (cf. initSilentRefresh plus bas) — qui
  // remplace seulement les colonnes de RDV puis doit recalculer leur
  // position top/height, sans dupliquer cette logique de mesure des lignes.
  window.__bkRecalcApptPositions = applyApptHeights;

  // La position de chaque RDV est mesurée une seule fois sur les vraies
  // cellules rendues — correct au moment du calcul, mais si la police web
  // finit de charger APRÈS (réseau mobile plus lent que sur PC), les
  // largeurs/hauteurs mesurées peuvent devenir obsolètes sans qu'aucun
  // resize ne se déclenche pour recalculer : les RDV restent alors
  // positionnés d'après l'ancienne mise en page (potentiellement hors de la
  // zone visible). On recale dès que les polices sont prêtes, + un filet de
  // sécurité après le chargement complet de la page (images, etc.).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => applyApptHeights()).catch(() => {});
  }
  window.addEventListener("load", () => applyApptHeights());
})();

// ── Clic-glisser pour créer un RDV (façon Google Calendar) ─────────────────
// Glisser sur une case vide dessine un aperçu qui suit la durée glissée,
// puis ouvre "Nouveau rendez-vous" pré-rempli avec cette durée — un simple
// clic (sans glisser) garde l'ancien comportement (1 créneau de la grille).
// L'aperçu passe en rouge si la plage glissée chevauche déjà un RDV ce
// jour-là — un repère visuel seulement : la vraie validation (avec la
// logique employé : un employé B libre reste autorisé même si A est pris)
// se fait côté serveur à l'envoi du formulaire.
(function initDragToCreate() {
  const section = document.getElementById("calendarSection");
  if (!section) return;
  const gridSection = section.querySelector(".grid-section");
  if (!gridSection) return;

  const gridStep = Number(section.dataset.gridStep) || 30;
  const minHourMinutes = (Number(section.dataset.minHour) || 0) * 60;

  function rowHeightPx() {
    const sample = section.querySelector(".cell.time:not(.time--half)") || section.querySelector(".cell.time");
    const h = sample ? sample.getBoundingClientRect().height : 0;
    return h > 0 ? h : 52;
  }

  function minutesToHHMM(min) {
    const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  function timeToMinutes(hhmm) {
    const [h, m] = (hhmm || "0:0").split(":").map(Number);
    return h * 60 + m;
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  function getEventsCol(iso) {
    return section.querySelector(`.day-events-col[data-iso="${iso}"]`);
  }

  function existingRangesForDay(iso) {
    const col = getEventsCol(iso);
    if (!col) return [];
    return Array.from(col.querySelectorAll("[data-start-minutes]"))
      // Un cours collectif qui NE bloque PAS les RDV individuels n'est pas un
      // conflit : le pro a explicitement autorisé à réserver pendant ce cours,
      // le fantôme de drag ne doit donc pas passer en rouge.
      .filter((el) => el.dataset.courseBand !== "free")
      .map((el) => {
        const s = Number(el.dataset.startMinutes) || 0;
        const d = Number(el.dataset.slotMinutes) || gridStep;
        return [s, s + d];
      });
  }

  // Cellule .cell.day du même jour la plus proche verticalement du point Y.
  function cellAt(iso, clientY) {
    const cells = gridSection.querySelectorAll(`.cell.day[data-iso="${iso}"]`);
    let closest = null;
    let bestDist = Infinity;
    cells.forEach((c) => {
      const r = c.getBoundingClientRect();
      const dist = Math.abs(clientY - (r.top + r.height / 2));
      if (dist < bestDist) { bestDist = dist; closest = c; }
    });
    return closest;
  }

  let drag = null;

  function updateGhost(currentMin) {
    if (!drag) return;
    const rowH = rowHeightPx();
    const pxPerMin = rowH / gridStep;
    const startMin = Math.min(drag.startMin, currentMin);
    const endMin = Math.max(drag.startMin, currentMin) + gridStep;

    drag.ghost.style.top = `${Math.round((startMin - minHourMinutes) * pxPerMin)}px`;
    drag.ghost.style.height = `${Math.round((endMin - startMin) * pxPerMin)}px`;
    drag.ghost.textContent = `${minutesToHHMM(startMin)} – ${minutesToHHMM(endMin)}`;

    const conflict = existingRangesForDay(drag.iso).some(([rs, re]) => rangesOverlap(startMin, endMin, rs, re));
    drag.ghost.classList.toggle("cal-drag-ghost--conflict", conflict);

    drag.finalStart = startMin;
    drag.finalEnd = endMin;
  }

  function moveDrag(clientY) {
    if (!drag) return;
    const cell = cellAt(drag.iso, clientY);
    const currentMin = cell ? timeToMinutes(cell.dataset.time) : drag.startMin;
    updateGhost(currentMin);
  }

  function onMouseMove(e) {
    moveDrag(e.clientY);
  }

  function onTouchMove(e) {
    if (!drag) return;
    // Empêche la page de scroller pendant qu'on glisse sur la grille — sinon
    // impossible de dessiner une plage sur tactile (le doigt fait défiler la
    // page au lieu d'étendre le ghost).
    e.preventDefault();
    moveDrag(e.touches[0].clientY);
  }

  function showDragChoice(anchorRect, info) {
    const menu = document.getElementById("dragChoice");
    const apptBtn = document.getElementById("dragChoiceAppt");
    const blockBtn = document.getElementById("dragChoiceBlock");

    function openApptModal() {
      if (typeof window.__openNewApptModal === "function") {
        window.__openNewApptModal({
          date: info.date,
          time: minutesToHHMM(info.startMin),
          duration: Math.max(gridStep, info.endMin - info.startMin),
        });
      }
    }

    // Pas de choix dispo sur cette page (page sans la modale d'absence) →
    // ancien comportement, ouvre directement "Nouveau rendez-vous".
    if (!menu || !apptBtn || !blockBtn) { openApptModal(); return; }

    const top = Math.max(8, Math.min(anchorRect.bottom + 6, window.innerHeight - 100));
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 200));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.display = "flex";

    function cleanup() {
      menu.style.display = "none";
      apptBtn.removeEventListener("click", onApptChoice);
      blockBtn.removeEventListener("click", onBlockChoice);
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("touchstart", onOutside, true);
    }
    function onApptChoice() { cleanup(); openApptModal(); }
    function onBlockChoice() {
      cleanup();
      if (typeof window.__openBlockApptModal === "function") {
        window.__openBlockApptModal({
          date: info.date,
          time: minutesToHHMM(info.startMin),
          endTime: minutesToHHMM(info.endMin),
        });
      }
    }
    function onOutside(e) { if (!menu.contains(e.target)) cleanup(); }

    apptBtn.addEventListener("click", onApptChoice);
    blockBtn.addEventListener("click", onBlockChoice);
    // Capture + délai : sinon le mouseup/touchend qui vient de déclencher ce
    // menu le referme aussitôt.
    setTimeout(() => {
      document.addEventListener("mousedown", onOutside, true);
      document.addEventListener("touchstart", onOutside, true);
    }, 0);
  }

  // Annule un glisser en cours sans rien ouvrir — utilisé en filet de
  // sécurité (voir plus bas) quand le navigateur ne reçoit jamais le
  // "mouseup" qui termine normalement le glisser (ex: l'outil de capture
  // Windows "Win+Maj+S" pris EN PLEIN glisser garde la souris "enfoncée"
  // du point de vue de la page — sans ça, le ghost reste affiché pour
  // toujours et un nouveau glisser s'empile par-dessus au lieu de le
  // remplacer).
  function removeMoveEndListeners() {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", cancelDrag);
  }

  function cancelDrag() {
    if (!drag) return;
    removeMoveEndListeners();
    drag.ghost.remove();
    drag = null;
  }

  function endDrag() {
    if (!drag) return;
    removeMoveEndListeners();

    const { iso, finalStart, finalEnd, ghost } = drag;
    const anchorRect = ghost.getBoundingClientRect();
    ghost.remove();
    drag = null;

    showDragChoice(anchorRect, { date: iso, startMin: finalStart, endMin: finalEnd });
  }

  function onMouseUp() {
    endDrag();
  }

  function onTouchEnd() {
    endDrag();
  }

  // La fenêtre perd le focus (capture d'écran, alt-tab, autre appli au
  // premier plan...) → on ne saura jamais si le bouton de la souris a été
  // relâché ailleurs, donc on annule plutôt que de laisser un ghost orphelin.
  window.addEventListener("blur", cancelDrag);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelDrag();
  });

  function startDrag(cell) {
    cancelDrag(); // au cas où un glisser précédent serait resté coincé
    const iso = cell.dataset.iso;
    const startMin = timeToMinutes(cell.dataset.time);
    const col = getEventsCol(iso);
    if (!col) return false;

    const ghost = document.createElement("div");
    ghost.className = "cal-drag-ghost";
    col.appendChild(ghost);

    drag = { iso, startMin, ghost, finalStart: startMin, finalEnd: startMin + gridStep };
    updateGhost(startMin);
    return true;
  }

  gridSection.querySelectorAll(".cell.day").forEach((cell) => {
    cell.addEventListener("mousedown", (e) => {
      if (!window.__canManageAppointments) return;
      if (e.button !== 0) return; // clic gauche uniquement
      if (!startDrag(cell)) return;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    });

    // Tactile : mêmes gestes que la souris (appui = début, glisser = étend
    // la plage, relâcher = ouvre le choix Rendez-vous/Absence). Sans ça, ces
    // interactions ne fonctionnaient pas du tout sur mobile/tablette — le
    // navigateur ne synthétise pas de façon fiable les événements souris
    // pour un geste de type "glisser".
    cell.addEventListener("touchstart", (e) => {
      if (!window.__canManageAppointments) return;
      if (!startDrag(cell)) return;
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("touchcancel", cancelDrag);
    }, { passive: true });
  });
})();

// ── Refresh silencieux (toutes les ~45s) ────────────────────────────────────
// Pour qu'un nouveau RDV pris par un client s'affiche côté admin sans qu'il
// ait à rafraîchir la page. On ne touche JAMAIS toute la page (la grille de
// cellules, ses listeners de clic-glisser, le mini-calendrier... restent
// intouchés) — on remplace uniquement le contenu de chaque colonne de RDV
// (.day-events-col), puis on redemande à initCalendarDensity de repositionner
// les pills (cf. window.__bkRecalcApptPositions ci-dessus). Sans effet en vue
// "mois" (structure différente, pas couverte) ni si l'admin a une modale/
// popup ouverte ou tape dans un champ — pour ne jamais l'interrompre.
(function initSilentRefresh() {
  const section = document.getElementById("calendarSection");
  if (!section || section.classList.contains("u-hidden-month")) return;

  const REFRESH_MS = 45000;
  let inFlight = false;

  function isUserBusy() {
    if (document.getElementById("newApptOverlay")?.classList.contains("show")) return true;
    if (document.getElementById("blockApptOverlay")?.classList.contains("show")) return true;
    if (document.getElementById("apptPopup")?.classList.contains("open")) return true;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return true;
    return false;
  }

  async function silentRefresh() {
    if (inFlight || document.hidden || isUserBusy()) return;
    inFlight = true;
    try {
      const res = await fetch(window.location.href, { headers: { "X-Silent-Refresh": "1" } });
      if (!res.ok) return;
      const html = await res.text();
      // Ne jamais appliquer un résultat arrivé pendant que l'admin a, entre-
      // temps, ouvert une modale ou cliqué sur un RDV.
      if (isUserBusy()) return;

      const doc = new DOMParser().parseFromString(html, "text/html");
      const newCols = doc.querySelectorAll(".day-events-col");
      if (!newCols.length) return;

      newCols.forEach((newCol) => {
        const iso = newCol.dataset.iso;
        const oldCol = section.querySelector(`.day-events-col[data-iso="${iso}"]`);
        if (oldCol) oldCol.replaceWith(newCol);
      });

      if (typeof window.__bkRecalcApptPositions === "function") {
        window.__bkRecalcApptPositions();
      }
    } catch (e) {
      // Silencieux — on retentera au prochain cycle, jamais d'erreur visible
      // pour une simple actualisation en arrière-plan.
    } finally {
      inFlight = false;
    }
  }

  setInterval(silentRefresh, REFRESH_MS);
  // Revenir sur l'onglet après un moment → vérifier tout de suite plutôt
  // que d'attendre le prochain cycle de 45s.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) silentRefresh();
  });
})();

// ── Carte de survol sur les événements du calendrier ────────────────────────
// Une pastille courte (absence de 15 min, RDV express) n'a la place d'afficher
// qu'un nom tronqué : impossible de savoir de quoi il s'agit sans cliquer, et
// plusieurs absences d'affilée deviennent illisibles. Cette carte donne le
// détail complet au survol, sans clic.
//
// Rattachée à <body> et positionnée en `fixed` : ainsi elle n'est jamais
// rognée par le débordement de la grille, contrairement à un pseudo-élément
// CSS posé sur la pastille.
(function () {
  const section = document.querySelector(".grid-section") || document.querySelector(".calendar");
  if (!section) return;

  let card = null;
  let hideTimer = null;

  function ensureCard() {
    if (card) return card;
    card = document.createElement("div");
    card.className = "cal-hover-card";
    card.setAttribute("role", "tooltip");
    document.body.appendChild(card);
    // Pas de listener sur la carte : elle est en `pointer-events: none` (cf.
    // CSS) pour laisser passer la souris vers l'événement qu'elle recouvre.
    return card;
  }

  function hide() {
    if (card) card.classList.remove("is-open");
  }

  // Chaque ligne est ajoutée en textContent (jamais innerHTML) : un nom de
  // client ou un commentaire d'absence est une saisie libre.
  function addRow(parent, label, value, cls) {
    if (!value) return;
    const row = document.createElement("div");
    row.className = cls || "cal-hover-card__row";
    if (label) {
      const l = document.createElement("span");
      l.className = "cal-hover-card__label";
      l.textContent = label;
      row.appendChild(l);
    }
    const v = document.createElement("span");
    v.textContent = value;
    row.appendChild(v);
    parent.appendChild(row);
  }

  function build(el) {
    const c = ensureCard();
    c.textContent = "";
    const d = el.dataset;

    const isBlock = d.isBlock === "1";
    const isCourse = !!d.courseBand;
    const isExternal = el.classList.contains("appt-pill--external");

    let title;
    if (isCourse) title = (el.querySelector(".course-band__name") || {}).textContent || "Cours collectif";
    else if (isBlock) title = "Absence";
    else if (isExternal) title = "Autre événement";
    else title = [d.name, d.surname].filter(Boolean).join(" ") || "Rendez-vous";

    const head = document.createElement("div");
    head.className = "cal-hover-card__title";
    head.textContent = title;
    c.appendChild(head);

    // Horaire : les bandes de cours portent leur plage dans leur propre libellé.
    let when = "";
    if (isCourse) {
      when = ((el.querySelector(".course-band__time") || {}).textContent || "").replace("–", " – ");
    } else if (d.start) {
      when = d.end ? `${d.start} – ${d.end}` : d.start;
    } else if (el.querySelector(".appt-pill__time")) {
      when = el.querySelector(".appt-pill__time").textContent;
    }
    addRow(c, "", when, "cal-hover-card__when");

    if (isCourse) {
      addRow(c, "", d.courseBand === "free"
        ? "Les rendez-vous individuels restent possibles"
        : "Les rendez-vous individuels sont bloqués sur cette plage");
    } else if (isBlock) {
      addRow(c, "Motif : ", d.service);
      addRow(c, "Concerne : ", d.employee || "Toute l'entreprise");
    } else if (!isExternal) {
      addRow(c, "Prestation : ", d.service);
      addRow(c, "Avec : ", d.employee);
      if (d.status === "canceled") addRow(c, "", "Annulé");
      else if (d.status === "pending") addRow(c, "", "En attente");
      else if (d.status === "no-show") addRow(c, "", "Non présenté");
    }
    return c;
  }

  function place(c, el) {
    const r = el.getBoundingClientRect();
    // Mesurer une fois visible, sinon offsetWidth vaut 0 et le calcul de
    // débordement est faux au tout premier survol.
    c.classList.add("is-open");
    const w = c.offsetWidth || 240;
    const h = c.offsetHeight || 80;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    c.style.left = `${Math.max(8, left)}px`;
    c.style.top = `${top}px`;
  }

  const SELECTOR = ".appt-pill, .course-band";

  section.addEventListener("mouseover", (e) => {
    const el = e.target.closest(SELECTOR);
    if (!el || el.classList.contains("appt-pill--summary")) return;
    clearTimeout(hideTimer);
    try {
      place(build(el), el);
    } catch (err) {
      // Un simple confort d'affichage ne doit jamais casser le calendrier.
      hide();
    }
  });

  section.addEventListener("mouseout", (e) => {
    if (!e.target.closest(SELECTOR)) return;
    hideTimer = setTimeout(hide, 120);
  });

  // Un scroll déplace la pastille sous une carte restée en position fixe.
  window.addEventListener("scroll", hide, { passive: true, capture: true });
})();
