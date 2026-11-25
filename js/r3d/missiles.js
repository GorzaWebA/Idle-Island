'use strict';
/* Missiles and battle effects.
   - arrows (bowmen, skirmishers, towers, the Hall's archers) fly the sim's arcs, point along
     their flight and leave a faint streak; fire arrows glow and drop sparks
   - volley arrows rain onto their target area
   - sim effects (RT.effects) become particles and rings, each handled exactly once */
window.R3 = window.R3 || {};
(function (R3) {
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(1, 1, 1);
  const FIRE = new THREE.Color(1.7, 0.95, 0.5);

  class Missiles {
    constructor(scene, fx) {
      this.fx = fx;
      this.group = new THREE.Group(); scene.add(this.group);
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this.trailMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.arrows = new R3.Batch(this.group, R3.UnitModels.arrow(), this.mat, 64);
      this.trails = new R3.Batch(this.group, R3.UnitModels.trail(), this.trailMat, 64, { receive: false, order: 5 });
      this.seen = new WeakSet();
      this.ember = 0;
    }
    // Where a projectile is along its arc at progress k (0..1).
    arc(p, k, total, out) {
      const x = p.sx + (p.tx - p.sx) * k, z = p.sy + (p.ty - p.sy) * k;
      const g0 = Math.max(0, R3.Terrain.heightAt(p.sx, p.sy)), g1 = Math.max(0, R3.Terrain.heightAt(p.tx, p.ty));
      const lift = p.visual ? 1.6 : Math.min(1.2, total * 0.18);
      out.set(x, g0 + (g1 - g0) * k + Math.sin(Math.PI * k) * lift + (p.h0 || 0) * (1 - k) + 0.1, z);
      return out;
    }
    sync(alpha, dt) {
      if (!RT) return;
      this.arrows.begin(); this.trails.begin();
      for (const p of RT.projectiles) {
        let k, total;
        if (p.visual) { total = 1; k = Math.min(1, (p.t + alpha * STEP) / p.dur); }
        else {
          total = Math.max(0.01, Math.hypot(p.tx - p.sx, p.ty - p.sy));
          const remaining = Math.hypot(p.tx - p.x, p.ty - p.y);
          k = Math.min(1, 1 - Math.max(0, remaining - p.speed * alpha * STEP) / total);
        }
        this.arc(p, k, total, _a);
        this.arc(p, Math.min(1, k + 0.03), total, _b);
        if (_b.distanceToSquared(_a) < 1e-8) continue;
        _m.lookAt(_b, _a, UP);              // +z of the arrow points along its flight
        _q.setFromRotationMatrix(_m);
        _m.compose(_a, _q, _s.set(1, 1, 1));
        this.arrows.add(_m, p.fire ? FIRE : WHITE);
        _m.compose(_a, _q, _s.set(1, 1, p.visual ? 0.3 : 0.22));
        this.trails.add(_m, p.fire ? _c.setRGB(0.9, 0.45, 0.12) : _c.setRGB(0.2, 0.2, 0.19));
        if (p.fire && Math.random() < dt * 25) this.fx.puffs.spawn(_a.x, _a.y, _a.z, 0, 0.1, 0, 0.35, 0.02, 0.035, 0xffb347);
      }
      this.arrows.end(); this.trails.end();
      this.effects();
    }
    // One-off reactions to sim effects.
    effects() {
      const fx = this.fx, H = (x, z) => Math.max(0, R3.Terrain.heightAt(x, z));
      for (const e of RT.effects) {
        if (this.seen.has(e)) continue;
        this.seen.add(e);
        const y = H(e.x, e.y);
        switch (e.type) {
          case 'hit':
            for (let k = 0; k < 2; k++) fx.puffs.spawn(e.x, y + 0.11, e.y, (Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5, 0.22, 0.018, 0.03, 0xfff2c0);
            break;
          case 'spark':
            fx.puffs.spawn(e.x, y + 0.15, e.y, (Math.random() - 0.5) * 0.3, 0.5, (Math.random() - 0.5) * 0.3, 0.35, 0.02, 0.035, 0xffb347);
            break;
          case 'death':
            fx.puffs.spawn(e.x, y + 0.04, e.y, 0, 0.12, 0, 0.6, 0.04, 0.1, 0xcfc4ad);
            break;
          case 'bash':
            fx.rings.spawn(e.x, y + 0.02, e.y, 0.06, 0.42, 0.38, 0x9fd0ff);
            break;
          case 'volley':
            fx.rings.spawn(e.x, y + 0.03, e.y, 0.3, 1.35, 0.5, 0xf3ead2);
            fx.puffs.burst(e.x, y, e.y, 0.8, 8, 0xd6c59c, 0.15);
            break;
          case 'blaze':
            for (let k = 0; k < 8; k++) fx.puffs.spawn(e.x + (Math.random() - 0.5) * 0.4, y + 0.1, e.y + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3, 0.6, 0.04, 0.09, k % 2 ? 0xff8a3a : 0xffc04a);
            break;
          case 'refill':
            fx.rings.spawn(e.x, y + 0.02, e.y, 0.04, 0.22, 0.45, 0x8fe3a0);
            break;
          // 'splash' is shown by the drowning figure itself
        }
      }
    }
    dispose() { for (const b of [this.arrows, this.trails]) { b.geo.dispose(); b.dispose(); } this.mat.dispose(); this.trailMat.dispose(); }
  }

  R3.Missiles = Missiles;
})(window.R3);
