'use strict';
/* Screen-space HUD over the 3D view:
   - boat markers: a badge with the raider count over each incoming longboat, clamped to the edge
     of the view with an arrow when the boat is off screen
   - an info chip over the selected building or squad
   - health bars (one instanced draw call, constant size on screen)
   - floating numbers: the sim's gold/status floaters, plus damage numbers when switched on
   - the performance overlay (F3, or Settings)
   Labels are pooled DOM elements moved with transforms; nothing is created per frame. */
window.R3 = window.R3 || {};
(function (R3) {
  const T = THEME3D.base;
  const _o = {};

  function el(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function setText(e, v) { if (e._t !== v) { e.textContent = v; e._t = v; } }
  function setShown(e, on) { if (e.hidden === on) e.hidden = !on; }
  // Move a label, touching the DOM only when it moved by a whole pixel.
  function place(e, x, y, centre) {
    x = Math.round(x); y = Math.round(y);
    if (e._x === x && e._y === y) return;
    e._x = x; e._y = y;
    e.style.transform = 'translate(' + x + 'px,' + y + 'px)' + (centre || '');
  }
  function byId(list, id) { for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  /* ---------- health bars ----------
     A quad per bar, sized in screen pixels around a 3D anchor. Fill, background and a 1 px
     border are worked out in the fragment shader. */
  const BAR_VERT = `
    attribute vec4 aPos;     // anchor xyz, width in px
    attribute vec2 aFill;    // fill 0..1, height in px
    attribute vec3 aCol;
    uniform vec2 uRes;
    varying vec2 vPx; varying vec2 vSize; varying float vFill; varying vec3 vCol;
    void main() {
      vec4 clip = projectionMatrix * viewMatrix * vec4(aPos.xyz, 1.0);
      vSize = vec2(aPos.w, aFill.y) + 2.0;
      clip.xy += position.xy * vSize / uRes * 2.0 * clip.w;
      vPx = (position.xy + 0.5) * vSize; vFill = aFill.x; vCol = aCol;
      gl_Position = clip;
    }`;
  const BAR_FRAG = `
    varying vec2 vPx; varying vec2 vSize; varying float vFill; varying vec3 vCol;
    void main() {
      bool edge = vPx.x < 1.0 || vPx.y < 1.0 || vPx.x > vSize.x - 1.0 || vPx.y > vSize.y - 1.0;
      float f = (vPx.x - 1.0) / max(1.0, vSize.x - 2.0);
      vec3 c = edge ? vec3(0.07, 0.06, 0.05) : (f <= vFill ? vCol : vec3(0.16, 0.14, 0.13));
      gl_FragColor = vec4(c, 0.92);
      #include <colorspace_fragment>
    }`;
  class Bars {
    constructor(scene, max) {
      this.max = max; this.n = 0;
      const quad = new THREE.PlaneGeometry(1, 1), geo = this.geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position'));
      this.pos = new Float32Array(max * 4); this.fill = new Float32Array(max * 2); this.col = new Float32Array(max * 3);
      this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4); this.aFill = new THREE.InstancedBufferAttribute(this.fill, 2); this.aCol = new THREE.InstancedBufferAttribute(this.col, 3);
      for (const a of [this.aPos, this.aFill, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPos', this.aPos); geo.setAttribute('aFill', this.aFill); geo.setAttribute('aCol', this.aCol);
      geo.instanceCount = 0;
      this.mat = new THREE.ShaderMaterial({ uniforms: { uRes: { value: new THREE.Vector2(800, 600) } }, vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, transparent: true, depthTest: false, depthWrite: false });
      this.mesh = new THREE.Mesh(geo, this.mat);
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 20; this.mesh.visible = false;
      scene.add(this.mesh);
      this._c = new THREE.Color();
      quad.dispose();
    }
    begin(w, h) { this.n = 0; this.mat.uniforms.uRes.value.set(w, h); }
    add(x, y, z, wPx, hPx, f, color) {
      if (this.n >= this.max) return;
      const i = this.n++, c = this._c.set(color);
      this.pos[i * 4] = x; this.pos[i * 4 + 1] = y; this.pos[i * 4 + 2] = z; this.pos[i * 4 + 3] = wPx;
      this.fill[i * 2] = Math.max(0, Math.min(1, f)); this.fill[i * 2 + 1] = hPx;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    }
    end() {
      this.geo.instanceCount = this.n; this.mesh.visible = this.n > 0;
      if (this.n) { this.aPos.needsUpdate = true; this.aFill.needsUpdate = true; this.aCol.needsUpdate = true; }
    }
    dispose() { this.geo.dispose(); this.mat.dispose(); }
  }

  class Hud {
    constructor(view) {
      this.view = view; this.picker = view.picker; this.units = view.units; this.buildings = view.buildings;
      const stage = view.stage;
      this.box = el('div', 'hud', stage);
      this.box.setAttribute('aria-hidden', 'true');
      this.markers = [];                                   // boat badges
      this.chip = el('div', 'sel-chip', this.box); this.chip.hidden = true;
      this.floatBox = document.getElementById('floaters') || el('div', 'floaters', stage);
      this.floatEls = [];
      this.perf = el('div', 'perf-hud', stage); this.perf.hidden = true;
      this.bars = new Bars(view.scene, 96);
      this.lastHp = new Map(); this.numbers = [];          // damage numbers: renderer-owned
      this.frames = new Float32Array(120); this.fi = 0; this.fn = 0; this.perfT = 0;
      this.time = 0; this.chipT = 0; this.chipKey = null; this.chipText = null;
    }
    sample(ms) { this.frames[this.fi] = ms; this.fi = (this.fi + 1) % this.frames.length; this.fn = Math.min(this.fn + 1, this.frames.length); }
    frameStats() {
      const n = this.fn; if (!n) return { fps: 0, ms: 0 };
      let sum = 0; for (let i = 0; i < n; i++) sum += this.frames[i];
      const ms = sum / n; return { fps: 1000 / ms, ms };
    }
    size() { const s = this.view.stage; return { w: s.clientWidth || 800, h: s.clientHeight || 600 }; }

    update(dt) {
      this.time += dt;
      const sz = this.size();
      this.boatMarkers(sz);
      this.selectionChip(dt);
      this.healthBars(sz);
      this.damageNumbers(dt);
      this.floaters();
      this.perfOverlay(dt);
    }

    /* ---------- boat markers ---------- */
    marker(i) {
      let m = this.markers[i];
      if (!m) {
        m = el('div', 'boat-mark', this.box);
        m.arrow = el('i', 'bm-arrow', m); m.count = el('b', '', m);
        m.hidden = true; this.markers[i] = m;
      }
      return m;
    }
    boatMarkers(sz) {
      let i = 0;
      if (typeof RT !== 'undefined' && RT) {
        const pad = 22, w = sz.w, h = sz.h, cx = w / 2, cy = h / 2;
        for (const b of RT.boats) {
          if (b.state !== 'sail' || b.wave !== G.wave) continue;
          if (RT.phase === 'countdown' && RT.timer > b.visibleAt) continue;
          const o = this.picker.project(b.x, (b.boss ? 1.5 : 1.25), b.y, _o);
          const m = this.marker(i++);
          let x = o.x, y = o.y, edge = o.behind || x < pad || x > w - pad || y < pad || y > h - pad;
          let ang = 0;
          if (edge) {
            let dx = x - cx, dy = y - cy;
            if (o.behind) { dx = -dx; dy = -dy; }
            if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
            const k = Math.min((cx - pad) / Math.max(1e-3, Math.abs(dx)), (cy - pad) / Math.max(1e-3, Math.abs(dy)));
            x = cx + dx * k; y = cy + dy * k; ang = Math.atan2(dy, dx);
            // keep clear of the zoom buttons in the bottom-right corner
            const zx = w - 64, zy = h - 128;
            if (x > zx && y > zy) { if (x >= w - pad - 0.5) y = zy; else x = zx; }
          }
          const cls = 'boat-mark' + (b.boss ? ' boss' : '') + (edge ? ' edge' : '');
          if (m.className !== cls) m.className = cls;
          if (m._n !== b.cargo.length) { m._n = b.cargo.length; setText(m.count, String(m._n)); }
          const a = Math.round(ang * 50);
          if (edge && m._a !== a) { m._a = a; m.arrow.style.transform = 'rotate(' + (a / 50) + 'rad) translateX(16px)'; }
          place(m, x, y);
          setShown(m, true);
        }
      }
      for (; i < this.markers.length; i++) setShown(this.markers[i], false);
    }

    /* ---------- the selected building or squad ---------- */
    selectionChip(dt) {
      const ui = typeof UI !== 'undefined' ? UI : null;
      let text = '', x = 0, y = 0, z = 0;
      const fresh = (this.chipT -= dt) <= 0, key = ui ? (ui.placing ? 0 : ui.selB || -(ui.selSq || 0)) : 0;
      if (fresh || key !== this.chipKey) { this.chipT = 0.25; this.chipKey = key; this.chipText = null; }
      if (ui && ui.selB && !ui.placing) {
        const b = byId(G.buildings, ui.selB), st = b && this.buildings.state.get(b.id);
        if (b && st) {
          if (this.chipText === null) {
            let s = BUILDINGS[b.type].name + ' · Lv ' + b.lvl;
            if (b.ruined) s += b.rebuild > 0 ? ' · rebuilding' : ' · in ruins';
            else if (b.hp < b.maxHp - 0.5) s += ' · ' + Math.round(b.hp / b.maxHp * 100) + '%';
            this.chipText = s;
          }
          text = this.chipText;
          x = st.cx; y = st.gy + (st.h || 0.5) + 0.2; z = st.cz;
        }
      } else if (ui && ui.selSq && typeof RT !== 'undefined' && RT) {
        const sq = byId(G.squads, ui.selSq);
        if (sq && sq.rt) {
          if (this.chipText === null) {
            const n = sq.rt.members.length, size = sq.rt.stats ? sq.rt.stats.size : n;
            const status = typeof squadStatus === 'function' ? squadStatus(sq)[1] : '';
            this.chipText = sq.name + ' · ' + (CLASSES[sq.cls] ? CLASSES[sq.cls].name : '') + ' · ' + n + '/' + size + (status ? ' · ' + status : '');
          }
          text = this.chipText;
          let sx = 0, sz = 0, k = 0, top = 0;
          for (const u of sq.rt.members) { const s = this.units.posOf(u); if (s) { sx += s.x; sz += s.z; top = Math.max(top, s.gy); k++; } }
          if (k) { x = sx / k; z = sz / k; y = Math.max(0, top) + 0.55; } else { x = sq.rt.ax; z = sq.rt.ay; y = Math.max(0, R3.Terrain.heightAt(x, z)) + 0.55; }
        }
      }
      if (!text) { setShown(this.chip, false); return; }
      const o = this.picker.project(x, y, z, _o);
      if (o.behind) { setShown(this.chip, false); return; }
      setText(this.chip, text);
      place(this.chip, o.x, o.y, ' translate(-50%, -100%)');
      setShown(this.chip, true);
    }

    /* ---------- health bars ---------- */
    healthBars(sz) {
      const B = this.bars;
      B.begin(sz.w, sz.h);
      const on = (typeof SETTINGS === 'undefined' || SETTINGS.healthBars) && !this.view.rig.showcase;
      if (on && typeof RT !== 'undefined' && RT) {
        const battle = RT.phase !== 'countdown';
        for (const b of G.buildings) {
          const st = this.buildings.state.get(b.id);
          if (!st) continue;
          if (b.ruined && b.rebuild > 0) {
            const total = b.type === 'hall' ? 8 : 6;
            B.add(st.cx, st.gy + 0.45, st.cz, 30, 4, 1 - b.rebuild / total, 0x8fd3a0);
          } else if (!b.ruined && battle && b.hp < b.maxHp - 0.5) {
            B.add(st.cx, st.gy + (st.h || 0.5) + 0.14, st.cz, b.type === 'hall' ? 40 : 30, 4, b.hp / b.maxHp, 0xe0b050);
          }
        }
        const K = R3.UnitModels.KINDS;
        for (const u of RT.units) {
          if (!u.alive) continue;
          const st = this.units.posOf(u);
          if (!st) continue;
          const scale = (K[u.kind] && K[u.kind].scale) || 1, head = Math.max(st.gy, 0) + 0.34 * scale + 0.06;
          if (u.side === 1) {
            if (u.big || u.hp < u.maxHp) B.add(st.x, head, st.z, u.big ? 34 : 18, 3, u.hp / u.maxHp, 0xe45a4a);
          } else if (u.slot === 0 && u.sq && u.sq.rt && u.sq.rt.stats && u.sq.rt.members.length < u.sq.rt.stats.size) {
            // a commander shows how many of the squad are left
            B.add(st.x, head + 0.14, st.z, 26, 3, u.sq.rt.members.length / u.sq.rt.stats.size, typeof squadHex === 'function' ? squadHex(u.sq) : 0xf2c94c);
          }
        }
      }
      B.end();
    }

    /* ---------- damage numbers (renderer-owned, never the sim's floaters) ---------- */
    damageNumbers(dt) {
      const on = typeof SETTINGS !== 'undefined' && SETTINGS.damageNumbers;
      const list = this.numbers;
      for (let i = list.length - 1; i >= 0; i--) if ((list[i].t += dt) > list[i].dur) list.splice(i, 1);
      if (typeof RT === 'undefined' || !RT) return;
      const seen = this.lastHp;
      for (const u of RT.units) {
        const prev = seen.get(u.id);
        seen.set(u.id, u.hp);
        if (!on || prev === undefined || !u.alive && u.hp > 0) continue;
        const d = prev - u.hp;
        if (d < 0.5) continue;
        const st = this.units.posOf(u);
        if (!st) continue;
        if (list.length >= 18) list.shift();
        list.push({ x: st.x + (Math.random() - 0.5) * 0.15, y: Math.max(st.gy, 0) + 0.4, z: st.z, t: 0, dur: 0.8, text: String(Math.round(d)), color: u.side === 1 ? '#fff2c0' : '#ff8a7a', small: true });
      }
      if (seen.size > 400) seen.clear();       // forget long-gone units now and then
    }

    /* ---------- floating labels ---------- */
    floatEl(i) {
      let e = this.floatEls[i];
      if (!e) { e = el('span', 'floater', this.floatBox); this.floatEls[i] = e; e._t = ''; e._c = ''; e._s = false; }
      return e;
    }
    // One label at a 3D point; returns the next free label index.
    floatShow(i, x, y, z, text, color, alpha, small) {
      const o = this.picker.project(x, y, z, _o);
      if (o.behind) return i;
      const e = this.floatEl(i);
      setText(e, text);
      if (e._c !== color) { e.style.color = color; e._c = color; }
      if (e._s !== small) { e.classList.toggle('small', !!small); e._s = small; }
      place(e, o.x, o.y, ' translate(-50%, -50%)');
      const a = Math.round(Math.max(0, Math.min(1, alpha)) * 20);
      if (e._o !== a) { e._o = a; e.style.opacity = String(a / 20); }
      if (e.hidden) e.hidden = false;
      return i + 1;
    }
    floaters() {
      if (!this.floatBox) return;
      let i = 0;
      const max = 28;
      if (typeof RT !== 'undefined' && RT) {
        for (const f of RT.floaters) {
          if (i >= max) break;
          // the sim drifts floaters north as they age; undo that and rise straight up instead
          const x = f.x, z = f.y + f.t * 0.5 + 0.3;
          i = this.floatShow(i, x, Math.max(0, R3.Terrain.heightAt(x, z)) + 0.32 + f.t * 0.45, z, f.text, f.color, 1.3 - f.t, false);
        }
      }
      for (const n of this.numbers) { if (i >= max) break; i = this.floatShow(i, n.x, n.y + n.t * 0.6, n.z, n.text, n.color, 1.2 - n.t / n.dur, true); }
      for (; i < this.floatEls.length; i++) if (!this.floatEls[i].hidden) this.floatEls[i].hidden = true;
    }

    /* ---------- performance overlay ---------- */
    perfOverlay(dt) {
      const on = typeof SETTINGS !== 'undefined' && SETTINGS.perfOverlay;
      setShown(this.perf, on);
      if (!on || (this.perfT -= dt) > 0) return;
      this.perfT = 0.25;
      const v = this.view, f = this.frameStats(), mem = v.renderer.info.memory;
      const q = v.level ? v.level.charAt(0).toUpperCase() + v.level.slice(1) : '?';
      const auto = typeof SETTINGS !== 'undefined' && SETTINGS.quality === 'auto';
      let heap = '';
      try { if (performance.memory) heap = ' · heap ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB'; } catch (e) { /* not available */ }
      setText(this.perf,
        Math.round(f.fps) + ' fps · ' + f.ms.toFixed(1) + ' ms\n' +
        (v.lastCalls || 0) + ' draw calls · ' + Math.round((v.lastTris || 0) / 1000) + 'k triangles\n' +
        q + (auto ? ' (auto)' : '') + ' · ' + v.renderer.getPixelRatio().toFixed(2) + '× pixels · shadows ' + (v.shadows ? 'on' : 'off') + '\n' +
        'particles ' + v.puffs.n + '+' + v.sparks.n + '+' + v.foam.n + ' · ' + mem.geometries + ' geometries · ' + mem.textures + ' textures' + heap);
    }

    dispose() { this.bars.dispose(); this.box.remove(); this.perf.remove(); }
  }

  R3.Hud = Hud;
  R3.Bars = Bars;
})(window.R3);
