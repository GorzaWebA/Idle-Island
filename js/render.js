'use strict';
/* Canvas renderer: oblique 3/4 view of the island, units, boats and effects. */

const VH = [0, 0.22, 0.6, 1.3];          // visual height per tile type
const SQUAD_COLORS = ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97', '#bb6bd9', '#f2994a', '#2dd4bf', '#f5f5f5', '#a3e635'];
const PAL = {
  seaTop: '#1d4757', seaBot: '#163846', wave: 'rgba(210,235,240,0.10)', shallow: 'rgba(120,190,200,0.28)', foam: 'rgba(235,245,240,0.55)',
  sand: '#d9c48c', sandSide: '#ae9660', grass: '#77a253', grassSide: '#4f7438', high: '#99a07c', highSide: '#686b52',
  treeA: '#2f6a3d', treeB: '#3d7f4a', treeDark: '#234f2f', trunk: '#5a4230',
  wall: '#dcc9a1', wallShade: '#b9a57d', timber: '#6b4a2e', roof: '#9c4130', roofDark: '#7a3124', hallRoof: '#4c3a2c',
  slate: '#41607a', stone: '#a9a597', stoneDark: '#7f7b6f', log: '#8a6239', logDark: '#674626',
  raider: '#8f2f2a', raiderDark: '#3a2422', skin: '#e2bf98', steel: '#c9ccd0', gold: '#e3b04b'
};
const CLASS_TUNIC = { militia: '#94a3ad', sword: '#3f7fc4', bow: '#4f9d5b', pike: '#cfa443' };

const R = { canvas: null, ctx: null, dpr: 1, w: 0, h: 0, T: 32, TH: 25, HZ: 13, ox: 0, oy: 0, terrain: null, terrainKey: '', waves: [], time: 0 };

function initRender(canvas) {
  R.canvas = canvas; R.ctx = canvas.getContext('2d');
  const r = mulberry32(99);
  R.waves = [];
  for (let i = 0; i < 70; i++) R.waves.push({ x: r() * (MAP_W + 6) - 3, y: r() * (MAP_H + 4) - 2, l: 0.3 + r() * 0.5, s: 0.08 + r() * 0.12, p: r() * 6 });
  resizeRender();
}

