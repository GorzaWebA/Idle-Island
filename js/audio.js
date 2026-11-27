'use strict';
/* Procedural sound with WebAudio. No audio files: every sound is built from oscillators and a
   noise buffer made at startup. Off until the player turns it on in Settings.
     waves    a soft surf loop (filtered noise, slowly swelling)
     horn     when a wave's battle begins (lower and longer for the Warlord)
     clinks   melee hits and shield bashes; arrows whip off the string and thunk where they land
     fire     crackles while buildings burn
     splash   someone goes into the sea
     build    a wooden knock when something is built
     click    a gentle tick for buttons
   It only reads the game state (like the renderer) and never changes it. Sounds are rate-limited
   so 3x speed or a big battle can't turn into noise, and are panned by where they happen on
   screen. */
const AUDIO = (function () {
  let ctx = null, master = null, noise = null, ambGain = null;
  let enabled = false, volume = 0.6;
  const played = {};
  const budget = {};                 // per-kind tokens, refilled every second
  const LIMIT = { clink: 10, bash: 4, shot: 6, thunk: 6, crackle: 18, splash: 4, horn: 1, build: 4, click: 12 };
  let seenFx = new WeakSet(), seenShot = new WeakSet(), lastPhase = null, lastBuilt = -1, crackleT = 0, refillT = 0;

  function available() { return !!(window.AudioContext || window.webkitAudioContext); }

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    // two seconds of soft noise for surf, hiss, crackle and splashes
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99 * b0 + w * 0.06; b1 = 0.6 * b1 + w * 0.4; d[i] = (b0 + b1) * 0.6; }
    noise = buf;
    startAmbience();
    return true;
  }

  function startAmbience() {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
    ambGain = ctx.createGain(); ambGain.gain.value = 0.05;
    // the surf swells and falls back
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 0.11; depth.gain.value = 0.035;
    lfo.connect(depth); depth.connect(ambGain.gain);
    const lfo2 = ctx.createOscillator(), depth2 = ctx.createGain();
    lfo2.frequency.value = 0.07; depth2.gain.value = 160;
    lfo2.connect(depth2); depth2.connect(lp.frequency);
    src.connect(lp); lp.connect(ambGain); ambGain.connect(master);
    src.start(); lfo.start(); lfo2.start();
  }

  function allow(kind) {
    if (!enabled || !ctx || ctx.state !== 'running') return false;
    if ((budget[kind] = (budget[kind] === undefined ? LIMIT[kind] : budget[kind])) <= 0) return false;
    budget[kind]--;
    played[kind] = (played[kind] || 0) + 1;
    return true;
  }
  // A sound's output: through a stereo panner when the browser has one.
  function out(pan) {
    const g = ctx.createGain();
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.8, Math.min(0.8, pan)); g.connect(p); p.connect(master); }
    else g.connect(master);
    return g;
  }
  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  function tone(type, freq, t, peak, attack, decay, dest, glideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
    env(g, t, peak, attack, decay);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  function burst(t, dur, peak, filter, f0, f1, q, dest) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    f.type = filter; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 1;
    env(g, t, peak, Math.min(0.01, dur * 0.2), dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  const jitter = (f, k) => f * (1 + (Math.random() - 0.5) * k);

  const SFX = {
    click() { const t = ctx.currentTime, o = out(0); tone('sine', 1250, t, 0.05, 0.002, 0.04, o); tone('sine', 1875, t, 0.02, 0.002, 0.03, o); },
    horn(boss) {
      const t = ctx.currentTime + 0.05, o = out(0), base = boss ? 73 : 98, hold = boss ? 2.2 : 1.4;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = boss ? 520 : 700; lp.connect(o);
      for (const [mul, type, peak] of [[1, 'sawtooth', 0.12], [1.5, 'sawtooth', 0.05], [2, 'triangle', 0.04]]) {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(base * mul * 0.94, t); osc.frequency.linearRampToValueAtTime(base * mul, t + 0.3);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.35);
        g.gain.setValueAtTime(peak, t + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.9);
        osc.connect(g); g.connect(lp); osc.start(t); osc.stop(t + hold + 1);
      }
    },
    clink(pan) {
      const t = ctx.currentTime, o = out(pan);
      for (const [f, p, d] of [[1850, 0.05, 0.16], [2700, 0.035, 0.12], [4150, 0.02, 0.08]]) tone('sine', jitter(f, 0.1), t, p, 0.002, d, o);
      burst(t, 0.03, 0.04, 'highpass', 3000, 0, 0.7, o);
    },
    bash(pan) { const t = ctx.currentTime, o = out(pan); tone('sine', 140, t, 0.12, 0.004, 0.18, o, 70); burst(t, 0.08, 0.06, 'lowpass', 900, 300, 0.7, o); },
    shot(pan) { burst(ctx.currentTime, 0.12, 0.035, 'bandpass', jitter(2600, 0.2), 900, 2.5, out(pan)); },
    thunk(pan) { const t = ctx.currentTime, o = out(pan); tone('sine', jitter(200, 0.2), t, 0.06, 0.002, 0.07, o, 90); burst(t, 0.04, 0.025, 'lowpass', 1400, 0, 0.8, o); },
    crackle(pan) { burst(ctx.currentTime, 0.008 + Math.random() * 0.02, 0.02 + Math.random() * 0.04, 'highpass', 1500 + Math.random() * 2800, 0, 0.8, out(pan)); },
    splash(pan) { const t = ctx.currentTime, o = out(pan); burst(t, 0.45, 0.1, 'lowpass', 1600, 280, 0.9, o); burst(t + 0.05, 0.25, 0.03, 'highpass', 2500, 0, 0.7, o); },
    build(pan) { const t = ctx.currentTime, o = out(pan); tone('triangle', 180, t, 0.09, 0.003, 0.12, o, 110); tone('triangle', 240, t + 0.11, 0.06, 0.003, 0.1, o, 150); }
  };
  function play(kind, a, b) { if (allow(kind)) { try { SFX[kind](a, b); } catch (e) { /* a node failed */ } } }

  // Where a tile point sits on screen, as a stereo position.
  function panAt(x, y) {
    try {
      if (typeof VIEW === 'undefined' || !VIEW || !VIEW.canvas) return 0;
      const p = VIEW.tileToScreen(x - 0.5, y - 0.5), w = VIEW.canvas.clientWidth || 1;
      return (p.x / w) * 2 - 1;
    } catch (e) { return 0; }
  }

  // Treat everything already on screen as heard, so turning sound on doesn't play a backlog.
  function catchUp() {
    if (typeof RT === 'undefined' || !RT) return;
    for (const e of RT.effects) seenFx.add(e);
    for (const p of RT.projectiles) seenShot.add(p);
    lastPhase = RT.phase; lastBuilt = G.buildings.length;
  }

  function update(dt) {
    if (!enabled || !ctx || typeof RT === 'undefined' || !RT) return;
    if ((refillT -= dt) <= 0) { refillT = 1; for (const k in LIMIT) budget[k] = LIMIT[k]; }
    if (lastPhase === 'countdown' && RT.phase === 'battle') play('horn', RT.boats.some(b => b.boss && b.wave === G.wave));
    lastPhase = RT.phase;
    if (lastBuilt >= 0 && G.buildings.length > lastBuilt) { const b = G.buildings[G.buildings.length - 1]; play('build', panAt(b.x + 0.5, b.y + 0.5)); }
    lastBuilt = G.buildings.length;
    for (const e of RT.effects) {
      if (seenFx.has(e)) continue;
      seenFx.add(e);
      if (e.type === 'hit' || e.type === 'spark') play('clink', panAt(e.x, e.y));
      else if (e.type === 'bash') play('bash', panAt(e.x, e.y));
      else if (e.type === 'splash') play('splash', panAt(e.x, e.y));
      else if (e.type === 'volley') play('thunk', panAt(e.x, e.y));
    }
    for (const p of RT.projectiles) {
      if (seenShot.has(p)) continue;
      seenShot.add(p);
      if (Math.random() < 0.6) play('shot', panAt(p.sx, p.sy));
    }
    // fire: crackles while anything burns (damaged during a battle, or a fresh ruin)
    let burning = 0, bx = 0, by = 0;
    for (const b of G.buildings) {
      if ((b.ruined && b.rebuild <= 0) || (!b.ruined && RT.phase !== 'countdown' && b.hp < b.maxHp * 0.7)) { burning++; bx = b.x + 0.5; by = b.y + 0.5; }
    }
    if (burning && (crackleT -= dt) <= 0) {
      crackleT = 1 / Math.min(16, 3 + burning * 3) * (0.5 + Math.random());
      play('crackle', panAt(bx, by));
    }
  }

  function setEnabled(on) {
    on = !!on;
    if (on) {
      if (!ensure()) return false;
      catchUp();
      try { ctx.resume(); } catch (e) { /* not allowed yet */ }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
    } else if (ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => { if (!enabled && ctx) ctx.suspend(); }, 300);
    }
    enabled = on;
    return true;
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v)) * 0.9;
    if (ctx && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }

  function init() {
    if (typeof SETTINGS !== 'undefined') {
      setVolume(SETTINGS.volume);
      if (SETTINGS.sound) setEnabled(true);
      onSettingsChange((k, v) => { if (k === 'sound') setEnabled(v); else if (k === 'volume') setVolume(v); });
    }
    // Browsers only start audio after a gesture: resume on the first one.
    const wake = () => { if (enabled && ctx && ctx.state !== 'running') ctx.resume(); };
    document.addEventListener('pointerdown', wake, true);
    document.addEventListener('keydown', wake, true);
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume();
    });
  }

  return {
    init, update, setEnabled, setVolume, available,
    click() { play('click'); },
    stats() { return { enabled, state: ctx ? ctx.state : 'none', played: Object.assign({}, played) }; }
  };
})();
