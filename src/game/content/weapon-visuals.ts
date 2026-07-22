import {
  Registry,
  frameAt,
  loadSprite,
  offscreen,
  whiteOf,
  withFacing,
  type FacingAnimSet,
  type SpriteFile,
} from '@engine/index';
import { COLORS, PAL } from './palette';
import { TEXEL } from './sprites';
import { drawArrowSprite } from './ballistics';
import greatSwordJson from './sprites/equipment/great-sword.json';
import rustySwordJson from './sprites/equipment/rusty-sword.json';
import slashCrescentJson from './sprites/slash-crescent.json';
import type { WeaponAttackDef } from './weapons';

export interface WeaponAttackPose {
  progress: number;
  def: WeaponAttackDef;
}

/** Body-local context for the held weapon. */
export interface HeldWeaponCtx {
  facing: 1 | -1;
  anim: string;
  frame: number;
  animT: number;
  bodyW: number;
  bodyH: number;
  attack?: WeaponAttackPose;
  /** Hold-to-charge progress 0..1 while the wielder is drawing (the
   * player's `draw` state) — charged visuals pull their string/wind-up
   * with it. Absent when not charging. */
  charge?: number;
}

/** World-space context for the attack trail. */
export interface WeaponTrailCtx {
  x: number;
  y: number;
  facing: 1 | -1;
  colors: string[];
  attack: WeaponAttackPose;
}

export interface WeaponVisual {
  /** Normalized 8x8-logical-pixel item/pickup icon. */
  icon?: HTMLCanvasElement;
  /** Authored animation names, exposed for weapon-definition validation. */
  animations?: readonly string[];
  drawHeld(g: CanvasRenderingContext2D, ctx: HeldWeaponCtx): void;
  drawTrail?(g: CanvasRenderingContext2D, ctx: WeaponTrailCtx): void;
}

export const weaponVisuals = new Registry<WeaponVisual>('weaponVisual');

/**
 * An authored slash effect: pixel art for the arc itself, played across
 * the swing instead of the procedural crescent.
 *
 * Registered by SHAPE rather than by weapon, because that is how the
 * art actually varies — a plunge and a dash want different sheets, while
 * every sword can share one plunge. Weapons opt in per attack via
 * `trail.sprite`; anything that doesn't falls back to the procedural
 * arc, so a new weapon still gets a decent slash with no art at all.
 */
export interface SlashVisual {
  /** Pre-mirrored frames, played across the arc's sweep. */
  frames: { right: HTMLCanvasElement[]; left: HTMLCanvasElement[] };
  /**
   * Where the arc's pivot sits inside the sheet, in logical px from its
   * top-left. This is the point pinned to the wielder's trail origin, so
   * authored art lines up with the hand exactly like the procedural arc.
   */
  origin: { x: number; y: number };
}

export const slashVisuals = new Registry<SlashVisual>('slashVisual');

export function defineSlashVisual(id: string, visual: SlashVisual): void {
  slashVisuals.register(id, visual);
}

/**
 * Where ranged weapons sit, in logical px above the FEET origin the
 * held-weapon transform uses (negative = up). Chest height on the 18px
 * knight — held high so the shot leaves at eye-pleasing arc height.
 * THE contract between art and ballistics: `Player.fireRanged` spawns
 * arrows/bullets at exactly this line (± the weapon's small `muzzleY`
 * trim), so if you move the hand, the shots move with it.
 */
export const RANGED_HAND_Y = -9.5;

export function defineWeaponVisual(id: string, visual: WeaponVisual): void {
  weaponVisuals.register(id, visual);
}

export function drawHeldWeapon(g: CanvasRenderingContext2D, id: string | null, ctx: HeldWeaponCtx): void {
  if (id) weaponVisuals.get(id).drawHeld(g, ctx);
}

export function drawWeaponTrail(g: CanvasRenderingContext2D, id: string | null, ctx: WeaponTrailCtx): void {
  if (id) weaponVisuals.get(id).drawTrail?.(g, ctx);
}

/** Resolve the UI/pickup icon owned by a registered weapon visual. */
export function weaponIcon(id: string): HTMLCanvasElement {
  const icon = weaponVisuals.get(id).icon;
  if (!icon) throw new Error(`weapon visual "${id}" has no icon`);
  return icon;
}

