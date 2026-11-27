# Idle Island: Game Design

An idle base-defence game. You settle a small, procedurally generated island
and build it up while raiders keep arriving by longboat from every side.
Combat runs on its own. You decide what to build, where to build it, how to
train your squads, and when to leave for a new island.

The design borrows these mechanics from Bad North and adapts them for an idle game:

| Bad North mechanic | How Idle Island adapts it |
| --- | --- |
| Small procedural islands with beaches, cliffs and high ground | Seeded island generator with sand beaches, grass, highland and forest |
| Raiders arrive by longboat and you can see them coming | Boats sail in from the horizon during each wave's countdown, with edge markers showing direction and size |
| Boats land only on beaches | Raiders disembark only on beach tiles; cliffs are safe coastline |
| Houses burn; saved houses pay out | Raiders torch buildings. Ruined buildings stop producing, and burning cottages lose you some gold |
| Squads made of a commander plus soldiers | Each squad has a named commander with a trait, and 5 to 9 soldiers |
| Militia promoted to Infantry, Archers or Pikemen | Militia can be promoted to Shieldbearers, Bowmen or Pikemen, each with its own strengths |
| Squads refill their numbers inside houses | Squads walk to a Cottage, Barracks or the Hall to recruit replacements |
| Archers gain from high ground; units can be pushed into the sea | Bowmen and towers on highland get extra range. Knockback onto water drowns the unit |
| Island-to-island campaign with permanent upgrades | Sail On (prestige) moves you to a new island and earns Renown for permanent Sagas |

Idle-genre features on top: passive income, automatic waves, auto-positioning squads,
offline progress, exponential costs and scaling, a farm/advance toggle, and a prestige loop.

---

## 1. Core loop

```
 earn gold & timber ──► build / upgrade / train ──► survive bigger waves
        ▲                                                   │
        │                                                   ▼
  Sagas (permanent) ◄── Renown ◄── Sail On (prestige) ◄── hit a wall
```

1. Cottages and the Hall produce **gold**; Lumber Camps produce **timber**.
2. Killing raiders pays a **bounty**, and clearing a wave pays a **wave bonus**.
3. You spend resources on buildings, squads and upgrades.
4. Waves keep getting harder. Eventually your defences can't hold.
5. Once you have reached **wave 10**, you can **Sail On**: the island resets and
   you earn **Renown** based on the best wave you reached there. Renown buys
   **Sagas**, which are permanent upgrades, so the next island goes faster and further.

## 2. The island

* Grid of 22 × 16 tiles. A seed fully determines the island, so saves only store the seed.
* Tile types:
  * **Water**: impassable. A unit pushed onto water drowns.
  * **Sand (beach)**: walkable. Boats can only land on beach tiles next to open water.
    Palisades are the only building allowed on sand, and not on landing tiles.
  * **Grass**: walkable and buildable. Some grass tiles carry **trees**,
    which can't be built on but feed Lumber Camps.
  * **Highland**: walkable but slow to climb. Buildable. Bowmen and Watchtowers
    standing on highland get +1 range.
* Generation steps: radial falloff plus fractal noise, keep only the largest landmass,
  fill lakes, put highland at the top noise percentile, grow 4 to 7 beaches around the coast,
  scatter forest clusters, and place the Great Hall at the most inland tile.
* Each island gets one **trait**:
  * Fertile: +25% gold
  * Timberland: more forest, +25% timber
  * Highlands: more high ground
  * Many Shores: more beaches, +15% bounty
  * Rocky Coast: fewer beaches
  * Fogbound: boats appear late, +25% bounty

## 3. Resources

| Resource | Source | Spent on |
| --- | --- | --- |
| Gold | Hall, Cottages (boosted by Markets), bounties, wave bonus, calling waves early | Everything |
| Timber | Lumber Camps (scale with adjacent trees), wave bonus | Buildings and Hall upgrades |
| Renown | Sailing On (prestige) | Sagas (permanent) |

## 4. Buildings

