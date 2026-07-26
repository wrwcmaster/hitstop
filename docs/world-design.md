# World design: the Undertoll

Status: **design proposal, from zero**. This is the complete story, region,
room, puzzle, and boss design for the full game, written to the constraints
in [gameplay-progression.md](gameplay-progression.md) (one boss one verb,
verb-gates not key-gates, no input reading, no power removal, both loadouts
everywhere, co-op by positioning). Where this doc decides something that
file listed as an open question, the resolution is marked **[resolves]**.

The current shipped rooms are a prototype of the surface band; the
[migration section](#migrating-the-current-world) at the end maps them into
this design. Nothing here assumes they constrain it.

---

## Part I — Story

### The premise

The world is the body of a colossal buried bell: **the Undertoll**. Long
ago it was struck once — **the First Strike** — and the world's energy is
the lingering ring of that blow. Everything alive and everything made runs
on resonance: forges are tuned, crops are rung awake, the dead are tolled
out. Impact is not violence here; it is the world's heartbeat.

The ring is fading. Where it fails, the world goes **still**: stone turns
gray and dead, machines stop mid-motion, animals freeze mid-stride and do
not fall over. People call it the Stilling and pretend it is far away.

Four ancient creatures — **the Keepers** — each embody one facet of the
original blow: the falling weight, the grip of the frame, the leap of the
rebound, the voice of the wave. As the ring faded they went to ground,
each hoarding its facet, which starves the world faster. They are not
villains. They are the last four embers, each cupping its own flame.

The player is **the Tollbearer** — the last apprentice of Hearthstead's
old Tollwright, sent to do the thing the town has stopped believing in:
descend to the Undertoll, gather the four facets, and strike the bell
again.

### The turn (midpoint)

She does it. She fights her way down, wins the four verbs, reaches the
Bell Below, and strikes it. The world RINGS — every resonant seal on the
map cracks open in one moment, the map screen lights up, the second half
begins.

And the ring reveals what the First Strike really was. The bell is
**cracked**, and it always has been. The First Strike was not creation —
it was **containment**. Something lives inside the crack: **the Hush**,
the primordial stillness the bell was cast to hold out. The Keepers were
never hoarding; they were *plugging the leaks*. Her strike woke it.

### The second half

The Stilling stops creeping and starts hunting. Stilled zones spread
through early regions — gray, silent, dead to resonance — and stilled
enemy variants walk them. The bell cannot simply be struck harder; a
cracked bell rings wrong. It must be **re-founded**: recast whole, which
needs the founder's fire at the Crown, the world's highest place, and the
founder's art, lost with the first Tollwright.

The Duelist — a rival bearer who has shadowed the player since the
mountain, certain that the facets belong to the strong and not to a plan —
stands in the way once more, and yields when beaten: her blade-oath
becomes the player's escort rights into the deep. The final descent goes
*through* the crack into the Clapperworks, the hollow inside the bell,
where the Hush waits: a bell-shaped absence that unmakes sound, feel, and
finally floor.

### The ending

The Hush cannot be cut. It can only be **rung out**. The final phase pins
it against the bell's strike point, and the player — carrying all four
facets and the world's own ring — delivers the last Impact Drop of the
game as the bell's living clapper. The Undertoll is recast in the blow.
The world rings clean, the stilled wake mid-stride, and Hearthstead names
her Tollwright. **[resolves: how impact and the bosses fit the narrative;
what event marks the midpoint]**

### Cast

| Who | Role | Where |
| --- | --- | --- |
| **The Tollbearer** | the player; nameable; class-agnostic in story | — |
| **Tollwright Ansa** | hub elder; sends you down; keeper of the founder's art (she doesn't know she has it — it's in her toll-ledger) | Hearthstead tollhouse |
| **The blacksmith** | forges ring-metal; armor/forge services; comic relief with anvils | Hearthstead |
| **The healer** | tends stilled victims; quiet barometer of the Stilling's spread | Hearthstead |
| **The merchant** | trades "echoes"; travels — appears in region rest rooms before you'd expect | roams |
| **The Duelist** | rival bearer; bars the Windspires rampart in the first half and the reopened Bore gate in the second — both duels mandatory | Windspires, then the Bore gate |
| **Maul, the Buried Hammer** | Keeper of the falling weight → **Impact Drop** | Sunken Foundry |
| **Vise, the Wall Beast** | Keeper of the frame's grip → **Wall Grip** | the Riven |
| **Bellwether, the Sky Ram** | Keeper of the rebound → **Air Step**; wears a cracked bell at its throat | Windspires |
| **Mourn, the Bell Below** | Keeper of the voice; blind; senses through stone → **Shockwave** | the Underbell |
| **The Undertow** | optional; a drowned keeper-that-wasn't | Brinehollow |
| **The Founder** | optional; the first bellfounder's animated effigy; mastery exam | the Crown |
| **The Hush** | the sealed stillness; final boss | the Clapperworks |

### Delivery

Story arrives through conversations (`DialogueScene`) at the hub and at
region thresholds, environmental murals (backdrop art) in antechambers,
banner beats at grants, the world's own state (the map lighting up at the
midpoint is itself a story beat) — and **cutscenes**, played by the
engine's Director over the LIVE world (`engine/director/`). A cutscene is
the running simulation with its inputs temporarily scripted: the knight
is driven through the same `Input` seam a co-op remote uses, so scripted
moments are deterministic (they record and replay bit-for-bit — the
regression suite carries a watched tape and a skipped tape), skippable
(skip fast-forwards the timeline, so everything a cutscene does still
lands), and free for a co-op guest to watch (the host simulates; the
snapshots carry the motion). Content lives in `content/cutscenes.ts` and
rooms place one with a `cutscene` trigger — no scene changes. Every boss
reveal, each region's escape framing, the Strike, and the ending are
Director timelines; the Slime King reveal in the throne room is the
shipped reference.

