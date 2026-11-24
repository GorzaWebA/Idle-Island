# Idle Island

An idle base-defence game in the browser. Settle a small procedurally generated island,
build it up, and hold it against raiders who arrive by longboat from every side.
Battles play out automatically. You choose what to build, where, how to train your squads,
and when to sail for a new island.

The mechanics are inspired by *Bad North*: raiders land on beaches, burn houses, and are met
by squads of shield, bow and pike that refill in cottages. Here they sit inside an idle loop of
passive income, automatic waves, offline progress and prestige. The full design, with the
reasoning behind each system, is in [GAME_DESIGN.md](GAME_DESIGN.md).

## Play

Open `index.html` in a browser. There's no build step and no dependencies; it runs straight
from disk. Progress saves to the browser's local storage.

To get a single self-contained file, run `node tools/build.js`, which writes `dist/idle-island.html`.

## How it plays

1. **Gold** comes from Cottages and the Great Hall; **timber** from Lumber Camps next to trees.
2. Each wave, longboats appear on the horizon and land on the beaches when the countdown ends.
   Markers at the screen edge show where they are coming from and how many raiders they carry.
3. Your squads move to those beaches on their own, fight, fall back to refill at cottages, and
   come back. Click a squad and then a tile to make it hold a chokepoint or a hill.
4. Spend on more buildings, Hall upgrades, squad training, Watchtowers and Palisades.
5. If the Hall falls, you drop back a wave and farm it until you press **Advance** again.
6. From wave 10, **Sail On** to a fresh island for **Renown**, and spend it on permanent **Sagas**.

Controls: click a building to inspect or upgrade it; pick something in the Build tab and click
a tile to place it; <kbd>Esc</kbd> or right-click cancels; <kbd>Space</kbd> pauses;
<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> set the game speed.

## Code layout

| File | What it does |
| --- | --- |
| `js/util.js` | Seeded RNG, value noise, number formatting |
| `js/data.js` | All game data and balance formulas: buildings, classes, raiders, waves, Sagas |
| `js/island.js` | Procedural island generator (beaches, highland, forest, Hall site) |
| `js/state.js` | Persistent state, derived stats, economy actions, save/load, offline progress |
| `js/sim.js` | Fixed-step battle simulation: boats, flow-field raider pathing, squad AI, combat |
| `js/render.js` | Canvas renderer (3/4 oblique view) |
| `js/ui.js` | Header, tabbed panel, map input |
| `js/main.js` | Boot, main loop, autosave |

The simulation (`util`, `data`, `island`, `state`, `sim`) has no DOM access, so it also runs in Node.

## Tools

```sh
node tools/balance.js 60 3     # a greedy bot plays 3 islands for 60 game-minutes each; prints pacing
node tools/balance.js 45 2 3   # same, with every Saga at level 3
node tools/smoke.js            # loads the game in headless Chromium, plays a bit, saves screenshots
node tools/build.js            # bundles everything into dist/idle-island.html
```

`smoke.js` needs Playwright with Chromium available.
