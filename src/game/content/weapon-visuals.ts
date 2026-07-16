import {
  Registry,
  frameAt,
  loadSprite,
  offscreen,
  withFacing,
  type FacingAnimSet,
  type SpriteFile,
} from '@engine/index';
import { COLORS, PAL } from './palette';
import { TEXEL } from './sprites';
import greatSwordJson from './sprites/equipment/great-sword.json';
import rustySwordJson from './sprites/equipment/rusty-sword.json';
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

function drawSlashTrail(g: CanvasRenderingContext2D, ctx: WeaponTrailCtx): void {
  const { attack } = ctx;
  const trail = attack.def.trail;
  const radius = trail.radius;
  const sweepT = Math.min(1, attack.progress / attack.def.active[1]);
  const sweep = trail.startAngle + (trail.endAngle - trail.startAngle) * sweepT;
  const angle = ctx.facing === 1 ? sweep : Math.PI - sweep;
  const start = ctx.facing === 1 ? trail.startAngle : Math.PI - trail.startAngle;
  const q = (value: number) => Math.round(value * TEXEL) / TEXEL;
  const step = 1 / TEXEL;
  const layers = [
    { color: ctx.colors[0] ?? COLORS.steel, thickness: trail.thickness, alpha: 0.4 },
    { color: COLORS.white, thickness: trail.thickness * 0.45, alpha: 0.8 },
  ];
  const segments = 24;

  g.save();
  for (const layer of layers) {
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const theta = start + (angle - start) * t;
      const profile = t < 0.8
        ? Math.sin((t / 0.8) * (Math.PI / 2))
        : Math.cos(((t - 0.8) / 0.2) * (Math.PI / 2));
      const thick = layer.thickness * profile;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      outer.push([q(ctx.x + cos * (radius + thick / 2)), q(ctx.y + sin * (radius + thick / 2))]);
      inner.push([q(ctx.x + cos * (radius - thick / 2)), q(ctx.y + sin * (radius - thick / 2))]);
    }
    g.fillStyle = layer.color;
    g.globalAlpha = layer.alpha;
    g.beginPath();
    g.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i <= segments; i++) g.lineTo(outer[i][0], outer[i][1]);
    for (let i = segments; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
    g.closePath();
    g.fill();
  }
  g.restore();

  const tipX = ctx.x + Math.cos(angle) * radius;
  const tipY = ctx.y + Math.sin(angle) * radius;
  g.fillStyle = COLORS.white;
  g.fillRect(q(tipX - step), q(tipY - step), step * 2, step * 2);
  g.fillRect(q(tipX - step * 3), q(tipY - step * 0.5), step * 6, step);
  g.fillRect(q(tipX - step * 0.5), q(tipY - step * 3), step, step * 6);
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

defineWeaponVisual('rusty-sword', spriteWeapon({
  anims: withFacing(load(rustySwordJson).animSet()),
  origin: { x: 16, y: 16 },
}));

defineWeaponVisual('great-sword', spriteWeapon({
  anims: withFacing(load(greatSwordJson).animSet()),
  origin: { x: 16, y: 16 },
}));
