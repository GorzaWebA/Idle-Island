'use strict';
/* In-world UI, drawn in the 3D scene:
   - hovered / placement tile, placement ghost with its label, range rings, and the tiles a
     market or lumber camp would work with
   - the selected building: a glowing outline around the model and a ring on the ground
   - the selected squad: a ring under every member, its range, and the path it would take to a
     hovered tile, ending in a flag
   - hold flags for every squad holding a tile, and rings where incoming longboats will land
   Highlights follow the terrain's real surface (beaches slope). Screen-space parts (boat
   markers, info chip, health bars, floating numbers) live in hud.js. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const LIFT = 0.025;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const ground = (x, z) => Math.max(0, R3.Terrain.heightAt(x, z));
  const colourOf = sq => (typeof squadHex === 'function' ? squadHex(sq) : 0xf2c94c);
  const towerRange = (x, y) => 3.5 + (tileType(x, y) === T_HIGH ? 1 : 0);

  class TileMark {
    constructor(scene, color, fillOpacity) {
      this.pos = new Float32Array(4 * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      this.fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fillOpacity, depthWrite: false });
      this.fill = new THREE.Mesh(g, this.fillMat);
      this.lineGeo = new THREE.BufferGeometry();
      this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
      this.line = new THREE.LineLoop(this.lineGeo, this.lineMat);
      this.fill.renderOrder = 5; this.line.renderOrder = 6;
      this.group = new THREE.Group(); this.group.add(this.fill, this.line);
      this.group.visible = false;
      this.key = '';
      scene.add(this.group);
    }
    place(tx, tz) {
      const key = tx + ',' + tz + ':' + (MAP ? MAP.seed : 0);
      if (key === this.key) return;
      this.key = key;
      const land = isLandTile(tx, tz), inset = 0.04;
      const corners = [[inset, inset], [inset, 1 - inset], [1 - inset, 1 - inset], [1 - inset, inset]];
      corners.forEach(([fx, fz], i) => {
        const y = land ? R3.Terrain.tileHeight(tx, tz, fx, fz) : 0.05;
        this.pos[i * 3] = tx + fx; this.pos[i * 3 + 1] = Math.max(y, 0.02) + LIFT; this.pos[i * 3 + 2] = tz + fz;
      });
      this.fill.geometry.attributes.position.needsUpdate = true;
      this.lineGeo.attributes.position.needsUpdate = true;
      this.fill.geometry.computeBoundingSphere(); this.lineGeo.computeBoundingSphere();
    }
    show(tx, tz, color, fillOpacity) {
      this.place(tx, tz);
      this.fillMat.color.setHex(color); this.lineMat.color.setHex(color);
      this.fillMat.opacity = fillOpacity;
      this.group.visible = true;
    }
    hide() { this.group.visible = false; }
    dispose() { this.fill.geometry.dispose(); this.lineGeo.dispose(); this.fillMat.dispose(); this.lineMat.dispose(); }
  }

  // A circle draped over the terrain (tower and Hall ranges).
  class RangeRing {
    constructor(scene) {
      this.N = 96;
      this.pos = new Float32Array(this.N * 3);
      this.geo = new THREE.BufferGeometry();
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.mat = new THREE.LineBasicMaterial({ color: T.gold, transparent: true, opacity: 0.85 });
      this.line = new THREE.LineLoop(this.geo, this.mat);
      this.line.renderOrder = 6; this.line.visible = false;
      this.key = '';
      scene.add(this.line);
    }
    show(cx, cz, r, color) {
      const key = cx + ',' + cz + ',' + r;
      if (key !== this.key) {
        this.key = key;
        for (let i = 0; i < this.N; i++) {
          const a = i / this.N * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          this.pos[i * 3] = x; this.pos[i * 3 + 1] = Math.max(R3.Terrain.heightAt(x, z), 0) + 0.05; this.pos[i * 3 + 2] = z;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.geo.computeBoundingSphere();
      }
      this.mat.color.setHex(color);
      this.line.visible = true;
    }
    hide() { this.line.visible = false; }
    dispose() { this.geo.dispose(); this.mat.dispose(); }
  }


  // Flat rings rebuilt every frame, one draw call for all of them.
  class MarkRings {
    constructor(scene, max, inner, opacity, order) {
      this.max = max; this.n = 0;
      this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false });
      this.mesh = new THREE.InstancedMesh(new THREE.RingGeometry(inner, 1, 40).rotateX(-Math.PI / 2), this.mat, max);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, _c.set(0xffffff));
      this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.visible = false;
      scene.add(this.mesh);
    }
    begin() { this.n = 0; }
    add(x, y, z, r, color) {
      if (this.n >= this.max) return;
      _m.makeScale(r, 1, r).setPosition(x, y, z);
      this.mesh.setMatrixAt(this.n, _m); this.mesh.setColorAt(this.n, _c.set(color));
      this.n++;
    }
    end() {
      this.mesh.count = this.n; this.mesh.visible = this.n > 0;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); this.mat.dispose(); }
  }

  /* A glowing outline around one building model: the model again, a little larger, showing only
     its back faces, so just a rim shows around the real thing. */
  class Outline {
    constructor(scene) {
      this.mat = new THREE.MeshBasicMaterial({ color: T.gold, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false });
      this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
      this.mesh.visible = false; this.mesh.renderOrder = 2;
      scene.add(this.mesh);
    }
    show(model, type, x, y, z, rot, t) {
      if (this.mesh.geometry !== model.geo) this.mesh.geometry = model.geo;
      const f = R3.Models.FOOT[type] || [0.3, 0.3], w = 0.032;
      this.mesh.position.set(x, y - 0.01, z);
      this.mesh.rotation.set(0, rot, 0);
      if (type === 'palisade') this.mesh.scale.set(1.08, 1.06, 1.08);
      else this.mesh.scale.set(1 + w / Math.max(0.08, f[0]), 1 + w / Math.max(0.3, model.height), 1 + w / Math.max(0.08, f[1]));
      this.mat.opacity = 0.7 + 0.25 * Math.sin(t * 4);
      this.mesh.visible = true;
    }
    hide() { this.mesh.visible = false; }
    dispose() { this.mat.dispose(); }
  }

  /* Marching dashes along a path, draped over the ground and drawn on top of everything
     (it's an order being given, so it should never hide behind a roof). */
  class PathRibbon {
    constructor(scene, maxDash) {
      this.max = maxDash;
      this.pos = new Float32Array(maxDash * 12);
      const idx = [];
      for (let i = 0; i < maxDash; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      this.geo = new THREE.BufferGeometry();
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      this.geo.setIndex(idx);
      this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
      this.mesh = new THREE.Mesh(this.geo, this.mat);
      this.mesh.renderOrder = 9; this.mesh.frustumCulled = false; this.mesh.visible = false;
      scene.add(this.mesh);
      this.cum = [];
      this.dashes = 0;
    }
    // pts: [x0, z0, x1, z1, ...] in world (= sim) coordinates
    show(pts, color, t) {
      const DASH = 0.16, GAP = 0.1, W = 0.05, period = DASH + GAP;
      const cum = this.cum; cum.length = 0; cum.push(0);
      for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
      const total = cum[cum.length - 1];
      if (total < 0.05) { this.hide(); return; }
      let n = 0;
      this.seg = 0;
      const a = this._a || (this._a = {}), b = this._b || (this._b = {});
      for (let d = -((t * 0.45) % period); d < total && n < this.max; d += period) {
        const d0 = Math.max(0, d), d1 = Math.min(total, d + DASH);
        if (d1 - d0 < 0.02) continue;
        this.at(pts, d0, a); this.at(pts, d1, b);
        let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = -dz * W / 2, pz = dx * W / 2, ya = ground(a.x, a.z) + 0.05, yb = ground(b.x, b.z) + 0.05, o = n * 12, P = this.pos;
        P[o] = a.x - px; P[o + 1] = ya; P[o + 2] = a.z - pz;
        P[o + 3] = a.x + px; P[o + 4] = ya; P[o + 5] = a.z + pz;
        P[o + 6] = b.x + px; P[o + 7] = yb; P[o + 8] = b.z + pz;
        P[o + 9] = b.x - px; P[o + 10] = yb; P[o + 11] = b.z - pz;
        n++;
      }
      this.geo.setDrawRange(0, n * 6);
      this.geo.attributes.position.needsUpdate = true;
      this.mat.color.set(color);
      this.mesh.visible = n > 0; this.dashes = n;
    }
    // The point d along the path (distances only grow within one show(), so walk forward).
    at(pts, d, out) {
      const cum = this.cum;
      let seg = this.seg;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      this.seg = seg;
      const L = cum[seg + 1] - cum[seg] || 1, k = Math.max(0, Math.min(1, (d - cum[seg]) / L));
      out.x = pts[seg * 2] + (pts[seg * 2 + 2] - pts[seg * 2]) * k; out.z = pts[seg * 2 + 1] + (pts[seg * 2 + 3] - pts[seg * 2 + 1]) * k;
      return out;
    }
    hide() { this.mesh.visible = false; this.dashes = 0; }
    dispose() { this.geo.dispose(); this.mat.dispose(); }
  }

  function buildingWithId(id) { const L = G.buildings; for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; }

  class Overlay {
    constructor(scene, buildings, picker, units) {
      this.buildings = buildings; this.picker = picker; this.units = units;
      this.hover = new TileMark(scene, T.hover, 0.12);
      this.sel = new TileMark(scene, T.gold, 0.0);
      this.ring = new RangeRing(scene);
      this.squadRange = new RangeRing(scene);
      this.near = [];                       // tiles a market or lumber camp would work with
      for (let i = 0; i < 8; i++) this.near.push(new TileMark(scene, T.gold, 0.12));
      // Translucent preview of the building about to be placed.
      this.ghostMat = new THREE.MeshBasicMaterial({ color: T.ghostOk, transparent: true, opacity: 0.55, depthWrite: false });
      this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
      this.ghost.renderOrder = 7; this.ghost.visible = false;
      scene.add(this.ghost);
      this.outline = new Outline(scene);
      this.marks = new MarkRings(scene, 64, 0.86, 0.95, 6);     // selection, members, landing spots
      this.faint = new MarkRings(scene, 24, 0.86, 0.5, 6);      // other squads' hold spots
      this.path = new PathRibbon(scene, 220);
      // hold flags: a pole and a pennant in the squad's colour
      this.flagGroup = new THREE.Group(); scene.add(this.flagGroup);
      this.flagMat = R3.flatMaterial();
      this.poles = new R3.Batch(this.flagGroup, R3.UnitModels.bannerPole(), this.flagMat, 12);
      this.pennants = new R3.Batch(this.flagGroup, R3.UnitModels.bannerFlag(), this.flagMat, 12);
      this.chip = document.getElementById('ghost-chip');
      this.chipText = ''; this.chipCls = '';
      this._o = {};
      this.time = 0;
      this.pathKey = ''; this.pathPts = []; this.pts = [];
      this.preview = null;                  // tile the selected squad would be sent to
    }
    setChip(text, cls, x, y) {
      const c = this.chip;
      if (!c) return;
      if (!text) { if (!c.hidden) c.hidden = true; return; }
      if (text !== this.chipText) { c.textContent = text; this.chipText = text; }
      if (cls !== this.chipCls) { c.className = 'ghost-chip ' + cls; this.chipCls = cls; }
      c.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%, -100%)';
      if (c.hidden) c.hidden = false;
    }
    // A flag stuck in the ground at a tile centre.
    flag(x, z, color, scale, t, k) {
      const y = ground(x, z);
      _q.setFromAxisAngle(UP, 0.6); _s.setScalar(scale); _p.set(x, y, z);
      _m.compose(_p, _q, _s); this.poles.add(_m, _c.set(0xffffff));
      _q.setFromAxisAngle(UP, 0.6 + Math.sin(t * 3 + k) * 0.3); _p.y = y + 0.27 * scale;
      _m.compose(_p, _q, _s); this.pennants.add(_m, _c.set(color));
    }
    // The route a squad would walk to (gx, gy): the sim's own path search, cached per request.
    routeFor(sq, gx, gy) {
      const st = sq.rt, key = sq.id + ':' + Math.floor(st.ax) + ',' + Math.floor(st.ay) + '>' + gx + ',' + gy;
      if (key !== this.pathKey) {
        this.pathKey = key;
        const p = findPath(Math.floor(st.ax), Math.floor(st.ay), gx, gy) || [{ x: gx + 0.5, y: gy + 0.5 }];
        this.pathPts = [];
        for (const q of p) this.pathPts.push(q.x, q.y);
      }
      return this.pathPts;
    }
    update(dt) {
      const ui = typeof UI !== 'undefined' ? UI : null;
      if (!ui || !MAP) return;
      const t = (this.time += dt || 0);
      const hv = ui.hover;
      let ghost = false, chip = false, ring = false, near = 0, path = false;
      this.marks.begin(); this.faint.begin(); this.poles.begin(); this.pennants.begin();
      this.preview = null;
      if (ui.placing && hv) {
        const type = ui.placing, pv = typeof placementPreview === 'function' ? placementPreview(type, hv.x, hv.y) : { chk: placementCheck(type, hv.x, hv.y), gain: '' };
        const chk = pv.chk, color = chk.ok ? T.ok : chk.valid ? T.warn : T.bad;
        this.hover.show(hv.x, hv.y, color, 0.28);
        const cx = hv.x + 0.5, cz = hv.y + 0.5, land = isLandTile(hv.x, hv.y);
        const gy = land ? R3.Terrain.heightAt(cx, cz) : 0;
        let top = gy + 0.3;
        if (land && !buildingAtTile(hv.x, hv.y)) {
          const mask = type === 'palisade' ? R3.Buildings.palisadeMask(this.buildings.at, hv.x, hv.y) : 0;
          const model = R3.Models.get(type, 1, false, mask);
          if (this.ghost.geometry !== model.geo) this.ghost.geometry = model.geo;
          this.ghost.position.set(cx, gy, cz);
          this.ghost.rotation.set(0, R3.Buildings.rotFor(type, hv.x, hv.y), 0);
          this.ghostMat.color.setHex(chk.ok ? T.ghostOk : chk.valid ? T.ghostWarn : T.ghostBad);
          top = gy + model.height;
          ghost = true;
        }
        if (type === 'tower' && land) { this.ring.show(cx, cz, towerRange(hv.x, hv.y), color); ring = true; }
        // what a market would boost, what a lumber camp would cut
        if (land && type === 'market') {
          for (const b of G.buildings) if (near < this.near.length && (b.type === 'cottage' || b.type === 'hall') && Math.max(Math.abs(b.x - hv.x), Math.abs(b.y - hv.y)) === 1) this.near[near++].show(b.x, b.y, T.gold, 0.14);
        } else if (land && type === 'lumber') {
          for (const [dx, dy] of DIR8) if (near < this.near.length && hasTree(hv.x + dx, hv.y + dy)) this.near[near++].show(hv.x + dx, hv.y + dy, T.ok, 0.14);
        }
        const text = chk.ok ? (pv.gain || BUILDINGS[type].name) : chk.reason;
        const o = this.picker.project(cx, top + 0.12, cz, this._o);
        if (!o.behind) { this.setChip(text, chk.ok ? 'ok' : chk.valid ? 'warn' : 'bad', o.x, o.y); chip = true; }
      } else if (hv && isLandTile(hv.x, hv.y)) {
        this.hover.show(hv.x, hv.y, T.hover, ui.selSq ? 0.18 : 0.08);
      } else this.hover.hide();
      for (let i = near; i < this.near.length; i++) this.near[i].hide();

      // the selected building: outline, ground ring, ranges
      const b = ui.selB ? buildingWithId(ui.selB) : null;
      const bst = b ? this.buildings.state.get(b.id) : null;
      if (b && bst) {
        this.sel.hide();
        this.outline.show(this.buildings.modelFor(b), b.type, bst.cx, bst.gy, bst.cz, bst.rot, t);
        const f = R3.Models.FOOT[b.type] || [0.3, 0.3];
        this.marks.add(bst.cx, bst.gy + 0.03, bst.cz, Math.hypot(f[0], f[1]) + 0.12 + Math.sin(t * 4) * 0.015, T.gold);
        if (!ring && !b.ruined && (b.type === 'tower' || b.type === 'hall')) {
          this.ring.show(b.x + 0.5, b.y + 0.5, b.type === 'hall' ? 3 : towerRange(b.x, b.y), T.gold);
          ring = true;
        }
      } else { this.sel.hide(); this.outline.hide(); }

      // squads: hold flags for all, rings, range and the route for the selected one
      let squadRing = false;
      for (const sq of G.squads) {
        const selected = ui.selSq === sq.id, col = colourOf(sq);
        if (sq.mode === 'hold' && sq.hold) {
          const hx = sq.hold.x + 0.5, hz = sq.hold.y + 0.5;
          this.flag(hx, hz, col, selected ? 2.4 : 1.9, t, sq.id);
          (selected ? this.marks : this.faint).add(hx, ground(hx, hz) + 0.03, hz, 0.36, col);
        }
        if (!selected || !sq.rt || typeof RT === 'undefined' || !RT) continue;
        for (const u of sq.rt.members) {
          const st = this.units.posOf(u);
          if (st) this.marks.add(st.x, Math.max(st.gy, 0) + 0.02, st.z, 0.13, col);
        }
        if (sq.rt.stats && sq.rt.stats.ranged && sq.rt.members.length) {
          const c = sq.rt.members[0];
          this.squadRange.show(+sq.rt.ax.toFixed(2), +sq.rt.ay.toFixed(2), sq.rt.stats.range + (tileType(Math.floor(c.x), Math.floor(c.y)) === T_HIGH ? 1 : 0), 0x96dcff);
          squadRing = true;
        }
        // where it would go: the hovered tile while choosing, else the rest of its current walk
        const pts = this.pts;
        pts.length = 0;
        pts.push(sq.rt.ax, sq.rt.ay);
        if (hv && !ui.placing && isLandTile(hv.x, hv.y)) {
          const r = this.routeFor(sq, hv.x, hv.y);
          for (let i = 0; i < r.length; i++) pts.push(r[i]);
          this.flag(hv.x + 0.5, hv.y + 0.5, col, 2.4, t, 7);
          this.marks.add(hv.x + 0.5, ground(hv.x + 0.5, hv.y + 0.5) + 0.03, hv.y + 0.5, 0.36 + Math.sin(t * 5) * 0.03, col);
          this.preview = hv;
        } else if (sq.rt.path) {
          for (let i = 0; i < sq.rt.path.length; i++) pts.push(sq.rt.path[i].x, sq.rt.path[i].y);
        }
        if (pts.length > 2) {
          this.path.show(pts, col, t);
          path = true;
        }
      }
      if (!squadRing) this.squadRange.hide();
      if (!path) this.path.hide();

      // where each incoming longboat will come ashore
      if (typeof RT !== 'undefined' && RT) {
        for (const bt of RT.boats) {
          if (bt.state !== 'sail' || bt.wave !== G.wave || !bt.landing) continue;
          if (RT.phase === 'countdown' && RT.timer > bt.visibleAt) continue;
          const lx = bt.landing.x + 0.5, lz = bt.landing.y + 0.5;
          this.marks.add(lx, ground(lx, lz) + 0.04, lz, (bt.boss ? 0.5 : 0.36) + Math.sin(t * 4 + bt.id) * 0.04, bt.boss ? T.gold : 0xd9483b);
        }
      }

      this.marks.end(); this.faint.end(); this.poles.end(); this.pennants.end();
      this.ghost.visible = ghost;
      if (!ring) this.ring.hide();
      if (!chip) this.setChip('');
    }
    dispose() {
      this.hover.dispose(); this.sel.dispose(); this.ring.dispose(); this.squadRange.dispose(); this.ghostMat.dispose();
      for (const n of this.near) n.dispose();
      this.outline.dispose(); this.marks.dispose(); this.faint.dispose(); this.path.dispose();
      for (const b of [this.poles, this.pennants]) { b.geo.dispose(); b.dispose(); }
      this.flagMat.dispose();
    }
  }

  R3.Overlay = Overlay;
})(window.R3);
