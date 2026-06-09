(function () {
  'use strict';

  var overlay   = document.getElementById('freeMonthOverlay');
  if (!overlay) return;

  var modal         = overlay.querySelector('.fm-modal');
  var closeBtn      = document.getElementById('fmClose');
  var tabRegister   = document.getElementById('fmTabRegister');
  var tabLogin      = document.getElementById('fmTabLogin');
  var formRegister  = document.getElementById('fmRegisterForm');
  var formLogin     = document.getElementById('fmLoginForm');
  var errorBox      = document.getElementById('fmError');
  var successBox    = document.getElementById('fmSuccess');
  var businessInput = document.getElementById('fmBusiness');
  var businessList  = document.getElementById('fmBusinessList');

  var PLAN    = 'business';
  var BILLING = 'monthly';
  var PROMO   = 'BIENVENUE';

  // ── Open / close ───────────────────────────────────────────────────────────
  window.openFreeMonthModal = function () {
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var first = formRegister.querySelector('input');
      if (first) first.focus();
    }, 220);
  };

  function close() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
  });

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function switchTab(to) {
    var isRegister = to === 'register';
    tabRegister.classList.toggle('is-active', isRegister);
    tabLogin.classList.toggle('is-active', !isRegister);
    formRegister.classList.toggle('is-active', isRegister);
    formLogin.classList.toggle('is-active', !isRegister);
    hideError();
  }

  tabRegister.addEventListener('click', function () { switchTab('register'); });
  tabLogin.addEventListener('click', function () { switchTab('login'); });

  // ── Error / success helpers ─────────────────────────────────────────────────
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('is-visible');
  }
  function hideError() {
    errorBox.classList.remove('is-visible');
    errorBox.textContent = '';
  }
  function showSuccess() {
    formRegister.style.display = 'none';
    formLogin.style.display = 'none';
    overlay.querySelector('.fm-tabs').style.display = 'none';
    overlay.querySelector('.fm-promo-tag').style.display = 'none';
    errorBox.style.display = 'none';
    successBox.classList.add('is-visible');
  }

  // ── Set loading state on a submit button ────────────────────────────────────
  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
  }

  // ── Business type autocomplete ──────────────────────────────────────────────
  var _services = window.__fmServices || [];

  function normalize(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function renderList(items) {
    businessList.innerHTML = '';
    if (!items.length) { businessList.classList.remove('is-open'); return; }
    items.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'fm-autocomplete__item';
      div.textContent = item;
      div.addEventListener('mousedown', function (e) {
        e.preventDefault();
        businessInput.value = item;
        businessList.classList.remove('is-open');
      });
      businessList.appendChild(div);
    });
    businessList.classList.add('is-open');
  }

  if (businessInput) {
    businessInput.addEventListener('input', function () {
      var q = normalize(businessInput.value.trim());
      if (!q) { businessList.classList.remove('is-open'); return; }
      renderList(_services.filter(function (s) { return normalize(s).includes(q); }).slice(0, 8));
    });
    businessInput.addEventListener('blur', function () {
      setTimeout(function () { businessList.classList.remove('is-open'); }, 150);
    });
  }

  // ── Set pending plan/promo in session ───────────────────────────────────────
  async function setPending() {
    try {
      await fetch('/auth/set-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({ plan: PLAN, billing: BILLING, promo: PROMO }),
      });
    } catch (_) {}
  }

  // ── Register submit ─────────────────────────────────────────────────────────
  formRegister.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError();

    var btn = formRegister.querySelector('.fm-submit');
    setLoading(btn, true);

    await setPending();

    var body = new URLSearchParams({
      fullname:       document.getElementById('fmName').value.trim(),
      email:          document.getElementById('fmEmail').value.trim(),
      password:       document.getElementById('fmPwd').value,
      conformPassword: document.getElementById('fmPwd2').value,
      businessType:   document.getElementById('fmBusiness').value.trim(),
    });

    try {
      var res  = await fetch('/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'fetch',
        },
        body: body.toString(),
      });
      var data = await res.json();
      if (data.error) {
        showError(data.error);
        setLoading(btn, false);
        return;
      }
      if (data.redirect) {
        showSuccess();
        setTimeout(function () { window.location.href = data.redirect; }, 900);
      }
    } catch (_) {
      showError('Erreur réseau. Veuillez réessayer.');
      setLoading(btn, false);
    }
  });

  // ── Login submit ────────────────────────────────────────────────────────────
  formLogin.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError();

    var btn = formLogin.querySelector('.fm-submit');
    setLoading(btn, true);

    await setPending();

    var body = new URLSearchParams({
      email:    document.getElementById('fmLoginEmail').value.trim(),
      password: document.getElementById('fmLoginPwd').value,
    });

    try {
      var res  = await fetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'fetch',
        },
        body: body.toString(),
      });
      var data = await res.json();
      if (data.error) {
        showError(data.error);
        setLoading(btn, false);
        return;
      }
      if (data.redirect) {
        // 2FA required
        if (data.redirect.includes('/login/2fa')) {
          window.location.href = data.redirect;
          return;
        }
        showSuccess();
        setTimeout(function () { window.location.href = data.redirect; }, 900);
      }
    } catch (_) {
      showError('Erreur réseau. Veuillez réessayer.');
      setLoading(btn, false);
    }
  });

})();
