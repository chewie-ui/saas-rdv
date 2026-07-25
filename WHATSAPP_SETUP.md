# Rappels & confirmations WhatsApp — Guide de mise en place

Ce guide explique comment brancher **WhatsApp** (via l'API officielle **Meta
Cloud API**) pour envoyer rappels et confirmations de RDV, **moins cher que le
SMS** (~0,03–0,05 €/message, souvent gratuit dans la fenêtre 24h, contre 0,12 €
en SMS). Un **seul numéro WhatsApp Business partagé** « BranShee » sert tous les
établissements, exactement comme l'originator SMS actuel.

Le code est déjà en place. Il ne reste que **4 étapes côté Meta** (que seul toi
peux faire, sur ton compte), puis 2 variables à coller dans le `.env`.

---

## Architecture (déjà codée)

- `utils/whatsapp.js` — envoi via Meta Cloud API + facturation.
- Facturation **partagée avec le SMS** (`utils/sms.js` → `chargeAndSend`) :
  même quota mensuel inclus, même solde prépayé, même toggle « dépassement ».
  Seul le prix diffère (`WHATSAPP_PRICE_CENTS = 5` centimes).
- Ordre d'envoi des rappels (`utils/reminderScheduler.js`) :
  **WhatsApp → repli SMS → repli email**.
- Confirmations (`booking.controller.js`, `admin.controller.js`) :
  **WhatsApp → repli SMS** (l'email de confirmation part toujours).
- UI : page **SMS** de l'admin, carte « WhatsApp » (toggles rappel + confirmation).
  Les toggles sont **désactivés tant que le serveur n'est pas configuré**
  (badge « Non configuré »).

---

## Étape 1 — Compte Meta Business + application

1. Va sur <https://business.facebook.com> et crée (ou utilise) un **compte Meta
   Business**.
2. Va sur <https://developers.facebook.com/apps> → **Créer une application** →
   type **« Entreprise »**.
3. Dans l'application, ajoute le produit **« WhatsApp »**.

> Tout est **gratuit**. Aucune carte requise pour démarrer en mode test.

## Étape 2 — Numéro d'expéditeur dédié

Dans **WhatsApp → Configuration de l'API** :

- Meta te fournit un **numéro de test** gratuit pour vérifier tout de suite.
- Pour la **production**, ajoute un **vrai numéro dédié** :
  - une **SIM prépayée** (~5–10 € une fois) **ou** un **numéro Twilio** (~1 €/mois) ;
  - ⚠️ ce numéro sera **verrouillé sur l'API** : il ne pourra plus servir dans
    l'app WhatsApp classique. Prends un numéro **qui n'a jamais eu de compte
    WhatsApp**, ou supprime d'abord ce compte.
- Note le **Phone Number ID** (identifiant du numéro, ≠ le numéro lui-même).
  → c'est la variable `WHATSAPP_PHONE_NUMBER_ID`.

## Étape 3 — Jeton d'accès permanent

Le jeton affiché par défaut expire en 24h. Pour un jeton **permanent** :

1. **Business Settings** → **Utilisateurs → Utilisateurs système** →
   **Ajouter** un utilisateur système (rôle **Admin**).
2. **Attribuer des ressources** → ton application WhatsApp → autorisations
   complètes.
3. **Générer un nouveau token** → sélectionne ton app → coche les permissions
   **`whatsapp_business_messaging`** et **`whatsapp_business_management`** →
   **jeton sans expiration**.
4. Copie ce jeton. → c'est la variable `WHATSAPP_TOKEN`.

> ⚠️ Ce jeton est un secret : ne le commit jamais, garde-le dans le `.env`.

## Étape 4 — Templates validés par Meta

WhatsApp interdit le texte libre à l'initiative de l'entreprise : rappels et
confirmations passent par des **templates pré-validés** (catégorie **Utility**).

Dans **WhatsApp → Modèles de messages → Créer un modèle** :

### Modèle 1 — Rappel · nom exact : `rdv_rappel`
- **Catégorie** : Utility · **Langue** : Français
- **Corps** (respecte l'ordre des variables) :
  ```
  Bonjour {{1}}, petit rappel de votre rendez-vous chez {{2}} le {{3}} à {{4}}. À très vite !
  ```
- Exemples à fournir à Meta : `{{1}}`=Marie · `{{2}}`=Salon Belle · `{{3}}`=lundi 4 août 2026 · `{{4}}`=10:00

### Modèle 2 — Confirmation · nom exact : `rdv_confirmation`
- **Catégorie** : Utility · **Langue** : Français
- **Corps** :
  ```
  Bonjour {{1}}, votre rendez-vous chez {{2}} le {{3}} à {{4}} est confirmé. À bientôt !
  ```
- Mêmes exemples de variables que ci-dessus.

La validation Meta prend en général **quelques minutes à quelques heures**.

> Les variables sont injectées par le code dans cet ordre :
> **{{1}}** prénom du client · **{{2}}** nom de l'établissement · **{{3}}** date ·
> **{{4}}** heure. Si tu changes le nombre ou l'ordre des variables, adapte
> `params: [...]` dans `reminderScheduler.js` / les controllers, sinon Meta
> rejette l'envoi.

---

## Configuration `.env`

Ajoute ces lignes au fichier `.env` (à la racine) :

```env
# WhatsApp (Meta Cloud API) — obligatoires
WHATSAPP_TOKEN=EAAG...ton_jeton_permanent
WHATSAPP_PHONE_NUMBER_ID=123456789012345

# Optionnelles (valeurs par défaut si omises)
WHATSAPP_API_VERSION=v22.0
WHATSAPP_TEMPLATE_LANG=fr
WHATSAPP_REMINDER_TEMPLATE=rdv_rappel
WHATSAPP_CONFIRMATION_TEMPLATE=rdv_confirmation
```

Puis redémarre le serveur (`pm2 restart` en prod). Sur la page **SMS** de
l'admin, le badge doit passer à **« Connecté »** et les toggles WhatsApp
deviennent activables.

---

## Test rapide

1. Numéro de test Meta configuré + template validé.
2. Active **« Confirmation par WhatsApp »** sur un établissement.
3. Fais une réservation avec un **numéro ajouté comme destinataire de test**
   dans l'interface Meta (obligatoire tant que le numéro n'est pas en
   production).
4. Vérifie la réception WhatsApp et les logs serveur
   (`[reminderScheduler] Rappel WhatsApp …` ou l'absence d'erreur `[whatsapp]`).

## Coûts (rappel)

| Poste | Coût |
|---|---|
| API Meta | Gratuit |
| Numéro dédié | ~5–10 € une fois (SIM) ou ~1 €/mois (Twilio) |
| Message « utility » | 0 € (fenêtre 24h) à ~0,03–0,05 € |
| Facturation interne | 5 c/message (`WHATSAPP_PRICE_CENTS`), même solde que le SMS |

## Passage en production

Tant que ton numéro est en **mode test**, tu ne peux écrire qu'à des numéros
ajoutés manuellement. Pour écrire à **tous tes clients** :

1. Vérifie ton entreprise (**Business Verification**) dans Business Settings.
2. Passe le numéro en **Live** dans la configuration WhatsApp.

Une fois vérifié, aucune limite de destinataires (au-delà des paliers de
qualité Meta habituels).
