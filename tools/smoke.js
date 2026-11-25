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
    const built = await page.evaluate(([x, y]) => { const b = buildingAtTile(x, y); return { n: D.counts.cottage, type: b && b.type, meshes: VIEW.buildings.meshes.size }; }, [spot.x, spot.y]);
    check('click builds a cottage on that tile', built.n === before + 1 && built.type === 'cottage', JSON.stringify(built));
    await page.screenshot({ path: path.join(out, '3d-desktop.png') });

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
    const probe = await page.evaluate(() => ({ p: VIEW.probe(), raiders: RT.units.filter(u => u.side === 1).length, inst: VIEW.units.mesh.count }));
    check('battle renders units', probe.inst >= probe.raiders && probe.raiders > 0, JSON.stringify(probe));
    await page.screenshot({ path: path.join(out, '3d-dark-battle.png') });
    check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
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
