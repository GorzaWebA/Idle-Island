'use strict';
/* Picking: turns a screen point into a sim tile.
   Each tile is treated as a column box (seabed up to its surface, plus any building on it),
   so a ray that hits a cliff face or a roof picks the tile you can see. */
window.R3 = window.R3 || {};
(function (R3) {
  const _ndc = new THREE.Vector2(), _p = new THREE.Vector3();

  class Picker {
    constructor(camera, dom) {
      this.camera = camera; this.dom = dom;
      this.ray = new THREE.Raycaster();
      this.extraTop = null;     // (tx, tz) -> height of anything standing on the tile
    }
    setRay(mx, my) {
      const w = Math.max(1, this.dom.clientWidth), h = Math.max(1, this.dom.clientHeight);
      _ndc.set(mx / w * 2 - 1, -(my / h) * 2 + 1);
      this.ray.setFromCamera(_ndc, this.camera);
      return this.ray.ray;
    }
    // Slab test of ray against the box [x0,x1]x[y0,y1]x[z0,z1]; returns entry distance or -1.
    static hitBox(o, d, x0, y0, z0, x1, y1, z1) {
      let tmin = -Infinity, tmax = Infinity;
      for (let a = 0; a < 3; a++) {
        const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
        const lo = a === 0 ? x0 : a === 1 ? y0 : z0, hi = a === 0 ? x1 : a === 1 ? y1 : z1;
        if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return -1; continue; }
        let t1 = (lo - oa) / da, t2 = (hi - oa) / da;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
      return tmax < 0 ? -1 : Math.max(0, tmin);
    }
    tile(mx, my) {
      const r = this.setRay(mx, my), o = r.origin, d = r.direction;
      let best = null, bt = Infinity;
      for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) {
        let top = R3.Terrain.tileTop(x, z);
        if (this.extraTop) top = Math.max(top, this.extraTop(x, z));
        const t = Picker.hitBox(o, d, x, R3.Terrain.SEABED, z, x + 1, top, z + 1);
        if (t >= 0 && t < bt) { bt = t; best = { x, y: z }; }
      }
      return best;
    }
    // Point where the ray meets the horizontal plane y = h.
    ground(mx, my, h) {
      const r = this.setRay(mx, my);
      const y = h === undefined ? R3.Terrain.GRASS : h;
      if (Math.abs(r.direction.y) < 1e-6) return null;
      const t = (y - r.origin.y) / r.direction.y;
      if (t < 0) return null;
      return r.at(t, new THREE.Vector3());
    }
    // World point to CSS pixels relative to the canvas. `out.behind` is true when behind the camera.
    project(x, y, z, out) {
      out = out || {};
      _p.set(x, y, z).project(this.camera);
      out.x = (_p.x + 1) / 2 * this.dom.clientWidth;
      out.y = (1 - _p.y) / 2 * this.dom.clientHeight;
      out.behind = _p.z > 1;
      return out;
    }
  }

  R3.Picker = Picker;
})(window.R3);
