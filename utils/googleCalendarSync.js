const { getCalendarClient } = require("../config/googleCalendar");

/**
 * Crée un événement Google Calendar pour un rendez-vous.
 * Retourne l'ID de l'événement créé, ou null si erreur.
 */
async function addEventToCalendar(refreshToken, booking) {
  const calendar = getCalendarClient(refreshToken);

  // Date au format "YYYY-MM-DD" (UTC) + heure locale → Google Calendar interprète en Europe/Brussels
  const dateStr = booking.date.toISOString().split("T")[0];

  const event = {
    summary: `RDV – ${booking.name} ${booking.surname}`,
    description: [
      `Client : ${booking.name} ${booking.surname}`,
      `Email : ${booking.email}`,
      booking.phone ? `Téléphone : ${booking.phone}` : null,
      booking.message ? `Notes : ${booking.message}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: `${dateStr}T${booking.startTime}:00`,
      timeZone: "Europe/Brussels",
    },
    end: {
      dateTime: `${dateStr}T${booking.endTime}:00`,
      timeZone: "Europe/Brussels",
    },
  };

  const response = await calendar.events.insert({
    calendarId: "primary",
    resource: event,
  });

  return response.data.id || null;
}

/**
 * Supprime un événement Google Calendar par son ID.
 * Silencieux si l'événement n'existe plus (410 Gone).
 */
async function deleteEventFromCalendar(refreshToken, googleEventId) {
  if (!googleEventId) return;

  const calendar = getCalendarClient(refreshToken);

  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId: googleEventId,
    });
  } catch (err) {
    // 410 = already deleted, 404 = not found → pas grave
    if (err.code !== 410 && err.status !== 410 && err.code !== 404 && err.status !== 404) {
      throw err;
    }
  }
}

/**
 * Met à jour un événement Google Calendar existant avec les nouvelles infos du RDV.
 * Si l'événement n'existe plus côté Google (404/410), on le recrée et retourne le nouvel ID.
 * Retourne l'ID de l'événement (inchangé ou nouveau), ou null si erreur.
 */
async function updateEventInCalendar(refreshToken, googleEventId, booking) {
  const calendar = getCalendarClient(refreshToken);

  const dateStr = booking.date.toISOString().split("T")[0];

  const event = {
    summary: `RDV – ${booking.name} ${booking.surname}`,
    description: [
      `Client : ${booking.name} ${booking.surname}`,
      `Email : ${booking.email}`,
      booking.phone ? `Téléphone : ${booking.phone}` : null,
      booking.message ? `Notes : ${booking.message}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: `${dateStr}T${booking.startTime}:00`,
      timeZone: "Europe/Brussels",
    },
    end: {
      dateTime: `${dateStr}T${booking.endTime}:00`,
      timeZone: "Europe/Brussels",
    },
  };

  if (!googleEventId) {
    const response = await calendar.events.insert({ calendarId: "primary", resource: event });
    return response.data.id || null;
  }

  try {
    const response = await calendar.events.update({
      calendarId: "primary",
      eventId: googleEventId,
      resource: event,
    });
    return response.data.id || googleEventId;
  } catch (err) {
    // L'événement n'existe plus côté Google → on le recrée
    if (err.code === 404 || err.status === 404 || err.code === 410 || err.status === 410) {
      const response = await calendar.events.insert({ calendarId: "primary", resource: event });
      return response.data.id || null;
    }
    throw err;
  }
}

/**
 * Récupère les plages "occupées" de l'agenda Google personnel pour une date donnée
 * (journée complète en heure de Bruxelles), via l'API freebusy.
 * Retourne un tableau de { start: Date, end: Date }. En cas d'erreur, retourne [].
 */
async function getBusyIntervals(refreshToken, dateStr) {
  if (!refreshToken) return [];

  try {
    const calendar = getCalendarClient(refreshToken);

    // Journée complète (00:00 → 23:59:59) en heure de Bruxelles
    const timeMin = `${dateStr}T00:00:00`;
    const timeMax = `${dateStr}T23:59:59`;

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: "Europe/Brussels",
        items: [{ id: "primary" }],
      },
    });

    const busy = response.data?.calendars?.primary?.busy || [];
    return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch (err) {
    console.error("[GCal] Erreur freebusy:", err.message);
    return [];
  }
}

module.exports = { addEventToCalendar, deleteEventFromCalendar, updateEventInCalendar, getBusyIntervals };
