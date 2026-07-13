import { createPixelCanvas, PixelCanvas } from '../gfx/canvas';
import { Loop } from './loop';
import { SceneManager } from './scene';
import { Input } from '../input/input';
import { AudioBus } from '../audio/bus';
import { Sfx } from '../audio/sfx';
import { Music } from '../audio/music';
import { Camera } from '../gfx/camera';
import { Particles } from '../feel/particles';
import { Floaters } from '../feel/floaters';
import { Feel } from '../feel/feel';
import { EventBus } from './events';
import { World } from '../world/world';
import { Combat, CombatEvents } from '../combat/combat';

export interface GameOptions<A extends string> {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** KeyboardEvent.code -> action(s). A key may serve several actions. */
  keymap: Record<string, A | A[]>;
}

/**
 * The composition root: one object that owns every engine service and
 * runs the loop. A game creates a Game, registers content, sets the
 * first scene and calls start().
 *
 * Per-frame order:
 *   update: scene.update -> feel.update -> input.endStep
 *   render: scene.render -> feel screen overlay (flash)
 *   frame (real time, even during hitstop): feel.frame, scene.frame
 */
export class Game<A extends string = string, E extends Record<string, unknown> = Record<string, unknown>> {
  readonly screen: PixelCanvas;
  readonly loop: Loop;
  readonly scenes = new SceneManager();
  readonly input: Input<A>;
  readonly audio = new AudioBus();
  readonly sfx = new Sfx(this.audio);
  readonly music = new Music(this.audio);
  readonly camera: Camera;
  readonly feel: Feel;
  readonly world = new World();
  readonly combat: Combat;
  /** Game-defined events + engine combat events. */
  readonly events = new EventBus<E & CombatEvents>();

  private frameHooks: ((realDt: number) => void)[] = [];

  /** Run `fn` every rendered frame (real time) — gamepad polling, debug HUDs. */
  onFrame(fn: (realDt: number) => void): void {
    this.frameHooks.push(fn);
  }

  get width(): number {
    return this.screen.width;
  }

  get height(): number {
    return this.screen.height;
  }

  get ctx(): CanvasRenderingContext2D {
    return this.screen.ctx;
  }

  constructor(opts: GameOptions<A>) {
    this.screen = createPixelCanvas(opts.canvas, opts.width, opts.height);
    this.camera = new Camera(opts.width, opts.height);
    this.input = new Input<A>(opts.keymap);
    this.input.attachKeyboard(window);
    this.input.onAnyPress(() => this.sfx.unlock());

    this.loop = new Loop({
      update: (dt) => {
        this.scenes.update(dt);
        this.feel.update(dt);
        this.input.endStep();
      },
      render: () => {
        this.scenes.render(this.ctx);
        this.feel.renderScreen(this.ctx, this.width, this.height);
      },
      frame: (realDt) => {
        for (const fn of this.frameHooks) fn(realDt);
        this.feel.frame(realDt);
        this.scenes.frame(realDt);
      },
    });

    this.feel = new Feel(this.loop, this.camera, new Particles(), new Floaters(), this.sfx);
    this.combat = new Combat(this.world, this.feel, this.events as unknown as EventBus<CombatEvents>);
  }

  start(): void {
    this.loop.start();
  }
}
