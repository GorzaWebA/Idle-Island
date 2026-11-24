'use strict';
/* DOM interface: header, tabbed panel, map input. */

const UI = {
  tab: 'build', placing: null, selB: null, selSq: null, hover: null,
  confirm: null, exportStr: '', importMsg: '', toast: null, panelT: 0
};
const $ = id => document.getElementById(id);

function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
function setAttr(el, k, v) { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); }
function setHidden(el, h) { if (el && el.hidden !== h) el.hidden = h; }

/* ---------- minimal DOM morph: keeps existing nodes so clicks are not lost ---------- */
function morphChildren(from, to) {
  const fc = from.childNodes, tc = to.childNodes;
  for (let i = 0; i < tc.length; i++) {
    const t = tc[i], f = fc[i];
    if (!f) { from.appendChild(t.cloneNode(true)); continue; }
    if (f.nodeType !== t.nodeType || f.nodeName !== t.nodeName || (f.nodeType === 1 && f.getAttribute('data-key') !== t.getAttribute('data-key'))) {
      from.replaceChild(t.cloneNode(true), f); continue;
    }
    if (f.nodeType === 3 || f.nodeType === 8) { if (f.data !== t.data) f.data = t.data; continue; }
    morphAttrs(f, t);
    if (f.nodeName === 'TEXTAREA') continue;
    morphChildren(f, t);
  }
  while (fc.length > tc.length) from.removeChild(from.lastChild);
}
function morphAttrs(f, t) {
  for (const a of Array.from(t.attributes)) if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value);
  for (const a of Array.from(f.attributes)) if (!t.hasAttribute(a.name)) f.removeAttribute(a.name);
  if (f.nodeName === 'BUTTON') f.disabled = t.hasAttribute('disabled');
}
const morphTpl = document.createElement('template');
function morphInto(el, html) {
  if (el._html === html) return;
  el._html = html;
  morphTpl.innerHTML = html;
  morphChildren(el, morphTpl.content);
}

/* ---------- helpers ---------- */
function costHtml(c) {
  let s = '<span class="cost">';
  if (c.gold) s += '<i class="' + (G.gold + 1e-9 < c.gold ? 'short' : '') + '">' + fmt(c.gold) + '</i>';
  if (c.timber) s += '<i class="t' + (G.timber + 1e-9 < c.timber ? ' short' : '') + '">' + fmt(c.timber) + '</i>';
  if (c.renown) s += '<i class="r' + (G.renown < c.renown ? ' short' : '') + '">' + fmt(c.renown) + '</i>';
  if (!c.gold && !c.timber && !c.renown) s += 'Free';
  return s + '</span>';
}
function dis(cond) { return cond ? ' disabled' : ''; }
function squadById(id) { return G.squads.find(s => s.id === id) || null; }
function buildingById(id) { return G.buildings.find(b => b.id === id) || null; }

function currentHint() {
  if (D.counts.cottage < 2) return ['Next', 'Build a second Cottage. Cottages make gold and are where squads refill.'];
  if (G.squads.some(s => s.cls === 'militia')) return ['Next', 'Train your Militia as Shieldbearers, Bowmen or Pikemen in the Squads tab (50 gold).'];
  if (D.counts.lumber < 1) return ['Next', 'Place a Lumber Camp touching trees. Every adjacent tree adds timber.'];
  if (D.counts.barracks < 1) return ['Next', 'Build a Barracks to field a second squad.'];
  if (G.squads.length < D.squadCap && G.gold > recruitCost(G.squads.length) * 0.5) return ['Next', 'Recruit another squad in the Squads tab.'];
  if (D.hallL < 2) return ['Next', 'Upgrade the Great Hall to unlock Watchtowers and Palisades.'];
  if (!G.autoAdvance) return ['Farming', 'Advance is off, so you replay this wave. Turn it on when you are ready to push.'];
  if (G.bestWave >= PRESTIGE_WAVE && G.renownTotal === 0) return ['Sagas', 'You can now Sail On to a new island for Renown. Push further first for a bigger reward.'];
  return null;
}

