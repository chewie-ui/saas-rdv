// ── Prochains créneaux libres, pour la page de recherche ───────────────────
//
// Ce qui différencie BranShee d'un annuaire, c'est qu'on voit les heures
// libres AVANT de cliquer. Le visiteur choisit son créneau depuis la liste des
// résultats au lieu d'ouvrir six fiches pour découvrir que personne n'est
// disponible avant mardi.
//
// D'où une règle absolue ici : un créneau affiché doit être réellement
// réservable. On réutilise donc `getAvailableSlots` (utils/mobileSlots.js),
// qui fait déjà autorité sur les horaires, les congés, les cours collectifs et
// les rendez-vous pris — plutôt que de réimplémenter une grille qui divergerait
// en silence.
//
// Une seule chose lui manque pour le parcours PUBLIC : le délai minimum de
// réservation (`Company.minBookingLeadTime`). Le helper mobile l'ignore
// volontairement — un gérant doit pouvoir caler un rendez-vous dans dix
// minutes — mais le visiteur, lui, se verrait refuser ce créneau à la
// confirmation. On le réapplique donc ci-dessous, avec exactement la même
// règle que booking.controller.js : actif dès que `minutes > 0`, quel que soit
// le drapeau `enabled`.
//
// Coût : ~5 requêtes par établissement et par jour sondé. C'est pour cela que
// l'appelant borne l'appel à la page de résultats affichée, et que l'on
// s'arrête au premier jour qui donne des créneaux.
const Company = require("../db/models/company/company.model");
const { getAvailableSlots } = require("./mobileSlots");

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function dateEnIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmmEnMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

// Quatre créneaux RÉPARTIS sur la journée, et non les quatre premiers.
//
// Un pro dont la grille est calée sur dix minutes donnait « 09:00 09:10 09:20
// 09:30 » : quatre fois la même information, et rien sur l'après-midi. En
// étalant, on répond à la vraie question du visiteur — « est-ce qu'il reste de
// la place quand JE suis libre ? ». Les bornes sont conservées : le premier
// créneau disponible et le dernier de la journée.
function repartir(liste, max) {
  if (liste.length <= max) return liste;
  const choisis = [];
  for (let i = 0; i < max; i++) {
    choisis.push(liste[Math.round((i * (liste.length - 1)) / (max - 1))]);
  }
  return [...new Set(choisis)];
}

// « Aujourd'hui », « Demain », sinon le jour de la semaine.
function libelleDuJour(date, aujourdhui) {
  const jours = Math.round((
    new Date(date.getFullYear(), date.getMonth(), date.getDate()) -
    new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate())
  ) / 86400000);
  if (jours === 0) return "Aujourd'hui";
  if (jours === 1) return "Demain";
  return JOURS[date.getDay()];
}

/**
 * Prochains créneaux libres d'UN établissement.
 * Sonde les jours à partir d'aujourd'hui et s'arrête au premier qui en donne.
 *
 * @returns {{ libelle: string, date: string, slots: string[] }|null}
 *          null si rien n'est ouvert sur la fenêtre, ou en cas d'erreur.
 */
async function creneauxDUnEtablissement(companyId, { jours = 7, max = 4 } = {}) {
  const societe = await Company.findById(companyId)
    .select("minBookingLeadTime slotTime")
    .lean();
  if (!societe) return null;

  // Même lecture que booking.controller.js : le délai s'applique dès que des
  // minutes sont configurées, indépendamment du drapeau `enabled`.
  const delaiMinutes = Math.max(0, Number(societe.minBookingLeadTime?.minutes) || 0);
  const maintenant = new Date();
  const seuil = new Date(maintenant.getTime() + delaiMinutes * 60000);

  for (let i = 0; i < jours; i++) {
    const jour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + i);
    const dateStr = dateEnIso(jour);

    let res;
    try {
      res = await getAvailableSlots({ companyId, dateStr, employeeId: "all" });
    } catch (err) {
      // Un établissement mal configuré ne doit pas priver les autres de leurs
      // créneaux — ni faire tomber la page de recherche.
      console.error(`[searchSlots] ${companyId} le ${dateStr}:`, err.message);
      return null;
    }
    if (res.closed || !res.slots || !res.slots.length) continue;

    // Retrait des créneaux trop proches pour être réservés par un visiteur.
    const minutesSeuil = (() => {
      const memeJour =
        seuil.getFullYear() === jour.getFullYear() &&
        seuil.getMonth() === jour.getMonth() &&
        seuil.getDate() === jour.getDate();
      if (memeJour) return seuil.getHours() * 60 + seuil.getMinutes();
      // Le seuil tombe après ce jour-là : la journée entière est hors délai.
      return seuil > jour ? Infinity : -1;
    })();

    const libres = res.slots.filter((s) => hhmmEnMinutes(s) >= minutesSeuil);
    if (!libres.length) continue;

    return { libelle: libelleDuJour(jour, maintenant), date: dateStr, slots: repartir(libres, max) };
  }

  return null;
}

/**
 * Idem pour une liste d'établissements, en parallèle.
 * Renvoie une Map indexée par identifiant (chaîne) — les établissements sans
 * créneau n'y figurent pas, la vue affiche alors simplement sa carte sans
 * bandeau d'heures.
 */
async function creneauxPourEtablissements(ids, options = {}) {
  const resultats = await Promise.all(
    ids.map((id) =>
      creneauxDUnEtablissement(id, options).catch(() => null)
    )
  );
  const parId = new Map();
  ids.forEach((id, i) => {
    if (resultats[i]) parId.set(String(id), resultats[i]);
  });
  return parId;
}

module.exports = { creneauxDUnEtablissement, creneauxPourEtablissements };
