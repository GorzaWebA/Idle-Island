/* Greedy bot used by tools/balance.js. Runs inside the game's global scope. */
function botRun(opts) {
  const errors = [];
  if (opts.seed) RNG = mulberry32(opts.seed);
  G = null;
  newGame();
  if (opts.seed) { G.island.seed = opts.seed; setupIsland(); }
  if (opts.sagaLevels) {
    for (const s of SAGAS) G.sagas[s.id] = Math.min(opts.sagaLevels, s.max || 99);
    G.sagas.horn = 0; G.sagas.veterans = 0;
    setupIsland();
  }
  resetRuntime();
  const classes = ['sword', 'bow', 'pike', 'bow', 'sword', 'pike', 'bow', 'sword'];
  let t = 0, nextBot = 0, lastWave = G.wave, winsAtLoss = 0;
  const res = { trait: G.island.trait, land: MAP.landCount, beaches: MAP.beachIds.length, t10: null, t15: null, t20: null, losses: 0, timeline: [] };
  let nextReport = 5;
  const total = opts.minutes * 60;
  while (t < total) {
    try { step(STEP); } catch (e) { errors.push(String(e && e.stack || e)); break; }
    t += STEP;
    if (t >= nextBot) { nextBot = t + 1; try { botAct(classes); } catch (e) { errors.push('bot: ' + (e.stack || e)); } }
    if (G.wave < lastWave) { res.losses++; winsAtLoss = G.stats.wavesWon; }
    lastWave = G.wave;
    // Like a player: after a loss, farm a few waves, then push again.
    if (!G.autoAdvance && G.stats.wavesWon - winsAtLoss >= 3) G.autoAdvance = true;
    if (res.t10 === null && G.bestWave >= 10) res.t10 = +(t / 60).toFixed(1);
    if (res.t15 === null && G.bestWave >= 15) res.t15 = +(t / 60).toFixed(1);
    if (res.t20 === null && G.bestWave >= 20) res.t20 = +(t / 60).toFixed(1);
    if (t / 60 >= nextReport) { res.timeline.push(`${nextReport}m:w${G.bestWave}`); nextReport += 5; }
    if (!isFinite(G.gold) || isNaN(G.gold)) { errors.push('gold NaN'); break; }
  }
  res.best = G.bestWave; res.hall = hallLevel(); res.squads = G.squads.map(s => s.cls[0] + s.lvl).join(',');
  res.gps = D.goldPerSec.toFixed(1); res.errors = errors;
  return res;
}

function gcost(c) { return (c.gold || 0) + (c.timber || 0) * 2.5; }

function bestTileFor(type) {
  let best = null, bs = -Infinity;
  const h = MAP.hall;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (!canPlaceBasic(type, x, y)) continue;
    let s = -dist(x, y, h.x, h.y);
    if (type === 'lumber') s = adjacentTrees(x, y) * 3 - dist(x, y, h.x, h.y) * 0.3;
    if (type === 'tower') {
      let nearBeach = 99; for (const l of MAP.landings) nearBeach = Math.min(nearBeach, dist(x, y, l.x, l.y));
      s = (tileType(x, y) === T_HIGH ? 3 : 0) - Math.abs(nearBeach - 2.5) - dist(x, y, h.x, h.y) * 0.3;
    }
    if (type === 'market') {
      let adj = 0; for (const b of G.buildings) if ((b.type === 'cottage' || b.type === 'hall') && Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) === 1) adj++;
      s = adj * 5 - dist(x, y, h.x, h.y) * 0.1;
    }
    if (s > bs) { bs = s; best = { x, y }; }
  }
  return best;
}

function botAct(classes) {
  for (let guard = 0; guard < 6; guard++) {
    // Promotions first: they are cheap and big.
    const mil = G.squads.find(s => s.cls === 'militia');
    if (mil && canAfford({ gold: PROMOTE_COST })) { promoteSquad(mil, classes[G.squads.indexOf(mil) % classes.length]); continue; }
    const opts = [];
    const hall = hallBuilding();
    const hu = buildingUpgradeInfo(hall);
    opts.push({ w: gcost(hu.cost) * 0.45, cost: hu.cost, go: () => upgradeBuilding(hall) });
    for (const type of BUILD_ORDER) {
      if (D.hallL < BUILDINGS[type].unlock || D.counts[type] >= D.caps[type]) continue;
      if (type === 'palisade') continue;
      const c = buildCost(type, D.counts[type]);
      const k = type === 'cottage' ? 0.6 : type === 'lumber' ? (D.timberPerSec < 0.6 ? 0.4 : 1.2) : type === 'barracks' ? 0.7 : 1;
      opts.push({ w: gcost(c) * k, cost: c, go: () => { const p = bestTileFor(type); return p ? placeBuilding(type, p.x, p.y).ok : false; } });
    }
    const ri = recruitInfo();
    if (ri.can) opts.push({ w: ri.cost.gold * 0.6, cost: ri.cost, go: () => !!recruitSquad() });
    for (const sq of G.squads) {
      if (sq.lvl < D.maxSLvl) opts.push({ w: squadLevelCost(sq.lvl) * 0.8, cost: { gold: squadLevelCost(sq.lvl) }, go: () => trainSquad(sq) });
    }
    for (const b of G.buildings) {
      if (b.type === 'hall' || b.type === 'palisade') continue;
      const u = buildingUpgradeInfo(b);
      if (!u.can) continue;
      const k = b.type === 'cottage' ? 1 : b.type === 'tower' ? 1.1 : 1.3;
      opts.push({ w: gcost(u.cost) * k, cost: u.cost, go: () => upgradeBuilding(b) });
    }
    opts.sort((a, b) => a.w - b.w);
    const o = opts[0];
    if (!o || !canAfford(o.cost)) return;
    if (!o.go()) return;
  }
}
