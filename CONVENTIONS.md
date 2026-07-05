# Conventions de code — BranShee (saas-rdv)

> **À LIRE AVANT DE CODER.** Ce fichier liste les règles à respecter pour toute
> modification de code. Si une demande entre en conflit avec une règle, on suit
> la règle (ou on le signale). Quentin peut ajouter/modifier des règles ici à
> tout moment.

---

## 1. Icônes

- **Interface admin (tout ce qui étend `views/layouts/admin.pug`)** : toute icône
  **DOIT** être une icône **Google Material Symbols**, jamais un `<svg>` avec des
  `path` dessinés à la main, ni FontAwesome, ni autre.
  ```pug
  span.material-symbols-outlined lock
  span.material-symbols-outlined add
  ```
  La police est déjà chargée dans `admin.pug`. Taille via `font-size` en CSS.
- **Exception — pages publiques self-contained** : le **site public**
  (`views/pages/public/site.pug` + `site.css`), la **page de réservation**
  (`views/pages/client/index.pug` + `client-booking.css`) et les **templates de
  site** (`config/site-templates.js`) n'ont **pas** Material Symbols chargé et
  utilisent volontairement des SVG inline / emojis (design autonome). Ne pas y
  imposer Material Symbols.

## 2. Boutons

- Tout bouton **DOIT** utiliser les classes partagées définies dans
  `public/css/classes.css` — ne pas recréer de styles de bouton ad hoc.
  - Base : `.sm-btn`
  - Variantes : `.sm-btn--primary`, `.sm-btn--ghost`, `.sm-btn--soft`,
    `.sm-btn--danger`, `.sm-btn--white`, `.sm-btn--full` (pleine largeur)
  ```pug
  button.sm-btn.sm-btn--primary(type="button")
    span.material-symbols-outlined add
    span Ajouter
  ```
- Exceptions : mêmes pages publiques self-contained qu'au §1 (elles ont leurs
  propres classes de boutons, ex. `.bk-cart__next`, `.btn--primary` du site).

## 3. Design / style

- **Couleur d'accent admin** : variable CSS `--accent` (+ `--accent-soft`,
  `--accent-hover`). Ne pas coder de vert en dur.
- **Rayons, ombres, surfaces** : réutiliser les variables existantes
  (`--radius-*`, `--shadow`, `--surface`, `--border-light`, `--text-muted`…).
- **Traductions** : les textes visibles passent par `t.*` (6 langues :
  fr/en/es/it/de/nl dans `locales/`). Ajouter la clé dans **toutes** les langues.
- _(Quentin ajoutera ici ses consignes : police, palette, etc.)_

## 4. Vérification

- Après une modif observable dans le navigateur, vérifier le rendu (aperçu /
  serveur statique) plutôt que d'affirmer que « c'est bon » sans preuve.
- Garder les accolades CSS équilibrées ; compiler les `.pug` modifiés.

---

_Dernière mise à jour : 2026-07-05._
