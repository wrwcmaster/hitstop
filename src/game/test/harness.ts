/**
 * hitstop's replay adapter — the game half of the engine's record/replay
 * (see `engine/replay/replay.ts` for the mechanism and the page modes).
 *
 * The engine records tapes, replays them, and runs the viewer; this file
 * only tells it what's game-specific: which actions exist, what world
 * state to hash, and how a run begins. It must stay the FIRST import in
 * main.ts — `bootReplay` seeds the gameplay RNG (and sandboxes storage
 * when watching a replay) before any other module can touch either.
 */
import { Replay, bootReplay, DialogueScene, GRAVITY, Projectile, skillDef, type Tilemap, type Recording } from '@engine/index';
import { STORAGE_PREFIX, REPLAY_PENDING_KEY, type ActionGame, type Action, type RunStart, type GameEvents } from '../defs';
import { Player } from '../actors/player';
import { PLAYER_TUNING } from '../actors/player-tuning';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { PlayScene } from '../scenes/play';

/**
 * A scene that can explain itself to an agent. Optional and duck-typed on
 * purpose: the harness must not grow a list of every menu in the game,
 * and a scene that stays silent still reports its name and that it is
 * blocking, which is the part that matters most.
 */
export interface AgentReadable {
  describe(): Record<string, unknown>;
}

declare global {
  interface Window {
    /** Rich perception for agents — see attachObserver. Never hashed. */
    __observe?: () => unknown;
  }
}

export const BOOT = bootReplay({ storagePrefix: STORAGE_PREFIX, pendingKey: REPLAY_PENDING_KEY });

/** Every action an agent may drive (mirrors defs.ts). */
const ACTIONS = [
  'left', 'right', 'up', 'down', 'jump', 'attack', 'dash',
  'skill', 'skill2', 'skill3', 'parry', 'interact', 'confirm', 'cancel', 'menu', 'map',
] as const satisfies readonly Action[];

