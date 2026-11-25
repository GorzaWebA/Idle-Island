'use strict';
/* In-world UI: the hovered / placement tile and the selected building outline.
   Highlights follow the tile's real surface (beaches slope). Phase 5 adds selection
   rings, the hold-position path, boat markers and the info chip. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const LIFT = 0.025;

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

  class Overlay {
    constructor(scene, buildings, picker) {
      this.buildings = buildings; this.picker = picker;
      this.hover = new TileMark(scene, T.hover, 0.12);
      this.sel = new TileMark(scene, T.gold, 0.0);
      this.ring = new RangeRing(scene);
      // Translucent preview of the building about to be placed.
      this.ghostMat = new THREE.MeshBasicMaterial({ color: T.ghostOk, transparent: true, opacity: 0.55, depthWrite: false });
      this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
      this.ghost.renderOrder = 7; this.ghost.visible = false;
      scene.add(this.ghost);
      this.chip = document.getElementById('ghost-chip');
      this.chipText = ''; this.chipCls = '';
      this._o = {};
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
    update() {
      const ui = typeof UI !== 'undefined' ? UI : null;
      if (!ui || !MAP) return;
      const hv = ui.hover;
      let ghost = false, chip = false, ring = false;
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
        if (type === 'tower' && land) { this.ring.show(cx, cz, 3.5 + (tileType(hv.x, hv.y) === T_HIGH ? 1 : 0), color); ring = true; }
        const text = chk.ok ? (pv.gain || BUILDINGS[type].name) : chk.reason;
        const o = this.picker.project(cx, top + 0.12, cz, this._o);
        if (!o.behind) { this.setChip(text, chk.ok ? 'ok' : chk.valid ? 'warn' : 'bad', o.x, o.y); chip = true; }
      } else if (hv && isLandTile(hv.x, hv.y)) {
        this.hover.show(hv.x, hv.y, T.hover, ui.selSq ? 0.18 : 0.08);
      } else this.hover.hide();
      const b = ui.selB ? G.buildings.find(o => o.id === ui.selB) : null;
      if (b) {
        this.sel.show(b.x, b.y, T.gold, 0.1);
        if (!ring && !b.ruined && (b.type === 'tower' || b.type === 'hall')) {
          this.ring.show(b.x + 0.5, b.y + 0.5, b.type === 'hall' ? 3 : 3.5 + (tileType(b.x, b.y) === T_HIGH ? 1 : 0), T.gold);
          ring = true;
        }
      } else this.sel.hide();
      this.ghost.visible = ghost;
      if (!ring) this.ring.hide();
      if (!chip) this.setChip('');
    }
    dispose() { this.hover.dispose(); this.sel.dispose(); this.ring.dispose(); this.ghostMat.dispose(); }
  }

  R3.Overlay = Overlay;
})(window.R3);