Every building has HP. Raiders attack buildings, and at 0 HP a building becomes a
**ruin**. Ruins produce nothing and don't refill squads. Once a wave ends, ruins
rebuild for free after a few seconds. When a cottage falls, the raiders also
**plunder** 3% of your gold.

| Building | Unlock (Hall level) | Role |
| --- | --- | --- |
| **Great Hall** | start | Produces gold, has a few archers, refills squads. **If it falls, the wave is lost.** Its level sets building caps and max levels |
| **Cottage** | 1 | Main gold producer. Squads refill here. Raiders target it |
| **Lumber Camp** | 1 | Timber: 0.25/s plus 0.12/s for each adjacent tree. Needs at least one adjacent tree |
| **Barracks** | 1 | +1 squad slot each. Refills squads. Every barracks level adds +3% health and damage to all squads |
| **Watchtower** | 2 | Shoots raiders automatically. +1 range on highland |
| **Palisade** | 2 | Wall that raiders must break through or walk around. Your squads pass through it freely. Cheap, so you can build many |
| **Market** | 3 | +20% per level to the gold of each adjacent Cottage and the Hall |

* Each extra copy of a building costs more (cost × growth^count).
* Building max level = 2 × Hall level + 1. Upgrades raise output and HP.
* Hall level caps: Cottages 1 + 2L, Lumber 1 + ⌊L/2⌋, Barracks ⌈L/2⌉, Towers L − 1,
  Palisades 6(L − 1), Markets ⌊(L − 1)/2⌋.
* Demolishing a building refunds 50% of its build cost.
* Placement matters: Lumber Camps want forest, Markets want to be surrounded by
  cottages, Towers want highland near the beaches, and Palisades should funnel the beaches.

## 5. Squads

* A squad is one commander plus soldiers: 5 at level 1, then +1 every 5 levels, up to 9.
* Each commander gets a generated name and a **trait**: Stalwart +15% HP, Fierce +15% damage,
  Swift +25% speed, Keen-eyed +15% range, Hardy refills 40% faster, Lucky +20% bounty on its kills.
* Squad count is capped at 1 + number of Barracks. Each new squad costs more.

| Class | Promote cost | Strengths | Weaknesses | Ability (automatic) |
| --- | --- | --- | --- | --- |
| Militia | (start) | cheap | weak at everything | none |
| **Shieldbearers** | 50 g | sturdy, take only 40% damage from arrows | average damage | **Shield Bash**: every 8 s, deals a heavy hit to adjacent raiders and knocks them back (possibly into the sea) |
| **Bowmen** | 50 g | ranged (3.5 tiles, +1 on highland) | fragile in melee | **Volley**: every 10 s, an arrow storm on the densest group of raiders |
| **Pikemen** | 50 g | long reach, double damage vs Brutes, Berserkers and Warlords, can't be knocked back | take 125% damage from arrows, slow | **Brace**: first strike on each new enemy deals double damage |

* Training (levelling) costs gold (×1.24 per level). Each level gives ×1.10 HP and ×1.10 damage.
  Max level = 5 × Hall level.
* **Refilling**: a squad below full strength walks to the nearest intact Cottage, Barracks
  or Hall and gains one soldier every 2.5 s while no raiders are close.
* **Retreat**: auto squads at ≤ 34% strength with enemies nearby fall back to refill.
* **Rout**: if every soldier dies, the squad is out for 15 s, then comes back at full
  strength at the Hall. Commanders are never lost permanently, which keeps it idle-friendly.

### Squad control
* **Auto** (default): while boats approach, squads move to the beaches where they'll land
  (Bowmen hang back 2 tiles inland). Once raiders are ashore, squads go after the most
  dangerous group: the one closest to your buildings. Between waves, squads refill and return home.
* **Hold**: select a squad and click any tile. It holds that spot, fights anything within
  reach, and slowly refills in place. Use **Auto** to release it.

## 6. Raiders

