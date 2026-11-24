'use strict';
/* Persistent game state, derived stats, economy actions, save/load and offline progress. */

const SAVE_KEY = 'idle-island-save-v1';
let G = null;      // persistent state
let D = {};        // derived numbers, rebuilt by recalc()

function newSeed() { return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1; }
function sagaLvl(id) { return (G.sagas && G.sagas[id]) || 0; }

function freshState() {
  return {
    v: 1, gold: 0, timber: 0, renown: 0, renownTotal: 0,
    wave: 1, bestWave: 0, bestEver: 0,
    island: { seed: newSeed(), trait: pick(ISLAND_TRAITS, Math.random).id },
    buildings: [], squads: [], sagas: {}, autoAdvance: true, speed: 1, paused: false,
    stats: { kills: 0, wavesWon: 0, wavesLost: 0, islands: 1, goldEarned: 0, playTime: 0, drowned: 0, buildingsLost: 0 },
    log: [], nextId: 1, lastSave: Date.now(), created: Date.now()
  };
}

function newGame() {
  const keep = G ? { sagas: G.sagas, renown: G.renown, renownTotal: G.renownTotal, bestEver: G.bestEver, stats: G.stats, speed: G.speed, log: G.log } : null;
  G = freshState();
  if (keep) Object.assign(G, keep);
  setupIsland();
}

// Build the starting settlement on the current island.
function setupIsland() {
  MAP = generateIsland(G.island.seed, G.island.trait);
  G.buildings = [];
  G.squads = [];
  addBuilding('hall', MAP.hall.x, MAP.hall.y, 1);
  const spot = nearestFreeTile(MAP.hall.x, MAP.hall.y, (x, y) => canPlaceBasic('cottage', x, y));
  if (spot) addBuilding('cottage', spot.x, spot.y, 1);
  G.wave = 1 + 3 * sagaLvl('horn');
  G.bestWave = 0;
  G.gold = 40 + chestGold(sagaLvl('chest'));
  G.timber = 20 + chestTimber(sagaLvl('chest'));
  G.autoAdvance = true;
  addSquad();
  recalc();
}

function addBuilding(type, x, y, lvl) {
  const b = { id: G.nextId++, type, x, y, lvl: lvl || 1, hp: 1, maxHp: 1, ruined: false, rebuild: 0, cdT: 0, flash: 0 };
  G.buildings.push(b);
  b.maxHp = buildingMaxHp(b); b.hp = b.maxHp;
  return b;
}

function addSquad() {
  const used = new Set(G.squads.map(s => s.name));
  const free = NAMES.filter(n => !used.has(n));
  const sq = {
    id: G.nextId++, name: pick(free.length ? free : NAMES, Math.random), trait: pick(TRAITS, Math.random).id,
    cls: 'militia', lvl: 1 + 2 * sagaLvl('veterans'), mode: 'auto', hold: null, kills: 0
  };
  G.squads.push(sq);
  return sq;
}

function hallLevel() { const h = G.buildings.find(b => b.type === 'hall'); return h ? h.lvl : 1; }
function hallBuilding() { return G.buildings.find(b => b.type === 'hall'); }
function buildingAtTile(x, y) { return G.buildings.find(b => b.x === x && b.y === y) || null; }
function countType(type) { return G.buildings.filter(b => b.type === type).length; }

function buildingMaxHp(b) {
  const base = BUILDINGS[b.type].hp;
  const hl = hallLevel();
  return base * (1 + 0.35 * (b.lvl - 1)) * (1 + 0.5 * (hl - 1)) * (1 + 0.25 * sagaLvl('timbers'));
}

function marketBonusAt(x, y) {
  let bonus = 0;
  for (const b of G.buildings) {
    if (b.type !== 'market' || b.ruined) continue;
    if (Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) === 1) bonus += 0.2 * b.lvl;
  }
  return bonus;
}

