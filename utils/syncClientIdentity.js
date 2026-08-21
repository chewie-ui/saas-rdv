// ── Propagation de l'identité d'un client vers ses rendez-vous ──────────────
// Un rendez-vous fige `name`, `surname` et `phone` au moment de la
// réservation : c'est nécessaire (un client peut réserver sans compte, et le
// pro doit garder la trace de ce qui a été saisi), mais ça vieillit mal. Un
// client qui corrige une faute dans son prénom restait affiché avec la faute
// dans la liste clients de son praticien, indéfiniment.
//
// PRUDENCE VOLONTAIRE — on ne réécrit un rendez-vous que s'il portait
// EXACTEMENT l'ancienne identité. Réserver pour quelqu'un d'autre depuis son
// propre compte est courant (un parent pour son enfant, un conjoint) : ces
// rendez-vous portent un autre nom, et les écraser remplacerait le patient
// par le titulaire du compte. Le rendez-vous du fils deviendrait celui du
// père, sans le moindre avertissement.
const Booking = require("../db/models/book.model");

// "Marie Dupont Martin" → { name: "Marie", surname: "Dupont Martin" }
// Même découpage que les formulaires de réservation : le premier mot est le
// prénom, le reste le nom.
function decouper(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  return { name: parts[0] || "", surname: parts.slice(1).join(" ") };
}

function memeIdentite(booking, ancienNomComplet) {
  const actuel = `${booking.name || ""} ${booking.surname || ""}`.trim().toLowerCase();
  return actuel === String(ancienNomComplet || "").trim().toLowerCase();
}

/**
 * Aligne les rendez-vous d'un client sur sa nouvelle identité.
 *
 * @param {ObjectId|string} clientId    valeur de Booking.clientRef
 * @param {object} avant  { fullName, phone } — l'état AVANT modification
 * @param {object} apres  { fullName, phone } — le nouvel état
 * @returns {Promise<{nom:number, tel:number}>} nombre de RDV touchés
 */
async function syncClientIdentity(clientId, avant, apres) {
  if (!clientId) return { nom: 0, tel: 0 };

  const nomChange = avant.fullName && apres.fullName
    && avant.fullName.trim() !== apres.fullName.trim();
  const telChange = (avant.phone || "") !== (apres.phone || "");
  if (!nomChange && !telChange) return { nom: 0, tel: 0 };

  // Tous les rendez-vous du client, passés compris : la liste clients du pro
  // affiche le plus récent, mais l'historique doit rester cohérent.
  const rdvs = await Booking.find({ clientRef: clientId })
    .select("name surname phone")
    .lean();

  const { name, surname } = decouper(apres.fullName);
  let nom = 0, tel = 0;
  const ops = [];

  for (const b of rdvs) {
    const set = {};
    if (nomChange && memeIdentite(b, avant.fullName)) {
      set.name = name;
      set.surname = surname;
      nom++;
    }
    // Même prudence pour le téléphone : on ne remplace que l'ancien numéro,
    // jamais celui d'un tiers pour qui le compte aurait réservé.
    if (telChange && (b.phone || "") === (avant.phone || "")) {
      set.phone = apres.phone || "";
      tel++;
    }
    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: b._id }, update: { $set: set } } });
    }
  }

  if (ops.length) await Booking.bulkWrite(ops);
  return { nom, tel };
}

module.exports = { syncClientIdentity, decouper };
