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

  class Overlay {
    constructor(scene) {
      this.hover = new TileMark(scene, T.hover, 0.12);
      this.sel = new TileMark(scene, T.gold, 0.0);
    }
    update() {
      const ui = typeof UI !== 'undefined' ? UI : null;
      if (!ui || !MAP) return;
      const hv = ui.hover;
      if (ui.placing && hv) {
        const chk = placementCheck(ui.placing, hv.x, hv.y);
        this.hover.show(hv.x, hv.y, chk.ok ? T.ok : chk.valid ? T.warn : T.bad, 0.28);
      } else if (hv && isLandTile(hv.x, hv.y)) {
        this.hover.show(hv.x, hv.y, T.hover, ui.selSq ? 0.18 : 0.08);
      } else this.hover.hide();
      const b = ui.selB ? G.buildings.find(o => o.id === ui.selB) : null;
      if (b) this.sel.show(b.x, b.y, T.gold, 0.1); else this.sel.hide();
    }
    dispose() { this.hover.dispose(); this.sel.dispose(); }
  }

  R3.Overlay = Overlay;
})(window.R3);