function squadStatus(sq) {
  const st = sq.rt;
  if (!st) return ['', ''];
  if (st.routedT > 0) return ['routed', 'Routed ' + Math.ceil(st.routedT) + 's'];
  switch (st.task) {
    case 'fight': return ['fight', 'Fighting'];
    case 'guard': return ['guard', 'Guarding beach'];
    case 'refill': return ['refill', 'Refilling'];
    case 'retreat': return ['retreat', 'Retreating'];
    case 'hold': return ['hold', 'Holding'];
    default: return ['', 'At ease'];
  }
}

/* ---------- panel tabs ---------- */
function renderPanel() {
  let html = '';
  if (UI.tab === 'build') html = buildTab();
  else if (UI.tab === 'squads') html = squadsTab();
  else if (UI.tab === 'sagas') html = sagasTab();
  else html = chronicleTab();
  morphInto($('panel-body'), html);
  for (const t of ['build', 'squads', 'sagas', 'chronicle']) setAttr($('tab-' + t), 'aria-selected', String(UI.tab === t));
  const hint = currentHint();
  setHidden($('hint'), !hint);
  if (hint) morphInto($('hint'), '<b>' + escapeHtml(hint[0]) + '</b><span>' + escapeHtml(hint[1]) + '</span>');
}

function buildTab() {
  let h = '';
  const sel = UI.selB ? buildingById(UI.selB) : null;
  if (sel) h += buildingCard(sel);
  if (!sel || sel.type !== 'hall') h += hallCard();
  h += '<div class="section-title">Construct <span>Hall Lv ' + D.hallL + '</span></div><div class="blist">';
  for (const type of BUILD_ORDER) {
    const b = BUILDINGS[type];
    const locked = D.hallL < b.unlock;
    const capped = D.counts[type] >= D.caps[type];
    const cost = buildCost(type, D.counts[type]);
    const pressed = UI.placing === type;
    let note;
    if (locked) note = 'Needs Hall Lv ' + b.unlock;
    else if (capped) note = D.caps[type] === 0 ? 'Needs a bigger Hall' : 'Limit reached';
    else note = costHtml(cost);
    h += '<button class="bopt" data-key="b-' + type + '" data-act="build" data-arg="' + type + '" aria-pressed="' + pressed + '"' + dis(locked || capped) + '>' +
      '<span class="bopt-top"><span class="bopt-name">' + b.name + '</span><span class="bopt-count">' + D.counts[type] + '/' + D.caps[type] + '</span></span>' +
      '<span class="bopt-desc">' + escapeHtml(b.desc) + '</span><span>' + note + '</span></button>';
  }
  h += '</div>';
  if (UI.placing) h += '<button class="btn" data-act="cancel-place">Stop placing</button>';
  return h;
}

function hallCard() {
  const hall = hallBuilding(); if (!hall) return '';
  const up = buildingUpgradeInfo(hall);
  const next = hallCaps(hall.lvl + 1), cur = D.caps;
  const gains = [];
  for (const t of BUILD_ORDER) if (next[t] > cur[t]) gains.push('+' + (next[t] - cur[t]) + ' ' + BUILDINGS[t].short);
  return '<div class="card" data-key="hallcard"><div class="card-head"><span class="card-title">Great Hall</span><span class="card-sub">Level ' + hall.lvl + '</span></div>' +
    '<p class="desc">Next level: squads to Lv ' + maxSquadLevel(hall.lvl + 1) + ', buildings to Lv ' + maxBuildingLevel(hall.lvl + 1) + (gains.length ? ', ' + gains.join(', ') : '') + '.</p>' +
    '<div class="card-row"><button class="btn btn-primary" data-act="hall-up"' + dis(!canAfford(up.cost) || hall.ruined) + '>Upgrade ' + costHtml(up.cost) + '</button>' +
    '<button class="btn btn-small" data-act="select-hall">Details</button></div></div>';
}

