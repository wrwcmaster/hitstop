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
import { Replay, bootReplay, DialogueScene, GRAVITY, Projectile, skillDef, tiles, type Tilemap, type Recording } from '@engine/index';
import { STORAGE_PREFIX, REPLAY_PENDING_KEY, type ActionGame, type Action, type RunStart, type GameEvents } from '../defs';
import { Player } from '../actors/player';
import { PLAYER_TUNING } from '../actors/player-tuning';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { PlayScene } from '../scenes/play';
import { ROOMS } from '../content/rooms';
import { Shockwave } from '../actors/shockwave';

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
    /** Draw-and-measure overlay for visual claims — see attachMeasure. */
    __measure?: (opts?: MeasureOpts) => unknown;
  }
}

/** What to draw over the last rendered frame. Everything defaults on. */
export interface MeasureOpts {
  /** Outline every trigger in the room, labelled with its size. */
  zones?: boolean;
  /** Outline the player'''s hitbox, labelled with its size. */
  body?: boolean;
  /** Bracket the gap between the player and the nearest door zone. */
  gap?: boolean;
  /** A caption drawn top-left — what the picture is meant to show. */
  note?: string;
  /** Extra world rects to outline: [x, y, w, h, label?]. */
  rects?: [number, number, number, number, string?][];
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
      // timeScale is deliberately NOT here. freezeT/slowT decay by wall-
      // clock realDt, so "is slow-mo active at step N" depends on the
      // recorder's frame rate — a live tape at 59.94Hz caught the boss-
      // kill slow (0.45) still active at a checkpoint where a stepped
      // replay at exactly 60 had it expired, and the tape failed with
      // every WORLD field identical and the RNG in lockstep. A
      // determinism hash may only assert what the sim determines.
      const out: HarnessState = {
        step: replay.relStep(),
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
  attachMeasure(game);
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
  // When each knight last finished a swing, in sim steps. Observer-side
  // memory of an observable event — anyone WATCHING knows she just
  // swung; the game keeps no such field, so the observation does.
  const lastSwing = new WeakMap<object, number>();
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
        // Absolute position, restored. I cut this when trimming the
        // payload, on the reasoning that "nothing an agent decides
        // depends on where the room's origin is, only on where things
        // are relative to HER". That is true of FIGHTING and false of
        // going somewhere: a door is at a fixed spot in the room, and
        // without her own coordinates there is no way to work out which
        // way it lies. Two numbers, and navigation is impossible without
        // them.
        x: round(p.x), y: round(p.y),
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
        // Seconds since her last swing ENDED, capped at 2. Hit-and-run
        // is a cycle — strike, step out, come back — and a memoryless
        // policy cannot close a cycle unless something in its input
        // varies around it. After a swing, busyT is already 0 and every
        // other field looks like "fresh": same input, same output, so
        // the best a net could express near a wall was to stand in the
        // corner and trade. This is the phase variable the cycle needs,
        // and it is physics — the rule bot keeps the identical fact in
        // a private counter it calls recover.
        sinceSwing: (() => {
          if (p.fsm.is('attack')) { lastSwing.set(p, game.steps); return 0; }
          const at = lastSwing.get(p);
          return at === undefined ? 2 : Math.min(2, round((game.steps - at) / 60));
        })(),
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
        // A behaviour's named phase, from either place behaviours keep
        // one. Simple monsters write `state.mode` ('aim'); FSM-driven
        // ones — every boss, the brute — keep it in `state.fsm.state`
        // ('slam', 'hop', 'pounce'). The Slime King's slam has a whole
        // authored telegraph phase, and without this line the
        // observation showed position and velocity only, so an agent's
        // first hint of the attack was being under it.
        const fsmState = (m.state.fsm as { state?: string } | undefined)?.state;
        const aiming = typeof m.state.mode === 'string' ? m.state.mode
          : typeof fsmState === 'string' ? fsmState : undefined;
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
          // The telegraph as a VERDICT, not a name. `mode` is a string an
          // LLM can read but a net cannot: the encoder never carried it,
          // so "winding up to slam" and "standing idle" encoded to the
          // same vector — the knight's first learnable evidence of a slam
          // was the king already airborne. The def declares which of its
          // own states are attack telegraphs (the same way it declares
          // dmg), and this stays a plain 0/1 any policy can eat without
          // the encoder ever learning a boss's name.
          ...(aiming && m.def.telegraphs?.includes(aiming) ? { winding: true } : {}),
          // Seconds in the current behaviour state. Telegraphs and
          // recoveries have DURATIONS — "he has shivered for 0.4s of a
          // 0.55s windup" is the dodge timing itself, and "he landed
          // 0.1s ago" is the safe window to punish. One number, every
          // FSM has it, no per-boss anything.
          ...(typeof (m.state.fsm as { t?: number } | undefined)?.t === 'number'
            ? { stateAge: Math.round((m.state.fsm as { t: number }).t * 100) / 100 }
            : {}),
        };
      }),
      // HOSTILE shots only. Her own bow and flintlock rounds, and any
      // projectile she has parried back, are live Projectiles heading
      // away from her — an observation that lumps them in makes an agent
      // dive away from its own arrows.
      // And only the ones actually coming at her: a shot that is not
      // closing is scenery, and reporting scenery every frame is how a
      // payload doubles for nothing.
      // Everything incoming rides in ONE list, as physics: a position,
      // a velocity, a size. An arrow, a bullet and a ground shockwave
      // are all "a hazard that will be here soon", and a policy that
      // dodges one dodges the others without knowing any of their
      // names. The Slime King's slam was the gap that forced this: its
      // radius damage arrives as a Shockwave, which is not a Projectile,
      // so the slam's actual damage dealer was invisible — an agent
      // could watch him leap and still never see what hit her.
      shots: (([] as { dx: number; dy: number; vx: number; vy: number; w?: number; h?: number }[])
        .concat(game.world.all().filter((e): e is Shockwave =>
          e instanceof Shockwave && !e.dead && e.targetTeam === 'player')
          .flatMap((wv) => {
            const cells = wv.crestCells();
            if (!cells.length) return [];
            const [cx, cy] = cells[0];        // the front cell, world px
            const dx = cx + 4 - p.cx;
            const dy = cy + 4 - p.cy;
            const vx = wv.runDir * wv.speed;
            // Same closing test as any shot: receding waves are scenery.
            if (dx * vx >= 0 && Math.sign(dx) !== 0) return [];
            return [{ dx: Math.round(dx), dy: Math.round(dy), vx: Math.round(vx), vy: 0, w: 8, h: 8 }];
          })))
        .concat(game.world.all().filter((e): e is Projectile =>
        e instanceof Projectile && !e.dead && e.targetTeam === 'player'
        && (e.x - p.cx) * e.vx + (e.y - p.cy) * e.vy < 0).map((s) => ({
        dx: Math.round(s.x - p.cx), dy: Math.round(s.y - p.cy),
        vx: Math.round(s.vx), vy: Math.round(s.vy),
      }))),
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
      // LOCAL GEOMETRY: an 11x7 window of tile cells around her, one
      // number per cell. This is the field whose absence three results
      // agree on: the rule bot corners itself, ES flatlined at 0/10 and
      // PPO round one could not cross its own baseline, all in the one
      // room where "cornered", "platform above" and "hazard floor"
      // decide fights — and none of those is expressible in two rays
      // and a drop. Values: 1 solid, 0.5 stand-through platform, -1
      // hazard, 0 air. Moving solids (platforms, closed barriers) are
      // stamped from the tilemap's own solids so a closed gate reads as
      // the wall it is.
      tiles: tileWindow(p),
      wave: play.replayState().wave,
    };
  };
}

