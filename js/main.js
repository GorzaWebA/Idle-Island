'use strict';
/* Boot, main loop, autosave and offline catch-up. */

// The active renderer (see the VIEW interface in js/render3d.js).
let VIEW = null;

// 3D unless the page asks for the classic map (?2d) or WebGL is unavailable.
function chooseView(stage) {
  const want2d = /(?:^|[?&])2d(?:&|=|$)/.test(location.search);
  if (!want2d && window.R3 && R3.view && typeof THREE !== 'undefined' && R3.view.init(stage)) return { view: R3.view, fellBack: false };
  VIEW2D.init(stage);
  return { view: VIEW2D, fellBack: !want2d };
}

function showOffline(g) {
  const stat = (k, v) => '<div><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  showModal('While you were away',
    '<p class="note">' + fmtTime(g.sec) + ' passed on the island' + (g.capped ? ' (the most it counts is ' + fmtTime(D.offlineCap) + ')' : '') +
    '. Your settlers kept working at ' + Math.round(D.offlineEff * 100) + '% pace.</p><div class="stats">' +
    stat('Gold', '+' + fmt(g.gold)) + stat('Timber', '+' + fmt(g.timber)) +
    (g.waves ? stat('Raids held', fmt(g.waves)) + stat('At wave', String(g.farm)) : '') + '</div>');
}

function start(data) {
  let loaded = false;
  try {
    if (data && data.save) { deserialize(data.save); loaded = true; }
    else loaded = loadGame();
  } catch (e) { loaded = false; }
  if (!loaded) {
    G = null; newGame();
    logEvent('Settlers come ashore on a ' + islandTrait(G.island.trait).name.toLowerCase() + ' isle.');
  }
  const stage = $('stage');
  const chosen = chooseView(stage);
  VIEW = chosen.view;
  resetRuntime();
  initUI();
  if (typeof AUDIO !== 'undefined') AUDIO.init();
  if (chosen.fellBack) setBanner('Classic map', 'This browser can\'t show the 3D island, so the flat map is shown instead.', 'bad');

  if (loaded && !(data && data.save)) {
    const away = (Date.now() - G.lastSave) / 1000;
    if (away > 60) showOffline(applyOffline(away));
  }

  const onResize = () => VIEW.resize();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(stage);
  window.addEventListener('resize', onResize);

  setInterval(saveGame, 15000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); saveGame(); }
    else if (hiddenAt) {
      const gap = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      if (gap > 30) { const g = applyOffline(gap); if (gap > 120) showOffline(g); }
    }
  });
  window.addEventListener('pagehide', saveGame);

  try { window.claude && window.claude.hot && window.claude.hot.snapshot && window.claude.hot.snapshot(() => ({ save: serialize() })); } catch (e) { /* no hot reload host */ }

  let last = performance.now(), acc = 0, panelT = 0;
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    dt = Math.min(Math.max(dt, 0), 0.25);
    if (!G.paused) {
      acc += dt * G.speed;
      let n = 0;
      while (acc >= STEP && n < 30) { VIEW.beforeStep(); step(STEP); acc -= STEP; n++; }
      if (n >= 30) acc = 0;
    }
    VIEW.frame(dt, G.paused ? 1 : acc / STEP);
    if (typeof AUDIO !== 'undefined') AUDIO.update(dt);
    updateHeader();
    panelT -= dt;
    if (panelT <= 0) { panelT = 0.2; renderPanel(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

(function boot() {
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
