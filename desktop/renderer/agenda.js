const weekLabelEl = document.getElementById("weekLabel");
const contentEl = document.getElementById("agendaContent");

const HOUR_START = 7; // 07:00
const HOUR_END = 21; // 21:00
const HOUR_HEIGHT = 48; // px par heure

let weekAnchor = new Date();
weekAnchor.setHours(0, 0, 0, 0);
let currentAppointments = [];

function toIsoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatClient(appt) {
  if (appt.isBlock) return "Absent" + (appt.message ? " — " + appt.message : "");
  const full = [appt.surname, appt.name].filter(Boolean).join(" ").trim();
  return full || appt.email || "Client";
}

// ── Répartition en colonnes pour les rendez-vous qui se chevauchent dans le
// temps (style Google Calendar) — algorithme glouton : chaque rdv prend la
// première colonne libre à son heure de début, et sa "largeur" se partage
// uniquement avec les rdv qui le chevauchent réellement, pas avec toute la
// journée. ───────────────────────────────────────────────────────────────
function layoutDay(appts) {
  const sorted = appts.slice().sort((a, b) => a._startMin - b._startMin || a._endMin - b._endMin);
  const columns = [];
  sorted.forEach((appt) => {
    let colIndex = columns.findIndex((col) => appt._startMin >= col[col.length - 1]._endMin);
    if (colIndex === -1) {
      colIndex = columns.length;
      columns.push([]);
    }
    columns[colIndex].push(appt);
    appt._col = colIndex;
  });
  sorted.forEach((appt) => {
    const overlapping = sorted.filter((o) => o._startMin < appt._endMin && o._endMin > appt._startMin);
    appt._colCount = Math.max(...overlapping.map((o) => o._col)) + 1;
  });
  return sorted;
}

function buildCalendarSkeleton() {
  const hourCount = HOUR_END - HOUR_START;

  let daynamesHtml = '<div class="agenda__corner"></div>';
  let dayOverlaysHtml = "";
  let hoursBgHtml = "";

  // En-têtes des 7 jours
  contentEl.querySelectorAll(".agenda__day-head[data-iso]").forEach((el) => el.remove());

  for (let h = 0; h < hourCount; h++) {
    hoursBgHtml += `<div class="agenda__hour-label">${String(HOUR_START + h).padStart(2, "0")}:00</div>`;
    for (let d = 0; d < 7; d++) {
      hoursBgHtml += `<div class="agenda__hour-cell" style="height:${HOUR_HEIGHT}px"></div>`;
    }
  }
  for (let d = 0; d < 7; d++) {
    dayOverlaysHtml += `<div class="agenda__day-overlay" data-day-index="${d}"></div>`;
  }

  return { daynamesHtml, hoursBgHtml, dayOverlaysHtml, totalHeight: hourCount * HOUR_HEIGHT };
}