export interface SpriteWeaponConfig {
  /** Transparent weapon-only frames aligned to the knight's world origin. */
  anims: FacingAnimSet;
  /** Player origin measured in logical pixels from the sheet's top-left. */
  origin?: { x: number; y: number };
  /** Optional body-frame offsets for final art alignment. */
  anchors?: Record<string, { x: number; y: number; angle?: number }[]>;
  /** Set false when the authored frames already include an attack effect. */
  trail?: boolean;
}

/** Build a visual from authored, animation-aligned sprite layers. */
export function spriteWeapon(config: SpriteWeaponConfig): WeaponVisual {
  const iconFrame = config.anims.right.idle?.frames[0]
    ?? Object.values(config.anims.right)[0]?.frames[0];
  if (!iconFrame) throw new Error('sprite weapon needs at least one frame');
  return {
    icon: normalizedIcon(iconFrame),
    animations: Object.keys(config.anims.right),
    drawHeld(g, ctx) {
      const set = ctx.facing === 1 ? config.anims.right : config.anims.left;
      const attackAnim = ctx.attack ? set[ctx.attack.def.animation] : undefined;
      const anim = attackAnim ? ctx.attack!.def.animation : ctx.anim;
      const frame = attackAnim
        ? attackFrame(ctx.attack!, attackAnim.frames.length)
        : ctx.frame;
      const image = attackAnim ? attackAnim.frames[frame] : frameAt(set, anim, ctx.animT);
      const anchor = config.anchors?.[anim]?.[frame] ?? { x: 0, y: 0, angle: 0 };
      const drawW = image.width / TEXEL;
      const drawH = image.height / TEXEL;
      const origin = config.origin ?? { x: drawW / 2, y: drawH };
      g.save();
      g.translate(anchor.x * ctx.facing, anchor.y);
      if (anchor.angle) g.rotate(anchor.angle * ctx.facing);
      g.drawImage(image, -origin.x, -origin.y, drawW, drawH);
      g.restore();
    },
    drawTrail: config.trail === false ? undefined : drawSlashTrail,
  };
}

