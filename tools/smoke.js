#!/usr/bin/env node
/* Browser smoke test: loads the game, plays a little, reports console errors and saves screenshots. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'screenshots');
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function run(name, viewport, scheme, fn) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(name + ': ' + e.message));
    await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
    await page.waitForTimeout(800);
    if (fn) await fn(page);
    require('fs').mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, name + '.png') });
    await ctx.close();
  }
  await run('desktop-light', { width: 1400, height: 860 }, 'light', async page => {
    // fast-forward: run the sim headlessly inside the page
    await page.evaluate(() => {
      G.gold += 2000; G.timber += 800;
      for (let i = 0; i < 20 * 50; i++) step(STEP);
    });
    await page.click('[data-act="build"][data-arg="cottage"]');
    const box = await page.locator('#cv').boundingBox();
    // try a few tiles until one builds
    for (let k = 0; k < 40; k++) {
      const ok = await page.evaluate(() => UI.placing === null);
      if (ok) break;
      await page.mouse.click(box.x + box.width * (0.35 + (k % 8) * 0.04), box.y + box.height * (0.35 + Math.floor(k / 8) * 0.06));
    }
    await page.click('[data-act="tab"][data-arg="squads"]');
    await page.waitForTimeout(300);
    const promote = page.locator('[data-act="promote"]').first();
    if (await promote.count()) await promote.click();
    await page.evaluate(() => { for (let i = 0; i < 20 * 40; i++) step(STEP); });
    await page.waitForTimeout(400);
  });
  await run('desktop-dark-battle', { width: 1280, height: 800 }, 'dark', async page => {
    await page.evaluate(() => {
      G.gold += 5000; G.timber += 3000;
      promoteSquad(G.squads[0], 'sword');
      for (let i = 0; i < 20 * 29; i++) step(STEP);
    });
    await page.click('[data-act="tab"][data-arg="squads"]');
    await page.waitForTimeout(500);
  });
  await run('phone', { width: 390, height: 844 }, 'light', async page => {
    await page.evaluate(() => { for (let i = 0; i < 20 * 25; i++) step(STEP); });
  });
  await browser.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('OK, screenshots in ' + out);
})();
