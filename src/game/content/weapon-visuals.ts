import {
  Registry,
  loadSprite,
  offscreen,
  whiteOf,
  withFacing,
  type FacingAnimSet,
  type LayeredSpriteFile,
  type LoadedSprite,
  type SpriteFile,
  isLayeredSpriteFile,
} from '@engine/index';
import { COLORS, PAL } from './palette';
import { orderedPlayerRenderTags, validatePlayerRenderTags } from './render-tags';
import { TEXEL } from './sprites';
import { drawArrowSprite } from './ballistics';
import { normalizedItemIcon } from './item-icon';
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
  /** Frame-authored hand points, in body-local pixels from the feet origin. */
  frontHand?: { x: number; y: number };
  rearHand?: { x: number; y: number };
  attack?: WeaponAttackPose;
  /** Hold-to-charge progress 0..1 while the wielder is drawing (the
   * player's `draw` state) — charged visuals pull their string/wind-up
   * with it. Absent when not charging. */
  charge?: number;
  /**
   * A move the WIELDER owns rather than the weapon: Impact Drop's dive
   * (`'plunge'`) and Shockwave's stomp (`'stomp'`). The weapon is not
   * being used, it is being carried through something — so a visual that
   * ignores this still renders sensibly (it just holds its idle pose,
   * which is what every melee visual already does). Absent the rest of
   * the time.
   */
  carry?: 'plunge' | 'stomp';
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
  /** Which authored hands must render in front of the weapon. */
  gripHands?: 'none' | 'front' | 'rear' | 'bothWhenCharging';
  /** Character attachment slot used to position this visual. */
  attachmentSlot?: string;
  /** Shared render bands contributed by this visual. */
  renderTags: readonly string[];
  /** Optional band for the procedural hand overlay; defaults to the visual's frontmost band. */
  gripRenderTag?: string;
  drawHeld(g: CanvasRenderingContext2D, ctx: HeldWeaponCtx): void;
  /** Draw one authored band without flattening the whole weapon. */
  drawHeldTag?(g: CanvasRenderingContext2D, ctx: HeldWeaponCtx, tag: string): void;
  /** Draw only decoration layers that survive body-authored held-object art. */
  drawEmbeddedHeldTag?(g: CanvasRenderingContext2D, ctx: HeldWeaponCtx, tag: string): void;
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
export const RANGED_HAND_Y = -7.5;

export function defineWeaponVisual(id: string, visual: WeaponVisual): void {
  const known = new Set(orderedPlayerRenderTags());
  for (const tag of visual.renderTags) {
    if (!known.has(tag)) throw new Error(`weapon visual "${id}" uses unknown render tag "${tag}"`);
  }
  if (visual.gripRenderTag && !known.has(visual.gripRenderTag)) {
    throw new Error(`weapon visual "${id}" uses unknown grip render tag "${visual.gripRenderTag}"`);
  }
  weaponVisuals.register(id, visual);
}

export function drawHeldWeapon(g: CanvasRenderingContext2D, id: string | null, ctx: HeldWeaponCtx): void {
  if (id) weaponVisuals.get(id).drawHeld(g, ctx);
}

export function drawHeldWeaponTag(
  g: CanvasRenderingContext2D,
  id: string | null,
  ctx: HeldWeaponCtx,
  tag: string,
): void {
  if (!id) return;
  const visual = weaponVisuals.get(id);
  if (visual.drawHeldTag) visual.drawHeldTag(g, ctx, tag);
  else if (visual.renderTags.includes(tag)) visual.drawHeld(g, ctx);
}

/**
 * Draw item-specific decoration over a body-authored held object. The body
 * supplies the shared weapon silhouette and pose; only layers explicitly
 * authored as composition overlays survive. Procedural and legacy weapons
 * contribute nothing here, so replacement is deterministic and data-driven.
 */
export function drawEmbeddedHeldWeaponTag(
  g: CanvasRenderingContext2D,
  id: string | null,
  ctx: HeldWeaponCtx,
  tag: string,
): void {
  if (!id) return;
  weaponVisuals.get(id).drawEmbeddedHeldTag?.(g, ctx, tag);
}

