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

    const bookings = await Booking.find({ company: companyId, status: { $ne: "canceled" } })
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
      .select("email entries blocked blockedReason")
      .lean();
    const entriesByEmail = new Map(dossiers.map((d) => [d.email, d.entries.length]));
    const blockedByEmail = new Map(dossiers.filter((d) => d.blocked).map((d) => [d.email, d.blockedReason || ""]));

    clients = clients.map((c) => ({
      ...c,
      entriesCount: entriesByEmail.get(c.email) || 0,
      blocked: blockedByEmail.has(c.email),
      blockedReason: blockedByEmail.get(c.email) || "",
    }));

    const onlyBlocked = req.query.blocked === "1";
    const blockedCount = clients.filter((c) => c.blocked).length;
    if (onlyBlocked) clients = clients.filter((c) => c.blocked);

    res.render("admin/clients", {
      pageName: "Clients",
      title: "Clients",
      clients,
      search: req.query.search || "",
      onlyBlocked,
      blockedCount,
    });
  } catch (err) {
    console.error("listClients error:", err);
    res.render("admin/clients", { pageName: "Clients", title: "Clients", clients: [], search: "", onlyBlocked: false, blockedCount: 0 });
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

    // "Dernière visite" / "Prochain RDV" / le compteur d'en-tête ne doivent
    // refléter que de VRAIS rendez-vous — une réservation annulée ne doit
    // jamais s'afficher comme "prochain RDV" (le tableau "Historique" plus
    // bas, lui, garde volontairement tout l'historique y compris annulé).
    const confirmedBookings = bookings.filter((b) => b.status !== "canceled");
    const now = new Date();
    const lastVisit = confirmedBookings.find((b) => new Date(b.date) <= now) || null;
    const nextVisit = [...confirmedBookings].reverse().find((b) => new Date(b.date) > now) || null;

    const entries = [...dossier.entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.render("admin/client-dossier", {
      pageName: "Clients",
      title: `Dossier — ${fullName}`,
      dossier,
      entries,
      client: { email, fullName, phone: dossier.phone || latest.phone || "" },
      bookings,
      confirmedCount: confirmedBookings.length,
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

// ── Enregistrer le moyen de paiement réel d'une séance ─────────────────────────
// Distinct du choix fait par le client à la réservation : permet au pro de
// corriger/renseigner après coup comment la séance a réellement été payée
// (ex: réservé "à confirmer" puis payé en espèces sur place).
const PAYMENT_METHODS = ["online", "on_site", "bank_transfer", "paypal", "cash", "none"];

exports.updateBookingPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { method } = req.body;
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ success: false, error: "Moyen de paiement invalide." });
    }

    const update = { "payment.method": method };
    // Marquer comme payé dès qu'un moyen concret est choisi (hors "none") —
    // évite de devoir aussi jongler avec le statut séparément pour ce cas
    // simple de saisie manuelle après coup.
    if (method !== "none") {
      update["payment.status"] = "paid";
      update["payment.paidAt"] = new Date();
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, company: res.locals.currentCompany._id },
      { $set: update },
      { new: true }
    ).lean();

    if (!booking) return res.status(404).json({ success: false, error: "Rendez-vous introuvable." });
    res.json({ success: true, payment: booking.payment });
  } catch (err) {
    console.error("updateBookingPayment error:", err);
    res.status(500).json({ success: false, error: "Erreur serveur." });
  }
};

// ── Bloquer / débloquer un client (l'empêche de réserver à nouveau) ────────────
exports.blockClient = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const { reason } = req.body;
    const dossier = await ClientDossier.findOneAndUpdate(
      { _id: req.params.dossierId, company: companyId },
      { $set: { blocked: true, blockedAt: new Date(), blockedReason: (reason || "").trim().slice(0, 200) } },
      { new: true }
    );
    if (!dossier) return res.status(404).json({ success: false, error: "Dossier introuvable." });
    res.json({ success: true, blocked: true, blockedReason: dossier.blockedReason });
  } catch (err) {
    console.error("blockClient error:", err);
    res.status(500).json({ success: false, error: "Erreur serveur." });
  }
};

exports.unblockClient = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const dossier = await ClientDossier.findOneAndUpdate(
      { _id: req.params.dossierId, company: companyId },
      { $set: { blocked: false, blockedAt: null, blockedReason: "" } },
      { new: true }
    );
    if (!dossier) return res.status(404).json({ success: false, error: "Dossier introuvable." });
    res.json({ success: true, blocked: false });
  } catch (err) {
    console.error("unblockClient error:", err);
    res.status(500).json({ success: false, error: "Erreur serveur." });
  }
};
