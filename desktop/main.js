const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const api = require("./src/api");

// Pas de barre de menu (File/Edit/View/Window/Help) — c'est le menu par
// défaut d'Electron, pas adapté à une appli grand public comme celle-ci.
Menu.setApplicationMenu(null);

let mainWindow = null;

function loadPage(page, params) {
  const options = params ? { search: new URLSearchParams(params).toString() } : undefined;
  mainWindow.loadFile(path.join(__dirname, "renderer", page), options);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: "#f5f4f1",
    icon: path.join(__dirname, "renderer", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadPage(api.isLoggedIn() ? "agenda.html" : "login.html");
}

app.whenReady().then(() => {
  api.init(app.getPath("userData"));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC : auth ────────────────────────────────────────────────────────────
ipcMain.handle("auth:login", async (_event, email, password) => {
  return api.login(email, password);
});

ipcMain.handle("auth:verify2fa", async (_event, code) => {
  return api.verify2FA(code);
});

ipcMain.handle("auth:me", async () => {
  return api.getMe();
});

ipcMain.handle("auth:register", async (_event, fields) => {
  return api.register(fields);
});

ipcMain.handle("auth:businessTypes", async () => {
  return api.getBusinessTypes();
});

ipcMain.handle("auth:logout", async () => {
  const result = await api.logout();
  return result;
});

// ── IPC : agenda ──────────────────────────────────────────────────────────
ipcMain.handle("agenda:getWeek", async (_event, dateIso) => {
  return api.getWeek(dateIso);
});

// ── IPC : navigation entre les écrans ────────────────────────────────────
ipcMain.handle("nav:goTo", async (_event, page, params) => {
  loadPage(page, params);
});
