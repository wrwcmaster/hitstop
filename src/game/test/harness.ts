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
import { Replay, bootReplay, DialogueScene, Projectile, skillDef, type Tilemap, type Recording } from '@engine/index';
import { STORAGE_PREFIX, REPLAY_PENDING_KEY, type ActionGame, type Action, type RunStart, type GameEvents } from '../defs';
import { Player } from '../actors/player';
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
    /** Would the planned swing actually cover this body, facing either way? */
    const covers = (m: Monster): boolean =>
      boxes.some((b) =>
        m.x < b.x + b.w && m.x + m.w > b.x && m.y < b.y + b.h && m.y + m.h > b.y);
    return {
      ui,
      player: {
        x: round(p.x), y: round(p.y), w: p.w, h: p.h,
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
        reach,
        // How long the NEXT swing will take the controls away. Attacking
        // is the only voluntary way to become unable to dodge, so an
        // agent that cannot see the length of that window keeps swinging
        // at things that arrive during it — safe at the instant it
        // decided, hit a fifth of a second later. Read from the planned
        // attack, not the last one: `attackDur` is 0 until she has swung
        // once, and every combo step has its own length.
        commitT: round(planned.def?.duration ?? 0),
        // The swing itself: where the blade will be, and WHEN it is live.
        //
        // `inReach` answers "could I hit it this instant", which is the
        // wrong question for a moving target — the hitbox does not exist
        // at the moment of the press. It appears for `active` (normalized
        // start/end of the commit) and the target has moved by then. An
        // agent given only the instantaneous answer either swings at a
        // bat that has flown off, or refuses one that is about to arrive.
        // Both boxes ride along because she can turn to face either way.
        swing: planned.def
          ? {
            boxes: boxes.map((b) => ({ x: round(b.x), y: round(b.y), w: b.w, h: b.h })),
            active: planned.def.active,
          }
          : null,
        noise: round(p.noise),
      },
      monsters: game.world.all().filter((e): e is Monster => e instanceof Monster && !e.dead).map((m) => ({
        type: m.type, x: round(m.x), y: round(m.y), w: m.w, h: m.h,
        vx: round(m.vx), vy: round(m.vy),
        hp: m.hp, maxHp: m.maxHp,
        facing: m.facing,
        flies: m.flies,
        // What it is currently doing, in its own words. Behaviours name
        // their phases ('creep', 'wind', 'lunge'…), and that name is the
        // telegraph the artwork is already showing the human player. A
        // string is enough: an agent can learn which ones hurt without
        // this file having to decide for it.
        ...(typeof m.state.mode === 'string' ? { mode: m.state.mode } : {}),
        contactDamage: m.def.noContactDamage ? 0 : m.def.damage,
        // Signed gaps: an agent should not have to redo this trigonometry
        // every turn, and getting the sign wrong is a whole class of bug.
        dx: round(m.cx - p.cx), dy: round(m.cy - p.cy),
        dist: round(Math.hypot(m.cx - p.cx, m.cy - p.cy)),
        // The real hitbox overlap, not a radius: a plunge covers the
        // ground and an anti-air covers her head, and neither is a circle.
        inReach: covers(m),
      })),
      // HOSTILE shots only. Her own bow and flintlock rounds, and any
      // projectile she has parried back, are live Projectiles heading
      // away from her — an observation that lumps them in makes an agent
      // dive away from its own arrows.
      shots: game.world.all().filter((e): e is Projectile =>
        e instanceof Projectile && !e.dead && e.targetTeam === 'player').map((s) => ({
        x: round(s.x), y: round(s.y), vx: round(s.vx), vy: round(s.vy),
        dx: round(s.x - p.cx), dy: round(s.y - p.cy),
        dist: round(Math.hypot(s.x - p.cx, s.y - p.cy)),
        // Only a shot that is CLOSING matters; the rest are scenery.
        closing: (s.x - p.cx) * s.vx + (s.y - p.cy) * s.vy < 0,
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
  left: number; right: number; ledgeLeft: boolean; ledgeRight: boolean;
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
  const scan = (dir: -1 | 1): { room: number; ledge: boolean } => {
    const edge = dir < 0 ? p.x : p.x + p.w;
    for (let d = 2; d <= 96; d += 2) {
      const x = edge + dir * d;
      // A wall at head or knee height stops the retreat.
      if (solidAt(x, p.y + 4) || solidAt(x, p.y + p.h - 4)) return { room: d - 2, ledge: false };
      // So does a hole: walking off is a fall, not an escape.
      if (!groundAt(x, p.y + p.h + 2)) return { room: d - 2, ledge: true };
    }
    return { room: 96, ledge: false };
  };
  const l = scan(-1);
  const r = scan(1);
  return { left: l.room, right: r.room, ledgeLeft: l.ledge, ledgeRight: r.ledge };
}
