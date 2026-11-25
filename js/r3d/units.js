'use strict';
/* Units and boats: the adapter from sim state to render state.
   - snapshot() runs before each fixed sim step; frames interpolate between the last two steps
   - facing comes from movement, or from the current target when standing still
   - the renderer only reads sim objects; its own per-unit state lives in Maps keyed by id
   Phase 1 draws instanced stand-in figures; Phase 3 replaces them with animated models. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const MAX_UNITS = 600;
  const UP = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

  function figureGeometry() {
    const mb = new R3.MeshBuilder();
    mb.cyl(0, 0, 0, 0.065, 0.13, 0.045, 6, 0xffffff, true);          // body (tinted per instance)
    mb.cbox(0, 0.13, 0, 0.07, 0.06, 0.065, 0xffffff);                   // head
    mb.cbox(0.05, 0.05, 0.03, 0.02, 0.07, 0.02, 0xd0d0d0);             // weapon arm hint
    return mb.geometry();
  }
  function boatGeometry(boss) {
    const mb = new R3.MeshBuilder(), L = boss ? 0.75 : 0.6, W = boss ? 0.2 : 0.16;
    // hull: a hexagonal prism, pointed at both ends (along z)
    const deck = 0.1, keel = -0.06;
    const ring = (y, s) => [[0, y, L * s], [W * s, y, L * 0.45 * s], [W * s, y, -L * 0.45 * s], [0, y, -L * s], [-W * s, y, -L * 0.45 * s], [-W * s, y, L * 0.45 * s]];
    const top = ring(deck, 1), bot = ring(keel, 0.7);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6, mx = (top[i][0] + top[j][0]) / 2, mz = (top[i][2] + top[j][2]) / 2;
      mb.poly([bot[i], bot[j], top[j], top[i]], i % 3 === 0 ? T.hullDark : T.hull, [mx, -0.2, mz]);
    }
    mb.poly(top, T.hullDark, [0, 1, 0]);
    mb.cbox(0, deck, L * 0.92, 0.04, 0.14, 0.04, T.hull);               // prow post
    mb.cbox(0, deck, 0, 0.03, 0.62, 0.03, T.hullDark);                  // mast
    mb.box(-0.26, 0.28, -0.012, 0.26, 0.66, 0.012, T.sail);             // sail (faces the side)
    for (let k = 0; k < 3; k++) mb.box(-0.26 + k * 0.2, 0.28, -0.014, -0.18 + k * 0.2, 0.66, 0.014, boss ? T.raiderDark : T.sailStripe);
    return mb.geometry();
  }

  class Units {
    constructor(scene) {
      this.scene = scene;
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this.mesh = new THREE.InstancedMesh(figureGeometry(), this.mat, MAX_UNITS);
      this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(this.mesh);
      this.prev = new Map();        // id -> {x, y} at the previous sim step
      this.state = new Map();       // id -> render state {x, y, z, h, gy, frame}
      this.boatGeo = [boatGeometry(false), boatGeometry(true)];
      this.boats = new Map();       // boat id -> Mesh
      this.boatGroup = new THREE.Group(); scene.add(this.boatGroup);
      this.frame = 0;
    }
    // Before every sim step: remember where things were.
    snapshot() {
      if (!RT) return;
      for (const u of RT.units) {
        const p = this.prev.get(u.id);
        if (p) { p.x = u.x; p.y = u.y; } else this.prev.set(u.id, { x: u.x, y: u.y });
      }
      for (const b of RT.boats) {
        const p = this.prev.get('b' + b.id);
        if (p) { p.x = b.x; p.y = b.y; } else this.prev.set('b' + b.id, { x: b.x, y: b.y });
      }
    }
    tint(u) {
      if (u.side === 0) return T.tunic[u.kind] || T.tunic.militia;
      return u.kind === 'brute' ? T.brute : u.kind === 'berserker' ? T.berserker : u.kind === 'warlord' ? T.warlord : u.kind === 'archer' ? 0xb4553a : T.raider;
    }
    sync(alpha, dt) {
      if (!RT) return;
      const f = ++this.frame;
      let i = 0;
      const k = 1 - Math.exp(-dt * 14);
      for (const u of RT.units) {
        if (!u.alive || i >= MAX_UNITS) continue;
        const p = this.prev.get(u.id);
        const x = p ? p.x + (u.x - p.x) * alpha : u.x, z = p ? p.y + (u.y - p.y) * alpha : u.y;
        let st = this.state.get(u.id);
        if (!st) { st = { x, z, h: 0, gy: R3.Terrain.heightAt(x, z), frame: f }; this.state.set(u.id, st); }
        // facing: movement first, then the current target
        const mx = x - st.x, mz = z - st.z;
        let want = null;
        if (mx * mx + mz * mz > 1e-6) want = Math.atan2(mx, mz);
        else if (u.target && u.target.alive !== false) {
          const tx = u.target.type !== undefined ? u.target.x + 0.5 : u.target.x, tz = u.target.type !== undefined ? u.target.y + 0.5 : u.target.y;
          want = Math.atan2(tx - x, tz - z);
        }
        if (want !== null) {
          let d = want - st.h; d = Math.atan2(Math.sin(d), Math.cos(d));
          st.h += d * Math.min(1, dt * 12);
        }
        st.gy += (R3.Terrain.heightAt(x, z) - st.gy) * k;
        st.x = x; st.z = z; st.frame = f;
        const sc = (u.big ? 1.6 : 1) * (u.kind === 'warlord' ? 1.25 : 1) * (u.side === 1 && u.fleeing ? Math.max(0.01, u.alpha) : 1);
        _q.setFromAxisAngle(UP, st.h); _s.set(sc, sc, sc); _p.set(x, Math.max(st.gy, -0.08), z);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(i, _m);
        _c.setHex(this.tint(u));
        if (u.flash > 0) _c.lerp(R3.col(0xffffff), 0.6);
        this.mesh.setColorAt(i, _c);
        i++;
      }
      this.mesh.count = i;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.syncBoats(alpha, f);
      if (f % 60 === 0) this.prune(f);
    }
    syncBoats(alpha, f) {
      for (const b of RT.boats) {
        let m = this.boats.get(b.id);
        if (!m) {
          m = new THREE.Mesh(this.boatGeo[b.boss ? 1 : 0], this.mat);
          m.castShadow = true;
          this.boats.set(b.id, m); this.boatGroup.add(m);
        }
        m.userData.frame = f;
        const hidden = RT.phase === 'countdown' && RT.timer > b.visibleAt && b.state === 'sail';
        m.visible = !hidden && b.state !== 'gone';
        const p = this.prev.get('b' + b.id);
        const x = p ? p.x + (b.x - p.x) * alpha : b.x, z = p ? p.y + (b.y - p.y) * alpha : b.y;
        const dir = b.state === 'leave' ? Math.atan2(-b.dx, -b.dy) : Math.atan2(b.dx, b.dy);
        m.position.set(x, Math.sin(performance.now() / 600 + b.id) * 0.02, z);
        m.rotation.set(0, dir, 0);
        const s = Math.max(0.01, Math.min(1, b.alpha));
        m.scale.set(s, s, s);
      }
    }
    prune(f) {
      for (const [id, st] of this.state) if (st.frame !== f) { this.state.delete(id); this.prev.delete(id); }
      for (const [id, m] of this.boats) if (m.userData.frame !== f) { this.boatGroup.remove(m); this.boats.delete(id); this.prev.delete('b' + id); }
    }
    // Render-space position of a unit (for picking and markers).
    posOf(u) { return this.state.get(u.id) || null; }
    clear() {
      this.prev.clear(); this.state.clear(); this.mesh.count = 0;
      for (const m of this.boats.values()) this.boatGroup.remove(m);
      this.boats.clear();
    }
    dispose() { this.clear(); this.mesh.geometry.dispose(); this.mesh.dispose(); this.boatGeo.forEach(g => g.dispose()); this.mat.dispose(); }
  }

  R3.Units = Units;
})(window.R3);
