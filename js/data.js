'use strict';
/* Static game data and balance formulas. Tune numbers here. */

const MAP_W = 22, MAP_H = 16;
const T_WATER = 0, T_SAND = 1, T_GRASS = 2, T_HIGH = 3;
const TILE_NAME = ['Sea', 'Beach', 'Grassland', 'Highland'];

const STEP = 0.05;              // fixed simulation step (20 ticks/s)
const PRESTIGE_WAVE = 10;

const BUILDINGS = {
  hall: {
    name: 'Great Hall', short: 'Hall', hp: 500, unlock: 1,
    desc: 'Heart of the settlement. Produces gold, has archers and refills squads. If it falls, the wave is lost.'
  },
  cottage: {
    name: 'Cottage', short: 'Cottage', hp: 110, unlock: 1,
    cost: { gold: 25, timber: 5 }, growth: 1.55,
    up: { gold: 30, timber: 8 }, upGrowth: 1.75,
    desc: 'Produces gold. Squads refill here. Raiders love to burn them.'
  },
  lumber: {
    name: 'Lumber Camp', short: 'Lumber', hp: 90, unlock: 1,
    cost: { gold: 30, timber: 0 }, growth: 1.9,
    up: { gold: 40, timber: 0 }, upGrowth: 1.75,
    desc: 'Produces timber. Must touch at least one tree; each adjacent tree adds output.'
  },
  barracks: {
    name: 'Barracks', short: 'Barracks', hp: 220, unlock: 1,
    cost: { gold: 80, timber: 40 }, growth: 2.4,
    up: { gold: 70, timber: 25 }, upGrowth: 1.8,
    desc: '+1 squad slot. Refills squads. Each level drills all squads: +3% health and damage.'
  },
  tower: {
    name: 'Watchtower', short: 'Tower', hp: 180, unlock: 2,
    cost: { gold: 150, timber: 60 }, growth: 2.0,
    up: { gold: 90, timber: 30 }, upGrowth: 1.8,
    desc: 'Shoots raiders in range. +1 range on highland.'
  },
  palisade: {
    name: 'Palisade', short: 'Palisade', hp: 160, unlock: 2,
    cost: { gold: 10, timber: 8 }, growth: 1.06,
    up: { gold: 12, timber: 10 }, upGrowth: 1.6,
    desc: 'A wall raiders must break or walk around. Your squads pass freely. Allowed on beaches.'
  },
  market: {
    name: 'Market', short: 'Market', hp: 150, unlock: 3,
    cost: { gold: 300, timber: 150 }, growth: 2.3,
    up: { gold: 150, timber: 60 }, upGrowth: 1.9,
    desc: '+20% gold per level to every adjacent Cottage and the Hall.'
  }
};
const BUILD_ORDER = ['cottage', 'lumber', 'barracks', 'tower', 'palisade', 'market'];

function hallCaps(L) {
  return {
    cottage: 1 + 2 * L,
    lumber: 1 + Math.floor(L / 2),
    barracks: Math.ceil(L / 2),
    tower: Math.max(0, L - 1),
    palisade: Math.max(0, 6 * (L - 1)),
    market: Math.max(0, Math.floor((L - 1) / 2))
  };
}
function maxBuildingLevel(hallL) { return 2 * hallL + 1; }
function maxSquadLevel(hallL) { return 5 * hallL; }
function hallUpgradeCost(L) {
  return { gold: Math.round(120 * Math.pow(3.2, L - 1)), timber: Math.round(50 * Math.pow(2.7, L - 1)) };
}
function buildCost(type, count) {
  const b = BUILDINGS[type], m = Math.pow(b.growth, count);
  return { gold: Math.round(b.cost.gold * m), timber: Math.round(b.cost.timber * m) };
}
function upgradeCost(type, lvl) {
  const b = BUILDINGS[type], m = Math.pow(b.upGrowth, lvl - 1);
  return { gold: Math.round(b.up.gold * m), timber: Math.round(b.up.timber * m) };
}

