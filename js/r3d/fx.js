'use strict';
/* Effects: a pooled particle system for puffs (smoke, dust, ash).
   One InstancedMesh, typed arrays for state, no allocations per frame.
   Phase 4 adds fire, splashes and impacts on top of this. */
window.R3 = window.R3 || {};
(function (R3) {
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

  class Puffs {
    constructor(scene, max) {
      this.max = max;
      const geo = new THREE.IcosahedronGeometry(0.5, 0);
      // Unlit and see-through, so puffs read as smoke and dust rather than floating stones.
      this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
      this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
      this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, _c.set(0xffffff));
      scene.add(this.mesh);
      const f = n => new Float32Array(max * n);
      this.pos = f(3); this.vel = f(3); this.col = f(3); this.age = f(1); this.life = f(1); this.s0 = f(1); this.s1 = f(1); this.spin = f(1);
      this.alive = new Uint8Array(max); this.n = 0; this.cursor = 0;
      this.density = 1;
    }
    spawn(x, y, z, vx, vy, vz, life, s0, s1, hex) {
      if (this.density < 1 && Math.random() > this.density) return;
      let i = -1;
      for (let k = 0; k < this.max; k++) { const j = (this.cursor + k) % this.max; if (!this.alive[j]) { i = j; break; } }
      if (i < 0) i = this.cursor;          // pool full: recycle the oldest slot we point at
      this.cursor = (i + 1) % this.max;
      this.alive[i] = 1;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      _c.setHex(hex); this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
      this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.spin[i] = Math.random() * 6;
    }
    // A ring of dust around a footprint (construction, demolition, collapse).
    burst(x, y, z, radius, n, hex, rise) {
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + Math.random() * 0.4, r = radius * (0.7 + Math.random() * 0.4);
        this.spawn(x + Math.cos(a) * r, y + 0.04, z + Math.sin(a) * r, Math.cos(a) * 0.25, (rise || 0.25) + Math.random() * 0.15, Math.sin(a) * 0.25, 0.7 + Math.random() * 0.4, 0.06, 0.2, hex);
      }
    }
    update(dt) {
      let n = 0;
      const drag = Math.exp(-dt * 1.5);
      for (let i = 0; i < this.max; i++) {
        if (!this.alive[i]) continue;
        const a = (this.age[i] += dt), k = a / this.life[i];
        if (k >= 1) { this.alive[i] = 0; continue; }
        const i3 = i * 3;
        this.vel[i3] *= drag; this.vel[i3 + 2] *= drag;
        this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        // grow, then shrink away at the end of life
        const s = (this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(k)) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
        _p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
        _q.setFromEuler(_e.set(this.spin[i] + a, this.spin[i] * 0.7, 0));
        _s.set(s, s * 0.85, s);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        this.mesh.setColorAt(n, _c.setRGB(this.col[i3], this.col[i3 + 1], this.col[i3 + 2]));
        n++;
      }
      this.mesh.count = n;
      this.mesh.visible = n > 0;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.n = n;
    }
    clear() { this.alive.fill(0); this.mesh.count = 0; }
    dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); this.mat.dispose(); }
  }

  R3.Puffs = Puffs;
})(window.R3);
