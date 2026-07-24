# Gameplay progression: impact skills and first-half bosses

Status: **early design direction**. The gameplay principles and four-skill
structure are current decisions. Boss names, appearances, regions, and story
explanations are working concepts.

## Design thesis

`hitstop` is an action game first. Story should create stakes and give the
world personality, but the core reward is becoming more capable and expressive
in combat and traversal.

The central fantasy is:

> Meet a creature that controls a physical force, defeat it, gain one simple
> skill based on that force, and use the skill throughout the world.

Impact can be the world's important form of energy and the basis of its
mythology. That premise should explain and reinforce the mechanics rather than
constrain them.

## Player-growth principles

- The player grows more powerful; the world does not continuously scale to
  cancel that growth.
- Returning to early areas should feel liberating. Old gaps become shortcuts
  and early monsters become satisfying combo targets.
- Later enemies may be stronger or more complex, but should not systematically
  become immune to the player's preferred skills.
- Challenge should come from enemy combinations, arena pressure, richer attack
  patterns, and mastery of the accumulated moveset.
- A new skill should create opportunities, not introduce a tax that must be
  paid everywhere afterward.
- Every mandatory boss skill should be useful with both close-range and
  long-range loadouts. The value may change with the loadout, but the input and
  core behavior should not split into separate melee and ranged versions.

Avoid designs where enemies read inputs, automatically counter the player's
favorite move, or remove acquired powers. Upgraded monster variants can appear
later, but they are part of encounter progression rather than a response to
how the individual player fights.

## One boss, one skill

Each major boss grants exactly one understandable player verb.

A boss skill should have:

1. One input or contextual input combination.
2. One clear action the player can describe in a short sentence.
3. An immediate combat use.
4. An immediate traversal use or environmental consequence.

Environmental reactions are effects of the skill, not additional skills.
For example, "break weak floors" is not an ability. It is a result of using
Impact Drop on a weak floor.

Avoid:

- Multi-mode skills.
- Stances and physics menus.
- Several unrelated powers from one boss.
- Abilities that function only as keys for matching doors.
- Aiming-heavy traversal such as freeform grappling.

Complexity should emerge from combining simple verbs.

## Existing foundation

The current player already has a strong baseline:

- Run and variable-height jump.
- Melee and ranged weapon interactions.
- Dash.
- Parry.
- Contextual aerial attacks.

Boss skills should extend this foundation instead of duplicating it. In
particular, the existing dash already serves horizontal traversal, so a
grapple is unnecessary and would add difficult aiming on keyboard, touch, and
gamepad.

## Combat roles and co-op

Co-op can become one of the game's distinctive strengths: one player may build
for close combat while the other controls enemies from range. These are
loadout choices, not fixed Player 1 and Player 2 roles. Class, weapon, and
skill-tree choices should let either player occupy either role.

Boss skills follow three constraints:

- The same simple skill works for both combat roles.
- Each player remains complete and capable when playing solo.
- Co-op synergy emerges from positioning and timing rather than mandatory
  two-player switches or role-locked mechanics.

For example, a close-range player might use a movement skill to enter or extend
a combo, while a ranged player uses the same skill to create space or reach a
firing position. Neither receives a separate version of the skill.

Co-op difficulty should not come primarily from multiplying enemy health.
Better future tools include mixed enemy groups, attacks that cover different
parts of an arena, and bosses that choose intelligently between nearby and
distant threats. This is a design constraint to preserve, not first-half scope
that must be built immediately.

## First-half skill set

The first half contains four major bosses and four mandatory skills.

### Impact Drop

Action: while airborne, press down + attack to convert the fall into a powerful
downward strike.

Natural effects:

- Damage and launch enemies.
- Rebound upward after striking an enemy or bounce surface.
- Break weak floors.
- Activate heavy impact mechanisms.
- Produce a small area impact on solid ground.

Ground Slam and Rebound were previously separate concepts. They occupy the
same input, direction, and design space, so they are one skill: Impact Drop.
It is a player movement ability rather than a special property of a melee
weapon, so a ranged loadout can still use it. A close-range player uses it to
enter a fight or continue an aerial sequence; a ranged player uses it to break
through a route, escape pressure, or rapidly reposition.

### Wall Grip

Action: hold toward a valid wall to cling; jump to kick away.

Natural effects:

- Climb vertical shafts.
- Pause and recover during a fall.
- Fight or launch away from walls.
- Reach routes that were previously visible but inaccessible.

Wall Grip should feel forgiving. It should support movement flow rather than
turn every wall into a stamina-management exercise.

For close combat it prepares a new approach angle. For ranged combat it creates
a temporary positioning option. Attacking while clinging may be tested later,
but is not required for the skill to be valuable and should not complicate its
initial implementation.

### Air Step

Action: press jump once in midair to kick against a burst of impact energy.

Natural effects:

- Correct a missed jump.
- Extend aerial combat.
- Reach a wall after jumping away from it.
- Continue moving after an Impact Drop rebound.
- Combine with dash for longer aerial routes.