export function heldWeaponHands(id: string | null, charging: boolean): ('front' | 'rear')[] {
  if (!id) return [];
  const usage = weaponVisuals.get(id).gripHands ?? 'front';
  if (usage === 'none') return [];
  if (usage === 'rear') return ['rear'];
  return usage === 'bothWhenCharging' && charging ? ['front', 'rear'] : ['front'];
}

/** Bands this held visual contributes, entirely authored by its content. */
export function heldWeaponRenderTags(id: string | null): readonly string[] {
  return id ? weaponVisuals.get(id).renderTags : [];
}

/** Band where the generated hand overlay belongs. */
export function heldWeaponGripRenderTag(id: string | null): string | undefined {
  if (!id) return undefined;
  const visual = weaponVisuals.get(id);
  return visual.gripRenderTag ?? visual.renderTags.at(-1);
}

/** Resolve the character-side socket used by a held visual. */
export function heldWeaponAttachmentSlot(id: string | null): string {
  return id ? (weaponVisuals.get(id).attachmentSlot ?? 'mainHand') : 'mainHand';
}

export function drawWeaponTrail(g: CanvasRenderingContext2D, id: string | null, ctx: WeaponTrailCtx): void {
  if (id) weaponVisuals.get(id).drawTrail?.(g, ctx);
}

/**
 * Carry a weapon through a move it does not own — the held-pose sibling
 * of `drawNeutralTrail`.
 *
 * A visual opts in by wrapping its body in this: the weapon is tucked
 * back and angled out of the way, so a bow-armed knight diving knees-
 * first reads as diving rather than as standing still in mid-air. A
 * visual that never calls it is unchanged, which is why every melee
 * weapon needed no edit — their `drawHeld` already follows the swing.
 *
 * Written as a wrapper rather than a per-weapon pose so the NEXT
 * knight-owned move costs nothing: one entry here, and every visual that
 * already opted in carries it too.
 */
export function drawCarried(
  g: CanvasRenderingContext2D,
  ctx: HeldWeaponCtx,
  draw: () => void,
): void {
  if (!ctx.carry) {
    draw();
    return;
  }
  g.save();
  if (ctx.carry === 'plunge') {
    // Diving: the arm goes back and up, the weapon trails behind her.
    g.translate(-2.2, -1.2);
    g.rotate(-0.9);
  } else {
    // Planting her feet: braced low and tucked in, out of the way of the
    // shoulder that is doing the work.
    g.translate(-1.4, 1.6);
    g.rotate(0.5);
  }
  draw();
  g.restore();
}

/**
 * The procedural crescent, drawn for a move the WEAPON does not own.
 *
 * Impact Drop's fallback is the case: a bow and a flintlock register no
 * `drawTrail` at all, so routing that plunge through the equipped visual
 * drew nothing and the knight fell with an invisible damaging hitbox.
 * Kept separate from `drawWeaponTrail` rather than made its fallback,
 * because a visual that sets `trail: false` means it — this is for
 * attacks that belong to the knight instead.
 */
export function drawNeutralTrail(g: CanvasRenderingContext2D, ctx: WeaponTrailCtx): void {
  drawSlashTrail(g, ctx);
}

/** Resolve the UI/pickup icon owned by a registered weapon visual. */
export function weaponIcon(id: string): HTMLCanvasElement {
  const icon = weaponVisuals.get(id).icon;
  if (!icon) throw new Error(`weapon visual "${id}" has no icon`);
  return icon;
}

export interface SpriteWeaponConfig {
  /** Transparent weapon-only frames. */
  anims: FacingAnimSet;
  /** Layer-preserving source used for shared render-tag composition. */
  sprite?: LoadedSprite;
  /** Decoration-only view used when the body animation owns the weapon pose. */
  embeddedOverlaySprite?: LoadedSprite;
  /** Character attachment slot; defaults to the primary weapon hand. */
  attachmentSlot?: string;
  /** Legacy feet origin, used by animations that do not yet author a grip. */
  origin?: { x: number; y: number };
  /** Resolve the weapon-side grip point from the right-facing source art. */
  grip?: (anim: string, frame: number) => { x: number; y: number } | undefined;
  /** Optional body-frame offsets for final art alignment. */
  offsets?: Record<string, { x: number; y: number; angle?: number }[]>;
  /** Set false when the authored frames already include an attack effect. */
  trail?: boolean;
}