function buildingCard(b) {
  const def = BUILDINGS[b.type];
  const up = buildingUpgradeInfo(b);
  const t = tileType(b.x, b.y);
  let stats = '';
  const stat = (k, v) => '<div><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  stats += stat('Health', b.ruined ? 'Ruined' : fmt(b.hp) + ' / ' + fmt(b.maxHp));
  if (b.type === 'hall') {
    stats += stat('Gold', fmtRate(b.out) + '/s');
    stats += stat('Archers', fmtRate(hallArcherDamage(b.lvl) * D.towerMult) + ' dmg');
    const mb = marketBonusAt(b.x, b.y); if (mb) stats += stat('Market', '+' + Math.round(mb * 100) + '%');
  } else if (b.type === 'cottage') {
    stats += stat('Gold', fmtRate(b.out) + '/s');
    const mb = marketBonusAt(b.x, b.y); if (mb) stats += stat('Market', '+' + Math.round(mb * 100) + '%');
    stats += stat('Next level', '+' + fmtRate((cottageGold(b.lvl + 1) - cottageGold(b.lvl)) * (b.out / Math.max(1e-9, cottageGold(b.lvl)))) + '/s');
  } else if (b.type === 'lumber') {
    stats += stat('Timber', fmtRate(b.out) + '/s');
    stats += stat('Trees', String(adjacentTrees(b.x, b.y)));
  } else if (b.type === 'tower') {
    stats += stat('Damage', fmtRate(towerDamage(b.lvl) * D.towerMult));
    stats += stat('Range', (3.5 + (t === T_HIGH ? 1 : 0)) + ' tiles');
  } else if (b.type === 'barracks') {
    stats += stat('Drill', '+' + Math.round((D.drill - 1) * 100) + '% squads');
    stats += stat('Squad slots', '+1');
  } else if (b.type === 'market') {
    stats += stat('Bonus', '+' + Math.round(20 * b.lvl) + '% adjacent');
  }
  let h = '<div class="card raised" data-key="bcard-' + b.id + '"><div class="card-head"><span class="card-title">' + def.name + '</span><span class="card-sub">Level ' + b.lvl + ' · ' + TILE_NAME[t] + '</span></div>' +
    '<p class="desc">' + escapeHtml(def.desc) + '</p><div class="stats">' + stats + '</div><div class="card-row">';
  if (b.type === 'hall') {
    h += '<button class="btn btn-primary" data-act="b-up" data-arg="' + b.id + '"' + dis(!canAfford(up.cost) || b.ruined) + '>Upgrade ' + costHtml(up.cost) + '</button>';
  } else if (!up.can) {
    h += '<button class="btn" disabled>Max level for Hall Lv ' + D.hallL + '</button>';
  } else {
    h += '<button class="btn btn-primary" data-act="b-up" data-arg="' + b.id + '"' + dis(!canAfford(up.cost) || b.ruined) + '>Upgrade ' + costHtml(up.cost) + '</button>';
  }
  if (b.type !== 'hall') {
    if (UI.confirm === 'demolish:' + b.id) {
      const ref = demolishRefund(b);
      h += '<button class="btn btn-danger" data-act="b-demolish" data-arg="' + b.id + '">Confirm, refund ' + costHtml(ref) + '</button>';
    } else h += '<button class="btn btn-small btn-danger" data-act="b-demolish" data-arg="' + b.id + '">Demolish</button>';
  }
  h += '<button class="btn btn-small" data-act="b-close">Close</button></div></div>';
  return h;
}

function squadsTab() {
  let h = '<div class="section-title">Squads <span>' + G.squads.length + ' / ' + D.squadCap + '</span></div>';
  const ri = recruitInfo();
  if (ri.can) h += '<button class="btn btn-primary" data-act="recruit"' + dis(!canAfford(ri.cost)) + '>Recruit a squad ' + costHtml(ri.cost) + '</button>';
  else h += '<p class="note">Build another Barracks to field more squads.</p>';
  for (const sq of G.squads) h += squadCard(sq);
  h += '<p class="note">Click a squad, then click a tile to hold it there. Auto squads guard the beaches where boats will land and chase raiders.</p>';
  return h;
}

