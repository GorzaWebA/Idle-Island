#!/usr/bin/env node
/*
 * Browser smoke test for the 3D game (headless Chromium, software WebGL).
 *  - loads the game, plays 30 s of game time while rendering, checks for console errors
 *  - checks the canvas isn't blank, builds a cottage by clicking its tile,
 *    orbits with the mouse, zooms with the wheel, rotates with Q, recentres
 *  - a dark-theme battle, and the classic 2D fallback (?2d)
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
    check('longboats row in', r.boatsSeen > 0 && r.oars >= 8, r.boatsSeen + ' boats, ' + r.oars + ' oars');
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
    const r = await page.evaluate(() => { VIEW.rig.shake(0.2); return { amp: VIEW.rig.shakeAmp, reduced: VIEW.rig.reducedMotion }; });
    check('no screen shake when the system asks for reduced motion', r.reduced && r.amp === 0, JSON.stringify(r));
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
