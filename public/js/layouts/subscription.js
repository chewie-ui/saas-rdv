/* ══════════════════════════════════════════════════════════════════════════
   PAGE ABONNEMENT — comportement
   ─────────────────────────────────────────────────────────────────────────
   Écran repris de la maquette « Abonnement » : la page elle-même n'a que deux
   actions (changer d'offre, gérer le paiement) ; tout le reste se passe dans
   les deux modales.

   Le parcours d'achat tient désormais en UN seul écran de confirmation : la
   modale des offres montre le plan choisi, la période, la remise éventuelle,
   le montant ET la carte qui sera débitée, puis un bouton qui nomme
   explicitement l'opération (« Passer à Pro », « Rétrograder vers Amateur »).
   L'ancienne boîte « Confirmer votre achat » qui s'ouvrait par-dessus faisait
   double emploi — deux confirmations de suite, on ne lit plus ni l'une ni
   l'autre.

   Contrat DOM : voir l'en-tête de views/pages/admin/subscription.pug.
   ═════════════════════════════════════════════════════════════════════════ */

const subT = window.__subT || {};

/* ── Éléments ─────────────────────────────────────────────────────────────*/
const plansModal   = document.getElementById("subPlansModal");
const paymentModal = document.getElementById("subPaymentModal");
const billMonthly  = document.getElementById("billMonthly");
const billYearly   = document.getElementById("billYearly");
const summaryEl    = document.getElementById("subSummary");
const confirmBtn   = document.getElementById("subConfirm");
const pickEls      = Array.from(document.querySelectorAll(".sub-pick[data-plan]"));
const templateDialog = document.getElementById("templateDialog");

const promoCodeInput  = document.getElementById("promoCodeInput");
const applyPromoBtn   = document.getElementById("applyPromoBtn");
const promoCodeStatus = document.getElementById("promoCodeStatus");

/* ── État ─────────────────────────────────────────────────────────────────*/
const ORDRE = ["basic", "pro", "business"];
const planActuel = window.__currentPlan || "basic";

let isYearly = false;
// À l'ouverture, on présélectionne le forfait en cours — sauf sur le gratuit,
// où présélectionner « Amateur » proposerait d'acheter ce qu'on a déjà.
let planChoisi = planActuel === "basic" ? "pro" : planActuel;
let appliedPromoCode = null;   // { code, discountType, discountValue, applicablePlan }

// Prix de base lus dans le DOM (data-monthly / data-yearly), écrits par Pug
// depuis utils/tarifs.js — jamais recopiés ici, pour qu'un changement de tarif
// n'ait qu'un seul endroit à toucher.
const PRICES = {};
pickEls.forEach((el) => {
  const cle = el.dataset.plan;
  const prix = el.querySelector(".sub-pick__price");
  const m = prix ? parseFloat(prix.dataset.monthly) : NaN;
  const y = prix ? parseFloat(prix.dataset.yearly) : NaN;
  PRICES[cle] = {
    monthly: Number.isFinite(m) ? m : 0,
    // Sans tarif annuel propre, la bascule « Annuel » laisse le prix mensuel :
    // la remise doit alors porter sur ce même montant.
    yearly:  Number.isFinite(y) ? y : (Number.isFinite(m) ? m : 0),
  };
});

const NOMS = {};
pickEls.forEach((el) => {
  const n = el.querySelector(".sub-pick__name");
  NOMS[el.dataset.plan] = n ? n.textContent.trim() : el.dataset.plan;
});

/* ── Offres mises en avant par le superadmin ──────────────────────────────
   Elles s'appliquent sans que le pro ait à saisir quoi que ce soit : le prix
   remisé est affiché et le code part au paiement. Avant, on annonçait « -20% »
   avec un code à copier-coller — remise affichée, plein tarif facturé à qui ne
   le collait pas. */
const OFFRES_AUTO = Array.isArray(window.__offresAuto) ? window.__offresAuto : [];

// Même règle que le serveur (validate-promo et create-checkout) : un code visé
// « pro_monthly » ne doit pas décorer l'annuel, sinon on affiche une remise que
// le paiement refusera.
function promoCouvrePlan(promo, plan) {
  if (!promo) return false;
  const ap = promo.applicablePlan || "all";
  const billing = isYearly ? "yearly" : "monthly";
  return ap === "all" ||
    ap === `${plan}_${billing}` ||
    (plan === "pro" && ap === `premium_${billing}`);
}

