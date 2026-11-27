'use strict';
/* Camera rig: a perspective camera orbiting a target on the island.
   Mouse: left-drag orbit, right/middle-drag pan, wheel zoom (towards the cursor).
   Touch: one finger orbits, two fingers pinch-zoom and pan.
   Keys: Q/E rotate, W/A/S/D pan. Everything eases towards its goal and is clamped. */
window.R3 = window.R3 || {};
(function (R3) {
  const PITCH_MIN = 0.42, PITCH_MAX = 1.36, PITCH_DEFAULT = 0.9;   // radians (24°..78°, default ~52°)
  const TAP_SLOP = 8, TAP_MS = 800, IDLE_ROTATE_AFTER = 20;

  class CameraRig {
    constructor(camera, dom) {
      this.camera = camera; this.dom = dom;
      this.target = new THREE.Vector3(); this.goal = new THREE.Vector3();
      this.yaw = 0; this.gYaw = 0; this.pitch = PITCH_DEFAULT; this.gPitch = PITCH_DEFAULT;
      this.dist = 20; this.gDist = 20; this.minDist = 4; this.maxDist = 40; this.fitDist = 20;
      this.bounds = { x0: 0, x1: MAP_W, z0: 0, z1: MAP_H, cx: MAP_W / 2, cz: MAP_H / 2 };
      this.keys = new Set(); this.idle = 0; this.autoRotate = false;
      this.pointers = new Map(); this.gesture = null; this.listeners = [];
      this.groundPick = null;     // (mx, my) -> Vector3 on the ground, set by the renderer
      this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
      this.shakeAmp = 0; this.slowT = 0;
      this.reducedMotion = false;
      // the player's Settings choice, or the system's
      const reduced = () => (typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      try { this.reducedMotion = reduced(); window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { this.reducedMotion = reduced(); }); } catch (e) { /* old browser */ }
    }

    // A short camera shake (boss blows). Skipped when the system asks for reduced motion.
    shake(amount) { if (!this.reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, amount); }

    /* Lean the view gently towards a point of interest (the Warlord's longboat): pan part of the
       way and make sure the camera isn't zoomed in tight. Skipped while the player is moving the
       camera, has just moved it, or asked for reduced motion. Returns whether it moved. */
    nudge(x, z) {
      if (this.reducedMotion || this.pointers.size || this.keys.size || this.idle < 2) return false;
      this.goal.x += (x - this.goal.x) * 0.35; this.goal.z += (z - this.goal.z) * 0.35;
      this.gDist = Math.max(this.gDist, this.fitDist * 0.9);
      this.clampGoals();
      this.slowT = 2.5;          // ease there slowly
      return true;
    }

    setBounds(b) { this.bounds = b; }

    // Distance at which the whole island fits the view, found by projecting its bounding box.
    computeFit() {
      const b = this.bounds, cam = this.camera, saved = { y: this.yaw, p: this.pitch, d: this.dist, t: this.target.clone() };
      this.yaw = 0; this.pitch = PITCH_DEFAULT; this.target.set(b.cx, 0.3, b.cz);
      const corners = [];
      for (const x of [b.x0 - 0.15, b.x1 + 0.15]) for (const z of [b.z0 - 0.15, b.z1 + 0.15]) for (const y of [0, 0.95]) corners.push(new THREE.Vector3(x, y, z));
      let lo = 3, hi = 120;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2; this.dist = mid; this.apply();
        cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        let fits = true;
        for (const c of corners) { this._v.copy(c).project(cam); if (Math.abs(this._v.x) > 0.97 || Math.abs(this._v.y) > 0.93 || this._v.z > 1) { fits = false; break; } }
        if (fits) hi = mid; else lo = mid;
      }
      this.fitDist = hi;
      this.minDist = Math.max(3.5, hi * 0.22);
      this.maxDist = hi * 1.35;
      this.yaw = saved.y; this.pitch = saved.p; this.dist = saved.d; this.target.copy(saved.t);
      return hi;
    }

    recentre(immediate) {
      const b = this.bounds;
      this.computeFit();
      this.goal.set(b.cx, 0.3, b.cz);
      this.gYaw = Math.round(this.gYaw / (Math.PI * 2)) * Math.PI * 2;  // nearest "north up"
      this.gPitch = PITCH_DEFAULT; this.gDist = this.fitDist; this.slowT = 0;
      if (immediate) { this.target.copy(this.goal); this.yaw = this.gYaw; this.pitch = this.gPitch; this.dist = this.gDist; this.apply(); }
    }

    // Jump straight to the goal (tests and screenshots).
    settle() { this.target.copy(this.goal); this.yaw = this.gYaw; this.pitch = this.gPitch; this.dist = this.gDist; this.apply(); this.camera.updateMatrixWorld(); }

    zoomBy(f) { this.gDist = THREE.MathUtils.clamp(this.gDist / f, this.minDist, this.maxDist); this.idle = 0; }
    canZoomOut() { return this.gDist < this.maxDist - 0.01; }

    clampGoals() {
      const b = this.bounds;
      this.gPitch = THREE.MathUtils.clamp(this.gPitch, PITCH_MIN, PITCH_MAX);
      this.gDist = THREE.MathUtils.clamp(this.gDist, this.minDist, this.maxDist);
      this.goal.x = THREE.MathUtils.clamp(this.goal.x, b.x0, b.x1);
      this.goal.z = THREE.MathUtils.clamp(this.goal.z, b.z0, b.z1);
    }

    apply() {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      this.camera.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + sp * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
      this.camera.lookAt(this.target);
    }

    // World units per screen pixel at the target, for pans that track the finger.
    unitsPerPx() {
      const h = Math.max(1, this.dom.clientHeight);
      return 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / h;
    }
    pan(dxPx, dyPx) {
      const k = this.unitsPerPx(), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      // right = (cos yaw, 0, -sin yaw); forward on the ground = (-sin yaw, 0, -cos yaw)
      this.goal.x += (-cy * dxPx - sy * dyPx * 1.25) * k;
      this.goal.z += (sy * dxPx - cy * dyPx * 1.25) * k;
      this.clampGoals();
    }
    orbit(dxPx, dyPx) {
      this.gYaw -= dxPx * 0.0075;
      this.gPitch += dyPx * 0.005;
      this.clampGoals();
    }
    // Zoom by factor f (>1 zooms in) keeping the ground point under (mx, my) roughly fixed.
    zoomAt(mx, my, f) {
      const before = this.gDist;
      this.gDist = THREE.MathUtils.clamp(this.gDist / f, this.minDist, this.maxDist);
      const p = this.groundPick && this.groundPick(mx, my);
      if (p) {
        const k = 1 - this.gDist / before;
        this.goal.x += (p.x - this.goal.x) * k;
        this.goal.z += (p.z - this.goal.z) * k;
      }
      this.clampGoals();
    }

    update(dt) {
      // keyboard
      const k = this.keys;
      if (k.size) {
        this.idle = 0;
        if (k.has('q')) this.gYaw += 1.7 * dt;
        if (k.has('e')) this.gYaw -= 1.7 * dt;
        const sp = 260 * dt;
        if (k.has('a')) this.pan(sp, 0);
        if (k.has('d')) this.pan(-sp, 0);
        if (k.has('w')) this.pan(0, sp);
        if (k.has('s')) this.pan(0, -sp);
      }
      this.idle += dt;
      if (this.autoRotate && this.idle > IDLE_ROTATE_AFTER && !this.pointers.size) this.gYaw += dt * 0.06;
      if (this.idle < 0.05) this.slowT = 0;          // any input takes over at once
      const a = 1 - Math.exp(-dt * (this.slowT > 0 ? 1.6 : 10));
      if (this.slowT > 0) this.slowT -= dt;
      this.target.lerp(this.goal, a);
      this.yaw += (this.gYaw - this.yaw) * a;
      this.pitch += (this.gPitch - this.pitch) * a;
      this.dist += (this.gDist - this.dist) * a;
      this.apply();
      if (this.shakeAmp > 0.001) {
        const k = this.shakeAmp * Math.min(1, this.dist / 15);
        this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k; this.camera.position.z += (Math.random() - 0.5) * k;
        this.shakeAmp *= Math.exp(-dt * 7);
      } else this.shakeAmp = 0;
    }

    /* ---------- input ---------- */
    on(el, type, fn, opts) { el.addEventListener(type, fn, opts); this.listeners.push([el, type, fn, opts]); }
    unbind() { for (const [el, t, fn, o] of this.listeners) el.removeEventListener(t, fn, o); this.listeners = []; }

    // cb: { onTap(mx,my,type), onCancel(), onHover(mx,my), onLeave(), onDown(type,mx,my) }
    bind(cb) {
      const el = this.dom, pts = this.pointers;
      const local = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const pinchState = () => {
        const [a, b] = [...pts.values()];
        return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      };
      this.on(el, 'pointerdown', e => {
        const p = local(e);
        this.idle = 0;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
        pts.set(e.pointerId, p);
        if (cb.onDown) cb.onDown(e.pointerType || 'mouse', p.x, p.y);
        if (pts.size === 1) {
          const mode = e.pointerType === 'mouse' ? (e.button === 0 ? 'orbit' : 'pan') : 'orbit';
          this.gesture = { id: e.pointerId, mode, x: p.x, y: p.y, lx: p.x, ly: p.y, moved: false, t: performance.now(), button: e.button, multi: false, type: e.pointerType };
        } else if (pts.size === 2 && this.gesture) {
          this.gesture.multi = true; this.gesture.mode = 'pinch';
          this.gesture.pinch = pinchState();
        }
      });
      this.on(el, 'pointermove', e => {
        const p = local(e);
        const g = this.gesture;
        if (!pts.has(e.pointerId)) { if (e.pointerType === 'mouse' && cb.onHover) cb.onHover(p.x, p.y); return; }
        pts.set(e.pointerId, p);
        if (!g) return;
        this.idle = 0;
        if (g.mode === 'pinch' && pts.size >= 2) {
          const s = pinchState(), prev = g.pinch;
          this.zoomAt(s.mx, s.my, s.d / prev.d);
          this.pan(s.mx - prev.mx, s.my - prev.my);
          g.pinch = s;
          return;
        }
        if (e.pointerId !== g.id) return;
        if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) > TAP_SLOP) g.moved = true;
        if (g.moved) {
          if (g.mode === 'orbit') this.orbit(p.x - g.lx, p.y - g.ly);
          else if (g.mode === 'pan') this.pan(p.x - g.lx, p.y - g.ly);
        } else if (e.pointerType === 'mouse' && cb.onHover) cb.onHover(p.x, p.y);
        g.lx = p.x; g.ly = p.y;
      });
      const release = e => {
        const g = this.gesture, p = local(e);
        const isTap = e.type === 'pointerup' && g && g.id === e.pointerId && !g.moved && !g.multi && performance.now() - g.t < TAP_MS;
        pts.delete(e.pointerId);
        if (g && g.mode === 'pinch' && pts.size === 1) {
          // one finger left after a pinch: continue as an orbit from where it is, never as a tap
          const [id, q] = [...pts.entries()][0];
          this.gesture = { id, mode: 'orbit', x: q.x, y: q.y, lx: q.x, ly: q.y, moved: true, t: 0, multi: true };
        }
        if (!pts.size) this.gesture = null;
        if (isTap) {
          if (g.type === 'mouse' && g.button === 2) { if (cb.onCancel) cb.onCancel(); }
          else if (g.type !== 'mouse' || g.button === 0) cb.onTap(p.x, p.y, g.type || 'mouse');
        }
      };
      this.on(el, 'pointerup', release);
      this.on(el, 'pointercancel', release);
      this.on(el, 'pointerleave', e => { if (e.pointerType === 'mouse' && !pts.size && cb.onLeave) cb.onLeave(); });
      this.on(el, 'wheel', e => {
        e.preventDefault();
        this.idle = 0;
        const p = local(e);
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0012));
      }, { passive: false });
      this.on(el, 'contextmenu', e => e.preventDefault());
      // Cancel the browser's follow-up click for touches on the map (it can land on nearby buttons).
      this.on(el, 'touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
      const typing = e => { const t = e.target && e.target.tagName; return t === 'INPUT' || t === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey; };
      this.on(window, 'keydown', e => {
        if (typing(e)) return;
        const k = e.key.toLowerCase();
        if ('qewasd'.includes(k) && k.length === 1) this.keys.add(k);
      });
      this.on(window, 'keyup', e => this.keys.delete(e.key.toLowerCase()));
      this.on(window, 'blur', () => this.keys.clear());
    }
  }

  R3.CameraRig = CameraRig;
})(window.R3);
