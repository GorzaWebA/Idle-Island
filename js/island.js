'use strict';
/* Procedural island generator. Fully determined by (seed, trait), plus slopes kept clear of a
   save's existing buildings when it predates them. */

let MAP = null;

function tIdx(x, y) { return y * MAP_W + x; }
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// blocked: optional Set of tile indices slopes must avoid (buildings in an older save)
function generateIsland(seed, traitId, blocked) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const m = tryGenerate((seed + attempt * 7919) >>> 0, traitId, blocked);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('Island generation failed');
}

function tryGenerate(seed, traitId, blocked) {
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

  const m = { trait: traitId, W, H, tile, tree, beach, dWater, landings, beachIds, hall, dock, cx, cy, landCount };
  placeRamps(m, blocked || null);
  buildStepMask(m);
  return m;
}

/* ---------- Slopes ----------
   Highland can only be climbed by its slopes. A slope is a grass tile beside a plateau that rises
   to it; m.ramp[i] holds the DIR4 index from a slope tile up to the highland tile it reaches,
   or -1. A slope is entered only from its foot or its top, never from the sides.
   Each plateau gets one slope near the Hall and one or two more spread round its edge; more are
   added wherever a plateau would otherwise cut part of the island off. `blocked` (a Set of tile
   indices, for old saves) keeps slopes off tiles that already have a building. Deterministic. */
function placeRamps(m, blocked) {
  const W = MAP_W, H = MAP_H, N = W * H, tile = m.tile;
  const ramp = m.ramp = new Int8Array(N).fill(-1);
  const hallI = tIdx(m.hall.x, m.hall.y), dockI = m.dock ? tIdx(m.dock.x, m.dock.y) : -1;
  // every tile that could be a slope, as [tile, direction up]
  const cands = [];
  for (let i = 0; i < N; i++) {
    if (tile[i] !== T_GRASS || i === hallI || i === dockI || (blocked && blocked.has(i))) continue;
    const x = i % W, y = (i / W) | 0;
    for (let d = 0; d < 4; d++) {
      const ux = x + DIR4[d][0], uy = y + DIR4[d][1], bx = x - DIR4[d][0], by = y - DIR4[d][1];
      if (!inMap(ux, uy) || !inMap(bx, by) || tile[tIdx(ux, uy)] !== T_HIGH) continue;
      const below = tile[tIdx(bx, by)];
      if (below !== T_GRASS && below !== T_SAND) continue;
      cands.push([i, d]);
    }
  }
  const spaced = (i, r) => {      // keep slopes apart (r tiles), so none touches another
    const x = i % W, y = (i / W) | 0;
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (inMap(xx, yy) && ramp[tIdx(xx, yy)] >= 0) return false;
    return true;
  };
  // Place a slope unless it would strand land that could be reached before (a slope can't be
  // crossed from the side, so one in a narrow gap could wall a pocket off).
  const add = (i, d) => {
    const before = reachable(m, hallI);
    ramp[i] = d;
    const after = reachable(m, hallI);
    for (let k = 0; k < N; k++) if (before[k] && !after[k]) { ramp[i] = -1; return false; }
    m.tree[i] = 0;
    return true;
  };
  // plateaus (4-connected highland)
  const comp = new Int32Array(N).fill(-1), sizes = [];
  for (let s = 0; s < N; s++) {
    if (tile[s] !== T_HIGH || comp[s] >= 0) continue;
    const id = sizes.length, st = [s]; comp[s] = id; let n = 0;
    while (st.length) {
      const i = st.pop(); n++;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue; const j = tIdx(nx, ny); if (tile[j] === T_HIGH && comp[j] < 0) { comp[j] = id; st.push(j); } }
    }
    sizes.push(n);
  }
  const topOf = c => { const x = c[0] % W, y = (c[0] / W) | 0; return tIdx(x + DIR4[c[1]][0], y + DIR4[c[1]][1]); };
  const dHall = i => Math.hypot(i % W - m.hall.x, ((i / W) | 0) - m.hall.y);
  for (let id = 0; id < sizes.length; id++) {
    const mine = cands.filter(c => comp[topOf(c)] === id);
    const want = sizes[id] < 6 ? 1 : sizes[id] < 16 ? 2 : 3, chosen = [];
    for (let k = 0; k < want; k++) {
      let best = null, bs = -Infinity;
      for (const c of mine) {
        if (!spaced(c[0], 2)) continue;
        // the first faces the Hall; the rest go as far as possible from the others
        let score = -dHall(c[0]);
        if (chosen.length) { score = Infinity; for (const o of chosen) score = Math.min(score, Math.hypot(c[0] % W - o % W, ((c[0] / W) | 0) - ((o / W) | 0))); }
        if (score > bs) { bs = score; best = c; }
      }
      if (!best || (chosen.length && bs < 3)) break;
      if (add(best[0], best[1])) chosen.push(best[0]);
      else mine.splice(mine.indexOf(best), 1), k--;
    }
  }
  // Nothing may be cut off: walk the island from the Hall, and while some land can't be
  // reached, add the slope nearest the Hall that joins the reached part to the rest.
  for (let guard = 0; guard < 60; guard++) {
    const seen = reachable(m, hallI);
    let left = false;
    for (let i = 0; i < N; i++) if (tile[i] !== T_WATER && !seen[i]) { left = true; break; }
    if (!left) return;
    const options = [];
    for (const c of cands) {
      if (ramp[c[0]] >= 0 || !spaced(c[0], 1)) continue;
      const x = c[0] % W, y = (c[0] / W) | 0, foot = tIdx(x - DIR4[c[1]][0], y - DIR4[c[1]][1]), top = topOf(c);
      if (seen[foot] !== seen[top]) options.push(c);
    }
    options.sort((a, b) => dHall(a[0]) - dHall(b[0]) || a[0] - b[0]);
    let placed = false;
    for (const c of options) if (add(c[0], c[1])) { placed = true; break; }
    if (placed) continue;
    // No slope fits (a tiny plateau hemmed in by others): lower the stranded highland tile
    // nearest the Hall that touches reachable low ground, and look again.
    let lower = -1, ld = Infinity;
    for (let i = 0; i < N; i++) {
      if (tile[i] !== T_HIGH || seen[i]) continue;
      const x = i % W, y = (i / W) | 0;
      let touches = false;
      for (const [dx, dy] of DIR4) { if (!inMap(x + dx, y + dy)) continue; const j = tIdx(x + dx, y + dy); if (seen[j] && tile[j] !== T_HIGH && ramp[j] < 0) touches = true; }
      if (touches && dHall(i) < ld) { ld = dHall(i); lower = i; }
    }
    if (lower >= 0) { tile[lower] = T_GRASS; continue; }
    // Otherwise it is a grass pit inside a plateau with no room for a slope: raise it to join
    // the plateau around it.
    let raised = false;
    for (let i = 0; i < N; i++) if ((tile[i] === T_GRASS || tile[i] === T_SAND) && !seen[i] && ramp[i] < 0) { tile[i] = T_HIGH; raised = true; }
    if (!raised) return;
  }
}