// Un code saisi à la main l'emporte sur l'offre automatique : c'est un choix
// explicite du pro, et il peut être meilleur.
function promoPourPlan(plan) {
  if (promoCouvrePlan(appliedPromoCode, plan)) return appliedPromoCode;
  return OFFRES_AUTO.find((o) => promoCouvrePlan(o, plan)) || null;
}

function calcDiscounted(base, type, value) {
  if (!base) return null;
  if (type === "percent") return Math.max(0, base * (1 - value / 100));
  if (type === "fixed")   return Math.max(0, base - value);
  return base;
}

/** « 12.5 » → « 12,50 € » · « 9 » → « 9 € » */
function fmtPrix(n) {
  if (n == null || isNaN(n)) return null;
  return n.toFixed(2).replace(/\.00$/, "").replace(".", ",") + " €";
}

/** Prix réellement facturé pour ce plan, remise comprise. */
function prixEffectif(plan) {
  const base = PRICES[plan] ? PRICES[plan][isYearly ? "yearly" : "monthly"] : 0;
  const promo = promoPourPlan(plan);
  if (!promo) return base;
  // Code de type « essai gratuit » : la première facture est à 0 € (Stripe
  // décale la facturation à la fin de l'essai).
  if (promo.discountType === "trial") return 0;
  const remise = calcDiscounted(base, promo.discountType, promo.discountValue);
  return remise === null ? base : remise;
}

/* ── Toast ────────────────────────────────────────────────────────────────*/
function showToast(message, type = "success", duration = 3500) {
  const existing = document.querySelector(".bs-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = `bs-toast bs-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("bs-toast--out");
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

/* ── Boîte de confirmation générique (résiliation, reprise, suppression) ──*/
function openDialog(title, desc, confirmLabel, closeLabel) {
  return new Promise((resolve) => {
    const tmp = templateDialog.content.cloneNode(true);
    const parentTmp = tmp.querySelector("#dialogWrp");
    const close = (value) => { parentTmp.remove(); resolve(value); };

    tmp.querySelector(".dialog__h2").textContent = title;
    tmp.querySelector(".dialog__p").textContent  = desc;
    tmp.querySelector(".dialog__btn2").innerHTML = `<span>${confirmLabel}</span>`;
    tmp.querySelector(".dialog__btn1").innerHTML = `<span>${closeLabel}</span>`;
    tmp.querySelector(".dialog__btn1").onclick   = () => close(false);
    tmp.querySelector(".dialog__icon").onclick   = () => close(false);
    tmp.querySelector(".dialog__btn2").onclick   = () => close(true);
    parentTmp.addEventListener("click", (e) => { if (e.target === parentTmp) close(false); });

    document.body.appendChild(tmp);
  });
}

/* ══ Modales ══════════════════════════════════════════════════════════════
   `hidden` porte l'état : rien à synchroniser entre une classe et un attribut,
   et un lecteur d'écran n'annonce jamais une modale fermée. */
let modaleOuverte = null;

function ouvrirModale(nom) {
  const el = nom === "payment" ? paymentModal : plansModal;
  if (!el) return;
  fermerModale();
  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  // Le fond ne doit pas défiler sous la modale — sinon on perd sa position de
  // lecture en fermant.
  document.body.style.overflow = "hidden";
  modaleOuverte = el;
  if (nom === "plans") {
    planChoisi = planActuel === "basic" ? "pro" : planActuel;
    rafraichirOffres();
  }
  const premier = el.querySelector(".sub-modal__x");
  if (premier) premier.focus();
}

function fermerModale() {
  if (!modaleOuverte) return;
  modaleOuverte.hidden = true;
  modaleOuverte.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  modaleOuverte = null;
  fermerFormulaireCarte();
}

document.querySelectorAll("[data-sub-open]").forEach((btn) => {
  btn.addEventListener("click", () => ouvrirModale(btn.dataset.subOpen));
});
document.addEventListener("click", (e) => {
  const fermeur = e.target.closest("[data-sub-close]");
  if (fermeur) fermerModale();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modaleOuverte) fermerModale();
});

/* ══ Modale « Changer d'offre » ═══════════════════════════════════════════*/

function libelleCarte(pm) {
  return (pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)) + " •••• " + pm.last4;
}

