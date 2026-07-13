/**
 * Validation défensive des champs "nom" en texte libre (nom complet, nom
 * d'établissement, nom de service...). Ces champs n'ont légitimement jamais
 * besoin de `<` ou `>` — leur présence est le signe d'une tentative
 * d'injection HTML/XSS (ex: "<hr>Sacha...@<hr>" reçu via /contact).
 *
 * L'échappement à l'affichage (Pug `=`) neutralise déjà ce genre de payload
 * dans nos templates, mais autant refuser la donnée à la source plutôt que
 * de compter uniquement sur l'échappement en aval — défense en profondeur.
 */
function isSafePlainText(value) {
  if (typeof value !== "string") return false;
  return !/[<>]/.test(value);
}

module.exports = { isSafePlainText };