---

## Part II — The world

### Silhouette

Three vertical bands — **Sky / Surface / Deep** — threaded on one central
shaft, with the hub on top of the shaft. The player's compass is the
geography itself: *up needs Air Step, deep needs Wall Grip, the well is
home.*

```
                          THE CROWN            ← second half (founder's fire)
                              ▲
                        THE WINDSPIRES
                    BELLWETHER · Air Step
                              ▲
   BRINEHOLLOW ── THE FALLOWS ── HEARTHSTEAD ── the Eastern Seal
   (optional)       (opening)      hub · well      (opens at midpoint)
                                      │
                                  THE BORE                ← spine shaft
                                      │
                              THE SUNKEN FOUNDRY
                            MAUL · Impact Drop  (boss 1, mandatory)
                                      │  weak-floor descent
                          ┌───────────┴──────────┐
                      THE RIVEN                  │
                   VISE · Wall Grip ─────────────┤
                                                 │  antechamber needs BOTH
                                          THE UNDERBELL
                                       MOURN · Shockwave (midpoint)
                                                 ▼
                                        THE CLAPPERWORKS   ← second half, inside the bell
                                          THE HUSH (finale)
```

### The rules the shape enforces

1. **Every gate is a verb used on the world.** Entry to the Riven is a
   floor only Impact Drop breaks. The Underbell antechamber takes a
   grip-climb *and* an air-step gap. The Eastern Seal and every second-half
   region opens on resonance. Nothing checks a key item.