function squadCard(sq) {
  const c = CLASSES[sq.cls], tr = TRAITS.find(t => t.id === sq.trait) || TRAITS[0];
  const st = sq.rt, size = squadSize(sq.lvl), n = st ? (st.routedT > 0 ? 0 : st.members.length) : size;
  const [cls, label] = squadStatus(sq);
  const sel = UI.selSq === sq.id;
  let pips = '';
  for (let i = 0; i < size; i++) pips += '<span class="pip' + (i < n ? '' : ' off') + '"></span>';
  let h = '<div class="squad" data-key="sq-' + sq.id + '" data-act="sq-select" data-arg="' + sq.id + '" role="button" tabindex="0" aria-pressed="' + sel + '" aria-label="Select ' + escapeHtml(sq.name) + '\'s squad">' +
    '<div class="squad-head"><span class="swatch" style="background:' + squadColor(sq) + '"></span><div><div class="squad-name">' + escapeHtml(sq.name) + '</div>' +
    '<div class="squad-meta">Lv ' + sq.lvl + ' ' + c.name + ' · <span title="' + escapeHtml(tr.desc) + '">' + tr.name + '</span></div></div>' +
    '<span class="squad-state ' + cls + '">' + label + '</span></div>' +
    '<div class="card-row"><div class="pips" title="' + n + ' of ' + size + ' soldiers">' + pips + '</div><span class="chip">' + (sq.kills || 0) + ' kills</span>' + (c.ability ? '<span class="chip" title="' + escapeHtml(c.abilityDesc) + '">' + c.ability + '</span>' : '') + '</div>';
  if (sq.cls === 'militia') {
    h += '<div class="promote">';
    for (const k of ['sword', 'bow', 'pike']) {
      h += '<button class="btn" data-act="promote" data-arg="' + sq.id + ':' + k + '"' + dis(!canAfford({ gold: PROMOTE_COST })) + ' title="' + escapeHtml(CLASSES[k].abilityDesc) + '">' +
        CLASSES[k].name + '<small>' + CLASSES[k].strength + '</small>' + costHtml({ gold: PROMOTE_COST }) + '</button>';
    }
    h += '</div>';
  }
  h += '<div class="card-row">';
  if (sq.lvl >= D.maxSLvl) h += '<button class="btn" disabled>Max Lv for Hall ' + D.hallL + '</button>';
  else h += '<button class="btn btn-primary" data-act="sq-train" data-arg="' + sq.id + '"' + dis(!canAfford({ gold: squadLevelCost(sq.lvl) })) + ' title="Shift-click to train as many levels as you can afford">Train ' + costHtml({ gold: squadLevelCost(sq.lvl) }) + '</button>';
  if (sq.mode === 'hold') h += '<button class="btn btn-small" data-act="sq-auto" data-arg="' + sq.id + '">Back to auto</button>';
  else h += '<button class="btn btn-small" data-act="sq-station" data-arg="' + sq.id + '">' + (sel ? 'Pick a tile…' : 'Station') + '</button>';
  h += '</div></div>';
  return h;
}