/** Tile-window shape, exported for the feature encoder. */
export const TILE_WIN = { w: 11, h: 7 } as const;

/** The 11x7 cell window centred on the knight (see the caller). */
function tileWindow(p: Player): number[] {
  const map = p.collision as Tilemap;
  const ts = map.tileSize;
  const cx = Math.floor((p.x + p.w / 2) / ts);
  const cy = Math.floor((p.y + p.h / 2) / ts);
  const out: number[] = [];
  for (let dy = -(TILE_WIN.h >> 1); dy <= (TILE_WIN.h >> 1); dy++) {
    for (let dx = -(TILE_WIN.w >> 1); dx <= (TILE_WIN.w >> 1); dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      // Beyond the room is a wall in every way that matters — the mover
      // will not let her leave, so "cornered against the world edge"
      // must LOOK like a corner. Encoding it as air made the one thing
      // this window exists for invisible exactly at the boundary.
      if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) { out.push(1); continue; }
      const id = map.tileAt(tx, ty);
      const d = id ? tiles.get(id) : null;
      out.push(d?.hazard ? -1 : d?.solid && !d.oneWay ? 1 : d?.oneWay ? 0.5 : 0);
    }
  }
  // Moving solids and closed barriers are not tiles; stamp them in.
  const x0 = (cx - (TILE_WIN.w >> 1)) * ts;
  const y0 = (cy - (TILE_WIN.h >> 1)) * ts;
  const win = { x: x0, y: y0, w: TILE_WIN.w * ts, h: TILE_WIN.h * ts };
  for (const sld of map.solidsNear(win)) {
    const gx0 = Math.max(0, Math.floor((sld.x - x0) / ts));
    const gy0 = Math.max(0, Math.floor((sld.y - y0) / ts));
    const gx1 = Math.min(TILE_WIN.w - 1, Math.floor((sld.x + sld.w - 1 - x0) / ts));
    const gy1 = Math.min(TILE_WIN.h - 1, Math.floor((sld.y + sld.h - 1 - y0) / ts));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * TILE_WIN.w + gx;
        if (out[i] === 0) out[i] = sld.oneWay ? 0.5 : 1;
      }
    }
  }
  return out;
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