2. **Every region exits as a loop, and the escape IS the shortcut.** The
   teaching pattern's confirm + recontextualize steps are one piece of
   geography each (see each region's last room).
3. **Non-linearity is terrain.** After Maul, "up" (Windspires) and "down"
   (the Riven) are both open from the hub. **[resolves: bosses 2/3 are
   fully non-linear]**
4. **Depth bands are difficulty bands — until the Strike breaks them.**
   First half: surface is tier 1, Foundry tier 2, Riven/Windspires
   tier 3 in parallel, Underbell tier 4, and nothing rescales to the
   player — depth is the only difficulty axis, so a player always knows
   how dangerous a place is by how deep it sits. At the midpoint the
   Stilling re-tiers old ground as a **story event**: stilled variants
   and remixed encounter compositions push the Fallows to ~tier 3 and
   the Foundry to ~tier 4, while the new regions (Crown, Clapperworks)
   open at tier 5 (see Part V). This stays inside
   gameplay-progression.md's rule — upgraded variants are encounter
   progression; the world changes because the story changed it, never
   because the player got stronger.
5. **Optional content lives on the rim, mandatory on the spine.**
   Brinehollow (water, class content) and the Crown's mastery half hang
   off the sides; the critical path stays readable.
6. **Portals unlock outward.** A region's portal pad activates on first
   arrival on foot. Geography is learned before it is skipped.

### Room budget

First half ≈ 38 rooms (opening 5, hub 2, Bore 3, Foundry 7, Riven 7,
Windspires 8, Underbell 6),
plus the optional Brinehollow 4. Second half ≈ 15
(Crown 7, Clapperworks 6, stilled-zone overlays reuse existing rooms).
Every room must do at least one of: **teach, test, reward, connect,
breathe** — a room that does none is cut.

---

## Part III — Puzzle vocabulary

All puzzle grammars compose the four verbs with mechanisms that already
exist (traits `breakable`/`resonant`/`rebound`, gizmos platform / lever /
plate / barrier, water + oxygen, hazards, one-way platforms, room
patches, surface reactions). New mechanisms are listed at the end of this
section — there are only four, and two are pure content.

### The grammars

- **Weight-and-floor** (Foundry): a lever drops an ingot; where it lands
  depends on which floors you have broken first. Order puzzles use
  **`brittle`** stone — a *transient* breakable whose surface reaction
  breaks the live tilemap without recording a patch, so walking out and
  back in regrows it and a wrong order is never a dead end. (The shipped
  `breakable` reaction always records; transient breakage is a new
  mechanism — see the table below.) Design guardrail: geometry broken
  through the *recording* reaction must leave every break order solvable,
  because those holes are permanent for the run.
- **Pogo chains** (Foundry, Windspires): `rebound` surfaces + Impact
  Drop's enemy/surface bounce chain height out of pits and across spike
  fields. Ranged loadouts get identical pogo (the verb is the knight's).
- **Climb routing** (Riven): `gripstone` vs **`slick`** stone. Slick
  panels interrupt climbs and force kick-transfers across the shaft; the
  route is read from below like a wall of holds.
- **Debris timing** (Riven): rockfall columns on wave-table cadence;
  cling in alcoves between falls.
- **Step economy** (Windspires): exactly one air step, refreshed by pogo
  and wall-grab — routes sized so the refresh IS the puzzle ("you cannot
  cross this unless you pogo the lantern mid-flight").
- **Bell-nodes** (Underbell, second half): a node rings when something
  *strikes* it — a plunge directly on it, or later a Shockwave arriving
  along its surface. Ring patterns open barriers. Before boss 4 you must
  reach nodes bodily (climb + step); after, you ring them **remotely** by
  shaping a wave path — breaking floors to connect resonant runs, levering
  bridges so the wave can travel. Remote-ness is the upgrade; the node
  never changes.
- **Wave shaping** (post-midpoint): the star grammar. The player has
  internalized `traceSurface` rules from using Shockwave (gaps stop it,
  one-step ledges carry it, only resonant stone conducts). Puzzles ask
  them to *edit the conductor*: open a gap here, bridge one there, so one
  wave rings three nodes.
- **Re-ringing** (stilled zones): **deadstone** — solid but not resonant —
  kills waves. A plunge re-rings a deadstone patch (surface reaction:
  `stilled` trait + `plunge` → becomes rock via `mutateTile`), after which
  waves cross it. Every stilled-zone puzzle is Impact Drop preparing the
  ground for Shockwave: the two "down+attack" verbs in conversation.
- **Tide routing** (Brinehollow): existing swim/oxygen plus lever-driven
  water gates; DEEP LUNGS and tidecaller content live here.

### New mechanisms required (complete list)

| Mechanism | Kind | Cost |
| --- | --- | --- |
| `deadstone` tile + `stilled` surface reaction | pure content — a tile *without* `resonant`, plus one `defineSurfaceReaction('stilled', {to: ['plunge']})` | zero engine work |
| Bell-node placeable | new placeable listening for `plungeLand` overlap / `surfaceWave` on its tile; emits `setFlag` like levers do | game code only |
| `slick` trait | tile trait excluded by `wallGripSide()` (one tile lookup at the contact) | small player change |
| Quiet-zone feel suppression (Hush fight only) | scene-level: suppress hitstop/shake/sfx inside marked circles | game code only |
| `brittle` trait + transient break | a non-recording sibling of `mutateTile` on the reaction's host (break the live map, record nothing) so puzzle floors regrow on re-entry | game code only |

An updraft gizmo for the Windspires was considered and **cut**: moving
platforms plus air-step economy carry every route, and a fifth movement
force dilutes the verb vocabulary.

Boss floor-collapse needs **nothing**: any actor may emit `plungeLand`,
and the existing `breakSurface` handler breaks `breakable` tiles under
the reported footprint. Mid-fight collapse persists on victory and
vanishes on death *automatically* — death reloads the room-entry
autosave, which predates the fight's patches; the boss-defeat autosave
captures them. The save flow already implements the doc's "temporary
combat destruction vs. progression geometry" rule.

---

## Part IV — First-half regions, room by room

Sizes are in map cells (screens). `[T]`each `[X]`test `[R]`eward
`[C]`onnect `[B]`reathe mark each room's jobs.

### The Fallows (opening, tier 1)

Gray-green ruins west of town; the first stilled patches sit in the
distance like missing teeth. Enemies: slimes, bats, one archer.

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `fallows-edge` | 2w | T | Movement/jump/dash teach. A stilled gray copse in the background — the first sight of the antagonist, unremarked. |
| `fallows-fields` | 3w | T X | First combat mixes; a visibly cracked floor plate with a glinting cache beneath — Impact Drop foreshadow, unreachable for hours. |
| `waystone-gate` | 1w | X | Gate miniboss: **the Slime King** (existing fight, demoted with honor). Teaches boss grammar: HP bar, phases, arena discipline. |
| `old-toll-road` | 2w | B C | Breather; merchant caravan (first shop); a small resonant seal hides a coin cache — Shockwave foreshadow in miniature. |
| `hearthgate` | 1w | C | Arrival framing: the well's silhouette, the chimney above town howling wind. |

### Hearthstead (hub)

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `hearthstead` | 3w | C B | Town: merchant, healer, blacksmith, well at center (the Bore's mouth — sheer, ungrippable-looking walls: Wall Grip foreshadow), wind chimney above (Air Step foreshadow), the **Eastern Seal** at the right edge — a resonant arch, clearly a door, clearly not for you yet. |
| `tollhouse` | 1w | B | Ansa; the toll-ledger on the wall (second-half payoff); the map table (worldmap tutorial); class change shrine. |

### The Bore (spine)

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `bore-mouth` | 1w×2h | C T | The well descent: one-way platforms down, landings at each band. Drop-through teach. Deeper shafts choked with rubble that later escapes open from below. |
| `bore-gallery` | 1w×2h | C B | Mid landing: portal pad; a grand **resonance gate** to the Underbell, sealed (the "front door" you will not use until the midpoint opens it in reverse). |
| `bore-throat` | 1w×2h | C X | Lowest pre-verb point: Foundry entrance. The floor here is one vast `crackedRock` span — the Riven lies under it, and only Impact Drop opens it. |

### The Sunken Foundry (boss 1 — Maul, tier 2)

The world's forge, built against the bell's shoulder; drophammer golems
still work lines that lead nowhere. Palette: rust, ember, slag glow.
Enemies: drophammer golem (slams; its slams break weak floors — the
region *demonstrates* Impact Drop before granting it), ember bat, gunner.

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `foundry-approach` | 2w | T | Drophammers smash weak floors under themselves; the player learns weak-floor reading by watching enemies fall through their own arenas. |
| `ingot-halls` | 3w | X T | First weight-and-floor puzzle: lever drops an ingot onto a plate → barrier opens. Combat mixes on conveyor-like one-ways. |
| `slag-run` | 2w | X | Hazard floor (slag) crossed on one-way platforms; a chest cache pays the brave. |
| `crucible-lift` | 1w×3h | X C | Moving-platform lift ride with archer harassment from ledges; teaches fighting on temporary footing (the arena's language). |
| `maul-antechamber` | 1w | B | Hammer-scarred walls; conversation trigger (the rhythmic slams below stop, one by one, as you approach). Room-entry autosave = checkpoint. |
| `maul-arena` | 2w×2h | X R | See boss. |
| `foundry-undercroft` | 1w | R C | Post-victory: the **confirm** course — three stacked weak floors to plunge through, no enemies; lands at a broken column that pogo-climbs back to `bore-throat` (the loop), portal pad. |

**Maul, the Buried Hammer.** A blind forge-colossus whose head is the
hammer; it fights by remaking the arena's floors. Arena: two `crackedRock`
floor layers over a solid slag-pooled base.

| State | Behavior | Counterplay |
| --- | --- | --- |
| `stalk` | drags along its layer toward the player; brief | position; ranged chip |
| `slam` | rears, hangs one beat, drives down — emits `plungeLand`, breaking the floor span it hits (persistent for the visit) | sidestep; the HOLE it makes is your route between layers |
| `sweep` | low horizontal drag across one layer | jump it (aerial attack window) |
| `burrow` | dives into the base layer, tracks under the player (dust plume telegraph), erupts | keep moving; the eruption breaks floor upward |
| `embed` | after `slam` on already-broken ground its head sticks fast for 2.2s | the punish window — melee wails, ranged unloads |
| `enrage` (≤40% HP) | slams chain in twos; more floor gone | the arena is now mostly holes: fight vertically |

Teaching: every mechanic *is* Impact Drop performed at you — falling
weight breaking floors, with the reward window for reading it. Co-op: one
knight baits `slam` on the top layer while the other punishes `embed`
below; ranged can work either layer. Victory: the base layer gives way,
grant **IMPACT DROP** mid-fall, and the escape is the undercroft course.

### The Riven (boss 2 — Vise, tier 3)

A vertical crack in the world's frame, all cold blues and hanging chains.
Entered by breaking `bore-throat`'s floor — the descent is a fall.
Enemies: wallcrawler (grips and demonstrates climbing), rockfall shade,
gunner nests. A windlass elevator (platform + lever) near the lip is the
slow pre-Grip exit, so route-choosers are never trapped.

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `riven-lip` | 2w | T C | Land on a chain terrace; windlass elevator back up; first rockfall columns on a readable cadence. |
| `riven-descent` | 1w×4h | T X | The big drop: ledges stagger the fall; wallcrawlers climb past you, *showing* grip on gripstone and refusing slick panels — the wall itself is legible. |
| `span-bridges` | 2w | X | Lever bridges across the crack; gunner crossfire; plates under debris piles open a side vault. |
| `undercut` | 2w | X | Ceiling spikes + timed debris corridor; the quiet room where you learn the region's rhythm. |
| `vise-approach` | 1w×2h | T B | Crumbling temporary platforms (the arena's language); nest matter on the walls thickens. Autosave. |
| `vise-arena` | 2w×3h | X R | See boss. |
| `riven-flue` | 1w×5h | R C | Post-victory **confirm**: the first true climb — a pure Wall Grip ascent with rest ledges, no enemies — surfacing at Hearthstead's western edge (new town door). The first ascent IS the permanent shortcut. Portal pad at the lip. |

**Vise, the Wall Beast.** A many-limbed spanner of the crack that never
touches the floor; the player fights from temporary platforms while the
boss owns every wall. Arena: a tall shaft, four crumbling platforms, two
permanent ledges.

| State | Behavior | Counterplay |
| --- | --- | --- |
| `traverse` | crawls wall to wall above/below platform level | track it; ranged pokes the body |
| `lunge` | coils (limbs bunch — the tell), springs flat across the shaft | drop a platform level, or dash through the gap under it |
| `rockfall` | hammers its wall; debris falls in two marked columns | stand the third column |
| `pin-slam` | slams both walls; a shudder crosses platforms and *crumbles* the one you stand on if you linger | move on the tell; platforms respawn on a cycle |
| `hang` | a missed `lunge` leaves it hanging low on the far wall, belly node exposed, 2.5s | the punish window; melee needs the adjacent platform, ranged shoots across |
| `enrage` (≤35%) | destroys two platform anchors permanently (patches); lunges feint once | tighter footing; the feint is a second coil |

Teaching: the whole fight is *wanting* Wall Grip — you watch a creature
own the walls while you rent the floor. Co-op: platforms are scarce, so
splitting levels is natural; the `hang` window is on one side, rewarding
the ranged partner when melee is stranded. Victory: every platform
crumbles, grant **WALL GRIP** mid-fall onto the wall — the first grab is
scripted by geometry (nothing else to land on) — then the flue climb.

### The Windspires (boss 3 — Bellwether, tier 3)

Wind-carved stone needles above the mountain; the existing mountain and
passage rooms become the lower third. Palette: pale sky, snow, prayer
ribbons. Enemies: leaper, archer, chime kite (aerial). The **Duelist**
stops shadowing here and stands in the road: she holds the only bridge
onward, certain the facets belong to whoever can take them, and she will
not watch an "errand girl" walk to a Keeper unproven. Mandatory duel #1
— her grounded kit only (combo, backstep, pistol; no air game yet), tier
3, beatable with any loadout, drops a skill-tree point. Beaten, she
opens the rampart gate herself and leaves a promise instead of a
concession — the second-half rematch is declared the moment the first
duel ends.

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `spire-steps` | 1w×4h | T | Ledge climbing at jump height; gust telegraphs (visual sway only — wind never moves the player). |
| `gale-pass` | 2w | X | Horizontal gap run; archers on far ledges; the gaps are jump-plus-a-little — the *ache* for Air Step. |
| `rampart-duel` | 2w | X B | The Duelist bars the region's only bridge onward; banners, a long flat stage — the game's purest 1v1. The Windspires cannot be crossed without answering her. |
| `broken-sky-bridge` | 3w | X C | Wide gaps crossed the slow way: lever-extended bridges. Post-verb these are one air step each — recontextualization is built into the room. |
| `the-roost` | 2w | X B | Wave-table gauntlet in a bowl arena; rest alcove with the merchant, improbably. |
| `bellwether-approach` | 1w×2h | T B | Rising platform chimney; above, the ram's silhouette bounds between spires on bursts of force — Air Step demonstrated across the skyline. Autosave. |
| `bellwether-arena` | 3w×2h | X R | See boss. |
| `spindle-chimney` | 1w×5h | R C | Post-victory **confirm**: the arena collapses and the way home is DOWN — a dive through stone rings, each offset so one air step centers you on the next, landing in Hearthstead's chimney. The joyride is the shortcut. |

**Bellwether, the Sky Ram.** A great horned ram wearing a cracked bell at
its throat; it redirects mid-air by kicking off bursts of impact — Air
Step, weaponized. Arena: open sky, two fixed spires, a cycling raft of
moving platforms.

| State | Behavior | Counterplay |
| --- | --- | --- |
| `perch` | lands on a spire, bleats; brief vulnerability | ranged window; melee repositions |
| `charge` | aerial charge; **the bell tolls once per redirect it will make** (one toll = straight, two = one bend, three = two bends) | count the tolls; the audio IS the telegraph |
| `stampede` | runs the platform level, cracking each platform it leaves (respawn on cycle) | be airborne or on a spire |
| `toss` | under-platform head toss, flipping one platform | watch its climb under you |
| `stagger` | a charge that hits a spire wedges its horns, 2.5s | the punish; melee gets the spire, ranged the angle |
| `enrage` (≤35%) | three-toll charges standard; one spire crumbles to half height | the raft is now the main floor |

Teaching: audio-counted redirects make players *read* aerial impulse —
the exact skill Air Step then hands them. Co-op: spires + raft give two
natural stations; the toll count is shared information, so calling it is
the co-op verb. Victory: the arena floor falls away spire by spire, grant
**AIR STEP** in the fall, dive home.

### The Underbell (boss 4 — Mourn, tier 4)

The bell's shoulder: vaulted resonant halls where every footstep travels.
Requires Wall Grip **and** Air Step to traverse — whichever order they
were earned. Enemies: echo bat (relocates to sound), stilled crawler
(first true stilled enemy — silent, visually telegraphed), deep gunner.

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `converge-hall` | 2w | C T | Where the Riven's bottom and the Foundry's deep door meet. First **bell-node**: plunge it to ring it, a barrier opens — the node grammar, taught bodily. |
| `grip-gallery` | 1w×4h | X | Wall Grip descent broken by slick panels forcing kick-transfers; echo bats punish sloppy noise. |
| `the-long-gap` | 3w | X | The Air Step exam: gaps sized exactly one step, with pogo-lanterns where the route demands a refresh. Co-op alt-route: plates extend bridges so a partner can walk it. |
| `mourn-antechamber` | 2w | X B | The both-verbs door: two bell-nodes — one atop a grip-climb, one across a step-gap — rung within one window. Murals of the First Strike (the containment, readable in hindsight). Autosave. |
| `mourn-arena` | 3w×2h | X R | See boss. |
| `strike-chamber` | 1w×2h | R C | The Undertoll's crown-strike point. Scripted: one plunge onto it = **the Strike**. The world rings; the map montage; the crack revealed. The resonance gate to `bore-gallery` opens — the loop home, and the second half's front door. |

**Mourn, the Bell Below.** Blind; it *is* the bell's grief. It senses
through connected surfaces — standing still or being airborne makes you
quiet; running makes you loud. The fight examines the whole first-half
kit. Arena: the bell's shoulder — resonant floor, two wall runs with
deadstone rests, one high perch.

| State | Behavior | Counterplay |
| --- | --- | --- |
| `listen` | head tracks ground vibration; attacks aim at the last loud thing | stillness, walls, or air break its aim |
| `toll-wave` | sends shockwaves along floor AND up the walls (the engine's own `traceSurface` rules — deadstone rests are safe holds) | jump/air-step the floor wave; cling on deadstone |
| `pounce` | leaps and impact-drops the last heard position, breaking that floor span | bait it — its own craters become your cover and plunge routes |
| `keen` | a standing cry summons echo bats | thin them or use them as pogo fodder |
| `stagger` | a `pounce` onto already-broken floor drops it through, wedged below, back exposed, 3s | plunge onto its back — the game's own verb as the punish |
| `enrage` (≤40%) | the chamber itself hums: rolling floor ripples on a rhythm | the fight becomes rhythm traversal: ground only between beats |

Teaching: sound-as-aggro previews stilled-zone stakes; every counter is a
first-half verb used precisely. Co-op: two players = two noise sources —
deliberate loudness becomes the baiting tool, the fight's co-op verb.
Victory: grant **SHOCKWAVE**; the confirm is the antechamber seal, opened
by sending a wave along the floor into its base; then the Strike.

### The Brinehollow (optional, tier 2–3)

Flooded caves off the Fallows' western cliffs (the current grotto is its
gate). All swim/oxygen/tide content; the tidecaller's home ground; no
mandatory verbs, no mandatory visit. **[resolves: water stays off the
critical path]**

| Room | Size | Jobs | Design |
| --- | --- | --- | --- |
| `brine-gate` | 2w | C T | Existing grotto, rethemed entry; tide levers teach. |
| `tidehalls` | 3w | X | Oxygen routing through air pockets; pike hunters; DEEP LUNGS makes optional deep shelves reachable. |
| `undertow-den` | 2w | X R | Optional boss: **the Undertow** — a current-wielding drowned mass; pulls, vents, grab-and-carry (existing Devourer swallow tech re-armed). Reward: tidecaller capstone + a charm. |
| `pearl-vault` | 2w | R | Treasure gallery; one air-step-only shelf and one wave-rung node winking at returning players. |

---

## Part V — The second half

The first half acquires verbs; the second half is **fluency**: every
region asks for two or three verbs per route, and the Stilling remixes
old ground.

### The world after the Strike

- **Old ground is genuinely harder now.** Stilled zones creep into the
  Fallows and Foundry: deadstone patches kill waves (Shockwave and every
  resonant tool go quiet until re-rung), and stilled enemy variants
  replace the old spawns — silent (no audio telegraphs, but slower, with
  enlarged visual tells; fairness preserved), tougher, and mixed into
  encounter compositions the first half never used. A returning player
  walks familiar rooms at roughly two tiers above the first visit
  (Fallows ~3, Foundry ~4): the remix and the variants earn the
  difficulty — the numbers on unchanged monsters don't move. Re-ringing
  ground (plunge, then wave) is the local grammar everywhere.
- **The Eastern Seal** and every small resonant seal on the map crack
  open at the midpoint. Mechanism: seals are **flag-gated barrier
  placeables** — the Strike sets one story flag (`world-rung`), and each
  seal spawns open once its room loads with the flag set. No cross-room
  patching is needed or possible (`mutateTile` only touches the loaded
  room, by design); the montage is presentation over the flag flip, and
  the map screen filling with new doors falls out of the seals' rooms
  reporting their open state. Recontextualization as a single world-wide
  beat, built entirely from flags + barriers that already exist.
- **The Duelist rematch** (mandatory) at `bore-gallery`: she keeps the
  promise made on the rampart and bars the reopened gate; full-kit
  mirror duel — the grounded kit from duel #1 plus everything she
  lacked then: she air-steps, wall-kicks, and
  reads the ground like you do. Beaten, she yields her oath (and an
  optional-tier upgrade: **Riposte Tempo** — parry follow-ups refresh the
  air step).

### The Crown (7 rooms, tier 5, above the Windspires)

The bell's crown loop and the founder's fire — the world's summit,
all verb-weave: grip flues feed step-gap chains onto rebound spires. Key
rooms: `crown-ascent` (1w×6h; the game's longest climb, every grammar in
sequence), `founder-forge` (the fire that will recast the bell; lighting
it is a wave-shaping puzzle across three floors), `founder-sanctum`
(optional boss: **the Founder**, an animated effigy that fights in
strict verb-answer patterns — a mastery exam; reward: **Greater
Shockwave**, +50% range), `crown-gate` (scripted: the lit fire is carried
down the Bore in one continuous descent — the game's victory-lap
traversal, every shortcut used in anger).

### The Clapperworks (final region, 6 rooms, inside the bell)

Through the crack. The bell's hollow: every surface resonant, geometry
half-unmade. Rooms: `the-crack` (squeeze-through threshold; the Hush's
quiet-zones introduced as environment), `hollow-vaults` (floor tiles
*unmake* on a cycle — patches removing and restoring; step economy at
tier 5), `silence-run` (a quiet-zone gauntlet: no hitstop, no sfx inside
— feel itself is the stolen resource; Shockwave re-rings the corridor
segment by segment), `clapper-shaft` (1w×6h grip/step descent on the
clapper's chain), `hush-arena`, `the-recasting` (ending, scripted).

**The Hush** (final boss, three phases):

| Phase | Behavior | Counterplay |
| --- | --- | --- |
| **1 — Silence walks** | a bell-shaped absence; sweeps reaching limbs along the ground (wave-grammar attacks); drops silence from above; casts **quiet-zones** — inside them your feel dies (no hitstop/shake/sfx) and knockback halves | Shockwave cleanses a zone; fight for ground that still rings |
| **2 — The world mutes** | stills floor sections to deadstone; only *resonating* — struck by your wave — does its body take full damage (chip otherwise); unmakes floor tiles at the arena edges | plunge to re-ring floors → wave to open damage windows → grip/step to survive the shrinking ground: all four verbs by construction |
| **3 — Re-strike** | pinned against the strike point by the ringing arena; toll rhythm sweeps the whole floor | survive the rhythm, climb the final wall run, and deliver the last plunge — the player is the clapper; the blow is the ending |

No input reading anywhere: the Hush's threat is *subtraction* (of feel,
of sound, of floor), never counters.

---

## Part VI — Migrating the current world

Nothing shipped is wasted; each room grows into its target role:

| Today | Becomes |
| --- | --- |
| `town` | `hearthstead` (add well-as-Bore-mouth, Eastern Seal, chimney) |
| `arena`, `cavern`, `corridor`, `throne` | the Fallows band; Slime King demotes to `waystone-gate` miniboss (his Impact Drop grant moves to Maul) |
| `mountain`, `mountain_passage`, `ramparts` | Windspires lower third; the Duelist becomes the rival who bars the rampart bridge (her Air Step grant moves to Bellwether) |
| `underground`, `vault` | Foundry top layer (the cracked cache stays as-is) |
| `grotto` | `brine-gate` |
| well seam, portals, worldmap | unchanged mechanisms; new rooms are data |

Migration order (each step shippable): 1) the Riven + Vise (Wall Grip
finally reachable in-world), 2) Foundry + Maul (moves the Impact Drop
grant), 3) Underbell + Mourn (Shockwave reachable, midpoint event), 4)
Windspires upper + Bellwether (moves Air Step; Duelist becomes the
rampart's mandatory gatekeeper),
5) Fallows retheme + Slime King demotion, 6) second half.

Grant moves are demo-phase save changes (AGENTS.md rule 9): owned verbs
in old saves stay owned; only the *source* moves.

---

## Part VII — Consistency check against gameplay-progression.md

- One boss, one verb; every verb has combat + traversal use; no
  multi-mode skills, no key-abilities, no aiming traversal. ✓
- Bosses demonstrate their verb before granting it (Maul's slams, Vise's
  wall-ownership, Bellwether's counted redirects, Mourn's toll-waves). ✓
- Teaching pattern (foreshadow → teach → test → reward → confirm →
  recontextualize) is one row per region above; every confirm is the
  escape, every recontextualize is the shortcut home. ✓
- No enemy reads inputs, counters a preferred verb systematically, or
  removes powers; stilled variants trade audio tells for larger visual
  ones. The second-half re-tiering of old regions is encounter
  progression — the Strike swaps the encounters — never scaling to the
  player. ✓
- Both loadouts everywhere: every punish window is reachable by melee
  position AND ranged angle; the verbs are the knight's, not the
  weapon's. ✓
- Co-op by positioning: platform-scarce arenas, two-noise-source baiting,
  toll-count callouts, plate-assisted alt routes — never role locks. ✓
- Open questions resolved here: midpoint event, boss 2/3 non-linearity,
  foreshadow placements, narrative frame, second-half upgrade shape
  (optional, action-enhancing: Greater Shockwave, Riposte Tempo). Still
  deliberately open: final art direction and the exact second-half
  room count. ✓
