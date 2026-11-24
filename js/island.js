'use strict';
/* Procedural island generator. Fully determined by (seed, trait). */

let MAP = null;

function tIdx(x, y) { return y * MAP_W + x; }
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function generateIsland(seed, traitId) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const m = tryGenerate((seed + attempt * 7919) >>> 0, traitId);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('Island generation failed');
}

function tryGenerate(seed, traitId) {
  const r = mulberry32(seed);
  const W = MAP_W, H = MAP_H, N = W * H;
  const nShape = makeNoise(r), nHigh = makeNoise(r), nTree = makeNoise(r);
  const ox = r() * 40, oy = r() * 40;
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const shapeVal = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 2 || y < 2 || x > W - 3 || y > H - 3) { shapeVal[tIdx(x, y)] = -9; continue; }
    const dx = (x - cx) / (W * 0.46), dy = (y - cy) / (H * 0.46);
    const d = Math.sqrt(dx * dx + dy * dy);
    shapeVal[tIdx(x, y)] = 1 - d + (fbm(nShape, x * 0.24 + ox, y * 0.24 + oy) - 0.5) * 1.1;
  }

  // Adaptive threshold so islands land in a playable size range.
  let tile = null, landCount = 0, thr = 0.28;
  for (let k = 0; k < 12; k++) {
    tile = new Uint8Array(N);
    for (let i = 0; i < N; i++) tile[i] = shapeVal[i] > thr ? T_GRASS : T_WATER;
    keepLargestLand(tile);
    fillLakes(tile);
    landCount = 0; for (let i = 0; i < N; i++) if (tile[i] !== T_WATER) landCount++;
    if (landCount < 125) thr -= 0.04; else if (landCount > 165) thr += 0.04; else break;
  }
  if (landCount < 105 || landCount > 185) return null;

  // Distance to water (in steps, 8-connected).
  const dWater = new Int16Array(N).fill(99);
  const q = [];
  for (let i = 0; i < N; i++) if (tile[i] === T_WATER) { dWater[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue;
      const j = tIdx(nx, ny); if (dWater[j] > dWater[i] + 1) { dWater[j] = dWater[i] + 1; q.push(j); }
    }
  }

  // Highland: top percentile of noise among inland tiles.
  const highFrac = traitId === 'highlands' ? 0.27 : 0.15;
  const cand = [];
  for (let i = 0; i < N; i++) if (tile[i] !== T_WATER && dWater[i] >= 2) {
    const x = i % W, y = (i / W) | 0;
    cand.push([i, fbm(nHigh, x * 0.3 + 5, y * 0.3 + 11) + dWater[i] * 0.05]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const nHighTiles = Math.min(cand.length, Math.round(landCount * highFrac));
  for (let k = 0; k < nHighTiles; k++) tile[cand[k][0]] = T_HIGH;

  // Great Hall: most inland tile, ties broken by closeness to centre.
  let hall = null, hallScore = -1e9;
  for (let i = 0; i < N; i++) if (tile[i] !== T_WATER) {
    const x = i % W, y = (i / W) | 0;
    const s = dWater[i] * 10 - dist(x, y, cx, cy);
    if (s > hallScore) { hallScore = s; hall = { x, y }; }
  }

  // Beaches: grow sand strips around the coast at spread-out angles.
  const coast = [];
  for (let i = 0; i < N; i++) {
    if (tile[i] !== T_GRASS) continue;
    const x = i % W, y = (i / W) | 0;
    if (DIR4.some(([dx, dy]) => inMap(x + dx, y + dy) && tile[tIdx(x + dx, y + dy)] === T_WATER)) {
      coast.push({ i, x, y, a: Math.atan2(y - cy, (x - cx) * (H / W)) });
    }
  }
  if (coast.length < 12) return null;
  let nBeach = 5 + (traitId === 'shores' ? 2 : 0) - (traitId === 'rocky' ? 1 : 0);
  const beach = new Int8Array(N).fill(-1);
  const isCoast = new Uint8Array(N); coast.forEach(c => { isCoast[c.i] = 1; });
  const a0 = r() * Math.PI * 2;
  let made = 0;
  for (let b = 0; b < nBeach; b++) {
    const target = a0 + (b / nBeach) * Math.PI * 2 + (r() - 0.5) * 0.5;
    let best = null, bd = 1e9;
    for (const c of coast) {
      if (beach[c.i] >= 0) continue;
      // keep distance from existing beaches
      let near = false;
      for (const [dx, dy] of DIR8) { const nx = c.x + dx, ny = c.y + dy; if (inMap(nx, ny) && beach[tIdx(nx, ny)] >= 0) near = true; }
      if (near) continue;
      let da = Math.abs(((c.a - target) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (da < bd) { bd = da; best = c; }
    }
    if (!best || bd > 0.9) continue;
    const len = 2 + Math.floor(r() * 3);
    const strip = [best.i]; beach[best.i] = made;
    for (let s = 0; s < strip.length && strip.length < len; s++) {
      const i = strip[s], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue;
        const j = tIdx(nx, ny);
        if (isCoast[j] && beach[j] < 0 && strip.length < len) { beach[j] = made; strip.push(j); }
      }
    }
    for (const i of strip) tile[i] = T_SAND;
    made++;
  }
  if (made < 3) return null;

  // Landing points: sand tiles that touch open water.
  const landings = [];
  for (let i = 0; i < N; i++) {
    if (tile[i] !== T_SAND) continue;
    const x = i % W, y = (i / W) | 0;
    let best = null, bd = -1;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny) || tile[tIdx(nx, ny)] !== T_WATER) continue;
      const d = dist(nx, ny, cx, cy);
      if (d > bd) { bd = d; best = { wx: nx, wy: ny }; }
    }
    if (best) landings.push({ x, y, wx: best.wx, wy: best.wy, beach: beach[i] });
  }
  const beachIds = [...new Set(landings.map(l => l.beach))];
  if (beachIds.length < 3) return null;

  // Trees: clustered noise on grass and highland, never next to the Hall or on sand.
  const tree = new Uint8Array(N);
  const treeFrac = traitId === 'timberland' ? 0.32 : 0.17;
  const tc = [];
  for (let i = 0; i < N; i++) {
    if (tile[i] !== T_GRASS && tile[i] !== T_HIGH) continue;
    const x = i % W, y = (i / W) | 0;
    if (Math.max(Math.abs(x - hall.x), Math.abs(y - hall.y)) <= 1) continue;
    if (DIR8.some(([dx, dy]) => inMap(x + dx, y + dy) && tile[tIdx(x + dx, y + dy)] === T_SAND)) continue;
    tc.push([i, fbm(nTree, x * 0.38 + 23, y * 0.38 + 7) + r() * 0.12]);
  }
  tc.sort((a, b) => b[1] - a[1]);
  const nTrees = Math.max(8, Math.round(landCount * treeFrac));
  for (let k = 0; k < Math.min(nTrees, tc.length); k++) tree[tc[k][0]] = 1;

  // Dock for the player's ship: coastal non-beach tile nearest the Hall.
  let dock = null, dd = 1e9;
  for (const c of coast) {
    if (tile[c.i] !== T_GRASS) continue;
    const d = dist(c.x, c.y, hall.x, hall.y);
    if (d < dd) {
      for (const [dx, dy] of DIR4) {
        const nx = c.x + dx, ny = c.y + dy;
        if (inMap(nx, ny) && tile[tIdx(nx, ny)] === T_WATER) { dd = d; dock = { x: c.x, y: c.y, sx: nx + dx * 0.3, sy: ny + dy * 0.3 }; break; }
      }
    }
  }
  if (dock) tree[tIdx(dock.x, dock.y)] = 0;

  return { trait: traitId, W, H, tile, tree, beach, dWater, landings, beachIds, hall, dock, cx, cy, landCount };
}