/** Trim a world sprite and fit it into the established 8x8 icon footprint. */
function normalizedIcon(image: HTMLCanvasElement): HTMLCanvasElement {
  const size = 8 * TEXEL;
  const padding = 1 * TEXEL;
  const source = image.getContext('2d')!.getImageData(0, 0, image.width, image.height);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (source.data[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const [icon, g] = offscreen(size, size);
  if (maxX < minX || maxY < minY) return icon;
  const sourceW = maxX - minX + 1;
  const sourceH = maxY - minY + 1;
  const scale = Math.min((size - padding * 2) / sourceW, (size - padding * 2) / sourceH);
  const drawW = Math.max(1, Math.round(sourceW * scale));
  const drawH = Math.max(1, Math.round(sourceH * scale));
  g.imageSmoothingEnabled = false;
  g.drawImage(
    image,
    minX,
    minY,
    sourceW,
    sourceH,
    Math.floor((size - drawW) / 2),
    Math.floor((size - drawH) / 2),
    drawW,
    drawH,
  );
  return icon;
}

export interface ProceduralBladeConfig {
  bladeLen: number;
  bladeW: number;
  blade: string;
  hilt: string;
}

/** Build compact pixel art when a weapon does not need an authored sheet. */
export function proceduralBlade(config: ProceduralBladeConfig): WeaponVisual {
  return {
    drawHeld(g, ctx) {
      const f = ctx.facing;
      let hx = 1.75;
      let hy = -4.5;
      if (ctx.anim === 'run') {
        if (ctx.frame === 0) {
          hx = 2.25;
          hy = -5.25;
        } else if (ctx.frame === 2) {
          hx = 1.25;
          hy = -5.25;
        }
      } else if (ctx.anim === 'air') {
        hx = 1.5;
        hy = -5;
      } else {
        hy += Math.sin(ctx.animT * 4.5) * 0.2;
      }

      let dx = 0.866;
      let dy = -0.5;
      if (ctx.attack) {
        const trail = ctx.attack.def.trail;
        const sweepT = Math.min(1, ctx.attack.progress / ctx.attack.def.active[1]);
        const sweep = trail.startAngle + (trail.endAngle - trail.startAngle) * sweepT;
        dx = Math.cos(sweep);
        dy = Math.sin(sweep);
      }

      const q = (value: number) => Math.round(value * TEXEL) / TEXEL;
      const step = 1 / TEXEL;
      const px = -dy * f;
      const py = dx;
      hx *= f;
      dx *= f;

      const gripLen = 5;
      for (let k = 1; k <= gripLen; k++) {
        const x = hx - k * dx * step;
        const y = hy - k * dy * step;
        g.fillStyle = '#302426';
        g.fillRect(q(x), q(y), step, step);
        g.fillRect(q(x + px * step), q(y + py * step), step, step);
      }

      const pommelX = hx - (gripLen + 1) * dx * step;
      const pommelY = hy - (gripLen + 1) * dy * step;
      g.fillStyle = config.hilt;
      g.fillRect(q(pommelX), q(pommelY), step, step);
      g.fillRect(q(pommelX + px * step), q(pommelY + py * step), step, step);

      const guardHalfLen = config.bladeW === 1 ? 5 : 8;
      for (let k = -guardHalfLen; k <= guardHalfLen; k++) {
        const x = hx + k * px * step;
        const y = hy + k * py * step;
        const thick = Math.max(1, 3 - Math.floor(Math.abs(k) / 3));
        for (let t = -Math.floor(thick / 2); t < Math.ceil(thick / 2); t++) {
          g.fillRect(q(x + t * dx * step), q(y + t * dy * step), step, step);
        }
      }

      const fineLen = config.bladeLen * TEXEL;
      const fineW = config.bladeW === 1 ? 3 : 6;
      for (let i = 1; i <= fineLen; i++) {
        const centerX = hx + i * dx * step;
        const centerY = hy + i * dy * step;
        const currentW = i >= fineLen - 3
          ? Math.max(1, fineW - (i - (fineLen - 3)) * 2)
          : fineW;
        const halfW = (currentW - 1) / 2;
        for (let j = -Math.ceil(halfW); j <= Math.floor(halfW); j++) {
          let color = config.blade;
          if (fineW === 6) {
            if (j === -3) color = COLORS.outline;
            else if (j === -1 || j === 0) color = COLORS.steelDark;
            else if (j === 2 || i >= fineLen - 1) color = COLORS.white;
          } else {
            if (j === 0) color = COLORS.steelDark;
            else if (j === 1 || i >= fineLen - 1) color = COLORS.white;
          }
          g.fillStyle = color;
          g.fillRect(q(centerX + j * px * step), q(centerY + j * py * step), step, step);
        }
      }
    },
    drawTrail: drawSlashTrail,
  };
}

/**
 * The arc a swing leaves behind, drawn as a tapered crescent band.
 *
 * Three things make it read as a slash rather than a colored wedge, and
 * all three are timing rather than shape. The sweep eases out, so the
 * blade whips and settles instead of tracking at constant speed. The
 * finished arc then HOLDS for the tail of the attack before fading —
 * without that hold the shape never resolves, because a sweep that
 * vanishes on its last active frame is only ever seen half-drawn. And
 * the band tapers to points at both ends, so what hangs there is a
 * crescent with a heavy belly, not a stripe.
 *
 * `trail.bias` slides the belly along the arc (0.5 = moon, higher =
 * comet chasing the tip) and `trail.glow` adds the halo. Both are per
 * attack, so a heavy plunge and a quick aerial share this renderer
 * without sharing a look.
 */
/**
 * The shared trail clock: how far the arc has drawn itself, and how
 * bright it still is.
 *
 * Two independent timings. `sweep` is how fast the arc DRAWS — eased out,
 * so the blade whips and settles rather than tracking at constant speed.
 * The fade is how long it LINGERS: full brightness for as long as the
 * attack can still hit, so what is on screen matches what the hitbox is
 * doing, then a dissolve once the move is spent.
 *
 * Both the procedural and the authored renderer read this, so pixel-art
 * frames advance on exactly the same curve the drawn arc sweeps on.
 */
function trailClock(attack: WeaponAttackPose, trail: WeaponAttackDef['trail']): {
  raw: number; sweepT: number; fade: number;
} {
  const sweepEnd = trail.sweep ?? attack.def.active[1];
  const hold = attack.def.active[1];
  const raw = Math.min(1, attack.progress / sweepEnd);
  return {
    raw,
    sweepT: 1 - (1 - raw) * (1 - raw),
    fade: attack.progress <= hold
      ? 1
      : Math.max(0, 1 - (attack.progress - hold) / Math.max(0.001, 1 - hold)),
  };
}

/** Blit an authored slash sheet, pinned to the wielder's trail origin. */
function drawAuthoredTrail(
  g: CanvasRenderingContext2D,
  ctx: WeaponTrailCtx,
  art: SlashVisual,
  clock: { sweepT: number; fade: number },
): void {
  const frames = ctx.facing === 1 ? art.frames.right : art.frames.left;
  const image = frames[Math.min(frames.length - 1, Math.floor(clock.sweepT * frames.length))];
  const w = image.width / TEXEL;
  const h = image.height / TEXEL;
  // Mirroring flips the pivot across the sheet along with the art.
  const ox = ctx.facing === 1 ? art.origin.x : w - art.origin.x;
  const q = (value: number) => Math.round(value * TEXEL) / TEXEL;
  g.save();
  g.globalAlpha = clock.fade;
  g.drawImage(image, q(ctx.x - ox), q(ctx.y - art.origin.y), w, h);
  g.restore();
}

function drawSlashTrail(g: CanvasRenderingContext2D, ctx: WeaponTrailCtx): void {
  const { attack } = ctx;
  const trail = attack.def.trail;
  const radius = trail.radius;
  const bias = trail.bias ?? 0.8;
  const glow = trail.glow ?? 0;
  const clock = trailClock(attack, trail);
  const { raw, sweepT, fade } = clock;
  if (fade <= 0) return;
  // Authored pixel art wins when the attack names a sheet; everything
  // else falls through to the procedural arc below.
  if (trail.sprite) {
    drawAuthoredTrail(g, ctx, slashVisuals.get(trail.sprite), clock);
    return;
  }
  const sweep = trail.startAngle + (trail.endAngle - trail.startAngle) * sweepT;
  const angle = ctx.facing === 1 ? sweep : Math.PI - sweep;
  const start = ctx.facing === 1 ? trail.startAngle : Math.PI - trail.startAngle;
  const q = (value: number) => Math.round(value * TEXEL) / TEXEL;
  const step = 1 / TEXEL;
  // Outward: halo, steel body, white core. The core is what the eye
  // actually tracks; the halo just makes it feel hot.
  const layers = [
    ...(glow > 0 ? [{ color: COLORS.white, thickness: trail.thickness * (1 + glow), alpha: 0.12 }] : []),
    { color: ctx.colors[0] ?? COLORS.steel, thickness: trail.thickness, alpha: 0.42 },
    { color: COLORS.white, thickness: trail.thickness * 0.4, alpha: 0.9 },
  ];
  const segments = 28;

  g.save();
  for (const layer of layers) {
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const theta = start + (angle - start) * t;
      const profile = t < bias
        ? Math.sin((t / bias) * (Math.PI / 2))
        : Math.cos(((t - bias) / (1 - bias)) * (Math.PI / 2));
      const thick = layer.thickness * profile;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      outer.push([q(ctx.x + cos * (radius + thick / 2)), q(ctx.y + sin * (radius + thick / 2))]);
      inner.push([q(ctx.x + cos * (radius - thick / 2)), q(ctx.y + sin * (radius - thick / 2))]);
    }
    g.fillStyle = layer.color;
    g.globalAlpha = layer.alpha * fade;
    g.beginPath();
    g.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i <= segments; i++) g.lineTo(outer[i][0], outer[i][1]);
    for (let i = segments; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
    g.closePath();
    g.fill();
  }

  // Spark at the leading tip, while the blade is still travelling.
  if (raw < 1) {
    const tipX = ctx.x + Math.cos(angle) * radius;
    const tipY = ctx.y + Math.sin(angle) * radius;
    g.globalAlpha = 1;
    g.fillStyle = COLORS.white;
    g.fillRect(q(tipX - step), q(tipY - step), step * 2, step * 2);
    g.fillRect(q(tipX - step * 3), q(tipY - step * 0.5), step * 6, step);
    g.fillRect(q(tipX - step * 0.5), q(tipY - step * 3), step, step * 6);
  }
  g.restore();
}

function attackFrame(attack: WeaponAttackPose, frameCount: number): number {
  const forward = Math.min(Math.floor(attack.progress * frameCount), frameCount - 1);
  return attack.def.frameDirection === 1 ? forward : frameCount - 1 - forward;
}

defineWeaponVisual('unarmed', {
  drawHeld() {},
  drawTrail: drawSlashTrail,
});

const load = (file: unknown) => loadSprite(file as SpriteFile, PAL);

// The plunge crescent, authored as pixel art. Its geometry was baked
// from the procedural arc it replaces (same radius, angles and taper),
// so it drops in without re-tuning — and being ordinary sprite rows, it
// can now be hand-edited frame by frame like any other art in the repo.
const slashCrescent = withFacing(load(slashCrescentJson).animSet());
defineSlashVisual('crescent', {
  frames: {
    right: slashCrescent.right.slash.frames,
    left: slashCrescent.left.slash.frames,
  },
  // Arc pivot: 12.5 px across the 26px sheet, 4 px ABOVE its top edge —
  // the band hangs below the pivot, which is where the hand is.
  origin: { x: 12.5, y: -4 },
});

/**
 * Sprite-backed weapons register through here so their non-art config
 * (origins, anchors, trail flag) is kept, which is what lets the sprite
 * editor re-bake a visual from an edited sheet and see it composited on
 * the knight immediately — the art swaps, the fit stays.
 */
const spriteWeaponConfigs = new Map<string, Omit<SpriteWeaponConfig, 'anims'>>();

function defineSpriteWeapon(id: string, file: unknown, config: Omit<SpriteWeaponConfig, 'anims'>): void {
  spriteWeaponConfigs.set(id, config);
  defineWeaponVisual(id, spriteWeapon({ ...config, anims: withFacing(load(file).animSet()) }));
}

/**
 * Editor seam: re-bake a sprite weapon's visual from an in-memory sheet
 * (the sprite editor's working copy). Returns false when `id` isn't a
 * sprite-backed weapon — procedural visuals have no sheet to swap.
 * Deliberate override, so it uses the registry's replace().
 */
export function rebuildSpriteWeapon(id: string, file: SpriteFile): boolean {
  const config = spriteWeaponConfigs.get(id);
  if (!config) return false;
  weaponVisuals.replace(id, spriteWeapon({ ...config, anims: withFacing(loadSprite(file, PAL).animSet()) }));
  return true;
}

defineSpriteWeapon('rusty-sword', rustySwordJson, {
  origin: { x: 16, y: 16 },
});

defineSpriteWeapon('great-sword', greatSwordJson, {
  origin: { x: 16, y: 16 },
});

/* ---- ranged visuals: procedural bow + flintlock ---- */

/** Bake a chunky icon by drawing logical pixels at TEXEL density. */
function bakedIcon(paint: (px: (x: number, y: number, w: number, h: number, color: string) => void) => void): HTMLCanvasElement {
  const [icon, g] = offscreen(8 * TEXEL, 8 * TEXEL);
  paint((x, y, w, h, color) => {
    g.fillStyle = color;
    g.fillRect(x * TEXEL, y * TEXEL, w * TEXEL, h * TEXEL);
  });
  return icon;
}

const WOOD = '#8a6b3f';
const WOOD_DARK = '#5d4728';

/**
 * The bow stave, authored as pixel art like every other sprite in the
 * game (4x8 logical px, baked once at texel density). Facing +x: the
 * belly column bows forward, tips taper back at the top and bottom
 * rows. Only the STRING (and the nocked arrow) is dynamic — pixels
 * can't bend, but a line can.
 */
const STAVE_W = 4;
const STAVE_H = 8;
const STAVE = (() => {
  const [c, g] = offscreen(STAVE_W * TEXEL, STAVE_H * TEXEL);
  const px = (x: number, y: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x * TEXEL, y * TEXEL, TEXEL, TEXEL);
  };
  px(1, 0, WOOD); // top tip — the string anchors here
  px(2, 1, WOOD);
  for (let y = 2; y <= 5; y++) {
    px(3, y, WOOD); // belly
    px(2, y, WOOD_DARK); // shaded spine, and the grip wrap
  }
  px(2, 6, WOOD);
  px(1, 7, WOOD); // bottom tip
  return c;
})();
const STAVE_FLASH = whiteOf(STAVE);