/** Redessine prix, notes, sélection, résumé et libellé du bouton. */
function rafraichirOffres() {
  pickEls.forEach((el) => {
    const cle = el.dataset.plan;
    const choisi = cle === planChoisi;
    el.classList.toggle("is-picked", choisi);
    el.setAttribute("aria-pressed", choisi ? "true" : "false");

    const prixEl = el.querySelector(".sub-pick__price[data-monthly]");
    if (prixEl) {
      const base = PRICES[cle][isYearly ? "yearly" : "monthly"];
      const promo = promoPourPlan(cle);
      const remise = promo && promo.discountType !== "trial"
        ? calcDiscounted(base, promo.discountType, promo.discountValue)
        : null;
      if (remise !== null && remise !== base) {
        // Prix plein barré + prix remisé : le montant affiché est celui qui
        // sera facturé, pas un tarif catalogue à corriger mentalement.
        prixEl.innerHTML = `<s>${base} €</s> ${fmtPrix(remise)}`;
      } else {
        prixEl.textContent = base + " €";
      }
    }

    const perEl = el.querySelector(".sub-pick__per");
    if (perEl) perEl.textContent = isYearly && cle !== "basic" ? "/mois, annuel" : "/mois";

    const noteEl = el.querySelector(".sub-pick__note");
    if (noteEl) {
      const promo = promoPourPlan(cle);
      if (promo) {
        noteEl.textContent = promo.discountType === "trial"
          ? (promo.trialDays || 30) + " jours offerts"
          : promo.discountType === "percent"
            ? "−" + promo.discountValue + "% sur la 1ère facture"
            : "−" + promo.discountValue + "€ sur la 1ère facture";
      } else if (isYearly && cle !== "basic") {
        noteEl.textContent = "Facturé " + (PRICES[cle].yearly * 12) + " € par an";
      } else if (cle === "pro" && window.__trialAvailable === true) {
        // « 1ᵉʳ » : l'ordinal français complet, comme sur la vitrine.
        // Deux orthographes pour la même offre la font passer pour deux offres.
        noteEl.textContent = "1ᵉʳ mois offert";
      } else {
        noteEl.textContent = "";
      }
    }

    const ctaEl = el.querySelector(".sub-pick__cta");
    if (ctaEl) {
      ctaEl.textContent = cle === planActuel
        ? (choisi ? "Forfait actuel" : "Forfait actuel")
        : (choisi ? "Sélectionné" : "Choisir");
    }
  });

  majResume();
}

function majResume() {
  if (!summaryEl || !confirmBtn) return;

  const identique = planChoisi === planActuel;
  const montee    = ORDRE.indexOf(planChoisi) > ORDRE.indexOf(planActuel);
  const nom       = NOMS[planChoisi] || planChoisi;

  if (identique) {
    summaryEl.textContent = "Vous êtes déjà sur ce forfait.";
    confirmBtn.textContent = "Conserver ce forfait";
    confirmBtn.disabled = true;
    return;
  }
  confirmBtn.disabled = false;

  if (planChoisi === "basic") {
    summaryEl.textContent = "Vous perdrez les rappels SMS et le paiement en ligne à la fin de la période déjà payée.";
    confirmBtn.textContent = "Repasser en gratuit";
    return;
  }

  const promo = promoPourPlan(planChoisi);
  const prix  = prixEffectif(planChoisi);
  const plein = PRICES[planChoisi][isYearly ? "yearly" : "monthly"];
  const periode = isYearly ? ", facturé annuellement" : "";

  // Deux sources de gratuité, à ne pas confondre :
  //  · un code promo de type « trial » (N jours) ;
  //  · le mois offert accordé par le serveur au PREMIER abonnement, une seule
  //    fois par compte (utils/freeTrial.js) — il n'a pas de code.
  // Les cartes annoncent déjà « 1ᵉʳ mois offert » à partir du second : si le
  // pied disait au même moment « prélevé dès aujourd'hui », l'écran se
  // contredisait sur le seul chiffre qui décide de l'achat.
  const essaiCode    = promo && promo.discountType === "trial";
  const premierAchat = planActuel === "basic";
  const essaiServeur = premierAchat && window.__trialAvailable === true;
  const jours = essaiCode ? (promo.trialDays || 30) : 0;

  // Montant annoncé APRÈS la période offerte : le prix remisé s'il y a une
  // réduction en cours, sinon le plein tarif. Annoncer « puis 19 € » sous une
  // carte qui affiche 15,20 €, ce sont deux prix pour le même achat.
  const apres = (promo && promo.discountType !== "trial") ? prix : plein;

  let phrase;
  if (essaiCode) {
    phrase = `${jours} jours offerts, puis ${fmtPrix(apres)}/mois${periode} · 0 € aujourd'hui, annulable en un clic.`;
  } else if (essaiServeur) {
    phrase = `1ᵉʳ mois offert, puis ${fmtPrix(apres)}/mois${periode} · 0 € aujourd'hui, annulable en un clic.`;
  } else if (premierAchat) {
    // Premier abonnement : Stripe Checkout prend la main, il n'y a pas de
    // prorata à annoncer et aucune carte enregistrée à nommer.
    phrase = `${fmtPrix(prix)}/mois${periode} · paiement sécurisé par Stripe à l'étape suivante.`;
  } else {
    // Changement d'offre sur un abonnement actif : Stripe facture le prorata
    // immédiatement. On nomme la carte débitée — personne ne doit découvrir le
    // prélèvement après coup.
    const pms = window.__paymentMethods || [];
    const defaut = pms.find((pm) => pm.isDefault) || pms[0];
    phrase = `Nouveau montant : ${fmtPrix(prix)}/mois${periode} · prélevé au prorata dès aujourd'hui`
      + (defaut ? ` sur ${libelleCarte(defaut)}` : "") + ".";
  }

  summaryEl.textContent = phrase;
  confirmBtn.textContent = montee ? `Passer à ${nom}` : `Rétrograder vers ${nom}`;
}