/**
 * Draw-and-measure: an annotated overlay on the last rendered frame.
 *
 * Screenshots are how visual claims get settled — "the door zone is too
 * big", "she stops too far out" — and an eyeballed screenshot settles
 * nothing, because the thing under discussion is a distance in game
 * pixels and a screenshot is a picture of a scaled canvas. This draws
 * the rectangles the game is actually reasoning about, to scale, in the
 * frame, and RETURNS the same numbers it drew. The picture and the
 * measurement cannot disagree, because they come from one call.
 *
 * It renders over the last presented frame rather than into the render
 * loop, so it never touches what the game draws for a player and cannot
 * affect a hash. Under the stepped harness the frame stands still, which
 * is exactly when you want to measure it.
 *
 *   __measure()                                  // everything, labelled
 *   __measure({ note: 'after the crossing' })    // with a caption
 *   __measure({ zones: false, body: true })      // just the body
 *   __measure({ rects: [[8, 472, 8, 32, 'old zone']] })
 */
function attachMeasure(game: ActionGame): void {
  const RED = '#ff4040';
  const CYAN = '#40e0ff';
  const GREEN = '#7dff8a';
  const GREY = '#8a8a99';
  const GOLD = '#ffd070';

  window.__measure = (opts: MeasureOpts = {}) => {
    const { zones = true, body = true, gap = true, note, rects = [] } = opts;
    const play = game.scenes.all().find((s): s is PlayScene => s instanceof PlayScene);
    const p = game.world.all().find((e): e is Player => e instanceof Player && e.isLocal);
    // Through the public replay state and the room table — the scene's
    // own room field is private, and a measuring instrument has no
    // business prising a scene open to read it.
    const room = play ? ROOMS[play.replayState().roomId] : undefined;
    const cam = game.camera;
    const ctx = game.screen.ctx;
    const canvas = game.screen.canvas;
    // Device pixels per world pixel, derived rather than assumed: the
    // canvas may be scaled for the display and the world zoomed on top.
    const s = canvas.width / cam.viewW;
    const X = (wx: number): number => (wx - cam.x) * s;
    const Y = (wy: number): number => (wy - cam.y) * s;

    const out: Record<string, unknown> = {
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom, viewW: cam.viewW, viewH: cam.viewH },
    };

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = Math.max(2, Math.round(s / 3));
    ctx.font = `bold ${Math.round(s * 3.2)}px monospace`;
    ctx.textBaseline = 'top';
    const label = (text: string, wx: number, wy: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillText(text, X(wx) - 4, Y(wy) - s * 4.2);
    };

    if (zones && room) {
      const drawn = [];
      for (const z of room.triggers ?? []) {
        const tint = z.event === 'door' ? RED : GOLD;
        ctx.fillStyle = tint === RED ? 'rgba(255,64,64,0.2)' : 'rgba(255,208,112,0.16)';
        ctx.fillRect(X(z.x), Y(z.y), z.w * s, z.h * s);
        ctx.strokeStyle = tint;
        ctx.strokeRect(X(z.x), Y(z.y), z.w * s, z.h * s);
        const name = z.event === 'door' ? String(z.props?.room ?? 'door') : z.event;
        label(`${name.toUpperCase()} ${z.w}x${z.h}`, z.x, z.y, tint);
        drawn.push({ event: z.event, to: z.props?.room, x: z.x, y: z.y, w: z.w, h: z.h });
      }
      out.zones = drawn;
    }

    if (body && p) {
      ctx.strokeStyle = CYAN;
      ctx.strokeRect(X(p.x), Y(p.y), p.w * s, p.h * s);
      label(`BODY ${p.w}x${p.h}`, p.x, p.y, CYAN);
      out.body = { x: Math.round(p.x), y: Math.round(p.y), w: p.w, h: p.h, cx: Math.round(p.cx), cy: Math.round(p.cy) };
    }

    if (gap && p && room) {
      // The nearest door, and the honest horizontal gap to it: negative
      // means she is standing inside the zone.
      let best: { z: { x: number; y: number; w: number; h: number; props?: Record<string, unknown> }; d: number } | null = null;
      for (const z of room.triggers ?? []) {
        if (z.event !== 'door') continue;
        const d = Math.max(z.x - (p.x + p.w), p.x - (z.x + z.w));
        if (!best || d < best.d) best = { z, d };
      }
      if (best) {
        const { z, d } = best;
        const from = p.x > z.x ? z.x + z.w : z.x;
        const to = p.x > z.x ? p.x : p.x + p.w;
        const gy = p.y + p.h + 2;
        ctx.strokeStyle = GREEN;
        ctx.beginPath();
        ctx.moveTo(X(from), Y(gy)); ctx.lineTo(X(to), Y(gy));
        ctx.moveTo(X(from), Y(gy) - s); ctx.lineTo(X(from), Y(gy) + s);
        ctx.moveTo(X(to), Y(gy) - s); ctx.lineTo(X(to), Y(gy) + s);
        ctx.stroke();
        label(`${Math.round(d)} px`, Math.min(from, to), gy + 5, GREEN);
        out.gap = { toRoom: z.props?.room, px: Math.round(d) };
      }
    }

    for (const [x, y, w, h, text] of rects) {
      ctx.setLineDash([s, s]);
      ctx.strokeStyle = GREY;
      ctx.strokeRect(X(x), Y(y), w * s, h * s);
      ctx.setLineDash([]);
      if (text) label(text, x, y, GREY);
    }

    if (note) {
      ctx.fillStyle = GOLD;
      ctx.fillText(note, s * 2, s * 2);
    }
    ctx.restore();
    return out;
  };
}
