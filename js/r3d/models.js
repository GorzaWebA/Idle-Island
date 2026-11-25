'use strict';
/* Procedural building models. Every building has three tiers and a ruin; palisades join up
   with their neighbours. Models are built once per variant and cached.
   Local space: origin at the tile centre, y = 0 on the ground, the front faces +z.
   Each model also lists attachment points for animated extras:
     smoke: chimneys, flags: [x, y, z, size], saws: sawing points. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const M4 = () => new THREE.Matrix4();

  /* ---------- small parts ---------- */
  // Log lying along x (from x0 to x1) or along z.
  function logX(mb, x0, x1, y, z, r, col, end) {
    mb.setMatrix(M4().makeRotationZ(-Math.PI / 2).setPosition(x0, y, z))
      .cyl(0, 0, 0, r, x1 - x0, r, 6, { side: col || T.log, top: end || T.logEnd }, 'both').setMatrix(null);
  }
  function logZ(mb, z0, z1, x, y, r, col, end) {
    mb.setMatrix(M4().makeRotationX(Math.PI / 2).setPosition(x, y, z0))
      .cyl(0, 0, 0, r, z1 - z0, r, 6, { side: col || T.log, top: end || T.logEnd }, 'both').setMatrix(null);
  }
  // A thin board tilted around z (for crossed gable ends and braces).
  function plank(mb, cx, cy, cz, len, w, t, angZ, col, angY) {
    const m = M4().makeRotationY(angY || 0).multiply(M4().makeRotationZ(angZ));
    m.setPosition(cx, cy, cz);
    mb.setMatrix(m).box(-len / 2, -w / 2, -t / 2, len / 2, w / 2, t / 2, col).setMatrix(null);
  }
  // Door / window on the +z face at z (or on another face via `face`).
  function door(mb, x, z, w, h, col) { mb.box(x - w / 2, 0, z, x + w / 2, h, z + 0.012, col || T.char); }
  function windowZ(mb, x, y, z, w, h) {
    mb.box(x - w / 2 - 0.012, y - 0.012, z, x + w / 2 + 0.012, y + h + 0.012, z + 0.008, T.timber);
    mb.box(x - w / 2, y, z + 0.004, x + w / 2, y + h, z + 0.013, T.windowDark);
  }
  function chimney(mb, x, z, y0, y1, s) {
    mb.cbox(x, y0, z, s, y1 - y0, s, { top: T.char, side: T.stoneDark });
    mb.cbox(x, y1 - 0.025, z, s + 0.02, 0.025, s + 0.02, T.stone);
  }
  function flagpole(mb, x, z, h) {
    mb.cyl(x, 0, z, 0.014, h, 0.012, 5, T.timber, false);
    mb.cbox(x, h, z, 0.03, 0.03, 0.03, T.gold);
  }
  // Timber-frame strips on a wall face at z, between x0 and x1.
  function frameZ(mb, x0, x1, y0, y1, z, n) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      mb.box(x - 0.012, y0, z, x + 0.012, y1, z + 0.01, T.timber);
    }
    mb.box(x0, (y0 + y1) / 2 - 0.01, z, x1, (y0 + y1) / 2 + 0.01, z + 0.01, T.timber);
  }
  function crenellate(mb, x0, z0, x1, z1, y, h, col) {
    const step = 0.09, w = 0.05;
    for (let x = x0 + 0.03; x <= x1 - 0.02; x += step) { mb.box(x, y, z1 - 0.05, x + w, y + h, z1, col); mb.box(x, y, z0, x + w, y + h, z0 + 0.05, col); }
    for (let z = z0 + 0.03; z <= z1 - 0.02; z += step) { mb.box(x1 - 0.05, y, z, x1, y + h, z + w, col); mb.box(x0, y, z, x0 + 0.05, y + h, z + w, col); }
  }
  function barrel(mb, x, z, r, h) {
    mb.cyl(x, 0, z, r * 0.9, h * 0.5, r, 8, { side: T.barrel, top: T.plank }, false);
    mb.cyl(x, h * 0.5, z, r, h, r * 0.9, 8, { side: T.barrel, top: T.plank });
    mb.cyl(x, h * 0.2, z, r * 0.97 + 0.004, h * 0.26, r * 0.98 + 0.004, 8, T.iron, false);
    mb.cyl(x, h * 0.72, z, r * 0.98 + 0.004, h * 0.78, r * 0.95 + 0.004, 8, T.iron, false);
  }
  function crate(mb, x, z, s, y) {
    const y0 = y || 0;
    mb.cbox(x, y0, z, s, s, s, { top: T.plank, side: T.crate });
  }
  function produce(mb, x, z, y, n) {
    for (let i = 0; i < n; i++) mb.cbox(x + (i % 2) * 0.03 - 0.015, y, z + Math.floor(i / 2) * 0.03 - 0.015, 0.025, 0.025, 0.025, T.produce[i % T.produce.length]);
  }
  function awning(mb, x0, x1, z0, z1, yBack, yFront, stripes) {
    const w = (x1 - x0) / stripes;
    for (let i = 0; i < stripes; i++) {
      const a = x0 + i * w, b = a + w, col = i % 2 ? T.canvas : T.roof;
      mb.poly([[a, yBack, z0], [a, yFront, z1], [b, yFront, z1], [b, yBack, z0]], col, [0, 1, 0.3]);
      mb.poly([[a, yBack - 0.01, z0], [b, yBack - 0.01, z0], [b, yFront - 0.01, z1], [a, yFront - 0.01, z1]], col, [0, -1, 0]);
    }
  }

  /* ---------- buildings ---------- */
  const BUILD = {
    cottage(mb, tier) {
      if (tier === 1) {   // hut
        mb.box(-0.2, 0, -0.16, 0.2, 0.2, 0.16, { top: T.wattle, side: T.wattle });
        door(mb, -0.04, 0.16, 0.09, 0.13);
        mb.gable(-0.25, -0.22, 0.25, 0.22, 0.17, 0.42, T.thatch, T.thatchDark, 'x');
        return { smoke: [[0.02, 0.42, 0]] };
      }
      if (tier === 2) {   // house with a chimney
        mb.box(-0.25, -0.03, -0.19, 0.25, 0.04, 0.19, T.stone);
        mb.box(-0.24, 0.04, -0.18, 0.24, 0.28, 0.18, { top: T.wallShade, side: T.wall });
        frameZ(mb, -0.24, 0.24, 0.04, 0.28, 0.18, 3);
        door(mb, -0.1, 0.18, 0.09, 0.15);
        windowZ(mb, 0.1, 0.13, 0.18, 0.07, 0.07);
        mb.gable(-0.29, -0.23, 0.29, 0.23, 0.26, 0.53, T.roof, T.wallShade, 'x');
        chimney(mb, 0.13, -0.07, 0.3, 0.6, 0.07);
        return { smoke: [[0.13, 0.62, -0.07]] };
      }
      // two storeys
      mb.box(-0.25, -0.03, -0.2, 0.25, 0.2, 0.2, { top: T.stone, side: T.stone });
      door(mb, 0.08, 0.2, 0.09, 0.15);
      windowZ(mb, -0.12, 0.08, 0.2, 0.07, 0.07);
      mb.box(-0.28, 0.2, -0.23, 0.28, 0.38, 0.23, { top: T.wallShade, side: T.wall });
      frameZ(mb, -0.28, 0.28, 0.2, 0.38, 0.23, 4);
      windowZ(mb, -0.07, 0.26, 0.23, 0.07, 0.06);
      windowZ(mb, 0.14, 0.26, 0.23, 0.07, 0.06);
      mb.box(-0.12, 0.24, 0.235, -0.02, 0.26, 0.26, T.timber);
      produce(mb, -0.07, 0.25, 0.26, 2);
      mb.gable(-0.32, -0.27, 0.32, 0.27, 0.36, 0.74, T.roof, T.wallShade, 'x');
      chimney(mb, -0.16, 0.05, 0.42, 0.82, 0.075);
      return { smoke: [[-0.16, 0.84, 0.05]] };
    },

    hall(mb, tier) {
      const wide = tier === 1 ? 0.4 : tier === 2 ? 0.43 : 0.45, deep = tier === 1 ? 0.24 : tier === 2 ? 0.26 : 0.27;
      const base = tier === 3 ? 0.1 : tier === 2 ? 0.05 : 0;
      const wallTop = base + (tier === 1 ? 0.28 : 0.3);
      if (base) mb.box(-wide - 0.02, -0.03, -deep - 0.02, wide + 0.02, base, deep + 0.02, { top: T.stone, side: T.stoneDark });
      mb.box(-wide, base, -deep, wide, wallTop, deep, { top: T.timber, side: T.timber });
      // vertical planks
      for (let i = 0; i <= 8; i++) { const x = -wide + i * (wide * 2 / 8); mb.box(x - 0.008, base, deep, x + 0.008, wallTop, deep + 0.008, T.plank); }
      door(mb, 0, deep, 0.13, base + 0.18, T.char);
      mb.box(-0.08, base, deep, -0.065, base + 0.2, deep + 0.02, T.gold);
      mb.box(0.065, base, deep, 0.08, base + 0.2, deep + 0.02, T.gold);
      mb.box(-0.08, base + 0.19, deep, 0.08, base + 0.21, deep + 0.02, T.gold);
      const ridge = wallTop + (tier === 3 ? 0.3 : 0.36);
      mb.gable(-wide - 0.06, -deep - 0.06, wide + 0.06, deep + 0.06, wallTop - 0.02, ridge, T.hallRoof, T.timber, 'x');
      // ridge beam and crossed gable boards
      mb.box(-wide - 0.06, ridge - 0.01, -0.015, wide + 0.06, ridge + 0.02, 0.015, T.timber);
      for (const sx of [-1, 1]) {
        const x = sx * (wide + 0.07);
        plank(mb, x, ridge + 0.05, 0, 0.22, 0.025, 0.02, 0.75, T.gold, Math.PI / 2);
        plank(mb, x, ridge + 0.05, 0, 0.22, 0.025, 0.02, -0.75, T.gold, Math.PI / 2);
      }
      const flags = [];
      if (tier >= 2) {   // side annex at the back
        mb.box(-0.1, base, -deep - 0.14, 0.2, base + 0.18, -deep, { top: T.timber, side: T.plank });
        mb.gable(-0.12, -deep - 0.17, 0.22, -deep + 0.02, base + 0.17, base + 0.3, T.hallRoof, T.plank, 'x');
      }
      if (tier === 3) {  // raised clerestory roof
        mb.box(-0.24, ridge - 0.12, -0.09, 0.24, ridge + 0.02, 0.09, { top: T.timber, side: T.plank });
        mb.gable(-0.27, -0.13, 0.27, 0.13, ridge, ridge + 0.17, T.hallRoof, T.timber, 'x');
        mb.box(-0.27, ridge + 0.16, -0.012, 0.27, ridge + 0.185, 0.012, T.gold);
      }
      flagpole(mb, wide + 0.04, deep + 0.05, 0.8);
      flags.push([wide + 0.04, 0.76, deep + 0.05, 1]);
      if (tier === 3) { flagpole(mb, -wide - 0.04, deep + 0.05, 0.8); flags.push([-wide - 0.04, 0.76, deep + 0.05, 1]); }
      return { smoke: tier >= 2 ? [[0.2, ridge + 0.02, -0.05]] : [], flags };
    },

    lumber(mb, tier) {
      if (tier === 1) {   // lean-to and a log pile
        mb.box(-0.32, 0, -0.25, -0.02, 0.24, -0.2, T.plank);
        for (const x of [-0.3, -0.04]) mb.cbox(x, 0, 0.0, 0.03, 0.17, 0.03, T.timber);
        mb.poly([[-0.34, 0.25, -0.27], [-0.34, 0.17, 0.04], [0.0, 0.17, 0.04], [0.0, 0.25, -0.27]], T.thatch, [0, 1, 0.3]);
        mb.poly([[-0.34, 0.245, -0.27], [0.0, 0.245, -0.27], [0.0, 0.165, 0.04], [-0.34, 0.165, 0.04]], T.thatchDark, [0, -1, 0]);
        for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) logZ(mb, -0.02, 0.28, 0.12 + k * 0.09 + r * 0.045, 0.04 + r * 0.075, 0.04);
        mb.cyl(-0.18, 0, 0.25, 0.06, 0.08, 0.06, 7, { side: T.log, top: T.logEnd });
        plank(mb, -0.16, 0.13, 0.25, 0.12, 0.014, 0.014, 1.1, T.timber);
        mb.cbox(-0.13, 0.17, 0.25, 0.04, 0.03, 0.01, T.steel);
        return {};
      }
      const shed = tier === 2 ? 0.02 : 0.06;
      mb.box(-0.34, 0, -0.24, shed, tier === 2 ? 0.22 : 0.3, 0.1, { top: T.plank, side: T.plank });
      door(mb, -0.17, 0.1, 0.1, 0.16, T.char);
      mb.gable(-0.37, -0.27, shed + 0.03, 0.13, tier === 2 ? 0.21 : 0.29, tier === 2 ? 0.38 : 0.5, tier === 2 ? T.thatch : T.shingle, T.plank, 'x');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) logZ(mb, -0.3, -0.04, 0.12 + k * 0.075 + r * 0.037, 0.04 + r * 0.065, 0.035);
      if (tier === 2) {   // sawhorse with a log
        for (const z of [0.15, 0.31]) { plank(mb, 0.2, 0.07, z, 0.18, 0.018, 0.018, 1.1, T.timber); plank(mb, 0.2, 0.07, z, 0.18, 0.018, 0.018, -1.1, T.timber); }
        logZ(mb, 0.1, 0.38, 0.2, 0.15, 0.04);
        return { saws: [[0.2, 0.2, 0.24]] };
      }
      // sawmill: plank stacks and a saw frame
      for (let i = 0; i < 4; i++) mb.box(0.12, i * 0.025, -0.3, 0.38, i * 0.025 + 0.022, -0.16, i % 2 ? T.plank : T.logEnd);
      for (const x of [0.12, 0.36]) mb.cbox(x, 0, 0.25, 0.03, 0.32, 0.03, T.timber);
      mb.box(0.1, 0.32, 0.235, 0.38, 0.35, 0.265, T.timber);
      logX(mb, 0.06, 0.42, 0.06, 0.25, 0.045);
      return { saws: [[0.24, 0.2, 0.25]], smoke: [[-0.2, 0.52, -0.08]] };
    },

    barracks(mb, tier) {
      if (tier === 1) {
        mb.box(-0.26, -0.03, -0.2, 0.26, 0.24, 0.2, { top: T.stone, side: T.stone });
        door(mb, 0, 0.2, 0.1, 0.16);
        mb.gable(-0.3, -0.24, 0.3, 0.24, 0.22, 0.44, T.slate, T.stoneDark, 'x');
        for (const x of [0.29, 0.41]) mb.cbox(x, 0, 0.26, 0.02, 0.16, 0.02, T.timber);
        mb.box(0.28, 0.14, 0.25, 0.42, 0.16, 0.27, T.timber);
        for (let i = 0; i < 3; i++) { mb.cbox(0.31 + i * 0.04, 0, 0.28, 0.01, 0.3, 0.01, T.timber); mb.cyl(0.31 + i * 0.04, 0.3, 0.28, 0.012, 0.35, 0, 4, T.steel, false); }
        return {};
      }
      if (tier === 2) {
        mb.box(-0.36, -0.03, -0.22, 0.36, 0.28, 0.22, { top: T.stone, side: T.stone });
        door(mb, -0.05, 0.22, 0.1, 0.17);
        windowZ(mb, 0.2, 0.12, 0.22, 0.07, 0.06);
        mb.gable(-0.4, -0.26, 0.4, 0.26, 0.26, 0.5, T.slate, T.stoneDark, 'x');
        T.shields.forEach((c, i) => mb.setMatrix(M4().makeRotationX(Math.PI / 2).setPosition(-0.25 + i * 0.12, 0.19, 0.22)).cyl(0, 0, 0, 0.035, 0.015, 0.035, 8, c).setMatrix(null));
        // training dummy
        mb.cbox(-0.36, 0, 0.32, 0.025, 0.24, 0.025, T.timber);
        mb.box(-0.42, 0.18, 0.31, -0.3, 0.2, 0.33, T.timber);
        mb.cbox(-0.36, 0.2, 0.32, 0.06, 0.08, 0.05, T.sack);
        return {};
      }
      // fort
      mb.box(-0.38, -0.03, -0.25, 0.38, 0.36, 0.25, { top: T.slate, side: T.stone });
      crenellate(mb, -0.38, -0.25, 0.38, 0.25, 0.36, 0.06, T.stone);
      mb.box(-0.08, 0, 0.25, 0.08, 0.2, 0.262, T.timber);
      mb.box(-0.1, 0.2, 0.25, 0.1, 0.23, 0.265, T.stoneDark);
      T.shields.forEach((c, i) => mb.setMatrix(M4().makeRotationX(Math.PI / 2).setPosition(-0.28 + i * 0.07 + (i > 0 ? 0.36 : 0), 0.24, 0.25)).cyl(0, 0, 0, 0.032, 0.015, 0.032, 8, c).setMatrix(null));
      mb.cbox(0.2, 0.36, -0.08, 0.16, 0.16, 0.16, { top: T.slate, side: T.stone });
      crenellate(mb, 0.12, -0.16, 0.28, 0.0, 0.52, 0.05, T.stone);
      flagpole(mb, -0.2, -0.1, 0.72);
      return { flags: [[-0.2, 0.68, -0.1, 0.8]] };
    },

    tower(mb, tier) {
      if (tier === 1) {   // wooden lookout
        for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) mb.cyl(x, -0.03, z, 0.028, 0.82, 0.024, 6, T.log, false);
        for (const z of [-0.13, 0.13]) { plank(mb, 0, 0.36, z, 0.34, 0.02, 0.02, 0.85, T.timber); plank(mb, 0, 0.36, z, 0.34, 0.02, 0.02, -0.85, T.timber); }
        mb.box(-0.2, 0.78, -0.2, 0.2, 0.83, 0.2, { top: T.plank, side: T.timber });
        for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) mb.cbox(x, 0.83, z, 0.025, 0.25, 0.025, T.timber);
        mb.box(-0.2, 0.9, 0.18, 0.2, 0.92, 0.2, T.timber); mb.box(-0.2, 0.9, -0.2, 0.2, 0.92, -0.18, T.timber);
        mb.pyramid(-0.24, -0.24, 0.24, 0.24, 1.06, 1.26, [T.thatch, T.thatchDark, T.thatch, T.thatchDark]);
        for (const x of [-0.05, 0.05]) mb.box(x - 0.008, 0, 0.16, x + 0.008, 0.78, 0.175, T.timber);
        for (let y = 0.1; y < 0.78; y += 0.1) mb.box(-0.05, y, 0.165, 0.05, y + 0.012, 0.175, T.timber);
        return { height: 1.26 };
      }
      if (tier === 2) {   // stone base, timber top
        mb.box(-0.18, -0.03, -0.18, 0.18, 0.5, 0.18, { top: T.stone, side: T.stone });
        for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) mb.cbox(x, 0.5, z, 0.035, 0.42, 0.035, T.timber);
        mb.box(-0.23, 0.9, -0.23, 0.23, 0.96, 0.23, { top: T.plank, side: T.timber });
        mb.box(-0.23, 0.96, 0.2, 0.23, 1.02, 0.23, T.timber); mb.box(-0.23, 0.96, -0.23, 0.23, 1.02, -0.2, T.timber);
        for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) mb.cbox(x, 0.96, z, 0.025, 0.16, 0.025, T.timber);
        mb.pyramid(-0.27, -0.27, 0.27, 0.27, 1.12, 1.42, [T.roof, T.roofDark, T.roof, T.roofDark]);
        windowZ(mb, 0, 0.3, 0.18, 0.04, 0.08);
        return { height: 1.42 };
      }
      // stone tower with a conical roof
      mb.cyl(0, -0.03, 0, 0.22, 1.02, 0.19, 8, { side: T.stone, top: T.stoneDark }, true, Math.PI / 8);
      mb.cyl(0, 0.98, 0, 0.24, 1.06, 0.24, 8, { side: T.stoneDark, top: T.plank }, true, Math.PI / 8);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; mb.cbox(Math.cos(a) * 0.21, 1.06, Math.sin(a) * 0.21, 0.06, 0.07, 0.06, T.stone); }
      mb.cyl(0, 1.1, 0, 0.17, 1.52, 0.0, 8, T.roof, false, Math.PI / 8);
      windowZ(mb, 0, 0.5, 0.2, 0.04, 0.09);
      door(mb, 0, 0.21, 0.08, 0.14);
      flagpole(mb, 0, 0, 1.72);
      return { flags: [[0, 1.68, 0, 0.8]], height: 1.6 };
    },

    market(mb, tier) {
      const stall = (cx, cz, flip) => {
        const s = flip ? -1 : 1;
        for (const [x, z] of [[-0.17, -0.12], [0.17, -0.12], [-0.17, 0.12], [0.17, 0.12]]) mb.cbox(cx + x, 0, cz + z * s, 0.025, 0.3, 0.025, T.timber);
        mb.box(cx - 0.16, 0, cz - 0.08, cx + 0.16, 0.12, cz + 0.08, { top: T.plank, side: T.crate });
        produce(mb, cx - 0.09, cz, 0.12, 4); produce(mb, cx + 0.06, cz, 0.12, 2);
        awning(mb, cx - 0.21, cx + 0.21, cz - 0.15 * s, cz + 0.17 * s, 0.34, 0.28, 6);
      };
      if (tier === 1) {
        stall(0, -0.02, false);
        crate(mb, 0.3, 0.22, 0.09); crate(mb, 0.3, 0.22, 0.07, 0.09);
        barrel(mb, -0.3, 0.24, 0.055, 0.13);
        return {};
      }
      if (tier === 2) {
        stall(-0.14, -0.15, false); stall(0.16, 0.18, true);
        barrel(mb, 0.33, -0.22, 0.055, 0.13); barrel(mb, -0.33, 0.25, 0.055, 0.13);
        mb.cbox(-0.12, 0, 0.3, 0.1, 0.07, 0.07, T.sack); mb.cbox(-0.02, 0, 0.3, 0.08, 0.06, 0.07, T.sack);
        return {};
      }
      // market hall
      for (const x of [-0.38, 0, 0.38]) for (const z of [-0.28, 0.28]) mb.cbox(x, 0, z, 0.04, 0.32, 0.04, T.timber);
      mb.box(-0.4, 0.3, -0.3, 0.4, 0.34, 0.3, T.timber);
      mb.gable(-0.44, -0.35, 0.44, 0.35, 0.33, 0.58, T.roof, T.timber, 'x');
      mb.box(-0.3, 0, -0.1, -0.04, 0.11, 0.1, { top: T.plank, side: T.crate }); produce(mb, -0.22, 0, 0.11, 4); produce(mb, -0.1, 0, 0.11, 3);
      mb.box(0.06, 0, -0.1, 0.3, 0.11, 0.1, { top: T.plank, side: T.crate }); produce(mb, 0.12, 0, 0.11, 4);
      barrel(mb, 0.3, 0.2, 0.05, 0.12); crate(mb, -0.3, 0.2, 0.08);
      flagpole(mb, -0.44, 0.0, 0.7); flagpole(mb, 0.44, 0.0, 0.7);
      return { flags: [[-0.44, 0.66, 0, 0.6], [0.44, 0.66, 0, 0.6]] };
    }
  };

  /* ---------- palisades: arms towards each connected neighbour ---------- */
  // mask bits: 1 = north (-z), 2 = east (+x), 4 = south (+z), 8 = west (-x)
  const ARMS = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
  function palisade(mb, tier, mask) {
    const m = mask || 10;   // a lone palisade stands east-west
    const tall = tier === 3 ? 0.33 : 0.27, r = 0.045;
    const stake = (x, z, k) => {
      const h = tall + (R3.hash3(x, k, z) - 0.5) * 0.06;
      mb.cyl(x, -0.12, z, r, h, r, 6, k % 2 ? T.log : T.timber, false, R3.hash3(z, k, x));
      mb.cyl(x, h, z, r, h + 0.08, 0, 6, T.logEnd, false, R3.hash3(z, k, x));
    };
    stake(0, 0, 0);
    for (const [bit, dx, dz] of ARMS) {
      if (!(m & bit)) continue;
      for (let i = 1; i <= 3; i++) stake(dx * i * 0.125, dz * i * 0.125, i + bit);
      if (tier >= 2) {   // cross beam
        const y = 0.14;
        if (dx) mb.box(Math.min(0, dx * 0.5), y, -0.065, Math.max(0, dx * 0.5), y + 0.035, -0.04, T.timber);
        else mb.box(0.04, y, Math.min(0, dz * 0.5), 0.065, y + 0.035, Math.max(0, dz * 0.5), T.timber);
      }
      if (tier === 3) {  // stone footing
        if (dx) mb.box(Math.min(0, dx * 0.5), -0.08, -0.08, Math.max(0, dx * 0.5), 0.09, 0.08, T.stone);
        else mb.box(-0.08, -0.08, Math.min(0, dz * 0.5), 0.08, 0.09, Math.max(0, dz * 0.5), T.stone);
      }
    }
    if (tier === 3) mb.cbox(0, -0.08, 0, 0.17, 0.17, 0.17, T.stone);
    return { height: tall + 0.08 };
  }

  /* ---------- ruins ---------- */
  const FOOT = { hall: [0.44, 0.27], cottage: [0.25, 0.2], lumber: [0.3, 0.22], barracks: [0.36, 0.22], tower: [0.2, 0.2], market: [0.36, 0.26], palisade: [0.4, 0.06] };
  function ruin(mb, type, mask) {
    if (type === 'palisade') {
      const m = mask || 10;
      mb.cyl(0, -0.1, 0, 0.05, 0.1, 0.05, 6, T.char, true);
      for (const [bit, dx, dz] of ARMS) {
        if (!(m & bit)) continue;
        for (let i = 1; i <= 3; i++) { const h = 0.03 + R3.hash3(dx, i, dz) * 0.1; mb.cyl(dx * i * 0.125, -0.1, dz * i * 0.125, 0.045, h, 0.035, 6, i % 2 ? T.char : T.ruin, true); }
      }
      return { height: 0.15 };
    }
    const [w, d] = FOOT[type];
    mb.box(-w, -0.03, -d, w, 0.03, d, { top: T.ash, side: T.ruin });
    const stub = (x, z, sx, sz, h, col) => mb.box(x - sx / 2, 0, z - sz / 2, x + sx / 2, h, z + sz / 2, col);
    if (type === 'tower') {
      mb.cyl(0, 0, 0, 0.21, 0.24, 0.17, 8, { side: T.stoneDark, top: T.char }, true);
      stub(0.16, 0.1, 0.08, 0.08, 0.36, T.stoneDark);
    } else {
      const stone = type === 'barracks';
      const col = stone ? T.stoneDark : T.scorch;
      stub(-w + 0.03, -d + 0.03, 0.06, 0.06, 0.22, col);
      stub(w - 0.03, -d + 0.03, 0.06, 0.06, 0.14, col);
      stub(w - 0.03, d - 0.03, 0.06, 0.06, 0.18, col);
      stub(-w * 0.4, d - 0.02, w * 0.7, 0.04, 0.09, col);
      stub(w * 0.6, -d + 0.02, w * 0.5, 0.04, 0.12, col);
    }
    plank(mb, -w * 0.2, 0.07, 0.02, w * 1.3, 0.04, 0.04, 0.25, T.char, 0.5);
    plank(mb, w * 0.25, 0.05, -0.05, w * 1.1, 0.035, 0.035, -0.18, T.char, -0.8);
    for (let i = 0; i < 5; i++) mb.cbox(-w * 0.5 + i * w * 0.25, 0.03, (R3.hash3(i, 3, w) - 0.5) * d, 0.05, 0.03 + R3.hash3(i, 5, d) * 0.04, 0.05, i % 2 ? T.ash : T.char);
    return { height: 0.3 };
  }

  /* ---------- cache ---------- */
  const cache = new Map();
  function tierOf(type, lvl) {
    if (type === 'hall') return lvl < 3 ? 1 : lvl < 5 ? 2 : 3;
    return lvl < 3 ? 1 : lvl < 6 ? 2 : 3;
  }
  // { key, geo, smoke, flags, saws, height }
  function get(type, tier, ruined, mask) {
    const key = ruined ? 'ruin:' + type + (type === 'palisade' ? ':' + (mask || 0) : '') : type + ':' + tier + (type === 'palisade' ? ':' + (mask || 0) : '');
    let m = cache.get(key);
    if (m) return m;
    const mb = new R3.MeshBuilder();
    let meta;
    if (ruined) meta = ruin(mb, type, mask);
    else if (type === 'palisade') meta = palisade(mb, tier, mask);
    else meta = BUILD[type](mb, tier);
    const geo = mb.geometry();
    geo.computeBoundingBox();
    m = { key, geo, smoke: (meta && meta.smoke) || [], flags: (meta && meta.flags) || [], saws: (meta && meta.saws) || [], height: (meta && meta.height) || geo.boundingBox.max.y };
    cache.set(key, m);
    return m;
  }

  /* ---------- animated parts, instanced ---------- */
  function flagGeometry() {
    const mb = new R3.MeshBuilder();
    mb.box(0, -0.06, -0.004, 0.16, 0.0, 0.004, 0xffffff);
    mb.poly([[0.16, -0.06, 0.004], [0.2, -0.045, 0.004], [0.16, -0.03, 0.004]], 0xffffff, [0, 0, 1]);
    mb.poly([[0.16, -0.06, -0.004], [0.16, -0.03, -0.004], [0.2, -0.045, -0.004]], 0xffffff, [0, 0, -1]);
    return mb.geometry();
  }
  function sawGeometry() {
    const mb = new R3.MeshBuilder();
    mb.box(-0.1, -0.012, -0.004, 0.1, 0.012, 0.004, T.steel);
    mb.box(0.1, -0.02, -0.01, 0.13, 0.02, 0.01, T.timber);
    return mb.geometry();
  }

  R3.Models = { get, tierOf, flagGeometry, sawGeometry, ARMS, FOOT };
})(window.R3);