function sagasTab() {
  const gain = renownPreview();
  let h = '<div class="card raised" data-key="sail"><div class="card-head"><span class="card-title">Sail On</span><span class="card-sub">' + fmt(G.renown) + ' Renown</span></div>';
  if (G.bestWave < PRESTIGE_WAVE) {
    h += '<p class="desc">Reach wave ' + PRESTIGE_WAVE + ' on this island to sail for a new one. Best here: wave ' + G.bestWave + '.</p><div class="card-row"><button class="btn" disabled>Sail On</button></div>';
  } else if (UI.confirm === 'sail') {
    h += '<p class="note bad">Your buildings, squads, gold and timber stay behind. Renown and Sagas sail with you.</p>' +
      '<div class="card-row"><button class="btn btn-primary" data-act="sail">Sail for +' + fmt(gain) + ' Renown</button><button class="btn" data-act="cancel-confirm">Stay</button></div>';
  } else {
    const nextAt = (function () { for (let w = G.bestWave + 1; w < G.bestWave + 30; w++) if (renownFor(w) > gain) return w; return null; })();
    h += '<p class="desc">Best wave here: ' + G.bestWave + '. Sailing now earns <b>' + fmt(gain) + ' Renown</b>' + (nextAt ? '; wave ' + nextAt + ' would earn ' + fmt(renownFor(nextAt)) + '.' : '.') + '</p>' +
      '<div class="card-row"><button class="btn btn-primary" data-act="sail">Sail On</button></div>';
  }
  h += '</div><div class="section-title">Sagas <span>Permanent</span></div><div>';
  for (const s of SAGAS) {
    const l = sagaLvl(s.id), maxed = s.max && l >= s.max, c = sagaCost(s, l);
    h += '<div class="saga" data-key="saga-' + s.id + '"><div><span class="saga-name">' + s.name + '</span><span class="saga-lvl">' + (l ? 'Lv ' + l : '') + (s.max ? ' / ' + s.max : '') + '</span></div>' +
      '<div class="saga-desc">' + escapeHtml(s.desc) + '</div>' +
      (maxed ? '<button class="btn" disabled>Complete</button>' : '<button class="btn" data-act="saga" data-arg="' + s.id + '"' + dis(G.renown < c) + '>' + costHtml({ renown: c }) + '</button>') + '</div>';
  }
  h += '</div>';
  return h;
}

function chronicleTab() {
  const s = G.stats;
  const stat = (k, v) => '<div><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  let h = '<div class="card" data-key="stats"><div class="card-head"><span class="card-title">Saga so far</span><span class="card-sub">' + fmtTime(s.playTime) + ' played</span></div><div class="stats">' +
    stat('Raiders slain', fmt(s.kills)) + stat('Drowned', fmt(s.drowned)) + stat('Waves won', fmt(s.wavesWon)) + stat('Hall fallen', fmt(s.wavesLost)) +
    stat('Buildings lost', fmt(s.buildingsLost)) + stat('Islands', fmt(s.islands)) + stat('Gold earned', fmt(s.goldEarned)) + stat('Record wave', String(G.bestEver)) +
    stat('Island', islandTrait(G.island.trait).name) + '</div></div>';
  h += '<div class="section-title">Chronicle</div><ul class="log">';
  if (!G.log.length) h += '<li><span class="w">—</span><span>The settlers come ashore.</span></li>';
  for (const e of G.log.slice(0, 25)) h += '<li><span class="w">W' + e.w + '</span><span>' + escapeHtml(e.text) + '</span></li>';
  h += '</ul>';
  h += '<div class="section-title">Save</div><div class="card" data-key="save">' +
    '<p class="note">The game saves itself in this browser every few seconds. Copy a save string to move it elsewhere.</p>' +
    '<div class="card-row"><button class="btn btn-small" data-act="export">Show save string</button>' + (UI.exportStr ? '<button class="btn btn-small" data-act="copy-export">Copy</button>' : '') + '</div>' +
    (UI.exportStr ? '<textarea id="export-text" readonly>' + escapeHtml(UI.exportStr) + '</textarea>' : '') +
    '<textarea id="import-text" placeholder="Paste a save string here"></textarea>' +
    '<div class="card-row"><button class="btn btn-small" data-act="import">Load save string</button>' +
    (UI.confirm === 'reset' ? '<button class="btn btn-small btn-danger" data-act="reset">Erase everything</button><button class="btn btn-small" data-act="cancel-confirm">Keep playing</button>' : '<button class="btn btn-small btn-danger" data-act="reset">Start over</button>') + '</div>' +
    (UI.importMsg ? '<p class="note' + (UI.importMsg.startsWith('That') ? ' bad' : '') + '">' + escapeHtml(UI.importMsg) + '</p>' : '') + '</div>';
  h += '<div class="section-title">Controls</div><dl class="keys">' +
    '<dt>Click tile</dt><dd>Select a building, or place one in build mode</dd>' +
    '<dt>Click squad</dt><dd>Select it, then click a tile to hold there</dd>' +
    '<dt><kbd>Esc</kbd> / right-click</dt><dd>Cancel</dd><dt><kbd>Space</kbd></dt><dd>Pause</dd><dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd>Game speed</dd></dl>';
  return h;
}

