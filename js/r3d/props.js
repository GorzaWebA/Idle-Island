'use strict';
/* Props: trees, rocks, sea stacks, grass tufts and flowers. Purely decorative.
   Everything is instanced (five draw calls in all). Trees and tufts sway in a shared wind;
   decorations on a tile hide when a building stands there. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // Lambert material whose vertices above the base lean with the wind.
  function swayMaterial(time, amount) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.3;
        #else
          float ph = 0.0;
        #endif
        float lean = max(position.y - 0.06, 0.0) * ${amount.toFixed(3)};
        transformed.x += sin(uTime * 1.5 + ph) * lean + sin(uTime * 4.1 + ph * 2.0) * lean * 0.25;
        transformed.z += cos(uTime * 1.2 + ph) * lean * 0.7;`);
    };
    mat.customProgramCacheKey = () => 'sway' + amount;
    return mat;
  }

  function pineGeometry() {
    const mb = new R3.MeshBuilder();
    mb.cyl(0, -0.02, 0, 0.035, 0.12, 0.03, 5, T.trunk, false);
    mb.cyl(0, 0.08, 0, 0.17, 0.3, 0, 6, T.leafA, false, 0.3);
    mb.cyl(0, 0.2, 0, 0.13, 0.42, 0, 6, T.leafB, false, 0.8);
    mb.cyl(0, 0.31, 0, 0.09, 0.52, 0, 6, T.leafC, false, 0.1);
    return mb.geometry();
  }
  function roundTreeGeometry() {
    const mb = new R3.MeshBuilder();
    mb.cyl(0, -0.02, 0, 0.035, 0.2, 0.025, 5, T.trunk, false);
    const ball = new THREE.IcosahedronGeometry(1, 0);
    mb.addGeo(ball, T.roundLeaf, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.27, 0), new THREE.Quaternion(), new THREE.Vector3(0.16, 0.14, 0.16)));
    mb.addGeo(ball, T.roundLeafLight, new THREE.Matrix4().compose(new THREE.Vector3(0.06, 0.36, -0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, 0)), new THREE.Vector3(0.1, 0.09, 0.1)));
    ball.dispose();
    return mb.geometry();
  }
  function rockGeometry() {
    const mb = new R3.MeshBuilder(), g = new THREE.IcosahedronGeometry(1, 0);
    mb.addGeo(g, 0xffffff); g.dispose();
    return mb.geometry();
  }
  function tuftGeometry() {
    const mb = new R3.MeshBuilder();
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.3;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45)).setPosition(Math.cos(a) * 0.012, 0, Math.sin(a) * 0.012);
      mb.setMatrix(m).cyl(0, -0.01, 0, 0.012, 0.075, 0, 4, 0xffffff, false, a).setMatrix(null);
    }
    return mb.geometry();
  }
  function flowerGeometry() {
    const mb = new R3.MeshBuilder();
    mb.cyl(0, 0, 0, 0.6, 0.35, 0.6, 5, 0xffffff, true);
    mb.cyl(0, 0.35, 0, 0.6, 0.6, 0, 5, 0xffffff, false);
    return mb.geometry();
  }

  // Instanced set that remembers each instance's matrix and tile, so occupied tiles can hide.
  class Scatter {
    constructor(geo, mat, items, opts) {
      this.items = items;
      this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
      this.mesh.count = items.length;
      this.mesh.castShadow = !!opts.shadow; this.mesh.receiveShadow = true;
      this.mats = new Float32Array(items.length * 16);
      items.forEach((it, i) => {
        _p.set(it.x, it.y, it.z);
        _q.setFromEuler(_e.set(it.rx || 0, it.ry || 0, it.rz || 0));
        _s.set(it.sx, it.sy, it.sz);
        _m.compose(_p, _q, _s);
        _m.toArray(this.mats, i * 16);
        this.mesh.setMatrixAt(i, _m);
        this.mesh.setColorAt(i, _c.setHex(it.col || 0xffffff).multiplyScalar(it.tint || 1));
      });
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.mesh.computeBoundingSphere();
    }
    // Hide instances on tiles where occupied(tileIndex) is true.
    occupy(occupied) {
      if (!this.items.length) return;
      this.items.forEach((it, i) => {
        if (occupied(it.tile)) this.mesh.setMatrixAt(i, ZERO);
        else { _m.fromArray(this.mats, i * 16); this.mesh.setMatrixAt(i, _m); }
      });
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); }
  }

  // Materials live as long as the renderer, so a new island never recompiles shaders.
  function materials(time) {
    return { sway: swayMaterial(time, 0.12), swayTuft: swayMaterial(time, 0.5), still: R3.flatMaterial() };
  }

  function build(mats) {
    const seedMix = (MAP.seed % 1000) / 7.3;
    const h = (x, k, z) => R3.hash3(x + seedMix, k, z);
    const pines = [], rounds = [], rocks = [], tufts = [], flowers = [];
    const H = R3.Terrain.heightAt;
    const spot = (tx, tz, k, rMin, rMax) => {
      const a = h(tx, k, tz) * Math.PI * 2, r = rMin + h(tz, k + 50, tx) * (rMax - rMin);
      const x = tx + 0.5 + Math.cos(a) * r, z = tz + 0.5 + Math.sin(a) * r;
      return { x, z, y: H(x, z) };
    };
    const landing = new Set(MAP.landings.map(l => l.wy * MAP_W + l.wx));
    for (let tz = 0; tz < MAP_H; tz++) for (let tx = 0; tx < MAP_W; tx++) {
      const t = tileType(tx, tz), tile = tz * MAP_W + tx;
      if (t === T_WATER) {
        // the odd sea stack off a cliff coast (never near a beach or landing)
        let cliff = false, sand = false;
        for (const [dx, dz] of DIR8) { const n = tileType(tx + dx, tz + dz); if (n === T_GRASS || n === T_HIGH) cliff = true; if (n === T_SAND) sand = true; }
        if (cliff && !sand && !landing.has(tile) && h(tx, 1, tz) < 0.1) {
          const p = spot(tx, tz, 2, 0.05, 0.25), s = 0.16 + h(tx, 3, tz) * 0.14;
          rocks.push({ x: p.x, y: -0.25, z: p.z, sx: s, sy: s * 1.5, sz: s * 0.9, ry: h(tx, 4, tz) * 6, rx: 0.2, col: T.rock, tint: 0.9, tile: -1 });
        }
        continue;
      }
      if (hasTree(tx, tz)) {
        const n = 2 + (h(tx, 7, tz) > 0.55 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const p = spot(tx, tz, 8 + k * 3, 0.08, 0.34);
          const s = 0.8 + h(p.x, 10, p.z) * 0.45, tint = 0.85 + h(p.x, 12, p.z) * 0.3;
          const round = t === T_GRASS && h(p.x, 13, p.z) < 0.35;
          (round ? rounds : pines).push({ x: p.x, y: p.y, z: p.z, sx: s, sy: s * (0.9 + (tint - 0.85)), sz: s, ry: h(p.z, 11, p.x) * 6.28, tint, tile });
        }
      }
      if (t === T_HIGH && h(tx, 20, tz) < 0.45) {
        const n = 1 + (h(tx, 21, tz) > 0.6 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const p = spot(tx, tz, 22 + k, 0.28, 0.42), s = 0.06 + h(p.x, 23, p.z) * 0.07;
          rocks.push({ x: p.x, y: p.y + s * 0.2, z: p.z, sx: s, sy: s * 0.7, sz: s * 0.9, ry: h(p.x, 24, p.z) * 6, rx: 0.3, col: h(p.x, 25, p.z) > 0.5 ? T.rock : T.rockLight, tint: 1, tile });
        }
      } else if (t === T_GRASS && h(tx, 26, tz) < 0.08) {
        const p = spot(tx, tz, 27, 0.25, 0.4), s = 0.05 + h(p.x, 28, p.z) * 0.04;
        rocks.push({ x: p.x, y: p.y + s * 0.2, z: p.z, sx: s, sy: s * 0.65, sz: s, ry: h(p.x, 29, p.z) * 6, col: T.rockLight, tint: 1, tile });
      } else if (t === T_SAND) {
        const n = Math.floor(h(tx, 30, tz) * 3);
        for (let k = 0; k < n; k++) {
          const p = spot(tx, tz, 31 + k, 0.1, 0.45), s = 0.025 + h(p.x, 32, p.z) * 0.025;
          rocks.push({ x: p.x, y: p.y, z: p.z, sx: s, sy: s * 0.6, sz: s, ry: h(p.x, 33, p.z) * 6, col: T.pebble, tint: 1, tile });
        }
      }
      if (t === T_GRASS || t === T_HIGH) {
        const n = t === T_GRASS ? 3 : 1 + (h(tx, 40, tz) > 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const p = spot(tx, tz, 41 + k * 2, 0.18, 0.46), s = 0.75 + h(p.x, 42, p.z) * 0.55;
          tufts.push({ x: p.x, y: p.y, z: p.z, sx: s, sy: s, sz: s, ry: h(p.z, 43, p.x) * 6, col: h(p.x, 44, p.z) > 0.5 ? T.tuft : T.tuftLight, tint: t === T_HIGH ? 0.85 : 1, tile });
        }
      }
      if (t === T_GRASS && !hasTree(tx, tz) && h(tx, 50, tz) < 0.3) {
        const n = 2 + Math.floor(h(tx, 51, tz) * 3), col = T.flowers[Math.floor(h(tx, 52, tz) * T.flowers.length)];
        const c = spot(tx, tz, 53, 0.22, 0.36);
        for (let k = 0; k < n; k++) {
          const x = c.x + (h(tx, 54 + k, tz) - 0.5) * 0.14, z = c.z + (h(tz, 60 + k, tx) - 0.5) * 0.14;
          flowers.push({ x, y: H(x, z) + 0.012, z, sx: 0.028, sy: 0.028, sz: 0.028, ry: k, col, tint: 1, tile });
        }
      }
    }
    const { sway, swayTuft, still } = mats;
    const sets = {
      pines: new Scatter(pineGeometry(), sway, pines, { shadow: true }),
      rounds: new Scatter(roundTreeGeometry(), sway, rounds, { shadow: true }),
      rocks: new Scatter(rockGeometry(), still, rocks, { shadow: true }),
      tufts: new Scatter(tuftGeometry(), swayTuft, tufts, {}),
      flowers: new Scatter(flowerGeometry(), still, flowers, {})
    };
    const group = new THREE.Group();
    for (const k in sets) group.add(sets[k].mesh);
    let lastKey = -1;
    return {
      group, sets,
      counts: { trees: pines.length + rounds.length, rocks: rocks.length, tufts: tufts.length, flowers: flowers.length },
      triangles() { let n = 0; for (const k in sets) n += sets[k].mesh.geometry.attributes.position.count / 3 * sets[k].mesh.count; return n; },
      // Hide decorations under buildings (only when the set of occupied tiles changes).
      update(occupiedKey, occupied) {
        if (occupiedKey === lastKey) return;
        lastKey = occupiedKey;
        for (const k of ['rocks', 'tufts', 'flowers']) sets[k].occupy(occupied);
      },
      dispose() { for (const k in sets) sets[k].dispose(); }
    };
  }

  R3.Props = { build, materials };
})(window.R3);