Air Step is the impact-physics expression of a traditional double jump. Its
value is clarity and reliability.

Close-range loadouts use it to close distance and extend aerial attacks.
Long-range loadouts use it to preserve distance, correct aim, and move between
safe firing positions. Its behavior remains identical for both.

### Shockwave

Action: release a forceful strike that sends one wave horizontally through a
connected surface.

Natural effects:

- Damage or stagger enemies at range.
- Activate resonant mechanisms.
- Break cracked barriers.
- Reach objects through a wall or across a dangerous floor.

The exact input remains open. It could be a charged attack, a dedicated skill
action, or a contextual heavy strike. It should not require free aiming.

A close-range player can use Shockwave as an opener, finisher, or way to
stagger an enemy just outside weapon reach. A ranged player can use it for
ground control and to push back approaching enemies. It remains one
surface-traveling wave, not two role-specific attacks.

## First-half bosses

Names and visual identities below are placeholders. Their mechanical roles are
the important part.

### Boss 1: The Buried Hammer

Reward: **Impact Drop**

This is the first mandatory major boss. It attacks by collapsing platforms,
driving through floors, and exposing weak points above and below the player.

The fight teaches:

- Reading vertical attacks.
- Moving between floor layers.
- Recognizing weak and reboundable surfaces.

After victory, the player escapes by using Impact Drop through several layers
beneath the arena. Earlier weak floors become optional routes on the return
journey.

### Boss 2: The Wall Beast

Reward: **Wall Grip**

The fight takes place in a vertical space. The boss can use every surface,
while temporary platforms initially give the player limited access to its
height.

The fight teaches:

- Watching attacks from walls and ceilings.
- Controlling position in a vertical arena.
- Choosing safe moments to leave the ground.

After victory, the player climbs directly out of the arena using Wall Grip.

### Boss 3: The Sky Ram

Reward: **Air Step**

The boss changes direction by kicking against bursts of impact energy in open
air. Its arena may contain falling platforms or move continuously through the
sky.

The fight teaches:

- Reading aerial charges.
- Recovering from knockback.
- Fighting while safe ground is temporary.

After victory, the arena collapses and the player uses Air Step to escape.

### Boss 4: The Bell Below

Reward: **Shockwave**

This blind underground boss senses and attacks through connected surfaces.
Its force travels through floors and walls rather than open air.

The fight tests the complete first-half moveset:

- Wall Grip avoids ground waves.
- Air Step extends time away from dangerous surfaces.
- Impact Drop strikes exposed weak points.

After victory, Shockwave opens the route into the second half.

## First-half world structure

The Buried Hammer is mandatory. The Wall Beast and Sky Ram can be defeated in
either order. The Bell Below requires both skills and serves as the midpoint
boss.

```text
Opening
   |
Buried Hammer -- Impact Drop
   |
   +-- Wall Beast -- Wall Grip --+
   |                             |
   +-- Sky Ram --- Air Step -----+-- Bell Below -- Shockwave -- Midpoint
```

This provides meaningful route choice without requiring every region to
support every possible ability combination.

## Boss-region teaching pattern

Each boss region follows the same learning rhythm without needing to look like
a traditional themed dungeon:

1. **Foreshadow**: show an inaccessible route or environmental effect related
   to the future skill.
2. **Teach**: introduce enemies and hazards that demonstrate the physical rule.
3. **Test**: combine those ideas in the boss fight.
4. **Reward**: grant the skill immediately after victory.
5. **Confirm**: require the skill in a short, low-risk escape sequence.
6. **Recontextualize**: reveal a shortcut or return route that uses the skill.

The escape sequence is important. The player should understand the new skill
before returning to the wider map.

## Source audit and implementation requirements

The current engine is already sufficient for four mechanically distinct
bosses. `MonsterDef`, boss FSMs, `Strike`, `Projectile`, hitstun, knockback,
hitstop, screenshake, rooms, triggers, and registries provide the main combat
foundation. The existing player also contains most of Air Step and Impact
Drop's basic motion.

The missing foundation is physical-world awareness: movement currently knows
that the player is on the ground, but not which wall or surface was contacted.

### Required engine mechanisms

#### Collision contact results

`moveAndCollide` should report generic collision contacts instead of returning
no information. A result should make available:

- Contact normals for floor, ceiling, left wall, and right wall.
- The solid that was contacted.
- Velocity immediately before impact.
- Whether the contact involved a one-way or dynamic solid.

This is the primary requirement for reliable Wall Grip and for making Impact
Drop affect the exact surface struck. The physics engine should expose contact
facts; the game layer decides what an ability does with them.

#### Surface metadata and queries

Tiles need generic content-defined surface traits plus reusable queries for:

- Finding the tile and definition at a world-space point.
- Enumerating tiles overlapped by a rectangle.
- Probing a short distance in a direction.
- Tracing a connected floor until a wall, step, or gap.

