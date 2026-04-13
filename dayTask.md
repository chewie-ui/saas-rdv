When finished : 👌

GROS : Historique des RDV (admin) 👌👌👌

30-03-26

GROS : Settings et langues 👌👌👌
PETIT : bouton save informations 👌👌👌
PETIT : faire page booking 👌👌👌
PETIT : edit history 👌👌👌
PETIT : Plan free get plan 👌👌👌
GROS : Paiement Stripe 👌👌👌

31-03-26

GROS : Paiement (webhook + status) 👌👌👌
PETIT : Page paiement valide 👌👌👌

1-04-26

GROS : Responsive all 👌👌👌
PETIT : Creer bon envirnnment 👌👌👌

2-04-26

GROS : BUG ALL (gros debug) NOTER TOUT LES BUGS ou amelioration 👌👌👌
PETIT : Add state in hitsory ['confirmed-cancel'] 👌👌👌
PETIT : Page paiement valide (si pas achat valide pas mettre succes) 👌👌
PETIT : Finir les textes et langues 👌👌👌

3-04-26

GROS: FULL REPONSIVE 👌👌👌
GROS : ‼️‼️bug prise de rdv decaler de un jour ‼️‼️ 👌👌👌
PETIT : ‼️‼️Si client annule faire beau message et redirection‼️‼️ 👌👌👌
PETIT : ‼️‼️Verifier si annuler rdv fonctionne‼️‼️ 👌👌👌
PETIT : ‼️‼️Si rdv cancel repermette de repdnre rdv‼️‼️ 👌👌👌
PETIT : Refaire le mail conrifmlation (message et btns) 👌👌👌

4-04-26
5-04-26

6-04-26

GROS : Creer le systeme de session 👌👌👌
GROS : ‼️‼️Bug annuler plan‼️‼️ 👌👌👌
PETIT : Bug double import 👌👌👌
PETIT : Reprendre le plan si annuler 👌👌👌
PETIT : Cacher email qu...@gmail.com 👌👌👌
PETIT : ‼️‼️Design edit email popup & ‼️‼️ 👌👌👌

7-04-26

GROS : ‼️‼️Barre de recherche fonctionnelle‼️‼️👌👌👌
PETIT : ‼️‼️code verifiaction et modif fonctionnel‼️‼️👌👌👌
PETIT : ‼️‼️Restore btn dans historique‼️‼️👌👌👌
PETIT : Responsive history table 👌👌👌

8-04-26

GROS : Si un autre user a pris le rdv de qq qui avait annule, empeche quil puisse restorer le rdv -> Faire lerreur 👌👌👌
PETIT : Refaire calendrier version telephone mettre 1 jour 👌👌👌

========================
🚀 TODO APP (PRIORISÉ)
========================

[PRIORITÉ 1 - CORE APP]

GROS:

- Landing page client
- Interface client (History / Profile / Booking)
- Page contact
- Afficher horaires sur calendrier
- Panel client (rdv futurs + passés)
- Séparer page client / page admin

BOOKING / BUSINESS:

- Restore booking alert
- Retake plan
- Cancel plan

EMAIL / NOTIFS:

- Email rappel 24h avant
- Notif admin si client annule
- Mail admin si annulation
- Email bienvenue

---

[PRIORITÉ 2 - IMPORTANT]

UI / DESIGN:

- Remplacer alert → popup propre
- Design input rdv + heure
- Sidebar + icones
- Nom dans URL calendrier

FEATURES:

- History search by date

BUGS CALENDRIER:

- Alert moche → remplacer
- Mauvais email → gérer erreur
- Bouton "contactez-nous" ne marche pas
- Copier info coach
- Selecteur langue à refaire
- Langue email selon client
- Email edit / mdp edit
- Bug save (vérifier)
- Retirer barre heure

---

[PRIORITÉ 3 - DEPLOY]

PROD:

- Publier sur OVH + SSL

---

[APRÈS CLIENTS]

- Avatar auto si pas plan payant (homme/femme)
- Upload image si premium

---

🎯 PLAN:

Phase 1 → Core app fonctionnelle (client + booking)
Phase 2 → Emails + notifications
Phase 3 → UI + bug fixes
Phase 4 → Déploiement

---

🔥 RÈGLES IMPORTANTES:

- Faire une app complète même si moche
- Optimiser après (design + détails)

========================

========================

GROS : Alertes moches etc

- Restore booking alert
- retake plan
- cancel plan

GROS : Commecner cote client
_ Landing page
_ Interface client , HISTORY, PROFILE, BOOKING,
PETIT : Alerte moche -> Popup beau (Design)
PETIT : Rdv heure et input (Design)
PETIT : Gestion des erreurs email edit

GROS : Email 24h avant rappel⏳⏳
GROS : Creer des notifs pour ladmin si client annule rdv⏳⏳
PETIT : History search by date ⏳⏳
PETIT : Icon et sidebar (Design) ⏳⏳
PETIT : Admin recoit mail si client annule ⏳⏳
PETIT : Bug a la save ca save tout ? ⏳⏳
GROS : Afficher horaire sur calednrier
PETIT : Nom dans l Url du calnedrier
BUGS :

- CALENDRIER:
  - PETIT : Si clique prendre rdv sans aucune info alerte moche
  - PETIT : Si clique rdv mauvais email alerte moche
  - PETIT : CLic contactez nous fais rien
  - PETIT : CLic copier info de coach
  - PETIT : Refaire selecteur de langue landing page ou page calendrier
  - PETIT : Refaire Email quand edit email
  - PETIT : Refaire Email quand edit mdp
  - PETIT : Langue du mail en fonction de langue client
  - PETIT : Barre de lheure a retirer pour le moment

GROS : ‼️‼️Faire page contact‼️‼️
GROS : 1 page client et une page admin ?
GROS : Panel cote client voir futures et passer rdv ?
PETIT : email bienvenue creation ?

Repos OU léger (emailing rappel)

publier

GROS : Publier sur OVH avec le SSL

Finir app puis voir client :

Apres avoir des clients perfectioner :

si pas plan payant choisir entre 2 avatars FEMME ou HOMME sinon possible de mettre image

ADRESSE A METTRE PAYS VILLE NUMERO ETC
PARCKING : OUI NON
EQUIPEMENT : OUI NON INFOS
INFOS : OUI NON
DESCRIPTION
AJOUTER PRIX
AJOUTER SERVICES
ENTRER MANUELLEMENT ADRESSE
FAIRE LA PAGE ONLY SEARCH

bug important :

quand on est deco la langue peut pas etre modifiee
/ pas de langue
changer les plans et mettre vrais points
ajouter adresse (mail, admin, client, ...)
topbar a changer car texte blanch
