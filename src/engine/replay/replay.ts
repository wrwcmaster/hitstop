/**
 * Deterministic record/replay — the engine mechanism.
 *
 * A run of any game built on this engine is fully described by four
 * things: the run's RNG seed, the storage it started from, how it began,
 * and an input tape (every action edge/tap tagged with the exact fixed
 * step it landed on). That holds because the simulation advances in
 * fixed steps (`Game.steps`), gameplay randomness draws from the seeded
 * stream (`seedRandom` + the math helpers), and `Input` is the only door
 * into the sim. Record those four and the run replays bit-for-bit.
 *
 * The engine owns the MECHANISM: seeding, the tape recorder, playback,
 * stepped time control, the viewer chrome. The game supplies a small
 * adapter (`ReplayConfig`): what state to hash, how to begin a run, and
 * which actions exist. The engine never learns what a run *is*.
 *
 * Wiring (see the game's test/harness.ts for the reference adapter):
 *   const boot = bootReplay({ storagePrefix: 'mygame' }); // FIRST import!
 *   const replay = new Replay(game, boot, config);
 *   game.events.on('runStart', (s) => replay.runStarted(s));
 *   replay.install();
 */
import type { Game } from '../core/game';
import { STEP } from '../core/loop';
import { seedRandom } from '../math/util';
import { sandboxStorage, snapshotStorage } from '../core/storage';
import { drawText } from '../gfx/font';
import type { RawInputEvent } from '../input/input';

/** A taped input event: [step, 'd'|'u', action] or [step, 't', x, y].
 * Steps are relative to run start. */
export type TapeEvent<A extends string> =
  | [number, 'd', A]
  | [number, 'u', A]
  | [number, 't', number, number];

export interface Recording<A extends string = string, Start = unknown> {
  v: 3;
  /** The run's gameplay-RNG seed (reseeded at every run start). */
  seed: number;
  mode: 'live' | 'harness';
  created: string;
  /** How the run began — replays start it the same way. */
  start: Start;
  /** Prefixed storage at run start — the save/settings the run used. */
  storage: Record<string, string>;
  tape: TapeEvent<A>[];
  /** [relative step, state hash] once per second (+ final at save time). */
  checks: [number, number][];
  /** Total steps the recording covers, relative to run start. */
  end: number;
  /** Something non-replayable touched the session (e.g. network play). */
  tainted?: string;
}

/** What bootReplay() determined about this page load. */
export interface ReplayBoot {
  /** Stepped (agent/verifier) mode: loop stopped, __harness installed. */
  harness: boolean;
  /** A pending recording is being watched this page load. */
  viewing: boolean;
  /** The boot seed (?seed= or random; the pending recording's when viewing). */
  seed: number;
  /** The recording to watch, when viewing. */
  pending: Recording | null;
  /** sessionStorage key used to hand a recording across the reload. */
  pendingKey: string;
  storagePrefix: string;
}

/**
 * Eager boot step — MUST run before any other module can draw from the
 * gameplay RNG or read storage, so call it at module scope from the
 * game's first import. Detects the page mode, sandboxes storage when
 * watching a replay (the player's real saves stay untouched), and seeds
 * the gameplay stream.
 */
export function bootReplay(opts: { storagePrefix: string; pendingKey?: string }): ReplayBoot {
  const pendingKey = opts.pendingKey ?? `${opts.storagePrefix}.replay.pending`;
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

  let pending: Recording | null = null;
  try {
    const raw = sessionStorage.getItem(pendingKey);
    if (raw) {
      sessionStorage.removeItem(pendingKey); // one shot — a crash must not loop
      const rec = JSON.parse(raw) as Recording;
      if (rec?.v === 3) pending = rec;
    }
  } catch {
    /* sessionStorage unavailable — no viewing mode */
  }

  const seed = pending
    ? pending.seed
    : (Number(params.get('seed') ?? NaN) >>> 0) ||
      ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) ||
      1;

  if (pending) sandboxStorage(pending.storage ?? {});
  seedRandom(seed);

  return {
    harness: params.get('harness') === '1',
    viewing: pending !== null,
    seed,
    pending,
    pendingKey,
    storagePrefix: opts.storagePrefix,
  };
}

/** The game-supplied half: what to record/hash and how to start a run. */
export interface ReplayConfig<A extends string, Start> {
  /** Every action an agent may hold (surfaced on window.__harness). */
  actions: readonly A[];
  /** Serializable world state — hashed for divergence checks, returned to
   * agents. Keep numbers rounded so hashes are format-stable. */
  state(): unknown;
  /** Begin a run the way the game does (must fire the game's run-start
   * event, which the game forwards to `runStarted`). */
  beginRun(start: Start): void;
  /** Optional: report why the session can't replay ('coop', ...). Polled
   * once per second; the first non-null answer sticks. */
  taint?(): string | undefined;
}

