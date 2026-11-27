#!/usr/bin/env node
/*
 * Performance and memory check for the 3D game (headless Chromium, software WebGL).
 *
 *  1. A wave-20 battle, played for 20 s of game time at 30 frames a second, on:
 *       phone    Pixel 7 emulation, CPU slowed 4x (Chrome's "mid-tier mobile"), Medium quality
 *       desktop  1280x800, full speed, High quality
 *     Reports the JavaScript time per frame (simulation + renderer, including the cost of
 *     handing the frame to WebGL), draw calls, triangles, units on screen and heap growth.
 *  2. Twenty islands in a row (Sail On): the renderer must free each island's geometries and
 *     textures, and the heap must not keep growing.
 *
 * GPU time can't be measured here: the browser draws in software, so real frame rates depend on
 * the device's GPU. The budgets below cover what the code controls.
 *
 *   node tools/perf.js
 * Exit code 1 if anything is over budget.
 */
'use strict';
const path = require('path');
const { chromium, devices } = require('playwright');

const url = 'file://' + path.join(__dirname, '..', 'index.html');
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'];

const BUDGET = {
  phone: { avgMs: 12, p95Ms: 24, calls: 150, tris: 150000, heapMB: 8 },
  desktop: { avgMs: 6, p95Ms: 12, calls: 150, tris: 250000, heapMB: 8 },
  islands: { heapMB: 6, geometries: 3, textures: 1 }
};

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? ' (' + detail + ')' : ''));
  if (!ok) failures.push(name);
}

// Inside the page: build up an island with the bot until wave 20 is reached, then line up a
// wave-20 battle with a few buildings already burning.
function setup(seed) {
  RNG = mulberry32(seed); G.paused = true;
  const classes = ['sword', 'bow', 'pike', 'bow', 'sword', 'pike']; let t = 0, nb = 0;
  while (G.bestWave < 20 && t < 45 * 60) { step(STEP); t += STEP; if (t >= nb) { nb = t + 1; botAct(classes); } if (!G.autoAdvance) G.autoAdvance = true; }
  G.wave = 20; resetRuntime(); VIEW.units.clear();
  while (RT.phase === 'countdown' && RT.timer > 1) step(STEP);
  for (const b of G.buildings) if (b.type !== 'hall' && b.id % 3 === 0) b.hp = b.maxHp * 0.4;
  VIEW.rig.recentre(true);
  for (let i = 0; i < 30; i++) VIEW.frame(1 / 30, 1);
  return { wave: G.wave, buildings: G.buildings.length, squads: G.squads.length, minutes: +(t / 60).toFixed(1) };
}

// Inside the page: 20 s of game time at 30 frames a second, like the real loop.
async function battle() {
  const ms = []; let calls = 0, tris = 0, units = 0, acc = 0;
  gc(); const h0 = performance.memory.usedJSHeapSize;
  for (let i = 0; i < 600; i++) {
    const t0 = performance.now();
    acc += 1 / 30;
    while (acc >= STEP) { VIEW.beforeStep(); step(STEP); acc -= STEP; }
    VIEW.frame(1 / 30, acc / STEP);
    ms.push(performance.now() - t0);
    calls = Math.max(calls, VIEW.lastCalls); tris = Math.max(tris, VIEW.lastTris);
    units = Math.max(units, RT.units.filter(u => u.alive).length);
    if (i % 15 === 14) await new Promise(r => setTimeout(r, 0));     // let the GPU process catch up
  }
  gc(); const h1 = performance.memory.usedJSHeapSize;
  ms.sort((a, b) => a - b);
  return { avg: ms.reduce((a, b) => a + b, 0) / ms.length, p95: ms[Math.floor(ms.length * 0.95)], calls, tris, units, heapMB: (h1 - h0) / 1048576, phase: RT.phase };
}

async function profile(browser, name, ctxOpts, quality, throttle) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + '?quality=' + quality);
  await page.waitForTimeout(1200);
  await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
  const scene = await page.evaluate(setup, 2020);
  const cdp = await ctx.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const r = await page.evaluate(battle);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const B = BUDGET[name];
  console.log(name + ': ' + quality + ' quality' + (throttle > 1 ? ', CPU slowed ' + throttle + 'x' : '') + ', wave ' + scene.wave + ' with ' + scene.buildings + ' buildings and ' + r.units + ' units at most');
  check('JavaScript per frame, average', r.avg <= B.avgMs, r.avg.toFixed(2) + ' ms, budget ' + B.avgMs);
  check('JavaScript per frame, 95th percentile', r.p95 <= B.p95Ms, r.p95.toFixed(2) + ' ms, budget ' + B.p95Ms);
  check('draw calls', r.calls <= B.calls, r.calls + ', budget ' + B.calls);
  check('triangles', r.tris <= B.tris, Math.round(r.tris / 1000) + 'k, budget ' + Math.round(B.tris / 1000) + 'k');
  check('heap growth over the battle', r.heapMB <= B.heapMB, r.heapMB.toFixed(2) + ' MB, budget ' + B.heapMB);
  check('no errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
  return r;
}

async function islands(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + '?quality=high');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async () => {
    const snap = () => { gc(); const m = VIEW.renderer.info.memory; return { heap: performance.memory.usedJSHeapSize, geometries: m.geometries, textures: m.textures }; };
    const out = [];
    G.paused = true;
    for (let i = 0; i < 21; i++) {
      G.bestWave = Math.max(G.bestWave, 12);
      if (!sailOn()) return { error: 'could not sail on' };
      resetRuntime();
      // play a little on each island, rendering, so every system builds its per-island state
      for (let k = 0; k < 200; k++) { VIEW.beforeStep(); step(STEP); if (k % 4 === 0) VIEW.frame(STEP * 4, 1); }
      if (i % 4 === 0) await new Promise(res => setTimeout(res, 10));
      out.push(snap());
    }
    return { first: out[1], last: out[20], traits: G.log.length };
  });
  console.log('twenty islands in a row');
  if (r.error) { check('sail on', false, r.error); return; }
  const dh = (r.last.heap - r.first.heap) / 1048576;
  check('geometries are freed with each island', r.last.geometries - r.first.geometries <= BUDGET.islands.geometries, r.first.geometries + ' -> ' + r.last.geometries);
  check('textures are freed with each island', r.last.textures - r.first.textures <= BUDGET.islands.textures, r.first.textures + ' -> ' + r.last.textures);
  check('the heap does not keep growing', dh <= BUDGET.islands.heapMB, (r.first.heap / 1048576).toFixed(1) + ' -> ' + (r.last.heap / 1048576).toFixed(1) + ' MB');
  check('no errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  await profile(browser, 'phone', Object.assign({}, devices['Pixel 7']), 'medium', 4);
  await profile(browser, 'desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, 'high', 1);
  await islands(browser);
  await browser.close();
  console.log(failures.length ? failures.length + ' check(s) over budget' : 'All performance checks passed.');
  if (failures.length) process.exit(1);
})();
