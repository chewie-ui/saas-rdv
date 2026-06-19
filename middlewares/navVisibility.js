const { getFlagsMap } = require("./featureFlag");
const { hrefToKey } = require("../utils/navLinks");

// Retire du HTML final les liens .sb-link dont le href correspond à une clé
// FeatureFlag "nav_*" désactivée par le superadmin. Travaille en chaîne de
// caractères ciblée sur les <a> (pas de parsing DOM complet de la page) pour
// rester rapide et ne jamais risquer d'altérer le reste du HTML. Générique :
// fonctionne pour n'importe quel lien .sb-link présent dans sidebar.pug, y
// compris ceux ajoutés après coup — aucune liste à maintenir ici.
module.exports = async function navVisibility(req, res, next) {
  const originalRender = res.render.bind(res);

  res.render = function (view, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    originalRender(view, options, async (err, html) => {
      if (err) {
        if (callback) return callback(err);
        return next(err);
      }

      try {
        if (html && html.indexOf('class="sidebar"') !== -1) {
          const flagsMap = await getFlagsMap();
          const disabledHrefs = new Set();
          Object.keys(flagsMap).forEach((key) => {
            if (key.startsWith("nav_") && flagsMap[key].status === "disabled") {
              // On ne connaît que la clé ici ; on retrouve le href en testant
              // chaque href candidat présent dans la page elle-même.
              disabledHrefs.add(key);
            }
          });

          if (disabledHrefs.size > 0) {
            html = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, (tag) => {
              if (!/class="[^"]*\bsb-link\b[^"]*"/.test(tag)) return tag;
              const hrefMatch = /href="([^"]*)"/.exec(tag);
              if (!hrefMatch) return tag;
              const key = hrefToKey(hrefMatch[1]);
              return disabledHrefs.has(key) ? "" : tag;
            });

            // Une section (titre + liens) dont tous les liens ont été retirés
            // ci-dessus ne doit plus afficher son titre tout seul.
            html = html.replace(/<div class="sb-section">[\s\S]*?<\/div>/g, (block) => {
              return /\bsb-link\b/.test(block) ? block : "";
            });
          }
        }
      } catch (e) {
        console.error("[navVisibility] post-process error:", e);
      }

      if (callback) return callback(null, html);
      res.send(html);
    });
  };

  next();
};