pickEls.forEach((el) => {
  el.addEventListener("click", () => {
    planChoisi = el.dataset.plan;
    rafraichirOffres();
  });
});

function setPeriode(annuel) {
  isYearly = annuel;
  if (billMonthly) billMonthly.classList.toggle("active", !annuel);
  if (billYearly)  billYearly.classList.toggle("active", annuel);
  rafraichirOffres();
}
if (billMonthly) billMonthly.addEventListener("click", () => setPeriode(false));
if (billYearly)  billYearly.addEventListener("click", () => setPeriode(true));

/* ── Code promo ───────────────────────────────────────────────────────────*/
async function validatePromo() {
  if (!promoCodeInput || !promoCodeStatus) return;
  const code = promoCodeInput.value.trim().toUpperCase();
  if (!code) return;

  promoCodeStatus.textContent = subT.checking || "Vérification…";
  promoCodeStatus.className = "sub-promo__status";
  appliedPromoCode = null;
  rafraichirOffres();

  try {
    const res = await fetch("/api/validate-promo", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code, plan: planChoisi, billing: isYearly ? "yearly" : "monthly" }),
    });
    const data = await res.json();

    if (data.valid) {
      appliedPromoCode = data;
      const remise = data.discountType === "trial"
        ? `${data.trialDays || 30} jours gratuits, puis plein tarif`
        : data.discountType === "percent"
          ? `−${data.discountValue}% sur la 1ère facture`
          : `−${data.discountValue}€ sur la 1ère facture`;
      promoCodeStatus.textContent = `Code « ${data.code} » appliqué : ${remise}`;
      promoCodeStatus.className = "sub-promo__status is-ok";
    } else {
      appliedPromoCode = null;
      promoCodeStatus.textContent = data.error || subT.invalid || "Code invalide.";
      promoCodeStatus.className = "sub-promo__status is-err";
    }
  } catch (_) {
    appliedPromoCode = null;
    promoCodeStatus.textContent = "Vérification impossible. Réessayez.";
    promoCodeStatus.className = "sub-promo__status is-err";
  }
  rafraichirOffres();
}
if (applyPromoBtn) applyPromoBtn.addEventListener("click", validatePromo);
if (promoCodeInput) {
  promoCodeInput.addEventListener("keydown", (e) => {
    // Le champ est dans une modale sans <form> : sans ça, Entrée ne faisait rien.
    if (e.key === "Enter") { e.preventDefault(); validatePromo(); }
  });
}