/** Where the string ties on, in grip-origin coords (art tip centers). */
const STAVE_TIP = { x: 0.5, y: 3.5 };
/** How far behind the tips a full draw anchors the nock. */
const PULL_DEPTH = 4.5;

/** How a bow should look right now — shared by every bow in the game. */
export interface BowPose {
  /** String pull-back, 0 (slack) .. 1 (full draw). */
  pull: number;
  /** Nock an arrow on the string (shown whenever pulling). */
  arrow?: boolean;
  /** Hit-flash: every part of bow and arrow in this color. */
  tint?: string;
}

/**
 * Draw the strung bow at the origin, +x forward — the caller translates
 * to the hand and mirrors for facing. The stave is the baked pixel
 * sprite; the string is drawn live — slack between the tips, or bent
 * into a V whose nock reaches behind the grip at full draw — with the
 * flying arrow's exact sprite nocked on it. The knight's held bow, the
 * archer's telegraph, and the item icon all render through here.
 */
export function drawBow(g: CanvasRenderingContext2D, pose: BowPose): void {
  const { pull, tint } = pose;
  g.drawImage(tint ? STAVE_FLASH : STAVE, -1, -STAVE_H / 2, STAVE_W, STAVE_H);

  const pulling = pull > 0.02;
  const nockX = STAVE_TIP.x - pull * PULL_DEPTH;
  g.strokeStyle = tint ?? 'rgba(255,255,255,0.8)';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(STAVE_TIP.x, -STAVE_TIP.y);
  if (pulling) g.lineTo(nockX, 0);
  g.lineTo(STAVE_TIP.x, STAVE_TIP.y);
  g.stroke();

  if (pulling && pose.arrow) {
    // The SAME arrow that flies (drawArrowSprite), nock on the string:
    // the sprite's fletching sits at -5.5 from its origin.
    g.save();
    g.translate(nockX + 5.5, 0);
    drawArrowSprite(g, tint);
    g.restore();
  }
}

