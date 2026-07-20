const { contextBridge, ipcRenderer } = require("electron");
const api = require("./src/api");

// Pont sécurisé renderer → main : le renderer n'a accès à RIEN d'autre que
// ces fonctions précises (pas de Node.js, pas d'accès disque direct) — toute
// la logique réseau/cookie vit dans le process principal (voir main.js).
contextBridge.exposeInMainWorld("branshee", {
  login: (email, password) => ipcRenderer.invoke("auth:login", email, password),
  verify2FA: (code) => ipcRenderer.invoke("auth:verify2fa", code),
  getMe: () => ipcRenderer.invoke("auth:me"),
  register: (fields) => ipcRenderer.invoke("auth:register", fields),
  getBusinessTypes: () => ipcRenderer.invoke("auth:businessTypes"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getWeek: (dateIso) => ipcRenderer.invoke("agenda:getWeek", dateIso),
  goTo: (page, params) => ipcRenderer.invoke("nav:goTo", page, params),
  BASE_URL: api.BASE_URL,
});
