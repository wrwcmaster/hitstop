/**
 * Deterministic record/replay — every RUN of the game, human or agent,
 * becomes a replayable tape.
 *
 * Why runs reproduce: the sim advances in exact 1/60s steps
 * (`Game.steps`), gameplay randomness draws from the seeded engine
 * stream (visual noise stays on `Math.random` and can't touch the sim),
 * and the only door into the sim is an `Input` action edge or tap. So a
 * run is fully described by (run seed, the `hitstop.*` storage it
 * started from, how it started, the step-tagged input tape) — which is
 * exactly what a recording is.
 *
 * Per-run: every run start funnels through PlayScene.beginRun, which
 * emits `runStart`. The recorder reseeds the gameplay RNG and cuts a
 * fresh tape there, so a recording is one run, menu noise excluded.
 *
 * Three page modes:
 * - normal play: recorder on; pause menu SAVE REPLAY / `__replay.save()`
 *   downloads the current run's tape.
 * - `?harness=1&seed=N`: loop stopped; `window.__harness` gives agents
 *   and the Node verifier stepped time control (`step`, `replayRun`,
 *   `runTo`, `hashNow`) through `Loop.advance` — hitstop-faithful.
 * - replay viewing (a pending tape in sessionStorage, set by the title's
 *   WATCH REPLAY): storage is sandboxed in memory, device input is
 *   muted, the tape drives the run in real time with an overlay HUD.
 *
 * This file must stay the FIRST import in main.ts: seeding and the
 * storage sandbox must land before any other module reads either.
 */
import {
  STEP,
  DialogueScene,
  seedRandom,
  sandboxStorage,
  snapshotStorage,
  drawText,
  type Scene,
  type RawInputEvent,
} from '@engine/index';
import type { ActionGame, Action, RunStart } from '../defs';
import { Player } from '../actors/player';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

/** Whether stepped (agent/verifier) mode is on for this page load. */
export const HARNESS = params.get('harness') === '1';

const PENDING_KEY = 'hitstop.replay.pending';

/** A taped input event: [step, 'd'|'u', action] or [step, 't', x, y]. Steps are relative to run start. */
export type TapeEvent = [number, 'd', Action] | [number, 'u', Action] | [number, 't', number, number];

export interface Recording {
  v: 3;
  /** The run's gameplay-RNG seed (reseeded at every run start). */
  seed: number;
  mode: 'live' | 'harness';
  created: string;
  /** How the run began — replays start it the same way. */
  start: RunStart;
  /** hitstop.* storage at run start — the save/settings the run used. */
  storage: Record<string, string>;
  tape: TapeEvent[];
  /** [relative step, state hash] once per second (+ final at save time). */
  checks: [number, number][];
  /** Total steps the recording covers, relative to run start. */
  end: number;
  /** Co-op touched the session — network play can't replay. */
  tainted?: string;
}

/** The recording a WATCH REPLAY reload should play, if any. */
const pendingReplay: Recording | null = (() => {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY); // one shot — a crash must not loop
    const rec = JSON.parse(raw) as Recording;
    return rec?.v === 3 ? rec : null;
  } catch {
    return null;
  }
})();

/** Whether this page load is watching a replay. */
export const VIEWING = pendingReplay !== null;

/** This page's boot seed (?seed= or random). Runs reseed on top of this. */
export const SEED =
  (Number(params.get('seed') ?? NaN) >>> 0) ||
  ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) ||
  1;

// Before ANY other module evaluates: sandbox storage for viewing (the
// player's real saves stay untouched) and seed the gameplay stream.
if (VIEWING) sandboxStorage(pendingReplay!.storage ?? {});
seedRandom(VIEWING ? pendingReplay!.seed : SEED);

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

/** djb2 over a string — cheap, stable across runs, plenty for divergence checks. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

const newSeed = (): number => ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;

/** Runtime view of PlayScene without importing it (avoids an import cycle). */
interface PlayLike {
  phase: string;
  roomId: string;
  score: number;
  waves: { wave: number; queue: unknown[]; pending: unknown[] };
  beginRun(start: RunStart): void;
}

function sceneStack(game: ActionGame): Scene[] {
  return (game.scenes as unknown as { stack: Scene[] }).stack;
}

function findPlay(game: ActionGame): PlayLike | undefined {
  return sceneStack(game).find((s) => 'phase' in s && 'waves' in s) as PlayLike | undefined;
}

