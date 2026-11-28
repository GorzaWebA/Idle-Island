'use strict';
/* Player preferences for this device: graphics, motion, theme, sound, overlays.
   Kept under their own localStorage key, separate from the game save, so saves stay exactly as
   they were (and a save string moved to another device doesn't drag its graphics along).
   Unknown or missing fields fall back to the defaults below; old fields are never renamed. */
const SETTINGS_KEY = 'idle-island-settings-v1';

const SETTINGS_DEFAULTS = {
  quality: 'auto',        // auto | low | medium | high
  shadows: 'auto',        // auto (follow quality) | on | off
  pixelRatio: 'auto',     // auto | 1 | 1.5 | 2  (cap on the device pixel ratio)
  particles: 'auto',      // auto | low | medium | high
  motion: 'system',       // system | reduce | full
  autoRotate: false,      // turn slowly round the island after 20 s idle
  theme: 'system',        // system | light | dark
  healthBars: true,
  damageNumbers: false,
  perfOverlay: false,     // frame rate and draw calls (also F3)
  sound: false,           // off on first load
  volume: 0.6
};

const SETTINGS_CHOICES = {
  quality: ['auto', 'low', 'medium', 'high'],
  shadows: ['auto', 'on', 'off'],
  pixelRatio: ['auto', '1', '1.5', '2'],
  particles: ['auto', 'low', 'medium', 'high'],
  motion: ['system', 'reduce', 'full'],
  theme: ['system', 'light', 'dark']
};

let SETTINGS = Object.assign({}, SETTINGS_DEFAULTS);
const settingsListeners = [];
let storedQuality = null;      // the saved choice while ?quality= overrides it for this visit

function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { raw = null; }
  const s = Object.assign({}, SETTINGS_DEFAULTS);
  if (raw && typeof raw === 'object') {
    for (const k in SETTINGS_DEFAULTS) {
      if (!(k in raw)) continue;
      const v = raw[k], d = SETTINGS_DEFAULTS[k];
      if (SETTINGS_CHOICES[k]) { if (SETTINGS_CHOICES[k].includes(String(v))) s[k] = String(v); }
      else if (typeof d === 'boolean') s[k] = !!v;
      else if (typeof d === 'number' && isFinite(v)) s[k] = Math.max(0, Math.min(1, +v));
    }
  }
  // ?quality=low|medium|high (tests, troubleshooting) overrides the stored choice for this visit
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q && SETTINGS_CHOICES.quality.includes(q)) { storedQuality = s.quality; s.quality = q; }
  } catch (e) { /* no URL */ }
  SETTINGS = s;
  applyThemeSetting();
  return s;
}

function saveSettings() {
  const s = storedQuality ? Object.assign({}, SETTINGS, { quality: storedQuality }) : SETTINGS;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
}

// Change one setting, store it and tell whoever listens (renderer, audio).
function setSetting(key, value) {
  if (!(key in SETTINGS_DEFAULTS)) return false;
  const d = SETTINGS_DEFAULTS[key];
  if (SETTINGS_CHOICES[key]) { value = String(value); if (!SETTINGS_CHOICES[key].includes(value)) return false; }
  else if (typeof d === 'boolean') value = value === true || value === 'true' || value === 'on';
  else if (typeof d === 'number') { value = +value; if (!isFinite(value)) return false; value = Math.max(0, Math.min(1, value)); }
  if (key === 'quality' && storedQuality !== null) {        // the player's own choice wins over the URL
    storedQuality = null;
    if (SETTINGS.quality === value) { saveSettings(); return false; }
  }
  if (SETTINGS[key] === value) return false;
  SETTINGS[key] = value;
  saveSettings();
  if (key === 'theme') applyThemeSetting();
  for (const fn of settingsListeners) { try { fn(key, value); } catch (e) { /* a listener failed */ } }
  return true;
}
function onSettingsChange(fn) { settingsListeners.push(fn); }

// The page follows the system theme unless the player picked one.
function applyThemeSetting() {
  const root = document.documentElement;
  if (SETTINGS.theme === 'system') { if (root.hasAttribute('data-theme')) root.removeAttribute('data-theme'); }
  else if (root.getAttribute('data-theme') !== SETTINGS.theme) root.setAttribute('data-theme', SETTINGS.theme);
}

// Reduced motion: the player's choice, or the system's when left on "system".
function prefersReducedMotion() {
  if (SETTINGS.motion === 'reduce') return true;
  if (SETTINGS.motion === 'full') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

loadSettings();
