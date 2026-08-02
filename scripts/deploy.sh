#!/usr/bin/env bash
#
# Déploiement du VPS, en un seul passage et sans surprise.
#
#   bash scripts/deploy.sh            # simulation : montre tout, n'écrit rien
#   bash scripts/deploy.sh --apply    # exécute réellement
#
# Pourquoi ce script plutôt qu'un « git pull && pm2 restart » à la main :
# certaines migrations DOIVENT tourner dans le même passage que le code
# qu'elles accompagnent. Les catégories d'un établissement, par exemple, sont
# lues sur la Company sans aucun repli vers l'ancien emplacement — déployer le
# code sans migrer fait disparaître les catégories des pros qui en ont.
#
# Le script s'arrête à la première erreur : mieux vaut un déploiement
# interrompu à mi-chemin qu'une base à moitié migrée sous un code redémarré.

set -euo pipefail

APPLIQUER=0
[ "${1:-}" = "--apply" ] && APPLIQUER=1

vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }
titre() { printf '\n\033[1m── %s ─────────────────────────────────\033[0m\n' "$*"; }

# Exécute une commande, ou l'affiche seulement en simulation.
faire() {
  if [ "$APPLIQUER" = "1" ]; then
    "$@"
  else
    gris "   (simulation) $*"
  fi
}

if [ "$APPLIQUER" = "0" ]; then
  printf '\033[33m%s\033[0m\n' "MODE SIMULATION — rien ne sera modifié. Relancez avec --apply pour exécuter."
fi

cd "$(dirname "$0")/.."
export NODE_ENV=production

# Garde-fou : ce script écrit en base de PRODUCTION et redémarre l'application.
# Lancé par erreur depuis un poste de développement, il migrerait la vraie base.
# La présence de pm2 est le marqueur le plus simple du serveur.
if [ "$APPLIQUER" = "1" ] && ! command -v pm2 >/dev/null 2>&1; then
  rouge "pm2 est introuvable : ce script n'est pas prévu pour cette machine."
  rouge "Il modifie la base de PRODUCTION — à lancer uniquement sur le VPS."
  rouge "Pour seulement regarder ce qu'il ferait, relancez-le sans --apply."
  exit 1
fi

# ── 1. Où en est-on ? ────────────────────────────────────────────────────────
titre "1/6 · État actuel"
echo "   dossier : $(pwd)"
echo "   commit  : $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
if [ -n "$(git status --porcelain)" ]; then
  rouge "   ATTENTION : des fichiers sont modifiés localement sur le serveur."
  git status --short | sed 's/^/     /'
  rouge "   Le git pull risque d'échouer. Réglez ça d'abord."
  [ "$APPLIQUER" = "1" ] && exit 1
fi

# ── 2. Récupérer le code ─────────────────────────────────────────────────────
titre "2/6 · Récupération du code"
faire git pull --ff-only
[ "$APPLIQUER" = "1" ] && echo "   nouveau commit : $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

# ── 3. Dépendances ───────────────────────────────────────────────────────────
titre "3/6 · Dépendances"
faire npm install --omit=dev

# ── 4. Migrations ────────────────────────────────────────────────────────────
# Chacune est idempotente : la relancer ne fait rien de plus. On les passe
# TOUJOURS, même si on pense qu'elles ont déjà tourné.
titre "4/6 · Migrations de données"
MIGRATIONS=(
  "migrate-identity-to-company"
  "migrate-categories-to-company"
  "attach-orphan-bookings"
)
for m in "${MIGRATIONS[@]}"; do
  echo ""
  echo "   ▸ $m"
  # La simulation de chaque migration est SANS effet : on la lance toujours,
  # y compris en mode simulation, pour montrer ce qui serait repris.
  node "scripts/$m.js" 2>&1 | sed 's/^/     /'
  faire node "scripts/$m.js" --apply
done

# ── 5. Configuration du paiement ─────────────────────────────────────────────
# Purement informatif : un plan impayable n'empêche pas de déployer, mais on
# ne veut pas le découvrir des semaines plus tard.
titre "5/6 · Vérification Stripe"
node scripts/check-stripe-prices.js 2>&1 | sed 's/^/   /' || \
  rouge "   La vérification Stripe a échoué — le déploiement continue."

# ── 6. Redémarrage ───────────────────────────────────────────────────────────
titre "6/6 · Redémarrage"
faire pm2 restart all
faire sleep 3
if [ "$APPLIQUER" = "1" ]; then
  pm2 list | sed 's/^/   /'
  # Un pm2 « online » ne prouve pas que l'application répond : on interroge
  # vraiment le port avant de déclarer que tout va bien.
  PORT_APP="${PORT:-3000}"
  if curl -sf -o /dev/null --max-time 10 "http://127.0.0.1:${PORT_APP}/"; then
    vert "   L'application répond sur le port ${PORT_APP}."
  else
    rouge "   L'application NE RÉPOND PAS sur le port ${PORT_APP}."
    rouge "   Regardez les journaux : pm2 logs --lines 50"
    exit 1
  fi
fi

titre "Terminé"
if [ "$APPLIQUER" = "1" ]; then
  vert "Déploiement effectué."
else
  echo "Simulation terminée. Relancez avec --apply pour exécuter :"
  echo "   bash scripts/deploy.sh --apply"
fi
