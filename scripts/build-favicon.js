/**
 * Génère public/favicon.ico (32x32) à partir de public/images/icon.svg.
 *
 * Safari et de nombreux robots demandent /favicon.ico en dur, sans lire les
 * balises <link>. Sans ce fichier la requête retombait sur la page d'erreur 404
 * (17 ko de HTML à chaque visite).
 *
 * La source est le PNG embarqué dans icon.svg, et surtout PAS icon.png : ce
 * dernier a un fond blanc opaque, ce qui donnerait un carré blanc autour du
 * logo sur les barres d'onglets sombres.
 *
 * Décodage/ré-encodage PNG faits à la main avec zlib (aucune dépendance).
 *
 *   node scripts/build-favicon.js
 *
 * À relancer après chaque changement de logo, en incrémentant aussi le `?v=`
 * des balises <link> dans views/layouts/*.pug.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = path.join(__dirname, "..", "public", "images", "icon.svg");
const OUT = path.join(__dirname, "..", "public", "favicon.ico");
const TAILLE = 32;

/** icon.svg n'est qu'une enveloppe autour d'un PNG en base64. */
function pngDuSvg(chemin) {
  const svg = fs.readFileSync(chemin, "utf8");
  const m = svg.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!m) throw new Error("Aucun PNG embarqué dans " + chemin);
  return Buffer.from(m[1], "base64");
}

function lirePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Pas un PNG");
  const largeur = buf.readUInt32BE(16);
  const hauteur = buf.readUInt32BE(20);
  const profondeur = buf.readUInt8(24);
  const typeCouleur = buf.readUInt8(25);
  const entrelace = buf.readUInt8(28);
  // 6 = RGBA direct, 3 = palette (le logo actuel) ; les deux en 8 bits.
  if (profondeur !== 8 || (typeCouleur !== 6 && typeCouleur !== 3) || entrelace !== 0) {
    throw new Error(`Format non géré (depth=${profondeur} color=${typeCouleur} interlace=${entrelace})`);
  }

  // Concaténer les chunks IDAT, récupérer palette et transparence
  const morceaux = [];
  let palette = null, alphaPalette = null;
  let pos = 8;
  while (pos < buf.length) {
    const taille = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + taille);
    if (type === "IDAT") morceaux.push(data);
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alphaPalette = data;
    if (type === "IEND") break;
    pos += taille + 12;
  }
  const brut = zlib.inflateSync(Buffer.concat(morceaux));

  // Défiltrage des scanlines (filtres PNG 0 à 4)
  const bpp = typeCouleur === 6 ? 4 : 1;
  const parLigne = largeur * bpp;
  const px = Buffer.alloc(largeur * hauteur * bpp);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (parLigne + 1)];
    const src = y * (parLigne + 1) + 1;
    const dst = y * parLigne;
    for (let i = 0; i < parLigne; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0;
      const b = y > 0 ? px[dst - parLigne + i] : 0;
      const c = y > 0 && i >= bpp ? px[dst - parLigne + i - bpp] : 0;
      const x = brut[src + i];
      let val;
      if (filtre === 0) val = x;
      else if (filtre === 1) val = x + a;
      else if (filtre === 2) val = x + b;
      else if (filtre === 3) val = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[dst + i] = val & 0xff;
    }
  }

  if (typeCouleur === 6) return { largeur, hauteur, px };

  // Palette → RGBA
  const rgba = Buffer.alloc(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    const idx = px[i];
    rgba[i * 4] = palette[idx * 3];
    rgba[i * 4 + 1] = palette[idx * 3 + 1];
    rgba[i * 4 + 2] = palette[idx * 3 + 2];
    rgba[i * 4 + 3] = alphaPalette && idx < alphaPalette.length ? alphaPalette[idx] : 255;
  }
  return { largeur, hauteur, px: rgba };
}

/** Réduction par moyenne de blocs (box filter) — suffisant pour un aplat. */
function reduire(img, taille) {
  const bloc = img.largeur / taille;
  const out = Buffer.alloc(taille * taille * 4);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const somme = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * bloc); sy < Math.floor((y + 1) * bloc); sy++) {
        for (let sx = Math.floor(x * bloc); sx < Math.floor((x + 1) * bloc); sx++) {
          const i = (sy * img.largeur + sx) * 4;
          for (let k = 0; k < 4; k++) somme[k] += img.px[i + k];
          n++;
        }
      }
      const o = (y * taille + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = Math.round(somme[k] / n);
    }
  }
  return out;
}

function ecrirePng(px, taille) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const corps = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corps) >>> 0);
    return Buffer.concat([len, corps, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr.writeUInt8(8, 8);   // profondeur
  ihdr.writeUInt8(6, 9);   // RGBA
  // filtre 0 sur chaque scanline
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0;
    px.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(brut, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** ICO contenant un PNG — accepté par tous les navigateurs modernes. */
function emballerIco(png, taille) {
  const entete = Buffer.alloc(22);
  entete.writeUInt16LE(0, 0);
  entete.writeUInt16LE(1, 2);           // type = icône
  entete.writeUInt16LE(1, 4);           // 1 image
  entete.writeUInt8(taille, 6);
  entete.writeUInt8(taille, 7);
  entete.writeUInt16LE(1, 10);          // plans
  entete.writeUInt16LE(32, 12);         // bits par pixel
  entete.writeUInt32LE(png.length, 14);
  entete.writeUInt32LE(22, 18);         // décalage des données
  return Buffer.concat([entete, png]);
}

const source = lirePng(pngDuSvg(SRC));
const reduit = reduire(source, TAILLE);
const ico = emballerIco(ecrirePng(reduit, TAILLE), TAILLE);
fs.writeFileSync(OUT, ico);

let opaques = 0;
for (let i = 3; i < reduit.length; i += 4) if (reduit[i] > 60) opaques++;
console.log(
  `favicon.ico écrit : ${ico.length} o — ${TAILLE}x${TAILLE}, ` +
  `${opaques}/${TAILLE * TAILLE} pixels opaques (source ${source.largeur}x${source.hauteur})`
);
