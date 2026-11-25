'use strict';
/* MeshBuilder: a tiny helper for procedural low-poly models.
   It emits non-indexed triangles with per-vertex colours; normals come out flat.
   Faces are oriented from an "outward" vector, so winding mistakes can't flip lighting. */
window.R3 = window.R3 || {};
(function (R3) {
  const colCache = new Map();
  // Linear-space THREE.Color for a hex (cached). THREE converts sRGB hex to linear.
  function col(hex) {
    let c = colCache.get(hex);
    if (!c) { c = new THREE.Color(hex); colCache.set(hex, c); }
    return c;
  }
  // Mix two hex colours (or Colors) into a new linear Color.
  function mixCol(a, b, t) {
    const ca = typeof a === 'number' ? col(a) : a, cb = typeof b === 'number' ? col(b) : b;
    return new THREE.Color(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
  }
  function scaleCol(c, f) {
    const cc = typeof c === 'number' ? col(c) : c;
    return new THREE.Color(cc.r * f, cc.g * f, cc.b * f);
  }
  // Deterministic hash in [0,1) for 3 numbers (rounded to 1/1000).
  function hash3(x, y, z) {
    let h = (Math.round(x * 1000) * 374761393 + Math.round(y * 1000) * 668265263 + Math.round(z * 1000) * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  }

  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

  class MeshBuilder {
    constructor() { this.p = []; this.c = []; this.m = null; }
    setMatrix(m) { this.m = m || null; return this; }
    _vert(x, y, z, c) {
      if (this.m) { _v.set(x, y, z).applyMatrix4(this.m); x = _v.x; y = _v.y; z = _v.z; }
      this.p.push(x, y, z);
      const cc = typeof c === 'number' ? col(c) : c;
      this.c.push(cc.r, cc.g, cc.b);
    }
    // Triangle with explicit order (counter-clockwise seen from the front).
    tri(a, b, c, ca, cb, cc) {
      this._vert(a[0], a[1], a[2], ca);
      this._vert(b[0], b[1], b[2], cb === undefined ? ca : cb);
      this._vert(c[0], c[1], c[2], cc === undefined ? ca : cc);
      return this;
    }
    // Convex polygon (fan). `out` is any vector pointing to the visible side.
    // `cols` is one colour or an array matching pts.
    poly(pts, cols, out) {
      _a.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
      _b.set(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]);
      _n.crossVectors(_a, _b);
      const flip = out && (_n.x * out[0] + _n.y * out[1] + _n.z * out[2]) < 0;
      const n = pts.length, colAt = i => (Array.isArray(cols) ? cols[i] : cols);
      for (let i = 1; i < n - 1; i++) {
        if (flip) this.tri(pts[0], pts[i + 1], pts[i], colAt(0), colAt(i + 1), colAt(i));
        else this.tri(pts[0], pts[i], pts[i + 1], colAt(0), colAt(i), colAt(i + 1));
      }
      return this;
    }
    // Axis-aligned box from (x0,y0,z0) to (x1,y1,z1). cols: one colour, or {top, side, bottom}.
    box(x0, y0, z0, x1, y1, z1, cols, skipBottom) {
      const top = cols.top !== undefined ? cols.top : cols, side = cols.side !== undefined ? cols.side : cols;
      const bot = cols.bottom !== undefined ? cols.bottom : side;
      this.poly([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], top, [0, 1, 0]);
      if (!skipBottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], bot, [0, -1, 0]);
      this.poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], side, [1, 0, 0]);
      this.poly([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], side, [-1, 0, 0]);
      this.poly([[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]], side, [0, 0, 1]);
      this.poly([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], side, [0, 0, -1]);
      return this;
    }
    // Centred box helper: centre x/z, base y, sizes.
    cbox(cx, y0, cz, sx, sy, sz, cols, skipBottom) {
      return this.box(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + sy, cz + sz / 2, cols, skipBottom);
    }
    // Gable roof over the rectangle x0..x1, z0..z1 with the ridge along x (axis 'x') or z.
    gable(x0, z0, x1, z1, yEave, yRidge, slopeCol, endCol, axis) {
      if (axis === 'z') {
        const xm = (x0 + x1) / 2;
        this.poly([[x0, yEave, z0], [x0, yEave, z1], [xm, yRidge, z1], [xm, yRidge, z0]], slopeCol, [-1, 1, 0]);
        this.poly([[x1, yEave, z0], [xm, yRidge, z0], [xm, yRidge, z1], [x1, yEave, z1]], slopeCol, [1, 1, 0]);
        this.poly([[x0, yEave, z1], [x1, yEave, z1], [xm, yRidge, z1]], endCol, [0, 0, 1]);
        this.poly([[x0, yEave, z0], [xm, yRidge, z0], [x1, yEave, z0]], endCol, [0, 0, -1]);
      } else {
        const zm = (z0 + z1) / 2;
        this.poly([[x0, yEave, z1], [x1, yEave, z1], [x1, yRidge, zm], [x0, yRidge, zm]], slopeCol, [0, 1, 1]);
        this.poly([[x0, yEave, z0], [x0, yRidge, zm], [x1, yRidge, zm], [x1, yEave, z0]], slopeCol, [0, 1, -1]);
        this.poly([[x1, yEave, z0], [x1, yRidge, zm], [x1, yEave, z1]], endCol, [1, 0, 0]);
        this.poly([[x0, yEave, z0], [x0, yEave, z1], [x0, yRidge, zm]], endCol, [-1, 0, 0]);
      }
      return this;
    }
    // Pyramid roof over a rectangle.
    pyramid(x0, z0, x1, z1, yBase, yTop, cols) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, apex = [cx, yTop, cz];
      const c = i => (Array.isArray(cols) ? cols[i % cols.length] : cols);
      this.poly([[x0, yBase, z1], [x1, yBase, z1], apex], c(0), [0, 1, 1]);
      this.poly([[x1, yBase, z1], [x1, yBase, z0], apex], c(1), [1, 1, 0]);
      this.poly([[x1, yBase, z0], [x0, yBase, z0], apex], c(2), [0, 1, -1]);
      this.poly([[x0, yBase, z0], [x0, yBase, z1], apex], c(3), [-1, 1, 0]);
      return this;
    }
    // Cylinder / cone / frustum around the y axis at (cx, cz). r1 = 0 makes a cone.
    cyl(cx, y0, cz, r0, y1, r1, segs, cols, caps, rot) {
      const side = cols.side !== undefined ? cols.side : cols, top = cols.top !== undefined ? cols.top : side;
      const a0 = rot || 0, ring = (r, y) => {
        const pts = [];
        for (let i = 0; i < segs; i++) { const a = a0 + i / segs * Math.PI * 2; pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); }
        return pts;
      };
      const lo = ring(r0, y0), hi = ring(r1, y1);
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % segs, am = a0 + (i + 0.5) / segs * Math.PI * 2, out = [Math.cos(am), (r0 - r1) / Math.max(1e-6, y1 - y0) * 0.5, Math.sin(am)];
        if (r1 <= 1e-6) this.poly([lo[i], lo[j], hi[i]], side, out);
        else if (r0 <= 1e-6) this.poly([lo[i], hi[j], hi[i]], side, out);
        else this.poly([lo[i], lo[j], hi[j], hi[i]], side, out);
      }
      if (caps !== false) {
        if (r1 > 1e-6) this.poly(hi, top, [0, 1, 0]);
        if (r0 > 1e-6 && caps === 'both') this.poly(lo.slice().reverse(), side, [0, -1, 0]);
      }
      return this;
    }
    count() { return this.p.length / 3; }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.computeVertexNormals();   // non-indexed geometry, so these are flat face normals
      g.computeBoundingSphere();
      return g;
    }
  }

  R3.col = col;
  R3.mixCol = mixCol;
  R3.scaleCol = scaleCol;
  R3.hash3 = hash3;
  R3.MeshBuilder = MeshBuilder;
  // One shared flat, vertex-coloured material for all static low-poly geometry.
  R3.flatMaterial = function () {
    return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  };
})(window.R3);
