'use strict';
/* Effects.
   - Particles: pooled camera-facing sprites (smoke, dust, flames, spray, sparks). One draw call
     per pool, no allocations per frame. Each particle has its own colour (fading to an end
     colour), opacity, size, spin and gravity. The soft sprite shapes are drawn in code at startup.
       puffs: normal blending, shaded and dimmed at dusk; "emissive" puffs are flames: upright
              flame-shaped and never dimmed
       sparks: additive glow (embers, sparks, glints)
       foam: flat puffs lying on the water (wakes, splashes)
   - Glows: immediate-mode glowing sprites redrawn every frame (fire light on the ground,
     lit windows at dusk). Flat ones lie on the ground, the others face the camera.
   - Rings: expanding rings on the ground or water (shield bash, volley); a thin set of them
     makes ripples on the sea (wakes, wading, splashes). */
window.R3 = window.R3 || {};
(function (R3) {
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _d = new THREE.Color();

  /* ---------- sprite texture ----------
     64x64 RGBA. R: a lumpy soft puff made of overlapping blobs. G: a smooth round glow.
     B: an upright flame, round at the bottom and licking up to a point. */
  let spriteTex = null;
  function spriteTexture() {
    if (spriteTex) return spriteTex;
    const N = 64, data = new Uint8Array(N * N * 4);
    const blobs = [[0, 0.02, 0.6], [0.3, 0.16, 0.42], [-0.3, 0.2, 0.4], [0.12, -0.3, 0.42], [-0.22, -0.24, 0.38], [0.36, -0.12, 0.32]];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1, r = Math.hypot(x, y);
      let keep = 1;
      for (const [bx, by, br] of blobs) { const d = Math.hypot(x - bx, y - by) / br; keep *= 1 - Math.max(0, 1 - d * d); }
      const edge = Math.max(0, Math.min(1, (1 - r) / 0.25));
      const puff = (1 - keep) * edge * edge * (3 - 2 * edge);
      const glow = Math.pow(Math.max(0, 1 - r), 2.2);
      // flame: half-width shrinks from 0.62 at y = -0.35 to 0 at the tip, with a slight lick
      const yy = y + 0.05 * Math.sin(x * 9), base = -0.35;
      let hw = yy < base ? Math.sqrt(Math.max(0, 0.62 * 0.62 - (yy - base) * (yy - base) * 1.6)) : 0.62 * Math.pow(Math.max(0, 1 - (yy - base) / 1.25), 0.9);
      const fd = hw > 0 ? Math.max(0, Math.min(1, (hw - Math.abs(x)) / (0.18 + hw * 0.4))) : 0;
      const flame = fd * fd * (3 - 2 * fd) * (y > -0.95 ? 1 : 0);
      const k = (j * N + i) * 4;
      data[k] = Math.round(Math.min(1, puff * 1.15) * 255); data[k + 1] = Math.round(glow * 255); data[k + 2] = Math.round(flame * 255); data[k + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    spriteTex = t;
    return t;
  }

  const VERT = `
    attribute vec4 aPos;    // xyz, size
    attribute vec4 aCol;    // rgb, alpha (+2 = emissive)
    attribute float aRot;
    varying vec4 vCol; varying vec2 vUv; varying float vShade; varying float vFog;
    void main() {
      vCol = aCol;
      float c = cos(aRot), s = sin(aRot);
      vUv = vec2(c * position.x - s * position.y, s * position.x + c * position.y) + 0.5;
      #ifdef FLAT
        vShade = 1.0;
      #else
        vShade = 0.84 + 0.36 * position.y;
      #endif
      #ifdef FLAT
        vec4 mv = viewMatrix * vec4(aPos.xyz + vec3(position.x, 0.0, -position.y) * aPos.w, 1.0);
      #else
        vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
        mv.xy += position.xy * aPos.w;
        #ifdef GLOW
          mv.z += aPos.w * 0.35;     // lean towards the camera so a glow isn't cut by its own wall
        #endif
      #endif
      vFog = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG = `
    uniform sampler2D uMap;
    uniform vec3 uFogColor, uTint;
    uniform float uFogNear, uFogFar;
    varying vec4 vCol; varying vec2 vUv; varying float vShade; varying float vFog;
    void main() {
      vec4 t = texture2D(uMap, vUv);
      float f = smoothstep(uFogNear, uFogFar, vFog);
      #ifdef GLOW
        gl_FragColor = vec4(vCol.rgb, t.g * vCol.a * (1.0 - f));
      #else
        float em = step(1.5, vCol.a);
        float a = mix(t.r, t.b, em) * (vCol.a - em * 2.0);
        if (a < 0.004) discard;
        vec3 col = vCol.rgb * mix(uTint * vShade, vec3(1.0), em);
        gl_FragColor = vec4(mix(col, uFogColor, f * (1.0 - em * 0.6)), a);
      #endif
      #include <colorspace_fragment>
    }`;

  /* Shared shader setup for all sprite kinds. Every transparent double-sided material here sets
     forceSinglePass: otherwise three.js draws it twice, flipping its side and marking it for
     update both times, which re-checks its shader program every frame. */
  function spriteMaterial(glow, flat) {
    const defines = {};
    if (glow) defines.GLOW = '';
    if (flat) defines.FLAT = '';
    return new THREE.ShaderMaterial({
      defines,
      uniforms: { uMap: { value: spriteTexture() }, uFogColor: { value: new THREE.Color(0xffffff) }, uFogNear: { value: 30 }, uFogFar: { value: 80 }, uTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending
    });
  }
  function setSpriteTheme(mat, th) {
    const u = mat.uniforms;
    u.uFogColor.value.setHex(th.fog); u.uFogNear.value = th.fogNear; u.uFogFar.value = th.fogFar;
    u.uTint.value.setHex(th.smokeTint || 0xffffff);
  }

  // Instanced quad with per-instance position/size, colour/alpha and spin.
  function spriteMesh(scene, max, mat, order) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position'));
    const pos = new Float32Array(max * 4), col = new Float32Array(max * 4), rot = new Float32Array(max);
    const aPos = new THREE.InstancedBufferAttribute(pos, 4), aCol = new THREE.InstancedBufferAttribute(col, 4), aRot = new THREE.InstancedBufferAttribute(rot, 1);
    for (const a of [aPos, aCol, aRot]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', aPos); geo.setAttribute('aCol', aCol); geo.setAttribute('aRot', aRot);
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = order; mesh.visible = false;
    scene.add(mesh);
    quad.dispose();
    return { mesh, geo, pos, col, rot, aPos, aCol, aRot };
  }
  function upload(sm, n) {
    sm.geo.instanceCount = n; sm.mesh.visible = n > 0;
    if (n) { sm.aPos.needsUpdate = true; sm.aCol.needsUpdate = true; sm.aRot.needsUpdate = true; }
  }

  /* ---------- pooled particles ---------- */
  class Particles {
    /* opts: { glow: additive sprites, flat: lie on the ground/water, scale: size multiplier,
              order: render order, fadeIn: seconds, spin: spin-rate multiplier,
              untinted: keep full colour at dusk } */
    constructor(scene, max, opts) {
      opts = opts || {};
      this.max = max; this.scale = opts.scale || 1; this.glow = !!opts.glow;
      this.fadeIn = opts.fadeIn || 0.08; this.untinted = !!opts.untinted; this.spinRate = opts.spin === undefined ? 1 : opts.spin;
      this.mat = spriteMaterial(this.glow, !!opts.flat);
      this.sm = spriteMesh(scene, max, this.mat, opts.order || 3);
      this.mesh = this.sm.mesh;
      const f = n => new Float32Array(max * n);
      this.p = f(3); this.v = f(3); this.c0 = f(3); this.c1 = f(3);
      this.age = f(1); this.life = f(1); this.s0 = f(1); this.s1 = f(1); this.spin = f(1); this.spinV = f(1); this.alpha = f(1); this.grav = f(1);
      this.emit = new Uint8Array(max); this.alive = new Uint8Array(max);
      this.n = 0; this.cursor = 0;
      this.density = 1;              // Phase 5 setting: fraction of particles actually spawned
      this.windX = 0.1; this.windZ = 0.05;
    }
    /* spawn(x, y, z, vx, vy, vz, life, startSize, endSize, colour,
            alpha = 1, endColour = colour, gravity = 0, emissive = false) */
    spawn(x, y, z, vx, vy, vz, life, s0, s1, hex, alpha, hex2, grav, emissive) {
      if (this.density < 1 && Math.random() > this.density) return;
      let i = -1;
      for (let k = 0; k < this.max; k++) { const j = (this.cursor + k) % this.max; if (!this.alive[j]) { i = j; break; } }
      if (i < 0) i = this.cursor;          // pool full: recycle the slot we point at
      this.cursor = (i + 1) % this.max;
      const i3 = i * 3;
      this.alive[i] = 1;
      this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
      this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
      _c.setHex(hex); this.c0[i3] = _c.r; this.c0[i3 + 1] = _c.g; this.c0[i3 + 2] = _c.b;
      if (hex2 !== undefined && hex2 !== null) _c.setHex(hex2);
      this.c1[i3] = _c.r; this.c1[i3 + 1] = _c.g; this.c1[i3 + 2] = _c.b;
      this.age[i] = 0; this.life[i] = life; this.s0[i] = s0 * this.scale; this.s1[i] = s1 * this.scale;
      if (emissive) { this.spin[i] = (Math.random() - 0.5) * 0.35; this.spinV[i] = 0; }      // flames stay upright
      else { this.spin[i] = Math.random() * 6.283; this.spinV[i] = (Math.random() - 0.5) * 1.2 * this.spinRate; }
      this.alpha[i] = alpha === undefined ? 1 : alpha; this.grav[i] = grav || 0; this.emit[i] = emissive ? 1 : 0;
    }
    // A ring of dust around a footprint (construction, demolition, collapse).
    burst(x, y, z, radius, n, hex, rise) {
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + Math.random() * 0.4, r = radius * (0.7 + Math.random() * 0.4);
        this.spawn(x + Math.cos(a) * r, y + 0.04, z + Math.sin(a) * r, Math.cos(a) * 0.25, (rise || 0.25) + Math.random() * 0.15, Math.sin(a) * 0.25, 0.7 + Math.random() * 0.4, 0.06, 0.2, hex, 0.8);
      }
    }
    update(dt) {
      const sm = this.sm, P = sm.pos, C = sm.col, R = sm.rot;
      const drag = Math.exp(-dt * 1.5);
      let n = 0;
      for (let i = 0; i < this.max; i++) {
        if (!this.alive[i]) continue;
        const a = (this.age[i] += dt), k = a / this.life[i];
        if (k >= 1) { this.alive[i] = 0; continue; }
        const i3 = i * 3, g = this.grav[i];
        if (g) { this.v[i3 + 1] -= g * dt; }
        else { this.v[i3] *= drag; this.v[i3 + 2] *= drag; this.p[i3] += this.windX * dt * Math.min(1, a); this.p[i3 + 2] += this.windZ * dt * Math.min(1, a); }
        this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
        if (g && this.p[i3 + 1] < 0) { this.alive[i] = 0; continue; }   // a drop fell back into the sea
        // grow (or shrink) towards the end size, fade in quickly and out gently
        const size = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(k);
        const fade = Math.min(1, a / Math.min(this.fadeIn, this.life[i] * 0.2)) * (k > 0.45 ? 1 - (k - 0.45) / 0.55 : 1);
        const n4 = n * 4;
        P[n4] = this.p[i3]; P[n4 + 1] = this.p[i3 + 1]; P[n4 + 2] = this.p[i3 + 2]; P[n4 + 3] = size;
        C[n4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * k;
        C[n4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * k;
        C[n4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * k;
        C[n4 + 3] = this.alpha[i] * fade + (this.emit[i] ? 2 : 0);
        R[n] = this.spin[i] + this.spinV[i] * a;
        n++;
      }
      upload(sm, n);
      this.n = n;
    }
    setTheme(th) { setSpriteTheme(this.mat, th); if (this.untinted) this.mat.uniforms.uTint.value.setRGB(1, 1, 1); }
    // Fog distances change every frame on Fogbound islands.
    setFog(near, far) { this.mat.uniforms.uFogNear.value = near; this.mat.uniforms.uFogFar.value = far; }
    clear() { this.alive.fill(0); this.n = 0; upload(this.sm, 0); }
    dispose() { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.sm.geo.dispose(); this.mat.dispose(); }
  }

  /* ---------- immediate-mode glows ---------- */
  class Glows {
    constructor(scene, max, flat, order) {
      this.max = max;
      this.mat = spriteMaterial(true, flat);
      this.sm = spriteMesh(scene, max, this.mat, order || 4);
      this.mesh = this.sm.mesh; this.n = 0;
    }
    begin() { this.n = 0; }
    add(x, y, z, size, hex, alpha) {
      if (this.n >= this.max) return;
      const n4 = this.n * 4, P = this.sm.pos, C = this.sm.col;
      _d.setHex(hex);
      P[n4] = x; P[n4 + 1] = y; P[n4 + 2] = z; P[n4 + 3] = size;
      C[n4] = _d.r; C[n4 + 1] = _d.g; C[n4 + 2] = _d.b; C[n4 + 3] = alpha;
      this.sm.rot[this.n] = 0;
      this.n++;
    }
    end() { upload(this.sm, this.n); }
    setTheme(th) { setSpriteTheme(this.mat, th); }
    setFog(near, far) { this.mat.uniforms.uFogNear.value = near; this.mat.uniforms.uFogFar.value = far; }
    clear() { this.n = 0; upload(this.sm, 0); }
    dispose() { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.sm.geo.dispose(); this.mat.dispose(); }
  }

  /* ---------- rings ----------
     Additive blending lets a ring fade by dimming its colour to black, so one draw call covers
     them all. */
  class Rings {
    // inner: inner radius as a fraction of the outer one (thin ripples use ~0.93)
    constructor(scene, max, inner) {
      this.max = max;
      this.mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
      this.mesh = new THREE.InstancedMesh(new THREE.RingGeometry(inner || 0.82, 1, 32).rotateX(-Math.PI / 2), this.mat, max);
      this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, _c.set(0xffffff));
      scene.add(this.mesh);
      const f = n => new Float32Array(max * n);
      this.pos = f(3); this.col = f(3); this.age = f(1); this.life = f(1); this.r0 = f(1); this.r1 = f(1);
      this.alive = new Uint8Array(max); this.cursor = 0; this.n = 0;
    }
    spawn(x, y, z, r0, r1, life, hex) {
      let i = -1;
      for (let k = 0; k < this.max; k++) { const j = (this.cursor + k) % this.max; if (!this.alive[j]) { i = j; break; } }
      if (i < 0) i = this.cursor;
      this.cursor = (i + 1) % this.max;
      this.alive[i] = 1; this.age[i] = 0; this.life[i] = life; this.r0[i] = r0; this.r1[i] = r1;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      _c.setHex(hex); this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
    }
    update(dt) {
      let n = 0;
      for (let i = 0; i < this.max; i++) {
        if (!this.alive[i]) continue;
        const k = (this.age[i] += dt) / this.life[i];
        if (k >= 1) { this.alive[i] = 0; continue; }
        const e = 1 - (1 - k) * (1 - k), r = this.r0[i] + (this.r1[i] - this.r0[i]) * e, f = 1 - k;
        _p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); _q.identity(); _s.set(r, 1, r);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        this.mesh.setColorAt(n, _c.setRGB(this.col[i * 3] * f, this.col[i * 3 + 1] * f, this.col[i * 3 + 2] * f));
        n++;
      }
      this.mesh.count = n; this.mesh.visible = n > 0; this.n = n;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    clear() { this.alive.fill(0); this.mesh.count = 0; this.n = 0; }
    dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); this.mat.dispose(); }
  }

  R3.Particles = Particles;
  R3.Puffs = Particles;      // older name, same thing
  R3.Glows = Glows;
  R3.Rings = Rings;
  R3.spriteTexture = spriteTexture;
})(window.R3);