/* ── Départ vers le paiement ──────────────────────────────────────────────*/
async function startCheckout(plan) {
  const body = { plan, billing: isYearly ? "yearly" : "monthly" };
  // Le code envoyé est celui réellement affiché sur CE plan — saisi à la main
  // ou offre automatique. Le serveur revalide de toute façon (expiration,
  // quota, déjà utilisé) : au pire l'offre est ignorée, jamais forcée.
  const promo = promoPourPlan(plan);
  if (promo) body.promoCode = promo.code;

  const pms = window.__paymentMethods || [];
  const defaut = pms.find((pm) => pm.isDefault) || pms[0];
  if (defaut) body.paymentMethodId = defaut.id;

  try {
    const response = await fetch("/account/create-checkout", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = await response.json();
    if (data.url) window.location = data.url;
    else if (data.upgraded) window.location = "/subscription/success";
    else if (data.error) { showToast(data.error, "error"); return false; }
  } catch (_) {
    showToast("Le paiement n'a pas pu démarrer. Réessayez.", "error");
    return false;
  }
  return true;
}

if (confirmBtn) {
  confirmBtn.addEventListener("click", async () => {
    if (planChoisi === planActuel) return;

    // Repasser en gratuit = résilier. On ne le fait pas passer par le
    // checkout : il n'y a rien à payer, et l'annulation garde l'accès jusqu'à
    // la fin de la période déjà réglée.
    if (planChoisi === "basic") {
      fermerModale();
      return resilier();
    }

    confirmBtn.disabled = true;
    const libelle = confirmBtn.textContent;
    confirmBtn.textContent = "Redirection…";
    const ok = await startCheckout(planChoisi);
    if (!ok) { confirmBtn.disabled = false; confirmBtn.textContent = libelle; }
  });
}

/* ── Résiliation / reprise ────────────────────────────────────────────────*/
async function resilier() {
  const confirme = await openDialog(
    subT.cancel_title || "Résilier l'abonnement",
    subT.cancel_desc  || "Votre forfait reste actif jusqu'à la fin de la période déjà payée. Confirmer la résiliation ?",
    subT.confirm      || "Confirmer",
    subT.close        || "Fermer"
  );
  if (!confirme) return;

  try {
    const response = await fetch("/account/cancel-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (data.success) {
      showToast(subT.success_cancel || data.message || "Abonnement résilié.", "success");
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(data.error || "Une erreur est survenue.", "error");
    }
  } catch (_) {
    showToast("Une erreur est survenue. Veuillez réessayer.", "error");
  }
}

const cancelBtn = document.getElementById("cancelSubscriptionPro");
if (cancelBtn) cancelBtn.addEventListener("click", resilier);

const retakeBtn = document.getElementById("retakeSubscription");
if (retakeBtn) {
  retakeBtn.addEventListener("click", async () => {
    const confirme = await openDialog(
      subT.resume_title || "Reprendre le forfait",
      subT.resume_desc  || "Votre abonnement reprendra normalement à la prochaine échéance. Confirmer ?",
      subT.confirm      || "Confirmer",
      subT.close        || "Fermer"
    );
    if (!confirme) return;
    try {
      const response = await fetch("/subscription/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (data.success) {
        showToast(subT.success_resume || data.message || "Abonnement repris.", "success");
        setTimeout(() => location.reload(), 1500);
      } else {
        showToast(data.error || "Une erreur est survenue.", "error");
      }
    } catch (_) {
      showToast("Une erreur est survenue. Veuillez réessayer.", "error");
    }
  });
}

/* ══ Modale « Gérer le paiement » ═════════════════════════════════════════*/

// Carte par défaut : c'est elle qui sera débitée à la prochaine échéance.
document.querySelectorAll("[data-pm-default]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = btn.dataset.pmDefault;
    const ligne = btn.closest(".sub-card-row");
    if (ligne && ligne.classList.contains("is-default")) return;
    btn.disabled = true;
    try {
      const res = await fetch("/account/payment-method/" + id + "/set-default", { method: "POST" });
      const data = await res.json();
      if (data.success || res.ok) {
        // Repeindre tout de suite : attendre le rechargement laisserait le
        // rond coché sur l'ancienne carte pendant une seconde.
        document.querySelectorAll(".sub-card-row").forEach((r) => {
          r.classList.toggle("is-default", r.dataset.pmId === id);
          const flag = r.querySelector(".sub-card-row__flag");
          if (flag && r.dataset.pmId !== id) flag.remove();
        });
        showToast("Carte par défaut mise à jour.", "success");
        setTimeout(() => location.reload(), 900);
      } else {
        showToast(data.error || "Impossible de changer la carte par défaut.", "error");
        btn.disabled = false;
      }
    } catch (_) {
      showToast("Une erreur est survenue.", "error");
      btn.disabled = false;
    }
  });
});

document.querySelectorAll("[data-pm-delete]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = btn.dataset.pmDelete;
    const confirme = await openDialog(
      "Supprimer cette carte",
      "Elle ne pourra plus servir à régler votre abonnement. Confirmer la suppression ?",
      "Supprimer",
      "Annuler"
    );
    if (!confirme) return;
    try {
      const res = await fetch("/account/payment-method/" + id, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.error == null) {
        showToast("Carte supprimée.", "success");
        setTimeout(() => location.reload(), 900);
      } else {
        showToast(data.error || "Suppression impossible.", "error");
      }
    } catch (_) {
      showToast("Une erreur est survenue.", "error");
    }
  });
});