function recalc() {
  const hl = hallLevel();
  const caps = hallCaps(hl);
  const trait = G.island.trait;
  const goldMult = (1 + 0.2 * sagaLvl('harvest')) * (trait === 'fertile' ? 1.25 : 1);
  const timberMult = trait === 'timberland' ? 1.25 : 1;
  let gps = 0, tps = 0, drillLv = 0;
  for (const b of G.buildings) {
    b.out = 0;
    if (b.type === 'barracks') drillLv += b.lvl;
    if (b.ruined) continue;
    if (b.type === 'hall') b.out = hallGold(b.lvl) * (1 + marketBonusAt(b.x, b.y)) * goldMult;
    else if (b.type === 'cottage') b.out = cottageGold(b.lvl) * (1 + marketBonusAt(b.x, b.y)) * goldMult;
    else if (b.type === 'lumber') b.out = lumberTimber(b.lvl, adjacentTrees(b.x, b.y)) * timberMult;
    if (b.type === 'lumber') tps += b.out; else gps += b.out;
  }
  const counts = {};
  for (const t of BUILD_ORDER) counts[t] = countType(t);
  const tides = sagaLvl('tides');
  D = {
    hallL: hl, caps, counts, goldPerSec: gps, timberPerSec: tps,
    bountyMult: (1 + 0.2 * sagaLvl('bounty')) * (trait === 'shores' ? 1.15 : 1) * (trait === 'fog' ? 1.25 : 1),
    drill: 1 + 0.03 * drillLv,
    squadDmg: 1 + 0.12 * sagaLvl('steel'),
    squadHp: 1 + 0.12 * sagaLvl('mail'),
    towerMult: 1 + 0.1 * sagaLvl('timbers'),
    maxBLvl: maxBuildingLevel(hl), maxSLvl: maxSquadLevel(hl),
    squadCap: 1 + counts.barracks,
    offlineCap: (8 + 2 * tides) * 3600, offlineEff: 0.5 + 0.1 * tides
  };
  for (const b of G.buildings) {
    const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    b.maxHp = buildingMaxHp(b);
    b.hp = b.ruined ? 0 : Math.max(1, ratio * b.maxHp);
  }
}

function squadStats(sq) {
  const c = CLASSES[sq.cls], tr = TRAITS.find(t => t.id === sq.trait) || {};
  const m = squadLevelMult(sq.lvl);
  return {
    hp: c.hp * m * (tr.hp || 1) * D.squadHp * D.drill,
    dmg: c.dmg * m * (tr.dmg || 1) * D.squadDmg * D.drill,
    cd: c.cd, range: c.range * (c.ranged ? (tr.range || 1) : 1), speed: c.speed * (tr.speed || 1),
    arrowTaken: c.arrowTaken, ranged: c.ranged, size: squadSize(sq.lvl),
    refill: tr.refill || 1, bounty: tr.bounty || 1
  };
}

/* ---------- Affordability ---------- */
function canAfford(cost) { return G.gold >= (cost.gold || 0) - 1e-9 && G.timber >= (cost.timber || 0) - 1e-9; }
function pay(cost) { G.gold -= cost.gold || 0; G.timber -= cost.timber || 0; }

/* ---------- Placement ---------- */
function canPlaceBasic(type, x, y) {
  const t = tileType(x, y);
  if (t === T_WATER) return false;
  if (buildingAtTile(x, y)) return false;
  if (hasTree(x, y)) return false;
  if (t === T_SAND && type !== 'palisade') return false;
  if (type === 'palisade' && isLandingTile(x, y)) return false;
  if (type === 'lumber' && adjacentTrees(x, y) === 0) return false;
  return true;
}

function placementCheck(type, x, y) {
  const b = BUILDINGS[type];
  if (D.hallL < b.unlock) return { ok: false, reason: 'Needs Great Hall level ' + b.unlock };
  if (D.counts[type] >= D.caps[type]) return { ok: false, reason: 'Limit reached. Upgrade the Great Hall' };
  const t = tileType(x, y);
  if (t === T_WATER) return { ok: false, reason: 'Cannot build on the sea' };
  if (buildingAtTile(x, y)) return { ok: false, reason: 'Tile is occupied' };
  if (hasTree(x, y)) return { ok: false, reason: 'Trees are in the way' };
  if (t === T_SAND && type !== 'palisade') return { ok: false, reason: 'Only palisades go on beaches' };
  if (type === 'palisade' && isLandingTile(x, y)) return { ok: false, reason: 'Boats land here' };
  if (type === 'lumber' && adjacentTrees(x, y) === 0) return { ok: false, reason: 'Must touch a tree' };
  const cost = buildCost(type, D.counts[type]);
  if (!canAfford(cost)) return { ok: false, reason: 'Not enough resources', cost, valid: true };
  return { ok: true, cost, valid: true };
}