Content can then describe traits such as breakable, rebound, resonant, or
shockwave-passable without teaching the engine about particular abilities.
Impact Drop consumes contact and surface information; Shockwave consumes a
surface trace.

#### Persistent room mutations

If a broken floor or barrier must remain changed after leaving a room, the
game needs a serializable room-patch mechanism. It should record generic tile
replacements or removed entities, reapply them when the room loads, and expose
the changes to replay and co-op synchronization.

Weak floors could initially be placeable entities instead of mutable tiles.
That is a valid small-scale implementation, but a room-patch mechanism is the
better long-term foundation if changing geometry becomes common.

### Required game-layer systems

These belong under `src/game`, not in the engine:

- A class-independent set of permanent world abilities. The current
  `PlayerCapabilities` collection is cleared during class changes, so boss
  rewards cannot live only there.
- A data-driven boss reward declaration or registry. Boss definitions should
  name the ability they grant; `PlayScene` should not contain a boss-id switch.
- Save and restore support for earned world abilities.
- Ability-aware environmental placeables and trigger gates.
- Unlock presentation, explanation, and the post-boss confirmation sequence.

Air Step's movement already exists as the class-tree SKY DANCER modifier. It
should become a boss-owned world ability, and the old tree node should be
removed or repurposed. Weapon definitions also already provide plunge and
enemy rebound behavior; Impact Drop must gate or replace that access so the
first boss grants a genuinely new verb.

### Cross-system integration

Every ability implementation must also cover:

- `TestScenario` support for granting selected world abilities.
- Replay state that includes ability ownership and persistent room mutations.
- Co-op profile synchronization for earned abilities.
- Co-op synchronization of destroyed geometry, or a new gizmo snapshot when
  breakable surfaces are implemented as placeables.
- A recognizable Shockwave snapshot and renderer rather than a generic
  projectile dot.
- Keyboard, gamepad, touch, rebinding, replay, and network action lists if
  Shockwave introduces a new dedicated input.

The contextual inputs for Impact Drop, Wall Grip, and Air Step already travel
through the existing network action set. A dedicated Shockwave action is the
only likely protocol input addition.

### Recommended implementation order

1. Add collision contact results.
2. Add generic surface traits and tile probes.
3. Add permanent world-ability ownership and data-driven boss rewards.
4. Convert Air Step and gate Impact Drop, reusing their existing player code.
5. Implement Wall Grip from collision contacts.
6. Implement Shockwave from surface tracing and existing combat primitives.
7. Add persistent room patches if breakable geometry must survive room reloads.
8. Complete replay, scenario, co-op, input, and editor verification.

After the first three steps, most work belongs to game content and player
behavior rather than new engine architecture.

## Second-half direction

The first half is about acquiring verbs. The second half is about fluency.

The four mandatory skills form the complete traversal vocabulary. The second
half should emphasize:

- Combining two or three skills in a single route.
- Combat arenas built around movement expression.
- Weapon, class, and skill-tree growth.
- Optional upgrades that improve existing actions without adding controls.
- Optional bosses and mastery challenges.
- Shortcuts that make the world faster to traverse.
- Major bosses that test the full kit rather than each granting another
  mandatory traversal verb.

Possible upgrades include a stronger Shockwave, an airborne dash refresh, or a
larger rebound after Impact Drop. These are enhancements to known actions, not
new modes.

## Story boundary

The story is intentionally not locked yet.

The current useful premise is only:

- Impact is an important source of energy.
- A small number of major bosses embody or control concentrated physical
  forces.
- Defeating a boss lets the player wield one of those forces.
- Something has driven the bosses or their forces out of balance.

The bosses might ultimately be natural creatures, engineered weapons,
champions, or something stranger. The final narrative should be built around
the selected gameplay verbs rather than forcing the mechanics to serve a
prewritten mythology.

## Playtest criteria

For each skill and boss, verify:

- A new player understands the skill within the post-boss escape.
- The skill is useful in both combat and traversal.
- The skill has one clear input and does not conflict with existing controls.
- The skill is useful with both close-range and long-range loadouts without
  changing its core behavior.
- At least one earlier route becomes meaningfully faster or newly accessible.
- The boss demonstrates the skill before granting it.
- Combining the skill with an earlier ability feels intentional.
- Touch and gamepad use remain as comfortable as keyboard use.
- Acquiring the skill makes early encounters easier or more expressive.

## Open questions

- Final boss names, appearances, personalities, and region identities.
- The exact Shockwave input and resource cost, if any.
- Whether Wall Grip is unlimited or has a short automatic slide.
- Whether Bosses 2 and 3 are fully non-linear or merely offer a route choice.
- Whether Wall Grip allows attacks while clinging.
- Whether Shockwave uses an existing contextual action or a new universal
  action available alongside class skills.
- Which existing rooms will foreshadow each ability.
- How impact energy and the four bosses fit into the main narrative.
- What event marks the midpoint after the Bell Below.
- Which second-half upgrades are mandatory, optional, or class-specific.
