/**
 * BranShee — Dark / Light mode toggle
 * Persiste le choix dans localStorage, appliqué tôt pour éviter le flash.
 */

const STORAGE_KEY = 'branshee-theme';

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else {
    html.removeAttribute('data-theme');
  }
}

function getStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function setStoredTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
}

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function toggleTheme() {
  const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  setStoredTheme(next);
  updateAllToggles(next);
}

function updateAllToggles(theme) {
  const isDark = theme === 'dark';
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.setAttribute('aria-label', isDark ? 'Passer en mode clair' : 'Passer en mode sombre');
    btn.setAttribute('data-theme-current', theme);
    // Sun icon = dark mode active (switch to light), Moon icon = light mode active (switch to dark)
    btn.querySelector('.theme-toggle__moon')?.classList.toggle('hidden', isDark);
    btn.querySelector('.theme-toggle__sun')?.classList.toggle('hidden', !isDark);
  });
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const stored = getStoredTheme() || 'light';
  applyTheme(stored);
  updateAllToggles(stored);

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
});
