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
      this.puffs = new R3.Puffs(this.scene, this.mobile ? 240 : 400);
      this.rings = new R3.Rings(this.scene, 48);
      const fx = { puffs: this.puffs, rings: this.rings };
      this.propMats = R3.Props.materials(this.wind);
      this.buildings = new R3.Buildings(this.scene, this.puffs);
      this.picker.extraTop = (x, z) => this.buildings.heightOn(x, z);
      this.units = new R3.Units(this.scene, fx);
      this.units.onBossHit = a => this.rig.shake(a);
      this.missiles = new R3.Missiles(this.scene, fx);
      this.overlay = new R3.Overlay(this.scene, this.buildings, this.picker);
      this.occupied = tile => this.buildings.byTile.has(tile);

      this.buildIsland();
      this.applyTheme();
      this.resize();
      this.rig.recentre(true);

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
      this.buildings.clear(); this.units.clear(); this.puffs.clear(); this.rings.clear();
      this.terrain = R3.Terrain.build();
      this.sea = R3.Sea.build(THEME3D.current());
      this.props = R3.Props.build(this.propMats);
      this.scene.add(this.terrain.group, this.sea.mesh, this.props.group);
      const b = R3.Terrain.landBounds();
      this.rig.setBounds(b);
      this.fitSun(b);
      this.map = MAP;
      this.rig.recentre(true);
    },

    // Point the sun at the island and fit its shadow box tightly around it.
    fitSun(b) {
      const th = THEME3D.current(), d = new THREE.Vector3(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
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
      const th = THEME3D.current();
      this.scene.background = new THREE.Color(th.sky);
      this.scene.fog.color.setHex(th.fog); this.scene.fog.near = th.fogNear; this.scene.fog.far = th.fogFar;
      this.hemi.color.setHex(th.hemiSky); this.hemi.groundColor.setHex(th.hemiGround); this.hemi.intensity = th.hemiIntensity;
      this.sun.color.setHex(th.sun); this.sun.intensity = th.sunIntensity;
      if (this.sea) this.sea.setTheme(th);
      if (this.terrain) this.fitSun(R3.Terrain.landBounds());
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
      this.time += dt;
      this.wind.value = this.time;
      this.rig.update(dt);
      this.sea.update(this.time);
      this.buildings.sync(dt);
      let key = G.buildings.length;
      for (const b of G.buildings) key = (key * 31 + b.y * MAP_W + b.x + 1) | 0;
      this.props.update(key, this.occupied);
      this.units.sync(alpha === undefined ? 1 : alpha, dt);
      this.missiles.sync(alpha === undefined ? 1 : alpha, dt);
      this.puffs.update(dt);
      this.rings.update(dt);
      this.overlay.update();
      this.renderer.render(this.scene, this.camera);
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