/* ---------- header (every frame) ---------- */
function updateHeader() {
  setText($('gold'), fmt(G.gold));
  setText($('gold-rate'), '+' + fmtRate(D.goldPerSec) + '/s');
  setText($('timber'), fmt(G.timber));
  setText($('timber-rate'), '+' + fmtRate(D.timberPerSec) + '/s');
  setHidden($('renown-res'), !(G.renownTotal > 0 || G.bestWave >= PRESTIGE_WAVE));
  setText($('renown'), fmt(G.renown));
  const tr = islandTrait(G.island.trait);
  setText($('trait-chip'), tr.name + ' isle');
  setAttr($('trait-chip'), 'title', tr.desc);
  setText($('wave'), String(G.wave));
  let status = '';
  if (RT.phase === 'countdown') {
    const hidden = RT.boats.some(b => b.wave === G.wave && RT.timer > b.visibleAt);
    status = hidden ? 'Fog on the water… ' + Math.ceil(RT.timer) + 's' : 'Boats land in ' + Math.ceil(RT.timer) + 's';
  } else if (RT.phase === 'battle') {
    let left = 0;
    for (const u of RT.units) if (u.side === 1 && u.alive) left++;
    for (const b of RT.boats) if (b.wave === G.wave) left += b.cargo.length;
    status = 'Battle · ' + left + ' raider' + (left === 1 ? '' : 's') + ' left';
  } else status = 'The Hall has fallen';
  setText($('wave-status'), status);
  setText($('wave-best'), 'Best ' + G.bestWave + (G.bestEver > G.bestWave ? ' · record ' + G.bestEver : '') + (G.wave % 10 === 0 ? ' · Warlord wave' : ''));
  setHidden($('call-btn'), !(RT.phase === 'countdown' && RT.timer > 2));
  setAttr($('advance-btn'), 'aria-pressed', String(G.autoAdvance));
  setText($('advance-btn'), G.autoAdvance ? 'Advance' : 'Farming');
  for (const n of [1, 2, 3]) setAttr($('spd-' + n), 'aria-pressed', String(!G.paused && G.speed === n));
  setAttr($('pause-btn'), 'aria-pressed', String(G.paused));
  setHidden($('paused-veil'), !G.paused);
  // banner
  const bn = RT.banner;
  setHidden($('banner'), !bn);
  if (bn) {
    setText($('banner-title'), bn.title); setText($('banner-sub'), bn.sub);
    const cls = 'stage-banner ' + bn.kind;
    if ($('banner').className !== cls) $('banner').className = cls;
  }
  // mode line
  let mode = '';
  if (UI.toast && UI.toast.t > performance.now()) mode = UI.toast.text;
  else if (UI.placing) mode = 'Placing ' + BUILDINGS[UI.placing].name + ': click a tile. Esc to stop.';
  else if (UI.selSq) { const sq = squadById(UI.selSq); if (sq) mode = sq.name + "'s squad: click a tile to hold it. Esc to cancel."; }
  setHidden($('mode-line'), !mode);
  setText($('mode-line'), mode);
  const hv = hoverText();
  setHidden($('hover-line'), !hv);
  setText($('hover-line'), hv);
}