// The hunting bow: a strung arc held at the knight's leading hand. The
// arc leans with the run cycle like the blades do.
defineWeaponVisual('hunting-bow', {
  // The icon IS the held bow: the same pixel stave + slack string at
  // 1:1 (the stave is authored 8 tall, exactly the icon frame) —
  // inventory, pickups, and the knight's hand can never drift apart.
  icon: (() => {
    const [icon, g] = offscreen(8 * TEXEL, 8 * TEXEL);
    g.scale(TEXEL, TEXEL);
    g.translate(3, 4);
    drawBow(g, { pull: 0 });
    return icon;
  })(),
  drawHeld(g, ctx) {
    const f = ctx.facing;
    const pull = ctx.charge ?? 0;
    let hx = 2.25;
    let hy = RANGED_HAND_Y; // grip on the shared hand line — arrows nock here
    if (pull === 0) {
      if (ctx.anim === 'run') hy += ctx.frame === 1 ? 0.5 : -0.25;
      else if (ctx.anim !== 'air') hy += Math.sin(ctx.animT * 4.5) * 0.2;
    }
    g.save();
    g.translate(hx * f, hy);
    if (f === -1) g.scale(-1, 1);
    // Charging pulls the string back with a nocked arrow riding it —
    // the pull IS the charge meter.
    drawBow(g, { pull, arrow: pull > 0 });
    g.restore();
  },
});

