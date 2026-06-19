// Palette de base + génération de couleurs supplémentaires (angle d'or en HSL)
// pour garantir une couleur UNIQUE à chaque service, même au-delà de 10 services.

const BASE_PALETTE = [
  "#1e7a4e", "#2563eb", "#7c3aed", "#db2777", "#ea580c",
  "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0d9488",
];

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(255 * f(n)).toString(16).padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

// index 0-9 → couleurs de la palette de base ; au-delà → angle d'or (137.508°)
// pour répartir les teintes le plus uniformément possible à l'infini.
function colorAt(index) {
  if (index < BASE_PALETTE.length) return BASE_PALETTE[index];
  const hue = ((index - BASE_PALETTE.length) * 137.508) % 360;
  return hslToHex(hue, 65, 42);
}

// Renvoie la première couleur (palette + générées) non présente dans usedColors.
function nextAvailableColor(usedColors) {
  const used = new Set((usedColors || []).filter(Boolean).map((c) => c.toLowerCase()));
  for (let i = 0; i < 2000; i++) {
    const c = colorAt(i);
    if (!used.has(c.toLowerCase())) return c;
  }
  // Filet de sécurité improbable (2000 services avec couleurs toutes prises)
  return colorAt(Math.floor(Math.random() * 100000));
}

module.exports = { BASE_PALETTE, colorAt, nextAvailableColor };
