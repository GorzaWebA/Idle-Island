'use strict';
/* Missiles and battle effects.
   - arrows (bowmen, skirmishers, towers, the Hall's archers) fly the sim's arcs, point along
     their flight and leave a faint streak; fire arrows glow and drop sparks
   - volley arrows rain onto their target area
   - an arrow that lands kicks up dust, splashes in the sea, or sets sparks flying if it was
     on fire (found by noticing which projectiles disappeared since the last frame)
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
      // impact detection: projectiles seen last frame, and the frame each was last seen in
      this.frame = 0; this.last = []; this.next = []; this.seenAt = new WeakMap(); this.where = new WeakMap();
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
      const f = ++this.frame, fx = this.fx;
      this.arrows.begin(); this.trails.begin();
      this.next.length = 0;
      for (const p of RT.projectiles) {
        this.seenAt.set(p, f); this.next.push(p);
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
        let w = this.where.get(p);
        if (!w) { w = new THREE.Vector3(); this.where.set(p, w); }
        w.copy(_a);
        if (p.fire) {
          fx.lights.add(_a.x, _a.y, _a.z, 0.3, 0xff9a40, 0.7);
          if (Math.random() < dt * 30) fx.sparks.spawn(_a.x, _a.y, _a.z, (Math.random() - 0.5) * 0.2, 0.1, (Math.random() - 0.5) * 0.2, 0.4, 0.04, 0.02, 0xffb347, 1, 0xff5010, 0.6);
        }
      }
      this.arrows.end(); this.trails.end();
      // arrows that were in the air last frame and are gone now have landed
      for (const p of this.last) if (this.seenAt.get(p) !== f) this.impact(p);
      const tmp = this.last; this.last = this.next; this.next = tmp;
      this.effects();
    }
    impact(p) {
      const fx = this.fx, rnd = Math.random;
      const w = this.where.get(p), x = p.tx, z = p.ty;
      if (!w || Math.hypot(w.x - x, w.z - z) > 1.2) return;     // cleared at the end of a wave, not landed
      const ground = R3.Terrain.heightAt(x, z);
      if (!isLandAt(x, z)) {           // into the sea
        fx.ripples.spawn(x, 0.02, z, 0.02, 0.2, 0.6, 0xb9dbe2);
        for (let k = 0; k < 3; k++) fx.puffs.spawn(x, 0.02, z, (rnd() - 0.5) * 0.3, 0.6 + rnd() * 0.4, (rnd() - 0.5) * 0.3, 0.45, 0.03, 0.05, 0xe8f4f6, 0.85, null, 3);
        return;
      }
      const y = Math.max(0, ground);
      if (p.fire) {
        for (let k = 0; k < 3; k++) fx.puffs.spawn(x + (rnd() - 0.5) * 0.15, y + 0.15, z + (rnd() - 0.5) * 0.15, 0, 0.5, 0, 0.35, 0.12, 0.03, 0xffd25a, 0.95, 0xc8361a, 0, true);
        for (let k = 0; k < 5; k++) fx.sparks.spawn(x, y + 0.15, z, (rnd() - 0.5) * 0.9, 0.5 + rnd() * 0.6, (rnd() - 0.5) * 0.9, 0.5, 0.05, 0.02, 0xffb347, 1, 0xff5010, 2.2);
      } else if (p.visual || !p.tgt || p.tgt.type !== undefined) {
        fx.puffs.spawn(x, y + 0.03, z, (rnd() - 0.5) * 0.1, 0.2, (rnd() - 0.5) * 0.1, 0.5, 0.04, 0.11, 0xd6c59c, 0.7);
      } else {                         // struck a soldier or raider
        for (let k = 0; k < 2; k++) fx.sparks.spawn(x, y + 0.12, z, (rnd() - 0.5) * 0.6, 0.3 + rnd() * 0.3, (rnd() - 0.5) * 0.6, 0.2, 0.035, 0.015, 0xfff0d0, 0.9, null, 3);
      }
    }
    // One-off reactions to sim effects.
    effects() {
      const fx = this.fx, H = (x, z) => Math.max(0, R3.Terrain.heightAt(x, z));
      for (const e of RT.effects) {
        if (this.seen.has(e)) continue;
        this.seen.add(e);
        const y = H(e.x, e.y);
        switch (e.type) {
          case 'hit':     // steel on steel: a few quick white-gold sparks
            for (let k = 0; k < 3; k++) fx.sparks.spawn(e.x, y + 0.13, e.y, (Math.random() - 0.5) * 0.9, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9, 0.22, 0.04, 0.015, 0xfff2c0, 1, 0xffa040, 3);
            break;
          case 'spark':   // a raider hacking at a building
            for (let k = 0; k < 3; k++) fx.sparks.spawn(e.x, y + 0.15, e.y, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0.35, 0.045, 0.02, 0xffc060, 1, 0xff6020, 2.5);
            fx.puffs.spawn(e.x, y + 0.08, e.y, 0, 0.15, 0, 0.5, 0.04, 0.1, 0xb9a98c, 0.6);
            break;
          case 'death':
            fx.puffs.spawn(e.x, y + 0.04, e.y, 0, 0.12, 0, 0.6, 0.05, 0.14, 0xcfc4ad, 0.7);
            break;
          case 'bash':
            fx.rings.spawn(e.x, y + 0.02, e.y, 0.06, 0.42, 0.38, 0x9fd0ff);
            for (let k = 0; k < 2; k++) fx.sparks.spawn(e.x, y + 0.12, e.y, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6, 0.25, 0.05, 0.02, 0xcfe6ff, 1, null, 2.5);
            break;
          case 'volley':
            fx.rings.spawn(e.x, y + 0.03, e.y, 0.3, 1.35, 0.5, 0xf3ead2);
            fx.puffs.burst(e.x, y, e.y, 0.8, 8, 0xd6c59c, 0.15);
            break;
          case 'blaze':   // the flames themselves come from the collapsing building
            fx.rings.spawn(e.x, y + 0.03, e.y, 0.2, 1.0, 0.55, 0xff8a3a);
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