/** Build a visual from authored, animation-aligned sprite layers. */
export function spriteWeapon(config: SpriteWeaponConfig): WeaponVisual {
  const iconFrame = config.anims.right.idle?.frames[0]
    ?? Object.values(config.anims.right)[0]?.frames[0];
  if (!iconFrame) throw new Error('sprite weapon needs at least one frame');
  const authoredTags = config.sprite?.tags() ?? ['base'];
  const renderTags = authoredTags;
  const taggedVisuals = new Map<string, WeaponVisual>();
  if (config.sprite) {
    for (const authoredTag of authoredTags) {
      taggedVisuals.set(authoredTag, spriteWeapon({
        ...config,
        sprite: undefined,
        embeddedOverlaySprite: undefined,
        anims: withFacing(config.sprite.tagAnimSet(authoredTag)),
      }));
    }
  }
  const embeddedTaggedVisuals = new Map<string, WeaponVisual>();
  if (config.embeddedOverlaySprite) {
    for (const authoredTag of config.embeddedOverlaySprite.tags()) {
      embeddedTaggedVisuals.set(authoredTag, spriteWeapon({
        ...config,
        sprite: undefined,
        embeddedOverlaySprite: undefined,
        anims: withFacing(config.embeddedOverlaySprite.tagAnimSet(authoredTag)),
      }));
    }
  }
  return {
    icon: normalizedItemIcon(iconFrame),
    animations: Object.keys(config.anims.right),
    gripHands: 'front',
    attachmentSlot: config.attachmentSlot ?? 'mainHand',
    renderTags,
    drawHeldTag(g, ctx, tag) {
      taggedVisuals.get(tag)?.drawHeld(g, ctx);
    },
    drawEmbeddedHeldTag(g, ctx, tag) {
      embeddedTaggedVisuals.get(tag)?.drawHeld(g, ctx);
    },
    drawHeld(g, ctx) {
      const set = ctx.facing === 1 ? config.anims.right : config.anims.left;
      // A move whose named animation isn't in the sheet falls back to
      // the normal 'attack' pattern — so a sheet owes nothing beyond its
      // base swing, and per-move art is pure opt-in. Anchors key off
      // whichever animation actually drew.
      let attackName = ctx.attack?.def.animation;
      let attackAnim = attackName ? set[attackName] : undefined;
      if (ctx.attack && !attackAnim) {
        attackName = 'attack';
        attackAnim = set.attack;
      }
      // Equipment may omit locomotion-specific art. In that case keep the
      // weapon attached with its neutral pose instead of requiring redundant
      // one-frame `air`, `rise`, and `fall` tracks on every weapon sheet.
      const neutralAnim = set[ctx.anim]
        ? ctx.anim
        : set.idle
          ? 'idle'
          : Object.keys(set)[0];
      const anim = attackAnim ? attackName! : neutralAnim;
      if (!anim || !set[anim]) return;
      const frame = attackAnim
        ? attackFrame(ctx.attack!, attackAnim.frames.length)
        : bodyAlignedFrame(set[anim], ctx.frame);
      const image = set[anim].frames[frame];
      const offset = config.offsets?.[anim]?.[frame] ?? { x: 0, y: 0, angle: 0 };
      const drawW = image.width / TEXEL;
      const drawH = image.height / TEXEL;
      const origin = config.origin ?? { x: drawW / 2, y: drawH };
      const grip = config.grip?.(anim, frame);
      g.save();
      g.translate(offset.x * ctx.facing, offset.y);
      if (offset.angle) g.rotate(offset.angle * ctx.facing);
      if (grip && ctx.frontHand) {
        // Anchors are authored against the right-facing sheet. Left art is
        // pre-mirrored, so mirror both the body-local hand and the point
        // inside the weapon frame before pinning them together.
        const gripX = ctx.facing === 1 ? grip.x : drawW - grip.x;
        g.translate(ctx.frontHand.x * ctx.facing, ctx.frontHand.y);
        g.drawImage(image, -gripX, -grip.y, drawW, drawH);
      } else {
        // Partial rigs remain playable while an artist adds grip points to
        // the remaining rows; those rows retain their old feet alignment.
        g.drawImage(image, -origin.x, -origin.y, drawW, drawH);
      }
      g.restore();
    },
    drawTrail: config.trail === false ? undefined : drawSlashTrail,
  };
}

