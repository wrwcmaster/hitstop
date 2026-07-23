import {
  Entity,
  Tilemap,
  drawText,
  type CollisionSource,
  type Solid,
  type RoomEntity,
} from '@engine/index';
import { COLORS } from '../content/palette';
import { definePlaceable, type PlaceableCtx } from '../content/placeables';
import { optionalFiniteNumber, rejectUnknownProps, requireString } from '../content/prop-validation';
import { prettyCode, prettyButton, type ActorHost } from '../defs';
import { Player, nearestPlayer } from './player';

/**
 * Puzzle gizmos: the moving parts a room can be built from. All pure
 * placeables — a room JSON positions them and wires them together with
 * named switch flags (`switch:<id>`), which levers and plates write via
 * the `setFlag` event and barriers read live. Flags are ordinary story
 * flags, so a solved vault stays solved in the save.
 *
 *   platform: solid that rides a sine path and carries whoever stands on it
 *   spikes:   (a tile, not a gizmo — see content/tiles.ts)
 *   lever:    interact to toggle its switch flag (latching)
 *   plate:    holds its switch flag while someone stands on it
 *   barrier:  solid wall while its switch flag is unset; `linger` keeps
 *             it open a beat after the flag drops (timed runs)
 *
 * Each gizmo draws through a shared draw* function and reports a
 * GizmoSnap, so the co-op guest can render the same machinery (and dock
 * the same solids) from snapshots alone.
 */

/** A gizmo as it crosses the co-op wire: kind + rect + one bit of state. */
export interface GizmoSnap {
  kind: 'platform' | 'lever' | 'plate' | 'barrier';
  x: number;
  y: number;
  w: number;
  h: number;
  /** lever/plate: engaged; barrier: open. Platforms ignore it. */
  on: boolean;
}

/** The tilemap's dynamic-solid dock (placeables get a CollisionSource). */
function solidsOf(collision: CollisionSource): Solid[] | null {
  return collision instanceof Tilemap ? collision.extraSolids : null;
}

/* ---------------- moving platform ---------------- */

export class MovingPlatform extends Entity {
  private solid: Solid;
  private t: number;

  constructor(
    _game: ActorHost,
    collision: CollisionSource,
    private x0: number,
    private y0: number,
    w: number,
    h: number,
    private dx: number,
    private dy: number,
    private period: number,
    phase: number,
  ) {
    super();
    this.t = phase;
    this.solid = { x: x0, y: y0, w, h };
    solidsOf(collision)?.push(this.solid);
    this.layer = 1;
  }

  update(dt: number): void {
    this.t += dt;
    // Sine glide between (x0,y0) and (x0+dx, y0+dy): eases at both ends.
    const k = (1 - Math.cos((this.t / this.period) * Math.PI * 2)) / 2;
    const nx = this.x0 + this.dx * k;
    const ny = this.y0 + this.dy * k;
    const ddx = nx - this.solid.x;
    const ddy = ny - this.solid.y;
    // Carry riders: anyone standing on the old top surface moves with it.
    for (const a of this.world.actors('player')) {
      const standing =
        Math.abs(a.y + a.h - this.solid.y) < 2 &&
        a.x + a.w > this.solid.x - 1 &&
        a.x < this.solid.x + this.solid.w + 1 &&
        a.vy >= 0;
      if (standing) {
        a.x += ddx;
        a.y += ddy;
      }
    }
    this.solid.x = nx;
    this.solid.y = ny;
  }

  render(g: CanvasRenderingContext2D): void {
    const s = this.solid;
    drawPlatform(g, s.x, s.y, s.w, s.h);
  }

  gizmoSnap(): GizmoSnap {
    const s = this.solid;
    return { kind: 'platform', x: s.x, y: s.y, w: s.w, h: s.h, on: true };
  }
}

/** Platform look, shared with the co-op guest renderer. */
export function drawPlatform(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = COLORS.navyLight;
  g.fillRect(Math.round(x), Math.round(y), w, h);
  g.fillStyle = COLORS.steelDark;
  g.fillRect(Math.round(x), Math.round(y), w, 2);
  g.fillStyle = COLORS.navyDark;
  g.fillRect(Math.round(x), Math.round(y + h - 2), w, 2);
  // Rune glow so it reads as machinery, not scenery.
  g.fillStyle = 'rgba(115,190,211,0.7)';
  g.fillRect(Math.round(x + w / 2 - 2), Math.round(y + h / 2 - 1), 4, 2);
}

/* ---------------- lever ---------------- */

export class Lever extends Entity {
  private on: boolean;

  constructor(
    private game: ActorHost,
    flags: ReadonlySet<string>,
    private x: number,
    private y: number,
    private switchId: string,
  ) {
    super();
    this.on = flags.has(switchId);
    this.layer = 2;
  }

  private playerNear(): Player | null {
    const p = nearestPlayer(this.world, this.x + 4, this.y + 4);
    if (!p || !p.isLocal) return null;
    return Math.abs(p.cx - (this.x + 4)) < 16 && Math.abs(p.cy - this.y) < 24 ? p : null;
  }

