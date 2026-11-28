'use strict';
/* Title menu: the island turns slowly behind a card with Continue / Start, Settings, How to play
   and Start over. It opens on load (and from the ☰ button), keeps the game paused while it is
   up, and holds back the "While you were away" summary until the player continues.
   Under browser automation it stays closed unless the URL asks for it with ?menu, so tests can
   drive the game directly. */
const MENU = { view: 'main', after: [], hadSave: false };

function menuWanted() {
  const q = location.search;
  if (/(?:^|[?&])menu(?:&|=|$)/.test(q)) return true;
  try { if (navigator.webdriver) return false; } catch (e) { /* no navigator */ }
  return true;
}

function openMenu(view) {
  UI.menu = true; MENU.view = view || 'main';
  cancelModes(); UI.selB = null; UI.hover = null;
  document.body.classList.add('menu-open');
  setHidden($('menu'), false);
  if (VIEW && VIEW.setShowcase) VIEW.setShowcase(true);
  renderMenu();
  const first = document.querySelector('#menu .menu-primary');
  if (first) try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
}

function closeMenu() {
  if (!UI.menu) return;
  UI.menu = false;
  document.body.classList.remove('menu-open');
  setHidden($('menu'), true);
  if (VIEW && VIEW.setShowcase) VIEW.setShowcase(false);
  renderPanel(); updateHeader();
  const later = MENU.after.splice(0);
  for (const fn of later) fn();
}

// Run something once the player has left the menu (or now, if it isn't up).
function afterMenu(fn) { if (UI.menu) MENU.after.push(fn); else fn(); }

function menuSummary() {
  const tr = islandTrait(G.island.trait);
  const parts = ['Wave ' + G.wave, tr.name + ' isle'];
  if (G.bestWave) parts.push('best ' + G.bestWave);
  if (G.renownTotal > 0) parts.push(fmt(G.renown) + ' Renown');
  return parts.join(' · ');
}

function renderMenu() {
  const card = $('menu-card');
  if (!card) return;
  let h = '';
  if (MENU.view === 'settings') {
    h = '<div class="menu-sub"><button class="btn btn-small" data-act="menu-view" data-arg="main">← Back</button><h2>Settings</h2></div>' +
      '<div class="menu-scroll">' + settingsTab() + '</div>';
  } else if (MENU.view === 'help') {
    h = '<div class="menu-sub"><button class="btn btn-small" data-act="menu-view" data-arg="main">← Back</button><h2>How to play</h2></div>' +
      '<div class="menu-scroll menu-help">' +
      '<p><b>Build up the island.</b> Pick a building in the Build tab, then ' + (isTouch() ? 'tap a tile twice' : 'click a tile') + '. Cottages make gold, lumber camps cut timber, and the Great Hall unlocks more of everything.</p>' +
      '<p><b>Raiders row in every wave.</b> Badges at the edge of the map show where each longboat is heading and how many it carries. Your squads fight on their own; select one and pick a tile to station it.</p>' +
      '<p><b>Hold the high ground.</b> Highland can only be climbed by its slopes, the stepped tracks up the cliffs. Bowmen and watchtowers up there reach one tile further, and raiders have to come round by the slopes to get at them.</p>' +
      '<p><b>Mind the edges.</b> Shield bashes and big swings knock fighters back, and anyone pushed into the sea drowns.</p>' +
      '<p><b>Sail on.</b> From wave 10 you can leave for a fresh island and earn Renown for permanent Sagas.</p>' +
      '<p class="note">' + (isTouch() ? 'Drag to turn the island, pinch to zoom, two fingers to pan.' : 'Drag to turn the island, right-drag to pan, scroll to zoom. Space pauses, 1 2 3 set the speed, F3 shows the frame rate.') + '</p></div>';
  } else if (MENU.view === 'confirm') {
    h = '<h2 class="menu-confirm-title">Start over?</h2><p class="menu-text">This erases the save in this browser: the island, buildings, squads, Renown and Sagas. It can\'t be undone.</p>' +
      '<div class="menu-actions"><button class="btn btn-danger menu-primary" data-act="menu-reset">Erase and start again</button><button class="btn" data-act="menu-view" data-arg="main">Keep my game</button></div>';
  } else {
    const fresh = !MENU.hadSave;
    h = '<h1 id="menu-title" class="menu-title">Idle Island</h1>' +
      '<p class="menu-tag">Hold the isle. The longboats are coming.</p>' +
      '<div class="menu-actions">' +
      '<button class="btn btn-primary menu-primary" data-act="menu-play">' + (fresh ? 'Start' : 'Continue') + '<small>' + escapeHtml(fresh ? 'A ' + islandTrait(G.island.trait).name.toLowerCase() + ' isle awaits' : menuSummary()) + '</small></button>' +
      '<button class="btn" data-act="menu-view" data-arg="settings">Settings</button>' +
      '<button class="btn" data-act="menu-view" data-arg="help">How to play</button>' +
      (fresh ? '' : '<button class="btn btn-quiet" data-act="menu-view" data-arg="confirm">Start over</button>') +
      '</div><p class="menu-foot">Progress saves in this browser. Nothing to install.</p>';
  }
  morphInto(card, h);
  card.setAttribute('data-view', MENU.view);
}

// Menu actions (called from doAction).
function menuAction(act, arg) {
  if (act === 'menu') { openMenu('main'); return true; }
  if (act === 'menu-play') { MENU.hadSave = true; closeMenu(); return true; }
  if (act === 'menu-view') { MENU.view = arg || 'main'; renderMenu(); const s = document.querySelector('#menu .menu-scroll'); if (s) s.scrollTop = 0; return true; }
  if (act === 'menu-reset') {
    wipeSave(); G = null; newGame(); cancelModes(); UI.selB = null; UI.exportStr = ''; UI.importMsg = '';
    resetRuntime();
    logEvent('Settlers come ashore on a ' + islandTrait(G.island.trait).name.toLowerCase() + ' isle.');
    saveGame();
    MENU.hadSave = false; MENU.after.length = 0; MENU.view = 'main';
    renderMenu();
    return true;
  }
  return false;
}
