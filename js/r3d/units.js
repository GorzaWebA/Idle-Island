'use strict';
/* Units and boats: the adapter from sim state to animated figures.
   - snapshot() runs before each fixed sim step; frames interpolate between the last two steps
   - each figure is a body, two arms, two legs and up to two held items, all instanced by part
   - animation is procedural and driven only by what the sim already exposes:
       walking from distance moved, attacks from the cooldown (cdT) jumping up, hits from
       `flash`, knockback from kbx/kby, deaths from a unit leaving RT.units (hp <= 0 means it
       fell, standing over water means it drowned, `fleeing` means it just fades)
   - the renderer never writes to sim objects; its own per-unit state lives in Maps by id */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base, UM = R3.UnitModels, K = UM.KINDS, SK = UM.SKEL;
  const FOAM = 0xf4efdf;
  const _root = new THREE.Matrix4(), _loc = new THREE.Matrix4(), _part = new THREE.Matrix4(), _arm = new THREE.Matrix4(), _w = new THREE.Matrix4();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  const ATTACK_TIME = 0.32;

  const clamp01 = k => (k < 0 ? 0 : k > 1 ? 1 : k);
  const easeOut = k => 1 - (1 - k) * (1 - k);
  const easeOutBack = k => { const c1 = 1.70158, c3 = c1 + 1, t = k - 1; return 1 + c3 * t * t * t + c1 * t * t; };
  // Local transform: translate, then rotate (Euler, given order).
  function local(x, y, z, rx, ry, rz, order) {
    _e.set(rx, ry, rz, order || 'XYZ');
    return _loc.makeRotationFromEuler(_e).setPosition(x, y, z);
  }
  // Weapon held in the hand: rotation and offset relative to the hand.
  const GRIP = {
    sword: [-0.9, 0, 0, 0, 0, 0.004], club: [-0.9, 0, 0, 0, 0, 0.004], axe: [-0.9, 0, 0, 0, 0, 0.004], bigaxe: [-0.8, 0, 0, 0, 0, 0.004],
    pike: [0.85, 0, 0, 0, 0, 0], bow: [Math.PI / 2, 0, 0, 0, 0, 0], dshield: [1.0, 0, 0, 0, 0.03, 0.014], rshield: [1.0, 0, 0, 0, 0.034, 0.016]
  };

  class Units {
    constructor(scene, fx) {
      this.scene = scene; this.fx = fx;
      this.group = new THREE.Group(); scene.add(this.group);
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this.bodies = {}; for (const k in K) this.bodies[k] = new R3.Batch(this.group, UM.body(k), this.mat, 16);
      this.arms = new R3.Batch(this.group, UM.arm(), this.mat, 64);
      this.legs = new R3.Batch(this.group, UM.leg(), this.mat, 64);
      this.weapons = {}; for (const w of ['sword', 'club', 'axe', 'bigaxe', 'pike', 'bow', 'dshield', 'rshield']) this.weapons[w] = new R3.Batch(this.group, UM.weapon(w), this.mat, 16);
      this.poles = new R3.Batch(this.group, UM.bannerPole(), this.mat, 8);
      this.flags = new R3.Batch(this.group, UM.bannerFlag(), this.mat, 8);
      this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.blobs = new R3.Batch(this.group, UM.blob(), this.blobMat, 64, { receive: false, order: 2 });
      this.prev = new Map();
      this.state = new Map();
      this.boats = new Boats(this.group, this.mat, fx);
      this.frame = 0; this.time = 0; this.initial = true;
      this.onBossHit = null;
    }

    snapshot() {
      if (!RT) return;
      for (const u of RT.units) {
        const p = this.prev.get(u.id);
        if (p) { p.x = u.x; p.y = u.y; } else this.prev.set(u.id, { x: u.x, y: u.y });
      }
      this.boats.snapshot();
    }

    sync(alpha, dt) {
      if (!RT) return;
      const f = ++this.frame;
      this.time += dt;
      for (const k in this.bodies) this.bodies[k].begin();
      for (const k in this.weapons) this.weapons[k].begin();
      this.arms.begin(); this.legs.begin(); this.poles.begin(); this.flags.begin(); this.blobs.begin();

      for (const u of RT.units) {
        if (!u.alive) continue;
        const p = this.prev.get(u.id);
        let x = p ? p.x + (u.x - p.x) * alpha : u.x, z = p ? p.y + (u.y - p.y) * alpha : u.y;
        let st = this.state.get(u.id);
        if (!st) {
          st = { u, x, z, h: 0, gy: R3.Terrain.heightAt(x, z), walk: Math.random() * 6, move: 0, cd: u.cdT, atk: 9, pop: this.initial ? 9 : 0, hop: null, dead: null, dt: 0, frame: f };
          if (u.side === 1 && !this.initial) {   // raiders leap ashore from their boat
            for (const b of RT.boats) if (b.state === 'unload' && Math.abs(b.landing.x + 0.5 - u.x) < 1 && Math.abs(b.landing.y + 0.5 - u.y) < 1) { st.hop = { x: b.x, z: b.y, t: 0 }; st.pop = 9; break; }
          }
          this.state.set(u.id, st);
        }
        st.frame = f;
        // attack started when the cooldown jumps up
        if (u.cdT > st.cd + 0.05) {
          st.atk = 0;
          if (u.kind === 'warlord' && this.onBossHit) this.onBossHit(0.05);
        }
        st.cd = u.cdT;
        st.atk += dt; st.pop += dt;
        // leap from the boat: arc from the boat to where the sim put the raider
        let hopY = 0;
        if (st.hop) {
          st.hop.t += dt;
          const k = clamp01(st.hop.t / 0.4);
          x = st.hop.x + (x - st.hop.x) * k; z = st.hop.z + (z - st.hop.z) * k; hopY = Math.sin(k * Math.PI) * 0.22;
          if (k >= 1) st.hop = null;
        }
        // facing: movement first, then the current target
        const mx = x - st.x, mz = z - st.z, d = Math.sqrt(mx * mx + mz * mz);
        let want = null;
        if (d > 1e-4) want = Math.atan2(mx, mz);
        else if (u.target && u.target.alive !== false) {
          const tx = u.target.type !== undefined ? u.target.x + 0.5 : u.target.x, tz = u.target.type !== undefined ? u.target.y + 0.5 : u.target.y;
          want = Math.atan2(tx - x, tz - z);
        }
        if (want !== null) { let a = want - st.h; a = Math.atan2(Math.sin(a), Math.cos(a)); st.h += a * Math.min(1, dt * 12); }
        const speed = dt > 0 ? d / dt : 0;
        st.move += (clamp01(speed / 0.5) - st.move) * Math.min(1, dt * 10);
        st.walk += d * 24;
        const ground = R3.Terrain.heightAt(x, z);
        st.gy += (ground - st.gy) * Math.min(1, dt * 14);
        st.x = x; st.z = z;
        if (ground < -0.02 && !this.initial && (st.wade = (st.wade || 0) - dt * (0.4 + st.move)) <= 0) {
          st.wade = 0.45;     // wading ashore: rings spread from the legs
          this.fx.ripples.spawn(x, 0.02, z, 0.04, 0.24, 0.8, 0x5d7a80);
        }
        this.drawFigure(u, st, Math.max(st.gy, -0.06) + hopY, 0, 1);
      }

      // units that left the sim: fall, drown, or just go
      for (const [id, st] of this.state) {
        if (st.frame === f) continue;
        if (!st.dead) {
          const u = st.u;
          if (u.fleeing || this.initial) { this.state.delete(id); this.prev.delete(id); continue; }
          const drowned = !isLandAt(u.x, u.y);
          if (u.hp > 0 && !drowned) { this.state.delete(id); this.prev.delete(id); continue; }   // removed, not killed
          st.dead = drowned ? 'drown' : 'fall'; st.dt = 0;
          if (drowned) R3.splash(this.fx, st.x, st.z, 1);
          if (u.kind === 'warlord' && this.onBossHit) this.onBossHit(0.12);
        }
        st.dt += dt;
        const limit = st.dead === 'drown' ? 1.6 : 2.4;
        if (st.dt > limit) { this.state.delete(id); this.prev.delete(id); continue; }
        this.drawCorpse(st);
      }

      for (const k in this.bodies) this.bodies[k].end();
      for (const k in this.weapons) this.weapons[k].end();
      this.arms.end(); this.legs.end(); this.poles.end(); this.flags.end(); this.blobs.end();
      this.boats.sync(alpha, dt, this.time, this.initial);
      this.initial = false;
    }

    // Root transform of a figure, then its parts.
    drawFigure(u, st, y, extraTilt, fade) {
      const cfg = K[u.kind] || K.militia;
      let sc = (cfg.scale || 1) * fade;
      if (st.pop < 0.28) sc *= Math.max(0.01, easeOutBack(st.pop / 0.28));
      if (u.fleeing) sc *= Math.max(0.01, u.alpha);
      const bob = Math.abs(Math.sin(st.walk)) * 0.008 * st.move;
      // lean: forward into a swing, back from a hit or a shove
      const ka = st.atk < ATTACK_TIME ? Math.sin(st.atk / ATTACK_TIME * Math.PI) : 0;
      const kb = Math.hypot(u.kbx || 0, u.kby || 0);
      let tilt = extraTilt + ka * 0.18 - (u.flash > 0 ? 0.3 * (u.flash / 0.12) : 0) - Math.min(0.6, kb * 0.15);
      y += bob + Math.min(0.06, kb * 0.015);
      _q.setFromEuler(_e.set(tilt, st.h, 0, 'YXZ'));
      _v.set(st.x, y, st.z); _s.set(sc * (cfg.lean || 1), sc, sc);
      _root.compose(_v, _q, _s);
      const flash = u.flash > 0 ? 1.8 : 1;
      this.bodies[u.kind] ? this.bodies[u.kind].add(_root, _c.copy(WHITE).multiplyScalar(flash)) : null;
      this.drawLimbs(u, cfg, st, flash, ka, kb > 0.3);
      // squad commander carries the squad's banner
      if (u.side === 0 && u.slot === 0 && u.sq) {
        _part.multiplyMatrices(_root, local(0.02, 0.07, -0.026, 0, 0, 0));
        this.poles.add(_part, WHITE);
        _part.multiplyMatrices(_root, local(0.02, 0.335, -0.026, 0, Math.sin(this.time * 5 + u.id) * 0.35 + Math.PI, 0));
        this.flags.add(_part, _c.set(typeof squadColor === 'function' ? squadColor(u.sq) : '#ffffff'));
      }
      // soft round shadow on the ground
      if (st.gy > -0.05) {
        _v.set(st.x, st.gy + 0.006, st.z); _s.set(0.075 * sc, 1, 0.075 * sc);
        _w.compose(_v, _q.identity(), _s);
        this.blobs.add(_w, WHITE);
      }
    }

    drawLimbs(u, cfg, st, flash, ka, flung) {
      const sw = Math.sin(st.walk) * st.move, pose = cfg.pose, fighting = !!u.target || st.atk < ATTACK_TIME;
      const legA = sw * 0.65;
      // arm angles about x: negative swings the arm forward
      let right = -0.15 + sw * 0.45, left = -0.15 - sw * 0.45, thrust = 0;
      if (pose === 'shield') left = fighting ? -1.25 : -0.95;
      if (pose === 'pike') { right = -0.85; left = -0.85; thrust = ka * 0.07; }
      if (pose === 'bow' && fighting) {
        left = -1.5; right = -1.35;
        if (st.atk < ATTACK_TIME) right = -1.35 - Math.sin(st.atk / ATTACK_TIME * Math.PI) * 0.4;
      } else if (st.atk < ATTACK_TIME && pose !== 'pike') {
        const k = st.atk / ATTACK_TIME;
        right = k < 0.45 ? -0.15 + (-2.75 + 0.15) * easeOut(k / 0.45) : -2.75 + 2.5 * (1 - (1 - (k - 0.45) / 0.55) * (1 - (k - 0.45) / 0.55));
        if (u.kind === 'berserker') left = right * 0.8;
      }
      if (flung) { right = -2.4; left = -2.4; }
      const armCol = _c.setHex(cfg.arm).multiplyScalar(flash), legCol = _c2.setHex(cfg.leg).multiplyScalar(flash);
      // legs (left at +x, right at -x; the figure faces +z)
      _part.multiplyMatrices(_root, local(SK.hipX, SK.hipY, 0, legA, 0, 0)); this.legs.add(_part, legCol);
      _part.multiplyMatrices(_root, local(-SK.hipX, SK.hipY, 0, -legA, 0, 0)); this.legs.add(_part, legCol);
      // right arm and weapon
      _arm.multiplyMatrices(_root, local(-SK.shX, SK.shY, 0, right, 0, -0.12, 'ZXY'));
      this.arms.add(_arm, armCol);
      if (cfg.right) this.held(cfg.right, _arm, thrust);
      // left arm and shield / bow / second axe
      _arm.multiplyMatrices(_root, local(SK.shX, SK.shY, 0, left, 0, 0.12, 'ZXY'));
      this.arms.add(_arm, armCol);
      if (cfg.left) this.held(cfg.left, _arm, 0);
    }

    held(type, arm, thrust) {
      const g = GRIP[type];
      _w.multiplyMatrices(arm, local(0, -SK.armLen, 0, 0, 0, 0));
      _part.multiplyMatrices(_w, local(g[3], g[4], g[5] + thrust, g[0], g[1], g[2]));
      this.weapons[type].add(_part, WHITE);
    }

    drawCorpse(st) {
      const u = st.u, cfg = K[u.kind] || K.militia, sc = cfg.scale || 1;
      let y = Math.max(st.gy, -0.06), tilt = 0, fade = 1;
      if (st.dead === 'fall') {
        tilt = -1.45 * easeOut(clamp01(st.dt / 0.35));
        if (st.dt > 1.6) y -= (st.dt - 1.6) * 0.12;
        if (st.dt > 2.0) fade = Math.max(0.01, 1 - (st.dt - 2.0) / 0.4);
      } else {   // sinking under the waves
        y = -0.02 - st.dt * 0.22; tilt = -0.35 * clamp01(st.dt);
      }
      _q.setFromEuler(_e.set(tilt, st.h, 0, 'YXZ'));
      _v.set(st.x, y, st.z); _s.set(sc * fade * (cfg.lean || 1), sc * fade, sc * fade);
      _root.compose(_v, _q, _s);
      if (this.bodies[u.kind]) this.bodies[u.kind].add(_root, WHITE);
      const armCol = _c.setHex(cfg.arm), legCol = _c2.setHex(cfg.leg);
      const arms = st.dead === 'drown' ? -2.8 : -0.4;
      _part.multiplyMatrices(_root, local(SK.hipX, SK.hipY, 0, 0.1, 0, 0)); this.legs.add(_part, legCol);
      _part.multiplyMatrices(_root, local(-SK.hipX, SK.hipY, 0, -0.1, 0, 0)); this.legs.add(_part, legCol);
      _arm.multiplyMatrices(_root, local(-SK.shX, SK.shY, 0, arms, 0, -0.5, 'ZXY')); this.arms.add(_arm, armCol);
      if (cfg.right && st.dead === 'fall') this.held(cfg.right, _arm, 0);
      _arm.multiplyMatrices(_root, local(SK.shX, SK.shY, 0, arms, 0, 0.5, 'ZXY')); this.arms.add(_arm, armCol);
      if (cfg.left && st.dead === 'fall') this.held(cfg.left, _arm, 0);
    }

    // Render-space position of a unit (for picking and markers).
    posOf(u) { return this.state.get(u.id) || null; }
    clear() { this.prev.clear(); this.state.clear(); this.boats.clear(); this.initial = true; }
    dispose() {
      this.clear();
      for (const k in this.bodies) { this.bodies[k].geo.dispose(); this.bodies[k].dispose(); }
      for (const k in this.weapons) { this.weapons[k].geo.dispose(); this.weapons[k].dispose(); }
      for (const b of [this.arms, this.legs, this.poles, this.flags, this.blobs]) { b.geo.dispose(); b.dispose(); }
      this.boats.dispose(); this.mat.dispose(); this.blobMat.dispose();
    }
    count() { let n = 0; for (const k in this.bodies) n += this.bodies[k].n; return n; }
  }

  /* ---------- longboats ---------- */
  class Boats {
    constructor(group, mat, fx) {
      this.fx = fx;
      this.hulls = [new R3.Batch(group, UM.boat(false), mat, 8, { shadow: true }), new R3.Batch(group, UM.boat(true), mat, 2, { shadow: true }), new R3.Batch(group, UM.boat('player'), mat, 1, { shadow: true })];
      this.oars = new R3.Batch(group, UM.oar(), mat, 64);
      this.prev = new Map(); this.state = new Map(); this.frame = 0;
      this.onBoss = null;       // (x, z) when the Warlord's boat first comes into view
    }
    snapshot() {
      for (const b of RT.boats) {
        const p = this.prev.get(b.id);
        if (p) { p.x = b.x; p.y = b.y; } else this.prev.set(b.id, { x: b.x, y: b.y });
      }
    }
    sync(alpha, dt, t, initial) {
      const f = ++this.frame;
      this.hulls[0].begin(); this.hulls[1].begin(); this.hulls[2].begin(); this.oars.begin();
      // the settlers' own longboat, moored at the dock with its oars shipped
      const dock = MAP && MAP.dock;
      if (dock) {
        const h = Math.atan2(dock.x + 0.5 - (dock.sx + 0.5), dock.y + 0.5 - (dock.sy + 0.5)) + Math.PI / 2;   // side-on to the shore
        _q.setFromEuler(_e.set(Math.sin(t * 1.2) * 0.02, h, Math.sin(t * 0.9 + 1) * 0.035, 'YXZ'));
        _v.set(dock.sx + 0.5, Math.sin(t * 1.4) * 0.018 - 0.02, dock.sy + 0.5); _s.set(0.9, 0.9, 0.9);
        _root.compose(_v, _q, _s);
        this.hulls[2].add(_root, WHITE);
        for (let i = 0; i < UM.OARLOCKS.length; i++) {
          const [ox, oy, oz, side] = UM.OARLOCKS[i];
          _part.multiplyMatrices(_root, local(ox, oy, oz, 0, (side < 0 ? Math.PI : 0) + side * 1.35, 0.25, 'YZX'));
          this.oars.add(_part, WHITE);
        }
      }
      for (const b of RT.boats) {
        if (b.state === 'gone') continue;
        if (RT.phase === 'countdown' && RT.timer > b.visibleAt && b.state === 'sail') continue;   // still in the fog
        const p = this.prev.get(b.id);
        const x = p ? p.x + (b.x - p.x) * alpha : b.x, z = p ? p.y + (b.y - p.y) * alpha : b.y;
        let st = this.state.get(b.id);
        const travel = b.state === 'leave' ? Math.atan2(-b.dx, -b.dy) : Math.atan2(b.dx, b.dy);
        if (!st) {
          st = { h: travel, x, z, wake: 0, ripple: 0, spray: 0, last: b.state, frame: f };
          this.state.set(b.id, st);
          if (b.boss && !initial && b.state === 'sail' && this.onBoss) this.onBoss(x, z);
        }
        // turn smoothly (a leaving boat swings round)
        let a = travel - st.h; a = Math.atan2(Math.sin(a), Math.cos(a));
        st.h += Math.sign(a) * Math.min(Math.abs(a), dt * 1.4);
        const speed = dt > 0 ? Math.hypot(x - st.x, z - st.z) / dt : 0;
        st.x = x; st.z = z; st.frame = f;
        const sc = (b.boss ? 1.25 : 1) * (b.state === 'leave' ? Math.max(0.01, Math.min(1, b.alpha * 2)) : 1);
        const bob = Math.sin(t * 1.6 + b.id) * 0.022;
        _q.setFromEuler(_e.set(Math.sin(t * 1.3 + b.id) * 0.03, st.h, Math.sin(t * 1.1 + b.id * 2) * 0.045, 'YXZ'));
        _v.set(x, bob - 0.015, z); _s.set(sc, sc, sc);
        _root.compose(_v, _q, _s);
        this.hulls[b.boss ? 1 : 0].add(_root, WHITE);
        // oars row while moving and stand up while the crew climbs out
        const rowing = b.state !== 'unload';
        for (let i = 0; i < UM.OARLOCKS.length; i++) {
          const [ox, oy, oz, side] = UM.OARLOCKS[i];
          const ph = t * 4.2 + b.id;
          const sweep = rowing ? Math.sin(ph) * 0.45 : 0, dip = rowing ? -0.3 + Math.cos(ph) * 0.18 : 0.95;
          _part.multiplyMatrices(_root, local(ox, oy, oz, 0, (side < 0 ? Math.PI : 0) + sweep * side, dip, 'YZX'));
          this.oars.add(_part, WHITE);
        }
        // wake behind a moving boat: foam at the stern, spreading ripples, spray off the bow
        const fx = this.fx, hx = Math.sin(st.h), hz = Math.cos(st.h);
        if (speed > 0.25 && !initial) {
          if ((st.wake -= dt) <= 0) {
            st.wake = 0.09;
            const sx = x - hx * 0.6 * sc, sz = z - hz * 0.6 * sc;
            fx.foam.spawn(sx + (Math.random() - 0.5) * 0.1, 0.035, sz + (Math.random() - 0.5) * 0.1, -hx * 0.05, 0, -hz * 0.05, 1.8, 0.08, 0.3, FOAM, 0.6);
          }
          if ((st.ripple -= dt) <= 0) {
            st.ripple = 0.32;
            fx.ripples.spawn(x - hx * 0.45 * sc, 0.025, z - hz * 0.45 * sc, 0.15 * sc, 0.7 * sc, 1.6, 0x3c5257);
          }
          if ((st.spray -= dt) <= 0) {
            st.spray = 0.12;
            const side = Math.random() < 0.5 ? -1 : 1, bx = x + hx * 0.55 * sc + hz * side * 0.08, bz = z + hz * 0.55 * sc - hx * side * 0.08;
            fx.puffs.spawn(bx, 0.04, bz, hz * side * 0.35 + hx * 0.2, 0.45 + Math.random() * 0.25, -hx * side * 0.35 + hz * 0.2, 0.45, 0.035, 0.07, FOAM, 0.8, null, 2.6);
          }
        }
        // running aground: a burst of spray and a ring of foam at the bow
        if (st.last === 'sail' && b.state === 'unload' && !initial) {
          const bx = x + hx * 0.5 * sc, bz = z + hz * 0.5 * sc;
          for (let k = 0; k < 12; k++) {
            const a = st.h + (Math.random() - 0.5) * 2.4, v = 0.4 + Math.random() * 0.5;
            fx.puffs.spawn(bx, 0.05, bz, Math.sin(a) * v, 0.6 + Math.random() * 0.6, Math.cos(a) * v, 0.6, 0.04, 0.08, FOAM, 0.9, null, 3);
          }
          fx.ripples.spawn(bx, 0.03, bz, 0.1, 0.7 * sc, 1.0, 0x6d8f96);
          for (let k = 0; k < 5; k++) fx.foam.spawn(bx + (Math.random() - 0.5) * 0.4, 0.035, bz + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2, 1.6, 0.1, 0.35, FOAM, 0.7);
        }
        st.last = b.state;
      }
      this.hulls[0].end(); this.hulls[1].end(); this.hulls[2].end(); this.oars.end();
      if (f % 60 === 0) for (const [id, st] of this.state) if (st.frame !== f) { this.state.delete(id); this.prev.delete(id); }
    }
    clear() { this.prev.clear(); this.state.clear(); }
    dispose() { for (const b of [this.hulls[0], this.hulls[1], this.hulls[2], this.oars]) { b.geo.dispose(); b.dispose(); } }
  }

  // Something falls into the sea: a ring, a crown of droplets and a patch of foam.
  R3.splash = function (fx, x, z, size) {
    fx.ripples.spawn(x, 0.02, z, 0.05 * size, 0.42 * size, 0.9, 0x9fc3cb);
    fx.ripples.spawn(x, 0.02, z, 0.02, 0.26 * size, 1.2, 0x5d7a80);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + Math.random() * 0.5, v = (0.25 + Math.random() * 0.25) * size;
      fx.puffs.spawn(x, 0.03, z, Math.cos(a) * v, (0.7 + Math.random() * 0.5) * size, Math.sin(a) * v, 0.6, 0.035 * size, 0.06 * size, FOAM, 0.9, null, 3.2);
    }
    fx.foam.spawn(x, 0.035, z, 0, 0, 0, 1.6, 0.1 * size, 0.32 * size, FOAM, 0.7);
  };
  R3.Units = Units;
})(window.R3);
