#!/usr/bin/env node
/*
 * Mobile test: emulates phones and a tablet in headless Chromium (software WebGL) and plays
 * with touch. Checks layout (no sideways scroll, map stays on screen while the panel scrolls),
 * two-tap building, promoting, stationing a squad, the Cancel button, one-finger orbit,
 * pinch zoom, two-finger pan, the zoom and recentre buttons, and touch target sizes.
 * Saves screenshots per device.
 *
 *   node tools/mobile.js [screenshotDir]          (DEVICE="iPhone 13" to run one device)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const DEVICES = process.env.DEVICE ? [process.env.DEVICE] : ['iPhone SE', 'iPhone 13', 'Pixel 7', 'iPhone 13 landscape', 'Pixel 7 landscape', 'iPad Mini'];
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

function check(results, name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

// Page coordinates of a tile's surface centre (camera settled first).
async function tilePoint(page, x, y) {
  const box = await page.locator('#cv').boundingBox();
  const p = await page.evaluate(([x, y]) => { VIEW.rig.settle(); return VIEW.tileToScreen(x, y); }, [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}

// A tile that suits `kind`, is on screen, clear of overlays by a finger's width, and
// either far from units ('far') or nearest the middle of the map ('centre').
async function freeTile(page, kind, prefer) {
  return page.evaluate(([kind, prefer]) => {
    VIEW.rig.settle();
    const canvas = document.getElementById('cv'), cv = canvas.getBoundingClientRect();
    const RING = [[0, 0]]; for (let k = 0; k < 8; k++) RING.push([Math.cos(k * Math.PI / 4) * 30, Math.sin(k * Math.PI / 4) * 30]);
    let best = null, bs = -Infinity;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (kind === 'cottage' ? !canPlaceBasic('cottage', x, y) : !isLandTile(x, y)) continue;
      const s = VIEW.tileToScreen(x, y), px = cv.left + s.x, py = cv.top + s.y;
      if (RING.some(([dx, dy]) => document.elementFromPoint(px + dx, py + dy) !== canvas)) continue;
      const hit = VIEW.pickTile(s.x, s.y);
      if (!hit || hit.x !== x || hit.y !== y) continue;      // something stands in front of it
      let score;
      if (prefer === 'centre') score = -Math.hypot(s.x - cv.width / 2, s.y - cv.height / 2);
      else { let d = 99; for (const u of RT.units) d = Math.min(d, dist(u.x, u.y, x + 0.5, y + 0.5)); score = d; }
      if (score > bs) { bs = score; best = { x, y }; }
    }
    return best;
  }, [kind, prefer || 'far']);
}

async function touches(cdp, frames) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: frames[0] });
  for (let k = 1; k < frames.length; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: frames[k] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const steps = (n, f) => Array.from({ length: n + 1 }, (_, k) => f(k / n));

async function testDevice(browser, name) {
  const results = [];
  const errors = [];
  const ctx = await browser.newContext(Object.assign({}, devices[name]));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(page);
  check(results, '3D renderer active', await page.evaluate(() => VIEW.kind) === '3d');

  // ---- layout ----
  const lay = await page.evaluate(() => {
    VIEW.rig.settle();
    const st = document.getElementById('stage').getBoundingClientRect();
    const pb = document.getElementById('panel-body');
    const b = R3.Terrain.landBounds(), cx = Math.floor(b.cx), cz = Math.floor(b.cz);
    const a = VIEW.tileToScreen(cx, cz), c = VIEW.tileToScreen(cx + 1, cz);
    return {
      vw: innerWidth, vh: innerHeight,
      sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      stage: { top: st.top, bottom: st.bottom, h: st.height, w: st.width },
      panelScrolls: pb.scrollHeight > pb.clientHeight + 4, panelH: pb.clientHeight,
      tile: Math.hypot(c.x - a.x, c.y - a.y)
    };
  });
  check(results, 'no sideways page scroll', lay.sw <= lay.vw + 1, lay.sw + ' vs ' + lay.vw);
  check(results, 'page fits the screen (only the panel scrolls)', lay.sh <= lay.vh + 1, lay.sh + ' vs ' + lay.vh);
  check(results, 'map is on screen and usable', lay.stage.top >= 0 && lay.stage.bottom <= lay.vh + 1 && lay.stage.h >= 180, JSON.stringify(lay.stage));
  check(results, 'panel has room', lay.panelH >= 120, lay.panelH + 'px');
  check(results, 'tiles are tappable at full zoom-out', lay.tile >= 14, lay.tile.toFixed(1) + 'px per tile');
  if (lay.panelScrolls) {
    await page.evaluate(() => { document.getElementById('panel-body').scrollTop = 400; });
    const top = await page.evaluate(() => document.getElementById('stage').getBoundingClientRect().top);
    check(results, 'map stays put while the panel scrolls', Math.abs(top - lay.stage.top) < 1, top);
    await page.evaluate(() => { document.getElementById('panel-body').scrollTop = 0; });
  }

  // ---- two-tap building ----
  await page.tap('[data-act="tab"][data-arg="build"]');
  await page.evaluate(() => { G.gold += 2000; G.timber += 500; });
  await page.tap('[data-act="build"][data-arg="cottage"]');
  await page.waitForTimeout(150);
  const spot = await freeTile(page, 'cottage');
  const before = await page.evaluate(() => D.counts.cottage);
  const pt = await tilePoint(page, spot.x, spot.y);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(150);
  const afterFirst = await page.evaluate(() => ({ n: D.counts.cottage, pending: UI.pending, placing: UI.placing }));
  check(results, 'first tap previews without building', afterFirst.n === before && afterFirst.pending && afterFirst.pending.x === spot.x && afterFirst.pending.y === spot.y, JSON.stringify(afterFirst) + ' spot ' + JSON.stringify(spot));
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(150);
  const afterSecond = await page.evaluate(([x, y]) => ({ n: D.counts.cottage, here: !!buildingAtTile(x, y) }), [spot.x, spot.y]);
  check(results, 'second tap on the same tile builds there', afterSecond.n === before + 1 && afterSecond.here, JSON.stringify(afterSecond));

  // ---- cancel button ----
  await page.tap('[data-act="build"][data-arg="cottage"]');
  await page.waitForTimeout(150);
  const cancelVisible = await page.isVisible('#mode-cancel');
  if (cancelVisible) await page.tap('#mode-cancel');
  check(results, 'Cancel button leaves build mode', cancelVisible && await page.evaluate(() => UI.placing) === null);

  // ---- promote and station a squad ----
  await page.tap('[data-act="tab"][data-arg="squads"]');
  await page.waitForTimeout(250);
  await page.tap('[data-act="promote"][data-arg$=":bow"]');
  check(results, 'promote by tap', await page.evaluate(() => G.squads[0].cls) === 'bow');
  await page.tap('[data-act="sq-station"]');
  await page.waitForTimeout(150);
  const holdSpot = await freeTile(page, 'land');
  const hp = await tilePoint(page, holdSpot.x, holdSpot.y);
  await page.touchscreen.tap(hp.x, hp.y);
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({ mode: G.squads[0].mode, hold: G.squads[0].hold }));
  check(results, 'station a squad by tapping a tile', held.mode === 'hold' && held.hold && held.hold.x === holdSpot.x && held.hold.y === holdSpot.y, JSON.stringify(held) + ' spot ' + JSON.stringify(holdSpot));

  // ---- gestures, with build mode on so stray taps would show up ----
  await page.tap('[data-act="tab"][data-arg="build"]');
  await page.tap('[data-act="build"][data-arg="cottage"]');
  await page.waitForTimeout(150);
  const n0 = await page.evaluate(() => D.counts.cottage);
  const box = await page.locator('#cv').boundingBox();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cam = () => page.evaluate(() => ({ yaw: VIEW.rig.gYaw, pitch: VIEW.rig.gPitch, dist: VIEW.rig.gDist, tx: VIEW.rig.goal.x, tz: VIEW.rig.goal.z, pending: UI.pending, n: D.counts.cottage }));
  const c0 = await cam();
  await touches(cdp, steps(10, t => [{ x: c.x - box.width * 0.2 * t, y: c.y, id: 1 }]));
  const c1 = await cam();
  check(results, 'one-finger drag orbits', Math.abs(c1.yaw - c0.yaw) > 0.3, (c1.yaw - c0.yaw).toFixed(2) + ' rad');
  const spread = Math.min(box.width, box.height) * 0.3;
  await touches(cdp, steps(12, t => [{ x: c.x - 25 - spread * t, y: c.y, id: 1 }, { x: c.x + 25 + spread * t, y: c.y, id: 2 }]));
  const c2 = await cam();
  check(results, 'pinch zooms in', c2.dist < c1.dist * 0.8, c1.dist.toFixed(1) + ' -> ' + c2.dist.toFixed(1));
  await touches(cdp, steps(10, t => [{ x: c.x - 40 + 60 * t, y: c.y - 30 * t, id: 1 }, { x: c.x + 40 + 60 * t, y: c.y - 30 * t, id: 2 }]));
  const c3 = await cam();
  check(results, 'two-finger drag pans', Math.hypot(c3.tx - c2.tx, c3.tz - c2.tz) > 0.3 && Math.abs(c3.dist - c2.dist) < c2.dist * 0.1, 'moved ' + Math.hypot(c3.tx - c2.tx, c3.tz - c2.tz).toFixed(2));
  check(results, 'gestures never build or preview by accident', c3.n === n0 && !c3.pending);
  // a two-tap build still lands on the right tile while zoomed and rotated
  const spot2 = await freeTile(page, 'cottage', 'centre');
  if (spot2) {
    const p2 = await tilePoint(page, spot2.x, spot2.y);
    await page.touchscreen.tap(p2.x, p2.y); await page.waitForTimeout(100);
    await page.touchscreen.tap(p2.x, p2.y); await page.waitForTimeout(150);
    const r = await page.evaluate(([x, y]) => ({ n: D.counts.cottage, here: !!buildingAtTile(x, y) }), [spot2.x, spot2.y]);
    check(results, 'building while zoomed and rotated hits the right tile', r.n === n0 + 1 && r.here, JSON.stringify(r));
  } else check(results, 'building while zoomed and rotated hits the right tile', false, 'no free tile in view');
  await page.evaluate(() => { UI.placing = null; UI.pending = null; VIEW.rig.settle(); VIEW.frame(0.016, 1); });
  await page.screenshot({ path: path.join(out, 'mobile-' + name.replace(/\s+/g, '-').toLowerCase() + '-zoomed.png') });

  // ---- buttons ----
  const d0 = (await cam()).dist;
  await page.tap('#zoom-out');
  const d1 = (await cam()).dist;
  check(results, 'zoom-out button', d1 > d0 * 1.2, d0.toFixed(1) + ' -> ' + d1.toFixed(1));
  await page.tap('#zoom-in');
  const d2 = (await cam()).dist;
  check(results, 'zoom-in button', d2 < d1 * 0.8, d1.toFixed(1) + ' -> ' + d2.toFixed(1));
  await page.tap('#recentre');
  const rc = await page.evaluate(() => ({ dist: VIEW.rig.gDist, fit: VIEW.rig.fitDist, pitch: VIEW.rig.gPitch }));
  check(results, 'recentre shows the whole island', Math.abs(rc.dist - rc.fit) < 0.01 && Math.abs(rc.pitch - 0.9) < 0.01);

  // ---- touch target sizes ----
  const small = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[hidden]')) continue;
      if (r.height < 34 || r.width < 34) bad.push((el.id || el.textContent.trim().slice(0, 18)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return bad;
  });
  check(results, 'touch targets at least 34px', small.length === 0, small.join(', '));

  // ---- Settings tab on a phone ----
  await page.tap('#tab-settings');
  await page.waitForTimeout(250);
  const setSmall = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#panel-body button')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.height < 34 || r.width < 34)) bad.push(el.textContent.trim() + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return bad;
  });
  const lowBtn = page.locator('[data-act="set"][data-arg="quality:low"]');
  await lowBtn.scrollIntoViewIfNeeded();
  await lowBtn.tap();
  await page.waitForTimeout(200);
  const lv = await page.evaluate(() => ({ level: VIEW.level, shadows: VIEW.renderer.shadowMap.enabled }));
  check(results, 'Settings tab: finger-sized choices, and Low quality applies', setSmall.length === 0 && lv.level === 'low' && !lv.shadows, setSmall.join(', ') + ' ' + JSON.stringify(lv));
  if (name === DEVICES[0]) await page.screenshot({ path: path.join(out, 'mobile-settings.png') });

  await page.evaluate(() => { UI.tab = 'squads'; UI.selSq = null; renderPanel(); VIEW.rig.settle(); VIEW.frame(0.016, 1); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, 'mobile-' + name.replace(/\s+/g, '-').toLowerCase() + '.png') });
  // ---- the title menu on this device ----
  await page.goto(url + '?menu');
  await page.waitForTimeout(1500);
  const mn = await page.evaluate(() => {
    const card = document.getElementById('menu-card').getBoundingClientRect(), small = [];
    for (const el of document.querySelectorAll('#menu-card button')) { const r = el.getBoundingClientRect(); if (r.height < 34 || r.width < 34) small.push(el.textContent.trim()); }
    return { open: UI.menu, fits: card.top >= 0 && card.bottom <= innerHeight + 1 && card.left >= 0 && card.right <= innerWidth + 1, small };
  });
  if (name === DEVICES[0]) await page.screenshot({ path: path.join(out, 'mobile-menu.png') });
  await page.tap('.menu-primary');
  await page.waitForTimeout(400);
  const playing = await page.evaluate(() => !UI.menu && getComputedStyle(document.querySelector('.topbar')).display !== 'none');
  check(results, 'title menu fits, has finger-sized buttons, and Continue starts the game', mn.open && mn.fits && !mn.small.length && playing, JSON.stringify(mn) + ' playing ' + playing);

  check(results, 'no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  return results;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: GL_ARGS });
  let failed = 0;
  for (const name of DEVICES) {
    const results = await testDevice(browser, name);
    const bad = results.filter(r => !r.ok);
    failed += bad.length;
    console.log((bad.length ? '✗ ' : '✓ ') + name + ' (' + (results.length - bad.length) + '/' + results.length + ')');
    for (const r of results) if (!r.ok) console.log('    FAIL ' + r.name + (r.detail ? ': ' + r.detail : ''));
  }
  await browser.close();
  console.log(failed ? failed + ' check(s) failed' : 'All mobile checks passed. Screenshots in ' + out);
  process.exit(failed ? 1 : 0);
})();
