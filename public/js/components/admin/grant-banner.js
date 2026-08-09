/**
 * Bandeau « votre accès offert se termine » — masquage pour la journée.
 *
 * Le bandeau doit revenir : quelqu'un qui le ferme le lundi doit le revoir le
 * mardi, sinon on ne l'aura prévenu qu'une seule fois. On mémorise donc le
 * jour du masquage, pas un « déjà vu » définitif.
 *
 * La clé porte aussi l'échéance : si le superadmin prolonge l'accès, la date
 * change et le bandeau réapparaît de lui-même pour la nouvelle date.
 *
 * À J-1 et le jour même, le bouton de fermeture n'est pas rendu du tout
 * (cf. views/layouts/admin.pug) : ce script n'a alors rien à faire.
 */
(function () {
  var bandeau = document.querySelector(".grantbn");
  if (!bandeau) return;

  var echeance = bandeau.getAttribute("data-echeance") || "";
  var cle = "bs_grantbn_" + echeance;
  var aujourdhui = new Date().toISOString().slice(0, 10);

  function lire(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function ecrire(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* mode privé : le bandeau restera, tant mieux */ }
  }

  var fermeture = document.getElementById("grantbnClose");

  // Déjà masqué aujourd'hui pour CETTE échéance : on retire le bandeau.
  // Seulement s'il est masquable — sans bouton de fermeture, le bandeau est
  // imminent et doit rester quoi qu'il arrive.
  if (fermeture && lire(cle) === aujourdhui) {
    bandeau.remove();
    return;
  }

  if (fermeture) {
    fermeture.addEventListener("click", function () {
      ecrire(cle, aujourdhui);
      bandeau.remove();
    });
  }
})();
