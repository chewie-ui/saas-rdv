/* ════════════════════════════════════════════════════════════════════════
   Upload de photos — robuste sur tous les appareils (iPhone, Mac, Android,
   desktop), avec retour visuel (progression) et messages d'erreur précis.

   Pourquoi ce fichier existe :
   - Les photos "Galerie" d'iPhone sont en HEIC. Safari/iOS et macOS savent
     décoder le HEIC nativement (au niveau OS) — donc <img> + <canvas>
     fonctionnent directement. Chrome/Firefox/Edge ne le peuvent PAS.
   - On tente donc d'abord un décodage natif (rapide, fiable, gère aussi
     l'orientation EXIF automatiquement). S'il échoue ET que le fichier
     ressemble à du HEIC, on charge heic2any (WASM) à la volée comme filet
     de sécurité pour les navigateurs non-Apple.
   - Dans tous les cas, l'image est redimensionnée côté navigateur avant
     l'envoi — ça règle aussi la lenteur (on n'envoie plus des photos de
     12-48 Mpx telles quelles).
   - Si la préparation navigateur échoue malgré tout, on envoie le fichier
     original : le serveur a son propre pipeline de conversion (sharp +
     heic-convert) en filet de secours final.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  const MAX_DIM = 1920;
  const JPEG_QUALITY = 0.85;
  const HARD_MAX_BYTES = 60 * 1024 * 1024;
  const HEIC_MIME_RE = /^image\/hei[cf]/i;
  const HEIC_EXT_RE = /\.(heic|heif)$/i;
  const HEIC_BRANDS = ["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];

  function safeJpgName(name) {
    return (name || "photo").replace(/\.[^./\\]+$/, "") + ".jpg";
  }

  async function looksLikeHeic(file) {
    if (HEIC_MIME_RE.test(file.type || "")) return true;
    if (HEIC_EXT_RE.test(file.name || "")) return true;
    try {
      const buf = await file.slice(0, 12).arrayBuffer();
      const b = new Uint8Array(buf);
      const ftyp = String.fromCharCode(b[4], b[5], b[6], b[7]);
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      return ftyp === "ftyp" && HEIC_BRANDS.indexOf(brand) !== -1;
    } catch (_) {
      return false;
    }
  }

  function loadImageEl(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode-failed")); };
      img.src = url;
    });
  }

  let heic2anyLoading = null;
  function ensureHeic2any() {
    if (window.heic2any) return Promise.resolve();
    if (!heic2anyLoading) {
      heic2anyLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/js/vendor/heic2any.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("lib-load-failed"));
        document.head.appendChild(script);
      });
    }
    return heic2anyLoading;
  }

  // Décode (natif, sinon heic2any en secours) puis redimensionne en JPEG.
  async function prepareImage(file) {
    let loaded;
    try {
      loaded = await loadImageEl(file);
    } catch (_) {
      if (!(await looksLikeHeic(file))) {
        throw new Error("Cette image n'a pas pu être lue par votre navigateur.");
      }
      await ensureHeic2any();
      const converted = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
      loaded = await loadImageEl(jpegBlob);
    }

    const { img, url } = loaded;
    const w = img.naturalWidth, h = img.naturalHeight;
    let targetW = w, targetH = h;
    if (w > MAX_DIM || h > MAX_DIM) {
      const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
      targetW = Math.round(w * scale);
      targetH = Math.round(h * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.getContext("2d").drawImage(img, 0, 0, targetW, targetH);
    URL.revokeObjectURL(url);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export-failed"))), "image/jpeg", JPEG_QUALITY);
    });
    return { blob, filename: safeJpgName(file.name) };
  }

  function xhrUpload({ url, method, fieldName, items, extraFields, onProgress }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method || "PATCH", url);
      xhr.timeout = 90000;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) {
          resolve(data);
        } else {
          reject(new Error(data.message || data.error || `Erreur serveur (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error("Erreur réseau. Vérifiez votre connexion et réessayez."));
      xhr.ontimeout = () => reject(new Error("L'envoi a expiré. Vérifiez votre connexion et réessayez."));
      const fd = new FormData();
      items.forEach((it) => fd.append(fieldName, it.blob, it.filename));
      Object.keys(extraFields || {}).forEach((k) => fd.append(k, extraFields[k]));
      xhr.send(fd);
    });
  }

  // ── UI : pastille de progression + toast d'erreur (autonomes, sans dépendance CSS) ──
  let styleInjected = false;
  function injectStyleOnce() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement("style");
    style.textContent = "@keyframes bkUploadSpin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
  }

  function setProgressUI(message) {
    injectStyleOnce();
    let el = document.getElementById("bkUploadProgress");
    if (!el) {
      el = document.createElement("div");
      el.id = "bkUploadProgress";
      el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:99999;max-width:90vw;text-align:center;display:flex;align-items:center;gap:10px;";
      document.body.appendChild(el);
    }
    el.innerHTML = `<span style="width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;display:inline-block;animation:bkUploadSpin .7s linear infinite;flex-shrink:0;"></span><span>${message}</span>`;
  }

  function clearProgressUI() {
    const el = document.getElementById("bkUploadProgress");
    if (el) el.remove();
  }

  function showUploadErrorToast(message) {
    const existing = document.getElementById("bkUploadErrorToast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "bkUploadErrorToast";
    toast.textContent = message;
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#dc2626;color:#fff;padding:12px 20px;border-radius:10px;font-size:13.5px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:99999;max-width:90vw;text-align:center;";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // ── API publique ──────────────────────────────────────────────────────
  // files: File | File[]. Gère seul la progression + les erreurs (toast).
  // Résout avec le JSON serveur en cas de succès ; rejette une Error déjà
  // accompagnée d'un toast affiché à l'écran.
  async function uploadImages({ url, method, fieldName, files, extraFields }) {
    const fileList = Array.isArray(files) ? files : Array.from(files || []);
    if (!fileList.length) throw new Error("Aucun fichier sélectionné.");

    for (const f of fileList) {
      if (f.size > HARD_MAX_BYTES) {
        const err = new Error(`"${f.name}" est trop volumineuse (60 Mo max). Essayez une autre photo.`);
        showUploadErrorToast(err.message);
        throw err;
      }
    }

    setProgressUI(fileList.length > 1 ? "Traitement des photos…" : "Traitement de la photo…");
    const items = [];
    for (const file of fileList) {
      try {
        items.push(await prepareImage(file));
      } catch (err) {
        console.warn("[upload] préparation navigateur impossible, envoi du fichier original au serveur:", err.message);
        setProgressUI("Traitement avancé en cours, ça peut prendre un instant…");
        items.push({ blob: file, filename: file.name || "photo.jpg" });
      }
    }

    setProgressUI("Envoi… 0%");
    try {
      const data = await xhrUpload({
        url, method, fieldName, items, extraFields,
        onProgress: (pct) => setProgressUI(`Envoi… ${pct}%`),
      });
      clearProgressUI();
      return data;
    } catch (err) {
      clearProgressUI();
      showUploadErrorToast(err.message);
      throw err;
    }
  }

  function uploadImage({ url, method, fieldName, file, extraFields }) {
    return uploadImages({ url, method, fieldName, files: [file], extraFields });
  }

  window.BkImageUpload = { uploadImage, uploadImages };
})();
