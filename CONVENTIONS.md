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

## 2 bis. Base de composants — `public/css/ds.css`

> **Page de référence vivante : [`/design.html`](public/design.html)** — ouvre-la
> pour voir tous les composants avec leurs états.

Un composant n'est défini **qu'une seule fois**, dans `ds.css` (chargé partout
via `import.css`). Avant d'écrire une règle CSS, vérifier qu'elle n'y est pas
déjà : c'est ce qui a produit 4 systèmes d'onglets et 6 systèmes de tableaux
tous légèrement différents.

| Besoin | Classes |
|---|---|
| Onglets | `.ds-tabs` / `.ds-tab` (+ `.is-active`, `.ds-tab__count`) |
| Tableau | `.ds-table-wrap` / `.ds-table`, `.ds-td--actions`, `.ds-row--highlight` |
| Cellule personne | `.ds-person` + `__img` / `__name` / `__sub` |
| Barre d'outils | `.ds-toolbar`, `.ds-toolbar__end`, `.ds-search` |
| Champ | `.ds-field` + `.ds-label` + `.ds-input` / `.ds-select` / `.ds-textarea` + `.ds-help` |
| Champ à icône/préfixe | `.ds-input-group` + `__ic` / `__prefix` / `__suffix` |
| Case, radio | `.ds-choice` (+ `--radio`) |
| Interrupteur | `.ds-switch` |
| Étiquette, compteur | `.ds-badge` (+ `--success/--warning/--danger/--solid`), `.ds-count` |
| Action en icône | `.ds-ico` (+ `--danger`) |
| Menu « ⋯ » | `.ds-menu` + `.ds-menu__list` / `__item` / `__sep` |
| Carte | `.ds-box` (⚠ pas `.ds-card`, déjà pris par une carte du tableau de bord) |
| Pagination | `.ds-pager` |
| Alerte, notification | `.ds-alert` (+ `--info/--success/--warning/--danger`, `--row`) |
| **Select habillé** | `data-ds-select` sur le `<select>` (+ `data-ds-select-size="sm"`) — le natif reste dans le DOM, `.value` et `change` inchangés |

Règles :

1. **Onglets** : un seul design pour tout le site — soulignement fin, jamais de
   pilule ni de fond coloré. Les anciens noms (`.cd-tab`, `.av2-tab`, `.cz-tab`)
   sont branchés en alias dans `ds.css` ; ne pas les redéfinir ailleurs.
2. **Tableaux** : tous alignés sur la page Clients (en-tête 12,5 px graisse 500,
   cellules 13,5 px, retrait 10/16 et 12/16).
3. **Actions d'une ligne** : jusqu'à 2 actions → icônes `.ds-ico` visibles ;
   au-delà → menu `.ds-menu`. Ne pas mélanger les deux dans un même tableau.
4. **Jamais de valeur en dur** pour une couleur, une ombre ou un rayon : utiliser
   les jetons (`--accent`, `--border-light`, `--ds-r-sm`, `--ds-shadow-md`…).
5. Une page peut **ajuster** un détail (marge, largeur de colonne) dans son
   propre CSS, mais **jamais redéfinir** la base d'un composant.

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
