'use strict';
/* Terrain: turns the generator's tile grid into a stepped low-poly island.
   World units: 1 tile = 1 unit. X = tile x, Z = tile y, Y up. Sea level is y = 0.
   Tile footprints match the sim exactly; only the look is new. */
window.R3 = window.R3 || {};
(function (R3) {
  const SEABED = -1.1, SAND_LO = -0.06, SAND_HI = 0.16, GRASS = 0.36, HIGH = 0.92;
  const ROW = 0.2;            // wall rows (for colour bands and rock jitter)
  const JIT = 0.055;          // horizontal jitter of grid points
  let T = THEME3D.base;       // swapped for the island's palette on build

  function flatH(t) { return t === T_GRASS ? GRASS : t === T_HIGH ? HIGH : t === T_SAND ? SAND_HI : SEABED; }
  // A sand grid point dips under the water if any tile touching it is sea.
  function sandCorner(gx, gz) {
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) if (tileType(gx + dx, gz + dz) === T_WATER) return SAND_LO;
    return SAND_HI;
  }
  // How far up a slope tile a local point is (0 at its foot, 1 where it meets the highland).
  function slopeK(d, fx, fz) { const dx = DIR4[d][0], dz = DIR4[d][1]; return dx > 0 ? fx : dx < 0 ? 1 - fx : dz > 0 ? fz : 1 - fz; }
  // Height of tile (tx,tz) at local point (fx,fz) in [0,1].
  function tileHeight(tx, tz, fx, fz) {
    const t = tileType(tx, tz), d = rampDir(tx, tz);
    if (d >= 0) return GRASS + (HIGH - GRASS) * slopeK(d, fx, fz);     // a slope up to the highland
    if (t !== T_SAND) return flatH(t);
    const h00 = sandCorner(tx, tz), h10 = sandCorner(tx + 1, tz), h01 = sandCorner(tx, tz + 1), h11 = sandCorner(tx + 1, tz + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }
  // Ground height under a unit at world (x, z). Sea tiles report the water surface.
  function heightAt(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (!isLandTile(tx, tz)) return 0;
    return tileHeight(tx, tz, x - tx, z - tz);
  }
  // Highest surface of a tile column (for picking). Sea is the water surface.
  function tileTop(tx, tz) {
    const t = tileType(tx, tz);
    if (t === T_WATER) return 0;
    if (t === T_SAND) return Math.max(sandCorner(tx, tz), sandCorner(tx + 1, tz), sandCorner(tx, tz + 1), sandCorner(tx + 1, tz + 1));
    if (isRamp(tx, tz)) return HIGH;
    return flatH(t);
  }
  // Shared horizontal jitter of a grid point, so neighbouring faces always meet.
  function jitXZ(x, z) {
    const a = R3.hash3(x, 0.5, z) * Math.PI * 2, r = R3.hash3(z, 1.7, x) * JIT;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  function tint(hex, x, y, z, amt) {
    const n = R3.hash3(x, y, z) - 0.5;
    return R3.scaleCol(hex, 1 + n * amt);
  }

  function buildMesh() {
    const mb = new R3.MeshBuilder();
    const F = [0, 0.5, 1];
    for (let tz = 0; tz < MAP_H; tz++) for (let tx = 0; tx < MAP_W; tx++) {
      const t = tileType(tx, tz);
      if (t === T_WATER) continue;
      // --- top surface: 2x2 quads ---
      const pt = (i, j) => {
        const x = tx + F[i], z = tz + F[j], [jx, jz] = jitXZ(x, z);
        return [x + jx, tileHeight(tx, tz, F[i], F[j]), z + jz];
      };
      const topCol = (i, j, p) => {
        const x = tx + F[i], z = tz + F[j];
        let c;
        const rd = rampDir(tx, tz);
        if (rd >= 0) {
          // a worn earth track up the middle of the slope, grass at its edges
          const across = DIR4[rd][0] !== 0 ? F[j] : F[i];
          const grass = R3.mixCol(T.grass, T.grassDark, 0.35 + R3.hash3(x, 5, z) * 0.3);
          return across === 0.5 ? tint(T.path, x, 6, z, 0.08) : R3.mixCol(grass, T.path, 0.45);
        }
        if (t === T_SAND) c = p[1] < 0.04 ? R3.mixCol(T.sand, T.sandWet, 0.75) : tint(T.sand, x, 1, z, 0.08);
        else if (t === T_GRASS) c = R3.mixCol(T.grass, R3.hash3(x, 2, z) > 0.5 ? T.grassLight : T.grassDark, R3.hash3(x, 3, z) * 0.55);
        else c = R3.mixCol(T.high, T.highDark, R3.hash3(x, 4, z) * 0.45);
        // Baked occlusion: darken vertices that touch a higher neighbouring tile (foot of a cliff).
        const own = tileTop(tx, tz);
        for (const ix of [Math.floor(x - 1e-3), Math.floor(x + 1e-3)]) for (const iz of [Math.floor(z - 1e-3), Math.floor(z + 1e-3)]) {
          if ((ix !== tx || iz !== tz) && isLandTile(ix, iz) && tileTop(ix, iz) > own + 0.05) return R3.scaleCol(c, 0.78);
        }
        return c;
      };
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
        mb.poly([a, b, c, d], [topCol(i, j, a), topCol(i, j + 1, b), topCol(i + 1, j + 1, c), topCol(i + 1, j, d)], [0, 1, 0]);
      }
      // --- walls where a neighbour is lower ---
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dz] of sides) {
        const nx = tx + dx, nz = tz + dz, nt = tileType(nx, nz), sea = nt === T_WATER;
        // the three points along this edge, in this tile's local coords and the neighbour's
        const edge = [0, 0.5, 1].map(s => {
          const fx = dx === 1 ? 1 : dx === -1 ? 0 : s, fz = dz === 1 ? 1 : dz === -1 ? 0 : s;
          const top = tileHeight(tx, tz, fx, fz);
          const bot = sea ? SEABED : tileHeight(nx, nz, fx - dx, fz - dz);
          return { x: tx + fx, z: tz + fz, top, bot: Math.min(bot, top) };
        });
        if (!edge.some(e => e.top - e.bot > 0.005)) continue;
        const maxTop = Math.max(...edge.map(e => e.top)), minBot = Math.min(...edge.map(e => e.bot));
        const rows = Math.max(1, Math.min(9, Math.ceil((maxTop - minBot) / ROW)));
        const vtx = (e, r) => {
          const k = r / rows, y = e.top + (e.bot - e.top) * k;
          const [jx, jz] = jitXZ(e.x, e.z);
          let ox = 0, oz = 0;
          if (r > 0 && r < rows) {
            // Rocky bulge on interior rows only, so top and bottom edges stay sealed. It depends
            // on position alone, so two walls sharing a corner always agree (no cracks).
            ox = (R3.hash3(e.x, y, e.z) - 0.5) * 0.09;
            oz = (R3.hash3(e.z, y, e.x) - 0.5) * 0.09;
          }
          return [e.x + jx + ox, y, e.z + jz + oz];
        };
        const wallCol = (e, r) => {
          const k = r / rows, y = e.top + (e.bot - e.top) * k;
          if (r === 0 && t !== T_SAND) return T.grassDark;                       // grass lip
          if (t === T_SAND && y > -0.25) return R3.mixCol(T.sandWet, T.rockDark, 0.2);
          if (y < -0.05) return R3.mixCol(T.rockDark, T.rockDeep, Math.min(1, -y / 0.9));
          const band = Math.floor((y + 3) / 0.22) % 2 ? T.rock : T.rockLight;
          return tint(R3.mixCol(band, T.rockDark, Math.max(0, 0.35 - y * 0.25)), e.x, y, e.z, 0.12);
        };
        for (let s = 0; s < 2; s++) {
          const e0 = edge[s], e1 = edge[s + 1];
          for (let r = 0; r < rows; r++) {
            const a = vtx(e0, r), b = vtx(e1, r), c = vtx(e1, r + 1), d = vtx(e0, r + 1);
            mb.poly([a, b, c, d], [wallCol(e0, r), wallCol(e1, r), wallCol(e1, r + 1), wallCol(e0, r + 1)], [dx, 0, dz]);
          }
        }
      }
    }
    return mb.geometry();
  }

  function buildSeabed() {
    const mb = new R3.MeshBuilder();
    const x0 = -40, x1 = MAP_W + 40, z0 = -40, z1 = MAP_H + 40;
    mb.poly([[x0, SEABED, z0], [x0, SEABED, z1], [x1, SEABED, z1], [x1, SEABED, z0]], T.seabed, [0, 1, 0]);
    return mb.geometry();
  }

  // Bounds of the land, used by the camera and the sun's shadow box.
  function landBounds() {
    let x0 = MAP_W, x1 = 0, z0 = MAP_H, z1 = 0;
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) {
      if (!isLandTile(x, z)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return { x0, x1: x1 + 1, z0, z1: z1 + 1, cx: (x0 + x1 + 1) / 2, cz: (z0 + z1 + 1) / 2 };
  }

  R3.Terrain = {
    SEABED, GRASS, HIGH, SAND_HI,
    heightAt, tileTop, tileHeight, landBounds,
    build() {
      T = THEME3D.palette(MAP.trait);
      const group = new THREE.Group();
      const mat = R3.flatMaterial();
      const land = new THREE.Mesh(buildMesh(), mat);
      land.castShadow = true; land.receiveShadow = true;
      // Its own shadow-depth material: three.js otherwise shares one between this plain mesh and
      // all the instanced casters, and switches its shader back and forth every frame.
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      land.customDepthMaterial = depth;
      const bed = new THREE.Mesh(buildSeabed(), mat);
      bed.receiveShadow = true;
      group.add(land, bed);
      return {
        group, triangles: land.geometry.attributes.position.count / 3,
        dispose() { land.geometry.dispose(); bed.geometry.dispose(); mat.dispose(); depth.dispose(); }
      };
    }
  };
})(window.R3);
