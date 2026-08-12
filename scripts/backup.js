/**
 * Sauvegarde complète de BranShee : la base ET les fichiers.
 *
 * Il n'existait aucune sauvegarde. La base est sur MongoDB Atlas, dont l'offre
 * gratuite n'en fait aucune — et même une offre payante ne couvrirait pas les
 * fichiers, qui vivent sur le disque du VPS :
 *   • private_uploads/  documents des dossiers clients (données de santé)
 *   • public/uploads/    photos de profil et d'établissement
 *
 * Une base restaurée sans ses fichiers laisse des fiches qui pointent vers des
 * images disparues et des dossiers patients vides. Les deux vont ensemble.
 *
 *   node scripts/backup.js              # simulation : montre tout, n'écrit rien
 *   node scripts/backup.js --apply      # exécute la sauvegarde
 *   node scripts/backup.js --apply --local   # sauvegarde la base LOCALE
 *
 * Sortie dans BACKUP_DIR (défaut ~/backups/branshee), en 0700 : ces archives
 * contiennent des données de santé, elles ne doivent être lisibles que par leur
 * propriétaire.
 *
 * Prérequis sur le VPS : les MongoDB Database Tools (mongodump).
 *   sudo apt-get install -y mongodb-database-tools
 *
 * RESTAURATION (à tester au moins une fois — une sauvegarde jamais restaurée
 * n'est pas une sauvegarde) :
 *   mongorestore --uri="<URI>" --gzip --archive=base-AAAA-MM-JJ.gz --drop
 *   tar xzf fichiers-AAAA-MM-JJ.tgz -C /var/www/branshee.com
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const APPLIQUER = process.argv.includes("--apply");
const LOCAL = process.argv.includes("--local");

const URI = LOCAL ? process.env.MONGO_URI_LOCAL : process.env.MONGO_URI_SERVER;
const RACINE = path.join(__dirname, "..");
const DEST = process.env.BACKUP_DIR || path.join(os.homedir(), "backups", "branshee");
// Nombre de jours conservés. Au-delà, les archives sont supprimées : sans
// rotation, le disque du VPS se remplit et c'est l'application qui tombe.
const RETENTION_JOURS = Number(process.env.BACKUP_RETENTION_DAYS || 14);

// Dossiers de fichiers à sauvegarder, relatifs à la racine du projet.
const DOSSIERS_FICHIERS = ["private_uploads", "public/uploads"];

const horodatage = new Date().toISOString().slice(0, 10);

function ko(n) {
  if (n < 1024) return n + " o";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " Ko";
  return (n / 1024 / 1024).toFixed(1) + " Mo";
}

function titre(s) {
  console.log("\n── " + s + " " + "─".repeat(Math.max(0, 56 - s.length)));
}

/**
 * Lance mongodump SANS mettre l'URI sur la ligne de commande : elle contient
 * le mot de passe, et `ps aux` la rendrait lisible par tout utilisateur du
 * serveur. On passe par un fichier de configuration en 0600, effacé ensuite.
 */