/** djb2 — cheap, stable across runs, plenty for divergence checks. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

const newSeed = (): number => ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;

interface Run<Start> {
  seed: number;
  start: Start;
  storage: Record<string, string>;
  tape: TapeEvent<string>[];
  checks: [number, number][];
  offset: number;
}

export class Replay<A extends string, Start = unknown, E extends Record<string, unknown> = Record<string, unknown>> {
  private run: Run<Start> | null = null;
  private runCount = 0;
  private tainted: string | undefined;
  private created = new Date().toISOString();

  private playback: { rec: Recording<A, Start>; offset: number; cursor: number; armed: boolean } | null = null;

  /* viewer state */
  private viewerStarted = false;
  private viewerEnded = false;
  private viewerDiverged = 0;
  private viewerCheckAt = 0;

  constructor(
    private game: Game<A, E>,
    private boot: ReplayBoot,
    private config: ReplayConfig<A, Start>,
  ) {}

  /** Steps since the current run started (what recordings count in). */
  relStep(): number {
    return this.game.steps - (this.run?.offset ?? 0);
  }

  hashNow(): number {
    return hash(JSON.stringify(this.config.state()));
  }

  /**
   * The game's run-start event landed: cut a fresh per-run tape and
   * reseed the gameplay stream — derived from the boot seed in harness
   * mode (agents get same-seed reproducibility), random for live play.
   * When a playback is waiting, the recording's seed wins instead.
   */
  runStarted(start: Start): void {
    const p = this.playback;
    if (p && !p.armed) {
      seedRandom(p.rec.seed);
      p.offset = this.game.steps;
      p.armed = true;
      this.run = {
        seed: p.rec.seed, start, storage: snapshotStorage(this.boot.storagePrefix),
        tape: [], checks: [], offset: this.game.steps,
      };
      return;
    }
    if (p && p.armed) {
      // A replayed run started ANOTHER run (loaded a save mid-run):
      // tapes never span that boundary, so the playback is over.
      this.viewerEnded = true;
    }
    const seed = this.boot.harness
      ? (((this.boot.seed + 0x9e3779b9 * ++this.runCount) >>> 0) || 1)
      : newSeed();
    seedRandom(seed);
    this.run = {
      seed, start, storage: snapshotStorage(this.boot.storagePrefix),
      tape: [], checks: [], offset: this.game.steps,
    };
  }

  recording(): Recording<A, Start> | null {
    const run = this.run;
    if (!run) return null;
    const checks = [...run.checks];
    const end = this.relStep();
    if (!checks.length || checks[checks.length - 1][0] !== end) checks.push([end, this.hashNow()]);
    return {
      v: 3, seed: run.seed, mode: this.boot.harness ? 'harness' : 'live', created: this.created,
      start: run.start, storage: run.storage, tape: [...run.tape] as TapeEvent<A>[], checks, end,
      ...(this.tainted && { tainted: this.tainted }),
    };
  }

  /** Download the current run's recording (how a player keeps a replay). */
  saveFile(name?: string): string | null {
    const rec = this.recording();
    if (!rec) return null;
    const file = `${name ?? `${this.boot.storagePrefix}-run-${rec.seed}-${Date.now()}`}.json`;
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
    URL.revokeObjectURL(a.href);
    return file;
  }

  /** Wire the recorder, and whichever of the stepped/viewer modes is on. */
  install(): void {
    this.game.input.onRaw((ev: RawInputEvent<A>) => {
      const run = this.run;
      if (!run) return;
      const s = this.relStep();
      if (ev.t === 'tap') run.tape.push([s, 't', r2(ev.x), r2(ev.y)]);
      else if (ev.t === 'down') run.tape.push([s, 'd', ev.a]);
      else run.tape.push([s, 'u', ev.a]);
    });

    this.game.onStep(() => {
      const run = this.run;
      if (!run) return;
      const s = this.relStep();
      if (s > 0 && s % 60 === 0) {
        run.checks.push([s, this.hashNow()]);
        if (!this.tainted) this.tainted = this.config.taint?.();
      }
    });

    window.__replay = {
      recording: () => this.recording(),
      save: (name?: string) => this.saveFile(name),
    };

    if (this.boot.harness) this.installStepped();
    else if (this.boot.viewing) this.installViewer();
  }

  /* ---------------- playback: feed a tape on exact steps ---------------- */

  private applyTapeEvent(ev: TapeEvent<A>): void {
    if (ev[1] === 'd') this.game.input.press(ev[2]);
    else if (ev[1] === 'u') this.game.input.release(ev[2]);
    else this.game.input.notifyTap(ev[2], ev[3]);
  }

  /** Apply every due event: tag T fires when the sim clock reaches run-relative T. */
  private applyDue(): void {
    const p = this.playback;
    if (!p || !p.armed) return;
    while (p.cursor < p.rec.tape.length && p.offset + p.rec.tape[p.cursor][0] <= this.game.steps) {
      this.applyTapeEvent(p.rec.tape[p.cursor++]);
    }
  }

  /** Start playing `rec`: begins the run the recorded way. The game's
   * run-start event routes back into runStarted, which pins the
   * recording's seed before the starter draws a single random number. */
  private startPlayback(rec: Recording<A, Start>): void {
    this.playback = { rec, offset: 0, cursor: 0, armed: false };
    this.config.beginRun(rec.start);
  }

  /* ---------------- stepped mode: agents + the Node verifier ---------------- */

  private installStepped(): void {
    const game = this.game;
    game.loop.stop();

    const held = new Set<A>();
    const step = (down: A[] = [], frames = 1): unknown => {
      for (const a of down) if (!held.has(a)) { game.input.press(a); held.add(a); }
      for (const a of [...held]) if (!down.includes(a)) { game.input.release(a); held.delete(a); }
      const n = Math.max(1, Math.min(3600, Math.floor(frames)));
      for (let i = 0; i < n; i++) game.loop.advance(STEP);
      return this.config.state();
    };

    /** Advance until the run-relative sim clock reaches `target`. */
    const runTo = (target: number): unknown => {
      const base = this.playback?.armed ? this.playback.offset : (this.run?.offset ?? 0);
      let spins = 0;
      const cap = (base + target - game.steps) * 4 + 600; // freeze is bounded; runaway = bug
      while (game.steps < base + target) {
        this.applyDue();
        game.loop.advance(STEP);
        if (++spins > cap) throw new Error(`runTo(${target}) stalled at step ${game.steps - base}`);
      }
      return this.config.state();
    };

    window.__harness = {
      seed: this.boot.seed,
      actions: this.config.actions,
      step: step as (down?: string[], frames?: number) => unknown,
      state: () => this.config.state(),
      hashNow: () => this.hashNow(),
      replayRun: (rec) => {
        this.startPlayback(rec as Recording<A, Start>);
        return this.config.state();
      },
      runTo,
      recording: () => this.recording(),
    };
  }

  /* ---------------- viewing mode: watch a tape in real time ---------------- */

  private installViewer(): void {
    const game = this.game;
    const rec = this.boot.pending as Recording<A, Start>;

    // Mute every device: keyboard/touch/gamepad all land in these three
    // methods, and only the tape may drive the sim while a replay plays.
    const rawPress = game.input.press.bind(game.input);
    const rawRelease = game.input.release.bind(game.input);
    const rawTap = game.input.notifyTap.bind(game.input);
    let applying = false;
    game.input.press = (a) => { if (applying) rawPress(a); };
    game.input.release = (a) => { if (applying) rawRelease(a); };
    game.input.notifyTap = (x, y) => { if (applying) rawTap(x, y); };

    game.onStep((step) => {
      // Let boot settle a few steps, then start the run exactly as recorded.
      if (!this.viewerStarted && step >= 5) {
        this.viewerStarted = true;
        this.startPlayback(rec);
        return;
      }
      const p = this.playback;
      if (!p || !p.armed || this.viewerEnded) return;
      applying = true;
      this.applyDue();
      applying = false;
      const rel = game.steps - p.offset;
      while (this.viewerCheckAt < rec.checks.length && rec.checks[this.viewerCheckAt][0] <= rel) {
        const [at, expected] = rec.checks[this.viewerCheckAt++];
        if (at === rel && this.hashNow() !== expected && !this.viewerDiverged) this.viewerDiverged = rel;
      }
      if (rel >= rec.end) this.viewerEnded = true;
    });

    game.onOverlay((g) => {
      // Slim player-chrome along the bottom edge (HUDs own the top).
      const w = game.width;
      const h = game.height;
      const p = this.playback;
      const ended = this.viewerEnded;
      const diverged = this.viewerDiverged;
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
      if (this.viewerEnded) exit();
    });
  }
}

/**
 * A title-menu "watch replay" action: pick a recording file, stash it
 * for the next boot, reload into viewing mode.
 */
export function pickReplayFile(pendingKey: string): void {
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
      sessionStorage.setItem(pendingKey, text);
      location.reload();
    } catch {
      alert('Not a replay file (v3) — save one from the pause menu.');
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
      actions: readonly string[];
      step(down?: string[], frames?: number): unknown;
      state(): unknown;
      hashNow(): number;
      replayRun(rec: Recording): unknown;
      runTo(target: number): unknown;
      recording(): Recording | null;
    };
  }
}