// The flintlock: a stubby barrel + drooping grip at the hand.
defineWeaponVisual('flintlock', {
  icon: bakedIcon((px) => {
    px(1, 3, 6, 1, COLORS.steel); px(6, 2, 1, 1, COLORS.white); // barrel + muzzle
    px(1, 4, 2, 1, WOOD); px(1, 5, 1, 2, WOOD_DARK); // stock + grip
    px(3, 4, 1, 1, COLORS.gold); // trigger guard glint
  }),
  drawHeld(g, ctx) {
    const f = ctx.facing;
    let hx = 2;
    let hy = RANGED_HAND_Y; // barrel rides the shared hand line
    if (ctx.anim === 'run') hy += ctx.frame === 1 ? 0.4 : -0.2;
    else if (ctx.anim !== 'air') hy += Math.sin(ctx.animT * 4.5) * 0.2;
    g.save();
    g.translate(hx * f, hy);
    if (f === -1) g.scale(-1, 1);
    g.fillStyle = COLORS.steel;
    g.fillRect(0, -1, 6, 1.5); // barrel
    g.fillStyle = COLORS.white;
    g.fillRect(5.4, -1.4, 0.8, 0.8); // sight
    g.fillStyle = WOOD;
    g.fillRect(-1.5, -1, 2.2, 1.6); // stock
    g.fillStyle = WOOD_DARK;
    g.fillRect(-1.2, 0.4, 1.2, 2); // grip drops toward the hand
    g.fillStyle = COLORS.gold;
    g.fillRect(0.4, 0.5, 0.8, 0.8); // trigger guard
    g.restore();
  },
});
