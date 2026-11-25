'use strict';
/* Unit, boat and missile models, all procedural.
   A figure is split into parts so it can be animated with instancing:
     body (torso, head and headgear, one variant per kind), two arms, two legs, and up to two held
     items. Arms, legs and the commander's flag are white and take their colour per instance.
   Figure space: feet at y = 0, facing +z, about 0.2 tall at scale 1. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const M4 = () => new THREE.Matrix4();
  const SKEL = { hipX: 0.017, hipY: 0.068, legLen: 0.068, shX: 0.043, shY: 0.132, armLen: 0.06 };

  // How each kind is dressed and armed, and how it fights.
  const KINDS = {
    militia:   { arm: T.tunic.militia, leg: T.trousers, right: 'club', pose: 'melee' },
    sword:     { arm: T.tunic.sword, leg: T.trousers, right: 'sword', left: 'dshield', pose: 'shield' },
    bow:       { arm: T.tunic.bow, leg: T.trousers, left: 'bow', pose: 'bow' },
    pike:      { arm: T.tunic.pike, leg: T.trousers, right: 'pike', pose: 'pike' },
    raider:    { arm: T.raider, leg: T.boots, right: 'axe', pose: 'melee' },
    archer:    { arm: T.hoodRaider, leg: T.boots, left: 'bow', pose: 'bow' },
    shield:    { arm: T.mail, leg: T.boots, right: 'axe', left: 'rshield', pose: 'shield' },
    brute:     { arm: T.skin, leg: T.boots, right: 'bigaxe', pose: 'melee', scale: 1.6 },
    berserker: { arm: T.skin, leg: T.boots, right: 'axe', left: 'axe', pose: 'melee', scale: 1.05, lean: 0.88 },
    warlord:   { arm: T.darkSteel, leg: T.boots, right: 'bigaxe', pose: 'melee', scale: 1.9 }
  };

  function torso(mb, tunic, belt, wide) {
    const w = 0.033 * (wide || 1);
    mb.box(-w - 0.004, 0.056, -0.024, w + 0.004, 0.088, 0.024, tunic);     // skirt
    mb.box(-w, 0.088, -0.02, w, 0.14, 0.02, tunic);
    mb.box(-w - 0.002, 0.084, -0.022, w + 0.002, 0.092, 0.022, belt);      // belt
  }
  function head(mb) { mb.box(-0.021, 0.14, -0.02, 0.021, 0.18, 0.021, T.skin); }
  function beard(mb, col, long) { mb.box(-0.018, long ? 0.118 : 0.134, 0.014, 0.018, 0.16, 0.027, col); }
  function cone(mb, y0, r, h, col) { mb.cyl(0, y0, 0, r, y0 + h, 0, 6, col, false); }
  function horn(mb, side) {
    const m = M4().makeRotationZ(-side * 1.0).setPosition(side * 0.022, 0.168, 0);
    mb.setMatrix(m).cyl(0, 0, 0, 0.008, 0.045, 0, 5, T.horn, false).setMatrix(null);
  }

  function body(kind) {
    const mb = new R3.MeshBuilder();
    switch (kind) {
      case 'militia':
        torso(mb, T.tunic.militia, T.timber); head(mb);
        mb.cyl(0, 0.172, 0, 0.025, 0.19, 0.019, 6, T.felt, true);
        break;
      case 'sword':
        torso(mb, T.tunic.sword, T.timber); head(mb);
        mb.cyl(0, 0.164, 0, 0.026, 0.2, 0.012, 7, T.steel, true);
        mb.box(-0.004, 0.148, 0.02, 0.004, 0.176, 0.026, T.steel);
        break;
      case 'bow':
        torso(mb, T.tunic.bow, T.timber); head(mb);
        mb.box(-0.025, 0.156, -0.025, 0.025, 0.192, 0.014, T.hoodGreen);
        mb.box(-0.023, 0.118, -0.03, 0.023, 0.162, -0.02, T.hoodGreen);
        mb.setMatrix(M4().makeRotationZ(0.35).setPosition(0.012, 0.085, -0.03))
          .box(-0.011, 0, -0.008, 0.011, 0.07, 0.008, T.crate).box(-0.009, 0.07, -0.006, 0.009, 0.085, 0.006, T.fletch).setMatrix(null);
        break;
      case 'pike':
        torso(mb, T.tunic.pike, T.timber); head(mb);
        mb.cyl(0, 0.17, 0, 0.037, 0.176, 0.037, 8, T.steel, 'both');
        mb.cyl(0, 0.176, 0, 0.024, 0.198, 0.01, 7, T.steel, true);
        break;
      case 'raider':
        torso(mb, T.raider, T.raiderDark); head(mb); beard(mb, T.beard);
        mb.box(-0.036, 0.128, -0.022, 0.036, 0.145, 0.022, T.fur);
        cone(mb, 0.165, 0.025, 0.048, T.iron);
        break;
      case 'archer':
        torso(mb, 0x7d4a33, T.raiderDark); head(mb); beard(mb, T.beardRed);
        mb.box(-0.025, 0.154, -0.025, 0.025, 0.192, 0.015, T.hoodRaider);
        mb.box(-0.023, 0.118, -0.03, 0.023, 0.162, -0.02, T.hoodRaider);
        mb.setMatrix(M4().makeRotationZ(-0.35).setPosition(-0.012, 0.085, -0.03))
          .box(-0.011, 0, -0.008, 0.011, 0.07, 0.008, T.crate).box(-0.009, 0.07, -0.006, 0.009, 0.085, 0.006, 0xd86a3a).setMatrix(null);
        break;
      case 'shield':
        torso(mb, T.mail, T.raiderDark); head(mb); beard(mb, T.beard);
        cone(mb, 0.163, 0.026, 0.05, T.iron);
        mb.box(-0.004, 0.148, 0.02, 0.004, 0.176, 0.026, T.iron);
        break;
      case 'brute':
        torso(mb, T.brute, T.raiderDark, 1.12); head(mb); beard(mb, T.beard, true);
        mb.box(-0.048, 0.112, -0.032, 0.048, 0.15, 0.03, T.fur);
        break;
      case 'berserker':
        torso(mb, T.skin, T.raiderDark, 0.92);
        mb.box(-0.031, 0.1, 0.0201, 0.031, 0.106, 0.021, T.warPaint);
        mb.box(-0.031, 0.118, 0.0201, 0.031, 0.124, 0.021, T.warPaint);
        mb.box(-0.036, 0.056, -0.025, 0.036, 0.088, 0.025, T.fur);
        head(mb); beard(mb, T.hair);
        mb.box(-0.024, 0.172, -0.026, 0.024, 0.196, 0.018, T.hair);
        mb.box(-0.012, 0.19, -0.02, 0.014, 0.208, 0.008, T.hair);
        break;
      case 'warlord':
        torso(mb, T.darkSteel, T.gold, 1.08); head(mb); beard(mb, T.beardGrey, true);
        mb.box(-0.04, 0.03, -0.036, 0.04, 0.142, -0.024, T.cape);
        mb.box(-0.045, 0.125, -0.026, 0.045, 0.148, 0.026, T.fur);
        mb.cyl(0, 0.164, 0, 0.026, 0.2, 0.014, 7, T.darkSteel, true);
        mb.cyl(0, 0.162, 0, 0.0275, 0.174, 0.0275, 8, T.gold, false);
        horn(mb, 1); horn(mb, -1);
        break;
    }
    return mb.geometry();
  }

  function arm() {
    const mb = new R3.MeshBuilder();
    mb.box(-0.0095, -SKEL.armLen, -0.0095, 0.0095, 0.004, 0.0095, 0xffffff);
    return mb.geometry();
  }
  function leg() {
    const mb = new R3.MeshBuilder();
    mb.box(-0.011, -SKEL.legLen + 0.01, -0.012, 0.011, 0.002, 0.012, 0xffffff);
    mb.box(-0.012, -SKEL.legLen, -0.013, 0.012, -SKEL.legLen + 0.012, 0.02, 0x9a9a9a);   // boot, darker
    return mb.geometry();
  }

  // Held items, in hand space (hand at the origin, forearm pointing up along +y).
  function weapon(type) {
    const mb = new R3.MeshBuilder();
    switch (type) {
      case 'sword':
        mb.box(-0.004, -0.008, -0.004, 0.004, 0.012, 0.004, T.timber);
        mb.box(-0.015, -0.013, -0.003, 0.015, -0.008, 0.003, T.steel);
        mb.box(-0.005, -0.09, -0.0016, 0.005, -0.013, 0.0016, T.steel);
        break;
      case 'club':
        mb.cyl(0, 0.012, 0, 0.006, -0.075, 0.011, 6, T.log, true);
        break;
      case 'axe':
        mb.cyl(0, 0.012, 0, 0.0045, -0.085, 0.0045, 5, T.timber, true);
        mb.box(-0.002, -0.088, -0.004, 0.002, -0.062, 0.024, T.steel);
        break;
      case 'bigaxe':
        mb.cyl(0, 0.02, 0, 0.0055, -0.13, 0.0055, 5, T.timber, true);
        mb.box(-0.0025, -0.135, -0.034, 0.0025, -0.095, 0.034, T.steel);
        mb.box(-0.003, -0.122, -0.006, 0.003, -0.108, 0.006, T.iron);
        break;
      case 'pike':   // along +z
        mb.setMatrix(M4().makeRotationX(Math.PI / 2)).cyl(0, -0.1, 0, 0.0042, 0.3, 0.0042, 5, T.timber, true)
          .cyl(0, 0.3, 0, 0.008, 0.335, 0, 5, T.steel, false).setMatrix(null);
        break;
      case 'bow': {   // vertical, belly facing back (-z)
        mb.box(-0.003, -0.018, -0.003, 0.003, 0.018, 0.003, T.timber);
        for (const s of [1, -1]) {
          mb.setMatrix(M4().makeRotationX(s * 0.35).setPosition(0, s * 0.016, 0)).box(-0.0025, s > 0 ? 0 : -0.05, -0.0025, 0.0025, s > 0 ? 0.05 : 0, 0.0025, T.arrowShaft).setMatrix(null);
        }
        mb.box(-0.0008, -0.062, -0.022, 0.0008, 0.062, -0.0205, T.fletch);
        break;
      }
      case 'dshield':   // round shield facing +z
        mb.setMatrix(M4().makeRotationX(Math.PI / 2)).cyl(0, 0, 0, 0.034, 0.006, 0.034, 9, { side: T.iron, top: T.shieldBlue }, 'both')
          .cyl(0, 0.006, 0, 0.009, 0.011, 0.006, 6, T.steel, true).setMatrix(null);
        break;
      case 'rshield':
        mb.setMatrix(M4().makeRotationX(Math.PI / 2)).cyl(0, 0, 0, 0.042, 0.006, 0.042, 9, { side: T.iron, top: T.shieldWood }, 'both')
          .cyl(0, 0.006, 0, 0.01, 0.011, 0.007, 6, T.iron, true).setMatrix(null);
        mb.box(-0.042, -0.004, 0.0062, 0.042, 0.004, 0.0072, T.raider);
        break;
    }
    return mb.geometry();
  }

  function bannerPole() {
    const mb = new R3.MeshBuilder();
    mb.cyl(0, 0, 0, 0.004, 0.27, 0.004, 5, T.timber, true);
    mb.cbox(0, 0.27, 0, 0.012, 0.012, 0.012, T.gold);
    return mb.geometry();
  }
  function bannerFlag() {
    const mb = new R3.MeshBuilder();
    mb.box(0, -0.05, -0.002, 0.075, 0, 0.002, 0xffffff);
    mb.poly([[0.075, -0.05, 0.002], [0.095, -0.025, 0.002], [0.075, 0, 0.002]], 0xffffff, [0, 0, 1]);
    mb.poly([[0.075, -0.05, -0.002], [0.075, 0, -0.002], [0.095, -0.025, -0.002]], 0xffffff, [0, 0, -1]);
    return mb.geometry();
  }

  /* ---------- longboat ---------- */
  // Cross sections along the keel: z, half beam, gunwale height.
  const HULL = [[-0.66, 0.0, 0.25], [-0.5, 0.1, 0.16], [-0.25, 0.165, 0.12], [0.25, 0.165, 0.12], [0.5, 0.1, 0.16], [0.66, 0.0, 0.25]];
  const KEEL = -0.07;
  function boat(boss) {
    const mb = new R3.MeshBuilder();
    for (let i = 0; i < HULL.length - 1; i++) {
      const [z0, w0, h0] = HULL[i], [z1, w1, h1] = HULL[i + 1];
      for (const s of [1, -1]) {
        // two strakes per side, alternating plank colours, outside and in
        const mid0 = KEEL + (h0 - KEEL) * 0.5, mid1 = KEEL + (h1 - KEEL) * 0.5;
        const lo = [[s * w0 * 0.55, KEEL, z0], [s * w1 * 0.55, KEEL, z1], [s * w1, mid1, z1], [s * w0, mid0, z0]];
        const hi = [[s * w0, mid0, z0], [s * w1, mid1, z1], [s * w1 * 1.04, h1, z1], [s * w0 * 1.04, h0, z0]];
        mb.poly(lo, T.hullDark, [s, -0.6, 0]); mb.poly(hi, i % 2 ? T.hull : T.plank, [s, 0.2, 0]);
        mb.poly(lo.slice().reverse(), T.hullDark, [-s, 0.6, 0]); mb.poly(hi.slice().reverse(), T.hullDark, [-s, 0, 0]);
      }
      // keel bottom
      mb.poly([[-w0 * 0.55, KEEL, z0], [w0 * 0.55, KEEL, z0], [w1 * 0.55, KEEL, z1], [-w1 * 0.55, KEEL, z1]], T.hullDark, [0, -1, 0]);
    }
    mb.box(-0.13, KEEL + 0.03, -0.45, 0.13, KEEL + 0.045, 0.45, T.plank);    // floor boards
    for (const z of [-0.3, 0, 0.3]) mb.box(-0.15, 0.06, z - 0.02, 0.15, 0.075, z + 0.02, T.timber);   // thwarts
    // curled stem and stern posts
    for (const s of [1, -1]) {
      let y = 0.2, z = s * 0.64;
      for (let k = 0; k < 4; k++) {
        const a = k * 0.45;
        mb.setMatrix(M4().makeRotationX(s * a).setPosition(0, y, z)).box(-0.016, 0, -0.016, 0.016, 0.08, 0.016, k === 3 ? (boss ? T.gold : T.hullDark) : T.hull).setMatrix(null);
        y += Math.cos(a) * 0.07; z += s * Math.sin(a) * 0.07;
      }
    }
    // shields along the gunwales
    const cols = boss ? [T.darkSteel, T.gold, T.darkSteel] : [T.raider, T.sail, T.shieldWood];
    for (const s of [1, -1]) for (let k = 0; k < 5; k++) {
      const z = -0.36 + k * 0.18, w = 0.17;
      mb.setMatrix(M4().makeRotationZ(-s * Math.PI / 2).setPosition(s * w, 0.11, z))
        .cyl(0, 0, 0, 0.048, 0.008, 0.048, 8, { side: T.iron, top: cols[k % 3] }, 'both').setMatrix(null);
    }
    // mast, yard and a square sail across the beam
    mb.cyl(0, KEEL, 0.05, 0.016, 0.98, 0.012, 6, T.hullDark, true);
    mb.box(-0.34, 0.9, 0.035, 0.34, 0.92, 0.055, T.hullDark);
    const stripes = 6, sw = 0.64 / stripes;
    for (let i = 0; i < stripes; i++) {
      const x0 = -0.32 + i * sw, x1 = x0 + sw, c = boss ? (i % 3 === 1 ? T.gold : T.raiderDark) : (i % 2 ? T.sailStripe : T.sail);
      // slightly bellied: the middle row bulges forward
      mb.poly([[x0, 0.9, 0.06], [x1, 0.9, 0.06], [x1, 0.62, 0.11], [x0, 0.62, 0.11]], c, [0, 0.2, 1]);
      mb.poly([[x0, 0.62, 0.11], [x1, 0.62, 0.11], [x1, 0.38, 0.07], [x0, 0.38, 0.07]], c, [0, -0.2, 1]);
      mb.poly([[x0, 0.9, 0.055], [x0, 0.62, 0.105], [x1, 0.62, 0.105], [x1, 0.9, 0.055]], c, [0, -0.2, -1]);
      mb.poly([[x0, 0.62, 0.105], [x0, 0.38, 0.065], [x1, 0.38, 0.065], [x1, 0.62, 0.105]], c, [0, 0.2, -1]);
    }
    return mb.geometry();
  }
  // Oar pivots (local to the boat) and the oar itself, blade at the outer end along +x.
  const OARLOCKS = [];
  for (const s of [1, -1]) for (let k = 0; k < 4; k++) OARLOCKS.push([s * 0.17, 0.12, -0.33 + k * 0.22, s]);
  function oar() {
    const mb = new R3.MeshBuilder();
    mb.box(0, -0.005, -0.005, 0.42, 0.005, 0.005, T.timber);
    mb.box(0.34, -0.004, -0.022, 0.46, 0.004, 0.022, T.plank);
    return mb.geometry();
  }

  /* ---------- missiles and marks ---------- */
  function arrow() {
    const mb = new R3.MeshBuilder();
    mb.box(-0.0035, -0.0035, -0.07, 0.0035, 0.0035, 0.05, T.arrowShaft);
    mb.setMatrix(M4().makeRotationX(Math.PI / 2).setPosition(0, 0, 0.05)).cyl(0, 0, 0, 0.009, 0.025, 0, 4, T.steel, false).setMatrix(null);
    mb.box(-0.0005, -0.012, -0.075, 0.0005, 0.012, -0.045, T.fletch);
    mb.box(-0.012, -0.0005, -0.075, 0.012, 0.0005, -0.045, T.fletch);
    return mb.geometry();
  }
  function trail() {   // a thin streak behind an arrow, along -z
    const g = new THREE.PlaneGeometry(0.012, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    return g;
  }
  function blob() { return new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2); }
  function ring() { return new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2); }

  R3.UnitModels = { SKEL, KINDS, body, arm, leg, weapon, bannerPole, bannerFlag, boat, oar, OARLOCKS, arrow, trail, blob, ring };
})(window.R3);
