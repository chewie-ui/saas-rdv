// ── Fusion de deux fiches clients ──────────────────────────────────────────
// Il n'existe pas de « table clients » : un client est le REGROUPEMENT de ses
// rendez-vous, par e-mail, sinon téléphone, sinon nom (cf. clientsHubInit).
// Deux fiches apparaissent donc dès que deux rendez-vous de la même personne
// ne partagent pas la même clé — typiquement une réservation en ligne avec
// e-mail d'un côté, et une saisie manuelle sans coordonnées de l'autre.
//
// Fusionner ne « déplace » donc rien : on réécrit les coordonnées des
// rendez-vous de la source avec celles de la cible. Ils se regroupent alors
// naturellement sous la même clé, sans traitement particulier ailleurs.
const Booking = require("../db/models/book.model");
const ClientDossier = require("../db/models/clientDossier.model");
const { dossierKey } = require("./dossierKey");

// Les rendez-vous d'un client, avec la même précédence que le regroupement.
// On ne filtre JAMAIS sur le seul nom quand un e-mail existe : deux homonymes
// ayant chacun leur adresse resteraient bien distincts.
function filtreRdv(companyId, ctx) {
  const base = { company: companyId, isBlock: { $ne: true } };
  if (ctx.email) return { ...base, email: ctx.email };
  if (ctx.phone) return { ...base, phone: ctx.phone };
  const parts = String(ctx.fullName || "").trim().split(/\s+/);
  if (!parts[0]) return null;
  return {
    ...base,
    email: { $in: ["", null] },
    phone: { $in: ["", null] },
    name: parts[0],
    surname: parts.slice(1).join(" "),
  };
}

// Concatène deux textes sans perdre le contenu de l'un ni dupliquer l'autre.
function fusionnerTexte(a, b, titre) {
  const x = (a || "").trim();
  const y = (b || "").trim();
  if (!y || x === y) return x;
  if (!x) return y;
  return `${x}\n\n— ${titre} —\n${y}`;
}

/**
 * @param {ObjectId|string} companyId
 * @param {object} source  contexte du client ABSORBÉ  (resoudreClient)
 * @param {object} cible   contexte du client CONSERVÉ (resoudreClient)
 * @returns {Promise<{rdvDeplaces:number, dossierFusionne:boolean}>}
 */
async function mergeClients(companyId, source, cible) {
  const fSource = filtreRdv(companyId, source);
  if (!fSource) throw new Error("source_non_identifiable");

  const parts = String(cible.fullName || "").trim().split(/\s+/);
  const majRdv = {
    email: cible.email || "",
    phone: cible.phone || "",
  };
  // Le nom n'est réécrit que si la cible en a un : on ne vide jamais un nom
  // existant au profit d'une chaîne vide.
  if (parts[0]) {
    majRdv.name = parts[0];
    majRdv.surname = parts.slice(1).join(" ");
  }

  const r = await Booking.updateMany(fSource, { $set: majRdv });

  // ── Dossiers ──
  const cleSource = dossierKey(source);
  const cleCible = dossierKey(cible);
  let dossierFusionne = false;

  if (cleSource && cleCible && cleSource !== cleCible) {
    const dSource = await ClientDossier.findOne({ company: companyId, clientKey: cleSource });
    if (dSource) {
      let dCible = await ClientDossier.findOne({ company: companyId, clientKey: cleCible });
      if (!dCible) {
        // Pas de dossier côté cible : on RÉUTILISE celui de la source en le
        // recléant, plutôt que d'en créer un vide et de jeter son contenu.
        dSource.email = cible.email || dSource.email || "";
        dSource.phone = cible.phone || dSource.phone || "";
        dSource.fullName = cible.fullName || dSource.fullName || "";
        dSource.hadBookings = true;
        await dSource.save();
        return { rdvDeplaces: r.modifiedCount || 0, dossierFusionne: true };
      }

      // Les deux existent : on verse le contenu de la source dans la cible.
      // Rien n'est écrasé — les notes se concatènent, les entrées s'ajoutent,
      // et un contact alternatif ne remplit qu'une case restée vide.
      dCible.generalInfo = fusionnerTexte(dCible.generalInfo, dSource.generalInfo, "fusionné depuis une autre fiche");
      if (Array.isArray(dSource.entries) && dSource.entries.length) {
        dCible.entries.push(...dSource.entries.map((e) => e.toObject ? e.toObject() : e));
      }
      if (!dCible.altName && dSource.fullName && dSource.fullName !== dCible.fullName) {
        dCible.altName = dSource.fullName;
      }
      if (!dCible.altEmail && dSource.email && dSource.email !== dCible.email) dCible.altEmail = dSource.email;
      if (!dCible.altPhone && dSource.phone && dSource.phone !== dCible.phone) dCible.altPhone = dSource.phone;
      // Un blocage se propage : lever une restriction doit rester un geste
      // explicite, jamais un effet de bord d'une fusion.
      if (dSource.blocked && !dCible.blocked) {
        dCible.blocked = true;
        dCible.blockedAt = dSource.blockedAt || new Date();
        dCible.blockedReason = dSource.blockedReason || "";
      }
      dCible.hadBookings = dCible.hadBookings || dSource.hadBookings;
      await dCible.save();
      await ClientDossier.deleteOne({ _id: dSource._id });
      dossierFusionne = true;
    }
  }

  return { rdvDeplaces: r.modifiedCount || 0, dossierFusionne };
}

module.exports = { mergeClients, filtreRdv };