function placeBuilding(type, x, y) {
  const chk = placementCheck(type, x, y);
  if (!chk.ok) return chk;
  pay(chk.cost);
  const b = addBuilding(type, x, y, 1);
  recalc();
  if (typeof onBuildingsChanged === 'function') onBuildingsChanged();
  return { ok: true, b };
}

function nearestFreeTile(x0, y0, okFn) {
  let best = null, bd = 1e9;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (!okFn(x, y)) continue;
    const d = dist(x, y, x0, y0) + (Math.abs(x - x0) + Math.abs(y - y0)) * 0.01;
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}

/* ---------- Building actions ---------- */
function buildingUpgradeInfo(b) {
  if (b.type === 'hall') return { cost: hallUpgradeCost(b.lvl), max: 99, can: true };
  return { cost: upgradeCost(b.type, b.lvl), max: D.maxBLvl, can: b.lvl < D.maxBLvl };
}
function upgradeBuilding(b) {
  const info = buildingUpgradeInfo(b);
  if (!info.can || !canAfford(info.cost) || b.ruined) return false;
  pay(info.cost);
  b.lvl++;
  recalc();
  if (b.type === 'hall') { b.hp = b.maxHp; logEvent('The Great Hall grows to level ' + b.lvl + '.'); }
  if (typeof onBuildingsChanged === 'function') onBuildingsChanged();
  if (typeof refreshAllSquads === 'function') refreshAllSquads();
  return true;
}
function demolishRefund(b) {
  const c = buildCost(b.type, Math.max(0, D.counts[b.type] - 1));
  return { gold: Math.floor(c.gold * 0.5), timber: Math.floor(c.timber * 0.5) };
}
function demolishBuilding(b) {
  if (b.type === 'hall') return false;
  const ref = demolishRefund(b);
  G.gold += ref.gold; G.timber += ref.timber;
  G.buildings = G.buildings.filter(x => x !== b);
  recalc();
  if (b.type === 'barracks' && G.squads.length > D.squadCap) {
    // keep squads; they just can't be replaced beyond the cap
  }
  if (typeof onBuildingsChanged === 'function') onBuildingsChanged();
  if (typeof refreshAllSquads === 'function') refreshAllSquads();
  return true;
}

/* ---------- Squad actions ---------- */
function recruitInfo() { return { cost: { gold: recruitCost(G.squads.length) }, can: G.squads.length < D.squadCap }; }
function recruitSquad() {
  const info = recruitInfo();
  if (!info.can || !canAfford(info.cost)) return null;
  pay(info.cost);
  const sq = addSquad();
  if (typeof spawnSquad === 'function') spawnSquad(sq, true);
  logEvent(sq.name + ' raises a new squad.');
  return sq;
}
function trainSquad(sq) {
  if (sq.lvl >= D.maxSLvl) return false;
  const cost = { gold: squadLevelCost(sq.lvl) };
  if (!canAfford(cost)) return false;
  pay(cost); sq.lvl++;
  if (typeof refreshSquad === 'function') refreshSquad(sq);
  return true;
}
function promoteSquad(sq, cls) {
  if (sq.cls !== 'militia' || !CLASSES[cls] || cls === 'militia') return false;
  if (!canAfford({ gold: PROMOTE_COST })) return false;
  pay({ gold: PROMOTE_COST }); sq.cls = cls;
  if (typeof refreshSquad === 'function') refreshSquad(sq);
  logEvent(sq.name + "'s squad trains as " + CLASSES[cls].name + '.');
  return true;
}

/* ---------- Prestige ---------- */
function renownPreview() { return renownFor(G.bestWave); }
function sailOn() {
  const gain = renownPreview();
  if (gain <= 0) return false;
  G.renown += gain; G.renownTotal += gain;
  G.stats.islands++;
  const msg = 'Set sail with ' + gain + ' Renown after reaching wave ' + G.bestWave + '.';
  G.island = { seed: newSeed(), trait: pick(ISLAND_TRAITS, Math.random).id };
  G.buildings = []; G.squads = [];
  setupIsland();
  logEvent(msg + ' A new island: ' + islandTrait(G.island.trait).name + '.');
  return true;
}
function buySaga(id) {
  const s = SAGAS.find(x => x.id === id); if (!s) return false;
  const l = sagaLvl(id);
  if (s.max && l >= s.max) return false;
  const c = sagaCost(s, l);
  if (G.renown < c) return false;
  G.renown -= c; G.sagas[id] = l + 1;
  recalc();
  if (typeof refreshAllSquads === 'function') refreshAllSquads();
  return true;
}

