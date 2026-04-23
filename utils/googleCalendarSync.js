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

module.exports = { addEventToCalendar, deleteEventFromCalendar };