export function attachHarness(game: ActionGame): void {
  /* ---------------- recorder: one tape per run, always on ---------------- */
  interface Run {
    seed: number;
    start: RunStart;
    storage: Record<string, string>;
    tape: TapeEvent[];
    checks: [number, number][];
    offset: number;
  }
  let run: Run | null = null;
  let runCount = 0;
  let tainted: string | undefined;

  const relStep = (): number => game.steps - (run?.offset ?? 0);

  const stateOf = (): HarnessState => {
    const stack = sceneStack(game);
    const out: HarnessState = {
      step: relStep(),
      timeScale: game.loop.timeScale,
      scenes: stack.map((s) => s.constructor.name),
      dialogue: game.scenes.top instanceof DialogueScene,
      monsters: [],
      pickups: 0,
    };
    const play = findPlay(game);
    if (play) {
      out.phase = play.phase;
      out.roomId = play.roomId;
      out.score = play.score;
      out.wave = { n: play.waves.wave, queued: play.waves.queue.length, pending: play.waves.pending.length };
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
  };
  const hashNow = (): number => hash(JSON.stringify(stateOf()));

  game.events.on('runStart', (start) => {
    // A fresh stream per run: derived from the URL seed in harness mode
    // (agents get same-seed reproducibility), random for humans.
    const seed = HARNESS ? (((SEED + 0x9e3779b9 * ++runCount) >>> 0) || 1) : newSeed();
    seedRandom(seed);
    run = { seed, start, storage: snapshotStorage('hitstop'), tape: [], checks: [], offset: game.steps };
  });

  game.input.onRaw((ev: RawInputEvent<Action>) => {
    if (!run) return;
    const s = relStep();
    if (ev.t === 'tap') run.tape.push([s, 't', r2(ev.x), r2(ev.y)]);
    else if (ev.t === 'down') run.tape.push([s, 'd', ev.a]);
    else run.tape.push([s, 'u', ev.a]);
  });

  game.onStep(() => {
    if (!run) return;
    const s = relStep();
    if (s > 0 && s % 60 === 0) {
      run.checks.push([s, hashNow()]);
      if (!tainted && sceneStack(game).some((sc) => sc.constructor.name.startsWith('Coop'))) tainted = 'coop';
    }
  });

  const created = new Date().toISOString();
  const recording = (): Recording | null => {
    if (!run) return null;
    const checks = [...run.checks];
    const end = relStep();
    if (!checks.length || checks[checks.length - 1][0] !== end) checks.push([end, hashNow()]);
    return {
      v: 3, seed: run.seed, mode: HARNESS ? 'harness' : 'live', created,
      start: run.start, storage: run.storage, tape: [...run.tape], checks, end,
      ...(tainted && { tainted }),
    };
  };

  window.__replay = {
    recording,
    save(name?: string): string | null {
      const rec = recording();
      if (!rec) return null;
      const file = `${name ?? `hitstop-run-${rec.seed}-${Date.now()}`}.json`;
      const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file;
      a.click();
      URL.revokeObjectURL(a.href);
      return file;
    },
  };

  /* ---------------- shared playback: feed a tape on exact steps ---------------- */
  let playback: { rec: Recording; offset: number; cursor: number; armed: boolean } | null = null;

  const applyTapeEvent = (ev: TapeEvent): void => {
    if (ev[1] === 'd') game.input.press(ev[2]);
    else if (ev[1] === 'u') game.input.release(ev[2]);
    else game.input.notifyTap(ev[2], ev[3]);
  };

  /** Apply every due event: tag T fires when the sim clock reaches run-relative T. */
  const applyDue = (): void => {
    const p = playback;
    if (!p || !p.armed) return;
    while (p.cursor < p.rec.tape.length && p.offset + p.rec.tape[p.cursor][0] <= game.steps) {
      applyTapeEvent(p.rec.tape[p.cursor++]);
    }
  };

  /**
   * Start playing `rec`: begins the run the recorded way (the recorder's
   * runStart listener fires first and reseeds junk; ours runs after and
   * pins the recording's seed — both before the starter draws RNG).
   */
  const startPlayback = (rec: Recording): void => {
    playback = { rec, offset: 0, cursor: 0, armed: false };
    const off = game.events.on('runStart', () => {
      off();
      seedRandom(rec.seed);
      playback!.offset = game.steps;
      playback!.armed = true;
    });
    const play = findPlay(game);
    if (!play) throw new Error('no play scene to start a replay in');
    play.beginRun(rec.start);
  };

  /* ---------------- stepped mode: agents + the Node verifier ---------------- */
  if (HARNESS) {
    game.loop.stop();

    const held = new Set<Action>();
    const step = (down: Action[] = [], frames = 1): HarnessState => {
      for (const a of down) if (!held.has(a)) { game.input.press(a); held.add(a); }
      for (const a of [...held]) if (!down.includes(a)) { game.input.release(a); held.delete(a); }
      const n = Math.max(1, Math.min(3600, Math.floor(frames)));
      for (let i = 0; i < n; i++) game.loop.advance(STEP);
      return stateOf();
    };

    /** Advance until the run-relative sim clock reaches `target`. */
    const runTo = (target: number): HarnessState => {
      const base = playback?.armed ? playback.offset : (run?.offset ?? 0);
      let spins = 0;
      const cap = (base + target - game.steps) * 4 + 600; // freeze is bounded; runaway = bug
      while (game.steps < base + target) {
        applyDue();
        game.loop.advance(STEP);
        if (++spins > cap) throw new Error(`runTo(${target}) stalled at step ${game.steps - base}`);
      }
      return stateOf();
    };

    window.__harness = {
      seed: SEED,
      actions: [
        'left', 'right', 'up', 'down', 'jump', 'attack', 'dash',
        'skill', 'skill2', 'skill3', 'parry', 'interact', 'confirm', 'cancel', 'menu',
      ] satisfies Action[],
      step,
      state: stateOf,
      hashNow,
      replayRun: (rec: Recording) => {
        startPlayback(rec);
        return stateOf();
      },
      runTo,
      recording,
    };
    return;
  }

  /* ---------------- viewing mode: watch a tape in real time ---------------- */
  if (VIEWING) {
    const rec = pendingReplay!;

    // Mute every device: keyboard/touch/gamepad all land in these three
    // methods, and only the tape may drive the sim while a replay plays.
    const rawPress = game.input.press.bind(game.input);
    const rawRelease = game.input.release.bind(game.input);
    const rawTap = game.input.notifyTap.bind(game.input);
    let applying = false;
    game.input.press = (a) => { if (applying) rawPress(a); };
    game.input.release = (a) => { if (applying) rawRelease(a); };
    game.input.notifyTap = (x, y) => { if (applying) rawTap(x, y); };

    let started = false;
    let ended = false;
    let diverged = 0;
    let checkAt = 0;

    game.onStep((step) => {
      // Let boot settle a few steps, then start the run exactly as recorded.
      if (!started && step >= 5) {
        started = true;
        // Replays of a run that itself started another run (loaded a save
        // mid-run) end at that boundary — treat a second runStart as the end.
        game.events.on('runStart', () => { if (playback?.armed) ended = true; });
        startPlayback(rec);
        return;
      }
      const p = playback;
      if (!p || !p.armed || ended) return;
      applying = true;
      applyDue();
      applying = false;
      const rel = game.steps - p.offset;
      while (checkAt < rec.checks.length && rec.checks[checkAt][0] <= rel) {
        const [at, expected] = rec.checks[checkAt++];
        if (at === rel && hashNow() !== expected && !diverged) diverged = rel;
      }
      if (rel >= rec.end) ended = true;
    });

    game.onOverlay((g) => {
      // Slim player-chrome along the bottom edge (the HUD owns the top,
      // and the dialogue box stops just short of here).
      const w = game.width;
      const h = game.height;
      const p = playback;
      const rel = p?.armed ? Math.min(game.steps - p.offset, rec.end) : 0;
      const pct = rec.end ? Math.floor((rel / rec.end) * 100) : 0;
      g.fillStyle = 'rgba(7,7,13,0.85)';
      g.fillRect(0, h - 12, w, 12);
      g.fillStyle = '#2c3644';
      g.fillRect(0, h - 12, w, 1);
      g.fillStyle = ended ? '#e8c170' : '#8fb8de';
      g.fillRect(0, h - 12, rec.end ? (rel / rec.end) * w : 0, 1);
      drawText(g, ended ? (diverged ? 'REPLAY ENDED - DIVERGED' : 'REPLAY ENDED') : `REPLAY ${pct}%`, 6, h - 9, ended ? '#e8c170' : '#8fb8de', 1);
      if (diverged) drawText(g, `DIVERGED AT ${(diverged / 60).toFixed(1)}s (older build?)`, w / 2, h - 9, '#e05f5f', 1, 'center');
      drawText(g, ended ? 'ESC OR TAP: EXIT' : 'ESC: EXIT', w - 6, h - 9, '#8b93a2', 1, 'right');
    });

    const exit = (): void => {
      location.href = location.pathname; // clean boot; pending key already cleared
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') exit();
    });
    // Touch has no Escape: once the replay ends, any tap leaves.
    window.addEventListener('pointerdown', () => {
      if (ended) exit();
    });
  }
}

/**
 * The title's WATCH REPLAY entry: pick a recording file, stash it for
 * the next boot, reload into viewing mode.
 */
export function pickReplayFile(): void {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const rec = JSON.parse(text) as Recording;
      if (rec?.v !== 3) throw new Error('bad version');
      sessionStorage.setItem(PENDING_KEY, text);
      location.reload();
    } catch {
      alert('Not a hitstop replay file (v3) — save one from the pause menu.');
    }
  };
  inp.click();
}

declare global {
  interface Window {
    __replay?: {
      recording(): Recording | null;
      save(name?: string): string | null;
    };
    __harness?: {
      seed: number;
      actions: readonly Action[];
      step(down?: Action[], frames?: number): HarnessState;
      state(): HarnessState;
      hashNow(): number;
      replayRun(rec: Recording): HarnessState;
      runTo(target: number): HarnessState;
      recording(): Recording | null;
    };
  }
}
