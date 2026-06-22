const Booking = require("../db/models/book.model");
const ClientDossier = require("../db/models/clientDossier.model");

function normalizeEmail(email) {
  return (email || "").toLowerCase().trim();
}

// ── Liste des clients de l'entreprise (déduits des réservations) ──────────────
exports.listClients = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const search = (req.query.search || "").toLowerCase().trim();

    const bookings = await Booking.find({ company: companyId })
      .select("name surname email phone date clientRef")
      .sort({ date: -1 })
      .lean();

    const now = new Date();
    const byEmail = new Map();

    for (const b of bookings) {
      const email = normalizeEmail(b.email);
      if (!email) continue;

      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          fullName: [b.name, b.surname].filter(Boolean).join(" ").trim() || email,
          phone: b.phone || "",
          clientRef: b.clientRef || null,
          bookingsCount: 0,
          lastVisit: null,
          nextVisit: null,
        });
      }

      const c = byEmail.get(email);
      c.bookingsCount += 1;
      const bd = new Date(b.date);
      if (bd <= now && (!c.lastVisit || bd > c.lastVisit)) c.lastVisit = bd;
      if (bd > now && (!c.nextVisit || bd < c.nextVisit)) c.nextVisit = bd;
    }

    let clients = Array.from(byEmail.values());

    if (search) {
      clients = clients.filter(
        (c) =>
          c.fullName.toLowerCase().includes(search) ||
          c.email.includes(search) ||
          (c.phone || "").includes(search)
      );
    }

    clients.sort((a, b) => {
      const at = a.lastVisit || a.nextVisit || new Date(0);
      const bt = b.lastVisit || b.nextVisit || new Date(0);
      return new Date(bt) - new Date(at);
    });

    const dossiers = await ClientDossier.find({
      company: companyId,
      email: { $in: clients.map((c) => c.email) },
    })
      .select("email entries")
      .lean();
    const entriesByEmail = new Map(dossiers.map((d) => [d.email, d.entries.length]));

    clients = clients.map((c) => ({
      ...c,
      entriesCount: entriesByEmail.get(c.email) || 0,
    }));

    res.render("admin/clients", {
      pageName: "Clients",
      title: "Clients",
      clients,
      search: req.query.search || "",
    });
  } catch (err) {
    console.error("listClients error:", err);
    res.render("admin/clients", { pageName: "Clients", title: "Clients", clients: [], search: "" });
  }
};

// ── Dossier d'un client (créé à la première consultation) ─────────────────────
exports.viewClient = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const email = normalizeEmail(decodeURIComponent(req.params.email || ""));
    if (!email) return res.redirect("/clients");

    const allBookings = await Booking.find({ company: companyId }).sort({ date: -1 }).lean();
    const bookings = allBookings.filter((b) => normalizeEmail(b.email) === email);
    if (!bookings.length) return res.redirect("/clients");

    const latest = bookings[0];
    const fullName = [latest.name, latest.surname].filter(Boolean).join(" ").trim() || email;

    let dossier = await ClientDossier.findOne({ company: companyId, email });
    if (!dossier) {
      dossier = await ClientDossier.create({
        company: companyId,
        email,
        fullName,
        phone: latest.phone || "",
        clientRef: latest.clientRef || null,
        generalInfo: "",
        entries: [],
      });
    }

    const now = new Date();
    const lastVisit = bookings.find((b) => new Date(b.date) <= now) || null;
    const nextVisit = [...bookings].reverse().find((b) => new Date(b.date) > now) || null;

    const entries = [...dossier.entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.render("admin/client-dossier", {
      pageName: "Clients",
      title: `Dossier — ${fullName}`,
      dossier,
      entries,
      client: { email, fullName, phone: dossier.phone || latest.phone || "" },
      bookings,
      lastVisit,
      nextVisit,
    });
  } catch (err) {
    console.error("viewClient error:", err);
    res.redirect("/clients");
  }
};

// ── Sauvegarder le bloc "infos générales" (antécédents, allergies...) ────────
exports.updateGeneralInfo = async (req, res) => {
  try {
    const dossier = await ClientDossier.findOne({
      _id: req.params.dossierId,
      company: res.locals.currentCompany._id,
    });
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable." });

    dossier.generalInfo = (req.body.generalInfo || "").slice(0, 5000);
    await dossier.save();
    res.json({ success: true });
  } catch (err) {
    console.error("updateGeneralInfo error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Ajouter une entrée (note de visite) ───────────────────────────────────────
exports.addEntry = async (req, res) => {
  try {
    const note = (req.body.note || "").trim();
    if (!note) return res.status(400).json({ error: "La note ne peut pas être vide." });

    const dossier = await ClientDossier.findOne({
      _id: req.params.dossierId,
      company: res.locals.currentCompany._id,
    });
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable." });

    dossier.entries.push({
      date: req.body.date ? new Date(req.body.date) : new Date(),
      note: note.slice(0, 5000),
      todo: (req.body.todo || "").trim().slice(0, 2000),
    });
    await dossier.save();

    const entry = dossier.entries[dossier.entries.length - 1];
    res.json({ success: true, entry });
  } catch (err) {
    console.error("addEntry error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Modifier une entrée existante ─────────────────────────────────────────────
exports.updateEntry = async (req, res) => {
  try {
    const dossier = await ClientDossier.findOne({
      _id: req.params.dossierId,
      company: res.locals.currentCompany._id,
    });
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable." });

    const entry = dossier.entries.id(req.params.entryId);
    if (!entry) return res.status(404).json({ error: "Note introuvable." });

    const note = (req.body.note || "").trim();
    if (!note) return res.status(400).json({ error: "La note ne peut pas être vide." });

    entry.note = note.slice(0, 5000);
    entry.todo = (req.body.todo || "").trim().slice(0, 2000);
    if (req.body.date) entry.date = new Date(req.body.date);

    await dossier.save();
    res.json({ success: true, entry });
  } catch (err) {
    console.error("updateEntry error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Supprimer une entrée ──────────────────────────────────────────────────────
exports.deleteEntry = async (req, res) => {
  try {
    const dossier = await ClientDossier.findOne({
      _id: req.params.dossierId,
      company: res.locals.currentCompany._id,
    });
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable." });

    dossier.entries.pull(req.params.entryId);
    await dossier.save();
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEntry error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};