  update(_dt: number): void {
    const p = this.playerNear();
    if (p && this.game.input.consumePress('interact')) {
      this.on = !this.on;
      this.game.events.emit('setFlag', { id: this.switchId, on: this.on });
      this.game.sfx.play('unlock');
      this.game.feel.shake(0.1);
      this.game.feel.burst(this.x + 4, this.y, 6, {
        color: [COLORS.gold, COLORS.white], speed: 40, life: 0.3, drag: 3,
      });
    }
  }

  render(g: CanvasRenderingContext2D): void {
    drawLever(g, this.x, this.y, this.on);
    if (this.playerNear()) {
      const label = promptLabel(this.game);
      drawText(g, label, this.x + 4, this.y - 12, COLORS.gold, 1, 'center');
    }
  }

  gizmoSnap(): GizmoSnap {
    return { kind: 'lever', x: this.x, y: this.y, w: 8, h: 10, on: this.on };
  }
}

/** Lever look, shared with the co-op guest renderer. */
export function drawLever(g: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
  // Base + a handle that leans with the state.
  g.fillStyle = COLORS.steelDark;
  g.fillRect(x, y + 6, 8, 3);
  g.strokeStyle = on ? COLORS.gold : COLORS.steel;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + 4, y + 6);
  g.lineTo(x + 4 + (on ? 5 : -5), y - 2);
  g.stroke();
  g.fillStyle = on ? COLORS.gold : COLORS.steel;
  g.fillRect(x + 3 + (on ? 5 : -5), y - 3, 3, 3);
}

/** Device-aware interact prompt (same convention as NPCs). */
function promptLabel(game: ActorHost): string {
  const pad = game.pad;
  if (pad?.connected) {
    const b = pad.buttonsFor('interact')[0];
    return b != null ? prettyButton(b) : 'Y';
  }
  if (typeof window !== 'undefined' && !window.matchMedia('(pointer: fine)').matches) {
    return 'TALK';
  }
  const code = game.input.codesFor('interact')[0];
  return code ? prettyCode(code) : 'E';
}

/* ---------------- pressure plate ---------------- */

export class PressurePlate extends Entity {
  private pressed = false;

  constructor(
    private game: ActorHost,
    private x: number,
    private y: number,
    private switchId: string,
    private latch: boolean,
  ) {
    super();
    this.layer = 1;
  }

  update(_dt: number): void {
    const held = this.world.actors('player').some(
      (a) => a.x + a.w > this.x && a.x < this.x + 12 && Math.abs(a.y + a.h - this.y - 2) < 4,
    );
    if (held !== this.pressed) {
      if (held || !this.latch) {
        this.game.events.emit('setFlag', { id: this.switchId, on: held || this.latch });
        this.game.sfx.play(held ? 'menuSelect' : 'menuClose');
      }
      this.pressed = held;
    }
  }

  render(g: CanvasRenderingContext2D): void {
    drawPlate(g, this.x, this.y, this.pressed);
  }

  gizmoSnap(): GizmoSnap {
    return { kind: 'plate', x: this.x, y: this.y, w: 12, h: 4, on: this.pressed };
  }
}

/** Plate look, shared with the co-op guest renderer. */
export function drawPlate(g: CanvasRenderingContext2D, x: number, y: number, pressed: boolean): void {
  const down = pressed ? 2 : 0;
  g.fillStyle = COLORS.steelDark;
  g.fillRect(x - 1, y + 2, 14, 2);
  g.fillStyle = pressed ? COLORS.gold : COLORS.steel;
  g.fillRect(x, y - 2 + down, 12, 3 - down + 1);
}

/* ---------------- barrier ---------------- */

export class Barrier extends Entity {
  private solid: Solid;
  private docked = true;
  /** Seconds of grace left after the opening flag dropped. */
  private lingerT = 0;

  constructor(
    private game: ActorHost,
    private collision: CollisionSource,
    private flags: ReadonlySet<string>,
    private x: number,
    private y: number,
    private w: number,
    private h: number,
    private switchId: string,
    private linger: number,
  ) {
    super();
    this.solid = { x, y, w, h };
    solidsOf(collision)?.push(this.solid);
    this.layer = 1;
  }

  private get open(): boolean {
    return this.flags.has(this.switchId) || this.lingerT > 0;
  }

  update(dt: number): void {
    if (this.flags.has(this.switchId)) this.lingerT = this.linger;
    else this.lingerT = Math.max(0, this.lingerT - dt);
    const solids = solidsOf(this.collision);
    if (!solids) return;
    if (this.open && this.docked) {
      const i = solids.indexOf(this.solid);
      if (i >= 0) solids.splice(i, 1);
      this.docked = false;
      this.game.sfx.play('unlock');
    } else if (!this.open && !this.docked) {
      solids.push(this.solid);
      this.docked = true;
      this.game.sfx.play('menuClose');
    }
  }