/** What state() reports. Numbers are rounded so hashes are format-stable. */
export interface HarnessState {
  /** Sim steps since the current run started. */
  step: number;
  timeScale: number;
  scenes: string[];
  dialogue: boolean;
  phase?: string;
  roomId?: string;
  wave?: { n: number; queued: number; pending: number };
  score?: number;
  player?: {
    x: number; y: number; vx: number; vy: number;
    hp: number; maxHp: number; gold: number; dead: boolean;
    /**
     * Permanent unlocks she owns, in registration order. Omitted while
     * she owns none, so a run that never touches a boss verb hashes
     * exactly as it did before verbs existed — which is what keeps
     * recordings made before them valid regression tests.
     */
    earned?: string[];
  };
  /** Geometry this run has changed (see PlayScene.replayState). Omitted at zero. */
  patches?: number;
  monsters: { type: string; x: number; y: number; hp: number }[];
  pickups: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

export type HitstopRecording = Recording<Action, RunStart>;

export function attachHarness(game: ActionGame): void {
  const replay = new Replay<Action, RunStart, GameEvents>(game, BOOT, {
    actions: ACTIONS,

    state: (): HarnessState => {
      const out: HarnessState = {
        step: replay.relStep(),
        timeScale: game.loop.timeScale,
        scenes: game.scenes.all().map((s) => s.constructor.name),
        dialogue: game.scenes.top instanceof DialogueScene,
        monsters: [],
        pickups: 0,
      };
      const play = game.scenes.all().find((s): s is PlayScene => s instanceof PlayScene);
      if (play) {
        const p = play.replayState();
        out.phase = p.phase;
        out.roomId = p.roomId;
        out.score = p.score;
        out.wave = p.wave;
        if (p.patches) out.patches = p.patches;
      }
      for (const e of game.world.all()) {
        if (e instanceof Player) {
          const earned = e.earned.list();
          out.player = {
            x: r2(e.x), y: r2(e.y), vx: r2(e.vx), vy: r2(e.vy),
            hp: e.hp, maxHp: e.maxHp, gold: e.gold, dead: e.dead,
            ...(earned.length ? { earned } : {}),
          };
        } else if (e instanceof Monster) {
          out.monsters.push({ type: e.type, x: r2(e.x), y: r2(e.y), hp: e.hp });
        } else if (e instanceof Pickup) {
          out.pickups++;
        }
      }
      return out;
    },

    beginRun: (start) => {
      const play = game.scenes.all().find((s): s is PlayScene => s instanceof PlayScene);
      if (!play) throw new Error('no play scene to start a replay in');
      play.beginRun(start);
    },

    // Network play can't replay — flag co-op sessions.
    taint: () =>
      game.scenes.all().some((s) => s.constructor.name.startsWith('Coop')) ? 'coop' : undefined,
  });

  game.events.on('runStart', (start) => replay.runStarted(start));
  replay.install();
  attachObserver(game);
}

/**
 * What an agent needs to DECIDE, which is not what a replay needs to hash.
 *
 * `state()` above is the divergence hash: every field in it is compared
 * bit-for-bit across 23 recordings, so adding to it invalidates all of
 * them and couples "what a player can perceive" to "what determinism
 * asserts". Those are different jobs, and this is the other one — free
 * to grow, hashed by nobody.
 *
 * What it adds over `state()`, and why each was needed. An agent driving
 * on positions alone died on wave 3 of the arena, hurt twelve times, TEN
 * of them by bats:
 *
 *   - VELOCITY. A bat's x/y cannot distinguish one diving at you from one
 *     leaving. Without it there is no such thing as dodging, only
 *     flinching after the fact.
 *   - REACH AND READINESS. `attackReady` and the weapon's range turn
 *     "am I close" into "can I hit it from here, right now" — the
 *     difference between trading blows and not being touched.
 *   - INVULNERABILITY. i-frames are the one window where contact is free;
 *     an agent that cannot see them either wastes them or fears nothing.
 *   - SHOTS IN FLIGHT. Arrows and bullets were entirely invisible. Wave 4
 *     brings archers and wave 5 gunners, so an agent could not have
 *     avoided them even in principle.
 */
function attachObserver(game: ActionGame): void {
  const round = (v: number): number => Math.round(v * 100) / 100;
  // Stable per-body ids. Two slimes at the same distance are the same
  // JSON, so without this an agent taking turns cannot tell whether the
  // thing in front of it is the one it just hit or its twin, and cannot
  // hold any belief about a monster across a turn boundary.
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  const idOf = (o: object): number => {
    let n = ids.get(o);
    if (n === undefined) { n = nextId++; ids.set(o, n); }
    return n;
  };
  window.__observe = () => {
    const play = game.scenes.all().find((s): s is PlayScene => s instanceof PlayScene);
    const p = game.world.all().find((e): e is Player => e instanceof Player && e.isLocal);
    // THE SCREEN, before the world. A scene on top of play freezes the
    // sim and takes the controls, and an observation that describes only
    // monsters says nothing at all about the one thing in the way. An
    // agent stalled 36,000 frames in front of an "Equip this?" panel it
    // could not see, pressing nothing, a wave and a half from winning.
    // Reported even when there is no player, because "the world is gone
    // and a menu is up" is the case that most needs saying.
    const top = game.scenes.top;
    const ui = {
      top: top?.constructor.name ?? null,
      // Anything above PlayScene has the keyboard; movement is wasted.
      blocking: !!top && !(top instanceof PlayScene),
      ...((top as Partial<AgentReadable> | undefined)?.describe?.() ?? {}),
    };
    if (!play || !p) return { ui, player: null, monsters: [], shots: [] };
    // What "in range" means for THIS loadout and THIS point in the combo.
    // Asking the planned attack rather than assuming: forward hitboxes
    // run 14px unarmed to 36px on a great-sword finisher, so a constant
    // tuned around one weapon makes an agent swing at air with a short
    // one and close to contact range with a long one.
    // A ranged arm has no melee swing at all, and reporting a borrowed
    // number for it would be worse than reporting none: the agent would
    // walk into contact range to use a reach it does not have.
    const planned = p.plannedAttack();
    const boxes = planned.def
      ? [p.hitboxFor(planned.def, 1), p.hitboxFor(planned.def, -1)]
      : [];
    // Reach from her centre to the far edge — she may turn to face a
    // target, so take whichever side reaches further.
    const reach = boxes.length
      ? Math.max(...boxes.flatMap((b) => [Math.abs(b.x + b.w - p.cx), Math.abs(p.cx - b.x)]))
      : 0;
    /**
     * Would a swing STARTED NOW land on this body?
     *
     * The harness answers it rather than shipping the geometry for an
     * agent to redo, because the honest version is not a distance test.
     * The blade does not exist at the moment of the press: it appears
     * during `active`, a normalized slice of the commit, by which time a
     * bat doing 80px/s has moved most of a body length. So lead the
     * target to the middle of that window and test the real hitbox.
     */
    const willLand = (m: Monster): boolean => {
      if (!planned.def) return false;
      const [a, b] = planned.def.active;
      const t = ((a + b) / 2) * planned.def.duration;
      const mx = m.x + m.vx * t;
      const my = m.y + m.vy * t;
      return boxes.some((box) =>
        mx < box.x + box.w && mx + m.w > box.x && my < box.y + box.h && my + m.h > box.y);
    };
    /** Clear air between her box and its, in px. <= 0 means touching. */
    const gapTo = (m: Monster): number => Math.max(
      Math.abs(m.cx - p.cx) - (p.w + m.w) / 2,
      Math.abs(m.cy - p.cy) - (p.h + m.h) / 2,
    );
    // How much detail a thing has earned. Beyond the screen she cannot
    // see it and cannot be hurt by it this second; all that matters is
    // that it exists and which way it lies.
    const NEAR = 200;
    return {
      ui,
      player: {
        w: p.w, h: p.h,
        vx: round(p.vx), vy: round(p.vy),
        hp: p.hp, maxHp: p.maxHp,
        facing: p.facing,
        onGround: p.onGround,
        state: p.fsm.state,
        // Free hits: contact costs nothing while these are burning.
        invulnT: round(p.invulnT),
        // Swinging is only possible outside a commit; this is the
        // difference between "attack" doing something and being eaten.
        attackReady: !p.fsm.is('attack', 'dead', 'dash', 'swallowed', 'shockwave'),
        // Seconds until the controls come back.  says
        // she is committed but not for how much longer, and that is the
        // whole question mid-commit — the sample policy had to keep its
        // OWN frame counter to answer it, which is the tell that a field
        // is missing: the game already knows this number.
        busyT: round(p.fsm.is('attack') ? Math.max(0, p.attackDur - p.fsm.t)
          : p.fsm.is('dash') ? Math.max(0, PLAYER_TUNING.dashTime - p.fsm.t)
          : 0),
        reach,
        // How long the NEXT swing will take the controls away. Attacking
        // is the only voluntary way to become unable to dodge, so an
        // agent that cannot see the length of that window keeps swinging
        // at things that arrive during it — safe at the instant it
        // decided, hit a fifth of a second later. Read from the planned
        // attack, not the last one: `attackDur` is 0 until she has swung
        // once, and every combo step has its own length.
        commitT: round(planned.def?.duration ?? 0),
        // What a JUMP does, because an agent cannot choose a move whose
        // outcome it cannot predict. Everything else here describes the
        // horizontal world, so a hand-written policy considers only left,
        // right and stand — and never leaves the floor except by reflex.
        // With a launch speed and a gravity it can price the arc: how
        // high, how long, and where the threats will be when it lands.
        jump: { speed: PLAYER_TUNING.jumpSpeed, gravity: GRAVITY },
        // THE DASH, which is not a movement option — it is an immunity.
        // Contact damage skips her entirely while the dash state runs
        // (see Player: the contact loop excludes fsm 'dash'), and it
        // hands over i-frames on landing, so a dash is ~0.36s during
        // which nothing can touch her, covering ~48px, every 0.45s.
        // Against a game whose damage is overwhelmingly contact, that is
        // the strongest defensive verb she owns, and an agent told only
        // that an action named 'dash' exists has no way to discover any
        // of it. The numbers are what make it schedulable.
        dash: {
          ready: p.dashReady,
          speed: PLAYER_TUNING.dashSpeed,
          time: PLAYER_TUNING.dashTime,
          cooldown: PLAYER_TUNING.dashCooldown,
          // Seconds of total immunity: the pass-through plus the
          // i-frames it leaves behind.
          invuln: round(PLAYER_TUNING.dashTime + PLAYER_TUNING.dashInvuln),
        },
        noise: round(p.noise),
      },
      // Deliberately terse, and deliberately RELATIVE.
      //
      // The first version of this shipped sixteen fields per monster
      // including absolute world coordinates, `dist` next to `inReach`
      // next to `dx`/`dy`, and `maxHp` — most of it either redundant or
      // something no decision reads. Absolute position is the clearest
      // example: nothing an agent decides depends on where the room's
      // origin is, only on where things are relative to HER.
      //
      // Detail is also earned by proximity. Something off screen cannot
      // touch her this second, so it gets a name and a bearing; the
      // things that can hurt her get everything. `w`/`h` survive the cut
      // for those, because contact is a box overlap and predicting one
      // needs the box.
      monsters: game.world.all().filter((e): e is Monster => e instanceof Monster && !e.dead).map((m) => {
        const dx = Math.round(m.cx - p.cx);
        const dy = Math.round(m.cy - p.cy);
        const gap = Math.round(gapTo(m));
        // Distance is not the same as safety. A far slime is a rumour; a
        // far archer is a threat RIGHT NOW, and the trimmed payload made
        // them look identical — a name and a bearing each. So the two
        // things that make range dangerous always survive the cut: that
        // it can reach you without touching you, and that it is winding
        // up to. The archer's draw is a real telegraph the artwork
        // already shows ("when the bow comes up, move").
        const aiming = typeof m.state.mode === 'string' ? m.state.mode : undefined;
        const shoots = m.def.rangedAt && gap < m.def.rangedAt ? true : undefined;
        if (gap > NEAR) {
          return {
            id: idOf(m), type: m.type, dx, distance: 'far' as const,
            ...(shoots ? { shoots: true } : {}),
            ...(aiming ? { mode: aiming } : {}),
          };
        }
        return {
          id: idOf(m),
          type: m.type,
          dx, dy, gap,
          w: m.w, h: m.h,
          vx: Math.round(m.vx), vy: Math.round(m.vy),
          facing: m.facing,
          // The verdict, not the trigonometry: 'inReach' means a swing
          // started this frame connects, hitbox and timing included.
          distance: willLand(m) ? ('inReach' as const) : ('near' as const),
          dmg: m.def.noContactDamage ? 0 : m.def.damage,
          ...(shoots ? { shoots: true } : {}),
          // Omitted unless true / unless hurt: absent is the common case
          // and costs nothing to send.
          ...(m.flies ? { flies: true } : {}),
          ...(m.hp < m.maxHp ? { hp: m.hp } : {}),
          // What it is currently doing, in its own words. Behaviours name
          // their phases ('aim', 'creep', 'lunge'…), and that name is the
          // telegraph the artwork is already showing the human player.
          ...(aiming ? { mode: aiming } : {}),
        };
      }),
      // HOSTILE shots only. Her own bow and flintlock rounds, and any
      // projectile she has parried back, are live Projectiles heading
      // away from her — an observation that lumps them in makes an agent
      // dive away from its own arrows.
      // And only the ones actually coming at her: a shot that is not
      // closing is scenery, and reporting scenery every frame is how a
      // payload doubles for nothing.
      shots: game.world.all().filter((e): e is Projectile =>
        e instanceof Projectile && !e.dead && e.targetTeam === 'player'
        && (e.x - p.cx) * e.vx + (e.y - p.cy) * e.vy < 0).map((s) => ({
        dx: Math.round(s.x - p.cx), dy: Math.round(s.y - p.cy),
        vx: Math.round(s.vx), vy: Math.round(s.vy),
      })),
      // Where there is room to GO. An agent that can see monsters but not
      // the floor retreats into walls and off ledges — it backs away from
      // the thing chasing it and finds the corner with its shoulders. The
      // numbers are the two decisions actually being made: how far can I
      // walk that way, and is there still ground under it.
      space: room(p),
      // WHAT SHE CAN DO. Perception without a move list is half a
      // decision: an agent told only where things are will walk and swing
      // forever, never dashing past a brute or spending a spell, because
      // nothing ever told it those existed. Costs and readiness ride
      // along, so "can I" is answerable without guessing.
      abilities: {
        actions: ACTIONS,
        verbs: p.earned.list(),
        mp: p.mp,
        maxMp: p.maxMp,
        skills: p.skills.known.map((id) => ({
          id,
          ready: p.skills.ready(id),
          cost: skillDef(id).cost ?? 0,
        })),
        weapon: p.equipment.slots().find(([slot]) => slot === 'weapon')?.[1] ?? null,
      },
      wave: play.replayState().wave,
    };
  };
}

/**
 * Walking room to each side, in pixels, and whether the floor continues.
 *
 * Deliberately two short rays rather than a tile dump: the policy needs
 * "can I back up 40px to the left" answered, not a map to interpret. A
 * view is already available via the bridge's `look` for the times the
 * shape of the room genuinely matters.
 */
function room(p: Player): {
  left: number; right: number; ledgeLeft: boolean; ledgeRight: boolean; below: number;
} {
  // The collision source the sim itself moves her against — no need to
  // reach past PlayScene for a second opinion about the same room.
  //
  // Ask the tilemap for its SOLIDS rather than reading raw tile ids. Two
  // things are invisible to a `tileAt` lookup and both produce confident
  // nonsense: moving platforms and closed barriers live in `extraSolids`
  // and are not tiles at all, and one-way geometry is not "not solid" —
  // it is floor. Treating it as a hole reported a ledge on both sides of
  // a knight standing on a platform, and a policy that will not step off
  // a ledge then refuses to move at all.
  const map = p.collision as Tilemap;
  const hits = (x: number, y: number, floor: boolean): boolean => {
    const probe = { x: x - 0.5, y: y - 0.5, w: 1, h: 1 };
    for (const s of map.solidsNear(probe)) {
      // One-way tiles block a fall but not a walk: they count as ground
      // underfoot and as open air at body height.
      if (s.oneWay && !floor) continue;
      if (probe.x < s.x + s.w && probe.x + probe.w > s.x
        && probe.y < s.y + s.h && probe.y + probe.h > s.y) return true;
    }
    return false;
  };
  const solidAt = (x: number, y: number): boolean => hits(x, y, false);
  const groundAt = (x: number, y: number): boolean => hits(x, y, true);
  // Find the FLOOR before describing it, because her feet are not always
  // on it. The lateral rays used to probe just under her feet, which is
  // right while standing and nonsense while falling: at spawn, 20px above
  // open arena floor, this reported left 0, right 0, ledge both ways —
  // read plainly, "you are on a pillar with drops either side", when the
  // room was clear in every direction. An agent that believes it cannot
  // move is worse off than one that cannot see.
  let below = 0;
  for (; below <= 160; below += 2) {
    if (groundAt(p.x + p.w / 2, p.y + p.h + 2 + below)) break;
  }
  below = Math.min(below, 160);
  // The height the floor sits at: hers when grounded, the landing floor
  // when not. Everything below is measured against this.
  const floorY = p.y + p.h + below;

  const scan = (dir: -1 | 1): { room: number; ledge: boolean } => {
    const edge = dir < 0 ? p.x : p.x + p.w;
    for (let d = 2; d <= 96; d += 2) {
      const x = edge + dir * d;
      // A wall at head or knee height stops the retreat.
      if (solidAt(x, p.y + 4) || solidAt(x, p.y + p.h - 4)) return { room: d - 2, ledge: false };
      // So does a hole: walking off is a fall, not an escape.
      if (!groundAt(x, floorY + 2)) return { room: d - 2, ledge: true };
    }
    return { room: 96, ledge: false };
  };
  const l = scan(-1);
  const r = scan(1);
  return { left: l.room, right: r.room, ledgeLeft: l.ledge, ledgeRight: r.ledge, below };
}
