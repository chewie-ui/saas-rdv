import {
  initDeleteAppointment,
  initCalendarHeader,
} from "../components/admin/appointment.admin.js";

initDeleteAppointment();
initCalendarHeader();

function updateTimeline() {
  const timeline = document.getElementById("current-time-line");
  if (!timeline) return;

  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // Ton planning commence à 09:00
  const startHour = 9;
  const endHour = 18;

  // 1. Vérifier si on est dans la plage horaire
  if (hours < startHour || hours >= endHour) {
    timeline.style.display = "none";
    return;
  }

  // 2. Calculer la position
  // On récupère une cellule "heure" pour connaître la hauteur exacte d'une ligne
  const hourCell = document.querySelector(".cell.time");
  const headerCell = document.querySelector(".cell.day-header");

  if (!hourCell || !headerCell) return;

  const rowHeight = hourCell.offsetHeight;
  const headerHeight = headerCell.offsetHeight;

  // Calcul : Hauteur du header + (Nombre d'heures écoulées * hauteur ligne) + (minutes au prorata)
  const elapsedHours = hours - startHour;
  const topPosition =
    headerHeight + elapsedHours * rowHeight + (minutes / 60) * rowHeight;

  timeline.style.display = "block";
  timeline.style.top = `${topPosition}px`;
}

// Mettre à jour au chargement et toutes les minutes
updateTimeline();
setInterval(updateTimeline, 60000);
