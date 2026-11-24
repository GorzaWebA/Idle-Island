#!/usr/bin/env node
/*
 * Headless balance check. Loads the real game scripts into a VM and lets a
 * simple greedy bot play for a while, reporting progression milestones.
 *
 *   node tools/balance.js [minutes=60] [runs=3] [sagaLevels=0] [seed]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const minutes = +(process.argv[2] || 60);
const runs = +(process.argv[3] || 3);
const sagaLevels = +(process.argv[4] || 0);
const fixedSeed = process.argv[5] ? +process.argv[5] : null;

const root = path.join(__dirname, '..', 'js');
const files = ['util.js', 'data.js', 'island.js', 'state.js', 'sim.js'];
const code = files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n') + '\n;\n' + fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');

function runOnce(runIdx) {
  const store = {};
  const ctx = {
    console, Math, Date, JSON, Object, Array, Set, Map, Float32Array, Int32Array, Int16Array, Int8Array, Uint8Array,
    isFinite, Number, String, Infinity, NaN, Error,
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    unescape, escape, encodeURIComponent, decodeURIComponent
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'game-bundle.js' });
  return ctx.botRun({ minutes, sagaLevels, seed: fixedSeed ? fixedSeed + runIdx : null });
}

const results = [];
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const r = runOnce(i);
  r.realMs = Date.now() - t0;
  results.push(r);
  console.log(`run ${i + 1}: trait=${r.trait} land=${r.land} beaches=${r.beaches} best=${r.best} wave10@${r.t10 ?? '-'}m wave15@${r.t15 ?? '-'}m wave20@${r.t20 ?? '-'}m losses=${r.losses} hall=${r.hall} squads=${r.squads} gold/s=${r.gps} (${r.realMs} ms)`);
  console.log('   timeline: ' + r.timeline.join(' '));
  if (r.errors.length) console.log('   ERRORS:', r.errors.slice(0, 5));
}
