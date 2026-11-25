'use strict';
/* Buildings (Phase 1): one simple, recognisable model per type, plus a ruin.
   Phase 2 replaces these with tiered models, batching, fire and construction animation. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  // Rough height of each building above its tile, used by picking.
  const HEIGHT = { hall: 0.95, cottage: 0.62, lumber: 0.42, barracks: 0.6, tower: 1.35, palisade: 0.42, market: 0.55, ruin: 0.25 };

  function model(type) {
    const mb = new R3.MeshBuilder();
    switch (type) {
      case 'hall':
        mb.box(-0.42, 0, -0.26, 0.42, 0.34, 0.26, { top: T.wallShade, side: T.wall });
        for (const x of [-0.42, -0.14, 0.14, 0.42]) mb.box(x - 0.025, 0, 0.255, x + 0.025, 0.34, 0.275, T.timber);
        mb.gable(-0.47, -0.31, 0.47, 0.31, 0.32, 0.72, T.hallRoof, T.timber, 'x');
        mb.box(-0.06, 0, 0.26, 0.06, 0.2, 0.285, T.char);
        mb.box(-0.5, 0.66, -0.02, -0.44, 0.84, 0.02, T.gold); mb.box(0.44, 0.66, -0.02, 0.5, 0.84, 0.02, T.gold);
        break;
      case 'cottage':
        mb.box(-0.24, 0, -0.18, 0.24, 0.26, 0.18, { top: T.wallShade, side: T.wall });
        mb.box(-0.05, 0, 0.18, 0.05, 0.15, 0.195, T.timber);
        mb.gable(-0.28, -0.22, 0.28, 0.22, 0.24, 0.52, T.roof, T.wallShade, 'x');
        mb.box(0.1, 0.36, -0.08, 0.17, 0.56, -0.01, T.stoneDark);
        break;
      case 'lumber':
        mb.box(-0.3, 0, -0.22, -0.02, 0.22, 0.1, T.timber);
        mb.gable(-0.33, -0.25, 0.01, 0.13, 0.2, 0.36, T.thatch, T.timber, 'z');
        for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) {
          const x = 0.08 + k * 0.1 + r * 0.05, y = 0.05 + r * 0.085;
          const m = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y, 0.02);
          mb.setMatrix(m).cyl(0, -0.16, 0, 0.045, 0.16, 0.045, 6, { side: T.log, top: T.logEnd }, 'both').setMatrix(null);
        }
        break;
      case 'barracks':
        mb.box(-0.34, 0, -0.22, 0.34, 0.3, 0.22, { top: T.stone, side: T.stone });
        mb.gable(-0.38, -0.26, 0.38, 0.26, 0.28, 0.5, T.slate, T.stoneDark, 'x');
        for (let k = 0; k < 3; k++) mb.box(-0.22 + k * 0.17, 0.1, 0.22, -0.14 + k * 0.17, 0.2, 0.24, [0xc94f3d, 0x3f7fc4, 0xe3b04b][k]);
        break;
      case 'tower':
        mb.box(-0.14, 0, -0.14, 0.14, 0.9, 0.14, { top: T.stone, side: T.stone });
        mb.box(-0.21, 0.88, -0.21, 0.21, 0.96, 0.21, T.timber);
        for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) mb.cbox(x, 0.96, z, 0.04, 0.14, 0.04, T.timber);
        mb.pyramid(-0.25, -0.25, 0.25, 0.25, 1.1, 1.35, [T.roof, T.roofDark, T.roof, T.roofDark]);
        break;
      case 'palisade':
        for (let k = 0; k < 4; k++) {
          const x = -0.36 + k * 0.24;
          mb.cyl(x, 0, 0, 0.07, 0.32, 0.07, 6, k % 2 ? T.log : T.timber, false);
          mb.cyl(x, 0.32, 0, 0.07, 0.42, 0, 6, T.logEnd, false);
        }
        mb.box(-0.45, 0.16, -0.08, 0.45, 0.21, -0.05, T.timber);
        break;
      case 'market':
        for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) mb.cbox(x, 0, z, 0.04, 0.34, 0.04, T.timber);
        mb.box(-0.27, 0, -0.17, 0.27, 0.14, 0.17, T.log);
        for (let k = 0; k < 6; k++) mb.box(-0.34 + k * 0.1133, 0.33, -0.26, -0.34 + (k + 1) * 0.1133, 0.38, 0.26, k % 2 ? T.canvas : T.roof);
        mb.box(-0.18, 0.14, -0.05, -0.06, 0.22, 0.05, T.gold);
        mb.box(0.04, 0.14, -0.05, 0.16, 0.22, 0.05, 0x6fa35a);
        break;
      default: // ruin
        mb.box(-0.3, 0, -0.22, 0.3, 0.08, 0.22, T.ruin);
        mb.box(-0.22, 0, -0.16, -0.16, 0.25, -0.1, T.char);
        mb.box(0.12, 0, 0.05, 0.18, 0.18, 0.11, T.char);
        mb.gable(-0.1, -0.12, 0.2, 0.12, 0.08, 0.16, T.char, T.ruin, 'x');
    }
    return mb.geometry();
  }

  class Buildings {
    constructor(scene) {
      this.scene = scene; this.mat = R3.flatMaterial(); this.geo = {}; this.meshes = new Map();
      this.byTile = new Map();
      this.group = new THREE.Group(); scene.add(this.group);
    }
    geometryFor(type) { return this.geo[type] || (this.geo[type] = model(type)); }
    // Extra height on a tile for picking (0 if empty).
    heightOn(tx, tz) {
      const b = this.byTile.get(tz * MAP_W + tx);
      return b ? R3.Terrain.tileTop(tx, tz) + HEIGHT[b.ruined ? 'ruin' : b.type] : -99;
    }
    sync() {
      const seen = this.seen || (this.seen = new Set());
      seen.clear(); this.byTile.clear();
      for (const b of G.buildings) { seen.add(b.id); this.byTile.set(b.y * MAP_W + b.x, b); }
      const at = (x, z) => (inMap(x, z) ? this.byTile.get(z * MAP_W + x) : null);
      for (const b of G.buildings) {
        const type = b.ruined ? 'ruin' : b.type;
        let m = this.meshes.get(b.id);
        if (!m) {
          m = new THREE.Mesh(this.geometryFor(type), this.mat);
          m.castShadow = true; m.receiveShadow = true;
          m.userData.type = type;
          this.meshes.set(b.id, m); this.group.add(m);
          // Face the long side to the south by default, palisades along their run.
          m.rotation.y = 0;
        }
        if (m.userData.type !== type) { m.geometry = this.geometryFor(type); m.userData.type = type; }
        const s = 1 + Math.min(4, b.lvl - 1) * 0.05;
        m.scale.set(s, s, s);
        m.position.set(b.x + 0.5, R3.Terrain.heightAt(b.x + 0.5, b.y + 0.5), b.y + 0.5);
        if (b.type === 'palisade') {
          const pal = o => o && o.type === 'palisade';
          const ew = pal(at(b.x - 1, b.y)) || pal(at(b.x + 1, b.y)), ns = pal(at(b.x, b.y - 1)) || pal(at(b.x, b.y + 1));
          m.rotation.y = ns && !ew ? Math.PI / 2 : 0;
        }
      }
      for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); this.meshes.delete(id); }
    }
    clear() { for (const m of this.meshes.values()) this.group.remove(m); this.meshes.clear(); this.byTile.clear(); }
    dispose() { this.clear(); for (const k in this.geo) this.geo[k].dispose(); this.geo = {}; this.mat.dispose(); }
  }

  R3.Buildings = Buildings;
  R3.BUILDING_HEIGHT = HEIGHT;
})(window.R3);