/* Production formulas */
function cottageGold(lvl) { return 0.7 * lvl * Math.pow(1.08, lvl - 1); }
function hallGold(L) { return 1.0 * L * Math.pow(1.1, L - 1); }
function lumberTimber(lvl, trees) { return (0.25 + 0.12 * trees) * lvl * Math.pow(1.06, lvl - 1); }
function towerDamage(lvl) { return 6 * Math.pow(1.2, lvl - 1); }
function hallArcherDamage(L) { return 3 * Math.pow(1.3, L - 1); }

/* Squads */
const CLASSES = {
  militia: { name: 'Militia', hp: 20, dmg: 3, cd: 1.0, range: 0.45, speed: 1.6, arrowTaken: 1, ranged: false, color: '#8fa3b0' },
  sword: { name: 'Shieldbearers', hp: 36, dmg: 5, cd: 0.9, range: 0.45, speed: 1.6, arrowTaken: 0.4, ranged: false, color: '#4f8fd0',
    ability: 'Shield Bash', abilityDesc: 'Every 8 s: heavy hit and knockback on adjacent raiders.', strength: 'Arrow-proof, sturdy', weakness: 'Average damage' },
  bow: { name: 'Bowmen', hp: 18, dmg: 4.2, cd: 1.3, range: 3.5, speed: 1.6, arrowTaken: 1, ranged: true, color: '#5fae6a',
    ability: 'Volley', abilityDesc: 'Every 10 s: arrow storm on the densest raider group.', strength: 'Ranged, loves high ground', weakness: 'Fragile in melee' },
  pike: { name: 'Pikemen', hp: 28, dmg: 7, cd: 1.4, range: 0.95, speed: 1.3, arrowTaken: 1.25, ranged: false, color: '#c9a04a',
    ability: 'Brace', abilityDesc: 'First strike on each new foe deals double. Double damage vs Brutes, Berserkers and Warlords.', strength: 'Reach, anti-brute', weakness: 'Weak to arrows, slow' }
};
const PROMOTE_COST = 50;
function squadSize(lvl) { return Math.min(9, 5 + Math.floor((lvl - 1) / 5)); }
function squadLevelCost(lvl) { return Math.round(20 * Math.pow(1.24, lvl - 1)); }
function squadLevelMult(lvl) { return Math.pow(1.10, lvl - 1); }
function recruitCost(owned) { return Math.round(60 * Math.pow(2.6, owned - 1)); }

const TRAITS = [
  { id: 'stalwart', name: 'Stalwart', desc: '+15% health', hp: 1.15 },
  { id: 'fierce', name: 'Fierce', desc: '+15% damage', dmg: 1.15 },
  { id: 'swift', name: 'Swift', desc: '+25% speed', speed: 1.25 },
  { id: 'keen', name: 'Keen-eyed', desc: '+15% range', range: 1.15 },
  { id: 'hardy', name: 'Hardy', desc: 'Refills 40% faster', refill: 1.4 },
  { id: 'lucky', name: 'Lucky', desc: '+20% bounty on its kills', bounty: 1.2 }
];
const NAMES = ['Astrid', 'Bjorn', 'Sigrid', 'Eirik', 'Hilda', 'Ivar', 'Ragna', 'Torvald', 'Ylva', 'Halvar',
  'Solveig', 'Gunnar', 'Freya', 'Leif', 'Inga', 'Ulf', 'Runa', 'Ketil', 'Thyra', 'Arne', 'Brynja', 'Dag',
  'Embla', 'Frode', 'Gyda', 'Hakon', 'Idun', 'Jorund', 'Katla', 'Orm', 'Ragnhild', 'Sten', 'Tove', 'Vigdis',
  'Yngvar', 'Alva', 'Birger', 'Dagny', 'Eyvind', 'Helka'];