| Raider | From wave | Notes |
| --- | --- | --- |
| Raider | 1 | Basic melee |
| Skirmisher | 3 | Archer with 3 tiles of range. Shoots squads, then torches buildings |
| Shieldman | 6 | Takes only 35% damage from arrows |
| Brute | 9 | Big and slow. Hits knock defenders back, sometimes into the sea |
| Berserker | 13 | Very fast, high damage, low HP |
| Warlord | every 10th wave | Boss. Huge HP. Gives +25% damage to nearby raiders. Pays out big |

* Raiders path with a **flow field**, Dijkstra from every intact building, so they head for
  the nearest one. Highland, forest and palisades cost extra, so raiders prefer open ground
  and avoid walls when they can. When no path goes around, they break through.
* Melee raiders fight any squad within 1.6 tiles. Brutes ignore squads unless they block the way.
* Raiders deal double damage to buildings because they carry torches.

### Waves
* Budget for wave n: `5 + 2.2n + 0.05n²` points. Raider 1, Skirmisher 1.2, Shieldman 1.6,
  Berserker 1.5, Brute 4. The budget is spent on a random mix of unlocked types.
* Raider HP scales ×1.15 per wave and damage ×1.09 per wave. Bounties grow ×1.10 per wave.
* Up to 7 raiders per boat. Boats come from 1 + ⌊n/4⌋ different beaches (max 5).
* A **countdown** runs between waves (about 20 s). Boats appear at the horizon and sail in so
  they land when it reaches zero. Markers at the screen edge show where each boat is
  coming from and how many raiders it carries.
* **Call now** skips the rest of the countdown: the boats rush in and you get a gold bonus
  for the time you saved.
* **Victory** (all raiders dead): you get the wave bonus in gold and timber, and the next
  wave starts if **Advance** is on.
* **Defeat** (the Hall falls): the raiders sail off, you lose 10% of your gold, you drop back one wave,
  and **Advance** turns off, so you farm that wave until you choose to push again. This is the idle-genre
  "fail the boss, farm the stage below" rule.

## 7. Prestige: Sail On

* Available once you have reached wave 10 on the current island.
* Renown gained = ⌊(best wave − 5)^1.35⌋. Wave 10 gives 8, wave 20 gives 38, wave 30 gives 77.
* Sailing on resets gold, timber, buildings, squads and the wave number. You get a new island
  with a new trait. Renown, Sagas and stats carry over.

| Saga | Effect per level |
| --- | --- |
| Golden Harvest | +20% gold production |
| Sharpened Steel | +12% squad damage |
| Tempered Mail | +12% squad health |
| Stout Timbers | +25% building HP, +10% tower damage |
| Bounty Hunters | +20% bounties and wave bonus |
| Settler's Chest | Start each island with extra gold and timber |
| Old Veterans | New squads start 2 levels higher |
| War Horn | Start islands 3 waves further on (max 5) |
| Tide Readers | +2 h offline cap and +10% offline efficiency (max 5) |

## 8. Idle systems

* **Fixed-step simulation** at 20 ticks/s, with speed control (1×/2×/3×) and pause.
* **Autosave** every 15 s and when the tab hides. Saves are small because the island
  comes from its seed and battles are not saved.
* **Offline progress**: on return, elapsed time (capped at 8 h, more with Tide Readers) pays
  gold and timber at 50% efficiency, plus the estimated bounties of farming the last
  cleared wave. The wave number never advances while you're away. A "While you were away"
  summary shows what you earned. A hidden tab works the same way.
* **Hints**: a single next-step line guides new players through the first steps.
* **Export/import** save string and a two-step hard reset.

## 9. Controls

* **Build tab**: pick a building, then click a valid tile. Hover shows a preview of yield or range.
  Palisade mode stays active for chain-building. Esc, right-click or the on-screen **Cancel** stops.
* Click a building to select it, then upgrade or demolish it.
* Click a squad (on the map or its card) to select it, then click a tile to make it hold there.
* Zoom with the mouse wheel, a pinch or the **+ −** buttons; drag to pan while zoomed in.
* Keys: Space pauses, Esc cancels, 1–3 set game speed, F3 shows frame rate and draw calls.
* The **⚙ Settings** tab holds per-device preferences (section 10, *Settings and quality*).

