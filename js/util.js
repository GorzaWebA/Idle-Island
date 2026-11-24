'use strict';
/* Small shared helpers: seeded RNG, noise, math, number formatting. */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulation randomness (not seeded per island; battles are not saved).
let RNG = mulberry32((Date.now() ^ 0x5bd1e995) >>> 0);
function rand() { return RNG(); }
function randRange(a, b) { return a + RNG() * (b - a); }
function randInt(a, b) { return a + Math.floor(RNG() * (b - a + 1)); }
function pick(arr, r) { return arr[Math.floor((r || RNG)() * arr.length)]; }

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// Value noise on an integer lattice, smoothed. Returns f(x, y) in [0, 1].
function makeNoise(r) {
  const P = 64, grid = new Float32Array(P * P);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const g = (x, y) => grid[((y & (P - 1)) * P) + (x & (P - 1))];
  const s = t => t * t * (3 - 2 * t);
  return function (x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = s(x - x0), fy = s(y - y0);
    const a = lerp(g(x0, y0), g(x0 + 1, y0), fx);
    const b = lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), fx);
    return lerp(a, b, fy);
  };
}
function fbm(noise, x, y) {
  return noise(x, y) * 0.6 + noise(x * 2.03 + 17.1, y * 2.03 + 9.7) * 0.3 + noise(x * 4.1 + 3.3, y * 4.1 + 41.9) * 0.1;
}

const NUM_SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (!isFinite(n)) return '∞';
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n < 10) s = (Math.floor(n * 10) / 10).toString();
  else if (n < 1000) s = Math.floor(n).toString();
  else {
    let i = 0;
    while (n >= 1000 && i < NUM_SUFFIX.length - 1) { n /= 1000; i++; }
    s = (n < 10 ? (Math.floor(n * 100) / 100).toFixed(2) : n < 100 ? (Math.floor(n * 10) / 10).toFixed(1) : Math.floor(n).toString()) + NUM_SUFFIX[i];
  }
  return (neg ? '−' : '') + s;
}
function fmtRate(n) {
  if (n < 10) return (Math.round(n * 10) / 10).toFixed(1);
  return fmt(n);
}
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  return s + 's';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