/* Raiders */
const ENEMIES = {
  raider: { name: 'Raider', hp: 18, dmg: 3, cd: 1.1, range: 0.45, speed: 1.35, pts: 1, bounty: 2, from: 1, r: 0.16 },
  archer: { name: 'Skirmisher', hp: 12, dmg: 2.6, cd: 1.6, range: 3.0, speed: 1.35, pts: 1.2, bounty: 2, from: 3, ranged: true, r: 0.15 },
  shield: { name: 'Shieldman', hp: 26, dmg: 3, cd: 1.2, range: 0.45, speed: 1.15, pts: 1.6, bounty: 3, from: 6, arrowTaken: 0.35, r: 0.17 },
  brute: { name: 'Brute', hp: 95, dmg: 10, cd: 2.0, range: 0.6, speed: 0.95, pts: 4, bounty: 9, from: 9, knock: true, big: true, r: 0.26 },
  berserker: { name: 'Berserker', hp: 22, dmg: 6, cd: 0.7, range: 0.45, speed: 2.3, pts: 1.5, bounty: 3, from: 13, charger: true, r: 0.16 },
  warlord: { name: 'Warlord', hp: 420, dmg: 14, cd: 1.5, range: 0.6, speed: 1.05, pts: 0, bounty: 60, from: 10, big: true, boss: true, r: 0.3 }
};
const ENEMY_TYPES = ['raider', 'archer', 'shield', 'brute', 'berserker'];
const ENEMY_WEIGHT = { raider: 5, archer: 3, shield: 2.5, brute: 1.2, berserker: 2 };

function waveBudget(n) { return 5 + 2.2 * n + 0.05 * n * n; }
function enemyHpMult(n) { return Math.pow(1.15, n - 1); }
function enemyDmgMult(n) { return Math.pow(1.09, n - 1); }
function bountyMult(n) { return Math.pow(1.1, n - 1); }
function waveBonusGold(n) { return 12 * Math.pow(1.12, n - 1) * (n % 10 === 0 ? 4 : 1); }
function waveBonusTimber(n) { return 4 * Math.pow(1.1, n - 1) * (n % 10 === 0 ? 4 : 1); }
function waveDirections(n) { return Math.min(5, 1 + Math.floor(n / 4)); }
function countdownTime(n) { return n <= 1 ? 30 : 20; }
const BOAT_CAPACITY = 7;

/* Prestige */
function renownFor(best) { return best < PRESTIGE_WAVE ? 0 : Math.floor(Math.pow(best - 5, 1.35)); }

const SAGAS = [
  { id: 'harvest', name: 'Golden Harvest', desc: '+20% gold production', base: 3, growth: 1.6 },
  { id: 'steel', name: 'Sharpened Steel', desc: '+12% squad damage', base: 3, growth: 1.6 },
  { id: 'mail', name: 'Tempered Mail', desc: '+12% squad health', base: 3, growth: 1.6 },
  { id: 'timbers', name: 'Stout Timbers', desc: '+25% building health, +10% tower damage', base: 2, growth: 1.5 },
  { id: 'bounty', name: 'Bounty Hunters', desc: '+20% bounties and wave bonus', base: 4, growth: 1.7 },
  { id: 'chest', name: "Settler's Chest", desc: 'Start islands with more gold and timber', base: 2, growth: 1.8, max: 10 },
  { id: 'veterans', name: 'Old Veterans', desc: 'New squads start 2 levels higher', base: 6, growth: 2.0, max: 8 },
  { id: 'horn', name: 'War Horn', desc: 'Start islands 3 waves further on', base: 10, growth: 2.2, max: 5 },
  { id: 'tides', name: 'Tide Readers', desc: '+2 h offline cap, +10% offline efficiency', base: 5, growth: 2.0, max: 5 }
];
function sagaCost(s, lvl) { return Math.round(s.base * Math.pow(s.growth, lvl)); }
function chestGold(l) { return l > 0 ? Math.round(150 * Math.pow(2.2, l - 1)) : 0; }
function chestTimber(l) { return l > 0 ? Math.round(60 * Math.pow(2.0, l - 1)) : 0; }

const ISLAND_TRAITS = [
  { id: 'fertile', name: 'Fertile', desc: '+25% gold production' },
  { id: 'timberland', name: 'Timberland', desc: 'Dense forest, +25% timber' },
  { id: 'highlands', name: 'Highlands', desc: 'More high ground' },
  { id: 'shores', name: 'Many Shores', desc: 'More beaches, +15% bounty' },
  { id: 'rocky', name: 'Rocky Coast', desc: 'Fewer beaches' },
  { id: 'fog', name: 'Fogbound', desc: 'Boats appear late, +25% bounty' }
];
function islandTrait(id) { return ISLAND_TRAITS.find(t => t.id === id) || ISLAND_TRAITS[0]; }