  render(g: CanvasRenderingContext2D): void {
    drawBarrier(g, this.x, this.y, this.w, this.h, this.open);
  }

  gizmoSnap(): GizmoSnap {
    return { kind: 'barrier', x: this.x, y: this.y, w: this.w, h: this.h, on: this.open };
  }
}

/** Barrier look, shared with the co-op guest renderer. */
export function drawBarrier(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, open: boolean): void {
  if (open) {
    // Open: a faint frame so the path reads as a doorway.
    g.strokeStyle = 'rgba(115,190,211,0.35)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    return;
  }
  g.fillStyle = COLORS.navyLight;
  g.fillRect(x, y, w, h);
  g.fillStyle = COLORS.steelDark;
  for (let yy = y + 2; yy < y + h; yy += 6) g.fillRect(x + 1, yy, w - 2, 2);
  // Energy seam down the middle.
  g.fillStyle = 'rgba(115,190,211,0.8)';
  g.fillRect(Math.round(x + w / 2) - 1, y, 2, h);
}

/** Everything the host should snapshot as a gizmo. */
export type Gizmo = MovingPlatform | Lever | PressurePlate | Barrier;
export function isGizmo(e: unknown): e is Gizmo {
  return (
    e instanceof MovingPlatform || e instanceof Lever ||
    e instanceof PressurePlate || e instanceof Barrier
  );
}

/* ---------------- placeables ---------------- */

const num = (props: Record<string, unknown> | undefined, key: string, fallback: number): number => {
  const v = props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const str = (props: Record<string, unknown> | undefined, key: string, fallback: string): string => {
  const v = props?.[key];
  return typeof v === 'string' && v ? v : fallback;
};

export function registerGizmos(): void {
  definePlaceable('platform', {
    label: 'PLATFORM',
    category: 'gizmo',
    colors: [COLORS.navyLight, COLORS.steelDark],
    w: 32, h: 6,
    validateProps(props, path) {
      rejectUnknownProps(props, ['w', 'h', 'dx', 'dy', 'period', 'phase'], path);
      optionalFiniteNumber(props, 'w', path);
      optionalFiniteNumber(props, 'h', path);
      optionalFiniteNumber(props, 'dx', path);
      optionalFiniteNumber(props, 'dy', path);
      optionalFiniteNumber(props, 'period', path);
      optionalFiniteNumber(props, 'phase', path);
    },
    spawn(ctx: PlaceableCtx, e: RoomEntity) {
      ctx.game.world.spawn(new MovingPlatform(
        ctx.game, ctx.tilemap, e.x, e.y,
        num(e.props, 'w', 32), num(e.props, 'h', 6),
        num(e.props, 'dx', 0), num(e.props, 'dy', 0),
        Math.max(0.5, num(e.props, 'period', 4)), num(e.props, 'phase', 0),
      ));
    },
  });

  definePlaceable('lever', {
    label: 'LEVER',
    category: 'gizmo',
    colors: [COLORS.gold, COLORS.steel],
    w: 8, h: 10,
    validateProps(props, path) {
      rejectUnknownProps(props, ['switch'], path);
      requireString(props, 'switch', path);
    },
    spawn(ctx: PlaceableCtx, e: RoomEntity) {
      ctx.game.world.spawn(new Lever(ctx.game, ctx.flags, e.x, e.y, `switch:${str(e.props, 'switch', 'a')}`));
    },
  });

  definePlaceable('plate', {
    label: 'PLATE',
    category: 'gizmo',
    colors: [COLORS.steel, COLORS.gold],
    w: 12, h: 4,
    validateProps(props, path) {
      rejectUnknownProps(props, ['switch', 'latch'], path);
      requireString(props, 'switch', path);
    },
    spawn(ctx: PlaceableCtx, e: RoomEntity) {
      ctx.game.world.spawn(new PressurePlate(
        ctx.game, e.x, e.y, `switch:${str(e.props, 'switch', 'a')}`, e.props?.latch === true,
      ));
    },
  });

  definePlaceable('barrier', {
    label: 'BARRIER',
    category: 'gizmo',
    colors: [COLORS.navyLight, '#73becb'],
    w: 8, h: 32,
    validateProps(props, path) {
      rejectUnknownProps(props, ['switch', 'w', 'h', 'linger'], path);
      requireString(props, 'switch', path);
      optionalFiniteNumber(props, 'w', path);
      optionalFiniteNumber(props, 'h', path);
      optionalFiniteNumber(props, 'linger', path);
    },
    spawn(ctx: PlaceableCtx, e: RoomEntity) {
      ctx.game.world.spawn(new Barrier(
        ctx.game, ctx.tilemap, ctx.flags, e.x, e.y,
        num(e.props, 'w', 8), num(e.props, 'h', 32),
        `switch:${str(e.props, 'switch', 'a')}`, num(e.props, 'linger', 0),
      ));
    },
  });
}