/* ---------- Log ---------- */
function logEvent(text) {
  G.log.unshift({ t: Date.now(), w: G.wave, text });
  if (G.log.length > 60) G.log.length = 60;
}

/* ---------- Save / load ---------- */
function serialize() {
  return {
    v: 1, gold: G.gold, timber: G.timber, renown: G.renown, renownTotal: G.renownTotal,
    wave: G.wave, bestWave: G.bestWave, bestEver: G.bestEver, island: G.island,
    buildings: G.buildings.map(b => [b.type, b.x, b.y, b.lvl]),
    squads: G.squads.map(s => ({ name: s.name, trait: s.trait, cls: s.cls, lvl: s.lvl, mode: s.mode, hold: s.hold, kills: s.kills || 0 })),
    sagas: G.sagas, autoAdvance: G.autoAdvance, speed: G.speed, stats: G.stats,
    log: G.log.slice(0, 30), lastSave: Date.now(), created: G.created
  };
}
function deserialize(o) {
  if (!o || o.v !== 1 || !o.island) throw new Error('Unrecognised save');
  const s = freshState();
  Object.assign(s, {
    gold: +o.gold || 0, timber: +o.timber || 0, renown: +o.renown || 0, renownTotal: +o.renownTotal || 0,
    wave: Math.max(1, o.wave | 0), bestWave: o.bestWave | 0, bestEver: o.bestEver | 0, island: o.island,
    sagas: o.sagas || {}, autoAdvance: o.autoAdvance !== false, speed: [1, 2, 3].includes(o.speed) ? o.speed : 1,
    stats: Object.assign(s.stats, o.stats || {}), log: Array.isArray(o.log) ? o.log : [],
    lastSave: o.lastSave || Date.now(), created: o.created || Date.now()
  });
  G = s;
  MAP = generateIsland(G.island.seed, G.island.trait);
  G.buildings = [];
  for (const [type, x, y, lvl] of o.buildings || []) if (BUILDINGS[type]) addBuilding(type, x, y, lvl);
  if (!hallBuilding()) addBuilding('hall', MAP.hall.x, MAP.hall.y, 1);
  G.squads = [];
  for (const q of o.squads || []) {
    G.squads.push({ id: G.nextId++, name: q.name, trait: q.trait, cls: CLASSES[q.cls] ? q.cls : 'militia', lvl: Math.max(1, q.lvl | 0), mode: q.mode === 'hold' ? 'hold' : 'auto', hold: q.hold || null, kills: q.kills || 0 });
  }
  if (!G.squads.length) addSquad();
  recalc();
}
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); G.lastSave = Date.now(); return true; } catch (e) { return false; }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    deserialize(JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}
function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(serialize())))); }
function importSave(str) {
  const o = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
  deserialize(o);
}
function wipeSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ } }

/* ---------- Offline progress ---------- */
function estWaveGold(n) {
  return (waveBudget(n) * 1.9 * bountyMult(n) + waveBonusGold(n)) * D.bountyMult;
}
function offlineGains(seconds) {
  const sec = Math.min(seconds, D.offlineCap);
  const eff = D.offlineEff;
  let gold = D.goldPerSec * sec * eff, timber = D.timberPerSec * sec * eff, waves = 0;
  const farm = Math.min(G.wave - (G.autoAdvance ? 1 : 0), G.bestWave);
  if (farm >= 1) {
    waves = Math.floor(sec / (countdownTime(farm) + 25));
    gold += waves * estWaveGold(farm) * eff;
    timber += waves * waveBonusTimber(farm) * eff;
  }
  return { sec, capped: seconds > D.offlineCap, gold, timber, waves, farm };
}
function applyOffline(seconds) {
  const g = offlineGains(seconds);
  G.gold += g.gold; G.timber += g.timber;
  G.stats.goldEarned += g.gold;
  G.stats.wavesWon += g.waves;
  return g;
}
