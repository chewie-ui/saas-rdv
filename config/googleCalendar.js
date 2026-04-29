const { google } = require("googleapis");

/**
 * Crée un client OAuth2 Google.
 * Si redirectUri est fourni, on l'utilise (dynamique depuis la requête).
 * Sinon on tombe sur GOOGLE_REDIRECT_URI du .env (fallback).
 */
function createOAuthClient(redirectUri) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI
  );
}

function getCalendarClient(refreshToken) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.calendar({
    version: "v3",
    auth: oauth2Client,
  });
}

module.exports = {
  createOAuthClient,
  getCalendarClient,
};