### Touch screens

Phones and tablets get the same game with these adjustments:

* **Two-tap building.** The first tap previews the tile (outline, yield or range, or why it can't be
  built there); a second tap on the same tile builds. A misplaced building costs real gold, so a single
  tap must never spend it.
* **Taps come from pointer events**, not the browser's `click`, so they behave the same everywhere. The
  browser's follow-up click is cancelled on the map, so a tap near a button can't press it by accident.
* **Upright phones**: the map is pinned at the top and only the panel scrolls, so you can watch the
  battle while you spend. The mode bar sits in a strip under the map, so it never covers a tile.
* **Sideways phones**: map and panel sit side by side.
* Touch targets are at least 36px, and the squad card spells out trait and ability effects, since
  touch screens have no hover tooltips.
* `node tools/mobile.js` checks all of this on emulated phones and a tablet.

## 10. 3D rendering

The game is drawn as a small low-poly diorama with Three.js (r159, vendored). The simulation is
unchanged and still runs headless; the renderer only reads it.

### Architecture

| File | Role |
| --- | --- |
| `js/render3d.js` | Scene, lights, shadows, resize, theme, and the `VIEW` interface below |
| `js/r3d/builder.js` | `MeshBuilder`: boxes, prisms, cylinders, polygons with flat normals and vertex colours. Faces orient from an outward vector |
| `js/r3d/terrain.js` | Tile grid to stepped terrain: grass 0.36, highland 0.92, beaches sloping from 0.16 to −0.06, rocky cliff walls down to the seabed, baked shade at cliff feet, instanced pines |
| `js/r3d/sea.js` | One shader for the sea: vertex waves near the island, ripple normals, depth colour and surf from a baked shoreline texture (distance to land, distance to a beach, depth over the sand), sun glints, fog. A flat outer ring carries it to the horizon |
| `js/r3d/camera.js` | Orbit rig with easing and clamps (pitch 24°–78°, zoom limits from the island's fit, target inside the island) |
| `js/r3d/picking.js` | Screen point to sim tile: ray against one box per tile column (seabed up to the surface or building top) |
| `js/r3d/models.js` | Procedural building models: seven types × three tiers, a ruin per type, palisades by neighbour mask, and attachment points for smoke, flags and saws |
| `js/r3d/buildings.js` | Draws buildings as one `InstancedMesh` per model variant; construction, tier-up, hit flash, collapse, chimney smoke, flags, saws, fire and damage, lit windows at dusk |
| `js/r3d/props.js` | Pines and round trees that sway in a shared wind, rocks and sea stacks, grass tufts, flowers, heather, moss and driftwood, mixed per island trait (one instanced draw call per kind) |
| `js/r3d/fx.js` | Camera-facing sprite particles on one small shader (typed arrays, no per-frame allocation): smoke, dust, flames, spray, additive sparks, flat foam and mist, immediate-mode glows, and rings and ripples |
| `js/r3d/unitmodels.js` | Figures (a body per kind, arms, legs, weapons, shields, banner), the longboat and its oars, arrows, blob shadows, rings |
| `js/r3d/units.js` | Animated figures and longboats, interpolated between sim steps |
| `js/r3d/missiles.js` | Arrows along the sim's arcs with streaks, fire arrows, volleys, and reactions to sim effects (hits, bashes, splashes) |
| `js/r3d/ui3d.js` | In-world UI: tile highlight, placement ghost with its yield label and the tiles a market or lumber camp would use, range rings draped over the terrain, the selected building's outline and ground ring, rings under a selected squad, its route to a hovered tile, hold flags, and rings where longboats will land |
| `js/r3d/hud.js` | Screen-space UI: boat badges (clamped to the edge with an arrow when off screen), the selection info chip, health bars (one instanced draw call, fixed pixel size), gold and damage numbers, the performance overlay |
| `js/settings.js` | Per-device preferences (graphics, motion, theme, overlays, sound), stored apart from the game save |
| `js/audio.js` | Procedural WebAudio: surf, horn, clinks, arrows, fire, splashes, building, clicks |
| `js/theme3d.js` | All colours. Light (noon) and dark (dusk) variants change only sky, sun, sea and smoke tint, so a theme switch never rebuilds geometry. Island traits add palette overrides and a Fogbound sky |

World units: 1 tile = 1 unit, X = tile x, Z = tile y, Y up, sea level at 0. Tile footprints are
exactly the sim's, so building, inspecting and holding work unchanged.

### Buildings

Each building's level picks one of three tiers (the Hall changes at levels 3 and 5, everything else
at 3 and 6):

