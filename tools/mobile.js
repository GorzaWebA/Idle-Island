#!/usr/bin/env node
/*
 * Mobile test: emulates phones and a tablet in headless Chromium and plays with touch.
 * Checks layout (no sideways scroll, map stays on screen while the panel scrolls),
 * two-tap building, promoting, stationing a squad, the Cancel button, pinch zoom,
 * drag panning, and touch target sizes. Saves a screenshot per device.
 *
 *   node tools/mobile.js [screenshotDir]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const DEVICES = process.env.DEVICE ? [process.env.DEVICE] : ['iPhone SE', 'iPhone 13', 'Pixel 7', 'iPhone 13 landscape', 'Pixel 7 landscape', 'iPad Mini'];

function check(results, name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

// Screen position (CSS px, page coordinates) of a tile's top face centre.
async function tilePoint(page, x, y) {
  const box = await page.locator('#cv').boundingBox();
  const p = await page.evaluate(([x, y]) => {
    const h = VH[tileType(x, y)];
    return { x: R.ox + (x + 0.5) * R.T, y: R.oy + y * R.TH - h * R.HZ + R.TH * 0.5 };
  }, [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}

// Picks a tile for `ok(x, y)` that is far from units and not covered by an overlay.
async function freeTile(page, kind) {
  return page.evaluate(kind => {
    const cv = document.getElementById('cv').getBoundingClientRect();
    const RING = [[0, 0]]; for (let k = 0; k < 8; k++) RING.push([Math.cos(k * Math.PI / 4) * 30, Math.sin(k * Math.PI / 4) * 30]);
    let best = null, bs = -1;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (kind === 'cottage' ? !canPlaceBasic('cottage', x, y) : !isLandTile(x, y)) continue;
      const h = VH[tileType(x, y)];
      const px = cv.left + R.ox + (x + 0.5) * R.T, py = cv.top + R.oy + y * R.TH - h * R.HZ + R.TH * 0.5;
      // Keep a finger's width away from any button or overlay on the map.
      const canvas = document.getElementById('cv');
      if (RING.some(([dx, dy]) => document.elementFromPoint(px + dx, py + dy) !== canvas)) continue;
      let d = 99; for (const u of RT.units) d = Math.min(d, dist(u.x, u.y, x + 0.5, y + 0.5));
      if (d > bs) { bs = d; best = { x, y }; }
    }
    return best;
  }, kind);
}

async function touchDrag(cdp, from, to, steps) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinch(cdp, c, from, to, steps) {
  const pts = r => [{ x: c.x - r, y: c.y, id: 1 }, { x: c.x + r, y: c.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let k = 1; k <= steps; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * k / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function testDevice(browser, name) {
  const results = [];
  const errors = [];
  const ctx = await browser.newContext(Object.assign({}, devices[name]));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(700);
  const cdp = await ctx.newCDPSession(page);

  // ---- layout ----
  const lay = await page.evaluate(() => {
    const st = document.getElementById('stage').getBoundingClientRect();
    const pb = document.getElementById('panel-body');
    return {
      vw: innerWidth, vh: innerHeight,
      sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      stage: { top: st.top, bottom: st.bottom, h: st.height, w: st.width },
      panelScrolls: pb.scrollHeight > pb.clientHeight + 4, panelH: pb.clientHeight,
      island: { T: R.T }
    };
  });
  check(results, 'no sideways page scroll', lay.sw <= lay.vw + 1, lay.sw + ' vs ' + lay.vw);
  check(results, 'page fits the screen (only the panel scrolls)', lay.sh <= lay.vh + 1, lay.sh + ' vs ' + lay.vh);
  check(results, 'map is on screen and usable', lay.stage.top >= 0 && lay.stage.bottom <= lay.vh + 1 && lay.stage.h >= 180, JSON.stringify(lay.stage));
  check(results, 'panel has room', lay.panelH >= 120, lay.panelH + 'px');
  check(results, 'tiles are tappable at full zoom-out', lay.island.T >= 15, lay.island.T.toFixed(1) + 'px per tile');
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
  await page.waitForTimeout(120);  // let the mode bar (with its Cancel button) appear first
  const spot = await freeTile(page, 'cottage');
  const before = await page.evaluate(() => D.counts.cottage);
  const pt = await tilePoint(page, spot.x, spot.y);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(150);
  const afterFirst = await page.evaluate(() => ({ n: D.counts.cottage, pending: UI.pending, placing: UI.placing, mode: document.getElementById('mode-text').textContent }));
  check(results, 'first tap previews without building', afterFirst.n === before && afterFirst.pending && afterFirst.pending.x === spot.x, JSON.stringify(afterFirst) + ' spot ' + JSON.stringify(spot) + ' at ' + JSON.stringify(pt));
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(150);
  const afterSecond = await page.evaluate(() => D.counts.cottage);
  check(results, 'second tap on the same tile builds', afterSecond === before + 1, before + ' -> ' + afterSecond);

  // ---- cancel button ----
  await page.tap('[data-act="build"][data-arg="cottage"]');
  await page.waitForTimeout(100);
  const cancelVisible = await page.isVisible('#mode-cancel');
  if (cancelVisible) await page.tap('#mode-cancel');
  const placingAfter = await page.evaluate(() => UI.placing);
  check(results, 'Cancel button leaves build mode', cancelVisible && placingAfter === null);

  // ---- promote and station a squad ----
  await page.tap('[data-act="tab"][data-arg="squads"]');
  await page.waitForTimeout(250);
  await page.tap('[data-act="promote"][data-arg$=":bow"]');
  const cls = await page.evaluate(() => G.squads[0].cls);
  check(results, 'promote by tap', cls === 'bow', cls);
  await page.tap('[data-act="sq-station"]');
  await page.waitForTimeout(120);
  const holdSpot = await freeTile(page, 'land');
  const hp = await tilePoint(page, holdSpot.x, holdSpot.y);
  await page.touchscreen.tap(hp.x, hp.y);
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({ mode: G.squads[0].mode, hold: G.squads[0].hold, sel: UI.selSq, text: document.getElementById('mode-text').textContent }));
  check(results, 'station a squad by tapping a tile', held.mode === 'hold' && held.hold && held.hold.x === holdSpot.x && held.hold.y === holdSpot.y, JSON.stringify(held) + ' spot ' + JSON.stringify(holdSpot) + ' at ' + JSON.stringify(hp));

  // ---- pinch, pan, zoom buttons (with build mode on, to catch stray taps) ----
  await page.tap('[data-act="tab"][data-arg="build"]');
  await page.tap('[data-act="build"][data-arg="cottage"]');
  await page.waitForTimeout(120);
  const n0 = await page.evaluate(() => D.counts.cottage);
  const box = await page.locator('#cv').boundingBox();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await pinch(cdp, c, 30, 30 + Math.min(box.width, box.height) * 0.35, 12);
  await page.waitForTimeout(100);
  const z1 = await page.evaluate(() => ({ z: R.zoom, cam: R.camX }));
  check(results, 'pinch zooms in', z1.z > 1.3, z1.z.toFixed(2) + 'x');
  await touchDrag(cdp, { x: c.x, y: c.y }, { x: c.x + box.width * 0.25, y: c.y + 10 }, 10);
  await page.waitForTimeout(100);
  const z2 = await page.evaluate(() => ({ z: R.zoom, cam: R.camX, pending: UI.pending, n: D.counts.cottage }));
  check(results, 'one-finger drag pans the zoomed map', Math.abs(z2.cam - z1.cam) > 0.3, 'camX ' + z1.cam.toFixed(2) + ' -> ' + z2.cam.toFixed(2));
  check(results, 'gestures never build or preview by accident', z2.n === n0 && !z2.pending);
  // a tap still works while zoomed
  const spot2 = await page.evaluate(() => {
    const cx = R.w / 2, cy = R.h / 2;
    let best = null, bd = 1e9;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (!canPlaceBasic('cottage', x, y)) continue;
      const h = VH[tileType(x, y)];
      const px = R.ox + (x + 0.5) * R.T, py = R.oy + y * R.TH - h * R.HZ + R.TH * 0.5;
      const cv = document.getElementById('cv').getBoundingClientRect(), canvas = document.getElementById('cv');
      const RING = [[0, 0]]; for (let k = 0; k < 8; k++) RING.push([Math.cos(k * Math.PI / 4) * 30, Math.sin(k * Math.PI / 4) * 30]);
      if (RING.some(([dx, dy]) => document.elementFromPoint(cv.left + px + dx, cv.top + py + dy) !== canvas)) continue;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  });
  if (spot2) {
    const p2 = await tilePoint(page, spot2.x, spot2.y);
    await page.touchscreen.tap(p2.x, p2.y); await page.waitForTimeout(80);
    await page.touchscreen.tap(p2.x, p2.y); await page.waitForTimeout(120);
    const n3 = await page.evaluate(() => D.counts.cottage);
    check(results, 'building while zoomed hits the right tile', n3 === n0 + 1 && await page.evaluate(([x, y]) => !!buildingAtTile(x, y), [spot2.x, spot2.y]));
  } else check(results, 'building while zoomed hits the right tile', false, 'no free tile in view');
  await page.evaluate(() => { UI.placing = null; UI.pending = null; });
  await page.screenshot({ path: path.join(out, 'mobile-' + name.replace(/\s+/g, '-').toLowerCase() + '-zoomed.png') });
  for (let k = 0; k < 6 && await page.evaluate(() => R.zoom > 1); k++) await page.tap('#zoom-out');
  const z3 = await page.evaluate(() => R.zoom);
  check(results, 'zoom-out button returns to the whole island', z3 === 1, z3);
  await page.tap('#zoom-in');
  const z4 = await page.evaluate(() => R.zoom);
  check(results, 'zoom-in button', z4 > 1.2, z4);
  await page.tap('#zoom-out');

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

  await page.evaluate(() => { UI.tab = 'squads'; UI.selSq = null; renderPanel(); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, 'mobile-' + name.replace(/\s+/g, '-').toLowerCase() + '.png') });
  check(results, 'no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  return results;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
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