function dumperBase(sortie) {
  const conf = path.join(os.tmpdir(), `.branshee-dump-${process.pid}.yaml`);
  fs.writeFileSync(conf, `uri: "${URI}"\n`, { mode: 0o600 });
  try {
    execFileSync("mongodump", ["--config", conf, "--gzip", `--archive=${sortie}`], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } finally {
    try { fs.unlinkSync(conf); } catch (_) {}
  }
}

function archiverFichiers(sortie, dossiers) {
  execFileSync("tar", ["czf", sortie, "-C", RACINE, ...dossiers], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/** Supprime les archives plus vieilles que la rétention. */
function purger() {
  const limite = Date.now() - RETENTION_JOURS * 86400000;
  let supprimes = 0;
  for (const f of fs.readdirSync(DEST)) {
    if (!/^(base|fichiers)-\d{4}-\d{2}-\d{2}\.(gz|tgz)$/.test(f)) continue;
    const p = path.join(DEST, f);
    if (fs.statSync(p).mtimeMs >= limite) continue;
    console.log(`  − ${f} (plus de ${RETENTION_JOURS} jours)`);
    if (APPLIQUER) fs.unlinkSync(p);
    supprimes++;
  }
  if (!supprimes) console.log("  rien à purger");
}

(function main() {
  console.log(`BranShee — sauvegarde ${LOCAL ? "LOCALE" : "PRODUCTION"} du ${horodatage}`);
  console.log(APPLIQUER ? "Mode : ÉCRITURE" : "Mode : simulation (rien n'est écrit)");

  if (!URI) {
    console.error(`\nVariable ${LOCAL ? "MONGO_URI_LOCAL" : "MONGO_URI_SERVER"} absente de .env.`);
    process.exit(1);
  }

  titre("Destination");
  console.log("  " + DEST + `   (rétention ${RETENTION_JOURS} jours)`);
  if (APPLIQUER) fs.mkdirSync(DEST, { recursive: true, mode: 0o700 });

  // ── Base ────────────────────────────────────────────────────────────────
  titre("Base de données");
  const fBase = path.join(DEST, `base-${horodatage}.gz`);
  console.log("  mongodump → " + path.basename(fBase));
  if (APPLIQUER) {
    try {
      dumperBase(fBase);
    } catch (err) {
      const detail = (err.stderr && err.stderr.toString().trim()) || err.message;
      console.error("\n  ÉCHEC du dump : " + detail.split("\n").slice(-3).join(" "));
      if (/ENOENT/.test(err.message)) {
        console.error("  mongodump est introuvable. Installez-le :");
        console.error("    sudo apt-get install -y mongodb-database-tools");
      }
      process.exit(1);
    }
    fs.chmodSync(fBase, 0o600);
    const t = fs.statSync(fBase).size;
    // Une archive quasi vide signale un dump raté que mongodump n'a pas
    // signalé : mieux vaut échouer bruyamment que garder une fausse sauvegarde.
    if (t < 1024) {
      console.error(`  ÉCHEC : archive de ${t} o, c'est anormalement petit.`);
      process.exit(1);
    }
    console.log("  ✓ " + ko(t));
  }

  // ── Fichiers ────────────────────────────────────────────────────────────
  titre("Fichiers téléversés");
  const presents = DOSSIERS_FICHIERS.filter((d) => fs.existsSync(path.join(RACINE, d)));
  for (const d of DOSSIERS_FICHIERS) {
    const existe = presents.includes(d);
    let n = 0;
    if (existe) {
      const compter = (p) => fs.readdirSync(p, { withFileTypes: true })
        .reduce((s, e) => s + (e.isDirectory() ? compter(path.join(p, e.name)) : 1), 0);
      n = compter(path.join(RACINE, d));
    }
    console.log(`  ${existe ? "✓" : "—"} ${d.padEnd(20)} ${existe ? n + " fichier(s)" : "absent"}`);
  }
  const fFichiers = path.join(DEST, `fichiers-${horodatage}.tgz`);
  if (!presents.length) {
    console.log("  aucun dossier à archiver");
  } else if (APPLIQUER) {
    try {
      archiverFichiers(fFichiers, presents);
      fs.chmodSync(fFichiers, 0o600);
      console.log("  ✓ " + path.basename(fFichiers) + "  " + ko(fs.statSync(fFichiers).size));
    } catch (err) {
      console.error("  ÉCHEC de l'archive : " + ((err.stderr && err.stderr.toString().trim()) || err.message));
      process.exit(1);
    }
  } else {
    console.log("  tar → " + path.basename(fFichiers));
  }

  // ── Purge ───────────────────────────────────────────────────────────────
  titre("Purge des anciennes archives");
  if (fs.existsSync(DEST)) purger();
  else console.log("  (dossier pas encore créé)");

  console.log("");
  if (APPLIQUER) console.log("Sauvegarde terminée.");
  else console.log("Relancez avec --apply pour exécuter.");
})();
