// ── API mobile : clients & dossiers ───────────────────────────────────────
//   GET    /clients                 liste agrégée (1 ligne par client)
//   GET    /clients/:bookingId      fiche : historique + dossier de suivi
//   PATCH  /clients/:bookingId      notes générales, contacts alternatifs
//   PATCH  /clients/:bookingId/block             bloquer / débloquer
//   POST   /clients/:bookingId/dossier/entries            ajouter une entrée
//   PATCH  /clients/:bookingId/dossier/entries/:entryId   modifier
//   DELETE /clients/:bookingId/dossier/entries/:entryId   supprimer
//   GET    /clients/:bookingId/dossier/entries/:entryId/file  lire le PDF
//
// Un « client » n'est pas une collection : c'est un regroupement des
// réservations par email (puis téléphone, puis nom) — même clé que le web
// (admin.controller.js#clientsHubInit). Le dossier de suivi, lui, est un
// document ClientDossier identifié par (établissement, email).
const Booking = require("../../db/models/book.model");
const ClientDossier = require("../../db/models/clientDossier.model");
const { serializeBooking } = require("./_helpers");
const { logActivity } = require("../../utils/activityLog");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Longueurs maximales, identiques au web (admin.controller#clientsHubDossier*).
const MAX_TITLE = 200;
const MAX_NOTE = 5000;
const MAX_TODO = 2000;

// Clé de regroupement d'un client, identique au web.
function clientKey(b) {
  return (
    (b.email && b.email.trim().toLowerCase()) ||
    (b.phone && b.phone.trim()) ||
    ((`${b.name || ""} ${b.surname || ""}`).trim().toLowerCase()) ||
    String(b._id)
  );
}

function stateOf(b) {
  const s = (b.status || "confirmed").toLowerCase();
  if (b.noShow) return "noshow";
  return s === "canceled" || s === "cancelled" ? "canceled" : "confirmed";
}

// GET /api/v1/clients
exports.list = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const search = String(req.query.search || "").trim().toLowerCase();

    // Les blocs d'indisponibilité n'ont pas de client.
    const bookings = await Booking.find({ company: companyId, isBlock: { $ne: true } })
      .sort({ date: -1, startTime: -1 })
      .lean();

    const map = new Map();
    for (const b of bookings) {
      const key = clientKey(b);
      let c = map.get(key);
      if (!c) {
        // Premier rencontré = le plus récent (tri décroissant) → « dernier RDV ».
        c = {
          key,
          name: b.name || "",
          surname: b.surname || "",
          email: b.email || "",
          phone: b.phone || "",
          count: 0,
          lastDate: b.date,
          lastTime: b.startTime || "",
          lastState: stateOf(b),
          lastBookingId: String(b._id),
          empCounts: {},
        };
        map.set(key, c);
      }
      c.count++;
      if (b.employeeName) c.empCounts[b.employeeName] = (c.empCounts[b.employeeName] || 0) + 1;
      // Compléter depuis un RDV plus ancien si l'info manquait.
      if (!c.name && b.name) c.name = b.name;
      if (!c.surname && b.surname) c.surname = b.surname;
      if (!c.email && b.email) c.email = b.email;
      if (!c.phone && b.phone) c.phone = b.phone;
    }

    let clients = Array.from(map.values()).map((c) => {
      let employeeName = "";
      let max = 0;
      for (const [k, v] of Object.entries(c.empCounts)) {
        if (v > max) { max = v; employeeName = k; }
      }
      return {
        id: c.lastBookingId, // identifiant de la fiche (comme le web)
        name: c.name,
        surname: c.surname,
        fullName: `${c.name} ${c.surname}`.trim(),
        email: c.email,
        phone: c.phone,
        count: c.count,
        lastDate: c.lastDate,
        lastTime: c.lastTime,
        lastState: c.lastState,
        employeeName,
      };
    });

    // Surnoms et clients bloqués, depuis les dossiers.
    const emails = clients.map((c) => c.email.trim().toLowerCase()).filter(Boolean);
    if (emails.length) {
      const dossiers = await ClientDossier.find({ company: companyId, email: { $in: emails } })
        .select("email altName blocked").lean();
      const byEmail = {};
      dossiers.forEach((d) => { byEmail[d.email] = d; });
      clients.forEach((c) => {
        const d = byEmail[c.email.trim().toLowerCase()];
        c.altName = d?.altName || "";
        c.blocked = Boolean(d?.blocked);
      });
    }

    if (search) {
      clients = clients.filter((c) =>
        [c.fullName, c.email, c.phone, c.altName, c.employeeName]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(search)),
      );
    }

    clients.sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));

    res.json({ count: clients.length, clients });
  } catch (err) {
    console.error("[mobile clients list]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// Résout le client à partir d'un de ses RDV (scopé à l'établissement).
async function resolveClient(companyId, bookingId) {
  if (!OBJECT_ID.test(bookingId)) return null;
  const ref = await Booking.findOne({ _id: bookingId, company: companyId }).lean();
  if (!ref) return null;

  const email = (ref.email || "").trim().toLowerCase();
  // Tous les RDV du même client : par email si connu, sinon ce RDV seul.
  const bookings = email
    ? await Booking.find({ company: companyId, isBlock: { $ne: true }, email })
        .sort({ date: -1, startTime: -1 })
        .populate("employee", "fullName")
        .lean()
    : [ref];

  const dossier = email
    ? await ClientDossier.findOne({ company: companyId, email }).lean()
    : null;

  return { ref, email, bookings, dossier };
}

// Forme d'une entrée de suivi renvoyée à l'app (identique en lecture et en
// écriture, pour que l'app n'ait qu'un seul type à connaître).
function serializeEntry(e) {
  return {
    id: String(e._id),
    date: e.date,
    title: e.title || "",
    note: e.note || "",
    todo: e.todo || "",
    hasAttachment: Boolean(e.attachment?.path),
    attachmentName: e.attachment?.filename || "",
  };
}

// GET /api/v1/clients/:bookingId
exports.detail = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const found = await resolveClient(companyId, req.params.bookingId);
    if (!found) return res.status(404).json({ error: "not_found", message: "Client introuvable." });

    const { ref, bookings, dossier } = found;
    const confirmed = bookings.filter((b) => b.status !== "canceled");

    res.json({
      client: {
        id: String(ref._id),
        name: ref.name || "",
        surname: ref.surname || "",
        fullName: `${ref.name || ""} ${ref.surname || ""}`.trim(),
        email: ref.email || "",
        phone: ref.phone || "",
        altName: dossier?.altName || "",
        altEmail: dossier?.altEmail || "",
        altPhone: dossier?.altPhone || "",
        generalInfo: dossier?.generalInfo || "",
        blocked: Boolean(dossier?.blocked),
        blockedReason: dossier?.blockedReason || "",
        totalBookings: bookings.length,
        confirmedBookings: confirmed.length,
        noShows: bookings.filter((b) => b.noShow).length,
      },
      bookings: bookings.map(serializeBooking),
      // Entrées de suivi, la plus récente d'abord.
      entries: (dossier?.entries || [])
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(serializeEntry),
    });
  } catch (err) {
    console.error("[mobile client detail]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/clients/:bookingId — notes générales et contacts alternatifs.
exports.update = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const found = await resolveClient(companyId, req.params.bookingId);
    if (!found) return res.status(404).json({ error: "not_found", message: "Client introuvable." });
    if (!found.email) {
      return res.status(400).json({
        error: "no_email",
        message: "Ce client n'a pas d'email : impossible de lui créer un dossier.",
      });
    }

    const updates = {};
    ["altName", "altEmail", "altPhone", "generalInfo"].forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = String(req.body[k]);
    });
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "nothing_to_update", message: "Aucune modification fournie." });
    }

    const dossier = await ClientDossier.findOneAndUpdate(
      { company: companyId, email: found.email },
      {
        $set: updates,
        $setOnInsert: {
          company: companyId,
          email: found.email,
          fullName: `${found.ref.name || ""} ${found.ref.surname || ""}`.trim(),
          phone: found.ref.phone || "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({
      ok: true,
      client: {
        altName: dossier.altName || "",
        altEmail: dossier.altEmail || "",
        altPhone: dossier.altPhone || "",
        generalInfo: dossier.generalInfo || "",
      },
    });
  } catch (err) {
    console.error("[mobile client update]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/clients/:bookingId/block — bloquer ou débloquer.
exports.block = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const found = await resolveClient(companyId, req.params.bookingId);
    if (!found) return res.status(404).json({ error: "not_found", message: "Client introuvable." });
    if (!found.email) {
      return res.status(400).json({ error: "no_email", message: "Ce client n'a pas d'email." });
    }

    const blocked = Boolean(req.body.blocked);
    const dossier = await ClientDossier.findOneAndUpdate(
      { company: companyId, email: found.email },
      {
        $set: {
          blocked,
          blockedAt: blocked ? new Date() : null,
          blockedReason: blocked ? String(req.body.reason || "").slice(0, 300) : "",
        },
        $setOnInsert: { company: companyId, email: found.email },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({ ok: true, blocked: Boolean(dossier.blocked), blockedReason: dossier.blockedReason || "" });
  } catch (err) {
    console.error("[mobile client block]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── Entrées du dossier de suivi ───────────────────────────────────────────
// Mêmes règles que le web (admin.controller#clientsHubDossierAdd/Update/Delete).
// L'app n'envoie que du texte : les pièces jointes PDF restent créées depuis le
// site, on se contente de ne jamais les perdre.

// Charge (ou crée) le dossier en document Mongoose — non `lean` : on manipule
// les sous-documents `entries` (.id(), .push(), .deleteOne()).
async function getOrCreateDossierDoc(companyId, found) {
  let dossier = await ClientDossier.findOne({ company: companyId, email: found.email });
  if (!dossier) {
    dossier = await ClientDossier.create({
      company: companyId,
      email: found.email,
      fullName: `${found.ref.name || ""} ${found.ref.surname || ""}`.trim(),
      phone: found.ref.phone || "",
    });
  }
  return dossier;
}

// Date d'une entrée : `undefined` si non fournie, `null` si illisible.
// L'app envoie "YYYY-MM-DD" : new Date(s) le lit en minuit UTC — surtout pas
// new Date(y, m-1, d) (minuit local), qui décalerait l'entrée d'un jour.
function parseEntryDate(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const s = String(raw).trim();
  if (!DATE_ONLY.test(s) && !/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Racine des fichiers privés — hors du dossier public (RGPD : ces PDF peuvent
// contenir des données de santé). Identique au web (admin.controller#_dossierRoot).
function dossierRoot() {
  return require("path").join(__dirname, "..", "..", "private_uploads");
}

// Chemin absolu d'une pièce jointe, ou null si le chemin stocké sort de la
// racine privée (protection anti-traversée « ../ », comme sur le web).
function resolveAttachmentPath(relPath) {
  if (!relPath) return null;
  const path = require("path");
  const root = dossierRoot();
  const full = path.join(root, relPath);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

// Supprime le PDF associé à une entrée (stocké hors du dossier public, RGPD).
// Best-effort : la suppression de l'entrée ne doit pas échouer pour un fichier
// déjà absent du disque.
function deleteEntryFile(relPath) {
  if (!relPath) return;
  try {
    const fs = require("fs");
    const full = resolveAttachmentPath(relPath);
    if (full && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) {
    console.error("[mobile dossier file]", e.message);
  }
}

// Résout le client puis son dossier ; renvoie la réponse d'erreur si besoin.
async function loadDossierFor(req, res) {
  const companyId = req.companyCtx.currentCompany._id;
  const found = await resolveClient(companyId, req.params.bookingId);
  if (!found) {
    res.status(404).json({ error: "not_found", message: "Client introuvable." });
    return null;
  }
  if (!found.email) {
    res.status(400).json({
      error: "no_email",
      message: "Ce client n'a pas d'email : impossible de lui créer un dossier.",
    });
    return null;
  }
  const dossier = await getOrCreateDossierDoc(companyId, found);
  return { companyId, found, dossier };
}

// POST /api/v1/clients/:bookingId/dossier/entries
exports.addEntry = async (req, res) => {
  try {
    const ctx = await loadDossierFor(req, res);
    if (!ctx) return;

    const title = String(req.body.title || "").trim();
    const note = String(req.body.note || "").trim();
    const todo = String(req.body.todo || "").trim();
    // Comme sur le web : un titre OU une note suffit, mais pas une entrée vide.
    if (!title && !note) {
      return res.status(400).json({
        error: "empty_entry",
        message: "Ajoutez au moins un titre ou une note.",
      });
    }

    const date = parseEntryDate(req.body.date);
    if (date === null) {
      return res.status(400).json({ error: "bad_date", message: "Date invalide." });
    }

    ctx.dossier.entries.push({
      date: date || new Date(),
      title: title.slice(0, MAX_TITLE),
      note: note.slice(0, MAX_NOTE),
      todo: todo.slice(0, MAX_TODO),
    });
    await ctx.dossier.save();

    const entry = ctx.dossier.entries[ctx.dossier.entries.length - 1];

    logActivity({
      company: ctx.companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "client.dossier.entry.add",
      description: `a ajouté une entrée au dossier de ${ctx.dossier.fullName || ctx.found.email}`,
    });

    res.status(201).json({ ok: true, entry: serializeEntry(entry) });
  } catch (err) {
    console.error("[mobile dossier add]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/clients/:bookingId/dossier/entries/:entryId
exports.updateEntry = async (req, res) => {
  try {
    if (!OBJECT_ID.test(req.params.entryId)) {
      return res.status(404).json({ error: "not_found", message: "Entrée introuvable." });
    }
    const ctx = await loadDossierFor(req, res);
    if (!ctx) return;

    const entry = ctx.dossier.entries.id(req.params.entryId);
    if (!entry) {
      return res.status(404).json({ error: "not_found", message: "Entrée introuvable." });
    }

    const date = parseEntryDate(req.body.date);
    if (date === null) {
      return res.status(400).json({ error: "bad_date", message: "Date invalide." });
    }

    let touched = false;
    if (date !== undefined) { entry.date = date; touched = true; }
    if (req.body.title !== undefined) {
      entry.title = String(req.body.title || "").trim().slice(0, MAX_TITLE);
      touched = true;
    }
    if (req.body.note !== undefined) {
      entry.note = String(req.body.note || "").trim().slice(0, MAX_NOTE);
      touched = true;
    }
    if (req.body.todo !== undefined) {
      entry.todo = String(req.body.todo || "").trim().slice(0, MAX_TODO);
      touched = true;
    }
    if (!touched) {
      return res.status(400).json({ error: "nothing_to_update", message: "Aucune modification fournie." });
    }
    // Une entrée sans titre ni note n'a plus rien à afficher : on la refuse
    // plutôt que de laisser une ligne vide dans le dossier.
    if (!entry.title && !entry.note) {
      return res.status(400).json({
        error: "empty_entry",
        message: "Gardez au moins un titre ou une note.",
      });
    }

    await ctx.dossier.save();

    logActivity({
      company: ctx.companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "client.dossier.entry.update",
      description: `a modifié une entrée du dossier de ${ctx.dossier.fullName || ctx.found.email}`,
    });

    res.json({ ok: true, entry: serializeEntry(entry) });
  } catch (err) {
    console.error("[mobile dossier update]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/clients/:bookingId/dossier/entries/:entryId
exports.deleteEntry = async (req, res) => {
  try {
    if (!OBJECT_ID.test(req.params.entryId)) {
      return res.status(404).json({ error: "not_found", message: "Entrée introuvable." });
    }
    const ctx = await loadDossierFor(req, res);
    if (!ctx) return;

    const entry = ctx.dossier.entries.id(req.params.entryId);
    if (!entry) {
      return res.status(404).json({ error: "not_found", message: "Entrée introuvable." });
    }

    const attachmentPath = entry.attachment && entry.attachment.path;
    entry.deleteOne();
    await ctx.dossier.save();
    // Après la sauvegarde seulement : si l'écriture échoue, le PDF reste lié.
    deleteEntryFile(attachmentPath);

    logActivity({
      company: ctx.companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "client.dossier.entry.delete",
      description: `a supprimé une entrée du dossier de ${ctx.dossier.fullName || ctx.found.email}`,
    });

    res.json({ ok: true, id: req.params.entryId });
  } catch (err) {
    console.error("[mobile dossier delete]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/clients/:bookingId/dossier/entries/:entryId/file
// Renvoie le PDF d'une entrée. Ces fichiers vivent hors du dossier public et
// ne sont JAMAIS servis en statique : chaque lecture repasse par cette route,
// scopée à l'établissement (RGPD — données potentiellement de santé).
exports.entryFile = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(req.params.bookingId) || !OBJECT_ID.test(req.params.entryId)) {
      return res.status(404).json({ error: "not_found", message: "Fichier introuvable." });
    }

    // Le RDV sert de clé d'entrée à la fiche : il doit appartenir à cet
    // établissement, sinon un identifiant deviné donnerait accès au dossier.
    const booking = await Booking.findOne({ _id: req.params.bookingId, company: companyId })
      .select("email")
      .lean();
    const email = (booking?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(404).json({ error: "not_found", message: "Client introuvable." });
    }

    const dossier = await ClientDossier.findOne({ company: companyId, email })
      .select("entries")
      .lean();
    const entry = (dossier?.entries || []).find((e) => String(e._id) === req.params.entryId);
    if (!entry || !entry.attachment || !entry.attachment.path) {
      return res.status(404).json({ error: "no_attachment", message: "Cette entrée n'a pas de pièce jointe." });
    }

    // Anti-traversée de chemin, comme le web : le chemin stocké doit rester
    // sous private_uploads/, quoi qu'il contienne.
    const fs = require("fs");
    const full = resolveAttachmentPath(entry.attachment.path);
    if (!full || !fs.existsSync(full)) {
      return res.status(404).json({ error: "file_missing", message: "Le fichier n'est plus disponible." });
    }

    const safeName = (entry.attachment.filename || "document.pdf").replace(/[^\w.\- ]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    // Jamais de cache : ni proxy, ni disque du téléphone.
    res.setHeader("Cache-Control", "no-store, private");
    return res.sendFile(full, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "server_error", message: "Erreur serveur." });
      }
    });
  } catch (err) {
    console.error("[mobile dossier file get]", err);
    if (!res.headersSent) res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