| Building | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Great Hall | Timber longhouse, flag | Stone footing, back annex | Stone base, raised second roof, two flags |
| Cottage | Thatched hut | Timber-framed house with chimney | Two storeys, stone ground floor |
| Lumber Camp | Lean-to and log pile | Shed, bigger pile, sawhorse with a working saw | Sawmill with plank stacks and saw frame |
| Barracks | Stone hut, spear rack | Long barracks, shields, training dummy | Crenellated fort with a turret and flag |
| Watchtower | Timber lookout with ladder | Stone base, timber top | Round stone tower, cone roof, flag |
| Market | One stall | Two stalls, barrels, sacks | Covered market hall with pennants |
| Palisade | Sharpened stakes | Plus a crossbeam | On a stone footing |

* **Palisades join up**: each one draws arms towards palisade neighbours (north, east, south, west),
  so straight runs, corners and junctions all connect. A lone palisade stands east to west.
* **Draw calls**: every variant (type, tier, palisade shape, ruin) is one `InstancedMesh`. A full
  settlement is about 15 to 25 draw calls, shadows included.
* **Animation** comes from the renderer's own per-building state:
  * A new or rebuilt building rises with a small overshoot (0.7 s) in a ring of dust.
  * A building pops slightly when it reaches a new tier.
  * Buildings flash when hit, and collapse to their ruin in a burst of flame, sparks and ash.
  * Chimneys smoke, flags wave and the lumber saw works.
* **Fire** follows damage. A building blackens as it loses health. Past 30 % damage it catches fire,
  burning harder the lower its health: flames on the roof, embers, a dark smoke column drifting with
  the wind, and firelight on the ground. A fresh ruin burns fiercely for about 12 seconds, dies down
  to a smoulder with a faint glow, and clears to thin wisps once rebuilding starts. Repairs at the
  end of a wave put fires out.
* **Dusk**: in the dark theme, doors and windows that face the camera glow and flicker.
* **Placement ghost**: a translucent copy of the building, green when it can be built, amber when
  you can't afford it and red when it can't go there. It carries a label with the yield or the
  reason, and watchtowers show their range ring.
* Small buildings get a random quarter turn per tile (stable for a given island). The Hall,
  towers and palisades stay square to the map.

### Units and combat

* **Figures** are split into parts so instancing can animate them: a body (torso, head and
  headgear, one variant per kind), two arms, two legs and up to two held items. Each part type is
  one `InstancedMesh`, so 40 fighters cost about a dozen draw calls. Arms and legs take their
  colour per instance (sleeves and trousers).

  | Kind | Look | Held |
  | --- | --- | --- |
  | Militia | Grey tunic, felt cap | Club |
  | Shieldbearers | Blue tunic, round steel helmet | Sword, blue round shield |
  | Bowmen | Green tunic and hood, quiver | Bow |
  | Pikemen | Gold tunic, brimmed kettle helmet | Long pike, levelled |
  | Raider | Red tunic, fur collar, conical helmet, beard | Axe |
  | Skirmisher | Brown hood, quiver of fire arrows | Bow |
  | Shieldman | Mail, helmet with nasal | Axe, wooden round shield |
  | Brute | 1.6× size, fur cape, long beard | Great axe |
  | Berserker | Bare chest with war paint, red hair, lean | An axe in each hand |
  | Warlord | 1.9× size, dark armour, red cape, horned helmet with a gold crown | Great axe |

