#!/usr/bin/env node
/*
 * Captures the README / social images from the real game:
 *   assets/banner.png              wide hero image with the title
 *   assets/og.png                  1200x630 link-preview image
 *   assets/screenshot-desktop.png  full interface mid-battle
 *   assets/screenshot-phone.png    phone layout
 *   assets/battle.gif              short animated battle clip (needs ffmpeg)
 *
 *   node tools/screenshots.js [islandSeed] [botMinutes]
 *   ONLY=gif,phone node tools/screenshots.js      (just some of them)
 *
 * The bot (tools/bot.js) builds up a settlement first, so the shots show a lived-in island.
 * Shots use the 3D view at High quality, drawn in software WebGL (headless Chromium).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'assets');
const seed = +(process.argv[2] || 1337);
const minutes = +(process.argv[3] || 13);
// The 3D game at High quality (software WebGL in headless Chromium: slow, but faithful).
const url = 'file://' + path.join(root, 'index.html') + '?quality=high';
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// Plays the island up to a busy moment in battle. Runs inside the page.
function setupScene(opts) {
  RNG = mulberry32(opts.seed);
  G = null;
  newGame();
  G.island.seed = opts.seed;
  G.island.trait = opts.trait;
  setupIsland();
  resetRuntime();
  G.paused = true;
  const classes = ['sword', 'bow', 'pike', 'bow', 'sword', 'pike'];
  let t = 0, nb = 0;
  while (t < opts.minutes * 60) {
    step(STEP); t += STEP;
    if (t >= nb) { nb = t + 1; botAct(classes); }
    if (!G.autoAdvance) G.autoAdvance = true;
  }
  // A few palisades across the busiest approach, for show.
  G.gold += 400; G.timber += 400; recalc();
  const h = MAP.hall;
  let placed = 0;
  for (const l of MAP.landings) {
    const dx = Math.sign(h.x - l.x), dy = Math.sign(h.y - l.y);
    for (const k of [2, 3]) {
      if (placed >= 6) break;
      if (placeBuilding('palisade', l.x + dx * k, l.y + dy * k).ok) placed++;
    }
  }
  // Wait for a battle with plenty of raiders ashore.
  let guard = 0;
  for (;;) {
    step(STEP);
    if (++guard > 20 * 600) break;
    if (RT.phase !== 'battle') continue;
    const ashore = RT.units.filter(u => u.side === 1 && u.alive).length;
    if (RT.battleT > opts.battleT && ashore >= opts.minRaiders) break;
  }
  RT.boats = RT.boats.filter(b => b.state !== 'leave');
  // a couple of houses on fire near the raiders, for atmosphere
  if (opts.burn) {
    const raiders = RT.units.filter(u => u.side === 1 && u.alive);
    const near = G.buildings.filter(b => b.type === 'cottage' || b.type === 'lumber')
      .sort((a, b) => Math.min(...raiders.map(u => Math.hypot(u.x - a.x, u.y - a.y))) - Math.min(...raiders.map(u => Math.hypot(u.x - b.x, u.y - b.y))));
    near.slice(0, opts.burn).forEach((b, i) => { b.hp = b.maxHp * (i ? 0.45 : 0.2); });
  }
  UI.tab = 'squads'; UI.selB = null; UI.placing = null; UI.hover = null;
  if (opts.unpause) { G.paused = false; G.speed = 1; }
  renderPanel();
  return { wave: G.wave, trait: G.island.trait, raiders: RT.units.filter(u => u.side === 1).length, squads: G.squads.length };
}

const STAGE_ONLY = `
  .topbar, .panel { display: none !important; }
  #app { height: 100vh !important; display: block !important; }
  .layout { display: block !important; height: 100vh !important; }
  .stage { height: 100vh !important; aspect-ratio: auto !important; max-height: none !important; }
  .stage-banner, .stage-mode, .stage-hover, .stage-paused, .stage-zoom, .hud, .floaters, .ghost-chip, .perf-hud { display: none !important; }
  .stage.is-3d::after { display: none !important; }
  .title-card { position: absolute; z-index: 5; display: flex; flex-direction: column; gap: 10px; color: #f4ecd8; pointer-events: none; }
  .title-card h1 { margin: 0; font: 700 96px/0.9 'Grenze', Georgia, serif; letter-spacing: 0.005em; text-shadow: 0 3px 0 rgba(0,0,0,0.25); }
  .title-card p { margin: 0; font: 500 24px/1.3 'Barlow', system-ui, sans-serif; color: #d9e6e6; max-width: 26ch; }
  .title-card .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  .title-card .tags span { font: 600 14px 'Barlow', system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid rgba(244,236,216,0.45); border-radius: 999px; padding: 5px 12px; color: #f3cf74; }
  .veil { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
`;

// Point the 3D camera: centre on (x, z), distance as a share of the whole-island view, and slide
// the island sideways on screen by `shift` (a share of the view width) to make room for a title.
function aim(o) {
  const r = VIEW.rig;
  VIEW.resize(); r.computeFit();
  r.gYaw = o.yaw || 0; r.gPitch = o.pitch || 0.9; r.gDist = r.fitDist * (o.dist || 1);
  const b = R3.Terrain.landBounds();
  let x = o.x !== undefined ? o.x : b.cx, z = o.z !== undefined ? o.z : b.cz;
  if (o.shift) {
    const w = 2 * r.gDist * Math.tan(VIEW.camera.fov * Math.PI / 360) * VIEW.camera.aspect;
    x -= Math.cos(r.gYaw) * w * o.shift; z += Math.sin(r.gYaw) * w * o.shift;
  }
  r.goal.set(x, 0.3, z); r.settle();
  for (let i = 0; i < 3; i++) VIEW.frame(0.05, 1);
}
// Let effects (smoke, fire, wakes) build up without moving the battle on.
function settleEffects(n) { for (let i = 0; i < n; i++) VIEW.frame(0.05, 1); }

async function stageShot(browser, opts) {
  const ctx = await browser.newContext({ viewport: opts.viewport, deviceScaleFactor: opts.dsf || 2, colorScheme: opts.scheme || 'dark' });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
  await page.addStyleTag({ content: STAGE_ONLY });
  await page.evaluate(() => setSetting('healthBars', false));
  const info = await page.evaluate(setupScene, { seed, minutes, trait: opts.trait || 'fertile', battleT: opts.battleT || 5, minRaiders: 12, burn: 2 });
  await page.evaluate(([aimSrc, settleSrc, o]) => {
    const aim = new Function('return ' + aimSrc)(), settle = new Function('return ' + settleSrc)();
    aim(o.cam); settle(40);
    const stage = document.getElementById('stage');
    if (o.title) {
      const veil = document.createElement('div'); veil.className = 'veil';
      veil.style.background = o.veil;
      stage.appendChild(veil);
      const card = document.createElement('div'); card.className = 'title-card';
      Object.assign(card.style, o.cardStyle);
      card.innerHTML = '<h1>Idle Island</h1><p>Hold the isle. The longboats are coming.</p>' +
        '<div class="tags"><span>Idle</span><span>Base defence</span><span>Browser</span></div>';
      if (o.small) { card.querySelector('h1').style.fontSize = '80px'; card.querySelector('p').style.fontSize = '22px'; }
      stage.appendChild(card);
    }
    VIEW.frame(0.016, 1);
  }, [aim.toString(), settleEffects.toString(), opts]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, opts.file) });
  await ctx.close();
  return info;
}

async function uiShot(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ colorScheme: opts.scheme || 'light' }, opts.device ? opts.device : { viewport: opts.viewport, deviceScaleFactor: opts.dsf || 2 }));
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
  await page.addStyleTag({ content: '.stage-paused { display: none !important; }' });
  await page.evaluate(setupScene, { seed, minutes, trait: opts.trait || 'fertile', battleT: 6, minRaiders: 10, burn: 1 });
  await page.evaluate(([aimSrc, settleSrc, o]) => {
    const aim = new Function('return ' + aimSrc)(), settle = new Function('return ' + settleSrc)();
    UI.tab = o.tab; renderPanel(); updateHeader();
    aim(o.cam || {}); settle(30);
    VIEW.frame(0.016, 1); updateHeader();
  }, [aim.toString(), settleEffects.toString(), opts]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, opts.file), fullPage: !!opts.fullPage });
  await ctx.close();
}

async function gif(browser) {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-island-frames-'));
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
  await page.addStyleTag({ content: STAGE_ONLY });
  await page.evaluate(setupScene, { seed, minutes, trait: 'fertile', battleT: 0.5, minRaiders: 1, burn: 1 });
  // a still camera close on the fighting: mostly land in frame, so frames differ only where
  // things move (an orbiting camera or a lot of animated sea makes the GIF huge)
  await page.evaluate(([aimSrc, settleSrc]) => {
    const aim = new Function('return ' + aimSrc)(), settle = new Function('return ' + settleSrc)();
    setSetting('healthBars', false);
    const rs = RT.units.filter(u => u.side === 1 && u.alive), h = MAP.hall;
    const x = rs.length ? (rs.reduce((a, u) => a + u.x, 0) / rs.length * 0.4 + (h.x + 0.5) * 0.6) : h.x + 0.5;
    const z = rs.length ? (rs.reduce((a, u) => a + u.y, 0) / rs.length * 0.4 + (h.y + 0.5) * 0.6) : h.y + 0.5;
    aim({ x, z, yaw: 0.35, pitch: 0.86, dist: 0.36 }); settle(20);
  }, [aim.toString(), settleEffects.toString()]);
  const n = 72;
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => { for (let k = 0; k < 2; k++) { VIEW.beforeStep(); step(STEP); } VIEW.frame(0.1, 1); });
    await page.locator('#cv').screenshot({ path: path.join(frames, 'f' + String(i).padStart(3, '0') + '.png') });
  }
  await ctx.close();
  const out = path.join(outDir, 'battle.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '12', '-i', path.join(frames, 'f%03d.png'),
    '-vf', 'scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', out]);
  fs.rmSync(frames, { recursive: true, force: true });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: GL_ARGS });
  // ONLY=banner,og,desktop,phone,gif redoes just those
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null, want = k => !only || only.includes(k);
  if (want('banner')) await stageShot(browser, {
    file: 'banner.png', viewport: { width: 1280, height: 480 }, title: true, cam: { dist: 0.74, pitch: 0.8, yaw: 0.3, shift: 0.2 },
    veil: 'linear-gradient(90deg, rgba(14,34,42,0.92) 0%, rgba(14,34,42,0.62) 26%, rgba(14,34,42,0) 46%)',
    cardStyle: { left: '56px', top: '50%', transform: 'translateY(-50%)' }
  });
  if (want('og')) await stageShot(browser, {
    file: 'og.png', viewport: { width: 1200, height: 630 }, dsf: 1, title: true, small: true, cam: { dist: 0.8, pitch: 0.84, yaw: 0.3, shift: 0.19 },
    veil: 'linear-gradient(90deg, rgba(14,34,42,0.92) 0%, rgba(14,34,42,0.62) 28%, rgba(14,34,42,0) 50%)',
    cardStyle: { left: '52px', top: '50%', transform: 'translateY(-50%)' }
  });
  if (want('desktop')) await uiShot(browser, { file: 'screenshot-desktop.png', viewport: { width: 1440, height: 860 }, tab: 'squads', cam: { dist: 0.72, pitch: 0.86, yaw: 0.2 } });
  if (want('phone')) await uiShot(browser, { file: 'screenshot-phone.png', device: devices['Pixel 7'], tab: 'squads', scheme: 'dark', cam: { dist: 0.62, pitch: 0.9 } });
  if (want('gif')) { try { await gif(browser); } catch (e) { console.log('GIF skipped: ' + e.message); } }
  await browser.close();
  // Shrink the PNGs to 256-colour palettes; the flat art survives it well.
  for (const f of ['banner.png', 'og.png', 'screenshot-desktop.png', 'screenshot-phone.png'].filter(f => want({ 'banner.png': 'banner', 'og.png': 'og', 'screenshot-desktop.png': 'desktop', 'screenshot-phone.png': 'phone' }[f]))) {
    const src = path.join(outDir, f), tmp = src + '.tmp.png';
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf',
        'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=floyd_steinberg', tmp]);
      if (fs.statSync(tmp).size < fs.statSync(src).size) fs.renameSync(tmp, src); else fs.rmSync(tmp);
    } catch (e) { fs.rmSync(tmp, { force: true }); console.log('PNG shrink skipped for ' + f); }
  }
  for (const f of fs.readdirSync(outDir)) console.log(f, Math.round(fs.statSync(path.join(outDir, f)).size / 1024) + ' KB');
})();