function renderCalendar(weekDays, appointments) {
  const skeleton = buildCalendarSkeleton();

  contentEl.innerHTML = `
    <div class="agenda__calendar">
      <div class="agenda__daynames" id="agendaDaynames"></div>
      <div class="agenda__body-wrap">
        <div class="agenda__hours-bg" style="grid-auto-rows:${HOUR_HEIGHT}px">${skeleton.hoursBgHtml}</div>
        <div class="agenda__overlay" style="height:${skeleton.totalHeight}px">${skeleton.dayOverlaysHtml}</div>
      </div>
    </div>
  `;

  const daynamesEl = document.getElementById("agendaDaynames");
  daynamesEl.innerHTML =
    '<div class="agenda__corner"></div>' +
    weekDays
      .map(
        (day) => `
      <div class="agenda__day-head${day.isToday ? " is-today" : ""}">
        <div class="agenda__day-head__weekday">${day.longLabel.slice(0, 3)}</div>
        <div class="agenda__day-head__num">${day.dayNumber}</div>
      </div>
    `
      )
      .join("");

  // Regroupe par jour, calcule les minutes depuis le début de grille, puis
  // place chaque rdv dans le bon overlay (un par jour, position absolue).
  const byDate = new Map();
  appointments.forEach((appt) => {
    const key = toIsoDate(new Date(appt.date));
    if (!byDate.has(key)) byDate.set(key, []);
    appt._startMin = timeToMinutes(appt.startTime);
    appt._endMin = Math.max(appt._startMin + 1, timeToMinutes(appt.endTime));
    byDate.get(key).push(appt);
  });

  weekDays.forEach((day, dayIndex) => {
    const overlay = contentEl.querySelector(`.agenda__day-overlay[data-day-index="${dayIndex}"]`);
    const dayAppts = layoutDay(byDate.get(day.isoDate) || []);
    const gridStartMin = HOUR_START * 60;
    const gridEndMin = HOUR_END * 60;

    overlay.innerHTML = dayAppts
      .map((appt) => {
        const top = Math.max(0, ((appt._startMin - gridStartMin) / 60) * HOUR_HEIGHT);
        const height = Math.max(16, ((Math.min(appt._endMin, gridEndMin) - Math.max(appt._startMin, gridStartMin)) / 60) * HOUR_HEIGHT);
        const widthPct = 100 / appt._colCount;
        const leftPct = appt._col * widthPct;
        const isCanceled = appt.status === "canceled";
        const bg = appt.isBlock ? "" : isCanceled ? "" : appt.serviceColor || "#1e7a4e";
        const title = appt.isBlock ? "Absent" : appt.serviceName || "Rendez-vous";
        return `
          <div class="agenda__appt${isCanceled ? " is-canceled" : ""}${appt.isBlock ? " is-block" : ""}"
               style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);${bg ? `background:${bg}` : ""}"
               data-idx="${currentAppointments.indexOf(appt)}">
            <span class="agenda__appt__time">${appt.startTime}</span>
            <span class="agenda__appt__title">${appt.isBlock ? title : title + " — " + formatClient(appt)}</span>
          </div>
        `;
      })
      .join("");
  });

  contentEl.querySelectorAll(".agenda__appt").forEach((el) => {
    el.addEventListener("click", () => openPopup(currentAppointments[Number(el.dataset.idx)]));
  });
}

function openPopup(appt) {
  document.getElementById("apptPopupDot").style.background = appt.isBlock ? "#9ca3af" : appt.serviceColor || "#1e7a4e";
  document.getElementById("apptPopupTitle").textContent = appt.isBlock
    ? "Absent" + (appt.message ? " — " + appt.message : "")
    : appt.serviceName || "Rendez-vous";
  const d = new Date(appt.date);
  const dateLabel = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("apptPopupDatetime").textContent = `${dateLabel} · ${appt.startTime} – ${appt.endTime}`;

  const serviceRow = document.getElementById("apptPopupServiceRow");
  if (appt.isBlock) {
    serviceRow.hidden = true;
  } else {
    serviceRow.hidden = false;
    document.getElementById("apptPopupService").textContent = formatClient(appt);
  }

  const employeeRow = document.getElementById("apptPopupEmployeeRow");
  if (appt.employeeName) {
    employeeRow.hidden = false;
    document.getElementById("apptPopupEmployee").textContent = appt.employeeName;
  } else {
    employeeRow.hidden = true;
  }

  document.getElementById("apptPopupOverlay").hidden = false;
}

document.getElementById("apptPopupClose").addEventListener("click", () => {
  document.getElementById("apptPopupOverlay").hidden = true;
});
document.getElementById("apptPopupOverlay").addEventListener("click", (e) => {
  if (e.target.id === "apptPopupOverlay") e.target.hidden = true;
});

async function loadWeek() {
  contentEl.innerHTML = '<p class="agenda__loading">Chargement de vos rendez-vous…</p>';
  const result = await window.branshee.getWeek(toIsoDate(weekAnchor));

  if (!result.ok) {
    contentEl.innerHTML = `<p class="agenda__empty-global">Impossible de charger l'agenda : ${result.error}</p>`;
    return;
  }

  const { weekDays, appointments } = result.data;
  currentAppointments = appointments;
  const first = weekDays[0], last = weekDays[weekDays.length - 1];
  weekLabelEl.textContent = `${first.date} – ${last.date}`;
  renderCalendar(weekDays, appointments);
}

document.getElementById("prevWeek").addEventListener("click", () => {
  weekAnchor.setDate(weekAnchor.getDate() - 7);
  loadWeek();
});

document.getElementById("nextWeek").addEventListener("click", () => {
  weekAnchor.setDate(weekAnchor.getDate() + 7);
  loadWeek();
});

document.getElementById("todayBtn").addEventListener("click", () => {
  weekAnchor = new Date();
  weekAnchor.setHours(0, 0, 0, 0);
  loadWeek();
});

mountSidebar("agenda");
loadWeek();