/* ── Ajout d'une carte (Stripe Elements) ──────────────────────────────────
   Le numéro est saisi dans une iframe servie par Stripe : il ne traverse
   jamais notre page ni notre serveur, on ne reçoit qu'un identifiant de moyen
   de paiement. */
const addCardToggle = document.getElementById("addCardToggle");
const addCardForm   = document.getElementById("addCardForm");
const saveCardBtn   = document.getElementById("saveCardBtn");
const cardErrorEl   = document.getElementById("cardError");
let stripeInstance = null;
let cardElement = null;
let clientSecret = null;

function fermerFormulaireCarte() {
  if (addCardForm) addCardForm.hidden = true;
  if (cardErrorEl) cardErrorEl.textContent = "";
}

if (addCardToggle) {
  addCardToggle.addEventListener("click", async () => {
    if (addCardForm && !addCardForm.hidden) { fermerFormulaireCarte(); return; }

    const key = window.__stripeKey || "";
    if (!key) {
      showToast("Configuration Stripe manquante — contactez le support.", "error");
      return;
    }
    if (!window.Stripe) {
      showToast("Stripe n'a pas pu être chargé. Vérifiez votre connexion.", "error");
      return;
    }

    addCardToggle.disabled = true;
    try {
      const res = await fetch("/account/payment-method/setup-intent", { method: "POST" });
      const data = await res.json();
      if (!data.clientSecret) throw new Error(data.error || "setup-intent indisponible");
      clientSecret = data.clientSecret;

      addCardForm.hidden = false;
      // Elements n'est monté qu'une fois : le remonter à chaque ouverture
      // recrée une iframe et perd la saisie en cours.
      if (!cardElement) {
        stripeInstance = window.Stripe(key);
        const elements = stripeInstance.elements();
        cardElement = elements.create("card", {
          hidePostalCode: true,
          style: { base: { fontSize: "14px", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1a201d" } },
        });
        cardElement.mount("#cardElement");
        cardElement.on("change", (ev) => {
          if (cardErrorEl) cardErrorEl.textContent = ev.error ? ev.error.message : "";
        });
      }
    } catch (e) {
      showToast(e.message || "Impossible d'ouvrir le formulaire de carte.", "error");
    }
    addCardToggle.disabled = false;
  });
}

document.querySelectorAll("[data-addcard-cancel]").forEach((btn) => {
  btn.addEventListener("click", fermerFormulaireCarte);
});

if (saveCardBtn) {
  saveCardBtn.addEventListener("click", async () => {
    if (!stripeInstance || !cardElement || !clientSecret) return;
    saveCardBtn.disabled = true;
    const libelle = saveCardBtn.textContent;
    saveCardBtn.textContent = "Enregistrement…";
    try {
      const result = await stripeInstance.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });
      if (result.error) {
        if (cardErrorEl) cardErrorEl.textContent = result.error.message;
        saveCardBtn.disabled = false;
        saveCardBtn.textContent = libelle;
        return;
      }
      const newPmId = result.setupIntent && result.setupIntent.payment_method;
      // Une carte qu'on vient d'ajouter est presque toujours celle qu'on veut
      // utiliser : la poser par défaut évite un second aller-retour.
      if (newPmId) {
        await fetch("/account/payment-method/" + newPmId + "/set-default", { method: "POST" });
      }
      showToast("Carte enregistrée.", "success");
      setTimeout(() => location.reload(), 900);
    } catch (_) {
      if (cardErrorEl) cardErrorEl.textContent = "Une erreur est survenue. Réessayez.";
      saveCardBtn.disabled = false;
      saveCardBtn.textContent = libelle;
    }
  });
}

/* ── Auto-checkout après inscription ──────────────────────────────────────
   /register renvoie vers /subscription?autoCheckout=1&plan=pro : on ouvre la
   modale sur le bon plan plutôt que de débiter sans rien montrer. */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("autoCheckout") !== "1") return;

  const plan = params.get("plan");
  if (params.get("billing") === "yearly") setPeriode(true);
  ouvrirModale("plans");
  if (plan && PRICES[plan]) { planChoisi = plan; rafraichirOffres(); }

  const promo = params.get("promo");
  if (promo && promoCodeInput) {
    promoCodeInput.value = promo;
    validatePromo();
  }
})();

// Premier rendu : applique les offres automatiques et calcule le résumé.
rafraichirOffres();
