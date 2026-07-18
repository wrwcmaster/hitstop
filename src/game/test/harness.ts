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
import { Replay, bootReplay, DialogueScene, type Recording } from '@engine/index';
import { STORAGE_PREFIX, REPLAY_PENDING_KEY, type ActionGame, type Action, type RunStart, type GameEvents } from '../defs';
import { Player } from '../actors/player';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { PlayScene } from '../scenes/play';

export const BOOT = bootReplay({ storagePrefix: STORAGE_PREFIX, pendingKey: REPLAY_PENDING_KEY });

/** Every action an agent may drive (mirrors defs.ts). */
const ACTIONS = [
  'left', 'right', 'up', 'down', 'jump', 'attack', 'dash',
  'skill', 'skill2', 'skill3', 'parry', 'interact', 'confirm', 'cancel', 'menu',
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
  };
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
      }
      for (const e of game.world.all()) {
        if (e instanceof Player) {
          out.player = {
            x: r2(e.x), y: r2(e.y), vx: r2(e.vx), vy: r2(e.vy),
            hp: e.hp, maxHp: e.maxHp, gold: e.gold, dead: e.dead,
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
}