function resizeRender() {
  const c = R.canvas, rect = c.parentElement.getBoundingClientRect();
  R.dpr = Math.min(2, window.devicePixelRatio || 1);
  R.w = Math.max(200, Math.floor(rect.width)); R.h = Math.max(160, Math.floor(rect.height));
  c.width = Math.floor(R.w * R.dpr); c.height = Math.floor(R.h * R.dpr);
  c.style.width = R.w + 'px'; c.style.height = R.h + 'px';
  // Fit the view to the island's land bounds plus a margin of sea.
  let x0 = MAP_W, x1 = 0, y0 = MAP_H, y1 = 0;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (!isLandTile(x, y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const m = 0.9, vw = x1 - x0 + 1 + 2 * m, rows = y1 - y0 + 1 + 2 * m;
  const T0 = Math.min(R.w / vw, R.h / (rows * 0.78 + 0.6));
  R.base = {
    T: T0,
    ox: (R.w - vw * T0) / 2 - (x0 - m) * T0,
    oy: (R.h - rows * T0 * 0.78) / 2 - (y0 - m) * T0 * 0.78 + T0 * 0.42 * 0.35
  };
  R.bounds = { x0, x1, y0, y1 };
  if (R.mapSeed !== MAP.seed) { R.zoom = 1; R.camX = null; R.camY = null; }
  R.mapSeed = MAP.seed;
  applyCamera();
}

/* ---------- camera: pinch / wheel zoom and drag pan ---------- */
const ZOOM_MAX = 3;
function applyCamera() {
  const b = R.base;
  if (!(R.zoom > 1.001)) {
    R.zoom = 1; R.camX = null; R.camY = null;
    R.T = b.T; R.ox = b.ox; R.oy = b.oy;
  } else {
    const T = b.T * R.zoom, TH = T * 0.78, bd = R.bounds;
    if (R.camX === null || R.camX === undefined) { R.camX = (R.w / 2 - b.ox) / b.T; R.camY = (R.h / 2 - b.oy) / (b.T * 0.78); }
    R.camX = clamp(R.camX, bd.x0, bd.x1 + 1);
    R.camY = clamp(R.camY, bd.y0, bd.y1 + 1);
    R.T = T; R.ox = R.w / 2 - R.camX * T; R.oy = R.h / 2 - R.camY * TH;
  }
  R.TH = R.T * 0.78; R.HZ = R.T * 0.42;
  R.terrainKey = '';
}
function screenToWorld(fx, fy) { return { x: (fx - R.ox) / R.T, y: (fy - R.oy) / R.TH }; }
// Zoom to z, keeping world point (wx, wy) under screen point (fx, fy).
function anchorView(z, wx, wy, fx, fy) {
  R.zoom = clamp(z, 1, ZOOM_MAX);
  if (R.zoom > 1.001) {
    const T = R.base.T * R.zoom, TH = T * 0.78;
    R.camX = wx - (fx - R.w / 2) / T;
    R.camY = wy - (fy - R.h / 2) / TH;
  }
  applyCamera();
}
function zoomAt(fx, fy, z) { const w = screenToWorld(fx, fy); anchorView(z, w.x, w.y, fx, fy); }
function panBy(dx, dy) {
  if (R.zoom <= 1.001) return;
  R.camX -= dx / R.T; R.camY -= dy / R.TH;
  applyCamera();
}

function sx(x) { return R.ox + x * R.T; }
function sy(y, h) { return R.oy + y * R.TH - h * R.HZ; }
function groundH(x, y) { return VH[tileType(Math.floor(x), Math.floor(y))]; }

function hash2(x, y, k) {
  let h = (x * 374761393 + y * 668265263 + (k || 0) * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}

/* ---------- static terrain layer ---------- */
function buildTerrain() {
  const key = MAP.seed + ':' + R.w + 'x' + R.h + ':' + R.dpr + ':' + R.T.toFixed(3) + ':' + R.ox.toFixed(2) + ':' + R.oy.toFixed(2);
  if (R.terrainKey === key && R.terrain) return;
  R.terrainKey = key;
  const cv = R.terrain || document.createElement('canvas');
  cv.width = R.canvas.width; cv.height = R.canvas.height;
  const c = cv.getContext('2d');
  c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  c.clearRect(0, 0, R.w, R.h);
  const T = R.T, TH = R.TH, HZ = R.HZ;
  // Shallows around the coast, filled as one path so overlaps don't darken.
  c.beginPath();
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (tileType(x, y) !== T_WATER) continue;
    let near = false;
    for (const [dx, dy] of DIR8) if (isLandTile(x + dx, y + dy)) near = true;
    if (near) c.rect(sx(x) - 0.5, sy(y, 0) - 0.5, T + 1, TH + 1);
  }
  c.fillStyle = PAL.shallow; c.fill();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = tileType(x, y);
      if (t === T_WATER) continue;
      const h = VH[t], X = sx(x), Y = sy(y, h);
      const top = t === T_SAND ? PAL.sand : t === T_GRASS ? PAL.grass : PAL.high;
      const side = t === T_SAND ? PAL.sandSide : t === T_GRASS ? PAL.grassSide : PAL.highSide;
      const below = tileType(x, y + 1);
      // south face
      c.fillStyle = side;
      c.fillRect(X, Y + TH - 0.5, T + 0.6, h * HZ + 1);
      if (t !== T_SAND) {
        c.fillStyle = 'rgba(0,0,0,0.10)';
        for (let k = 1; k < 3; k++) c.fillRect(X, Y + TH + h * HZ * (k / 3), T + 0.6, 1);
      }
      if (below === T_WATER) { c.fillStyle = PAL.foam; c.fillRect(X - 0.5, sy(y + 1, 0) - 1.5, T + 1.5, 2.5); }
      // top face with slight per-tile tint
      c.fillStyle = shade(top, (hash2(x, y, 1) - 0.5) * 0.05);
      c.fillRect(X, Y, T + 0.6, TH + 0.6);
      // light edge where the northern neighbour is lower
      const north = tileType(x, y - 1);
      if (VH[north] < h) { c.fillStyle = 'rgba(255,250,230,0.22)'; c.fillRect(X, Y, T + 0.6, 1.5); }
      const west = tileType(x - 1, y), east = tileType(x + 1, y);
      if (VH[west] < h) { c.fillStyle = 'rgba(0,0,0,0.10)'; c.fillRect(X, Y, 1.5, TH); }
      if (VH[east] < h) { c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(X + T - 1, Y, 1.5, TH); }
      // texture specks
      for (let k = 0; k < 5; k++) {
        const px = X + hash2(x, y, 10 + k) * (T - 4) + 2, py = Y + hash2(x, y, 20 + k) * (TH - 4) + 2;
        if (t === T_GRASS) { c.fillStyle = k % 2 ? 'rgba(40,80,30,0.25)' : 'rgba(200,230,150,0.18)'; c.fillRect(px, py, 2, 1.5); }
        else if (t === T_SAND) { c.fillStyle = 'rgba(120,95,50,0.22)'; c.fillRect(px, py, 1.5, 1.5); }
        else { c.fillStyle = k % 2 ? 'rgba(60,60,45,0.3)' : 'rgba(225,225,205,0.25)'; c.fillRect(px, py, 3, 1.5); }
      }
    }
  }
  R.terrain = cv;
}

/* ---------- main draw ---------- */
function render(dtReal) {
  const ctx = R.ctx;
  R.time += dtReal;
  if (R.mapSeed !== MAP.seed) resizeRender();
  ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  buildTerrain();
  // sea
  const g = ctx.createLinearGradient(0, 0, 0, R.h);
  g.addColorStop(0, PAL.seaTop); g.addColorStop(1, PAL.seaBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, R.w, R.h);
  ctx.strokeStyle = PAL.wave; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const w of R.waves) {
    const x = w.x + Math.sin(R.time * w.s + w.p) * 0.6, y = w.y;
    if (isLandAt(x, y) || isLandAt(x + w.l, y)) continue;
    const X = sx(x), Y = sy(y, 0) + Math.sin(R.time * 0.8 + w.p) * 1.5;
    ctx.moveTo(X, Y); ctx.quadraticCurveTo(X + w.l * R.T * 0.5, Y - 2.5, X + w.l * R.T, Y);
  }
  ctx.stroke();
  ctx.drawImage(R.terrain, 0, 0, R.w, R.h);

  drawGroundOverlays(ctx);

  // depth-sorted sprites
  const list = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (MAP.tree[tIdx(x, y)] && !buildingAtTile(x, y)) list.push({ y: y + 0.45, f: drawTrees, a: x, b: y });
  for (const b of G.buildings) list.push({ y: b.y + 0.55, f: drawBuilding, a: b });
  if (MAP.dock) list.push({ y: MAP.dock.sy, f: drawPlayerShip });
  if (RT) {
    for (const u of RT.units) list.push({ y: u.y, f: drawUnit, a: u });
    for (const b of RT.boats) list.push({ y: b.y, f: drawBoat, a: b });
  }
  list.sort((p, q) => p.y - q.y);
  for (const it of list) it.f(ctx, it.a, it.b);

  if (RT) {
    drawProjectiles(ctx);
    drawEffects(ctx);
    drawFloaters(ctx);
    drawIncoming(ctx);
  }
}