/**
 * Neutral equipment is a layer of the body pose, not an independent clock.
 * Matching the body's resolved frame keeps weapon art and grip anchors on the
 * same numbered pose even when their authored fps values differ. A shorter
 * looping layer repeats; a non-looping layer holds its final authored frame.
 */
function bodyAlignedFrame(anim: FacingAnimSet['right'][string], bodyFrame: number): number {
  return anim.loop === false
    ? Math.min(bodyFrame, anim.frames.length - 1)
    : bodyFrame % anim.frames.length;
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
    gripHands: 'front',
    renderTags: ['front-hand-held-object'],
    drawHeld(g, ctx) {
      const f = ctx.facing;
      let hx = ctx.frontHand?.x ?? 1.75;
      let hy = ctx.frontHand?.y ?? -4.5;
      if (!ctx.frontHand && ctx.anim === 'run') {
        if (ctx.frame === 0) { hx = 2.25; hy = -5.25; }
        else if (ctx.frame === 2) { hx = 1.25; hy = -5.25; }
      } else if (!ctx.frontHand && ctx.anim === 'air') {
        hx = 1.5; hy = -5;
      } else if (!ctx.frontHand) {
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
  if (trail.overlay === false) return;
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

/**
 * Which authored frame a mid-attack weapon shows.
 *
 * Frames ride the same clock the trail draws itself on: a def that
 * declares `trail.sweep` commits its whole visual early and then HOLDS
 * the final frame. The plunge is why — its 0.9s duration is a maximum
 * ended by landing, and spreading the sword's point-down rotation
 * across it meant a knight falling off the mountain turned her blade
 * in slow motion. Now the steel is committed within the first sixth,
 * like the crescent beneath it, and the rest of the fall is the ride.
 * Defs without `sweep` keep the full-duration mapping unchanged.
 */
function attackFrame(attack: WeaponAttackPose, frameCount: number): number {
  const sweepEnd = attack.def.trail.sweep ?? 1;
  const visual = Math.min(1, attack.progress / sweepEnd);
  const forward = Math.min(Math.floor(visual * frameCount), frameCount - 1);
  return attack.def.frameDirection === 1 ? forward : frameCount - 1 - forward;
}

defineWeaponVisual('unarmed', {
  gripHands: 'none',
  renderTags: [],
  drawHeld() {},
  drawTrail: drawSlashTrail,
});

/**
 * Sprite-backed weapons register through here so their non-art config
 * (origins, anchors, trail flag) is kept, which is what lets the sprite
 * editor re-bake a visual from an edited sheet and see it composited on
 * the knight immediately — the art swaps, the fit stays.
 */
type SpriteWeaponRegistrationConfig = Omit<SpriteWeaponConfig, 'anims' | 'grip'>;

const spriteWeaponConfigs = new Map<string, SpriteWeaponRegistrationConfig>();

function weaponFromSprite(file: SpriteFile, config: SpriteWeaponRegistrationConfig): WeaponVisual {
  validatePlayerRenderTags(file);
  const loaded = loadSprite(file, PAL);
  const overlayFile: LayeredSpriteFile | undefined = isLayeredSpriteFile(file)
    && file.layers.some((layer) => layer.composition === 'overlay')
    ? { ...file, layers: file.layers.filter((layer) => layer.composition === 'overlay') }
    : undefined;
  const embeddedOverlaySprite = overlayFile ? loadSprite(overlayFile, PAL) : undefined;
  return spriteWeapon({
    ...config,
    sprite: loaded,
    embeddedOverlaySprite,
    anims: withFacing(loaded.animSet()),
    grip: (anim, frame) => loaded.anchor?.('grip', anim, frame),
  });
}

function defineSpriteWeapon(id: string, file: unknown, config: SpriteWeaponRegistrationConfig): void {
  spriteWeaponConfigs.set(id, config);
  defineWeaponVisual(id, weaponFromSprite(file as SpriteFile, config));
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
  weaponVisuals.replace(id, weaponFromSprite(file, config));
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
const STAVE_W = 7;
const STAVE_H = 12;
const STAVE = (() => {
  const [c, g] = offscreen(STAVE_W * TEXEL, STAVE_H * TEXEL);
  const px = (x: number, y: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x * TEXEL, y * TEXEL, TEXEL, TEXEL);
  };
  px(1, 0, COLORS.outline); px(2, 0, WOOD); // tapered upper horn
  px(2, 1, COLORS.outline); px(3, 1, WOOD);
  px(3, 2, COLORS.outline); px(4, 2, WOOD);
  for (let y = 3; y <= 8; y++) {
    px(4, y, COLORS.outline); px(5, y, WOOD);
    if (y >= 5 && y <= 7) px(4, y, WOOD_DARK); // wrapped grip
    else px(5, y, COLORS.gold);
  }
  px(3, 9, COLORS.outline); px(4, 9, WOOD);
  px(2, 10, COLORS.outline); px(3, 10, WOOD);
  px(1, 11, COLORS.outline); px(2, 11, WOOD); // lower horn
  return c;
})();
const STAVE_FLASH = whiteOf(STAVE);

/** Where the string ties on, in grip-origin coords (art tip centers). */
const STAVE_TIP = { x: 0.5, y: 5.5 };
/** How far behind the tips a full draw anchors the nock. */
const PULL_DEPTH = 5.5;

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
  gripHands: 'bothWhenCharging',
  renderTags: ['front-hand-held-object'],
  // The icon IS the held bow: the same pixel stave + slack string at
  // 1:1 (the stave is authored 8 tall, exactly the icon frame) —
  // inventory, pickups, and the knight's hand can never drift apart.
  icon: (() => {
    const [icon, g] = offscreen(8 * TEXEL, 8 * TEXEL);
    g.scale(TEXEL, TEXEL);
    g.translate(3.1, 4);
    g.scale(0.62, 0.62);
    drawBow(g, { pull: 0 });
    return icon;
  })(),
  drawHeld(g, ctx) {
    const f = ctx.facing;
    const pull = ctx.charge ?? 0;
    // The authored anchor is signed around the body origin. In the
    // right-facing three-quarter sprite, the knight's right/weapon hand
    // is on the image's left, so forcing this positive swaps hands.
    let hx = ctx.frontHand?.x ?? 4;
    let hy = ctx.frontHand?.y ?? RANGED_HAND_Y; // authored grip; shots use the same baseline
    if (pull === 0 && !ctx.frontHand) {
      if (ctx.anim === 'run') hy += ctx.frame === 1 ? 0.5 : -0.25;
      else if (ctx.anim !== 'air') hy += Math.sin(ctx.animT * 4.5) * 0.2;
    }
    g.save();
    g.translate(hx * f, hy);
    if (f === -1) g.scale(-1, 1);
    // Charging pulls the string back with a nocked arrow riding it —
    // the pull IS the charge meter.
    drawCarried(g, ctx, () => drawBow(g, { pull, arrow: pull > 0 }));
    g.restore();
  },
});

// The flintlock: a stubby barrel + drooping grip at the hand.
defineWeaponVisual('flintlock', {
  gripHands: 'front',
  renderTags: ['front-hand-held-object'],
  icon: bakedIcon((px) => {
    px(1, 3, 6, 1, COLORS.steel); px(6, 2, 1, 1, COLORS.white); // barrel + muzzle
    px(1, 4, 2, 1, WOOD); px(1, 5, 1, 2, WOOD_DARK); // stock + grip
    px(3, 4, 1, 1, COLORS.gold); // trigger guard glint
  }),
  drawHeld(g, ctx) {
    const f = ctx.facing;
    let hx = ctx.frontHand?.x ?? 4;
    let hy = ctx.frontHand?.y ?? RANGED_HAND_Y; // barrel rides the authored hand
    if (!ctx.frontHand && ctx.anim === 'run') hy += ctx.frame === 1 ? 0.4 : -0.2;
    else if (!ctx.frontHand && ctx.anim !== 'air') hy += Math.sin(ctx.animT * 4.5) * 0.2;
    g.save();
    g.translate(hx * f, hy);
    if (f === -1) g.scale(-1, 1);
    drawCarried(g, ctx, () => {
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
    });
    g.restore();
  },
});
