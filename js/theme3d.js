'use strict';
/* 3D palette: every colour the 3D renderer uses lives here.
   Materials and terrain take colours from `base`; the light and dark variants only change
   the light, sky and sea, so switching theme never rebuilds geometry.
   Light reads as a clear northern noon, dark as a cool dusk. */
const THEME3D = (function () {
  const base = {
    // terrain
    grass: 0x86b35a, grassDark: 0x5f8c40, grassLight: 0xa2c76c,
    high: 0x9fae78, highDark: 0x7c8a5c,
    sand: 0xe6d29a, sandWet: 0xbfa877,
    rock: 0x958c7a, rockLight: 0xb0a792, rockDark: 0x6a6253, rockDeep: 0x3d4a4c,
    seabed: 0x1c3f49,
    // vegetation
    trunk: 0x5c4330, leafA: 0x2e6a3e, leafB: 0x3d7f49, leafC: 0x4f9150,
    // buildings
    wall: 0xe6d6ae, wallShade: 0xc7b48a, timber: 0x6e4c2f, roof: 0xb04a32, roofDark: 0x83372a,
    thatch: 0xc9a25c, hallRoof: 0x9a6a40, stone: 0xb0ab9c, stoneDark: 0x857f72, slate: 0x4a6a84,
    log: 0x8f6a42, logEnd: 0xd8b885, canvas: 0xece2c8, gold: 0xe5b24d, ruin: 0x3a332d, char: 0x231d19,
    wattle: 0xc8ad7c, thatchDark: 0xa8843f, windowDark: 0x34434e, plank: 0x9a6c42, shingle: 0x7d5a3c,
    crate: 0xa77b4c, sack: 0xd8c8a0, barrel: 0x86592f, iron: 0x4a4a4f, ash: 0x6a645d, scorch: 0x5e4b3a,
    produce: [0xc4453a, 0x8cbf5a, 0xe08a2e, 0xe8c547], banner: 0xa8362a, player: 0x2f6fa8,
    shields: [0xc94f3d, 0x3f7fc4, 0xe3b04b],
    // figures
    trousers: 0x4a3b30, boots: 0x2e241d, beard: 0x7a4a2a, beardRed: 0xb5552b, beardGrey: 0xa39d92, fur: 0x6b5038,
    mail: 0x8c9197, hoodGreen: 0x3d6b39, hoodRaider: 0x5e3326, felt: 0x6e5c48, warPaint: 0xb32a20, hair: 0xc0612a,
    cape: 0x92261f, darkSteel: 0x3e4148, shieldBlue: 0x2f67a8, shieldWood: 0x8c6a45, horn: 0xe8dcc2,
    arrowShaft: 0x9c7a52, fletch: 0xf0ebe0,
    // props
    pebble: 0xb9b2a2, tuft: 0x6f9e48, tuftLight: 0x98c25e, flowers: [0xf4efe6, 0xf2cf4a, 0xb88ad6, 0xe9839a],
    roundLeaf: 0x4f8a3e, roundLeafLight: 0x6aa24c,
    // effects
    smoke: 0xdcd8d0, dust: 0xd6c59c, ghostOk: 0x7fe39a, ghostWarn: 0xf0cf7a, ghostBad: 0xf08070,
    // units
    tunic: { militia: 0x9aa9b3, sword: 0x3f80c6, bow: 0x4f9f5c, pike: 0xd1a645 },
    raider: 0x9a3129, raiderDark: 0x3c2522, brute: 0x742c26, berserker: 0xad4a2e, warlord: 0x2c1c18,
    skin: 0xe4c19a, steel: 0xc9ced3,
    // boats
    hull: 0x5d3c26, hullDark: 0x402a1b, sail: 0xdcd2c0, sailStripe: 0x9b2f28, playerSail: 0x2f6fa8,
    // overlays
    ok: 0x8ef0a0, warn: 0xf0d58e, bad: 0xf08e8e, hover: 0xffffff
  };

  const light = {
    name: 'light',
    sky: 0xc4dbe0, fog: 0xc4dbe0, fogNear: 30, fogFar: 85,
    sun: 0xfff0d2, sunIntensity: 2.6, sunDir: [-0.55, 1.0, 0.42],
    hemiSky: 0xdcefff, hemiGround: 0x56664a, hemiIntensity: 1.15,
    seaDeep: 0x1c5468, seaShallow: 0x49a3aa, foam: 0xf4efdf, seaSpec: 0xfff6e0
  };

  const dark = {
    name: 'dark',
    sky: 0x1e2c3a, fog: 0x223443, fogNear: 26, fogFar: 72,
    sun: 0xffc390, sunIntensity: 2.3, sunDir: [0.7, 0.75, 0.35],
    hemiSky: 0x7c8fbc, hemiGround: 0x34352c, hemiIntensity: 1.3,
    seaDeep: 0x123a4a, seaShallow: 0x2f7c86, foam: 0xd9d6cc, seaSpec: 0xffd2a0
  };

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  return { base, light, dark, isDark, current() { return isDark() ? dark : light; } };
})();
