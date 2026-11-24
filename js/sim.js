'use strict';
/* Real-time battle simulation. Runs at a fixed step; no DOM access. */

let RT = null;       // runtime battle state (not saved)
let UID = 1;

/* ---------- tiny binary heap for Dijkstra ---------- */
function heapPush(h, i, p) {
  h.push([i, p]); let k = h.length - 1;
  while (k > 0) { const pk = (k - 1) >> 1; if (h[pk][1] <= h[k][1]) break; [h[pk], h[k]] = [h[k], h[pk]]; k = pk; }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last; let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1; let m = k;
      if (l < h.length && h[l][1] < h[m][1]) m = l;
      if (r < h.length && h[r][1] < h[m][1]) m = r;
      if (m === k) break; [h[m], h[k]] = [h[k], h[m]]; k = m;
    }
  }
  return top;
}

/* ---------- runtime setup ---------- */
function resetRuntime() {
  RT = {
    phase: 'countdown', timer: 0, total: 0, time: 0, battleT: 0,
    boats: [], units: [], projectiles: [], effects: [], floaters: [], volleys: [],
    flow: null, bAt: null, flowDirty: true, aiT: 0, defeatT: 0, banner: null,
    homes: []
  };
  for (const b of G.buildings) { b.ruined = false; b.rebuild = 0; b.cdT = Math.random(); }
  recalc();
  for (const b of G.buildings) b.hp = b.maxHp;
  computeFlow();
  computeHomes();
  for (const sq of G.squads) spawnSquad(sq, false);
  startCountdown();
}

function onBuildingsChanged() {
  if (!RT) return;
  RT.flowDirty = true;
  computeHomes();
}

function computeHomes() {
  const h = MAP.hall, list = [];
  for (let y = h.y - 2; y <= h.y + 2; y++) for (let x = h.x - 2; x <= h.x + 2; x++) {
    if ((x === h.x && y === h.y) || !isLandTile(x, y) || tileType(x, y) === T_SAND) continue;
    const occupied = buildingAtTile(x, y) ? 1.5 : 0;
    list.push({ x, y, s: dist(x, y, h.x, h.y) + occupied });
  }
  list.sort((a, b) => a.s - b.s);
  RT.homes = list.length ? list : [{ x: h.x, y: h.y }];
}
function squadHome(sq) {
  const i = Math.max(0, G.squads.indexOf(sq));
  return RT.homes[i % RT.homes.length];
}

/* ---------- flow field for raiders ---------- */
function stepCost(from, to, diag) {
  let c = diag ? 1.414 : 1;
  if (MAP.tile[to] === T_HIGH && MAP.tile[from] !== T_HIGH) c += 0.7;
  if (MAP.tree[to]) c += 0.5;
  const b = RT.bAt[to];
  if (b && b.type === 'palisade' && !b.ruined) c += 7;
  return c;
}
function canStep(x, y, dx, dy) {
  if (!isLandTile(x + dx, y + dy)) return false;
  if (dx !== 0 && dy !== 0 && (!isLandTile(x + dx, y) || !isLandTile(x, y + dy))) return false;
  return true;
}
function computeFlow() {
  const W = MAP_W, N = W * MAP_H;
  const d = new Float32Array(N).fill(Infinity);
  RT.bAt = new Array(N).fill(null);
  for (const b of G.buildings) RT.bAt[tIdx(b.x, b.y)] = b;
  const heap = [];
  for (const b of G.buildings) {
    if (b.ruined || b.type === 'palisade') continue;
    const i = tIdx(b.x, b.y); d[i] = 0; heapPush(heap, i, 0);
  }
  while (heap.length) {
    const [i, di] = heapPop(heap);
    if (di > d[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIR8) {
      if (!canStep(x, y, dx, dy)) continue;
      const j = tIdx(x + dx, y + dy);
      const nd = di + stepCost(j, i, dx !== 0 && dy !== 0);
      if (nd < d[j]) { d[j] = nd; heapPush(heap, j, nd); }
    }
  }
  RT.flow = d;
  RT.flowDirty = false;
}
function flowAt(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!inMap(tx, ty)) return 99;
  const v = RT.flow[tIdx(tx, ty)];
  return isFinite(v) ? v : 99;
}
function bestNeighbor(tx, ty) {
  const i = tIdx(tx, ty);
  let best = -1, bs = Infinity;
  for (const [dx, dy] of DIR8) {
    if (!canStep(tx, ty, dx, dy)) continue;
    const j = tIdx(tx + dx, ty + dy);
    const s = RT.flow[j] + stepCost(i, j, dx !== 0 && dy !== 0);
    if (s < bs) { bs = s; best = j; }
  }
  return isFinite(bs) ? best : -1;
}

/* ---------- squad paths (BFS over land) ---------- */
function findPath(sx, sy, gx, gy) {
  if (!isLandTile(gx, gy)) return null;
  if (!isLandTile(sx, sy)) return [{ x: gx + 0.5, y: gy + 0.5 }];
  const W = MAP_W, N = W * MAP_H;
  const prev = new Int32Array(N).fill(-2);
  const s = tIdx(sx, sy), g = tIdx(gx, gy);
  prev[s] = -1; const q = [s];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]; if (i === g) break;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIR8) {
      if (!canStep(x, y, dx, dy)) continue;
      const j = tIdx(x + dx, y + dy);
      if (prev[j] === -2) { prev[j] = i; q.push(j); }
    }
  }
  if (prev[g] === -2) return null;
  const path = [];
  for (let i = g; i !== s && i >= 0; i = prev[i]) path.push({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 });
  path.reverse();
  return path;
}

