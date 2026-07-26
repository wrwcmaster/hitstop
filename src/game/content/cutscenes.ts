import {
  Registry,
  Input,
  call,
  wait,
  clamp,
  t,
  type DirectorStep,
} from '@engine/index';
import { KEYMAP, type Action, type ActionGame } from '../defs';
import type { PlayHost } from '../scenes/play/host';
import { Monster } from '../actors/monster';

/**
 * Cutscenes: scripted moments played over the LIVE world.
 *
 * A cutscene is a Director timeline (engine mechanism) built from game
 * verbs: pan the camera, show a banner, and — the important one — DRIVE
 * ACTORS THROUGH THE SAME INPUT SEAM CO-OP USES. `ctx.input` is a real
 * `Input<Action>` swapped in as the player's `source` for the duration,
 * so a scripted knight runs, jumps, and swings through the exact
 * deterministic action stream a remote player would. That is why
 * cutscenes replay bit-for-bit, and why a co-op guest sees every actor
 * move without any extra machinery: nothing about the simulation
 * changes, only who is holding the controls. The PRESENTATION does need
 * machinery: snapshots carry a `cine` field (the directed camera) while
 * a scene runs, the guest mirrors the shot and letterbox from it, and a
 * guest menu press travels up as a skip request. The guest's knight
 * stands down for the duration — the guest streams a neutral held-set
 * and predicts on never-pressed input, so nobody plays blind while the
 * camera is elsewhere; the world itself never pauses. The scene also
 * shields both knights (no damage, no drowning) and ANCHORS the guest
 * in place, and critical triggers should carry `assemble: true` so the
 * moment waits for both knights to gather before it starts.
 *
 * Definitions are data in a registry, so a room places one with a
 * `cutscene` trigger in the level editor and no scene changes — the same
 * bargain every other content type makes.
 */
export interface CutsceneCtx {
  game: ActionGame;
  host: PlayHost;
  /** The scripted hands on the player's controls (see above). */
  input: Input<Action>;
}

export type CutsceneDef = (ctx: CutsceneCtx) => DirectorStep<CutsceneCtx>[];

export const cutscenes = new Registry<CutsceneDef>('cutscene');

export function defineCutscene(id: string, def: CutsceneDef): void {
  cutscenes.register(id, def);
}

/** A fresh scripted-hands input (the ctx's `input`). */
export function scriptInput(): Input<Action> {
  return new Input<Action>(KEYMAP);
}

/* ---------------- shared step builders ---------------- */

/** Pan the camera to a world point (clamped to its bounds) and stay. */
export function panTo(seconds: number, to: (ctx: CutsceneCtx) => { x: number; y: number }): DirectorStep<CutsceneCtx> {
  let from = { x: 0, y: 0 };
  return {
    duration: seconds,
    enter: ({ game }) => {
      from = { x: game.camera.x, y: game.camera.y };
    },
    update: (ctx, k) => {
      const cam = ctx.game.camera;
      const goal = to(ctx);
      const x = goal.x - cam.viewW / 2;
      const y = goal.y - cam.viewH * 0.62;
      cam.x = from.x + (clamp(x, cam.minX, Math.max(cam.minX, cam.maxX - cam.viewW)) - from.x) * k;
      cam.y = from.y + (clamp(y, cam.minY, Math.max(cam.minY, cam.maxY - cam.viewH)) - from.y) * k;
    },
  };
}

/** Show the big banner and hold for its duration. */
export function banner(text: string, seconds: number): DirectorStep<CutsceneCtx> {
  return {
    duration: seconds,
    enter: ({ host }) => host.banner(t(text), seconds),
  };
}

/** Hold an action on the scripted hands for a stretch (walks, jumps). */
export function hold(action: Action, seconds: number): DirectorStep<CutsceneCtx> {
  return {
    duration: seconds,
    enter: ({ input }) => input.press(action),
    exit: ({ input }) => input.release(action),
  };
}

/* ---------------- the catalog ---------------- */

/**
 * The Slime King reveal: the throne room announces its occupant. The
 * knight walks in under scripted hands, the camera finds the king, the
 * title lands, and control comes back. Placed as a once-trigger in
 * throne.json — skippable, and a skip still leaves everything the scene
 * did in place (Director.skip fast-forwards rather than aborts).
 */
defineCutscene('slime-king-reveal', () => {
  const kingOf = ({ game }: CutsceneCtx): Monster | null => {
    for (const a of game.world.actors('enemy')) {
      if (a instanceof Monster && a.def.boss) return a;
    }
    return null;
  };
  return [
    // She steps into the hall herself — the world keeps simulating; the
    // director is just holding her controls.
    hold('right', 0.55),
    panTo(0.9, (ctx) => {
      const king = kingOf(ctx);
      const p = ctx.host.player;
      return king ? { x: king.cx, y: king.cy } : { x: p?.cx ?? 0, y: p?.cy ?? 0 };
    }),
    call((ctx) => {
      ctx.game.feel.shake(0.3);
      ctx.game.sfx.play('wave');
    }),
    banner('THE SLIME KING', 1.4),
    wait(0.2),
    panTo(0.7, (ctx) => {
      const p = ctx.host.player;
      return { x: p?.cx ?? 0, y: p?.cy ?? 0 };
    }),
  ];
});

/** Importing this module registers the catalog. */
export function registerCutscenes(): void {}