function hoverText() {
  const hv = UI.hover;
  if (!hv || !inMap(hv.x, hv.y)) return '';
  const t = tileType(hv.x, hv.y);
  if (t === T_WATER && !UI.placing) return '';
  let s = TILE_NAME[t];
  if (hasTree(hv.x, hv.y)) s += ' · Forest';
  if (isLandingTile(hv.x, hv.y)) s += ' · Boats land here';
  const b = buildingAtTile(hv.x, hv.y);
  if (b) s = BUILDINGS[b.type].name + ' Lv ' + b.lvl + (b.ruined ? ' (ruined)' : '') + ' · ' + s;
  if (UI.placing) {
    const chk = placementCheck(UI.placing, hv.x, hv.y);
    let preview = '';
    if (chk.valid) {
      if (UI.placing === 'lumber') preview = ' · +' + fmtRate(lumberTimber(1, adjacentTrees(hv.x, hv.y)) * (G.island.trait === 'timberland' ? 1.25 : 1)) + ' timber/s';
      if (UI.placing === 'cottage') preview = ' · +' + fmtRate(cottageGold(1) * (1 + marketBonusAt(hv.x, hv.y)) * (1 + 0.2 * sagaLvl('harvest')) * (G.island.trait === 'fertile' ? 1.25 : 1)) + ' gold/s';
      if (UI.placing === 'tower') preview = ' · range ' + (3.5 + (t === T_HIGH ? 1 : 0));
      if (UI.placing === 'market') {
        let n = 0; for (const o of G.buildings) if ((o.type === 'cottage' || o.type === 'hall') && Math.max(Math.abs(o.x - hv.x), Math.abs(o.y - hv.y)) === 1) n++;
        preview = ' · boosts ' + n + ' building' + (n === 1 ? '' : 's');
      }
    }
    s = (chk.ok ? 'Click to build' : chk.reason) + preview + ' · ' + s;
  }
  return s;
}

function toast(text) { UI.toast = { text, t: performance.now() + 2200 }; }

/* ---------- input ---------- */
function cancelModes() {
  UI.placing = null; UI.selSq = null; UI.confirm = null;
}