/* ---------- overlays under sprites ---------- */
function tileOutline(ctx, x, y, color, fill) {
  const h = VH[tileType(x, y)];
  const X = sx(x), Y = sy(y, h);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(X, Y, R.T, R.TH); }
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(X + 1, Y + 1, R.T - 2, R.TH - 2);
}
function rangeRing(ctx, x, y, range, color) {
  const h = groundH(x, y);
  ctx.beginPath();
  ctx.ellipse(sx(x), sy(y, h), range * R.T, range * R.TH, 0, 0, Math.PI * 2);
  ctx.fillStyle = color.replace('ALPHA', '0.08'); ctx.fill();
  ctx.strokeStyle = color.replace('ALPHA', '0.55'); ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
}

function drawGroundOverlays(ctx) {
  const ui = typeof UI !== 'undefined' ? UI : null;
  if (!ui) return;
  // hold flags for squads
  for (const sq of G.squads) {
    if (sq.mode !== 'hold' || !sq.hold) continue;
    const col = squadColor(sq);
    const h = VH[tileType(sq.hold.x, sq.hold.y)];
    const X = sx(sq.hold.x + 0.5), Y = sy(sq.hold.y + 0.5, h);
    ctx.beginPath(); ctx.ellipse(X, Y, R.T * 0.42, R.TH * 0.42, 0, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.globalAlpha = ui.selSq === sq.id ? 0.9 : 0.4; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  const hv = ui.hover;
  if (ui.placing && hv) {
    const chk = placementCheck(ui.placing, hv.x, hv.y);
    const good = chk.ok, valid = chk.valid;
    tileOutline(ctx, hv.x, hv.y, good ? '#8ef0a0' : valid ? '#f0d58e' : '#f08e8e', good ? 'rgba(142,240,160,0.18)' : 'rgba(240,142,142,0.15)');
    if (ui.placing === 'tower' && isLandTile(hv.x, hv.y)) rangeRing(ctx, hv.x + 0.5, hv.y + 0.5, 3.5 + (tileType(hv.x, hv.y) === T_HIGH ? 1 : 0), 'rgba(240,220,150,ALPHA)');
    if (ui.placing === 'market') {
      for (const b of G.buildings) if ((b.type === 'cottage' || b.type === 'hall') && Math.max(Math.abs(b.x - hv.x), Math.abs(b.y - hv.y)) === 1) tileOutline(ctx, b.x, b.y, '#f2c94c');
    }
    if (ui.placing === 'lumber') {
      for (const [dx, dy] of DIR8) if (hasTree(hv.x + dx, hv.y + dy)) tileOutline(ctx, hv.x + dx, hv.y + dy, 'rgba(160,240,170,0.7)');
    }
  } else if (hv && isLandTile(hv.x, hv.y)) {
    tileOutline(ctx, hv.x, hv.y, ui.selSq ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)');
  }
  if (ui.selB) {
    const b = G.buildings.find(o => o.id === ui.selB);
    if (b) {
      tileOutline(ctx, b.x, b.y, '#f2c94c');
      if (b.type === 'tower') rangeRing(ctx, b.x + 0.5, b.y + 0.5, 3.5 + (tileType(b.x, b.y) === T_HIGH ? 1 : 0), 'rgba(240,220,150,ALPHA)');
      if (b.type === 'hall') rangeRing(ctx, b.x + 0.5, b.y + 0.5, 3, 'rgba(240,220,150,ALPHA)');
    }
  }
  if (ui.selSq && RT) {
    const sq = G.squads.find(s => s.id === ui.selSq);
    if (sq && sq.rt) {
      for (const u of sq.rt.members) {
        const h = groundH(u.x, u.y);
        ctx.beginPath(); ctx.ellipse(sx(u.x), sy(u.y, h), R.T * 0.2, R.TH * 0.16, 0, 0, Math.PI * 2);
        ctx.strokeStyle = squadColor(sq); ctx.lineWidth = 2; ctx.stroke();
      }
      if (sq.rt.stats.ranged && sq.rt.members.length) {
        const c = sq.rt.members[0];
        rangeRing(ctx, sq.rt.ax, sq.rt.ay, sq.rt.stats.range + (tileType(Math.floor(c.x), Math.floor(c.y)) === T_HIGH ? 1 : 0), 'rgba(150,220,255,ALPHA)');
      }
    }
  }
}

function squadColor(sq) { return SQUAD_COLORS[Math.max(0, G.squads.indexOf(sq)) % SQUAD_COLORS.length]; }

/* ---------- trees ---------- */
function drawTrees(ctx, x, y) {
  const h = VH[tileType(x, y)];
  const n = 1 + (hash2(x, y, 3) > 0.45 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const ox = (n === 1 ? 0.5 : 0.3 + k * 0.4) + (hash2(x, y, 4 + k) - 0.5) * 0.15;
    const oy = 0.55 + (hash2(x, y, 6 + k) - 0.5) * 0.3 - k * 0.12;
    const X = sx(x + ox), Y = sy(y + oy, h);
    const s = R.T * (0.36 + hash2(x, y, 8 + k) * 0.12);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(X + 2, Y, s * 0.32, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.trunk; ctx.fillRect(X - s * 0.05, Y - s * 0.22, s * 0.1, s * 0.22);
    for (let j = 0; j < 3; j++) {
      const w = s * (0.38 - j * 0.09), yy = Y - s * 0.15 - j * s * 0.24;
      ctx.fillStyle = j === 0 ? PAL.treeDark : j === 1 ? PAL.treeA : PAL.treeB;
      ctx.beginPath(); ctx.moveTo(X - w, yy); ctx.lineTo(X, yy - s * 0.42); ctx.lineTo(X + w, yy); ctx.closePath(); ctx.fill();
    }
  }
}

/* ---------- buildings ---------- */
function drawBuilding(ctx, b) {
  const h = VH[tileType(b.x, b.y)];
  const cx = sx(b.x + 0.5), cy = sy(b.y + 0.5, h) + R.TH * 0.18;
  const T = R.T;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(cx + 2, cy, T * 0.42, T * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  if (b.ruined) { drawRuin(ctx, b, cx, cy); return; }
  switch (b.type) {
    case 'hall': drawHall(ctx, cx, cy, T, b); break;
    case 'cottage': drawCottage(ctx, cx, cy, T, b); break;
    case 'lumber': drawLumber(ctx, cx, cy, T); break;
    case 'barracks': drawBarracks(ctx, cx, cy, T); break;
    case 'tower': drawTower(ctx, cx, cy, T); break;
    case 'palisade': drawPalisade(ctx, cx, cy, T, b); break;
    case 'market': drawMarket(ctx, cx, cy, T); break;
  }
  if (b.flash > 0) { ctx.fillStyle = 'rgba(255,120,80,0.35)'; ctx.fillRect(cx - T * 0.45, cy - T * 0.9, T * 0.9, T * 0.9); }
  if (b.hp < b.maxHp - 0.5 && RT && RT.phase !== 'countdown') hpBar(ctx, cx, cy - T * (b.type === 'tower' ? 1.15 : 0.85), T * 0.6, b.hp / b.maxHp, '#e0b050');
  if (b.lvl > 1 && b.type !== 'palisade') {
    ctx.fillStyle = 'rgba(20,24,28,0.72)'; ctx.fillRect(cx + T * 0.2, cy - T * 0.12, T * 0.26, T * 0.2);
    ctx.fillStyle = '#f3e7c4'; ctx.font = '600 ' + Math.max(8, T * 0.16) + 'px Barlow, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(b.lvl), cx + T * 0.33, cy - T * 0.02);
  }
}

function hpBar(ctx, x, y, w, f, col) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 3);
}

function gable(ctx, cx, top, w, peak, col, colDark) {
  ctx.fillStyle = colDark;
  ctx.beginPath(); ctx.moveTo(cx - w / 2, top); ctx.lineTo(cx - w * 0.15, top - peak); ctx.lineTo(cx + w * 0.35, top - peak); ctx.lineTo(cx + w / 2 + w * 0.08, top); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 - w * 0.06, top + 1); ctx.lineTo(cx - w * 0.15, top - peak); ctx.lineTo(cx + w * 0.22, top + 1); ctx.closePath(); ctx.fill();
}

function drawCottage(ctx, cx, cy, T) {
  const w = T * 0.56, h = T * 0.27;
  ctx.fillStyle = PAL.wall; ctx.fillRect(cx - w / 2, cy - h, w, h);
  ctx.fillStyle = PAL.wallShade; ctx.fillRect(cx + w * 0.1, cy - h, w * 0.4, h);
  ctx.fillStyle = PAL.timber; ctx.fillRect(cx - w * 0.28, cy - h * 0.62, w * 0.14, h * 0.62);
  ctx.fillStyle = '#3c2a1c'; ctx.fillRect(cx + w * 0.22, cy - h * 0.7, w * 0.12, h * 0.3);
  gable(ctx, cx, cy - h, w, T * 0.3, PAL.roof, PAL.roofDark);
  if (RT && (Math.floor(R.time * 2 + cx) % 3 === 0)) {
    ctx.fillStyle = 'rgba(230,230,225,0.25)';
    ctx.beginPath(); ctx.arc(cx + w * 0.3, cy - h - T * 0.34 - (R.time * 6 % 6), T * 0.05, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHall(ctx, cx, cy, T, b) {
  const w = T * 0.92, h = T * 0.32;
  ctx.fillStyle = PAL.wall; ctx.fillRect(cx - w / 2, cy - h, w, h);
  ctx.fillStyle = PAL.wallShade; ctx.fillRect(cx + w * 0.12, cy - h, w * 0.38, h);
  ctx.fillStyle = PAL.timber;
  for (let k = 0; k < 5; k++) ctx.fillRect(cx - w / 2 + k * w / 4.2, cy - h, T * 0.035, h);
  ctx.fillStyle = '#2f2016'; ctx.fillRect(cx - T * 0.07, cy - h * 0.7, T * 0.14, h * 0.7);
  // long roof
  ctx.fillStyle = '#3a2c21';
  ctx.beginPath(); ctx.moveTo(cx - w / 2 - T * 0.05, cy - h); ctx.lineTo(cx - w * 0.36, cy - h - T * 0.36); ctx.lineTo(cx + w * 0.4, cy - h - T * 0.36); ctx.lineTo(cx + w / 2 + T * 0.05, cy - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.hallRoof;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 - T * 0.05, cy - h + 1); ctx.lineTo(cx - w * 0.36, cy - h - T * 0.36); ctx.lineTo(cx + w * 0.4, cy - h - T * 0.36); ctx.lineTo(cx + w * 0.3, cy - h + 1); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.gold; ctx.lineWidth = Math.max(1.5, T * 0.04);
  ctx.beginPath(); ctx.moveTo(cx - w * 0.36, cy - h - T * 0.36); ctx.lineTo(cx - w * 0.46, cy - h - T * 0.5); ctx.moveTo(cx + w * 0.4, cy - h - T * 0.36); ctx.lineTo(cx + w * 0.5, cy - h - T * 0.5); ctx.stroke();
  // banner
  const px = cx + w * 0.05, py = cy - h - T * 0.36;
  ctx.strokeStyle = '#2b2018'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - T * 0.42); ctx.stroke();
  const wv = Math.sin(R.time * 3) * T * 0.03;
  ctx.fillStyle = '#2f6fa8'; ctx.beginPath(); ctx.moveTo(px, py - T * 0.42); ctx.lineTo(px + T * 0.26, py - T * 0.37 + wv); ctx.lineTo(px, py - T * 0.27); ctx.closePath(); ctx.fill();
}

function drawLumber(ctx, cx, cy, T) {
  ctx.fillStyle = PAL.timber; ctx.fillRect(cx - T * 0.32, cy - T * 0.26, T * 0.3, T * 0.26);
  ctx.fillStyle = '#4a3322';
  ctx.beginPath(); ctx.moveTo(cx - T * 0.36, cy - T * 0.26); ctx.lineTo(cx - T * 0.17, cy - T * 0.42); ctx.lineTo(cx + T * 0.02, cy - T * 0.26); ctx.closePath(); ctx.fill();
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) {
    const x = cx + T * 0.08 + k * T * 0.1 + r * T * 0.05, y = cy - T * 0.05 - r * T * 0.09;
    ctx.fillStyle = '#9b7146'; ctx.beginPath(); ctx.arc(x, y, T * 0.055, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d2b07a'; ctx.beginPath(); ctx.arc(x, y, T * 0.03, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBarracks(ctx, cx, cy, T) {
  const w = T * 0.7, h = T * 0.3;
  ctx.fillStyle = PAL.stone; ctx.fillRect(cx - w / 2, cy - h, w, h);
  ctx.fillStyle = PAL.stoneDark; ctx.fillRect(cx + w * 0.15, cy - h, w * 0.35, h);
  ctx.fillStyle = PAL.slate;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 - 2, cy - h); ctx.lineTo(cx - w * 0.38, cy - h - T * 0.18); ctx.lineTo(cx + w * 0.42, cy - h - T * 0.18); ctx.lineTo(cx + w / 2 + 2, cy - h); ctx.closePath(); ctx.fill();
  const cols = ['#c94f3d', '#3f7fc4', '#e3b04b'];
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = cols[k]; ctx.beginPath(); ctx.arc(cx - w * 0.3 + k * w * 0.3, cy - h * 0.5, T * 0.06, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTower(ctx, cx, cy, T) {
  const w = T * 0.34, h = T * 0.78;
  ctx.fillStyle = PAL.stone; ctx.fillRect(cx - w / 2, cy - h, w, h);
  ctx.fillStyle = PAL.stoneDark; ctx.fillRect(cx + w * 0.05, cy - h, w * 0.45, h);
  ctx.fillStyle = PAL.timber; ctx.fillRect(cx - w * 0.8, cy - h - T * 0.06, w * 1.6, T * 0.08);
  ctx.fillStyle = '#5e432b'; ctx.fillRect(cx - w * 0.7, cy - h - T * 0.2, w * 1.4, T * 0.14);
  ctx.fillStyle = PAL.roofDark;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.85, cy - h - T * 0.2); ctx.lineTo(cx, cy - h - T * 0.48); ctx.lineTo(cx + w * 0.85, cy - h - T * 0.2); ctx.closePath(); ctx.fill();
}

function drawPalisade(ctx, cx, cy, T, b) {
  const n = 4, w = T * 0.92, h = T * 0.36;
  for (let k = 0; k < n; k++) {
    const x = cx - w / 2 + (k + 0.5) * (w / n), lw = w / n * 0.8;
    ctx.fillStyle = k % 2 ? PAL.log : PAL.logDark;
    ctx.beginPath(); ctx.moveTo(x - lw / 2, cy); ctx.lineTo(x - lw / 2, cy - h); ctx.lineTo(x, cy - h - T * 0.1); ctx.lineTo(x + lw / 2, cy - h); ctx.lineTo(x + lw / 2, cy); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(40,25,15,0.6)'; ctx.fillRect(cx - w / 2, cy - h * 0.62, w, T * 0.04);
}

function drawMarket(ctx, cx, cy, T) {
  const w = T * 0.7;
  ctx.fillStyle = '#7a5532';
  ctx.fillRect(cx - w / 2, cy - T * 0.34, T * 0.04, T * 0.34); ctx.fillRect(cx + w / 2 - T * 0.04, cy - T * 0.34, T * 0.04, T * 0.34);
  ctx.fillStyle = '#9b7146'; ctx.fillRect(cx - w * 0.4, cy - T * 0.14, w * 0.8, T * 0.12);
  const stripes = 6;
  for (let k = 0; k < stripes; k++) {
    ctx.fillStyle = k % 2 ? '#efe2c0' : '#b9472f';
    ctx.beginPath();
    const x0 = cx - w / 2 - 2 + k * (w + 4) / stripes, x1 = x0 + (w + 4) / stripes;
    ctx.moveTo(x0, cy - T * 0.34); ctx.lineTo(x0 + 2, cy - T * 0.5); ctx.lineTo(x1 + 2, cy - T * 0.5); ctx.lineTo(x1, cy - T * 0.34); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#e3b04b'; ctx.beginPath(); ctx.arc(cx - w * 0.15, cy - T * 0.18, T * 0.05, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6fa35a'; ctx.beginPath(); ctx.arc(cx + w * 0.12, cy - T * 0.18, T * 0.05, 0, Math.PI * 2); ctx.fill();
}

function drawRuin(ctx, b, cx, cy) {
  const T = R.T;
  ctx.fillStyle = '#3b3530';
  ctx.beginPath(); ctx.moveTo(cx - T * 0.34, cy); ctx.lineTo(cx - T * 0.25, cy - T * 0.16); ctx.lineTo(cx - T * 0.05, cy - T * 0.1); ctx.lineTo(cx + T * 0.12, cy - T * 0.22); ctx.lineTo(cx + T * 0.34, cy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a4a3c'; ctx.fillRect(cx - T * 0.2, cy - T * 0.3, T * 0.05, T * 0.3); ctx.fillRect(cx + T * 0.15, cy - T * 0.24, T * 0.05, T * 0.24);
  if (b.rebuild > 0) {
    ctx.strokeStyle = '#c8a46a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - T * 0.3, cy); ctx.lineTo(cx - T * 0.3, cy - T * 0.4); ctx.lineTo(cx + T * 0.3, cy - T * 0.4); ctx.lineTo(cx + T * 0.3, cy); ctx.moveTo(cx - T * 0.3, cy - T * 0.2); ctx.lineTo(cx + T * 0.3, cy - T * 0.2); ctx.stroke();
    const total = b.type === 'hall' ? 8 : 6;
    hpBar(ctx, cx, cy - T * 0.55, T * 0.6, 1 - b.rebuild / total, '#8fd3a0');
  } else {
    for (let k = 0; k < 4; k++) {
      const fx = cx + (k - 1.5) * T * 0.14, fl = Math.sin(R.time * 11 + k * 1.7) * 0.5 + 0.5;
      ctx.fillStyle = k % 2 ? 'rgba(255,170,60,0.9)' : 'rgba(255,110,40,0.85)';
      ctx.beginPath(); ctx.moveTo(fx - T * 0.06, cy - T * 0.05); ctx.quadraticCurveTo(fx, cy - T * (0.3 + fl * 0.2), fx + T * 0.06, cy - T * 0.05); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(60,55,50,0.35)';
    const sm = (R.time * 0.7) % 1;
    ctx.beginPath(); ctx.arc(cx + sm * T * 0.2, cy - T * (0.4 + sm * 0.6), T * (0.08 + sm * 0.1), 0, Math.PI * 2); ctx.fill();
  }
}

/* ---------- player ship (Sail On) ---------- */
function drawPlayerShip(ctx) {
  const d = MAP.dock, X = sx(d.sx + 0.5), Y = sy(d.sy + 0.5, 0) + Math.sin(R.time * 1.3) * 1.2;
  drawHull(ctx, X, Y, 1, 0, '#6a4a30', 1.15);
  const T = R.T;
  ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X, Y - T * 0.05); ctx.lineTo(X, Y - T * 0.75); ctx.stroke();
  ctx.fillStyle = '#efe6d2'; ctx.fillRect(X - T * 0.24, Y - T * 0.68, T * 0.48, T * 0.4);
  ctx.fillStyle = '#2f6fa8'; ctx.fillRect(X - T * 0.24, Y - T * 0.55, T * 0.48, T * 0.12);
}

/* ---------- boats ---------- */
function drawHull(ctx, X, Y, dx, dy, col, scale) {
  const T = R.T, ang = Math.atan2(dy * 0.78, dx), L = T * 0.62 * scale, W = T * 0.17 * scale;
  ctx.save(); ctx.translate(X, Y); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(1, 3, L * 1.05, W * 1.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(-L, 0); ctx.quadraticCurveTo(-L * 0.5, W * 1.3, 0, W); ctx.quadraticCurveTo(L * 0.5, W * 1.3, L, 0);
  ctx.quadraticCurveTo(L * 0.5, -W * 1.3, 0, -W); ctx.quadraticCurveTo(-L * 0.5, -W * 1.3, -L, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(30,18,10,0.7)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(L * 0.92, 0); ctx.quadraticCurveTo(L * 1.18, -W * 0.3, L * 1.1, -W * 1.3); ctx.stroke();
  ctx.restore();
}

function drawBoat(ctx, b) {
  if (b.state === 'gone') return;
  if (RT.phase === 'countdown' && RT.timer > b.visibleAt && b.state === 'sail') return;
  const X = sx(b.x), Y = sy(b.y, 0) + Math.sin(R.time * 2 + b.id) * 1.2;
  if (X < -60 || X > R.w + 60 || Y < -60 || Y > R.h + 60) return;
  ctx.globalAlpha = clamp(b.alpha, 0, 1);
  const T = R.T, scale = b.boss ? 1.3 : 1;
  drawHull(ctx, X, Y, b.dx, b.dy, '#5b3b26', scale);
  // crew heads
  const n = Math.min(6, b.cargo.length), ang = Math.atan2(b.dy * 0.78, b.dx);
  for (let k = 0; k < n; k++) {
    const t = (k - (n - 1) / 2) * T * 0.13;
    ctx.fillStyle = PAL.raider; ctx.beginPath(); ctx.arc(X + Math.cos(ang) * t, Y + Math.sin(ang) * t - T * 0.05, T * 0.05, 0, Math.PI * 2); ctx.fill();
  }
  // mast and sail (sail always faces the viewer)
  ctx.strokeStyle = '#2a1c12'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X, Y - T * 0.04); ctx.lineTo(X, Y - T * 0.7 * scale); ctx.stroke();
  const sw = T * (0.18 + Math.abs(Math.cos(ang)) * 0.22) * scale;
  ctx.fillStyle = '#d8cfbf'; ctx.fillRect(X - sw, Y - T * 0.64 * scale, sw * 2, T * 0.38 * scale);
  ctx.fillStyle = b.boss ? '#3a2422' : '#9b2f28';
  for (let k = 0; k < 3; k++) ctx.fillRect(X - sw + k * sw * 0.8, Y - T * 0.64 * scale, sw * 0.35, T * 0.38 * scale);
  ctx.globalAlpha = 1;
}

function drawIncoming(ctx) {
  const pad = 22;
  for (const b of RT.boats) {
    if (b.state !== 'sail' || b.wave !== G.wave) continue;
    if (RT.phase === 'countdown' && RT.timer > b.visibleAt) continue;
    const X = sx(b.x), Y = sy(b.y, 0);
    const inside = X > 8 && X < R.w - 8 && Y > 8 && Y < R.h - 8;
    const n = b.cargo.length;
    if (inside) {
      badge(ctx, X, Y - R.T * 0.95, n, b.boss);
      continue;
    }
    let cx = clamp(X, pad, R.w - pad), cy = clamp(Y, pad, R.h - pad);
    // Keep markers clear of the zoom buttons in the bottom-right corner.
    const zx = R.w - 64, zy = R.h - 116;
    if (cx > zx && cy > zy) { if (cx >= R.w - pad - 0.5) cy = zy; else cx = zx; }
    const a = Math.atan2(Y - cy, X - cx);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
    ctx.fillStyle = 'rgba(160,40,30,0.92)';
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(6, -9); ctx.lineTo(6, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    badge(ctx, cx, cy, n, b.boss);
  }
}
function badge(ctx, x, y, n, boss) {
  ctx.fillStyle = boss ? '#2b1b17' : 'rgba(150,38,30,0.95)';
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = boss ? PAL.gold : 'rgba(255,230,210,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#fff3e8'; ctx.font = '700 11px Barlow, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

/* ---------- units ---------- */
function drawUnit(ctx, u) {
  const h = groundH(u.x, u.y);
  const X = sx(u.x), Y = sy(u.y, h);
  const T = R.T;
  const s = T * 0.105 * (u.big ? 1.55 : 1) * (u.kind === 'warlord' ? 1.15 : 1);
  const bob = Math.abs(Math.sin(u.walk * 7)) * s * 0.25;
  ctx.globalAlpha = u.alpha !== undefined ? clamp(u.alpha, 0, 1) : 1;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(X, Y, s * 1.1, s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  const def = u.side === 0;
  const tunic = def ? CLASS_TUNIC[u.kind] || CLASS_TUNIC.militia : (u.kind === 'warlord' ? '#2b1b17' : u.kind === 'brute' ? '#6e2a25' : u.kind === 'berserker' ? '#a8452c' : PAL.raider);
  const f = u.face;
  // body
  ctx.fillStyle = tunic;
  ctx.beginPath(); ctx.moveTo(X - s * 0.85, Y - bob); ctx.lineTo(X - s * 0.6, Y - s * 2 - bob); ctx.lineTo(X + s * 0.6, Y - s * 2 - bob); ctx.lineTo(X + s * 0.85, Y - bob); ctx.closePath(); ctx.fill();
  // head
  const hy = Y - s * 2.45 - bob;
  ctx.fillStyle = PAL.skin; ctx.beginPath(); ctx.arc(X, hy, s * 0.6, 0, Math.PI * 2); ctx.fill();
  if (def) {
    ctx.fillStyle = PAL.steel; ctx.beginPath(); ctx.arc(X, hy - s * 0.1, s * 0.62, Math.PI, 0); ctx.fill();
  } else if (u.kind !== 'berserker') {
    ctx.fillStyle = PAL.raiderDark; ctx.beginPath(); ctx.arc(X, hy - s * 0.05, s * 0.66, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
  }
  if (u.kind === 'warlord') {
    ctx.fillStyle = PAL.gold;
    ctx.beginPath(); ctx.moveTo(X - s * 0.55, hy - s * 0.5); ctx.lineTo(X - s * 0.55, hy - s * 1.0); ctx.lineTo(X - s * 0.2, hy - s * 0.7); ctx.lineTo(X, hy - s * 1.1); ctx.lineTo(X + s * 0.2, hy - s * 0.7); ctx.lineTo(X + s * 0.55, hy - s * 1.0); ctx.lineTo(X + s * 0.55, hy - s * 0.5); ctx.closePath(); ctx.fill();
  }
  // gear
  ctx.lineCap = 'round';
  const kind = u.kind;
  if (kind === 'bow' || kind === 'archer') {
    ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = Math.max(1, s * 0.22);
    ctx.beginPath(); ctx.arc(X + f * s * 0.7, Y - s * 1.3 - bob, s * 0.9, f > 0 ? -1.2 : Math.PI - 1.2 + 0.4, f > 0 ? 1.2 : Math.PI + 1.2 + 0.4); ctx.stroke();
  } else if (kind === 'pike') {
    ctx.strokeStyle = '#7a5a38'; ctx.lineWidth = Math.max(1, s * 0.2);
    ctx.beginPath(); ctx.moveTo(X - f * s * 0.6, Y - s * 0.6 - bob); ctx.lineTo(X + f * s * 2.6, Y - s * 3.0 - bob); ctx.stroke();
    ctx.strokeStyle = PAL.steel; ctx.beginPath(); ctx.moveTo(X + f * s * 2.3, Y - s * 2.7 - bob); ctx.lineTo(X + f * s * 2.8, Y - s * 3.25 - bob); ctx.stroke();
  } else if (kind === 'sword' || kind === 'shield') {
    ctx.fillStyle = kind === 'sword' ? '#c9d6e3' : '#5b3b26';
    ctx.beginPath(); ctx.arc(X + f * s * 0.75, Y - s * 1.1 - bob, s * (kind === 'shield' ? 0.95 : 0.78), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = kind === 'sword' ? '#3f7fc4' : '#9b2f28'; ctx.lineWidth = Math.max(1, s * 0.2); ctx.stroke();
  } else {
    // militia club, raider axes
    ctx.strokeStyle = def ? '#7a5a38' : '#4a3a30'; ctx.lineWidth = Math.max(1, s * (u.big ? 0.32 : 0.22));
    ctx.beginPath(); ctx.moveTo(X + f * s * 0.5, Y - s * 0.9 - bob); ctx.lineTo(X + f * s * 1.3, Y - s * 2.2 - bob); ctx.stroke();
    if (!def) { ctx.fillStyle = PAL.steel; ctx.beginPath(); ctx.arc(X + f * s * 1.35, Y - s * 2.15 - bob, s * (u.big ? 0.5 : 0.35), 0, Math.PI * 2); ctx.fill(); }
  }
  if (u.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(X, Y - s * 1.4, s * 1.2, 0, Math.PI * 2); ctx.fill(); }
  // commander banner
  if (def && u.slot === 0 && u.sq) {
    const col = squadColor(u.sq);
    ctx.strokeStyle = '#2b2018'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X - f * s * 0.5, Y - s * 0.8 - bob); ctx.lineTo(X - f * s * 0.5, Y - s * 4.4 - bob); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(X - f * s * 0.5, Y - s * 4.4 - bob); ctx.lineTo(X - f * s * 0.5 - f * s * 1.6, Y - s * 4.0 - bob); ctx.lineTo(X - f * s * 0.5, Y - s * 3.5 - bob); ctx.closePath(); ctx.fill();
    const st = u.sq.rt;
    if (st && st.members.length < st.stats.size) hpBar(ctx, X, Y - s * 5.2 - bob, T * 0.4, st.members.length / st.stats.size, col);
  }
  if ((u.big || (u.side === 1 && u.hp < u.maxHp)) && u.alive) hpBar(ctx, X, Y - s * 3.6 - bob, T * (u.big ? 0.42 : 0.24), u.hp / u.maxHp, '#e45a4a');
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

/* ---------- projectiles & effects ---------- */
function drawProjectiles(ctx) {
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (const p of RT.projectiles) {
    const total = Math.max(0.01, dist(p.sx, p.sy, p.tx, p.ty));
    const k = p.visual ? clamp(p.t / p.dur, 0, 1) : clamp(1 - dist(p.x, p.y, p.tx, p.ty) / total, 0, 1);
    const g = lerp(groundH(p.sx, p.sy), groundH(p.tx, p.ty), k);
    const arc = Math.sin(Math.PI * k) * (p.visual ? 1.6 : total * 0.18) + (p.h0 || 0) * (1 - k) + 0.25;
    const X = sx(p.x), Y = sy(p.y, g + arc);
    const k2 = Math.min(1, k + 0.05);
    const arc2 = Math.sin(Math.PI * k2) * (p.visual ? 1.6 : total * 0.18) + (p.h0 || 0) * (1 - k2) + 0.25;
    const nx = lerp(p.sx, p.tx, k2), ny = lerp(p.sy, p.ty, k2);
    let dx = sx(nx) - X, dy = sy(ny, g + arc2) - Y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    ctx.strokeStyle = p.fire ? '#ffb347' : (p.side === 1 ? '#3b2a22' : '#f3ead2');
    ctx.beginPath(); ctx.moveTo(X - dx * 6, Y - dy * 6); ctx.lineTo(X + dx * 2, Y + dy * 2); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawEffects(ctx) {
  for (const e of RT.effects) {
    const k = e.t / e.dur, h = groundH(e.x, e.y), X = sx(e.x), Y = sy(e.y, h);
    ctx.globalAlpha = 1 - k;
    switch (e.type) {
      case 'hit': ctx.fillStyle = '#fff6d0'; ctx.fillRect(X - 1.5, Y - R.T * 0.2 - 1.5, 3, 3); break;
      case 'spark': ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(X, Y - k * 10, 2, 0, Math.PI * 2); ctx.fill(); break;
      case 'death':
        ctx.fillStyle = e.side === 1 ? 'rgba(120,40,35,0.6)' : 'rgba(200,200,210,0.6)';
        ctx.beginPath(); ctx.arc(X, Y - R.T * 0.12, R.T * (0.08 + k * 0.18), 0, Math.PI * 2); ctx.fill(); break;
      case 'splash':
        ctx.strokeStyle = '#cfeaf2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(X, sy(e.y, 0), R.T * (0.1 + k * 0.35), R.TH * (0.05 + k * 0.2), 0, 0, Math.PI * 2); ctx.stroke(); break;
      case 'bash':
        ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(X, Y, R.T * (0.15 + k * 0.4), R.TH * (0.1 + k * 0.3), 0, 0, Math.PI * 2); ctx.stroke(); break;
      case 'volley':
        ctx.strokeStyle = '#f3ead2'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(X, Y, R.T * 1.3 * (0.6 + k * 0.4), R.TH * 1.3 * (0.6 + k * 0.4), 0, 0, Math.PI * 2); ctx.stroke(); break;
      case 'blaze':
        ctx.fillStyle = 'rgba(255,140,50,0.55)';
        ctx.beginPath(); ctx.arc(X, Y - R.T * 0.3, R.T * (0.2 + k * 0.5), 0, Math.PI * 2); ctx.fill(); break;
      case 'refill':
        ctx.strokeStyle = '#8fe3a0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y - R.T * 0.15, R.T * (0.08 + k * 0.2), 0, Math.PI * 2); ctx.stroke(); break;
    }
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(ctx) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.max(11, R.T * 0.3) + 'px Barlow, system-ui, sans-serif';
  for (const f of RT.floaters) {
    const h = groundH(f.x, f.y + 0.3);
    const X = sx(f.x), Y = sy(f.y, h);
    ctx.globalAlpha = clamp(1.3 - f.t, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(f.text, X + 1, Y + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.text, X, Y);
  }
  ctx.globalAlpha = 1;
}

/* ---------- picking ---------- */
function pickTile(mx, my) {
  for (let y = MAP_H - 1; y >= 0; y--) {
    for (let x = 0; x < MAP_W; x++) {
      const h = VH[tileType(x, y)];
      const X = sx(x), Y = sy(y, h);
      if (mx >= X && mx < X + R.T && my >= Y && my < Y + R.TH) return { x, y };
    }
  }
  return null;
}
function pickWorld(mx, my) {
  const t = pickTile(mx, my);
  if (!t) return null;
  const h = VH[tileType(t.x, t.y)];
  return { x: (mx - R.ox) / R.T, y: (my - R.oy + h * R.HZ) / R.TH, tile: t };
}
function pickSquadAt(mx, my, radius) {
  if (!RT) return null;
  const rad = radius || R.T * 0.4;
  let best = null, bd = rad * rad;
  for (const u of RT.units) {
    if (u.side !== 0 || !u.alive) continue;
    const h = groundH(u.x, u.y);
    const X = sx(u.x), Y = sy(u.y, h) - R.T * 0.18;
    const d = (X - mx) * (X - mx) + (Y - my) * (Y - my);
    if (d < bd) { bd = d; best = u.sq; }
  }
  return best;
}
