'use strict';
/* Buildings: every model variant (type x tier, ruins, palisade shapes) is one InstancedMesh,
   so a whole settlement costs a handful of draw calls.
   Per building the renderer keeps its own state (never the sim's):
     construction (springs up with a bounce and dust), tier-up pop, hit flash, collapse to a
     ruin, chimney smoke, flags and a sawing saw. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const UP = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Color(1, 1, 1);
  const BUILD_TIME = 0.7;

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
    constructor(scene, puffs) {
      this.scene = scene; this.puffs = puffs;
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
          st = { t: this.initial ? 99 : 0, pop: 99, rot: rotFor(b.type, b.x, b.y), smoke: Math.random() * 1.5, ruined: b.ruined, tier, h: model.height, frame: f };
          this.state.set(b.id, st);
          if (!this.initial) this.puffs.burst(cx, gy, cz, 0.38, 12, T.dust);
        } else {
          if (st.ruined && !b.ruined) { st.t = 0; this.puffs.burst(cx, gy, cz, 0.38, 10, T.dust); }
          else if (!st.ruined && b.ruined) { st.t = 99; this.puffs.burst(cx, gy, cz, 0.3, 14, T.ash, 0.45); }
          else if (st.tier !== tier && !b.ruined) { st.pop = 0; this.puffs.burst(cx, gy, cz, 0.36, 8, T.dust); }
        }
        st.ruined = b.ruined; st.tier = tier; st.h = model.height; st.frame = f; st.cx = cx; st.gy = gy; st.cz = cz;
        st.t += dt; st.pop += dt;

        // construction: rise from the ground and settle with a little overshoot
        let sx = 1, sy = 1;
        if (st.t < BUILD_TIME) { const k = easeOutBack(Math.min(1, st.t / BUILD_TIME)); sy = Math.max(0.02, k); sx = 0.6 + 0.4 * k; }
        if (st.pop < 0.45) { const k = Math.sin(st.pop / 0.45 * Math.PI) * 0.09; sx *= 1 + k; sy *= 1 + k; }
        _q.setFromAxisAngle(UP, st.rot); _s.set(sx, sy, sx); _p.set(cx, gy, cz);
        _m.compose(_p, _q, _s);
        _c.copy(_w);
        if (b.flash > 0) _c.setRGB(1.6, 0.75, 0.6);
        this.batch(model).add(_m, _c);

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
          if (model.smoke.length && (st.smoke -= dt) <= 0) {
            st.smoke = 0.9 + Math.random() * 0.8;
            for (const sm of model.smoke) this.puffs.spawn(wx(sm[0], sm[2]), gy + sm[1], wz(sm[0], sm[2]), 0.03, 0.22, 0.02, 2.0, 0.035, 0.11, T.smoke);
          }
        } else if (b.ruined && b.rebuild <= 0 && (st.smoke -= dt) <= 0) {
          // a smouldering ruin (fire arrives in phase 4)
          st.smoke = 0.35 + Math.random() * 0.3;
          this.puffs.spawn(cx + (Math.random() - 0.5) * 0.3, gy + 0.12, cz + (Math.random() - 0.5) * 0.3, 0.02, 0.35, 0.01, 2.0, 0.07, 0.24, 0x4d4843);
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
