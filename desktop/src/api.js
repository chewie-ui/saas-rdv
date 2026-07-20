// Client HTTP vers le backend BranShee existant (Node/Express/MongoDB) — le
// desktop ne touche JAMAIS la base de données directement, il passe par les
// mêmes routes que le site web, avec la même authentification par cookie de
// session (express-session). On gère ce cookie nous-mêmes ici (un seul cookie
// "connect.sid" à suivre, donc une mini gestion suffit, pas besoin d'un vrai
// "cookie jar" complet) et on le persiste sur disque pour rester connecté
// entre deux lancements de l'application.

const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.BRANSHEE_API_URL || "https://www.branshee.com").replace(/\/$/, "");

let cookieFilePath = null;
let sessionCookie = null;

function init(userDataDir) {
  cookieFilePath = path.join(userDataDir, "session-cookie.json");
  try {
    const raw = fs.readFileSync(cookieFilePath, "utf8");
    sessionCookie = JSON.parse(raw).cookie || null;
  } catch (_) {
    sessionCookie = null;
  }
}

function persistCookie() {
  if (!cookieFilePath) return;
  try {
    fs.writeFileSync(cookieFilePath, JSON.stringify({ cookie: sessionCookie }), "utf8");
  } catch (err) {
    console.error("[api] échec sauvegarde cookie:", err.message);
  }
}

function captureSetCookie(res) {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return;
  // On ne garde que la paire nom=valeur (avant le premier `;`) — les
  // attributs (Path, HttpOnly, SameSite...) ne concernent que le navigateur,
  // pas notre rejeu manuel côté client desktop.
  const pair = setCookie.split(";")[0];
  if (pair.startsWith("connect.sid=")) {
    sessionCookie = pair;
    persistCookie();
  }
}

function clearCookie() {
  sessionCookie = null;
  persistCookie();
}

function isLoggedIn() {
  return !!sessionCookie;
}

async function request(method, urlPath, body) {
  const headers = { "X-Requested-With": "fetch" };
  if (sessionCookie) headers["Cookie"] = sessionCookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual", // on gère nous-mêmes la suite, pas de redirection HTML automatique
  });
  captureSetCookie(res);

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // Réponse non-JSON (ex: redirection HTML) — pas un succès exploitable ici.
  }

  if (!data) {
    return { ok: false, status: res.status, error: "Réponse inattendue du serveur." };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: data.error || "Erreur serveur." };
  }
  return { ok: true, status: res.status, data };
}

async function login(email, password) {
  return request("POST", "/login", { email, password });
}

async function getBusinessTypes() {
  return request("GET", "/api/business-types");
}

async function register(fields) {
  return request("POST", "/register", fields);
}

async function verify2FA(code) {
  return request("POST", "/login/2fa", { code });
}

async function getMe() {
  return request("GET", "/me");
}

async function getWeek(dateIso) {
  return request("GET", `/appointment/week-data?date=${encodeURIComponent(dateIso)}`);
}

async function logout() {
  const result = await request("GET", "/logout");
  clearCookie();
  return result;
}

module.exports = { init, login, register, getBusinessTypes, verify2FA, getMe, getWeek, logout, isLoggedIn, BASE_URL };
