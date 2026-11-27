'use strict';
/* Buildings: every model variant (type x tier, ruins, palisade shapes) is one InstancedMesh,
   so a whole settlement costs a handful of draw calls.
   Per building the renderer keeps its own state (never the sim's):
     construction (springs up with a bounce and dust), tier-up pop, hit flash, collapse to a
     ruin, chimney smoke, flags and a sawing saw.
   Fire follows damage: a hurt building blackens, then burns harder the lower its health, with
   a smoke column, embers and firelight on the ground. A fresh ruin burns fiercely, dies down
   to a smoulder, and only clears once it is being rebuilt. At dusk, doors and windows glow. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const UP = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Color(1, 1, 1);
  const BUILD_TIME = 0.7;
  const BURN_FROM = 0.3;       // fire starts once a building has lost this share of its health
  const RUIN_BURN = 12;        // seconds a ruin keeps burning before it smoulders
  const FIRE = 0xffe08a, FIRE_END = 0xe0401a, EMBER = 0xffa040, EMBER_END = 0xff4a10, GLOW = 0xff7a2a;
  const SMOKE_DARK = 0x2f2b28, SMOKE_GREY = 0x7a746c, WINDOW = 0xffb45a;
  const rnd = Math.random;

  function easeOutBack(k) { const c1 = 1.70158, c3 = c1 + 1, t = k - 1; return 1 + c3 * t * t * t + c1 * t * t; }
  // Quarter-turn variety for small buildings; the Hall, towers and walls stay square to the map.
  function rotFor(type, x, y) {
    if (type === 'hall' || type === 'tower' || type === 'palisade') return 0;
    return Math.floor(R3.hash3(x, (MAP ? MAP.seed % 997 : 0), y) * 4) * Math.PI / 2;
  }
  function palisadeMask(at, x, y) {
    let m = 0;
    for (const [bit, dx, dz] of R3.Models.ARMS) { const o = at(x + dx, y + dz); if (o && o.type === 'palisade') m |= bit; }
    return m;
  }

  class Batch {
    constructor(group, geo, mat, cap) {
      this.group = group; this.geo = geo; this.mat = mat; this.n = 0;
      this.make(cap);
    }
    make(cap) {
      const old = this.mesh;
      this.cap = cap;
      this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
      this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, _w);
      this.group.add(this.mesh);
      if (old) {   // keep what was already written this frame
        for (let i = 0; i < this.n; i++) { old.getMatrixAt(i, _m); this.mesh.setMatrixAt(i, _m); old.getColorAt(i, _c); this.mesh.setColorAt(i, _c); }
        this.group.remove(old); old.dispose();
      }
    }
    add(m, c) {
      if (this.n >= this.cap) this.make(this.cap * 2);
      this.mesh.setMatrixAt(this.n, m);
      this.mesh.setColorAt(this.n, c);
      this.n++;
    }
    end() {
      this.mesh.count = this.n;
      this.mesh.visible = this.n > 0;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    dispose() { this.group.remove(this.mesh); this.mesh.dispose(); }
  }

  class Buildings {
    constructor(scene, fx) {
      this.scene = scene; this.fx = fx; this.puffs = fx.puffs;
      this.dusk = false;           // set by the renderer: windows glow
      this.eye = new THREE.Vector3();   // camera position, set by the renderer each frame
      this.mat = R3.flatMaterial();
      this.group = new THREE.Group(); scene.add(this.group);
      this.batches = new Map();
      this.state = new Map();
      this.byTile = new Map();
      this.frame = 0; this.time = 0; this.initial = true;
      const extra = (geo, cap) => {
        const m = new THREE.InstancedMesh(geo, this.mat, cap);
        m.count = 0; m.castShadow = true; m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _w);
        this.group.add(m);
        return m;
      };
      this.flags = extra(R3.Models.flagGeometry(), 64);
      this.saws = extra(R3.Models.sawGeometry(), 32);
      this.at = (x, z) => (inMap(x, z) ? this.byTile.get(z * MAP_W + x) : null);
    }
    batch(model) {
      let b = this.batches.get(model.key);
      if (!b) { b = new Batch(this.group, model.geo, this.mat, 8); this.batches.set(model.key, b); }
      return b;
    }
    // Height of whatever stands on a tile, for picking (-99 when empty).
    heightOn(tx, tz) {
      const b = this.byTile.get(tz * MAP_W + tx);
      if (!b) return -99;
      const st = this.state.get(b.id);
      return R3.Terrain.tileTop(tx, tz) + (st && st.h ? st.h : 0.5);
    }
    modelFor(b) {
      const mask = b.type === 'palisade' ? palisadeMask(this.at, b.x, b.y) : 0;
      return R3.Models.get(b.type, R3.Models.tierOf(b.type, b.lvl), b.ruined, mask);
    }

    // A building gives way: a burst of flame, sparks and ash.
    collapse(b, cx, gy, cz, st) {
      const P = this.puffs, S = this.fx.sparks, h = Math.max(0.3, st.h * 0.6);
      P.burst(cx, gy, cz, 0.3, 14, T.ash, 0.45);
      for (let k = 0; k < 10; k++) P.spawn(cx + (rnd() - 0.5) * 0.5, gy + 0.1 + rnd() * h, cz + (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.4, 0.6 + rnd() * 0.5, (rnd() - 0.5) * 0.4, 0.5 + rnd() * 0.3, 0.22, 0.06, FIRE, 0.95, FIRE_END, 0, true);
      for (let k = 0; k < 14; k++) S.spawn(cx, gy + 0.2 + rnd() * h, cz, (rnd() - 0.5) * 1.6, 1 + rnd() * 1.4, (rnd() - 0.5) * 1.6, 0.8 + rnd() * 0.6, 0.06, 0.03, EMBER, 1, EMBER_END, 1.6);
    }

    /* Fire, smoke and embers for one building. Rates are per second; fractional rates carry
       over between frames in the accumulators fA (flames), sA (smoke) and eA (embers). */
    fire(b, st, model, dmg, dt, t) {
      let target = 0, smoke = 0, smokeCol = SMOKE_DARK, lift = 1;
      if (!b.ruined) target = dmg > BURN_FROM ? 0.25 + 0.75 * (dmg - BURN_FROM) / (1 - BURN_FROM) : 0;
      else if (b.rebuild <= 0) target = Math.max(0, 1 - st.ruinT / RUIN_BURN);
      st.burn += (target - st.burn) * Math.min(1, dt * 2.5);
      const I = st.burn < 0.02 ? 0 : st.burn;
      if (I > 0) smoke = 2 + 4 * I;
      else if (b.ruined && b.rebuild <= 0) { smoke = 1.6; smokeCol = 0x4d4843; lift = 0.7; }         // smouldering
      else if (b.ruined) { smoke = 0.6; smokeCol = SMOKE_GREY; lift = 0.5; }                        // being cleared
      if (!I && !smoke) { st.fA = st.sA = st.eA = 0; return; }

      const P = this.puffs, S = this.fx.sparks, foot = R3.Models.FOOT[b.type] || [0.25, 0.25];
      const fw = foot[0] * 0.8, fd = foot[1] * 0.8, h = b.ruined ? 0.22 : st.h;
      const cos = Math.cos(st.rot), sin = Math.sin(st.rot), cx = st.cx, cz = st.cz, gy = st.gy;
      // a random spot on the roof (or among the rubble)
      const spot = out => {
        const lx = (rnd() * 2 - 1) * fw, lz = (rnd() * 2 - 1) * fd;
        const edge = Math.max(Math.abs(lx) / (fw || 1), Math.abs(lz) / (fd || 1));
        out.x = cx + lx * cos + lz * sin; out.z = cz - lx * sin + lz * cos;
        out.y = gy + (b.ruined ? 0.05 + rnd() * 0.15 : h * (0.5 + 0.42 * (1 - edge)));
        return out;
      };
      if (I > 0) {
        for (st.fA += dt * (8 + 18 * I); st.fA >= 1; st.fA--) {
          spot(_p);
          const s0 = (0.16 + 0.16 * I) * (0.7 + rnd() * 0.6);
          P.spawn(_p.x, _p.y - s0 * 0.25, _p.z, (rnd() - 0.5) * 0.06, 0.35 + rnd() * 0.3, (rnd() - 0.5) * 0.06, 0.45 + rnd() * 0.3, s0, s0 * 0.45, FIRE, 0.95, FIRE_END, 0, true);
        }
        for (st.eA += dt * (1 + 4 * I); st.eA >= 1; st.eA--) {
          spot(_p);
          S.spawn(_p.x, _p.y + 0.1, _p.z, (rnd() - 0.5) * 0.35, 0.6 + rnd() * 0.7, (rnd() - 0.5) * 0.35, 1 + rnd() * 0.8, 0.045, 0.025, EMBER, 1, EMBER_END, 0.35);
        }
        const fl = 0.88 + Math.sin(t * 13 + b.id) * 0.07 + Math.sin(t * 29 + b.id * 3) * 0.05;
        const r = Math.max(foot[0], foot[1]) * 2 + 0.7;
        this.fx.glow.add(cx, gy + 0.03, cz, r * (0.75 + 0.25 * I) * fl, GLOW, 0.5 * I * fl);
        this.fx.lights.add(cx, gy + h * 0.75, cz, (0.5 + 0.5 * I) * (foot[0] + 0.5), 0xff9040, 0.32 * I * fl);
      } else if (b.ruined && b.rebuild <= 0) {
        const fl = 0.8 + Math.sin(t * 2.3 + b.id) * 0.2;
        this.fx.glow.add(cx, gy + 0.03, cz, Math.max(foot[0], foot[1]) * 2 + 0.3, GLOW, 0.16 * fl);
        if ((st.eA += dt * 0.6) >= 1) { st.eA = 0; spot(_p); S.spawn(_p.x, _p.y, _p.z, (rnd() - 0.5) * 0.2, 0.4 + rnd() * 0.3, (rnd() - 0.5) * 0.2, 0.8, 0.04, 0.02, EMBER, 1, EMBER_END, 0.3); }
      }
      for (st.sA += dt * smoke; st.sA >= 1; st.sA--) {
        spot(_p);
        const big = I > 0 ? 0.38 + 0.22 * I : 0.3;
        P.spawn(cx + (_p.x - cx) * 0.6, _p.y + (I > 0 ? 0.12 : 0.02), cz + (_p.z - cz) * 0.6, (rnd() - 0.5) * 0.05, (0.38 + rnd() * 0.18) * lift, (rnd() - 0.5) * 0.05,
          2.4 + rnd() * 0.9, 0.12, big * (0.8 + rnd() * 0.4), smokeCol, I > 0 ? 0.52 : 0.4, SMOKE_GREY);
      }
    }

    sync(dt) {
      const f = ++this.frame;
      this.time += dt;
      const t = this.time;
      this.byTile.clear();
      for (const b of G.buildings) this.byTile.set(b.y * MAP_W + b.x, b);
      for (const bt of this.batches.values()) bt.n = 0;
      let nf = 0, ns = 0;
      for (const b of G.buildings) {
        const model = this.modelFor(b), tier = R3.Models.tierOf(b.type, b.lvl);
        const cx = b.x + 0.5, cz = b.y + 0.5, gy = R3.Terrain.heightAt(cx, cz);
        let st = this.state.get(b.id);
        if (!st) {
          st = { t: this.initial ? 99 : 0, pop: 99, rot: rotFor(b.type, b.x, b.y), smoke: Math.random() * 1.5, ruined: b.ruined, tier, h: model.height, frame: f,
            burn: 0, ruinT: this.initial ? RUIN_BURN : 0, fA: 0, sA: 0, eA: 0 };
          this.state.set(b.id, st);
          if (!this.initial) this.puffs.burst(cx, gy, cz, 0.38, 12, T.dust);
        } else {
          if (st.ruined && !b.ruined) { st.t = 0; this.puffs.burst(cx, gy, cz, 0.38, 10, T.dust); }
          else if (!st.ruined && b.ruined) { st.t = 99; st.ruinT = 0; this.collapse(b, cx, gy, cz, st); }
          else if (st.tier !== tier && !b.ruined) { st.pop = 0; this.puffs.burst(cx, gy, cz, 0.36, 8, T.dust); }
        }
        st.ruined = b.ruined; st.tier = tier; st.h = model.height; st.frame = f; st.cx = cx; st.gy = gy; st.cz = cz;
        st.t += dt; st.pop += dt; st.ruinT += dt;

        // construction: rise from the ground and settle with a little overshoot
        let sx = 1, sy = 1;
        if (st.t < BUILD_TIME) { const k = easeOutBack(Math.min(1, st.t / BUILD_TIME)); sy = Math.max(0.02, k); sx = 0.6 + 0.4 * k; }
        if (st.pop < 0.45) { const k = Math.sin(st.pop / 0.45 * Math.PI) * 0.09; sx *= 1 + k; sy *= 1 + k; }
        _q.setFromAxisAngle(UP, st.rot); _s.set(sx, sy, sx); _p.set(cx, gy, cz);
        _m.compose(_p, _q, _s);
        // damage blackens the walls; a hit flashes
        const dmg = b.ruined ? 0 : Math.max(0, Math.min(1, 1 - b.hp / (b.maxHp || 1)));
        const ch = 1 - Math.min(0.6, dmg * 0.72);
        _c.setRGB(ch, ch * 0.94, ch * 0.9);
        if (b.flash > 0) _c.setRGB(1.6, 0.75, 0.6);
        this.batch(model).add(_m, _c);
        this.fire(b, st, model, dmg, dt, t);

        // animated extras on finished, standing buildings
        if (!b.ruined && st.t >= BUILD_TIME) {
          const cos = Math.cos(st.rot), sin = Math.sin(st.rot);
          const wx = (x, z) => cx + x * cos + z * sin, wz = (x, z) => cz - x * sin + z * cos;
          for (const fl of model.flags) {
            if (nf >= 64) break;
            _q.setFromAxisAngle(UP, st.rot + 0.6 + Math.sin(t * 2.6 + b.id + fl[0] * 9) * 0.35);
            const wave = 1 + Math.sin(t * 7 + b.id) * 0.06;
            _s.set(fl[3] * wave, fl[3], fl[3]); _p.set(wx(fl[0], fl[2]), gy + fl[1], wz(fl[0], fl[2]));
            _m.compose(_p, _q, _s);
            this.flags.setMatrixAt(nf, _m);
            this.flags.setColorAt(nf, _c.setHex(b.type === 'barracks' ? T.banner : b.type === 'market' ? T.produce[(nf + b.id) % 4] : T.player));
            nf++;
          }
          for (const sw of model.saws) {
            if (ns >= 32) break;
            const k = Math.sin(t * 7 + b.id);
            _q.setFromAxisAngle(UP, st.rot + Math.PI / 2);
            _s.set(1, 1, 1); _p.set(wx(sw[0], sw[2] + k * 0.05), gy + sw[1] + Math.abs(k) * 0.015, wz(sw[0], sw[2] + k * 0.05));
            _m.compose(_p, _q, _s);
            this.saws.setMatrixAt(ns, _m); this.saws.setColorAt(ns, _w);
            ns++;
          }
          if (model.smoke.length && st.burn < 0.05 && (st.smoke -= dt) <= 0) {
            st.smoke = 0.9 + Math.random() * 0.8;
            for (const sm of model.smoke) this.puffs.spawn(wx(sm[0], sm[2]), gy + sm[1], wz(sm[0], sm[2]), 0.03, 0.22, 0.02, 2.0, 0.035, 0.11, T.smoke, 0.55);
          }
          // lit doors and windows at dusk
          if (this.dusk && model.lights.length && st.burn < 0.5) {
            const flick = 0.92 + Math.sin(t * 3.1 + b.id * 1.7) * 0.05 + Math.sin(t * 7.3 + b.id) * 0.03;
            const vx = this.eye.x - cx, vz = this.eye.z - cz, vl = Math.hypot(vx, vz) || 1;
            for (const L of model.lights) {
              // only windows that face the camera
              const facing = ((L[5] * cos + L[6] * sin) * vx + (-L[5] * sin + L[6] * cos) * vz) / vl;
              if (facing <= 0.05) continue;
              this.fx.lights.add(wx(L[0], L[2]), gy + L[1], wz(L[0], L[2]), L[3], WINDOW, 0.85 * L[4] * flick * Math.min(1, facing * 3));
            }
          }
        }
      }
      for (const bt of this.batches.values()) bt.end();
      this.flags.count = nf; this.flags.visible = nf > 0; this.flags.instanceMatrix.needsUpdate = true; if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
      this.saws.count = ns; this.saws.visible = ns > 0; this.saws.instanceMatrix.needsUpdate = true;
      // demolished: a puff of dust where it stood
      for (const [id, st] of this.state) if (st.frame !== f) {
        this.puffs.burst(st.cx, st.gy, st.cz, 0.36, 10, T.dust);
        this.state.delete(id);
      }
      this.initial = false;
    }
    clear() {
      this.state.clear(); this.byTile.clear(); this.initial = true;
      for (const bt of this.batches.values()) { bt.n = 0; bt.end(); }
    }
    dispose() {
      this.clear();
      for (const bt of this.batches.values()) bt.dispose();
      this.batches.clear();
      this.flags.dispose(); this.saws.dispose(); this.mat.dispose();
    }
    stats() { let calls = 0; for (const bt of this.batches.values()) if (bt.n) calls++; return { variants: this.batches.size, drawn: calls }; }
  }

  R3.Buildings = Buildings;
  R3.Buildings.rotFor = rotFor;
  R3.Buildings.palisadeMask = palisadeMask;
})(window.R3);