/* ---------- waves ---------- */
function composeWave(n) {
  let budget = waveBudget(n);
  const types = ENEMY_TYPES.filter(t => ENEMIES[t].from <= n);
  const list = [];
  if (n % 10 === 0) list.push('warlord');
  let guard = 0;
  while (budget >= 1 && guard++ < 400) {
    const opts = types.filter(t => ENEMIES[t].pts <= budget + 0.01);
    if (!opts.length) break;
    let tw = 0; for (const t of opts) tw += ENEMY_WEIGHT[t];
    let r = rand() * tw, chosen = opts[0];
    for (const t of opts) { r -= ENEMY_WEIGHT[t]; if (r <= 0) { chosen = t; break; } }
    list.push(chosen); budget -= ENEMIES[chosen].pts;
  }
  return list;
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function planWave(n, time) {
  const list = composeWave(n);
  const nBoats = Math.max(1, Math.ceil(list.length / BOAT_CAPACITY));
  const beaches = shuffle(MAP.beachIds.slice());
  const nDir = Math.max(1, Math.min(waveDirections(n), beaches.length, nBoats));
  const boats = [];
  for (let i = 0; i < nBoats; i++) boats.push({ cargo: [] });
  list.forEach((k, i) => boats[i % nBoats].cargo.push(k));
  const perLanding = new Map();
  boats.forEach((b, i) => {
    const beachId = beaches[i % nDir];
    const lands = MAP.landings.filter(l => l.beach === beachId);
    const used = boats.filter(o => o.landing).map(o => o.landing);
    const land = lands.find(l => !used.includes(l)) || pick(lands);
    const k = perLanding.get(land) || 0; perLanding.set(land, k + 1);
    const tx = land.wx + 0.5, ty = land.wy + 0.5;
    let dx = tx - (MAP.cx + 0.5), dy = ty - (MAP.cy + 0.5);
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const far = 13 + rand() * 2;
    Object.assign(b, {
      id: UID++, wave: n, landing: land, x: tx + dx * far, y: ty + dy * far, tx, ty, dx: -dx, dy: -dy,
      speed: far / Math.max(1, time + k * 2), state: 'sail', unloadT: 0, alpha: 1,
      visibleAt: G.island.trait === 'fog' ? time * 0.45 : time + 1, boss: b.cargo.includes('warlord')
    });
  });
  return boats;
}

function startCountdown() {
  RT.phase = 'countdown';
  RT.total = RT.timer = countdownTime(G.wave);
  RT.battleT = 0;
  const leaving = RT.boats.filter(b => b.state === 'leave');
  RT.boats = leaving.concat(planWave(G.wave, RT.timer));
}

function callNow() {
  if (!RT || RT.phase !== 'countdown' || RT.timer <= 2) return 0;
  const saved = RT.timer - 1.5;
  const bonus = saved * D.goldPerSec * 0.5 + saved * 0.5;
  G.gold += bonus; G.stats.goldEarned += bonus;
  RT.timer = 1.5;
  for (const b of RT.boats) {
    if (b.state !== 'sail') continue;
    const rem = dist(b.x, b.y, b.tx, b.ty);
    b.speed = Math.max(b.speed, rem / 1.5);
    b.visibleAt = 99;
  }
  floater(MAP.hall.x + 0.5, MAP.hall.y - 0.2, '+' + fmt(bonus) + ' gold', '#f0c05a');
  return bonus;
}

function waveCleared() {
  for (const b of RT.boats) if (b.wave === G.wave && (b.state === 'sail' || b.state === 'unload')) return false;
  for (const u of RT.units) if (u.side === 1 && u.alive) return false;
  return true;
}

function endWave(win) {
  const n = G.wave;
  if (win) {
    const gb = waveBonusGold(n) * D.bountyMult, tb = waveBonusTimber(n);
    G.gold += gb; G.timber += tb; G.stats.goldEarned += gb; G.stats.wavesWon++;
    if (n > G.bestWave) G.bestWave = n;
    if (n > G.bestEver) G.bestEver = n;
    setBanner('Wave ' + n + ' repelled', '+' + fmt(gb) + ' gold   +' + fmt(tb) + ' timber', 'good');
    if (n % 10 === 0) logEvent('The Warlord of wave ' + n + ' is slain.');
    if (n === PRESTIGE_WAVE && G.bestWave === n) logEvent('Wave 10 reached. You can now Sail On for Renown.');
    if (G.autoAdvance) G.wave++;
  } else {
    G.stats.wavesLost++;
    const lost = G.gold * 0.1; G.gold -= lost;
    const back = Math.max(1, n - 1);
    logEvent('The Hall fell on wave ' + n + '. Holding at wave ' + back + '.');
    setBanner('The Great Hall has fallen', 'Holding at wave ' + back + '. Build up, then press Advance.', 'bad');
    G.wave = back; G.autoAdvance = false;
    for (const u of RT.units) if (u.side === 1) u.alive = false;
  }
  for (const b of G.buildings) {
    if (b.ruined) { if (b.rebuild <= 0) b.rebuild = b.type === 'hall' ? 8 : 6; }
    else b.hp = b.maxHp;
  }
  RT.projectiles = []; RT.volleys = [];
  for (const sq of G.squads) if (sq.rt) sq.rt.retreating = false;
  startCountdown();
}

function defeat() {
  if (RT.phase === 'defeat') return;
  RT.phase = 'defeat'; RT.defeatT = 3;
  for (const u of RT.units) if (u.side === 1) { u.fleeing = true; u.target = null; }
  for (const b of RT.boats) if (b.state === 'sail' || b.state === 'unload') { b.state = 'leave'; b.cargo = []; }
}

function setBanner(title, sub, kind) { RT.banner = { title, sub, kind, t: 0, dur: 3.2 }; }

/* ---------- units ---------- */
function slotOffset(i, n) {
  if (i === 0 || n <= 1) return [0, 0];
  const a = ((i - 1) / (n - 1)) * Math.PI * 2 + 0.4;
  const r = n > 6 ? 0.5 : 0.42;
  return [Math.cos(a) * r, Math.sin(a) * r * 0.9];
}

function applyDefStats(u, sq) {
  const s = sq.rt.stats, ratio = u.maxHp ? u.hp / u.maxHp : 1;
  u.kind = sq.cls; u.maxHp = s.hp; u.hp = Math.max(0.5, ratio * s.hp);
  u.dmg = s.dmg; u.cd = s.cd; u.range = s.range; u.speed = s.speed; u.arrowTaken = s.arrowTaken; u.ranged = s.ranged;
}
function addMember(sq, x, y) {
  const u = { id: UID++, side: 0, sq, x, y, hp: 0, maxHp: 0, cdT: rand(), r: 0.14, target: null, kbx: 0, kby: 0, stun: 0, alive: true, face: 1, flash: 0, lastFoe: 0, walk: rand() * 3, slot: sq.rt.members.length };
  applyDefStats(u, sq); u.hp = u.maxHp;
  sq.rt.members.push(u); RT.units.push(u);
  return u;
}
function spawnSquad(sq, atHall) {
  if (!RT) return;
  if (sq.rt) for (const u of sq.rt.members) u.alive = false;
  const home = squadHome(sq);
  const pos = atHall ? MAP.hall : (sq.mode === 'hold' && sq.hold ? sq.hold : home);
  sq.rt = {
    ax: pos.x + 0.5, ay: pos.y + 0.5, path: [], goal: null, members: [], routedT: 0, refillT: 0,
    abilityT: 3 + rand() * 3, retreating: false, stats: squadStats(sq), task: 'idle'
  };
  for (let i = 0; i < sq.rt.stats.size; i++) addMember(sq, sq.rt.ax + (rand() - 0.5) * 0.4, sq.rt.ay + (rand() - 0.5) * 0.4);
}
function refreshSquad(sq) {
  if (!RT || !sq.rt) return;
  sq.rt.stats = squadStats(sq);
  for (const u of sq.rt.members) applyDefStats(u, sq);
}
function refreshAllSquads() { for (const sq of G.squads) refreshSquad(sq); }

function makeRaider(kind, x, y) {
  const e = ENEMIES[kind], n = G.wave;
  const u = {
    id: UID++, side: 1, kind, x, y, maxHp: e.hp * enemyHpMult(n), dmg: e.dmg * enemyDmgMult(n), cd: e.cd, cdT: 0.4 + rand() * e.cd,
    range: e.range, speed: e.speed * (0.92 + rand() * 0.16), r: e.r, arrowTaken: e.arrowTaken || 1, ranged: !!e.ranged,
    big: !!e.big, target: null, kbx: 0, kby: 0, stun: 0, alive: true, face: 1, flash: 0, walk: rand() * 3,
    offx: (rand() - 0.5) * 0.45, offy: (rand() - 0.5) * 0.45, alpha: 1, fleeing: false
  };
  u.hp = u.maxHp;
  RT.units.push(u);
  return u;
}

function orderHold(sq, x, y) {
  sq.mode = 'hold'; sq.hold = { x, y };
  if (sq.rt) { sq.rt.retreating = false; setGoal(sq, x, y); }
}
function orderAuto(sq) { sq.mode = 'auto'; sq.hold = null; }

/* ---------- main step ---------- */
function step(dt) {
  RT.time += dt;
  G.stats.playTime += dt;
  const g = D.goldPerSec * dt;
  G.gold += g; G.stats.goldEarned += g;
  G.timber += D.timberPerSec * dt;
  if (RT.flowDirty) computeFlow();

  if (RT.phase === 'countdown') {
    RT.timer -= dt;
    if (RT.timer <= 0) { RT.phase = 'battle'; RT.timer = 0; RT.battleT = 0; }
  } else if (RT.phase === 'battle') {
    RT.battleT += dt;
  } else if (RT.phase === 'defeat') {
    RT.defeatT -= dt;
    if (RT.defeatT <= 0) endWave(false);
  }

  updateRebuild(dt);
  updateBoats(dt);
  updateSquads(dt);
  updateUnits(dt);
  separate();
  updateTowers(dt);
  updateProjectiles(dt);
  updateVolleys(dt);
  if (RT.units.some(u => !u.alive)) RT.units = RT.units.filter(u => u.alive);
  updateFx(dt);
  if (RT.phase === 'battle' && waveCleared()) endWave(true);
}

function updateRebuild(dt) {
  let changed = false;
  for (const b of G.buildings) {
    if (!b.ruined || b.rebuild <= 0) continue;
    b.rebuild -= dt;
    if (b.rebuild <= 0) { b.ruined = false; b.rebuild = 0; changed = true; }
  }
  if (changed) {
    recalc();
    for (const b of G.buildings) if (!b.ruined && b.hp < 1.01) b.hp = b.maxHp;
    RT.flowDirty = true;
  }
}

function updateBoats(dt) {
  for (const b of RT.boats) {
    if (b.state === 'sail') {
      const d = dist(b.x, b.y, b.tx, b.ty), s = b.speed * dt;
      if (d <= s) { b.x = b.tx; b.y = b.ty; b.state = 'unload'; b.unloadT = 0.2; }
      else { b.x += (b.tx - b.x) / d * s; b.y += (b.ty - b.y) / d * s; }
    } else if (b.state === 'unload') {
      b.unloadT -= dt;
      if (b.unloadT <= 0) {
        if (b.cargo.length) {
          const k = b.cargo.shift();
          makeRaider(k, b.landing.x + 0.5 + (rand() - 0.5) * 0.5, b.landing.y + 0.5 + (rand() - 0.5) * 0.5);
          b.unloadT = 0.28;
        }
        if (!b.cargo.length) b.state = 'leave';
      }
    } else if (b.state === 'leave') {
      b.x -= b.dx * 2.2 * dt; b.y -= b.dy * 2.2 * dt;
      b.alpha -= dt * 0.25;
      if (b.alpha <= 0) b.state = 'gone';
    }
  }
  if (RT.boats.some(b => b.state === 'gone')) RT.boats = RT.boats.filter(b => b.state !== 'gone');
}

/* ---------- squad AI ---------- */
function isRefillBuilding(b) { return !b.ruined && (b.type === 'cottage' || b.type === 'hall' || b.type === 'barracks'); }
function nearestRefill(x, y) {
  let best = null, bd = Infinity;
  for (const b of G.buildings) {
    if (!isRefillBuilding(b)) continue;
    const d = dist2(x, y, b.x + 0.5, b.y + 0.5);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function setGoal(sq, gx, gy) {
  const st = sq.rt;
  if (st.goal && st.goal.x === gx && st.goal.y === gy) return;
  st.goal = { x: gx, y: gy };
  const p = findPath(Math.floor(st.ax), Math.floor(st.ay), gx, gy);
  st.path = p || [{ x: gx + 0.5, y: gy + 0.5 }];
}

function archerSpot(sq, ex, ey) {
  const st = sq.rt, range = st.stats.range, h = MAP.hall;
  const raiders = RT.units.filter(u => u.side === 1 && u.alive);
  let best = null, bs = Infinity;
  const x0 = Math.floor(ex), y0 = Math.floor(ey);
  for (let y = y0 - 4; y <= y0 + 4; y++) for (let x = x0 - 4; x <= x0 + 4; x++) {
    if (!isLandTile(x, y)) continue;
    const high = tileType(x, y) === T_HIGH;
    const d = dist(x + 0.5, y + 0.5, ex, ey);
    const reach = range + (high ? 1 : 0) - 0.4;
    if (d < 1.6 || d > reach) continue;
    let s = dist(x, y, h.x, h.y) * 0.35 + dist(x + 0.5, y + 0.5, st.ax, st.ay) * 0.25 - (high ? 1.4 : 0) + (d < 2.2 ? 0.8 : 0);
    for (const r of raiders) if (dist2(r.x, r.y, x + 0.5, y + 0.5) < 1.6 * 1.6) s += 2;
    if (s < bs) { bs = s; best = { x, y }; }
  }
  return best || { x: x0, y: y0 };
}

function updateSquads(dt) {
  RT.aiT -= dt;
  const think = RT.aiT <= 0;
  if (think) RT.aiT = 0.3;
  const raiders = RT.units.filter(u => u.side === 1 && u.alive && !u.fleeing);
  let enemyGoals = null, landingGoals = null;
  if (think) {
    enemyGoals = new Map(); landingGoals = new Map();
    const auto = G.squads.filter(s => s.rt && s.rt.routedT <= 0 && s.mode === 'auto' && !s.rt.retreating);
    if (raiders.length) {
      const taken = [];
      for (const sq of auto) {
        let best = null, bs = Infinity;
        for (const r of raiders) {
          let s = dist(sq.rt.ax, sq.rt.ay, r.x, r.y) + 0.6 * Math.min(flowAt(r.x, r.y), 20);
          for (const t of taken) if (dist2(t.x, t.y, r.x, r.y) < 2.25) s += 2.5;
          if (s < bs) { bs = s; best = r; }
        }
        if (best) {
          taken.push(best);
          enemyGoals.set(sq, sq.rt.stats.ranged ? archerSpot(sq, best.x, best.y) : { x: Math.floor(best.x), y: Math.floor(best.y) });
        }
      }
    }
    const incoming = RT.boats.filter(b => b.wave === G.wave && (b.state === 'sail' || b.state === 'unload') && (RT.phase !== 'countdown' || RT.timer <= b.visibleAt));
    if (incoming.length) {
      const counts = new Map();
      for (const sq of auto) {
        let best = null, bs = Infinity;
        for (const b of incoming) {
          const l = b.landing;
          const s = dist(sq.rt.ax, sq.rt.ay, l.x + 0.5, l.y + 0.5) + 6 * (counts.get(l) || 0) - b.cargo.length * 0.2;
          if (s < bs) { bs = s; best = l; }
        }
        if (best) {
          counts.set(best, (counts.get(best) || 0) + 1);
          landingGoals.set(sq, sq.rt.stats.ranged ? archerSpot(sq, best.x + 0.5, best.y + 0.5) : { x: best.x, y: best.y });
        }
      }
    }
  }

  for (const sq of G.squads) {
    const st = sq.rt; if (!st) continue;
    if (st.routedT > 0) {
      st.routedT -= dt;
      if (st.routedT <= 0) spawnSquad(sq, true);
      continue;
    }
    if (think) decideGoal(sq, raiders, enemyGoals, landingGoals);
    moveAnchor(sq, dt);
    refill(sq, dt, raiders);
    if (raiders.length) squadAbility(sq, dt, raiders);
  }
}

function decideGoal(sq, raiders, enemyGoals, landingGoals) {
  const st = sq.rt, n = st.members.length, max = st.stats.size;
  let near = Infinity;
  for (const r of raiders) near = Math.min(near, dist(r.x, r.y, st.ax, st.ay));
  if (sq.mode === 'auto') {
    if (!st.retreating && n < max && n <= Math.ceil(max * 0.34) && near < 3) st.retreating = true;
    if (st.retreating && n >= Math.ceil(max * 0.8)) st.retreating = false;
  } else st.retreating = false;

  let goal = null;
  if (st.retreating) {
    const rb = nearestRefill(st.ax, st.ay);
    if (rb) { goal = rb; st.task = 'retreat'; } else st.retreating = false;
  }
  if (!goal && sq.mode === 'hold' && sq.hold) { goal = sq.hold; st.task = near < 2.5 ? 'fight' : 'hold'; }
  if (!goal && enemyGoals.has(sq)) { goal = enemyGoals.get(sq); st.task = 'fight'; }
  if (!goal && n < max && (!landingGoals.has(sq) || (RT.phase === 'countdown' && RT.timer > 9))) {
    const rb = nearestRefill(st.ax, st.ay);
    if (rb) { goal = rb; st.task = 'refill'; }
  }
  if (!goal && landingGoals.has(sq)) { goal = landingGoals.get(sq); st.task = 'guard'; }
  if (!goal) { goal = squadHome(sq); st.task = 'idle'; }
  setGoal(sq, goal.x, goal.y);
}

function moveAnchor(sq, dt) {
  const st = sq.rt;
  if (!st.path.length) return;
  let spread = 0;
  for (const u of st.members) spread += dist(u.x, u.y, st.ax, st.ay);
  spread = st.members.length ? spread / st.members.length : 0;
  const fighting = st.members.some(u => u.target);
  let spd = st.stats.speed * 0.95;
  if (spread > 1.4 && !st.retreating) spd *= 0.35;
  if (fighting && st.task !== 'retreat' && st.task !== 'fight') spd *= 0.5;
  let left = spd * dt;
  while (left > 0 && st.path.length) {
    const p = st.path[0], d = dist(st.ax, st.ay, p.x, p.y);
    if (d <= left) { st.ax = p.x; st.ay = p.y; left -= d; st.path.shift(); }
    else { st.ax += (p.x - st.ax) / d * left; st.ay += (p.y - st.ay) / d * left; left = 0; }
  }
}

function refill(sq, dt, raiders) {
  const st = sq.rt, n = st.members.length, max = st.stats.size;
  if (n >= max) { st.refillT = 0; return; }
  for (const r of raiders) if (dist2(r.x, r.y, st.ax, st.ay) < 2.2 * 2.2) return;
  let rate = 0, at = null;
  for (const b of G.buildings) {
    if (isRefillBuilding(b) && dist2(b.x + 0.5, b.y + 0.5, st.ax, st.ay) < 0.9 * 0.9) { at = b; rate = b.type === 'barracks' ? 1.3 : 1; break; }
  }
  if (!at && sq.mode === 'hold') rate = 0.3;
  if (RT.phase === 'countdown') rate *= 1.5;
  st.refillT += dt * rate * st.stats.refill;
  if (st.refillT >= 2.5) {
    st.refillT = 0;
    const u = addMember(sq, (at ? at.x + 0.5 : st.ax), (at ? at.y + 0.6 : st.ay));
    addFx('refill', u.x, u.y, 0.5);
  }
}

function squadAbility(sq, dt, raiders) {
  const st = sq.rt;
  if (sq.cls !== 'sword' && sq.cls !== 'bow') return;
  st.abilityT -= dt;
  if (st.abilityT > 0) return;
  if (sq.cls === 'sword') {
    let used = false;
    for (const m of st.members) {
      for (const r of raiders) {
        if (!r.alive || dist2(m.x, m.y, r.x, r.y) > 0.95 * 0.95) continue;
        used = true;
        damageUnit(r, m.dmg * 2, m);
        if (r.alive && !r.big) knock(r, r.x - m.x, r.y - m.y, 4.2);
      }
    }
    if (used) { st.abilityT = 8; for (const m of st.members) addFx('bash', m.x, m.y, 0.4); }
    else st.abilityT = 0.5;
  } else {
    const range = st.stats.range + 1;
    let best = null, bc = 0;
    for (const r of raiders) {
      if (dist(r.x, r.y, st.ax, st.ay) > range) continue;
      let c = 0; for (const o of raiders) if (dist2(o.x, o.y, r.x, r.y) < 1.69) c++;
      if (c > bc) { bc = c; best = r; }
    }
    if (!best) { st.abilityT = 0.5; return; }
    RT.volleys.push({ x: best.x, y: best.y, t: 0.8, r: 1.3, dmg: 2.2 * st.stats.dmg * st.members.length / 5, src: st.members[0] || null });
    for (const m of st.members) {
      for (let k = 0; k < 2; k++) {
        RT.projectiles.push({ x: m.x, y: m.y, sx: m.x, sy: m.y, tx: best.x + (rand() - 0.5) * 1.6, ty: best.y + (rand() - 0.5) * 1.6, tgt: null, dmg: 0, side: 0, speed: 0, dur: 0.8, t: 0, visual: true, h0: 0.3 });
      }
    }
    st.abilityT = 10;
  }
}

function updateVolleys(dt) {
  for (const v of RT.volleys) {
    v.t -= dt;
    if (v.t > 0) continue;
    for (const u of RT.units) {
      if (u.side !== 1 || !u.alive) continue;
      if (dist2(u.x, u.y, v.x, v.y) <= v.r * v.r) damageUnit(u, v.dmg * u.arrowTaken, v.src);
    }
    addFx('volley', v.x, v.y, 0.5);
  }
  RT.volleys = RT.volleys.filter(v => v.t > 0);
}

/* ---------- unit behaviour ---------- */
function moveToward(u, tx, ty, spd, dt, stopAt) {
  const dx = tx - u.x, dy = ty - u.y, d = Math.sqrt(dx * dx + dy * dy), s = stopAt || 0.04;
  if (d <= s) return false;
  const ftx = Math.floor(u.x), fty = Math.floor(u.y);
  let v = spd * dt * (hasTree(ftx, fty) ? 0.8 : 1);
  const nx0 = u.x + dx / d * 0.3, ny0 = u.y + dy / d * 0.3;
  if (tileType(Math.floor(nx0), Math.floor(ny0)) === T_HIGH && tileType(ftx, fty) !== T_HIGH) v *= 0.65;
  if (v > d - s) v = d - s;
  const nx = u.x + dx / d * v, ny = u.y + dy / d * v;
  if (isLandAt(nx, ny)) { u.x = nx; u.y = ny; }
  else if (isLandAt(nx, u.y)) u.x = nx;
  else if (isLandAt(u.x, ny)) u.y = ny;
  if (Math.abs(dx) > 0.02) u.face = dx > 0 ? 1 : -1;
  u.walk += v;
  return true;
}

function knock(u, dx, dy, power) {
  const d = Math.hypot(dx, dy) || 1;
  u.kbx = dx / d * power; u.kby = dy / d * power; u.stun = 0.35;
}

function updateUnits(dt) {
  for (const u of RT.units) {
    if (!u.alive) continue;
    if (u.flash > 0) u.flash -= dt;
    u.cdT -= dt;
    if (u.kbx || u.kby) {
      u.x += u.kbx * dt; u.y += u.kby * dt;
      const f = Math.pow(0.02, dt); u.kbx *= f; u.kby *= f;
      if (Math.abs(u.kbx) + Math.abs(u.kby) < 0.08) { u.kbx = 0; u.kby = 0; }
      if (!isLandAt(u.x, u.y)) { drown(u); continue; }
    }
    if (u.stun > 0) { u.stun -= dt; continue; }
    if (u.side === 0) updateDefender(u, dt); else updateRaider(u, dt);
  }
}

function nearestFoe(u, side, maxD, cx, cy, cr) {
  let best = null, bd = maxD * maxD;
  for (const o of RT.units) {
    if (o.side !== side || !o.alive || o.fleeing) continue;
    const d = dist2(u.x, u.y, o.x, o.y);
    if (d >= bd) continue;
    if (cr !== undefined && dist2(o.x, o.y, cx, cy) > cr * cr && d > 0.64) continue;
    bd = d; best = o;
  }
  return best;
}

function updateDefender(u, dt) {
  const sq = u.sq, st = sq.rt;
  const n = st.members.length;
  const [ox, oy] = slotOffset(u.slot, n);
  const hx = st.ax + ox, hy = st.ay + oy;
  if (st.retreating) { u.target = null; moveToward(u, hx, hy, u.speed * 1.1, dt); return; }
  if (u.ranged) {
    const range = u.range + (tileType(Math.floor(u.x), Math.floor(u.y)) === T_HIGH ? 1 : 0);
    let t = u.target;
    if (!t || !t.alive || t.fleeing || dist2(u.x, u.y, t.x, t.y) > range * range) t = u.target = nearestFoe(u, 1, range);
    if (t) {
      u.face = t.x >= u.x ? 1 : -1;
      if (u.cdT <= 0) { shoot(u, t, u.dmg); u.cdT = u.cd * (0.9 + rand() * 0.2); }
      if (dist2(u.x, u.y, hx, hy) > 2.5 * 2.5) moveToward(u, hx, hy, u.speed, dt);
    } else moveToward(u, hx, hy, u.speed, dt);
    return;
  }
  const engageR = sq.mode === 'hold' ? 2.2 : 2.5;
  let t = u.target;
  if (t && (!t.alive || t.fleeing || dist2(t.x, t.y, st.ax, st.ay) > (engageR + 1.2) * (engageR + 1.2))) t = u.target = null;
  if (!t) t = u.target = nearestFoe(u, 1, engageR + 1.5, st.ax, st.ay, engageR);
  if (t) {
    const reach = u.range + u.r + t.r, d = dist(u.x, u.y, t.x, t.y);
    if (d > reach) moveToward(u, t.x, t.y, u.speed, dt, reach * 0.9);
    else if (u.cdT <= 0) { meleeHit(u, t); u.cdT = u.cd * (0.9 + rand() * 0.2); }
    if (Math.abs(t.x - u.x) > 0.02) u.face = t.x > u.x ? 1 : -1;
  } else moveToward(u, hx, hy, u.speed, dt);
}

function warlordAura(u) {
  for (const o of RT.units) if (o.alive && o.kind === 'warlord' && o.side === 1 && o !== u && dist2(o.x, o.y, u.x, u.y) < 4) return 1.25;
  return 1;
}

function updateRaider(u, dt) {
  if (u.fleeing) {
    u.alpha -= dt * 0.5;
    if (u.alpha <= 0) u.alive = false;
    return;
  }
  const aggro = u.big ? 0.9 : 1.6;
  if (u.ranged) {
    let t = u.target;
    if (!t || !t.alive || dist2(u.x, u.y, t.x, t.y) > u.range * u.range) t = u.target = nearestFoe(u, 0, u.range);
    if (t) {
      u.face = t.x >= u.x ? 1 : -1;
      if (u.cdT <= 0) { shoot(u, t, u.dmg * warlordAura(u)); u.cdT = u.cd * (0.9 + rand() * 0.2); }
      return;
    }
    let bt = null, bd = 2.6 * 2.6;
    for (const b of G.buildings) {
      if (b.ruined || b.type === 'palisade') continue;
      const d = dist2(u.x, u.y, b.x + 0.5, b.y + 0.5);
      if (d < bd) { bd = d; bt = b; }
    }
    if (bt) {
      u.face = bt.x + 0.5 >= u.x ? 1 : -1;
      if (u.cdT <= 0) { shoot(u, bt, u.dmg * 1.5 * warlordAura(u)); u.cdT = u.cd * (0.9 + rand() * 0.2); }
      return;
    }
  } else {
    let t = u.target;
    if (t && (!t.alive || dist2(u.x, u.y, t.x, t.y) > (aggro + 1) * (aggro + 1))) t = null;
    if (!t) t = nearestFoe(u, 0, aggro);
    u.target = t;
    if (t) {
      const reach = u.range + u.r + t.r, d = dist(u.x, u.y, t.x, t.y);
      if (d > reach) moveToward(u, t.x, t.y, u.speed, dt, reach * 0.9);
      else if (u.cdT <= 0) { meleeHit(u, t); u.cdT = u.cd * (0.9 + rand() * 0.2); }
      return;
    }
  }
  // March on buildings along the flow field.
  const tx = Math.floor(u.x), ty = Math.floor(u.y);
  if (!inMap(tx, ty)) return;
  const here = RT.bAt[tIdx(tx, ty)];
  if (here && !here.ruined && here.type !== 'palisade') { attackBuilding(u, here, dt); return; }
  const next = bestNeighbor(tx, ty);
  if (next < 0) return;
  const nb = RT.bAt[next];
  const nx = next % MAP_W, ny = (next / MAP_W) | 0;
  if (nb && !nb.ruined) attackBuilding(u, nb, dt);
  else moveToward(u, nx + 0.5 + u.offx, ny + 0.5 + u.offy, u.speed, dt, 0.05);
}

function attackBuilding(u, b, dt) {
  const bx = b.x + 0.5, by = b.y + 0.5;
  // Distance to the edge of the building's tile, so a crowd can surround it.
  const ex = Math.max(Math.abs(u.x - bx) - 0.42, 0), ey = Math.max(Math.abs(u.y - by) - 0.42, 0);
  if (Math.sqrt(ex * ex + ey * ey) > u.range + u.r) { moveToward(u, bx, by, u.speed, dt, 0.3); return; }
  u.face = bx >= u.x ? 1 : -1;
  if (u.cdT <= 0) {
    damageBuilding(b, u.dmg * 2 * warlordAura(u));
    u.cdT = u.cd * (0.9 + rand() * 0.2);
    if (rand() < 0.5) addFx('spark', bx + (rand() - 0.5) * 0.4, by - 0.2, 0.35);
  }
}

function meleeHit(u, t) {
  let dmg = u.dmg;
  if (u.side === 0 && u.kind === 'pike') {
    if (t.big || t.kind === 'berserker') dmg *= 2;
    if (u.lastFoe !== t.id) { dmg *= 2; u.lastFoe = t.id; }
  }
  if (u.side === 1) dmg *= warlordAura(u);
  damageUnit(t, dmg, u);
  addFx('hit', (u.x + t.x) / 2, (u.y + t.y) / 2, 0.2);
  if (u.side === 1 && t.alive && (u.kind === 'brute' || u.kind === 'warlord') && !(t.kind === 'pike')) knock(t, t.x - u.x, t.y - u.y, 4.5);
}

function shoot(u, t, dmg) {
  const isB = t.type !== undefined;
  const tx = isB ? t.x + 0.5 : t.x, ty = isB ? t.y + 0.5 : t.y;
  RT.projectiles.push({ x: u.x, y: u.y, sx: u.x, sy: u.y, tx, ty, tgt: t, dmg, side: u.side, src: u, speed: 9, t: 0, h0: 0.25, fire: u.side === 1 && isB });
}

function updateTowers(dt) {
  for (const b of G.buildings) {
    if (b.ruined || (b.type !== 'tower' && b.type !== 'hall')) continue;
    b.cdT -= dt;
    if (b.cdT > 0) continue;
    const range = b.type === 'tower' ? 3.5 + (tileType(b.x, b.y) === T_HIGH ? 1 : 0) : 3;
    const probe = { x: b.x + 0.5, y: b.y + 0.5 };
    const t = nearestFoe(probe, 1, range);
    if (!t) { b.cdT = 0.25; continue; }
    const dmg = (b.type === 'tower' ? towerDamage(b.lvl) : hallArcherDamage(b.lvl)) * D.towerMult;
    RT.projectiles.push({ x: probe.x, y: probe.y, sx: probe.x, sy: probe.y, tx: t.x, ty: t.y, tgt: t, dmg, side: 0, src: b, speed: 10, t: 0, h0: b.type === 'tower' ? 1.4 : 0.9 });
    b.cdT = b.type === 'tower' ? 1.1 : 1.5;
  }
}

function updateProjectiles(dt) {
  const keep = [];
  for (const p of RT.projectiles) {
    if (p.visual) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.x = lerp(p.sx, p.tx, k); p.y = lerp(p.sy, p.ty, k);
      if (k < 1) keep.push(p);
      continue;
    }
    const tg = p.tgt;
    if (tg && tg.type === undefined && tg.alive) { p.tx = tg.x; p.ty = tg.y; }
    const d = dist(p.x, p.y, p.tx, p.ty), s = p.speed * dt;
    p.t += dt;
    if (d <= s || p.t > 3) {
      if (tg && tg.type !== undefined) { if (!tg.ruined) damageBuilding(tg, p.dmg); }
      else if (tg && tg.alive) damageUnit(tg, p.dmg * (tg.arrowTaken || 1), p.src);
      continue;
    }
    p.x += (p.tx - p.x) / d * s; p.y += (p.ty - p.y) / d * s;
    keep.push(p);
  }
  RT.projectiles = keep;
}

function separate() {
  const us = RT.units, n = us.length;
  for (let i = 0; i < n; i++) {
    const a = us[i]; if (!a.alive) continue;
    for (let j = i + 1; j < n; j++) {
      const b = us[j]; if (!b.alive) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      const min = (a.r + b.r) * 0.95;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) { dx = rand() - 0.5; dy = rand() - 0.5; d = Math.hypot(dx, dy); }
      const push = (min - d) / 2, px = dx / d * push, py = dy / d * push;
      if (isLandAt(a.x - px, a.y - py)) { a.x -= px; a.y -= py; }
      if (isLandAt(b.x + px, b.y + py)) { b.x += px; b.y += py; }
    }
  }
}

/* ---------- damage ---------- */
function damageUnit(t, amount, src) {
  if (!t.alive) return;
  t.hp -= amount; t.flash = 0.12;
  if (t.hp <= 0) killUnit(t, src, false);
}

function killUnit(t, src, drowned) {
  t.alive = false;
  addFx(drowned ? 'splash' : 'death', t.x, t.y, drowned ? 0.7 : 0.5, t.side);
  if (t.side === 1) {
    let g = ENEMIES[t.kind].bounty * bountyMult(G.wave) * D.bountyMult;
    if (src && src.side === 0 && src.sq) { g *= src.sq.rt ? src.sq.rt.stats.bounty : 1; src.sq.kills = (src.sq.kills || 0) + 1; }
    G.gold += g; G.stats.goldEarned += g; G.stats.kills++;
    floater(t.x, t.y - 0.3, '+' + fmt(g), '#f0c05a');
    if (t.kind === 'warlord') {
      const tb = 20 * Math.pow(1.1, G.wave - 1);
      G.timber += tb;
      floater(t.x, t.y - 0.7, '+' + fmt(tb) + ' timber', '#c79a63');
    }
  } else {
    const st = t.sq.rt;
    st.members = st.members.filter(m => m !== t);
    st.members.forEach((m, i) => { m.slot = i; });
    if (!st.members.length) {
      st.routedT = 15; st.path = []; st.goal = null; st.retreating = false;
      floater(st.ax, st.ay - 0.4, t.sq.name + ' routed', '#e07a6a');
    }
  }
}

function drown(u) {
  if (!u.alive) return;
  G.stats.drowned++;
  floater(u.x, u.y - 0.3, 'Drowned', '#9fd3e6');
  killUnit(u, null, true);
}

function damageBuilding(b, amount) {
  if (b.ruined) return;
  b.hp -= amount; b.flash = 0.15;
  if (b.hp <= 0) ruinBuilding(b);
}

function ruinBuilding(b) {
  b.ruined = true; b.hp = 0; b.rebuild = 0;
  G.stats.buildingsLost++;
  RT.flowDirty = true;
  recalc();
  addFx('blaze', b.x + 0.5, b.y + 0.5, 1.0);
  if (b.type === 'cottage') {
    const loot = G.gold * 0.03;
    G.gold -= loot;
    if (loot >= 1) floater(b.x + 0.5, b.y - 0.1, '−' + fmt(loot) + ' plundered', '#e07a6a');
  }
  if (b.type === 'hall') defeat();
}

/* ---------- effects ---------- */
function addFx(type, x, y, dur, side) {
  if (RT.effects.length > 160) return;
  RT.effects.push({ type, x, y, t: 0, dur, side });
}
function floater(x, y, text, color) {
  if (RT.floaters.length > 40) RT.floaters.shift();
  RT.floaters.push({ x, y, text, color, t: 0 });
}
function updateFx(dt) {
  for (const e of RT.effects) e.t += dt;
  RT.effects = RT.effects.filter(e => e.t < e.dur);
  for (const f of RT.floaters) { f.t += dt; f.y -= dt * 0.5; }
  RT.floaters = RT.floaters.filter(f => f.t < 1.3);
  for (const b of G.buildings) if (b.flash > 0) b.flash -= dt;
  if (RT.banner) { RT.banner.t += dt; if (RT.banner.t > RT.banner.dur) RT.banner = null; }
}
