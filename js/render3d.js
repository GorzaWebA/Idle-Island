'use strict';
/* 3D renderer: scene, lights, loop hooks, resize and the VIEW interface.
   VIEW is what the rest of the game talks to; js/render.js provides the same interface in 2D
   as a fallback when WebGL is unavailable.

   VIEW interface
     kind                      '3d' or '2d'
     canvas                    the element taps are measured against
     init(stage) -> bool       false if this renderer can't run here
     resize()                  stage size changed
     beforeStep()              called before every fixed sim step (for interpolation)
     frame(dt, alpha)          draw; alpha = fraction of the way to the next sim step
     pickTile(mx, my)          -> {x, y} sim tile under a canvas point, or null
     pickSquadAt(mx, my, touch)-> squad whose soldier is under the point, or null
     tileToScreen(x, y)        -> {x, y} canvas point at the centre of a tile's surface
     zoomBy(f), canZoomOut(), recentre()
     bindInput(callbacks)      3D only: camera gestures and taps
*/
window.R3 = window.R3 || {};
(function (R3) {
  const MIST = 16;             // mist banks drifting round a Fogbound island

  /* Quality levels. Explicit choices in Settings (shadows, pixel ratio, particles) override the
     level's own value; "auto" follows it. Phones get a lower pixel-ratio ceiling. */
  const LEVELS = ['low', 'medium', 'high'];
  function preset(level, mobile) {
    if (level === 'low') return { dpr: 1, shadows: false, shadowSize: 512, soft: false, particles: 0.45, detail: false };
    if (level === 'medium') return { dpr: mobile ? 1.25 : 1.5, shadows: true, shadowSize: 1024, soft: false, particles: 0.75, detail: true };
    return { dpr: mobile ? 1.5 : 2, shadows: true, shadowSize: mobile ? 1024 : 2048, soft: true, particles: 1, detail: true };
  }
  const DENSITY = { low: 0.4, medium: 0.7, high: 1 };

  /* Auto quality: watch the median frame time over 5-second windows after a short warm-up and
     step down when it's slow or up when there's plenty of headroom. It can step up at most once,
     never steps up again after stepping down, and stops watching after a few windows, so it
     never flickers between levels. */
  class AutoQuality {
    constructor(start) {
      this.level = start; this.history = [start]; this.samples = []; this.t = 0; this.windows = 0;
      this.done = false; this.wentDown = false; this.wentUp = false; this.last = 0;
    }
    // Returns a new level when it decides to change, else null.
    tick(now) {
      if (this.done) return null;
      const gap = this.last ? now - this.last : 0;
      this.last = now;
      if (!gap || gap > 250) return null;              // first frame, or the tab was away
      this.t += gap / 1000;
      if (this.t < AUTO_WARM) return null;             // shaders compiling, textures uploading
      this.samples.push(gap);
      if (this.t < AUTO_WARM + AUTO_WINDOW) return null;
      const s = this.samples.sort((a, b) => a - b), med = s[s.length >> 1];
      this.samples = []; this.t = 0; this.windows++;
      const i = LEVELS.indexOf(this.level);
      let next = null;
      if (med > (this.level === 'high' ? 22 : 36) && i > 0) { next = LEVELS[i - 1]; this.wentDown = true; }
      else if (med < 17.5 && i < LEVELS.length - 1 && !this.wentDown && !this.wentUp) { next = LEVELS[i + 1]; this.wentUp = true; }
      if (next) { this.level = next; this.history.push(next); }
      this.median = med;
      if (!next || this.windows >= 3 || (this.wentDown && this.wentUp)) this.done = true;
      return next;
    }
  }
  const AUTO_WARM = 1, AUTO_WINDOW = 5;
  const SUN_SWING = 0.32, SUN_PERIOD = 720;    // the sun's slow drift: radians either way, seconds
  const _sun = new THREE.Vector3();

  const view = {
    kind: '3d', canvas: null, stage: null,
    renderer: null, scene: null, camera: null, rig: null, picker: null,
    terrain: null, sea: null, props: null, buildings: null, units: null, overlay: null, puffs: null,
    wind: { value: 0 },
    sun: null, hemi: null, map: null, time: 0, mobile: false, dprCap: 2,

    init(stage) {
      const canvas = document.createElement('canvas');
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        if (!renderer.getContext()) throw new Error('no context');
      } catch (e) { return false; }
      const old = document.getElementById('cv');
      canvas.id = 'cv';
      canvas.setAttribute('aria-label', 'The island');
      if (old) old.replaceWith(canvas); else stage.prepend(canvas);
      stage.classList.add('is-3d');
      this.stage = stage; this.canvas = canvas; this.renderer = renderer;

      let coarse = false;
      try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* old browser */ }
      this.mobile = coarse || window.innerWidth < 760;
      this.dprCap = this.mobile ? 1.5 : 2;
      this.auto = new AutoQuality(this.mobile ? 'medium' : 'high');

      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.Fog(0xffffff, 30, 80);
      this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);

      this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
      this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
      this.sun.castShadow = true;
      const size = this.mobile ? 1024 : 2048;
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.025;
      this.scene.add(this.hemi, this.sun, this.sun.target);

      this.rig = new R3.CameraRig(this.camera, canvas);
      this.picker = new R3.Picker(this.camera, canvas);
      this.rig.groundPick = (mx, my) => this.picker.ground(mx, my);
      // effects: smoke/dust/flames, additive sparks, firelight on the ground, glowing lights, rings
      this.puffs = new R3.Particles(this.scene, this.mobile ? 360 : 640, { scale: 1.4 });
      this.sparks = new R3.Particles(this.scene, this.mobile ? 120 : 220, { glow: true, scale: 1.6, order: 5 });
      this.glow = new R3.Glows(this.scene, 48, true, 2);
      this.lights = new R3.Glows(this.scene, 160, false, 5);
      this.foam = new R3.Particles(this.scene, this.mobile ? 120 : 200, { flat: true, scale: 1.5, order: 2 });
      this.mist = new R3.Particles(this.scene, MIST + 4, { flat: true, fadeIn: 6, untinted: true, spin: 0.06, order: 6 });
      this.rings = new R3.Rings(this.scene, 48);
      this.ripples = new R3.Rings(this.scene, this.mobile ? 64 : 96, 0.93);
      const fx = this.fx = { puffs: this.puffs, sparks: this.sparks, foam: this.foam, mist: this.mist, glow: this.glow, lights: this.lights, rings: this.rings, ripples: this.ripples };
      this.propMats = R3.Props.materials(this.wind);
      this.buildings = new R3.Buildings(this.scene, fx);
      this.picker.extraTop = (x, z) => this.buildings.heightOn(x, z);
      this.units = new R3.Units(this.scene, fx);
      this.units.onBossHit = a => this.rig.shake(a);
      this.units.boats.onBoss = (x, z) => { this.bossNudges = (this.bossNudges || 0) + (this.rig.nudge(x, z) ? 1 : 0); };
      this.missiles = new R3.Missiles(this.scene, fx);
      this.overlay = new R3.Overlay(this.scene, this.buildings, this.picker, this.units);
      this.hud = new R3.Hud(this);
      this.occupied = tile => this.buildings.byTile.has(tile);

      this.buildIsland();
      this.applyTheme();
      this.applySettings();
      this.resize();
      this.rig.recentre(true);
      if (typeof onSettingsChange === 'function') onSettingsChange(() => this.applySettings());

      // Follow the page theme (system setting or the explicit data-theme attribute).
      try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme()); } catch (e) { /* old browser */ }
      try { new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* no observer */ }
      return true;
    },

    // (Re)build everything that depends on the island. Old GPU resources are disposed.
    buildIsland() {
      if (this.terrain) { this.scene.remove(this.terrain.group); this.terrain.dispose(); }
      if (this.sea) { this.scene.remove(this.sea.mesh); this.sea.dispose(); }
      if (this.props) { this.scene.remove(this.props.group); this.props.dispose(); }
      this.buildings.clear(); this.units.clear();
      for (const k in this.fx) this.fx[k].clear();
      this.map = MAP;
      this.terrain = R3.Terrain.build();
      this.sea = R3.Sea.build(this.theme());
      this.props = R3.Props.build(this.propMats);
      this.scene.add(this.terrain.group, this.sea.mesh, this.props.group);
      this.applyDetail();
      const b = R3.Terrain.landBounds();
      this.rig.setBounds(b);
      this.applyTheme();
      this.rig.recentre(true);
    },

    // The level in use: the player's choice, or what auto quality settled on.
    qualityLevel() {
      const q = typeof SETTINGS !== 'undefined' ? SETTINGS.quality : 'auto';
      return q === 'auto' ? this.auto.level : q;
    },

    // Apply quality and the other settings that touch the renderer. Cheap when nothing changed.
    applySettings() {
      const S = typeof SETTINGS !== 'undefined' ? SETTINGS : { shadows: 'auto', pixelRatio: 'auto', particles: 'auto', autoRotate: false };
      const level = this.qualityLevel(), P = preset(level, this.mobile);
      this.level = level;
      // shadows: switching them (or their filter) needs the lit materials recompiled
      const shadows = S.shadows === 'auto' ? P.shadows : S.shadows === 'on';
      const type = P.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap, sm = this.renderer.shadowMap;
      if (sm.enabled !== shadows || sm.type !== type) {
        sm.enabled = shadows; sm.type = type;
        this.scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
      }
      this.sun.castShadow = shadows;
      if (this.sun.shadow.mapSize.x !== P.shadowSize) {
        this.sun.shadow.mapSize.set(P.shadowSize, P.shadowSize);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      // resolution
      const cap = S.pixelRatio === 'auto' ? P.dpr : +S.pixelRatio;
      if (cap !== this.dprCap) { this.dprCap = cap; this.resize(); }
      // effects and small details
      const dens = S.particles === 'auto' ? P.particles : DENSITY[S.particles];
      for (const k of ['puffs', 'sparks', 'foam']) this.fx[k].density = dens;
      this.detail = P.detail;
      this.applyDetail();
      // camera comfort
      this.rig.autoRotate = !!S.autoRotate;
      this.rig.reducedMotion = typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : this.rig.reducedMotion;
      this.shadows = shadows; this.density = dens;
    },
    // Grass tufts and flowers are left out at Low quality.
    applyDetail() {
      if (!this.props) return;
      for (const k of ['tufts', 'flowers']) { const set = this.props.sets[k]; set.mesh.visible = this.detail !== false && set.items.length > 0; }
    },

    // The light/dark settings for this island (Fogbound has its own sky).
    theme() { return THEME3D.forIsland(MAP ? MAP.trait : null); },

    /* Point the sun at the island and fit its shadow box tightly around it. The sun swings
       slowly round over the minutes (angle in radians around the vertical). */
    fitSun(b, angle) {
      const th = this.theme(), d = _sun.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle || 0);
      if (this.sea) this.sea.setSun(d);
      const c = new THREE.Vector3(b.cx, 0.3, b.cz);
      this.sun.target.position.copy(c);
      this.sun.position.copy(c).addScaledVector(d, 30);
      const half = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2 + 1.5;
      const cam = this.sun.shadow.camera;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 5; cam.far = 60;
      cam.updateProjectionMatrix();
      this.sun.target.updateMatrixWorld();
    },

    applyTheme() {
      const th = this.theme();
      this.scene.background = new THREE.Color(th.sky);
      this.foggy = !!th.foggy;
      this.scene.fog.color.setHex(th.fog); this.scene.fog.near = th.fogNear; this.scene.fog.far = th.fogFar;
      this.hemi.color.setHex(th.hemiSky); this.hemi.groundColor.setHex(th.hemiGround); this.hemi.intensity = th.hemiIntensity;
      this.sun.color.setHex(th.sun); this.sun.intensity = th.sunIntensity;
      if (this.sea) this.sea.setTheme(th);
      for (const k of ['puffs', 'sparks', 'foam', 'mist', 'glow', 'lights']) this.fx[k].setTheme(th);
      this.buildings.dusk = th.name === 'dark';
      this.mistCol = th.mist || th.fog;
      this.mist.clear();
      if (this.terrain) { this.bounds = R3.Terrain.landBounds(); this.fitSun(this.bounds, this.sunAngle()); }
    },
    sunAngle() { return Math.sin(this.time * Math.PI * 2 / SUN_PERIOD) * SUN_SWING; },

    /* Fogbound: fog that closes in around the camera (so zooming in clears the view a little)
       and banks of mist drifting over the water. */
    weather(dt) {
      if (!this.foggy) return;
      const d = this.rig.dist, near = d * 0.75 + 2, far = d * 1.9 + 9;
      this.scene.fog.near = near; this.scene.fog.far = far;
      this.sea.setFog(near, far);
      for (const k of ['puffs', 'sparks', 'foam', 'glow', 'lights']) this.fx[k].setFog(near, far);
      if (this.mist.n < MIST && (this.mistT = (this.mistT || 0) - dt) <= 0) {
        this.mistT = 0.4;
        const b = this.bounds, rx = (b.x1 - b.x0) / 2 + 3, rz = (b.z1 - b.z0) / 2 + 3;
        const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 0.7;
        const s = 4 + Math.random() * 5;
        this.mist.spawn(b.cx + Math.cos(a) * rx * r, 0.22 + Math.random() * 0.24, b.cz + Math.sin(a) * rz * r, 0.12 + Math.random() * 0.1, 0, 0.04 + Math.random() * 0.06,
          35 + Math.random() * 25, s, s * 1.3, this.mistCol, 0.3 + Math.random() * 0.15);
      }
    },

    resize() {
      if (!this.renderer) return;
      const r = this.stage.getBoundingClientRect(), w = Math.max(100, Math.floor(r.width)), h = Math.max(100, Math.floor(r.height));
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap));
      this.renderer.setSize(w, h, false);
      this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      const atFit = Math.abs(this.rig.gDist - this.rig.fitDist) < 0.01;
      this.rig.computeFit();
      if (atFit) this.rig.gDist = this.rig.fitDist;
      this.rig.clampGoals();
    },

    beforeStep() { this.units.snapshot(); },

    frame(dt, alpha) {
      if (this.map !== MAP) this.buildIsland();
      const now = performance.now();
      if (this.lastNow) this.hud.sample(now - this.lastNow);
      this.lastNow = now;
      if (typeof SETTINGS === 'undefined' || SETTINGS.quality === 'auto') {
        if (this.auto.tick(now)) this.applySettings();
      }
      this.time += dt;
      this.wind.value = this.time;
      this.rig.update(dt);
      this.sea.update(this.time);
      if ((this.sunT = (this.sunT || 0) - dt) <= 0) { this.sunT = 0.5; this.fitSun(this.bounds, this.sunAngle()); }
      this.weather(dt);
      this.glow.begin(); this.lights.begin();
      this.buildings.eye.copy(this.camera.position);
      this.buildings.sync(dt);
      let key = G.buildings.length;
      for (const b of G.buildings) key = (key * 31 + b.y * MAP_W + b.x + 1) | 0;
      this.props.update(key, this.occupied);
      this.units.sync(alpha === undefined ? 1 : alpha, dt);
      this.missiles.sync(alpha === undefined ? 1 : alpha, dt);
      this.puffs.update(dt); this.sparks.update(dt); this.foam.update(dt); this.mist.update(dt); this.rings.update(dt); this.ripples.update(dt);
      this.glow.end(); this.lights.end();
      this.overlay.update(dt);
      this.renderer.render(this.scene, this.camera);
      const info = this.renderer.info.render;
      this.lastCalls = info.calls; this.lastTris = info.triangles;
      this.hud.update(dt);
    },

    pickTile(mx, my) { return this.picker.tile(mx, my); },

    pickSquadAt(mx, my, touch) {
      if (!RT) return null;
      const rad = touch ? 26 : 16;
      let best = null, bd = rad * rad;
      const out = this._pp || (this._pp = {});
      for (const u of RT.units) {
        if (u.side !== 0 || !u.alive) continue;
        const st = this.units.posOf(u);
        if (!st) continue;
        this.picker.project(st.x, st.gy + 0.1, st.z, out);
        if (out.behind) continue;
        const d = (out.x - mx) * (out.x - mx) + (out.y - my) * (out.y - my);
        if (d < bd) { bd = d; best = u.sq; }
      }
      return best;
    },

    tileToScreen(x, y) {
      const h = isLandTile(x, y) ? R3.Terrain.tileHeight(x, y, 0.5, 0.5) : 0;
      const o = this.picker.project(x + 0.5, h, y + 0.5, {});
      return { x: o.x, y: o.y };
    },

    zoomBy(f) { this.rig.zoomBy(f); },
    canZoomOut() { return this.rig.canZoomOut(); },
    recentre() { this.rig.recentre(false); },
    bindInput(cb) { this.rig.bind(cb); },

    // Test hook: render one frame and sample pixels straight away (the buffer isn't preserved).
    probe() {
      this.renderer.render(this.scene, this.camera);
      const gl = this.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(4), seen = new Set();
      let lum = 0, n = 0;
      for (let j = 1; j < 8; j++) for (let i = 1; i < 8; i++) {
        gl.readPixels(Math.floor(w * i / 8), Math.floor(h * j / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        seen.add(px[0] >> 3 << 10 | px[1] >> 3 << 5 | px[2] >> 3);
        lum += (px[0] + px[1] + px[2]) / 3; n++;
      }
      const info = this.renderer.info.render;
      return { colors: seen.size, meanLum: lum / n, calls: info.calls, triangles: info.triangles };
    },
    stats() { const i = this.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures }; }
  };

  R3.view = view;
})(window.R3);
