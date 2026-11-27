#!/usr/bin/env node
/*
 * Browser smoke test for the 3D game (headless Chromium, software WebGL).
 *  - loads the game, plays 30 s of game time while rendering, checks for console errors
 *  - checks the canvas isn't blank, builds a cottage by clicking its tile,
 *    orbits with the mouse, zooms with the wheel, rotates with Q, recentres
 *  - a dark-theme battle, a Warlord battle, fire/water/feel effects and island traits,
 *    waves 1-10 rendered as they play, reduced motion, the single-file build,
 *    and the classic 2D fallback (?2d)
 * Saves screenshots. Exit code 1 on any failure.
 *
 *   node tools/smoke.js [screenshotDir]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? ' (' + detail + ')' : ''));
  if (!ok) failures.push(name);
}

async function open(browser, opts) {
  const ctx = await browser.newContext({ viewport: opts.viewport, colorScheme: opts.scheme || 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  // The game must never touch the network at runtime.
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) errors.push('network request: ' + u); });
  await page.goto((opts.url || url) + (opts.query || ''));
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

// Steps the sim with interpolation snapshots, rendering every few steps, like the real loop.
async function play(page, seconds) {
  await page.evaluate(sec => {
    G.paused = true;
    const steps = Math.round(sec / STEP);
    for (let i = 0; i < steps; i++) {
      VIEW.beforeStep(); step(STEP);
      if (i % 10 === 9) VIEW.frame(STEP * 10, 1);
    }
  }, seconds);
}

async function tilePoint(page, x, y) {
  const box = await page.locator('#cv').boundingBox();
  const p = await page.evaluate(([x, y]) => { if (VIEW.rig) VIEW.rig.settle(); return VIEW.tileToScreen(x, y); }, [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: GL_ARGS });

  console.log('desktop, light theme');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1400, height: 860 } });
    check('3D renderer active', await page.evaluate(() => VIEW.kind) === '3d');
    await play(page, 30);
    const probe = await page.evaluate(() => VIEW.probe());
    check('canvas is not blank', probe.colors >= 8 && probe.meanLum > 20 && probe.meanLum < 240, JSON.stringify(probe));
    check('30 s of play without errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // Build a cottage by clicking a free tile near the Hall.
    await page.evaluate(() => { G.gold += 3000; G.timber += 1000; G.paused = false; });
    await page.click('[data-act="build"][data-arg="cottage"]');
    const spot = await page.evaluate(() => nearestFreeTile(MAP.hall.x, MAP.hall.y, (x, y) => canPlaceBasic('cottage', x, y) && !(x === MAP.hall.x && y === MAP.hall.y)));
    const before = await page.evaluate(() => D.counts.cottage);
    const pt = await tilePoint(page, spot.x, spot.y);
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(150);
    const hover = await page.evaluate(() => UI.hover);
    check('hover picks the tile under the cursor', hover && hover.x === spot.x && hover.y === spot.y, JSON.stringify(hover) + ' vs ' + JSON.stringify(spot));
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(200);
    const built = await page.evaluate(([x, y]) => { const b = buildingAtTile(x, y); return { n: D.counts.cottage, type: b && b.type, tracked: VIEW.buildings.state.size }; }, [spot.x, spot.y]);
    check('click builds a cottage on that tile', built.n === before + 1 && built.type === 'cottage', JSON.stringify(built));
    await page.screenshot({ path: path.join(out, '3d-desktop.png') });

    // Phase 2: tiers, palisades that join up, ghost preview, construction, props under buildings.
    const p2 = await page.evaluate(([x, y]) => {
      const r = {};
      const b = buildingAtTile(x, y);
      G.gold += 1e7; G.timber += 1e7;
      // a freshly placed building starts its construction animation, then finishes it
      const s2 = nearestFreeTile(MAP.hall.x, MAP.hall.y, (xx, yy) => placementCheck('cottage', xx, yy).ok);
      const nb = placeBuilding('cottage', s2.x, s2.y).b;
      VIEW.frame(0.016, 1);
      const st1 = VIEW.buildings.state.get(nb.id), early = st1 && st1.t < 0.7;
      for (let i = 0; i < 20; i++) VIEW.frame(0.05, 1);
      r.constructing = early && VIEW.buildings.state.get(nb.id).t >= 0.7;
      const hall = hallBuilding(); while (hall.lvl < 4) upgradeBuilding(hall);
      while (b.lvl < 6) upgradeBuilding(b);
      VIEW.frame(0.05, 1);
      r.tier3 = (VIEW.buildings.batches.get('cottage:3') || { n: 0 }).n >= 1;
      // three palisades in a row: the middle one joins east and west
      const free = (x, y) => placementCheck('palisade', x, y).ok;
      let row = null;
      for (let yy = 1; yy < MAP_H - 1 && !row; yy++) for (let xx = 1; xx < MAP_W - 3 && !row; xx++) if (free(xx, yy) && free(xx + 1, yy) && free(xx + 2, yy)) row = { x: xx, y: yy };
      if (row) {
        for (let k = 0; k < 3; k++) placeBuilding('palisade', row.x + k, row.y);
        VIEW.frame(0.05, 1);
        const mid = buildingAtTile(row.x + 1, row.y), end = buildingAtTile(row.x, row.y);
        r.joinMid = VIEW.buildings.modelFor(mid).key; r.joinEnd = VIEW.buildings.modelFor(end).key;
      }
      // the ghost shows while placing over a free tile
      const g = nearestFreeTile(MAP.hall.x, MAP.hall.y, (xx, yy) => placementCheck('cottage', xx, yy).ok);
      UI.placing = 'cottage'; UI.hover = g; VIEW.frame(0.05, 1);
      r.ghost = VIEW.overlay.ghost.visible && !document.getElementById('ghost-chip').hidden;
      r.chip = document.getElementById('ghost-chip').textContent;
      UI.placing = null; UI.hover = null; VIEW.frame(0.05, 1);
      r.ghostGone = !VIEW.overlay.ghost.visible;
      // smoke rises from producing chimneys, and nothing grows without bound
      for (let i = 0; i < 60; i++) VIEW.frame(0.05, 1);
      r.puffs = VIEW.puffs.n;
      // decorations on built tiles are hidden (zero scale), the rest are not
      const m = new THREE.Matrix4(), sc = new THREE.Vector3();
      let under = 0, hidden = 0;
      for (const k of ['tufts', 'flowers']) {
        const set = VIEW.props.sets[k];
        set.items.forEach((it, i) => {
          if (!VIEW.buildings.byTile.has(it.tile)) return;
          under++; set.mesh.getMatrixAt(i, m); sc.setFromMatrixScale(m); if (sc.x === 0) hidden++;
        });
      }
      r.under = under; r.hidden = hidden;
      r.calls = VIEW.probe().calls;
      return r;
    }, [spot.x, spot.y]);
    check('a new building rises with a construction animation', p2.constructing);
    check('upgrading changes the model tier', p2.tier3);
    check('palisades join their neighbours', p2.joinMid === 'palisade:1:10' && p2.joinEnd === 'palisade:1:2', p2.joinMid + ' / ' + p2.joinEnd);
    check('placement ghost and its label appear, then go away', p2.ghost && p2.ghostGone, p2.chip);
    check('chimneys smoke', p2.puffs > 0, p2.puffs + ' puffs');
    check('grass and flowers hide under buildings', p2.under > 0 && p2.hidden === p2.under, p2.hidden + '/' + p2.under);
    check('draw calls stay low with a growing base', p2.calls < 60, p2.calls + ' calls');

    // Orbit, zoom, rotate, recentre.
    const box = await page.locator('#cv').boundingBox();
    const c = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
    const cam0 = await page.evaluate(() => ({ yaw: VIEW.rig.gYaw, pitch: VIEW.rig.gPitch, dist: VIEW.rig.gDist, n: G.buildings.length }));
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 160, c.y + 40, { steps: 8 }); await page.mouse.up();
    const cam1 = await page.evaluate(() => ({ yaw: VIEW.rig.gYaw, pitch: VIEW.rig.gPitch, n: G.buildings.length, sel: UI.selB }));
    check('left-drag orbits', Math.abs(cam1.yaw - cam0.yaw) > 0.5 && cam1.pitch > cam0.pitch, (cam1.yaw - cam0.yaw).toFixed(2) + ' rad');
    check('a drag never builds or selects', cam1.n === cam0.n);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(100);
    const dist1 = await page.evaluate(() => VIEW.rig.gDist);
    check('wheel zooms in', dist1 < cam0.dist * 0.8, cam0.dist.toFixed(1) + ' -> ' + dist1.toFixed(1));
    const y0 = await page.evaluate(() => VIEW.rig.gYaw);
    await page.keyboard.down('q'); await page.waitForTimeout(300); await page.keyboard.up('q');
    const y1 = await page.evaluate(() => VIEW.rig.gYaw);
    check('Q rotates the view', y1 - y0 > 0.2, (y1 - y0).toFixed(2));
    await page.screenshot({ path: path.join(out, '3d-desktop-orbit.png') });
    await page.click('#recentre');
    const cam2 = await page.evaluate(() => ({ dist: VIEW.rig.gDist, fit: VIEW.rig.fitDist, pitch: VIEW.rig.gPitch }));
    check('recentre shows the whole island again', Math.abs(cam2.dist - cam2.fit) < 0.01 && Math.abs(cam2.pitch - 0.9) < 0.01);
    check('no errors while playing', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('desktop, dark theme, battle');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.evaluate(() => {
      G.gold += 5000; G.timber += 3000;
      promoteSquad(G.squads[0], 'sword');
      G.paused = true;
      let g = 0;
      while (!(RT.phase === 'battle' && RT.battleT > 4) && g++ < 20 * 120) { VIEW.beforeStep(); step(STEP); }
      VIEW.frame(0.05, 1);
    });
    await page.click('[data-act="tab"][data-arg="squads"]');
    await page.waitForTimeout(400);
    const probe = await page.evaluate(() => ({ p: VIEW.probe(), raiders: RT.units.filter(u => u.side === 1).length, inst: VIEW.units.count() }));
    check('battle renders units', probe.inst >= probe.raiders && probe.raiders > 0, JSON.stringify(probe));
    await page.screenshot({ path: path.join(out, '3d-dark-battle.png') });
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('battle on a Warlord wave (units, boats, arrows, deaths)');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 800 } });
    await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
    // Set up a Warlord wave on a built-up island, then play it in short chunks so the
    // browser can flush its GPU work between them (like real frames do).
    await page.evaluate(() => {
      window.__b = { hop: false, boatsSeen: 0, oars: 0, arrows: 0, falls: 0, drowns: 0, floaters: 0, maxUnits: 0, maxCalls: 0, partsOk: true, ms: [], frames: 0 };
      RNG = mulberry32(777); G.paused = true;
      const classes = ['sword', 'bow', 'pike', 'bow', 'sword', 'pike']; let t = 0, nb = 0;
      while (t < 8 * 60) { step(STEP); t += STEP; if (t >= nb) { nb = t + 1; botAct(classes); } if (!G.autoAdvance) G.autoAdvance = true; }
      G.wave = 10; resetRuntime(); VIEW.units.clear();
    });
    for (let chunk = 0; chunk < 80; chunk++) {
      const done = await page.evaluate(() => {
        const out = window.__b, U = VIEW.units;
        for (let i = 0; i < 40; i++) {
          if (RT.phase === 'battle' && !RT.units.some(u => u.side === 1) && !RT.boats.some(b => b.state === 'unload')) return true;
          VIEW.beforeStep(); step(STEP); out.frames++;
          if (out.frames % 4) continue;
          const t0 = performance.now(); U.sync(1, 0.2); VIEW.missiles.sync(1, 0.2); out.ms.push(performance.now() - t0);
          VIEW.frame(0, 1);
          const alive = RT.units.filter(u => u.alive).length;
          out.maxUnits = Math.max(out.maxUnits, alive);
          if (U.arms.n < alive * 2 || U.legs.n < alive * 2 || U.count() < alive) out.partsOk = false;
          out.boatsSeen = Math.max(out.boatsSeen, U.boats.hulls[0].n + U.boats.hulls[1].n);
          out.oars = Math.max(out.oars, U.boats.oars.n);
          out.arrows = Math.max(out.arrows, VIEW.missiles.arrows.n);
          for (const st of U.state.values()) { if (st.hop) out.hop = true; if (st.dead === 'fall') out.falls++; if (st.dead === 'drown') out.drowns++; }
          out.floaters = Math.max(out.floaters, [...document.querySelectorAll('.floater')].filter(e => !e.hidden).length);
          out.maxCalls = Math.max(out.maxCalls, VIEW.renderer.info.render.calls);
        }
        return false;
      });
      if (done) break;
      await page.waitForTimeout(20);
    }
    const r = await page.evaluate(() => {
      const out = window.__b, U = VIEW.units;
      // knock a raider off a cliff: it should drown, not fall
      const coast = [];
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (tileType(x, y) === T_GRASS && tileType(x + 1, y) === T_WATER) coast.push({ x, y });
      if (coast.length) {
        const c = coast[0], u = makeRaider('raider', c.x + 0.85, c.y + 0.5);
        U.sync(1, 0.05);
        u.kbx = 5; u.kby = 0; u.stun = 0.4;
        for (let i = 0; i < 20 && u.alive; i++) { VIEW.beforeStep(); step(STEP); U.sync(1, 0.05); }
        const st = U.state.get(u.id);
        out.drownedRaider = st ? st.dead : (u.alive ? 'still alive' : 'gone');
      }
      out.ms.sort((a, b) => a - b);
      out.p95ms = out.ms[Math.floor(out.ms.length * 0.95)] || 0; out.medianMs = out.ms[out.ms.length >> 1] || 0; delete out.ms;
      return out;
    });
    check('every live unit is drawn with body, arms and legs', r.partsOk, r.maxUnits + ' units at most');
    check('longboats row in', r.boatsSeen > 0 && r.oars >= 16, r.boatsSeen + ' boats, ' + r.oars + ' oars (8 are the moored boat\'s)');
    check('raiders leap ashore from their boat', r.hop);
    check('arrows fly', r.arrows > 0, r.arrows + ' at once');
    check('the slain fall', r.falls > 0, r.falls + ' falling frames');
    check('a raider knocked into the sea drowns', r.drownedRaider === 'drown', r.drownedRaider);
    check('gold numbers rise from kills', r.floaters > 0, r.floaters + ' at once');
    check('draw calls stay low in a full battle', r.maxCalls < 90, r.maxCalls + ' calls');
    check('animating every figure is cheap', r.p95ms < 6, 'median ' + r.medianMs.toFixed(2) + ' ms, p95 ' + r.p95ms.toFixed(2) + ' ms for ' + r.maxUnits + ' units');
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('fire, water and feel');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1000, height: 640 } });
    await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
    // A built-up island on a Fogbound-free trait, then hand-made damage, a ruin and a wave.
    await page.evaluate(() => {
      RNG = mulberry32(99); G.paused = true;
      const classes = ['sword', 'bow', 'pike', 'bow', 'sword', 'pike']; let t = 0, nb = 0;
      while (t < 6 * 60) { step(STEP); t += STEP; if (t >= nb) { nb = t + 1; botAct(classes); } if (!G.autoAdvance) G.autoAdvance = true; }
      resetRuntime(); VIEW.units.clear();
      for (const b of G.buildings) { b.ruined = false; b.rebuild = 0; b.hp = b.maxHp; }
      VIEW.frame(0.05, 1);
    });
    const f = await page.evaluate(async () => {
      const r = {}, B = VIEW.buildings, frames = async (n, dt) => { for (let i = 0; i < n; i++) { VIEW.frame(dt, 1); if (i % 20 === 19) await new Promise(res => setTimeout(res, 5)); } };
      const flames = () => { const P = VIEW.puffs; let n = 0; for (let i = 0; i < P.max; i++) if (P.alive[i] && P.emit[i]) n++; return n; };
      const others = G.buildings.filter(b => b.type !== 'hall' && b.type !== 'palisade');
      const hurt = others[0], ruin = others[1];
      // healthy at noon: no fire, no lit windows
      await frames(10, 0.05);
      r.calmFlames = flames(); r.calmLights = VIEW.lights.n;
      // a badly damaged building blackens and burns
      hurt.hp = hurt.maxHp * 0.3;
      await frames(40, 0.05);
      const sh = B.state.get(hurt.id);
      r.burn = +sh.burn.toFixed(2); r.flames = flames(); r.sparks = VIEW.sparks.n; r.glow = VIEW.glow.n;
      // a ruin burns fiercely, then smoulders
      ruin.ruined = true; ruin.hp = 0; ruin.rebuild = 0;
      await frames(30, 0.05);
      const sr = B.state.get(ruin.id);
      r.ruinBurn = +sr.burn.toFixed(2);
      await frames(150, 0.1);
      r.ruinLater = +sr.burn.toFixed(2);
      const puffs0 = VIEW.puffs.n; await frames(30, 0.05); r.smoulderPuffs = VIEW.puffs.n; void puffs0;
      hurt.hp = hurt.maxHp; ruin.ruined = false; ruin.hp = ruin.maxHp;
      await frames(60, 0.1);
      r.outFlames = flames();
      // dusk: doors and windows glow
      document.documentElement.setAttribute('data-theme', 'dark');
      await new Promise(res => setTimeout(res, 30));       // the theme observer runs
      await frames(5, 0.05);
      r.duskLights = VIEW.lights.n;
      document.documentElement.setAttribute('data-theme', 'light');
      await new Promise(res => setTimeout(res, 30));
      await frames(2, 0.05);
      // the sea knows where beaches and cliffs are
      const tex = VIEW.sea.mesh.children[0].material.uniforms.uDist.value.image.data;
      let beach = 0, cliff = 0, wet = 0;
      for (let i = 0; i < tex.length; i += 4) {
        if (tex[i] > 0 && tex[i] < 40) { if (tex[i + 1] - tex[i] < 10) beach++; else if (tex[i + 1] - tex[i] > 60) cliff++; }
        if (tex[i] === 0 && tex[i + 2] > 0) wet++;
      }
      r.shore = { beach, cliff, wet };
      // the sun drifts
      const s0 = VIEW.sun.position.clone(); VIEW.time += 150; VIEW.sunT = 0; VIEW.frame(0.016, 1);
      r.sunMoved = +VIEW.sun.position.distanceTo(s0).toFixed(2);
      // the camera leans towards the Warlord's boat, unless the player is busy
      const rig = VIEW.rig; rig.recentre(true); rig.idle = 5;
      const g0 = rig.goal.clone();
      r.nudged = rig.nudge(g0.x + 30, g0.z); r.nudge = +rig.goal.distanceTo(g0).toFixed(2);
      rig.recentre(true); rig.idle = 0.5; r.busyNudge = rig.nudge(g0.x + 30, g0.z);
      rig.recentre(true);
      // a wave: wakes, ripples, foam, arrow impacts
      let impacts = 0; const imp = VIEW.missiles.impact.bind(VIEW.missiles); VIEW.missiles.impact = p => { impacts++; imp(p); };
      r.ripples = 0; r.foam = 0; r.calls = 0;
      while (RT.phase === 'countdown' && RT.timer > 8) { VIEW.beforeStep(); step(STEP); }
      let fought = false;
      for (let i = 0; i < 1600; i++) {
        VIEW.beforeStep(); step(STEP);
        if (RT.phase === 'battle') fought = true; else if (fought) break;
        if (i % 2) continue;
        VIEW.frame(STEP * 2, 1);
        r.ripples = Math.max(r.ripples, VIEW.ripples.n); r.foam = Math.max(r.foam, VIEW.foam.n);
        r.calls = Math.max(r.calls, VIEW.renderer.info.render.calls);
        if (i % 30 === 28) await new Promise(res => setTimeout(res, 5));
      }
      r.impacts = impacts; r.fought = fought;
      r.pools = { puffs: VIEW.puffs.n <= VIEW.puffs.max, sparks: VIEW.sparks.n <= VIEW.sparks.max };
      // island traits
      const look = async tr => {
        G.island = { seed: 4242, trait: tr }; G.buildings = []; G.squads = []; setupIsland();
        VIEW.frame(0.016, 1); await frames(30, 0.5);
        return { flowers: VIEW.props.counts.flowers, logs: VIEW.props.counts.logs, mist: VIEW.mist.n, fogNear: VIEW.scene.fog.near, rocks: VIEW.props.counts.rocks };
      };
      r.traits = { fertile: await look('fertile'), fog: await look('fog'), shores: await look('shores'), highlands: await look('highlands') };
      return r;
    });
    await page.screenshot({ path: path.join(out, '3d-fog.png') });
    check('a calm settlement at noon has no fire and no lit windows', f.calmFlames === 0 && f.calmLights === 0, f.calmFlames + ' flames, ' + f.calmLights + ' lights');
    check('a badly damaged building burns', f.burn > 0.3 && f.flames > 4 && f.sparks > 0 && f.glow > 0, JSON.stringify({ burn: f.burn, flames: f.flames, sparks: f.sparks, glow: f.glow }));
    check('a fresh ruin burns, then smoulders', f.ruinBurn > 0.5 && f.ruinLater < 0.05 && f.smoulderPuffs > 0, f.ruinBurn + ' -> ' + f.ruinLater + ', ' + f.smoulderPuffs + ' puffs');
    check('fires go out once repaired', f.outFlames === 0, f.outFlames + ' flames');
    check('doors and windows glow at dusk', f.duskLights > 2, f.duskLights + ' lights');
    check('the sea tells beaches from cliffs', f.shore.beach > 20 && f.shore.cliff > 20 && f.shore.wet > 0, JSON.stringify(f.shore));
    check('the sun drifts slowly', f.sunMoved > 0.5, f.sunMoved);
    check('the camera leans towards the Warlord, unless the player is busy', f.nudged && f.nudge > 1 && !f.busyNudge, f.nudge);
    check('boats leave wakes and ripples', f.ripples > 0 && f.foam > 0, f.ripples + ' ripples, ' + f.foam + ' foam');
    check('arrows land with an impact', f.impacts > 0, f.impacts + ' impacts');
    check('effects stay within their pools', f.pools.puffs && f.pools.sparks);
    check('draw calls stay low with every effect', f.calls < 90, f.calls + ' calls');
    const t = f.traits;
    check('Fertile islands have more flowers', t.fertile.flowers > t.fog.flowers * 1.5, t.fertile.flowers + ' vs ' + t.fog.flowers);
    check('Fogbound islands close the fog in and grow mist', t.fog.fogNear < 25 && t.fog.mist > 0 && t.fertile.mist === 0, JSON.stringify(t.fog));
    check('Many Shores has driftwood', t.shores.logs > 2, t.shores.logs + ' logs');
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('interface: markers, selection, paths, settings, sound');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1100, height: 700 }, query: '?quality=high' });
    await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
    await page.evaluate(() => {
      RNG = mulberry32(31); G.paused = true;
      const classes = ['sword', 'bow', 'pike', 'bow', 'sword', 'pike']; let t = 0, nb = 0;
      while (t < 6 * 60) { step(STEP); t += STEP; if (t >= nb) { nb = t + 1; botAct(classes); } if (!G.autoAdvance) G.autoAdvance = true; }
      resetRuntime(); VIEW.units.clear(); VIEW.rig.recentre(true);
      while (RT.phase === 'countdown' && RT.timer > 6) { VIEW.beforeStep(); step(STEP); }
      for (let i = 0; i < 10; i++) { VIEW.beforeStep(); step(STEP); VIEW.frame(STEP, 1); }
    });
    const u = await page.evaluate(async () => {
      const r = {}, H = VIEW.hud, O = VIEW.overlay;
      // boat markers: one per visible incoming boat, with its raider count; arrows at the edge
      const boats = RT.boats.filter(b => b.state === 'sail' && b.wave === G.wave && !(RT.phase === 'countdown' && RT.timer > b.visibleAt));
      const shown = H.markers.filter(m => !m.hidden);
      r.boats = boats.length; r.markers = shown.length;
      r.counts = shown.map(m => +m.count.textContent).sort().join() === boats.map(b => b.cargo.length).sort().join();
      const rig = VIEW.rig; rig.goal.set(MAP.hall.x + 0.5, 0.3, MAP.hall.y + 0.5); rig.gDist = rig.minDist; rig.clampGoals(); rig.settle(); VIEW.frame(0.016, 1);
      r.edge = H.markers.filter(m => !m.hidden && m.classList.contains('edge')).length;
      r.landing = O.marks.n;
      r.dock = VIEW.units.boats.hulls[2].n;
      rig.recentre(true); VIEW.frame(0.016, 1);
      // select a building: outline, ring and chip
      const b = G.buildings.find(o => o.type === 'cottage') || G.buildings[0];
      UI.selB = b.id; VIEW.frame(0.016, 1);
      r.outline = O.outline.mesh.visible; r.chip = H.chip.hidden ? '' : H.chip.textContent; r.bName = BUILDINGS[b.type].name;
      UI.selB = null;
      // select a squad and hover a far tile: member rings, the route and a flag
      while (RT.phase === 'countdown') { VIEW.beforeStep(); step(STEP); }
      for (let i = 0; i < 40; i++) { VIEW.beforeStep(); step(STEP); if (i % 4 === 0) VIEW.frame(STEP * 4, 1); }
      const sq = G.squads.find(q => q.rt && q.rt.members.length) || G.squads[0];
      UI.selSq = sq.id;
      let far = null, fd = 0;
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (isLandTile(x, y)) { const d = Math.hypot(x - sq.rt.ax, y - sq.rt.ay); if (d > fd) { fd = d; far = { x, y }; } }
      UI.hover = far; VIEW.frame(0.016, 1);
      r.members = sq.rt.members.length; r.rings = O.marks.n; r.dashes = O.path.dashes; r.flags = O.poles.n;
      r.sqChip = H.chip.hidden ? '' : H.chip.textContent; r.sqName = sq.name;
      UI.hover = null; UI.selSq = null;
      // a squad told to hold gets a flag
      orderHold(sq, far.x, far.y); VIEW.frame(0.016, 1);
      r.holdFlag = O.poles.n >= 1 && O.faint.n >= 1;
      orderAuto(sq);
      // health bars and damage numbers over a stretch of battle
      setSetting('damageNumbers', true);
      r.bars = 0; r.numbers = 0;
      for (let i = 0; i < 400 && RT.phase === 'battle'; i++) {
        VIEW.beforeStep(); step(STEP);
        if (i % 4) continue;
        VIEW.frame(STEP * 4, 1);
        r.bars = Math.max(r.bars, H.bars.n); r.numbers = Math.max(r.numbers, H.numbers.length);
        if (i % 40 === 0) await new Promise(res => setTimeout(res, 5));
      }
      setSetting('damageNumbers', false);
      return r;
    });
    check('a badge over every incoming longboat, with its raider count', u.boats > 0 && u.markers === u.boats && u.counts, u.markers + ' badges for ' + u.boats + ' boats');
    check('boats out of view get an edge badge with an arrow', u.edge > 0, u.edge + ' at the edge when zoomed in');
    check('rings mark where the boats will land', u.landing >= 1, u.landing + ' rings');
    check("the settlers' own boat is moored at the dock", u.dock === 1);
    check('a selected building gets an outline, a ground ring and an info chip', u.outline && u.chip.startsWith(u.bName), u.chip);
    check('a selected squad gets rings, a route to the hovered tile and a flag', u.rings >= u.members && u.dashes > 5 && u.flags >= 1 && u.sqChip.startsWith(u.sqName), u.rings + ' rings, ' + u.dashes + ' dashes, chip "' + u.sqChip + '"');
    check('squads holding a tile show a flag there', u.holdFlag);
    check('health bars show during a battle', u.bars > 0, u.bars + ' at most');
    check('damage numbers when switched on', u.numbers > 0, u.numbers + ' at most');

    // Settings tab: quality, overrides, theme, motion, overlay, persistence
    await page.click('#tab-settings');
    await page.waitForTimeout(250);
    const q = async label => { await page.click('[data-act="set"][data-arg="' + label + '"]'); await page.waitForTimeout(120); return page.evaluate(() => ({ level: VIEW.level, shadows: VIEW.renderer.shadowMap.enabled, dpr: VIEW.dprCap, density: VIEW.puffs.density, detail: VIEW.props.sets.tufts.mesh.visible })); };
    const low = await q('quality:low');
    const lowShadow = await q('shadows:on');
    await q('shadows:auto');
    const high = await q('quality:high');
    check('quality Low turns off shadows, extra pixels, grass detail and most effects', low.level === 'low' && !low.shadows && low.dpr === 1 && low.density < 0.6 && !low.detail, JSON.stringify(low));
    check('an explicit choice overrides the quality level', lowShadow.shadows === true);
    check('quality High brings them back', high.level === 'high' && high.shadows && high.density === 1 && high.detail, JSON.stringify(high));
    await q('theme:dark');
    const dusk = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), dusk: VIEW.buildings.dusk }));
    await q('motion:reduce');
    const reduced = await page.evaluate(() => { VIEW.rig.shake(0.3); return { amp: VIEW.rig.shakeAmp, flag: VIEW.rig.reducedMotion }; });
    await page.keyboard.press('F3');
    await page.waitForTimeout(400);
    const perf = await page.evaluate(() => { const e = document.querySelector('.perf-hud'); return e && !e.hidden ? e.textContent : ''; });
    await page.screenshot({ path: path.join(out, '3d-settings.png') });
    check('the theme setting switches the island to dusk', dusk.attr === 'dark' && dusk.dusk, JSON.stringify(dusk));
    check('reduced motion from Settings stops camera shake', reduced.flag && reduced.amp === 0, JSON.stringify(reduced));
    check('F3 shows frame rate and draw calls', /fps/.test(perf) && /draw calls/.test(perf), perf.split('\n')[0]);

    // sound: off on first load; on from Settings (a real click, so the browser allows it)
    const s0 = await page.evaluate(() => AUDIO.stats());
    await page.click('[data-act="set"][data-arg="sound:true"]');
    await page.waitForTimeout(300);
    const s1 = await page.evaluate(async () => {
      for (const b of G.buildings) b.hp = b.maxHp;
      while (RT.phase !== 'countdown') { VIEW.beforeStep(); step(STEP); }
      while (RT.timer > 0.5) { VIEW.beforeStep(); step(STEP); }
      for (let i = 0; i < 600; i++) { VIEW.beforeStep(); step(STEP); AUDIO.update(STEP); if (i % 6 === 0) { VIEW.frame(STEP * 6, 1); await new Promise(res => setTimeout(res, 2)); } }
      return AUDIO.stats();
    });
    check('sound is off until switched on', s0.enabled === false && s0.state === 'none', JSON.stringify(s0));
    check('switching sound on plays the battle: horn, steel, arrows', s1.enabled && s1.state === 'running' && s1.played.horn >= 1 && (s1.played.clink || 0) + (s1.played.shot || 0) > 3, JSON.stringify(s1));

    // everything sticks across a reload, and the game save is untouched by it
    const before = await page.evaluate(() => { saveGame(); return { save: Object.keys(JSON.parse(localStorage.getItem(SAVE_KEY))).sort().join() }; });
    await page.reload(); await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({ quality: SETTINGS.quality, theme: SETTINGS.theme, motion: SETTINGS.motion, sound: SETTINGS.sound, perf: SETTINGS.perfOverlay, save: Object.keys(JSON.parse(localStorage.getItem(SAVE_KEY))).sort().join(), loaded: G.buildings.length > 3 }));
    check('settings are remembered across a reload', after.quality === 'high' && after.theme === 'dark' && after.motion === 'reduce' && after.sound === true && after.perf === true, JSON.stringify(after));
    check('the game save has the same fields as before and still loads', after.save === before.save && after.loaded);
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('auto quality');
  {
    // the real loop runs for ~15 s; auto may change level at most twice and never goes back up after going down
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1000, height: 640 } });
    await page.evaluate(() => { G.paused = false; });
    await page.waitForTimeout(16000);
    const a = await page.evaluate(() => ({ history: VIEW.auto.history, done: VIEW.auto.done, median: VIEW.auto.median, level: VIEW.level, setting: SETTINGS.quality }));
    const L = ['low', 'medium', 'high'], h = a.history.map(x => L.indexOf(x));
    let ok = h.length <= 3, down = false;
    for (let i = 1; i < h.length; i++) { if (h[i] < h[i - 1]) down = true; else if (down) ok = false; }
    check('auto quality settles without flickering', a.setting === 'auto' && ok && a.level === a.history[a.history.length - 1], a.history.join(' -> ') + ' (median frame ' + (a.median || 0).toFixed(1) + ' ms' + (a.done ? ', settled' : '') + ')');
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('waves 1 to 10, rendered as they play');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 760, height: 480 } });
    await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
    await page.evaluate(() => {
      RNG = mulberry32(4321); G.paused = true; VIEW.units.clear();
      window.__w = { classes: ['sword', 'bow', 'pike', 'bow', 'sword', 'pike'], t: 0, nb: 0, kills0: G.stats.kills, deaths: 0, partsOk: true, maxUnits: 0, frames: 0, waves: new Set() };
      // count raider deaths the renderer animates
      const U = VIEW.units, orig = U.sync.bind(U);
      U.sync = (a, dt) => {
        const before = new Set([...U.state.entries()].filter(([, st]) => st.dead).map(([id]) => id));
        orig(a, dt);
        for (const [id, st] of U.state) if (st.dead && !before.has(id) && st.u.side === 1) window.__w.deaths++;
      };
    });
    for (let chunk = 0; chunk < 400; chunk++) {
      const done = await page.evaluate(() => {
        const w = window.__w, U = VIEW.units;
        for (let i = 0; i < 60; i++) {
          if (G.bestWave >= 10) return true;
          VIEW.beforeStep(); step(STEP); w.t += STEP; w.frames++;
          if (w.t >= w.nb) { w.nb = w.t + 1; botAct(w.classes); }
          if (!G.autoAdvance) G.autoAdvance = true;
          w.waves.add(G.wave);
          if (w.frames % 4) continue;
          VIEW.frame(STEP * 4, 1);
          const alive = RT.units.filter(u => u.alive).length;
          w.maxUnits = Math.max(w.maxUnits, alive);
          if (U.arms.n < alive * 2 || U.legs.n < alive * 2 || U.count() < alive) w.partsOk = false;
        }
        return false;
      });
      if (done) break;
      await page.waitForTimeout(10);
    }
    const w = await page.evaluate(() => { const w = window.__w; return { best: G.bestWave, kills: G.stats.kills - w.kills0, deaths: w.deaths, partsOk: w.partsOk, maxUnits: w.maxUnits, minutes: +(w.t / 60).toFixed(1) }; });
    check('waves 1-10 play through', w.best >= 10, 'best wave ' + w.best + ' after ' + w.minutes + ' game minutes');
    check('every live unit drawn throughout', w.partsOk, 'up to ' + w.maxUnits + ' units');
    check('the renderer shows a death for (nearly) every kill', w.deaths >= w.kills * 0.9 && w.deaths <= w.kills, w.deaths + ' animated / ' + w.kills + ' killed');
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  console.log('reduced motion');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof VIEW !== 'undefined' && VIEW && VIEW.rig, null, { timeout: 60000 });
    const r = await page.evaluate(() => { VIEW.rig.shake(0.2); VIEW.rig.idle = 5; return { amp: VIEW.rig.shakeAmp, reduced: VIEW.rig.reducedMotion, nudge: VIEW.rig.nudge(VIEW.rig.goal.x + 20, VIEW.rig.goal.z) }; });
    check('no screen shake when the system asks for reduced motion', r.reduced && r.amp === 0, JSON.stringify(r));
    check('no camera nudge either', r.nudge === false);
    await ctx.close();
  }

  console.log('single-file build (dist/idle-island.html)');
  {
    const dist = path.join(__dirname, '..', 'dist', 'idle-island.html');
    if (fs.existsSync(dist)) {
      const { ctx, page, errors } = await open(browser, { viewport: { width: 1200, height: 760 }, url: 'file://' + dist });
      check('3D renderer active', await page.evaluate(() => VIEW.kind) === '3d');
      await play(page, 5);
      const probe = await page.evaluate(() => VIEW.probe());
      check('canvas is not blank', probe.colors >= 8, JSON.stringify(probe));
      const faces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/["']/g, '') + ' ' + f.weight); });
      check('embedded fonts load', faces.includes('Grenze 700') && faces.includes('Barlow 400'), faces.join(', '));
      check('no errors or network requests', errors.length === 0, errors.slice(0, 3).join(' | '));
      await ctx.close();
    } else console.log('  (skipped: run node tools/build.js first)');
  }

  console.log('classic 2D fallback (?2d)');
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 800 }, query: '?2d' });
    check('2D renderer active', await page.evaluate(() => VIEW.kind) === '2d');
    await page.evaluate(() => { G.paused = true; for (let i = 0; i < 400; i++) step(STEP); VIEW.frame(0.05); });
    await page.screenshot({ path: path.join(out, '2d-fallback.png') });
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
  if (failures.length) { console.log(failures.length + ' check(s) failed'); process.exit(1); }
  console.log('All smoke checks passed. Screenshots in ' + out);
})();