function canvasPoint(e) {
  const r = R.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onCanvasClick(mx, my) {
  const tile = pickTile(mx, my);
  if (UI.placing) {
    if (!tile) return;
    const res = placeBuilding(UI.placing, tile.x, tile.y);
    if (res.ok) {
      if (UI.placing !== 'palisade' || D.counts.palisade >= D.caps.palisade) UI.placing = null;
      saveGame();
    } else toast(res.reason);
    renderPanel();
    return;
  }
  const sq = pickSquadAt(mx, my);
  if (sq) {
    UI.selSq = UI.selSq === sq.id ? null : sq.id;
    UI.selB = null; UI.tab = 'squads';
    renderPanel();
    return;
  }
  if (UI.selSq && tile && isLandTile(tile.x, tile.y)) {
    const s = squadById(UI.selSq);
    if (s) { orderHold(s, tile.x, tile.y); toast(s.name + "'s squad will hold there."); }
    UI.selSq = null;
    renderPanel();
    return;
  }
  if (tile) {
    const b = buildingAtTile(tile.x, tile.y);
    UI.selB = b ? b.id : null;
    UI.confirm = null;
    if (b) UI.tab = 'build';
  }
  renderPanel();
}

function doAction(act, arg, ev) {
  switch (act) {
    case 'tab': UI.tab = arg; UI.confirm = null; break;
    case 'build': UI.placing = UI.placing === arg ? null : arg; UI.selB = null; UI.selSq = null; break;
    case 'cancel-place': UI.placing = null; break;
    case 'select-hall': { const h = hallBuilding(); UI.selB = h ? h.id : null; break; }
    case 'hall-up': { const h = hallBuilding(); if (h && upgradeBuilding(h)) saveGame(); break; }
    case 'b-up': { const b = buildingById(+arg); if (b) upgradeBuilding(b); break; }
    case 'b-demolish': {
      const b = buildingById(+arg); if (!b) break;
      if (UI.confirm === 'demolish:' + b.id) { demolishBuilding(b); UI.selB = null; UI.confirm = null; saveGame(); }
      else UI.confirm = 'demolish:' + b.id;
      break;
    }
    case 'b-close': UI.selB = null; UI.confirm = null; break;
    case 'recruit': if (recruitSquad()) saveGame(); break;
    case 'sq-select': UI.selSq = UI.selSq === +arg ? null : +arg; UI.placing = null; break;
    case 'sq-station': UI.selSq = +arg; UI.placing = null; break;
    case 'sq-auto': { const s = squadById(+arg); if (s) orderAuto(s); break; }
    case 'sq-train': {
      const s = squadById(+arg); if (!s) break;
      if (ev && ev.shiftKey) { let k = 0; while (k++ < 200 && trainSquad(s)); } else trainSquad(s);
      break;
    }
    case 'promote': { const [id, cls] = arg.split(':'); const s = squadById(+id); if (s && promoteSquad(s, cls)) saveGame(); break; }
    case 'call-now': callNow(); break;
    case 'advance': G.autoAdvance = !G.autoAdvance; break;
    case 'speed': G.speed = +arg; G.paused = false; break;
    case 'pause': G.paused = !G.paused; break;
    case 'saga': if (buySaga(arg)) saveGame(); break;
    case 'sail':
      if (UI.confirm === 'sail') {
        if (sailOn()) { cancelModes(); UI.selB = null; resetRuntime(); setBanner('A new island', islandTrait(G.island.trait).name + ': ' + islandTrait(G.island.trait).desc, 'good'); saveGame(); }
        UI.confirm = null;
      } else UI.confirm = 'sail';
      break;
    case 'cancel-confirm': UI.confirm = null; break;
    case 'export': UI.exportStr = exportSave(); break;
    case 'copy-export': {
      const ta = $('export-text');
      const fallback = () => { if (ta) { ta.focus(); ta.select(); } toast('Select the text and copy it.'); };
      try { navigator.clipboard.writeText(UI.exportStr).then(() => toast('Save string copied.'), fallback); } catch (e) { fallback(); }
      break;
    }
    case 'import': {
      const ta = $('import-text');
      const str = ta ? ta.value : '';
      if (!str.trim()) { UI.importMsg = 'That box is empty. Paste a save string first.'; break; }
      try {
        importSave(str); cancelModes(); UI.selB = null; resetRuntime(); saveGame();
        UI.importMsg = 'Save loaded.'; if (ta) ta.value = '';
      } catch (e) { UI.importMsg = 'That save string could not be read. Paste the full text from "Show save string".'; }
      break;
    }
    case 'reset':
      if (UI.confirm === 'reset') {
        wipeSave(); G = null; newGame(); cancelModes(); UI.selB = null; UI.exportStr = ''; UI.importMsg = '';
        resetRuntime(); saveGame();
      } else UI.confirm = 'reset';
      break;
    case 'close-modal': $('modal').hidden = true; break;
  }
  renderPanel();
  updateHeader();
}

function showModal(title, html) {
  setText($('modal-title'), title);
  $('modal-body').innerHTML = html;
  $('modal').hidden = false;
  $('modal-ok').focus();
}

function initUI() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    e.preventDefault();
    doAction(el.dataset.act, el.dataset.arg, e);
  });
  const cv = R.canvas;
  cv.addEventListener('pointermove', e => { const p = canvasPoint(e); UI.hover = pickTile(p.x, p.y); });
  cv.addEventListener('pointerdown', e => { const p = canvasPoint(e); UI.hover = pickTile(p.x, p.y); });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') UI.hover = null; });
  cv.addEventListener('click', e => { const p = canvasPoint(e); onCanvasClick(p.x, p.y); });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); cancelModes(); UI.selB = null; renderPanel(); });
  document.addEventListener('keydown', e => {
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-act]:not(button)')) {
      e.preventDefault(); doAction(e.target.dataset.act, e.target.dataset.arg, e); return;
    }
    if (e.key === 'Escape') { cancelModes(); UI.selB = null; if (!$('modal').hidden) $('modal').hidden = true; renderPanel(); }
    else if (e.key === ' ') { e.preventDefault(); G.paused = !G.paused; }
    else if (e.key === '1' || e.key === '2' || e.key === '3') { G.speed = +e.key; G.paused = false; }
  });
  renderPanel();
}