* **Commanders** (slot 0) carry a banner in their squad's colour. Every figure has a soft blob
  shadow, which reads better than shadow-mapping figures this small and costs one draw call.
* **Animation** is procedural:
  * Strides are tied to distance walked, so feet don't slide.
  * Each stance has its own attack: an overhead melee swing, a shield held up, a pike thrust,
    and a bow drawn and loosed.
  * Hits make a figure lean back and flash. Knockback throws it back with a hop and arms flung up.
  * Raiders leap from their longboat to the beach, and new soldiers pop in.
  * The slain fall backwards and sink into the ground. The drowned sink with a splash ring.
    Fleeing raiders shrink away.
* **Longboats** have plank strakes, curled prow and stern, shields along both sides, a striped
  sail (dark with gold for the Warlord's boat) and eight oars. The boats:
  * row and leave a wake
  * bob and roll
  * raise their oars while the crew climbs out
  * swing round to leave
* **Missiles** fly the sim's own arcs and are extrapolated within a step, so they glide. Arrows
  point along their flight with a faint streak. Fire arrows glow and drop sparks, and volleys
  rain onto their area.
* **Effects**: sparks on melee hits and on raiders hacking at buildings, shockwave rings on shield
  bashes, dust and a ring where a volley lands, a heat ring when a building falls, a green ring when
  a squad refills. Arrows that land kick up dust, splash into the sea, or burst into sparks if they
  were burning.
* **Water**: longboats leave foam at the stern, spreading ripples and spray off the bow, and throw
  up spray when they run aground. The drowned go under with a crown of droplets, two ripples and a
  patch of foam, and anyone wading ashore leaves rings.
* **Feedback**: gold numbers rise from kills as pooled screen labels. Warlord blows shake the
  camera, and when the Warlord's longboat first appears the camera leans part of the way towards it
  (unless the player is moving the camera or moved it in the last two seconds). Neither happens when
  the system asks for reduced motion.

### Effects, light and islands

* **Particles** are camera-facing quads drawn by one shader in a few pools: smoke and dust (normal
  blending, lit from above, dimmed at dusk), flames (an upright flame shape that is never dimmed),
  additive sparks and embers, and flat foam and mist lying on the water. The soft shapes are drawn
  in code into one 64×64 texture at startup. Each particle has its own colour fading to an end
  colour, opacity, size, spin and gravity. Pools recycle the oldest slot when full, so effects can
  never grow without bound. A `density` setting (Phase 5) thins them out.
* **Glows** are immediate-mode sprites redrawn each frame: firelight lying on the ground, and
  camera-facing lights for windows, fires and fire arrows. They lean towards the camera so a
  window's own wall doesn't cut them.
* **Surf**: the sea's shoreline texture also knows where beaches are and how deep the water stands
  over the sand. Beaches get a wide swash that washes up and back with breaking lines rolling in;
  cliffs get a thin line of foam. Because depth over the sand is part of the measure, foam follows
  the real waterline rather than the tile squares.
* **Sun**: the sun swings slowly back and forth (about ±18° over twelve minutes), so shadows move
  over a long session.
* **Island traits** change the look, never the rules:

  | Trait | Look |
  | --- | --- |
  | Fertile | Brighter, lusher grass, more tufts and about two and a half times the flowers |
  | Timberland | Deeper green ground, denser woods, mossy mounds on the forest floor |
  | Highlands | Olive heights covered in purple heather and boulders |
  | Many Shores | Driftwood washed up on the beaches |
  | Rocky Coast | More and bigger sea stacks, boulders on the beaches |
  | Fogbound | A grey sky, fog that closes in around the camera (zooming in clears it a little) and banks of mist drifting over the water |

### Interface in 3D

* **Incoming longboats** carry a badge with their raider count (dark and gold for the Warlord).
  A boat out of view keeps its badge at the edge of the map with an arrow pointing to it, clear of
  the zoom buttons. A pulsing red ring marks the beach where each boat will come ashore.
* **Selecting a building** draws a gold outline around the model (the model again, slightly
  larger, back faces only), a ring on the ground, its range for towers and the Hall, and a chip
  with its name, level and health or rebuild state.
* **Selecting a squad** rings each member in the squad's colour, shows a ranged squad's reach, and
  puts a chip over it with name, class, strength and what it is doing. Hovering a tile then shows
  the route it would take (the sim's own path search, drawn as marching dashes over the ground and
  on top of everything) and a flag where it would stand. While it walks, the rest of its route
  stays visible.
* **Hold flags**: every squad holding a tile has a pennant in its colour planted there.
* **Health bars** are constant-size quads over hurt raiders, big raiders, damaged buildings,
  commanders of squads under strength, and ruins being rebuilt. All of them are one draw call.
* **Damage numbers** (off by default) come from the renderer watching each unit's health drop.
  They never touch the sim's own floaters.
* **The settlers' own longboat** is moored at the dock, oars shipped.

### Settings and quality

Settings live under their own localStorage key (`idle-island-settings-v1`), so the save format
is unchanged and a save string moved to another device doesn't bring its graphics with it. Missing
or unknown values fall back to defaults.

| Setting | Choices (default first) |
| --- | --- |
| Quality | Auto, Low, Medium, High |
| Shadows, Sharpness (pixel ratio cap), Effects (particle density) | Auto (follow quality), or a fixed choice that overrides it |
| Theme | System, Day, Dusk |
| Motion | System, Reduced, Full. Reduced turns off camera shake and the Warlord nudge |
| Turn when idle | Off, On (slow orbit after 20 s without input) |
| Health bars, Damage numbers, Performance overlay | On, Off, Off |
| Sound, Volume | Off, 60 % |

| Quality | Pixel ratio cap | Shadows | Effects | Grass tufts and flowers |
| --- | --- | --- | --- | --- |
| Low | 1 | Off | 45 % | Hidden |
| Medium | 1.5 (phones 1.25) | 1024², hard edges | 75 % | Shown |
| High | 2 (phones 1.5) | 2048² soft (phones 1024²) | 100 % | Shown |

**Auto quality** starts at High on desktops and Medium on phones. It skips the first second
(shaders compiling), then takes the median frame time over 5 seconds. Above 22 ms at High, or
36 ms at Medium, it steps down one level. Below 17.5 ms it may step up once, but never after
stepping down. After at most three windows it stops watching, so it can never flicker between
levels. `?quality=low|medium|high` in the URL fixes the level for one visit (tests use it).

### Sound

All sound is synthesised with WebAudio at runtime, from oscillators and one noise buffer made at
startup. There are no files. It is off on first load, and switching it on in Settings is the gesture
browsers require. Like the renderer, it only reads game state:

| Sound | When |
| --- | --- |
| Surf | Always while on: filtered noise that swells and falls back |
| Horn | A battle begins (lower and longer on a Warlord wave) |
| Clink / thump | Melee hits and raiders hacking at buildings / shield bashes |
| Whip / thunk | Arrows loosed / a volley lands |
| Crackle | While anything burns |
| Splash, knock, click | Someone goes into the sea, something is built, a button is pressed |

Each kind is rate-limited per second, sounds are panned by where they happen on screen, and the
audio pauses while the tab is hidden.

### The VIEW interface

`main.js` picks a renderer at start: 3D, or the classic 2D map (`js/render.js`) when WebGL is
unavailable or the URL has `?2d`. Both implement the same interface, and `ui.js` and `main.js`
only talk to it:

| Member | Meaning |
| --- | --- |
| `kind`, `canvas` | `'3d'` or `'2d'`, and the element taps are measured against |
| `init(stage)` | Returns false if this renderer can't run here |
| `beforeStep()` | Called before every fixed sim step |
| `frame(dt, alpha)` | Draw. `alpha` is how far the clock is between the last step and the next |
| `pickTile(mx, my)`, `pickSquadAt(mx, my, touch)` | Sim tile, or squad, under a canvas point |
| `tileToScreen(x, y)` | Canvas point of a tile's surface centre (used by tests) |
| `zoomBy(f)`, `canZoomOut()`, `recentre()`, `bindInput(cb)` | Camera controls; `bindInput` reports taps, hovers and cancels back to the UI |

### Render-state contract

What the renderer reads from the sim each frame, and how:

* **Units** (`RT.units`): `id`, `side` (0 defender, 1 raider), `kind`, `x`, `y` (continuous tile
  coordinates), `hp`/`maxHp`, `alive`, `big`, `fleeing` and `alpha` (raiders fading after a sacked
  Hall), `target` (a unit, or a building when it has a `type`), `flash` (seconds of hit flash),
  `kbx`/`kby` (knockback velocity), `cdT` (attack cooldown: a jump upwards means an attack just
  happened), `walk` (distance walked, for gait), and for defenders `sq` and `slot` (0 = commander).
* **Squads** (`G.squads[i].rt`): `members`, `ax`/`ay` (formation anchor), `task`, `routedT`, `stats.size`.
* **Boats** (`RT.boats`): `id`, `x`, `y`, `dx`/`dy` (inbound heading), `state` (`sail`, `unload`,
  `leave`, `gone`), `cargo`, `boss`, `alpha`, `visibleAt` (hidden while `RT.timer > visibleAt` in a
  Fogbound countdown), `landing`.
* **Buildings** (`G.buildings`): `id`, `type`, `x`, `y`, `lvl`, `hp`/`maxHp`, `ruined`, `rebuild`, `flash`.
* **Projectiles and effects**: `RT.projectiles` (`x`, `y`, `sx`, `sy`, `tx`, `ty`, `h0`, `fire`,
  `visual`), `RT.volleys`, `RT.effects` (`hit`, `death`, `splash`, `bash`, `volley`, `blaze`,
  `refill`, `spark`), `RT.floaters`, `RT.phase`/`RT.timer`.

The renderer derives what the sim doesn't store:

* **Smooth motion.** `beforeStep()` snapshots unit and boat positions, and frames interpolate
  between the last two 20 Hz steps.
* **Facing.** The sim only has a left/right `face`, so the heading comes from movement, or from
  the target when standing still, then eases round.
* **Animation triggers.** Attacks show as jumps in `cdT` and hits as `flash`. A unit that leaves
  `RT.units` fell if its `hp` is at or below zero, drowned if it stands over water, and simply
  fades if it was `fleeing`. No sim hook was needed.
* **Fire and impacts.** Burning comes from `hp`/`maxHp`, `ruined` and `rebuild`. An arrow has
  landed when a projectile that was in flight last frame is gone; it is placed where it was last
  drawn. A boat has run aground when its `state` turns from `sail` to `unload`. Again no sim hook.

Its own per-unit state lives in Maps keyed by id. It never writes to sim objects.

## 11. Balance targets

Checked with `node tools/balance.js`, a headless bot that plays a simple greedy strategy
(always spends on the cheapest weighted option, re-enables Advance after three farmed wins).
Measured on the first island, without Sagas:

* Wave 10 (prestige unlock) at about 6–9 minutes. The first waves are short by design.
* Wave 20 at about 14–16 minutes.
* A wall around waves 26–30 after 30–45 minutes, set mostly by the Great Hall's level caps and
  the cost of the next Hall level. Sailing on from there pays roughly 60–75 Renown.
* With every Saga at level 3, wave 10 comes at about 4.5 minutes and wave 20 at about 10.
  The wall moves a few waves further. Enemy scaling is exponential (×1.15 HP and ×1.09 damage
  per wave), so each multiplicative boost buys a few more waves.

All the numbers live in `js/data.js`.