// May a walker step straight from tile a to its side neighbour b? Only slopes join the levels.
function crossOK(m, a, b) {
  const W = MAP_W, ra = m.ramp[a], rb = m.ramp[b];
  if (ra >= 0) { const o = DIR4[ra][0] + DIR4[ra][1] * W; return b === a + o || b === a - o; }
  if (rb >= 0) { const o = DIR4[rb][0] + DIR4[rb][1] * W; return a === b + o || a === b - o; }
  return (m.tile[a] === T_HIGH) === (m.tile[b] === T_HIGH);
}
// May a walker step from tile (x, y) by (dx, dy)? Diagonal steps never cut a corner across a
// cliff or a slope.
function stepOK(m, x, y, dx, dy) {
  const tx = x + dx, ty = y + dy;
  if (!inMap(tx, ty) || m.tile[tIdx(tx, ty)] === T_WATER) return false;
  if (dx === 0 || dy === 0) return crossOK(m, tIdx(x, y), tIdx(tx, ty));
  if (!inMap(tx, y) || !inMap(x, ty)) return false;
  const a = tIdx(x, y), b = tIdx(tx, ty), c = tIdx(tx, y), e = tIdx(x, ty);
  if (m.tile[c] === T_WATER || m.tile[e] === T_WATER) return false;
  if (m.ramp[a] >= 0 || m.ramp[b] >= 0 || m.ramp[c] >= 0 || m.ramp[e] >= 0) return false;
  const h = m.tile[a] === T_HIGH;
  return (m.tile[b] === T_HIGH) === h && (m.tile[c] === T_HIGH) === h && (m.tile[e] === T_HIGH) === h;
}
// The allowed DIR8 steps out of every tile as a bit mask, so path finding pays for the rules
// once, and every tile's walking level (see levelAt).
function buildStepMask(m) {
  const W = MAP_W, N = W * MAP_H, mask = m.steps = new Uint8Array(N), level = m.level = new Uint8Array(N);
  for (let i = 0; i < N; i++) level[i] = m.tile[i] === T_HIGH ? 2 : m.ramp[i] >= 0 ? 1 : 0;
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    let b = 0;
    for (let k = 0; k < 8; k++) if (stepOK(m, x, y, DIR8[k][0], DIR8[k][1])) b |= 1 << k;
    mask[i] = b;
  }
}
const DIR8_INDEX = [7, 3, 5, 1, -1, 0, 6, 2, 4];     // (dy + 1) * 3 + (dx + 1) -> index into DIR8

// Every tile a walker can reach from tile `from`.
function reachable(m, from) {
  const W = MAP_W, seen = new Uint8Array(W * MAP_H), q = [from];
  seen[from] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIR8) {
      if (!stepOK(m, x, y, dx, dy)) continue;
      const j = tIdx(x + dx, y + dy);
      if (!seen[j]) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
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
// Slopes: the direction index (DIR4) up to the highland, or -1.
function rampDir(tx, ty) { return inMap(tx, ty) && MAP.ramp ? MAP.ramp[tIdx(tx, ty)] : -1; }
function isRamp(tx, ty) { return rampDir(tx, ty) >= 0; }
// Height level of a tile for walking: 0 low ground, 1 on a slope (it joins both), 2 highland.
function levelAt(tx, ty) { return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H ? MAP.level[ty * MAP_W + tx] : 0; }
function adjacentTrees(tx, ty) {
  let n = 0;
  for (const [dx, dy] of DIR8) if (hasTree(tx + dx, ty + dy)) n++;
  return n;
}