function keepLargestLand(tile) {
  const W = MAP_W, H = MAP_H, N = W * H;
  const comp = new Int32Array(N).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let s = 0; s < N; s++) {
    if (tile[s] === T_WATER || comp[s] >= 0) continue;
    const st = [s]; comp[s] = id; let size = 0;
    while (st.length) {
      const i = st.pop(); size++;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue;
        const j = tIdx(nx, ny); if (tile[j] !== T_WATER && comp[j] < 0) { comp[j] = id; st.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  for (let i = 0; i < N; i++) if (tile[i] !== T_WATER && comp[i] !== best) tile[i] = T_WATER;
}

function fillLakes(tile) {
  const W = MAP_W, H = MAP_H, N = W * H;
  const seen = new Uint8Array(N); const st = [];
  for (let x = 0; x < W; x++) { st.push(tIdx(x, 0), tIdx(x, H - 1)); }
  for (let y = 0; y < H; y++) { st.push(tIdx(0, y), tIdx(W - 1, y)); }
  while (st.length) {
    const i = st.pop(); if (seen[i] || tile[i] !== T_WATER) continue; seen[i] = 1;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (inMap(nx, ny)) st.push(tIdx(nx, ny)); }
  }
  for (let i = 0; i < N; i++) if (tile[i] === T_WATER && !seen[i]) tile[i] = T_GRASS;
}

/* Tile queries used everywhere */
function tileType(tx, ty) { return inMap(tx, ty) ? MAP.tile[tIdx(tx, ty)] : T_WATER; }
function isLandTile(tx, ty) { return tileType(tx, ty) !== T_WATER; }
function isLandAt(x, y) { return isLandTile(Math.floor(x), Math.floor(y)); }
function hasTree(tx, ty) { return inMap(tx, ty) && MAP.tree[tIdx(tx, ty)] === 1; }
function isLandingTile(tx, ty) { return MAP.landings.some(l => l.x === tx && l.y === ty); }
function adjacentTrees(tx, ty) {
  let n = 0;
  for (const [dx, dy] of DIR8) if (hasTree(tx + dx, ty + dy)) n++;
  return n;
}
