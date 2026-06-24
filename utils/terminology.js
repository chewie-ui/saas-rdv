// Vocabulaire adapté au métier : un kiné/psy/dentiste etc. parle de
// "patients", un coiffeur/coach/esthéticienne etc. parle de "clients". On
// devine ça depuis `businessType` (texte libre choisi à l'inscription/dans
// les réglages — cf. utils/services.js pour la liste de métiers proposée).
const PATIENT_KEYWORDS = [
  // FR
  "médecin", "medecin", "docteur", "dentiste", "orthodont", "kinésithérap", "kinesitherap",
  "ostéopath", "osteopath", "chiropract", "psycholog", "psychiatr", "psychothérap", "psychotherap",
  "infirmier", "infirmière", "sage-femme", "podolog", "orthophon", "orthopt", "opticien",
  "diététic", "dietetic", "nutrition", "acupunc", "naturopath", "homéopath", "homeopath",
  "sophrolog", "hypnothérap", "hypnotherap", "ergothérap", "ergotherap", "psychomotric",
  "neurolog", "rhumatolog", "gastroentérolog", "gastroenterolog", "endocrinolog", "allergolog",
  "sexolog", "gériatr", "geriatr", "cardiolog", "dermatolog", "ophtalmolog", "pédiatr", "pediatr",
  "gynécolog", "gynecolog", "vétérin", "veterin",
  // EN / NL / DE (racines communes)
  "doctor", "physician", "physio", "nurse", "midwife", "podiatr", "speech therapist",
  "dietitian", "huisarts", "tandarts", "kinesitherapeut", "arzt", "zahnarzt", "verpleegkundige",
];

function isPatientProfession(businessType) {
  if (!businessType) return false;
  const lower = String(businessType).toLowerCase();
  return PATIENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function clientWord(businessType, { capitalize = false, plural = false } = {}) {
  let word = isPatientProfession(businessType) ? "patient" : "client";
  if (plural) word += "s";
  if (capitalize) word = word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

module.exports = { isPatientProfession, clientWord };
