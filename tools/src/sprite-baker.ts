import {
  compositeSpriteFrame,
  isLayeredSpriteFile,
  resolveAnimName,
  type FlatSpriteFile,
  type LayeredSpriteFile,
  type SpriteAnchor,
  type SpriteFile,
  type SpriteGeometry,
  type SpriteLayerData,
} from '../../src/engine/gfx/spritefile';
import { validateSpriteEditorDocument } from './sprite-editor-document';
import type { SpriteCriticOptions } from './sprite-critic';

/**
 * Headless 3D-to-2D Toon/Pixel Sprite Baker (Dead Cells style).
 *
 * Agents define a 3D hierarchical skeleton of analytical CSG primitives with
 * discrete pixel-art Material Ramps and parametric/keyframed bone animations.
 * The baker raymarches the 3D scene through an orthographic camera, applies
 * directional toon shading + ambient occlusion + rear-limb depth darkening +
 * silhouette & depth-crease pixel outlines, projects 3D bone sockets directly
 * into 2D `SpriteFile.anchors`, and outputs a validated `SpriteFile` JSON
 * plus an RGBA contact sheet ready for PNG encoding or canvas inspection.
 *
 * Coordinate convention (logical game pixels):
 *   +X : right (forward for right-facing sprites)
 *   +Y : up (height above the ground baseline)
 *   +Z : toward viewer / foreground (z > 0 is front limb, z < 0 is rear limb)
 */

export type Vec3 = [number, number, number];

export interface BakerMaterial {
  /** Optional 1px internal part-seam ink-crease color (defaults to deepShadow ?? shadow). */
  crease?: string;
  /** Optional deepest crevice/surface shadow stop for 5-stop pixel art shading. */
  deepShadow?: string;
  /** Hex colors from darkest shadow to brightest highlight. */
  shadow: string;
  mid: string;
  lit?: string;
  highlight?: string;
  /** Optional specular threshold (0..1, e.g. 0.92 for metallic/eye glint). */
  specular?: number;
  /** True for glowing features (eyes, runes, spell cores) that ignore shadow/AO. */
  emissive?: boolean;
  /** Apply ordered 2x2 Bayer dithering at toon band transitions. */
  dither?: boolean;
  /** Optional per-material outline color override (null disables outline on this material). */
  outline?: string | null;
}

export type BakerCsgOp = 'union' | 'smoothUnion' | 'subtract' | 'intersect';

export interface BakerShapeBase {
  id?: string;
  material: string;
  op?: BakerCsgOp;
  /** Smooth blending radius in logical pixels (for smoothUnion / subtract). */
  blend?: number;
  /** Local translation offset from the owning bone. */
  offset?: Vec3;
  /** Local Euler rotation [rx, ry, rz] in degrees. */
  rot?: Vec3;
  /** Optional part group override for internal depth-crease outlines. */
  partGroup?: string;
  /** Optional sculpted surface fold/groove modulation for cloth, hair locks, or chitin. */
  folds?: {
    freq: number;
    amp: number;
    axis?: 'x' | 'y' | 'z' | 'xy' | 'yx';
  };
  /**
   * When true, this shape acts as a depth matte-cutout occluder: rays hitting it
   * in front of other shapes leave the pixel transparent (`.`), allowing wearable
   * equipment (helmets, armor, capes) to wrap cleanly around an invisible body rig.
   */
  occluder?: boolean;
}

export interface SphereShape extends BakerShapeBase {
  type: 'sphere';
  radius: number;
}

export interface EllipsoidShape extends BakerShapeBase {
  type: 'ellipsoid';
  radii: Vec3;
}

export interface CapsuleShape extends BakerShapeBase {
  type: 'capsule';
  a: Vec3;
  b: Vec3;
  /** Optional quadratic Bezier control point for curved hair spikes, cloth tails, horns, or bows. */
  via?: Vec3;
  radius: number;
  /** Optional radius at endpoint `b` for tapered limbs, horns, or cloaks. */
  radiusB?: number;
}

export interface BoxShape extends BakerShapeBase {
  type: 'box';
  /** Half-extents [hx, hy, hz]. */
  size: Vec3;
  /** Optional corner rounding radius. */
  bevel?: number;
}

export interface CylinderShape extends BakerShapeBase {
  type: 'cylinder';
  a: Vec3;
  b: Vec3;
  radius: number;
  /** Optional radius at endpoint `b` for cones / tapered cylinders. */
  radiusB?: number;
}

export interface TorusShape extends BakerShapeBase {
  type: 'torus';
  radius: number;
  tube: number;
  axis?: 'x' | 'y' | 'z';
}

export interface LatheShape extends BakerShapeBase {
  type: 'lathe';
  /**
   * 2D profile points `[y, radius]` revolved around the local Y axis.
   * Ideal for bells, helmets, robes, pots, and armor domes.
   */
  profile: Array<[number, number]>;
}

export interface ReliefFrameGrid {
  w: number;
  h: number;
  /** Sub-pixel origin [oxSub, oySub] corresponding to the rig/bone origin (0, 0, 0). */
  originSub: [number, number];
  rows: string[];
}

export interface ReliefShape extends BakerShapeBase {
  type: 'relief';
  /** Half-thickness of the 3D relief slab along Z in logical pixels (default 1.5). */
  thickness?: number;
  /** Sub-pixel density (default 4 = 0.25 logical px per cell). */
  density?: number;
  /** Camera pitch in degrees used when projecting the 3D relief volume (default 7). */
  pitchDeg?: number;
  /** Palette map from character key in `rows` to hex color. */
  palette: Record<string, string>;
  /** Default 3D relief grid. */
  grid: ReliefFrameGrid;
  /** Optional per-animation, per-frame articulated 3D relief grids. */
  animGrids?: Record<string, ReliefFrameGrid[]>;
  /**
   * When true, this 3D relief volume defines the complete sculpted surface for
   * frames it covers while keeping the 3D bone hierarchy active for sockets.
   */
  authoritative?: boolean;
}

export type BakerShape =
  | SphereShape
  | EllipsoidShape
  | CapsuleShape
  | BoxShape
  | CylinderShape
  | TorusShape
  | LatheShape
  | ReliefShape;

export interface BakerBoneDef {
  id: string;
  parent?: string;
  /** Rest position relative to parent bone (or rig origin if root). */
  pos?: Vec3;
  /** Rest Euler rotation [rx, ry, rz] in degrees. */
  rot?: Vec3;
  /** Rest scale [sx, sy, sz]. */
  scale?: Vec3;
  /** Part group id for internal crease outlines (e.g. 'frontArm', 'torso', 'head'). */
  partGroup?: string;
  /** Optional target sprite layer id (when baking a LayeredSpriteFile). */
  layerId?: string;
  /**
   * When true, all shapes on this bone act as matte-cutout depth occluders
   * (rays hitting an occluder in front of visible geometry leave the pixel `.`).
   */
  occluder?: boolean;
  /** 3D CSG shapes attached to this bone. */
  shapes?: BakerShape[];
}

export interface BonePose {
  pos?: Vec3;
  rot?: Vec3;
  scale?: Vec3;
  /** Optional visibility toggle for frame-specific effects or severable limbs. */
  visible?: boolean;
}

export interface BakerSocketDef {
  /** Bone this socket is parented to. */
  bone: string;
  /** Local offset from the bone origin. */
  pos?: Vec3;
  /** Local direction vector to compute `SpriteAnchor.angle` (defaults to [+1, 0, 0]). */
  dir?: Vec3;
  /** Optional per-animation/frame exact anchor overrides when matching authored landmarks. */
  frames?: Record<string, SpriteAnchor[]>;
  /** Optional animation names for which this socket should be omitted from `anchors`. */
  omitAnims?: string[];
}

export interface BakerAnimationDef {
  fps: number;
  frames: number;
  loop?: boolean;
  /** Alias another animation by name, or supply a procedural/keyframe pose callback. */
  aliasOf?: string;
  /**
   * Return per-bone pose deltas for `frame` (`0 .. frames-1`) and normalized
   * cycle progress `t` (`0 .. 1`).
   */
  pose?: (t: number, frame: number) => Record<string, BonePose>;
}

export interface BakerLayerSpec {
  id: string;
  name: string;
  tag: string;
  composition?: 'base' | 'overlay';
}

export interface BakerRigDef {
  name: string;
  /** Logical width in game pixels. */
  w: number;
  /** Logical height in game pixels. */
  h: number;
  /**
   * When `true` (default), bakes 1 cell per logical pixel (`hd: true`, runtime EPX 4x).
   * When `false`, bakes at 4x texel density (`hd: false`, 4 cells per logical pixel).
   */
  hd?: boolean;
  /** Feet / root origin in logical pixels from top-left (defaults to `{ x: w / 2, y: h - 1 }`). */
  origin?: { x: number; y: number };
  hitbox?: SpriteGeometry['hitbox'];
  /** Optional per-animation hitbox offsets matching `SpriteFile.animationHitboxOffsets`. */
  animationHitboxOffsets?: SpriteFile['animationHitboxOffsets'];
  /** Optional editor metadata such as `{ canEquipWeapon: true }`. */
  editor?: { canEquipWeapon?: boolean };
  /** Camera pitch in degrees (positive tilts camera down to show top surfaces; default 8). */
  cameraPitch?: number;
  /** Directional light vector [x, y, z] (default upper-left-front `[-0.48, 0.68, 0.55]`). */
  lightDir?: Vec3;
  /** Default outer/crease outline hex color (default `#10111c`). */
  outlineColor?: string;
  /** Outline placement mode: `'outside'` expands into empty neighbors; `'inside'` erodes boundary. */
  outlineMode?: 'outside' | 'inside' | 'none';
  /** Minimum depth jump (in logical pixels) between different `partGroup`s to draw an internal crease line. */
  creaseThreshold?: number;
  /** Automatically step rear-depth shapes (`z < rearShadeZ`) down one shade so back limbs separate cleanly. */
  rearShadeZ?: number;
  /** Named material ramps. */
  materials: Record<string, BakerMaterial>;
  /** Optional layer definitions when baking a multi-layer SpriteFile. */
  layers?: BakerLayerSpec[];
  /** Hierarchical 3D bones and their attached CSG shapes. */
  bones: BakerBoneDef[];
  /** Named 3D sockets that project into `SpriteFile.anchors` (`frontHand`, `rearHand`, `head`, `grip`). */
  sockets?: Record<string, BakerSocketDef>;
  /** Attachment slot mapping for the sprite editor / runtime. */
  attachmentSlots?: SpriteFile['attachmentSlots'];
  /** Optional self-check critic rules & actor contract expectations. */
  critic?: SpriteCriticOptions;
  /** Animation definitions. */
  anims: Record<string, BakerAnimationDef>;
}

/* ---------------- 3D math & transforms ---------------- */

const DEG2RAD = Math.PI / 180;

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type Mat4 = Float64Array;

function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

function mat4FromTRS(pos: Vec3, rotDeg: Vec3, scale: Vec3): Mat4 {
  const rx = rotDeg[0] * DEG2RAD;
  const ry = rotDeg[1] * DEG2RAD;
  const rz = rotDeg[2] * DEG2RAD;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;

  const out = new Float64Array(16);
  out[0] = r00 * scale[0]; out[1] = r01 * scale[1]; out[2] = r02 * scale[2]; out[3] = pos[0];
  out[4] = r10 * scale[0]; out[5] = r11 * scale[1]; out[6] = r12 * scale[2]; out[7] = pos[1];
  out[8] = r20 * scale[0]; out[9] = r21 * scale[1]; out[10] = r22 * scale[2]; out[11] = pos[2];
  out[15] = 1;
  return out;
}

function mat4InvertAffine(m: Mat4): Mat4 {
  const a00 = m[0], a01 = m[1], a02 = m[2], tx = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], ty = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], tz = m[11];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-10) return mat4Identity();
  det = 1.0 / det;

  const i00 = b01 * det;
  const i01 = (-a22 * a01 + a02 * a21) * det;
  const i02 = (a12 * a01 - a02 * a11) * det;
  const i10 = b11 * det;
  const i11 = (a22 * a00 - a02 * a20) * det;
  const i12 = (-a12 * a00 + a02 * a10) * det;
  const i20 = b21 * det;
  const i21 = (-a21 * a00 + a01 * a20) * det;
  const i22 = (a11 * a00 - a01 * a10) * det;

  const out = new Float64Array(16);
  out[0] = i00; out[1] = i01; out[2] = i02;
  out[3] = -(i00 * tx + i01 * ty + i02 * tz);
  out[4] = i10; out[5] = i11; out[6] = i12;
  out[7] = -(i10 * tx + i11 * ty + i12 * tz);
  out[8] = i20; out[9] = i21; out[10] = i22;
  out[11] = -(i20 * tx + i21 * ty + i22 * tz);
  out[15] = 1;
  return out;
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
    m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
    m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
  ];
}

/* ---------------- SDF primitives ---------------- */

function sdSphere(p: Vec3, r: number): number {
  return Math.hypot(p[0], p[1], p[2]) - r;
}

function sdEllipsoid(p: Vec3, r: Vec3): number {
  const rx = Math.max(0.001, r[0]);
  const ry = Math.max(0.001, r[1]);
  const rz = Math.max(0.001, r[2]);
  const k0 = Math.hypot(p[0] / rx, p[1] / ry, p[2] / rz);
  if (k0 < 1e-6) return -Math.min(rx, ry, rz);
  const k1 = Math.hypot(p[0] / (rx * rx), p[1] / (ry * ry), p[2] / (rz * rz));
  return (k0 * (k0 - 1.0)) / k1;
}

function sdCapsule(p: Vec3, a: Vec3, b: Vec3, r1: number, r2 = r1): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-6) return Math.hypot(pax, pay, paz) - r1;
  const h = clamp((pax * bax + pay * bay + paz * baz) / baba, 0, 1);
  const r = r1 + (r2 - r1) * h;
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

function sdBox(p: Vec3, b: Vec3, bevel = 0): number {
  const qx = Math.abs(p[0]) - Math.max(0.001, b[0] - bevel);
  const qy = Math.abs(p[1]) - Math.max(0.001, b[1] - bevel);
  const qz = Math.abs(p[2]) - Math.max(0.001, b[2] - bevel);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return out + inside - bevel;
}

function sdCylinder(p: Vec3, a: Vec3, b: Vec3, r1: number, r2 = r1): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-6) return Math.hypot(pax, pay, paz) - r1;
  const paba = pax * bax + pay * bay + paz * baz;
  const t = paba / baba;
  const h = clamp(t, 0, 1);
  const r = r1 + (r2 - r1) * h;
  const cx = pax - bax * t, cy = pay - bay * t, cz = paz - baz * t;
  const radial = Math.hypot(cx, cy, cz) - r;
  const halfLen = Math.sqrt(baba) * 0.5;
  const axial = Math.abs((t - 0.5) * Math.sqrt(baba)) - halfLen;
  return Math.hypot(Math.max(radial, 0), Math.max(axial, 0)) + Math.min(Math.max(radial, axial), 0);
}

function sdTorus(p: Vec3, radius: number, tube: number, axis: 'x' | 'y' | 'z' = 'z'): number {
  let u = p[0], v = p[1], w = p[2];
  if (axis === 'x') { u = p[1]; v = p[2]; w = p[0]; }
  else if (axis === 'y') { u = p[0]; v = p[2]; w = p[1]; }
  const q = Math.hypot(u, v) - radius;
  return Math.hypot(q, w) - tube;
}

function sdLathe(p: Vec3, profile: Array<[number, number]>): number {
  if (profile.length < 2) return 1e6;
  const r = Math.hypot(p[0], p[2]);
  const y = p[1];
  const yMin = profile[0][0];
  const yMax = profile[profile.length - 1][0];
  let minWallDist = 1e6;
  const yc = clamp(y, yMin, yMax);
  let profileRAtY = profile[0][1];

  for (let i = 0; i < profile.length - 1; i++) {
    const [y0, r0] = profile[i];
    const [y1, r1] = profile[i + 1];
    const dy = y1 - y0;
    const dr = r1 - r0;
    const lenSq = dy * dy + dr * dr;
    const tSeg = lenSq < 1e-6 ? 0 : clamp(((y - y0) * dy + (r - r0) * dr) / lenSq, 0, 1);
    const dSeg = Math.hypot(y - (y0 + dy * tSeg), r - (r0 + dr * tSeg));
    if (dSeg < minWallDist) minWallDist = dSeg;

    if (yc >= y0 && yc <= y1) {
      const ty = Math.abs(dy) < 1e-6 ? 0 : clamp((yc - y0) / dy, 0, 1);
      profileRAtY = r0 + dr * ty;
    }
  }

  // Distance to bottom and top radial disks
  const rBottom = profile[0][1];
  const dBottom = Math.hypot(y - yMin, Math.max(0, r - rBottom));
  const rTop = profile[profile.length - 1][1];
  const dTop = Math.hypot(y - yMax, Math.max(0, r - rTop));
  const unsignedDist = Math.min(minWallDist, dBottom, dTop);

  const inside = y >= yMin && y <= yMax && r <= profileRAtY;
  return inside ? -unsignedDist : unsignedDist;
}

function sdBezierCapsule(p: Vec3, a: Vec3, via: Vec3, b: Vec3, r1: number, r2 = r1): number {
  let minD = 1e6;
  const steps = 4;
  let prevX = a[0], prevY = a[1], prevZ = a[2];
  let prevR = r1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    const curX = inv * inv * a[0] + 2 * inv * t * via[0] + t * t * b[0];
    const curY = inv * inv * a[1] + 2 * inv * t * via[1] + t * t * b[1];
    const curZ = inv * inv * a[2] + 2 * inv * t * via[2] + t * t * b[2];
    const curR = r1 + (r2 - r1) * t;
    const d = sdCapsule(p, [prevX, prevY, prevZ], [curX, curY, curZ], prevR, curR);
    if (d < minD) minD = d;
    prevX = curX; prevY = curY; prevZ = curZ;
    prevR = curR;
  }
  return minD;
}

function sampleFoldAxis(p: Vec3, axis: 'x' | 'y' | 'z' | 'xy' | 'yx' = 'y'): number {
  switch (axis) {
    case 'x':
      return p[0] + p[1] * 0.28;
    case 'z':
      return p[2] + p[1] * 0.25;
    case 'xy':
      return p[0] * 0.75 + p[1] * 0.65;
    case 'yx':
      return p[1] * 0.75 - p[0] * 0.55;
    case 'y':
    default:
      return p[1] + p[0] * 0.35;
  }
}

function evaluatePrimitive(shape: BakerShape, p: Vec3): number {
  let d = 0;
  switch (shape.type) {
    case 'sphere':
      d = sdSphere(p, shape.radius);
      break;
    case 'ellipsoid':
      d = sdEllipsoid(p, shape.radii);
      break;
    case 'capsule':
      d = shape.via
        ? sdBezierCapsule(p, shape.a, shape.via, shape.b, shape.radius, shape.radiusB ?? shape.radius)
        : sdCapsule(p, shape.a, shape.b, shape.radius, shape.radiusB ?? shape.radius);
      break;
    case 'box':
      d = sdBox(p, shape.size, shape.bevel ?? 0);
      break;
    case 'cylinder':
      d = sdCylinder(p, shape.a, shape.b, shape.radius, shape.radiusB ?? shape.radius);
      break;
    case 'torus':
      d = sdTorus(p, shape.radius, shape.tube, shape.axis ?? 'z');
      break;
    case 'lathe':
      d = sdLathe(p, shape.profile);
      break;
    case 'relief': {
      const density = shape.density ?? 4;
      const pitchRad = (shape.pitchDeg ?? 7) * DEG2RAD;
      const cosP = Math.cos(pitchRad);
      const sinP = Math.sin(pitchRad);
      const projX = p[0];
      const projY = p[1] * cosP - p[2] * sinP;
      const projZ = p[1] * sinP + p[2] * cosP;
      const gx = Math.floor(projX * density + shape.grid.originSub[0]);
      const gy = Math.floor(shape.grid.originSub[1] - projY * density);
      if (gx < 0 || gy < 0 || gx >= shape.grid.w || gy >= shape.grid.h) {
        return 8.0;
      }
      const ch = shape.grid.rows[gy]?.[gx] ?? '.';
      if (ch === '.' || ch === ' ') return 8.0;
      const halfZ = shape.thickness ?? 1.5;
      return Math.abs(projZ) - halfZ;
    }
  }
  if (shape.folds && Math.abs(d) < 1.2) {
    const ax = sampleFoldAxis(p, shape.folds.axis);
    // Keep geometric silhouette displacement subtle while shade-space modulation
    // carves crisp pixel-art cloth fold valleys and ridges across toon thresholds.
    d += Math.sin(ax * shape.folds.freq) * (shape.folds.amp * 0.32);
  }
  return d;
}

function localShapeBounds(shape: BakerShape): { center: Vec3; radius: number } {
  switch (shape.type) {
    case 'sphere':
      return { center: [0, 0, 0], radius: shape.radius };
    case 'ellipsoid':
      return {
        center: [0, 0, 0],
        radius: Math.max(shape.radii[0], shape.radii[1], shape.radii[2]),
      };
    case 'capsule':
    case 'cylinder': {
      const pts: Vec3[] = shape.type === 'capsule' && shape.via ? [shape.a, shape.via, shape.b] : [shape.a, shape.b];
      let minX = 1e6, maxX = -1e6, minY = 1e6, maxY = -1e6, minZ = 1e6, maxZ = -1e6;
      for (const pt of pts) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
        if (pt[2] < minZ) minZ = pt[2];
        if (pt[2] > maxZ) maxZ = pt[2];
      }
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const cz = (minZ + maxZ) * 0.5;
      const halfSpan = 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
      return {
        center: [cx, cy, cz],
        radius: halfSpan + Math.max(shape.radius, shape.radiusB ?? shape.radius) + (shape.folds?.amp ?? 0),
      };
    }
    case 'box':
      return {
        center: [0, 0, 0],
        radius: Math.hypot(shape.size[0], shape.size[1], shape.size[2]) + (shape.bevel ?? 0) + (shape.folds?.amp ?? 0),
      };
    case 'torus':
      return { center: [0, 0, 0], radius: shape.radius + shape.tube + (shape.folds?.amp ?? 0) };
    case 'lathe': {
      if (shape.profile.length === 0) return { center: [0, 0, 0], radius: 1 };
      const yMin = shape.profile[0][0];
      const yMax = shape.profile[shape.profile.length - 1][0];
      let maxR = 0;
      for (const [, r] of shape.profile) {
        if (r > maxR) maxR = r;
      }
      return {
        center: [0, 0.5 * (yMin + yMax), 0],
        radius: Math.hypot(0.5 * (yMax - yMin), maxR) + (shape.folds?.amp ?? 0),
      };
    }
    case 'relief': {
      const density = shape.density ?? 4;
      const halfW = (shape.grid.w / density) * 0.5 + 2;
      const halfH = (shape.grid.h / density) * 0.5 + 2;
      return {
        center: [0, halfH * 0.5, 0],
        radius: Math.hypot(halfW, halfH, (shape.thickness ?? 1.5) + 2),
      };
    }
  }
}

interface CompiledShape {
  shape: BakerShape;
  activeReliefGrid?: ReliefFrameGrid;
  invWorld: Mat4;
  worldScale: number;
  worldCenter: Vec3;
  worldBoundR: number;
  partGroup: string;
  layerId: string;
  occluder: boolean;
}

interface CompiledGroup {
  partGroup: string;
  layerId: string;
  shapes: CompiledShape[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface SceneHit {
  dist: number;
  material: string;
  partGroup: string;
  layerId: string;
  occluder: boolean;
  group: CompiledGroup;
  reliefHex?: string;
}

function evalReliefGrid(
  shape: ReliefShape,
  grid: ReliefFrameGrid,
  p: Vec3,
): { dist: number; hex: string } {
  const density = shape.density ?? 4;
  const pitchRad = (shape.pitchDeg ?? 7) * DEG2RAD;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const projX = p[0];
  const projY = p[1] * cosP - p[2] * sinP;
  const projZ = p[1] * sinP + p[2] * cosP;
  const gx = Math.floor(projX * density + grid.originSub[0]);
  const gy = Math.floor(grid.originSub[1] - projY * density);
  if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) {
    return { dist: 8.0, hex: '' };
  }
  const ch = grid.rows[gy]?.[gx] ?? '.';
  if (ch === '.' || ch === ' ') {
    return { dist: 8.0, hex: '' };
  }
  const halfZ = shape.thickness ?? 1.5;
  return {
    dist: Math.abs(projZ) - halfZ,
    hex: shape.palette[ch] ?? '',
  };
}

function evalGroup(
  group: CompiledGroup,
  worldP: Vec3,
): { dist: number; material: string; occluder: boolean; reliefHex?: string } {
  let d = 1e6;
  let mat = group.shapes[0]?.shape.material ?? '';
  let occ = group.shapes[0]?.occluder ?? false;
  let reliefHex: string | undefined = undefined;
  for (let i = 0; i < group.shapes.length; i++) {
    const cs = group.shapes[i];
    const op = cs.shape.op ?? 'union';
    if (i > 0 && op === 'union') {
      const dx = worldP[0] - cs.worldCenter[0];
      const dy = worldP[1] - cs.worldCenter[1];
      const dz = worldP[2] - cs.worldCenter[2];
      if (dx * dx + dy * dy + dz * dz > (d + cs.worldBoundR) * (d + cs.worldBoundR) && d + cs.worldBoundR > 0) {
        continue;
      }
    }
    const localP = transformPoint(cs.invWorld, worldP);
    let sd = 0;
    let curReliefHex: string | undefined = undefined;
    if (cs.shape.type === 'relief') {
      const rRes = evalReliefGrid(cs.shape, cs.activeReliefGrid ?? cs.shape.grid, localP);
      sd = rRes.dist * cs.worldScale;
      curReliefHex = rRes.hex || undefined;
    } else {
      sd = evaluatePrimitive(cs.shape, localP) * cs.worldScale;
    }
    const k = Math.max(0.001, cs.shape.blend ?? 0.8);
    if (i === 0) {
      d = sd;
      mat = cs.shape.material;
      occ = cs.occluder;
      reliefHex = curReliefHex;
      continue;
    }
    if (op === 'union') {
      if (sd < d) {
        d = sd;
        mat = cs.shape.material;
        occ = cs.occluder;
        reliefHex = curReliefHex;
      }
    } else if (op === 'smoothUnion') {
      const h = clamp(0.5 + (0.5 * (d - sd)) / k, 0, 1);
      if (h > 0.5) {
        mat = cs.shape.material;
        occ = cs.occluder;
        reliefHex = curReliefHex;
      }
      d = d * (1 - h) + sd * h - k * h * (1 - h);
    } else if (op === 'subtract') {
      if (cs.shape.blend && cs.shape.blend > 0) {
        const h = clamp(0.5 - (0.5 * (d + sd)) / k, 0, 1);
        if (-sd > d) mat = cs.shape.material;
        d = d * (1 - h) + (-sd) * h + k * h * (1 - h);
      } else {
        if (-sd > d) {
          d = -sd;
          mat = cs.shape.material;
        }
      }
    } else if (op === 'intersect') {
      if (sd > d) {
        d = sd;
        mat = cs.shape.material;
        occ = cs.occluder;
        reliefHex = curReliefHex;
      }
    }
  }
  return { dist: d, material: mat, occluder: occ, reliefHex };
}

function evalScene(groups: CompiledGroup[], worldP: Vec3, filterLayerId?: string): SceneHit {
  let bestDist = 1e6;
  let bestMat = '';
  let bestGroup = '';
  let bestLayer = '';
  let bestOcc = false;
  let bestGroupObj = groups[0];
  let bestReliefHex: string | undefined = undefined;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (filterLayerId && group.layerId !== filterLayerId) continue;
    const res = evalGroup(group, worldP);
    if (res.dist < bestDist) {
      bestDist = res.dist;
      bestMat = res.material;
      bestGroup = group.partGroup;
      bestLayer = group.layerId;
      bestOcc = res.occluder;
      bestGroupObj = group;
      bestReliefHex = res.reliefHex;
    }
  }
  return {
    dist: bestDist,
    material: bestMat,
    partGroup: bestGroup,
    layerId: bestLayer,
    occluder: bestOcc,
    group: bestGroupObj,
    reliefHex: bestReliefHex,
  };
}

function calcGroupNormal(group: CompiledGroup, p: Vec3): Vec3 {
  const e = 0.06;
  const dx = evalGroup(group, [p[0] + e, p[1], p[2]]).dist -
             evalGroup(group, [p[0] - e, p[1], p[2]]).dist;
  const dy = evalGroup(group, [p[0], p[1] + e, p[2]]).dist -
             evalGroup(group, [p[0], p[1] - e, p[2]]).dist;
  const dz = evalGroup(group, [p[0], p[1], p[2] + e]).dist -
             evalGroup(group, [p[0], p[1], p[2] - e]).dist;
  return normalize3([dx, dy, dz]);
}

function calcAmbientOcclusion(groups: CompiledGroup[], p: Vec3, n: Vec3, filterLayerId?: string): number {
  let occ = 0;
  let weight = 1;
  for (const step of [0.35, 0.8, 1.5]) {
    const sampleP: Vec3 = [p[0] + n[0] * step, p[1] + n[1] * step, p[2] + n[2] * step];
    const d = evalScene(groups, sampleP, filterLayerId).dist;
    occ += Math.max(0, step - d) * weight;
    weight *= 0.55;
  }
  return clamp(1 - occ * 0.45, 0.25, 1);
}

/* ---------------- Palette allocation & Toon shading ---------------- */

const PALETTE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+=!?~^;:,<>[]{}()_-|`' +
  Array.from({ length: 256 }, (_, index) => String.fromCharCode(0x0100 + index)).join('');

const BAYER2X2 = [
  [-0.06, 0.06],
  [0.12, -0.12],
];

interface ResolvedPalette {
  palette: Record<string, string>;
  charForHex: (hex: string) => string;
}

function buildRigPalette(rig: BakerRigDef): ResolvedPalette {
  const palette: Record<string, string> = {};
  const hexToChar = new Map<string, string>();
  const charToRgba = new Map<string, [number, number, number, number]>();
  let nextIdx = 0;

  const normalizeHex = (h: string): string => {
    const clean = h.trim().toLowerCase().replace(/^#/, '');
    if (clean.length === 8 && clean.endsWith('ff')) {
      return `#${clean.slice(0, 6)}`;
    }
    return `#${clean}`;
  };

  const parseRgba = (h: string): [number, number, number, number] => {
    const clean = h.replace(/^#/, '');
    return [
      Number.parseInt(clean.slice(0, 2), 16) || 0,
      Number.parseInt(clean.slice(2, 4), 16) || 0,
      Number.parseInt(clean.slice(4, 6), 16) || 0,
      clean.length >= 8 ? Number.parseInt(clean.slice(6, 8), 16) : 255,
    ];
  };

  const maxColors = rig.critic?.maxPaletteColors ?? 30;

  const registerHex = (rawHex: string | undefined | null, allowQuantize = false): string => {
    if (!rawHex) return '.';
    const hex = normalizeHex(rawHex);
    const existing = hexToChar.get(hex);
    if (existing) return existing;
    const rgba = parseRgba(hex);
    if (allowQuantize) {
      let bestCh = '';
      let bestDist = nextIdx >= maxColors ? 1e6 : 12.0;
      for (const [ch, cRgba] of charToRgba.entries()) {
        if (ch === '0') continue; // never alias into reserved outer outline slot '0'
        // Never merge an opaque color with a translucent color
        if ((rgba[3] === 255) !== (cRgba[3] === 255)) continue;
        const d = Math.hypot(
          rgba[0] - cRgba[0],
          rgba[1] - cRgba[1],
          rgba[2] - cRgba[2],
          (rgba[3] - cRgba[3]) * 1.5,
        );
        if (d < bestDist) {
          bestDist = d;
          bestCh = ch;
        }
      }
      if (bestCh) {
        hexToChar.set(hex, bestCh);
        return bestCh;
      }
    }
    if (nextIdx >= PALETTE_CHARS.length) {
      throw new Error(`rig "${rig.name}" exceeds maximum palette size (${PALETTE_CHARS.length})`);
    }
    const ch = PALETTE_CHARS[nextIdx++];
    palette[ch] = hex;
    hexToChar.set(hex, ch);
    charToRgba.set(ch, rgba);
    return ch;
  };

  registerHex(rig.outlineColor ?? '#10111c');
  for (const mat of Object.values(rig.materials)) {
    if (mat.outline) registerHex(mat.outline, true);
    if (mat.crease) registerHex(mat.crease, true);
    if (mat.deepShadow) registerHex(mat.deepShadow, true);
    registerHex(mat.shadow, true);
    registerHex(mat.mid, true);
    if (mat.lit) registerHex(mat.lit, true);
    if (mat.highlight) registerHex(mat.highlight, true);
  }

  return {
    palette,
    charForHex: (hex: string) => registerHex(hex, true),
  };
}

function evalGroupFoldShade(group: CompiledGroup, worldP: Vec3): number {
  let bestD = 1e6;
  let bestFold = 0;
  for (let i = 0; i < group.shapes.length; i++) {
    const cs = group.shapes[i];
    if (cs.shape.op === 'subtract') continue;
    const localP = transformPoint(cs.invWorld, worldP);
    const sd = Math.abs(evaluatePrimitive(cs.shape, localP) * cs.worldScale);
    if (sd < bestD) {
      bestD = sd;
      if (cs.shape.folds) {
        const ax = sampleFoldAxis(localP, cs.shape.folds.axis);
        const w = Math.sin(ax * cs.shape.folds.freq);
        // Asymmetric drapery wave: narrow dark fold valleys, broader lit cloth ridges
        const shaped = w < 0 ? -Math.pow(-w, 0.72) * 1.35 : Math.pow(w, 1.15) * 0.9;
        bestFold = shaped * cs.shape.folds.amp * 1.45;
      } else {
        bestFold = 0;
      }
    }
  }
  return bestFold;
}

function pickMaterialColor(
  mat: BakerMaterial,
  normal: Vec3,
  lightDir: Vec3,
  ao: number,
  worldZ: number,
  rearShadeZ: number,
  px: number,
  py: number,
  foldDelta = 0,
): string {
  const lit = mat.lit ?? mat.mid;
  const highlight = mat.highlight ?? lit;

  if (mat.emissive) {
    const core = Math.max(0, normal[2]) * 0.65 + Math.max(0, dot3(normal, lightDir)) * 0.35;
    if (core > 0.86) return highlight;
    if (core > 0.52) return lit;
    return mat.mid;
  }

  const ndotl = dot3(normal, lightDir);
  const viewDot = Math.max(0, normal[2]);
  let shade = (ndotl * 0.5 + 0.5) * (0.65 + 0.35 * ao) + viewDot * 0.08 + foldDelta;

  if (mat.dither) {
    shade += BAYER2X2[py & 1][px & 1];
  }

  const isRear = worldZ < rearShadeZ;
  if (isRear) {
    shade -= 0.22;
  }

  if (!isRear && mat.highlight && mat.specular !== undefined) {
    const halfVec = normalize3([lightDir[0], lightDir[1], lightDir[2] + 0.85]);
    const spec = Math.max(0, dot3(normal, halfVec));
    if (spec >= mat.specular && ao > 0.65) {
      return mat.highlight;
    }
  }

  if (mat.deepShadow && shade < 0.26) return mat.deepShadow;
  if (shade < 0.42) return mat.shadow;
  if (shade < 0.66) return mat.mid;
  if (shade < 0.88) return lit;
  return highlight;
}

/* ---------------- Frame compilation & raymarching ---------------- */

interface CompiledRigFrame {
  groups: CompiledGroup[];
  boneWorldMats: Map<string, Mat4>;
}

function compileRigFrame(
  rig: BakerRigDef,
  poses: Record<string, BonePose>,
  animName?: string,
  frameIdx = 0,
): CompiledRigFrame {
  const boneWorldMats = new Map<string, Mat4>();
  const boneVisible = new Map<string, boolean>();
  const boneMap = new Map<string, BakerBoneDef>();
  for (const b of rig.bones) boneMap.set(b.id, b);

  const defaultLayerId = rig.layers?.[0]?.id ?? 'base';

  const resolveBone = (id: string): Mat4 => {
    const cached = boneWorldMats.get(id);
    if (cached) return cached;
    const def = boneMap.get(id);
    if (!def) throw new Error(`unknown bone "${id}" in rig "${rig.name}"`);
    const pose = poses[id];
    const parentVis = def.parent ? (resolveBone(def.parent), boneVisible.get(def.parent) ?? true) : true;
    const vis = parentVis && (pose?.visible ?? true);
    boneVisible.set(id, vis);

    const pos: Vec3 = [
      (def.pos?.[0] ?? 0) + (pose?.pos?.[0] ?? 0),
      (def.pos?.[1] ?? 0) + (pose?.pos?.[1] ?? 0),
      (def.pos?.[2] ?? 0) + (pose?.pos?.[2] ?? 0),
    ];
    const rot: Vec3 = [
      (def.rot?.[0] ?? 0) + (pose?.rot?.[0] ?? 0),
      (def.rot?.[1] ?? 0) + (pose?.rot?.[1] ?? 0),
      (def.rot?.[2] ?? 0) + (pose?.rot?.[2] ?? 0),
    ];
    const scale: Vec3 = [
      (def.scale?.[0] ?? 1) * (pose?.scale?.[0] ?? 1),
      (def.scale?.[1] ?? 1) * (pose?.scale?.[1] ?? 1),
      (def.scale?.[2] ?? 1) * (pose?.scale?.[2] ?? 1),
    ];
    const localMat = mat4FromTRS(pos, rot, scale);
    const worldMat = def.parent ? mat4Mul(resolveBone(def.parent), localMat) : localMat;
    boneWorldMats.set(id, worldMat);
    return worldMat;
  };

  for (const b of rig.bones) resolveBone(b.id);

  const hasAuthRelief = rig.bones.some(
    (b) =>
      boneVisible.get(b.id) &&
      b.shapes?.some((s) => s.type === 'relief' && s.authoritative),
  );

  const groupMap = new Map<string, CompiledGroup>();
  for (const b of rig.bones) {
    if (!boneVisible.get(b.id) || !b.shapes?.length) continue;
    const boneWorld = boneWorldMats.get(b.id)!;
    const layerId = b.layerId ?? defaultLayerId;
    for (const shape of b.shapes) {
      if (hasAuthRelief && shape.type !== 'relief' && !shape.occluder && !b.occluder) {
        continue;
      }
      const activeReliefGrid =
        shape.type === 'relief'
          ? (animName ? shape.animGrids?.[animName]?.[frameIdx] : undefined) ?? shape.grid
          : undefined;
      const partGroup = shape.partGroup ?? b.partGroup ?? b.id;
      const key = `${layerId}::${partGroup}`;
      let group = groupMap.get(key);
      if (!group) {
        group = {
          partGroup,
          layerId,
          shapes: [],
          minX: 1e6,
          maxX: -1e6,
          minY: 1e6,
          maxY: -1e6,
          minZ: 1e6,
          maxZ: -1e6,
        };
        groupMap.set(key, group);
      }
      const shapeLocal = mat4FromTRS(
        shape.offset ?? [0, 0, 0],
        shape.rot ?? [0, 0, 0],
        [1, 1, 1],
      );
      const shapeWorld = mat4Mul(boneWorld, shapeLocal);
      const sx = Math.hypot(shapeWorld[0], shapeWorld[4], shapeWorld[8]);
      const sy = Math.hypot(shapeWorld[1], shapeWorld[5], shapeWorld[9]);
      const sz = Math.hypot(shapeWorld[2], shapeWorld[6], shapeWorld[10]);
      const worldScale = Math.min(sx, sy, sz) || 1;
      const maxScale = Math.max(sx, sy, sz) || 1;
      const lb = localShapeBounds(shape);
      const worldCenter = transformPoint(shapeWorld, lb.center);
      const worldBoundR = lb.radius * maxScale + (shape.blend ?? 0.8) + 0.35;

      if (shape.op !== 'subtract') {
        group.minX = Math.min(group.minX, worldCenter[0] - worldBoundR);
        group.maxX = Math.max(group.maxX, worldCenter[0] + worldBoundR);
        group.minY = Math.min(group.minY, worldCenter[1] - worldBoundR);
        group.maxY = Math.max(group.maxY, worldCenter[1] + worldBoundR);
        group.minZ = Math.min(group.minZ, worldCenter[2] - worldBoundR);
        group.maxZ = Math.max(group.maxZ, worldCenter[2] + worldBoundR);
      }

      group.shapes.push({
        shape,
        activeReliefGrid,
        invWorld: mat4InvertAffine(shapeWorld),
        worldScale,
        worldCenter,
        worldBoundR,
        partGroup,
        layerId,
        occluder: Boolean(shape.occluder || b.occluder),
      });
    }
  }

  return { groups: [...groupMap.values()], boneWorldMats };
}

function rasterizeLayerFrame(
  rig: BakerRigDef,
  groups: CompiledGroup[],
  pal: ResolvedPalette,
  filterLayerId?: string,
): string[] {
  const hd = rig.hd !== false;
  const density = hd ? 1 : 4;
  const gridW = Math.round(rig.w * density);
  const gridH = Math.round(rig.h * density);
  const originX = rig.origin?.x ?? rig.w / 2;
  const originY = rig.origin?.y ?? rig.h - 1;

  const pitchRad = (rig.cameraPitch ?? 8) * DEG2RAD;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const rayDir: Vec3 = [0, -sinP, -cosP];
  const camRight: Vec3 = [1, 0, 0];
  const camUp: Vec3 = [0, cosP, -sinP];

  const lightDir = normalize3(rig.lightDir ?? [-0.48, 0.68, 0.55]);
  const rearShadeZ = rig.rearShadeZ ?? -1.2;
  const defaultOutlineHex = rig.outlineColor ?? '#10111c';
  const outlineMode = rig.outlineMode ?? 'outside';
  const creaseThreshold = rig.creaseThreshold ?? 1.6;

  const chars = new Array<string>(gridW * gridH).fill('.');
  const depths = new Float32Array(gridW * gridH).fill(-1e6);
  const partIds = new Array<string>(gridW * gridH).fill('');
  const matIds = new Array<string>(gridW * gridH).fill('');

  const zStart = 32;
  const maxMarchDist = 64;

  interface ProjectedGroup {
    group: CompiledGroup;
    minLX: number;
    maxLX: number;
    minLY: number;
    maxLY: number;
    tMin: number;
    tMax: number;
  }

  const projGroups: ProjectedGroup[] = [];
  for (const g of groups) {
    if (filterLayerId && g.layerId !== filterLayerId) continue;
    if (g.minX > g.maxX) continue;
    let minLY = 1e6, maxLY = -1e6, tMin = 1e6, tMax = -1e6;
    const ys = [g.minY, g.maxY];
    const zs = [g.minZ, g.maxZ];
    for (const y of ys) {
      for (const z of zs) {
        const ly = y * cosP - z * sinP;
        const depthAlongRay = zStart - (y * sinP + z * cosP);
        if (ly < minLY) minLY = ly;
        if (ly > maxLY) maxLY = ly;
        if (depthAlongRay < tMin) tMin = depthAlongRay;
        if (depthAlongRay > tMax) tMax = depthAlongRay;
      }
    }
    projGroups.push({
      group: g,
      minLX: g.minX - 0.25,
      maxLX: g.maxX + 0.25,
      minLY: minLY - 0.25,
      maxLY: maxLY + 0.25,
      tMin: Math.max(0, tMin - 0.5),
      tMax: Math.min(maxMarchDist, tMax + 0.5),
    });
  }

  const rowGroups: ProjectedGroup[] = [];
  const activeGroups: CompiledGroup[] = [];

  for (let py = 0; py < gridH; py++) {
    const logicalY = originY - (py + 0.5) / density;
    rowGroups.length = 0;
    for (let i = 0; i < projGroups.length; i++) {
      const pg = projGroups[i];
      if (logicalY >= pg.minLY && logicalY <= pg.maxLY) {
        rowGroups.push(pg);
      }
    }
    if (rowGroups.length === 0) continue;

    for (let px = 0; px < gridW; px++) {
      const logicalX = (px + 0.5) / density - originX;
      activeGroups.length = 0;
      let tStart = maxMarchDist;
      let tEnd = 0;
      for (let i = 0; i < rowGroups.length; i++) {
        const pg = rowGroups[i];
        if (logicalX >= pg.minLX && logicalX <= pg.maxLX) {
          activeGroups.push(pg.group);
          if (pg.tMin < tStart) tStart = pg.tMin;
          if (pg.tMax > tEnd) tEnd = pg.tMax;
        }
      }
      if (activeGroups.length === 0) continue;

      const ro: Vec3 = [
        logicalX * camRight[0] + logicalY * camUp[0] - rayDir[0] * zStart,
        logicalX * camRight[1] + logicalY * camUp[1] - rayDir[1] * zStart,
        logicalX * camRight[2] + logicalY * camUp[2] - rayDir[2] * zStart,
      ];

      let t = tStart;
      let hit: SceneHit | null = null;
      for (let step = 0; step < 36; step++) {
        const p: Vec3 = [
          ro[0] + rayDir[0] * t,
          ro[1] + rayDir[1] * t,
          ro[2] + rayDir[2] * t,
        ];
        const res = evalScene(activeGroups, p);
        if (res.dist < 0.02) {
          hit = res;
          break;
        }
        t += Math.max(0.08, res.dist);
        if (t > tEnd) break;
      }

      if (!hit || hit.occluder) continue;

      const idx = py * gridW + px;
      if (hit.reliefHex) {
        chars[idx] = pal.charForHex(hit.reliefHex);
        depths[idx] = zStart - t;
        partIds[idx] = hit.partGroup;
        matIds[idx] = hit.material;
        continue;
      }

      const hitP: Vec3 = [
        ro[0] + rayDir[0] * t,
        ro[1] + rayDir[1] * t,
        ro[2] + rayDir[2] * t,
      ];
      const normal = calcGroupNormal(hit.group, hitP);
      const ao = calcAmbientOcclusion(activeGroups, hitP, normal);
      const foldDelta = evalGroupFoldShade(hit.group, hitP);
      const mat = rig.materials[hit.material];
      if (!mat) {
        throw new Error(`unknown material "${hit.material}" in rig "${rig.name}"`);
      }
      const hex = pickMaterialColor(mat, normal, lightDir, ao, hitP[2], rearShadeZ, px, py, foldDelta);
      chars[idx] = pal.charForHex(hex);
      depths[idx] = zStart - t;
      partIds[idx] = hit.partGroup;
      matIds[idx] = hit.material;
    }
  }

  const hasAuthRelief = groups.some(
    (g) =>
      (!filterLayerId || g.layerId === filterLayerId) &&
      g.shapes.some((s) => s.shape.type === 'relief' && s.shape.authoritative),
  );
  if (hasAuthRelief) {
    return rowsFromChars(chars, gridW, gridH);
  }

  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

  // Prune tiny detached grazing speckles in chars before the outline pass
  {
    const vis = new Uint8Array(gridW * gridH);
    const comps: Array<number[]> = [];
    for (let i = 0; i < gridW * gridH; i++) {
      if (vis[i] || chars[i] === '.') continue;
      vis[i] = 1;
      const comp: number[] = [i];
      let head = 0;
      while (head < comp.length) {
        const cur = comp[head++];
        const cx = cur % gridW;
        const cy = Math.floor(cur / gridW);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (vis[nIdx] || chars[nIdx] === '.') continue;
            vis[nIdx] = 1;
            comp.push(nIdx);
          }
        }
      }
      comps.push(comp);
    }
    if (comps.length > 1) {
      comps.sort((a, b) => b.length - a.length);
      const maxOrphan = 4 * density;
      for (let c = 1; c < comps.length; c++) {
        if (comps[c].length <= maxOrphan) {
          for (const idx of comps[c]) {
            chars[idx] = '.';
            depths[idx] = -1e6;
            partIds[idx] = '';
            matIds[idx] = '';
          }
        }
      }
    }
  }

  if (outlineMode === 'none') {
    return rowsFromChars(chars, gridW, gridH);
  }

  const outChars = chars.slice();

  const isCrease = new Uint8Array(gridW * gridH);
  const isOutlineChar = new Set<string>();
  if (defaultOutlineHex) isOutlineChar.add(pal.charForHex(defaultOutlineHex));
  for (const m of Object.values(rig.materials)) {
    if (m.outline) isOutlineChar.add(pal.charForHex(m.outline));
  }

  for (let py = 0; py < gridH; py++) {
    for (let px = 0; px < gridW; px++) {
      const idx = py * gridW + px;
      const c = chars[idx];

      if (c === '.') {
        if (outlineMode !== 'outside') continue;
        let bestNeighborDepth = -1e6;
        let neighborMatId = '';
        for (const [dx, dy] of neighbors) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nIdx = ny * gridW + nx;
          if (chars[nIdx] !== '.' && depths[nIdx] > bestNeighborDepth) {
            bestNeighborDepth = depths[nIdx];
            neighborMatId = matIds[nIdx];
          }
        }
        if (neighborMatId) {
          const mat = rig.materials[neighborMatId];
          const outlineHex = mat?.outline === undefined ? defaultOutlineHex : mat.outline;
          if (outlineHex) {
            outChars[idx] = pal.charForHex(outlineHex);
          }
        }
        continue;
      }

      const mat = rig.materials[matIds[idx]];
      const outlineHex = mat?.outline === undefined ? defaultOutlineHex : mat.outline;
      if (!outlineHex) continue;

      if (outlineMode === 'inside') {
        const onEdge =
          px === 0 || py === 0 || px === gridW - 1 || py === gridH - 1 ||
          neighbors.some(([dx, dy]) => chars[(py + dy) * gridW + (px + dx)] === '.');
        if (onEdge) {
          outChars[idx] = pal.charForHex(outlineHex);
          continue;
        }
      }

      const myDepth = depths[idx];
      const myPart = partIds[idx];
      if (mat.emissive) continue;
      // Never draw an internal crease on a pixel touching the outer silhouette edge
      // or where fewer than 2 orthogonal neighbors belong to the same part (prevents
      // severing thin 1-2px claws, scarves, and limbs where they emerge behind the body).
      let touchesEmpty = false;
      let samePartOrtho = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH || chars[ny * gridW + nx] === '.') {
            touchesEmpty = true;
          } else if ((dx === 0 || dy === 0) && partIds[ny * gridW + nx] === myPart) {
            samePartOrtho++;
          }
        }
      }
      if (!touchesEmpty && samePartOrtho >= 2) {
        for (const [dx, dy] of neighbors) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nIdx = ny * gridW + nx;
          if (chars[nIdx] === '.' || partIds[nIdx] === myPart) continue;
          if (rig.materials[matIds[nIdx]]?.emissive) continue;
          // Opposite-interior invariant: ensure at least 1 pixel of myPart remains on
          // the opposite side of this pixel so a seam crease never erases a thin part.
          const ox = px - dx, oy = py - dy;
          const oppSamePart =
            ox >= 0 && oy >= 0 && ox < gridW && oy < gridH &&
            chars[oy * gridW + ox] !== '.' && partIds[oy * gridW + ox] === myPart;
          const dz = depths[nIdx] - myDepth;
          const isDepthOverlap = dz >= creaseThreshold;
          const isTouchingSeam =
            oppSamePart &&
            (dz >= 0.22 || (dy === -1 && dz >= -0.35) || (dy === 0 && dz >= 0.04));
          if (isDepthOverlap || isTouchingSeam) {
            const sameMat = matIds[nIdx] === matIds[idx];
            const seamHex = sameMat
              ? (mat.deepShadow ?? mat.shadow)
              : (mat.crease ?? mat.deepShadow ?? mat.shadow);
            outChars[idx] = pal.charForHex(seamHex);
            isCrease[idx] = 1;
            break;
          }
        }
      }
    }
  }

  // Contact-shadow clustering pass: step down raw highlight/lit pixels that sit
  // immediately below or behind an internal ink-crease so seams transition through
  // mid/shadow tones like hand-pixelled cluster shading.
  for (let py = 0; py < gridH; py++) {
    for (let px = 0; px < gridW; px++) {
      const idx = py * gridW + px;
      if (outChars[idx] === '.' || isCrease[idx] || isOutlineChar.has(outChars[idx])) continue;
      const mat = rig.materials[matIds[idx]];
      if (!mat || mat.emissive) continue;
      let touchesCrease = false;
      let creaseAbove = false;
      for (const [dx, dy] of neighbors) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const nIdx = ny * gridW + nx;
        if (isCrease[nIdx]) {
          touchesCrease = true;
          if (dy === -1) creaseAbove = true;
        }
      }
      if (!touchesCrease) continue;
      const litHex = mat.lit ?? mat.mid;
      const hiChar = mat.highlight ? pal.charForHex(mat.highlight) : '';
      const litChar = pal.charForHex(litHex);
      if (hiChar && outChars[idx] === hiChar) {
        outChars[idx] = pal.charForHex(creaseAbove ? mat.mid : litHex);
      } else if (creaseAbove && outChars[idx] === litChar) {
        outChars[idx] = pal.charForHex(mat.mid);
      }
    }
  }

  // Smart Crease De-Pinch: if an internal crease line completely encircled any
  // fill island, restore the crease pixels touching that island.
  for (let pass = 0; pass < 3; pass++) {
    const visited = new Uint8Array(gridW * gridH);
    const comps: Array<number[]> = [];
    for (let i = 0; i < gridW * gridH; i++) {
      if (visited[i] || outChars[i] === '.' || isOutlineChar.has(outChars[i])) continue;
      visited[i] = 1;
      const comp: number[] = [i];
      let head = 0;
      while (head < comp.length) {
        const cur = comp[head++];
        const cx = cur % gridW;
        const cy = Math.floor(cur / gridW);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (visited[nIdx] || outChars[nIdx] === '.' || isOutlineChar.has(outChars[nIdx])) continue;
            visited[nIdx] = 1;
            comp.push(nIdx);
          }
        }
      }
      comps.push(comp);
    }
    comps.sort((a, b) => b.length - a.length);
    if (comps.length <= 1) break;
    let restoredAny = false;
    for (let c = 1; c < comps.length; c++) {
      const comp = comps[c];
      for (const idx of comp) {
        const cx = idx % gridW;
        const cy = Math.floor(idx / gridW);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (isCrease[nIdx]) {
              outChars[nIdx] = chars[nIdx];
              isCrease[nIdx] = 0;
              restoredAny = true;
            }
          }
        }
      }
    }
    if (!restoredAny) break;
  }

  // Exterior background flood-fill on outChars:
  // 1. Any '.' pixel not reachable from the 4 canvas borders (because a 1-2px cleft
  //    was pinched shut by the outline or between two limbs) is an interior pinhole ->
  //    fill it with the nearest neighbor's material shadow stop.
  // 2. Any outlineChar pixel that does NOT touch a border-reachable '.' pixel in its
  //    8-neighborhood is trapped inside a narrow interior cleft -> convert it from
  //    the near-black outer outlineColor to its neighbor's material shadow stop so
  //    it never looks like a background hole inside the sprite.
  const extEmpty = new Uint8Array(gridW * gridH);
  const extQueue: number[] = [];
  for (let x = 0; x < gridW; x++) {
    if (outChars[x] === '.' && !extEmpty[x]) {
      extEmpty[x] = 1;
      extQueue.push(x);
    }
    const bIdx = (gridH - 1) * gridW + x;
    if (outChars[bIdx] === '.' && !extEmpty[bIdx]) {
      extEmpty[bIdx] = 1;
      extQueue.push(bIdx);
    }
  }
  for (let y = 0; y < gridH; y++) {
    const lIdx = y * gridW;
    if (outChars[lIdx] === '.' && !extEmpty[lIdx]) {
      extEmpty[lIdx] = 1;
      extQueue.push(lIdx);
    }
    const rIdx = y * gridW + (gridW - 1);
    if (outChars[rIdx] === '.' && !extEmpty[rIdx]) {
      extEmpty[rIdx] = 1;
      extQueue.push(rIdx);
    }
  }
  let extHead = 0;
  while (extHead < extQueue.length) {
    const cur = extQueue[extHead++];
    const cx = cur % gridW;
    const cy = Math.floor(cur / gridW);
    for (const [dx, dy] of neighbors) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
      const nIdx = ny * gridW + nx;
      if (!extEmpty[nIdx] && outChars[nIdx] === '.') {
        extEmpty[nIdx] = 1;
        extQueue.push(nIdx);
      }
    }
  }

  const pickNeighborShadowChar = (px: number, py: number): string => {
    for (let radius = 1; radius <= 3; radius++) {
      let bestDepth = -1e6;
      let bestMat = '';
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nIdx = ny * gridW + nx;
          if (matIds[nIdx] && depths[nIdx] > bestDepth) {
            bestDepth = depths[nIdx];
            bestMat = matIds[nIdx];
          }
        }
      }
      if (bestMat && rig.materials[bestMat]) {
        return pal.charForHex(rig.materials[bestMat].shadow);
      }
    }
    const firstMat = Object.values(rig.materials)[0];
    return firstMat ? pal.charForHex(firstMat.shadow) : '1';
  };

  if (!hasAuthRelief) {
    for (let py = 0; py < gridH; py++) {
      for (let px = 0; px < gridW; px++) {
        const idx = py * gridW + px;
        if (outChars[idx] === '.' && !extEmpty[idx]) {
          outChars[idx] = pickNeighborShadowChar(px, py);
        } else if (isOutlineChar.has(outChars[idx])) {
          const onCanvasBorder = px === 0 || py === 0 || px === gridW - 1 || py === gridH - 1;
          let touchesExteriorEmpty = onCanvasBorder;
          if (!touchesExteriorEmpty) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = px + dx, ny = py + dy;
                if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
                if (extEmpty[ny * gridW + nx]) {
                  touchesExteriorEmpty = true;
                  break;
                }
              }
              if (touchesExteriorEmpty) break;
            }
          }
          if (!touchesExteriorEmpty) {
            outChars[idx] = pickNeighborShadowChar(px, py);
          }
        }
      }
    }
  }

  // Interior 1px Despeckle: if an interior fill pixel is surrounded on >=3 of 4
  // orthogonal sides by the exact same shading stop of the same material, smooth it
  // so 1px raymarch grazing speckles never turn into holes under EPX upscaling.
  const smoothed = outChars.slice();
  for (let py = 1; py < gridH - 1; py++) {
    for (let px = 1; px < gridW - 1; px++) {
      const idx = py * gridW + px;
      const c = outChars[idx];
      if (c === '.' || isOutlineChar.has(c)) continue;
      const myMat = matIds[idx];
      const orthoChars: string[] = [];
      for (const [dx, dy] of neighbors) {
        const nIdx = (py + dy) * gridW + (px + dx);
        if (matIds[nIdx] === myMat && outChars[nIdx] !== '.' && !isOutlineChar.has(outChars[nIdx])) {
          orthoChars.push(outChars[nIdx]);
        }
      }
      if (orthoChars.length >= 3 && !orthoChars.includes(c)) {
        const counts = new Map<string, number>();
        for (const oc of orthoChars) counts.set(oc, (counts.get(oc) ?? 0) + 1);
        for (const [oc, cnt] of counts) {
          if (cnt >= 3) {
            smoothed[idx] = oc;
            break;
          }
        }
      }
    }
  }

  return rowsFromChars(smoothed, gridW, gridH);
}

function rowsFromChars(chars: string[], w: number, h: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(chars.slice(y * w, (y + 1) * w).join(''));
  }
  return rows;
}

function projectSocketAnchor(
  rig: BakerRigDef,
  socket: BakerSocketDef,
  boneWorldMats: Map<string, Mat4>,
  animName?: string,
  frameIdx?: number,
): SpriteAnchor {
  if (animName !== undefined && frameIdx !== undefined) {
    const explicit = socket.frames?.[animName]?.[frameIdx];
    if (explicit) {
      return { ...explicit };
    }
  }
  const mat = boneWorldMats.get(socket.bone);
  if (!mat) throw new Error(`socket references unknown bone "${socket.bone}" in rig "${rig.name}"`);
  const originX = rig.origin?.x ?? rig.w / 2;
  const originY = rig.origin?.y ?? rig.h - 1;
  const pitchRad = (rig.cameraPitch ?? 8) * DEG2RAD;
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);

  const worldP = transformPoint(mat, socket.pos ?? [0, 0, 0]);
  const u = originX + worldP[0];
  const v = originY - (worldP[1] * cosP - worldP[2] * sinP);

  const roundQ = (n: number) => Math.round(n * 4) / 4;
  const point: SpriteAnchor = { x: roundQ(u), y: roundQ(v) };

  if (socket.dir) {
    const worldDir = transformDir(mat, socket.dir);
    const du = worldDir[0];
    const dv = -(worldDir[1] * cosP - worldDir[2] * sinP);
    if (Math.hypot(du, dv) > 1e-4) {
      point.angle = Math.round((Math.atan2(dv, du) / DEG2RAD) * 10) / 10;
    }
  }
  return point;
}

/**
 * Bake a 3D `BakerRigDef` into a validated game-native `SpriteFile` JSON object.
 */
export function bakeSpriteRig(rig: BakerRigDef): SpriteFile {
  const pal = buildRigPalette(rig);
  const hd = rig.hd !== false;
  const isLayered = Array.isArray(rig.layers) && rig.layers.length > 0;

  const anchors: Record<string, Record<string, SpriteAnchor[]>> = {};
  if (rig.sockets) {
    for (const socketName of Object.keys(rig.sockets)) {
      anchors[socketName] = {};
    }
  }

  if (isLayered) {
    const anims: LayeredSpriteFile['anims'] = {};
    const layerTracks = new Map<string, Record<string, string[][]>>();
    for (const l of rig.layers!) layerTracks.set(l.id, {});

    for (const [animName, animDef] of Object.entries(rig.anims)) {
      if (animDef.aliasOf) {
        anims[animName] = animDef.aliasOf;
        continue;
      }
      const frameCount = Math.max(1, Math.round(animDef.frames));
      anims[animName] = {
        fps: animDef.fps,
        frameCount,
        ...(animDef.loop === false ? { loop: false } : {}),
      };
      for (const l of rig.layers!) layerTracks.get(l.id)![animName] = [];
      if (rig.sockets) {
        for (const sName of Object.keys(rig.sockets)) {
          if (!sDefOmitsAnim(rig.sockets[sName], animName)) {
            anchors[sName][animName] = [];
          }
        }
      }

      for (let f = 0; f < frameCount; f++) {
        const t = frameCount <= 1 ? 0 : f / frameCount;
        const poses = animDef.pose ? animDef.pose(t, f) : {};
        const compiled = compileRigFrame(rig, poses, animName, f);
        for (const l of rig.layers!) {
          const rows = rasterizeLayerFrame(rig, compiled.groups, pal, l.id);
          layerTracks.get(l.id)![animName].push(rows);
        }
        if (rig.sockets) {
          for (const [sName, sDef] of Object.entries(rig.sockets)) {
            if (sDefOmitsAnim(sDef, animName)) continue;
            anchors[sName][animName].push(
              projectSocketAnchor(rig, sDef, compiled.boneWorldMats, animName, f),
            );
          }
        }
      }
    }

    const layers: SpriteLayerData[] = rig.layers!.map((l) => ({
      id: l.id,
      name: l.name,
      tag: l.tag,
      ...(l.composition ? { composition: l.composition } : {}),
      tracks: layerTracks.get(l.id)!,
    }));

    const file: LayeredSpriteFile & { editor?: { canEquipWeapon?: boolean } } = {
      hd,
      ...(rig.editor ? { editor: rig.editor } : {}),
      w: rig.w,
      h: rig.h,
      ...(rig.hitbox ? { hitbox: rig.hitbox } : {}),
      ...(rig.animationHitboxOffsets ? { animationHitboxOffsets: rig.animationHitboxOffsets } : {}),
      palette: pal.palette,
      anims,
      layers,
      ...(rig.sockets && Object.keys(rig.sockets).length ? { anchors } : {}),
      ...(rig.attachmentSlots ? { attachmentSlots: rig.attachmentSlots } : {}),
    };
    validateSpriteEditorDocument(file);
    return file;
  }

  const anims: FlatSpriteFile['anims'] = {};
  for (const [animName, animDef] of Object.entries(rig.anims)) {
    if (animDef.aliasOf) {
      anims[animName] = animDef.aliasOf;
      continue;
    }
    const frameCount = Math.max(1, Math.round(animDef.frames));
    const frames: string[][] = [];
    if (rig.sockets) {
      for (const sName of Object.keys(rig.sockets)) {
        if (!sDefOmitsAnim(rig.sockets[sName], animName)) {
          anchors[sName][animName] = [];
        }
      }
    }

    for (let f = 0; f < frameCount; f++) {
      const t = frameCount <= 1 ? 0 : f / frameCount;
      const poses = animDef.pose ? animDef.pose(t, f) : {};
      const compiled = compileRigFrame(rig, poses, animName, f);
      frames.push(rasterizeLayerFrame(rig, compiled.groups, pal));
      if (rig.sockets) {
        for (const [sName, sDef] of Object.entries(rig.sockets)) {
          if (sDefOmitsAnim(sDef, animName)) continue;
          anchors[sName][animName].push(
            projectSocketAnchor(rig, sDef, compiled.boneWorldMats, animName, f),
          );
        }
      }
    }

    anims[animName] = {
      fps: animDef.fps,
      frames,
      ...(animDef.loop === false ? { loop: false } : {}),
    };
  }

  const file: FlatSpriteFile & { editor?: { canEquipWeapon?: boolean } } = {
    hd,
    ...(rig.editor ? { editor: rig.editor } : {}),
    w: rig.w,
    h: rig.h,
    ...(rig.hitbox ? { hitbox: rig.hitbox } : {}),
    ...(rig.animationHitboxOffsets ? { animationHitboxOffsets: rig.animationHitboxOffsets } : {}),
    palette: pal.palette,
    anims,
    ...(rig.sockets && Object.keys(rig.sockets).length ? { anchors } : {}),
    ...(rig.attachmentSlots ? { attachmentSlots: rig.attachmentSlots } : {}),
  };
  validateSpriteEditorDocument(file);
  return file;
}

function sDefOmitsAnim(socket: BakerSocketDef, animName: string): boolean {
  if (socket.omitAnims?.includes(animName)) return true;
  // When `socket.frames` is provided and explicitly sets `animName` to an empty array,
  // omit that animation from `anchors[socketName]` (e.g. legacy no-grip `plunge` rows).
  return Boolean(socket.frames && animName in socket.frames && socket.frames[animName].length === 0);
}

/* ---------------- Contact sheet RGBA renderer ---------------- */

function parseHexRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace(/^#/, '');
  const r = Number.parseInt(clean.slice(0, 2), 16) || 0;
  const g = Number.parseInt(clean.slice(2, 4), 16) || 0;
  const b = Number.parseInt(clean.slice(4, 6), 16) || 0;
  const a = clean.length >= 8 ? Number.parseInt(clean.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

function epx2x(w: number, h: number, rgba: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const outW = w * 2;
  const outH = h * 2;
  const out = new Uint8Array(outW * outH * 4);
  const idx = (x: number, y: number) => (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
  const eq = (a: number, b: number) =>
    rgba[a] === rgba[b] &&
    rgba[a + 1] === rgba[b + 1] &&
    rgba[a + 2] === rgba[b + 2] &&
    rgba[a + 3] === rgba[b + 3];
  const copyPx = (dstX: number, dstY: number, srcOffset: number) => {
    const d = (dstY * outW + dstX) * 4;
    out[d] = rgba[srcOffset];
    out[d + 1] = rgba[srcOffset + 1];
    out[d + 2] = rgba[srcOffset + 2];
    out[d + 3] = rgba[srcOffset + 3];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = idx(x, y);
      const A = idx(x, y - 1);
      const B = idx(x + 1, y);
      const C = idx(x - 1, y);
      const D = idx(x, y + 1);
      const p1 = eq(C, A) && !eq(C, D) && !eq(A, B) ? A : P;
      const p2 = eq(A, B) && !eq(A, C) && !eq(B, D) ? B : P;
      const p3 = eq(D, C) && !eq(D, B) && !eq(C, A) ? C : P;
      const p4 = eq(B, D) && !eq(B, A) && !eq(D, C) ? D : P;
      copyPx(x * 2, y * 2, p1);
      copyPx(x * 2 + 1, y * 2, p2);
      copyPx(x * 2, y * 2 + 1, p3);
      copyPx(x * 2 + 1, y * 2 + 1, p4);
    }
  }
  return { w: outW, h: outH, rgba: out };
}

export interface ContactSheetOptions {
  /** Scale factor applied to the 4x-texel game image (default 3 = 12x logical pixel). */
  scale?: number;
  /** Draw hitbox rectangle and anchor crosshairs on the contact sheet. */
  showOverlays?: boolean;
}

/**
 * Render any `SpriteFile` into an RGBA contact sheet buffer (1 row per
 * concrete animation, showing the exact EPX/4x game render, optional hitbox,
 * and projected socket anchors).
 */
export function renderSpriteContactSheetRgba(
  file: SpriteFile,
  options: ContactSheetOptions = {},
): { width: number; height: number; rgba: Uint8Array } {
  const concreteAnims = Object.keys(file.anims).filter((k) => typeof file.anims[k] !== 'string');
  if (!concreteAnims.length) throw new Error('SpriteFile has no concrete animations');

  const firstFrame = compositeSpriteFrame(file, concreteAnims[0], 0) ?? [''];
  const rawW = firstFrame[0]?.length ?? 1;
  const rawH = firstFrame.length || 1;
  const hd = file.hd !== false;
  const texelW = hd ? rawW * 4 : rawW;
  const texelH = hd ? rawH * 4 : rawH;

  const scale = Math.max(1, Math.round(options.scale ?? 3));
  const cellPad = 6;
  const cellW = texelW * scale + cellPad * 2;
  const cellH = texelH * scale + cellPad * 2;

  const frameCounts = concreteAnims.map((anim) => {
    if (isLayeredSpriteFile(file)) {
      const entry = file.anims[anim];
      return typeof entry === 'string' ? 1 : entry.frameCount;
    }
    const entry = file.anims[anim];
    return typeof entry === 'string' ? 1 : entry.frames.length;
  });
  const maxFrames = Math.max(1, ...frameCounts);

  const imgW = maxFrames * cellW;
  const imgH = concreteAnims.length * cellH;
  const rgba = new Uint8Array(imgW * imgH * 4);
  const pal = file.palette ?? {};

  const setPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= imgW || y >= imgH || a <= 0) return;
    const i = (y * imgW + x) * 4;
    if (a >= 255) {
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    } else {
      const alpha = a / 255;
      const inv = 1 - alpha;
      rgba[i] = Math.round(r * alpha + rgba[i] * inv);
      rgba[i + 1] = Math.round(g * alpha + rgba[i + 1] * inv);
      rgba[i + 2] = Math.round(b * alpha + rgba[i + 2] * inv);
      rgba[i + 3] = 255;
    }
  };

  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const checker = ((x >> 3) + (y >> 3)) & 1;
      const v = checker ? 28 : 22;
      setPixel(x, y, v, v, v + 6, 255);
    }
  }

  for (let rowIdx = 0; rowIdx < concreteAnims.length; rowIdx++) {
    const anim = concreteAnims[rowIdx];
    const count = frameCounts[rowIdx];
    for (let f = 0; f < count; f++) {
      const rows = compositeSpriteFrame(file, resolveAnimName(file, anim), f) ?? [];
      let frameRgba: Uint8Array = new Uint8Array(rawW * rawH * 4);
      for (let y = 0; y < rawH; y++) {
        const line = rows[y] ?? '';
        for (let x = 0; x < rawW; x++) {
          const ch = line[x] ?? '.';
          if (ch === '.') continue;
          const hex = pal[ch];
          if (!hex) continue;
          const [r, g, b, a] = parseHexRgba(hex);
          const o = (y * rawW + x) * 4;
          frameRgba[o] = r;
          frameRgba[o + 1] = g;
          frameRgba[o + 2] = b;
          frameRgba[o + 3] = a;
        }
      }

      if (hd) {
        const pass1 = epx2x(rawW, rawH, frameRgba);
        const pass2 = epx2x(pass1.w, pass1.h, pass1.rgba);
        frameRgba = pass2.rgba;
      }

      const ox = f * cellW + cellPad;
      const oy = rowIdx * cellH + cellPad;

      for (let bx = 0; bx < texelW * scale; bx++) {
        setPixel(ox + bx, oy - 1, 55, 62, 78);
        setPixel(ox + bx, oy + texelH * scale, 55, 62, 78);
      }
      for (let by = 0; by < texelH * scale; by++) {
        setPixel(ox - 1, oy + by, 55, 62, 78);
        setPixel(ox + texelW * scale, oy + by, 55, 62, 78);
      }

      for (let ty = 0; ty < texelH; ty++) {
        for (let tx = 0; tx < texelW; tx++) {
          const src = (ty * texelW + tx) * 4;
          const a = frameRgba[src + 3];
          if (a === 0) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPixel(
                ox + tx * scale + sx,
                oy + ty * scale + sy,
                frameRgba[src],
                frameRgba[src + 1],
                frameRgba[src + 2],
                a,
              );
            }
          }
        }
      }

      if (options.showOverlays !== false) {
        const logicalToPx = 4 * scale;
        if (file.hitbox) {
          const hx0 = ox + Math.round((file.hitbox.x ?? 0) * logicalToPx);
          const hy0 = oy + Math.round((file.hitbox.y ?? 0) * logicalToPx);
          const hw = Math.round((file.hitbox.w ?? file.w ?? 1) * logicalToPx);
          const hh = Math.round((file.hitbox.h ?? file.h ?? 1) * logicalToPx);
          for (let x = hx0; x <= hx0 + hw; x += 2) {
            setPixel(x, hy0, 56, 183, 100);
            setPixel(x, hy0 + hh, 56, 183, 100);
          }
          for (let y = hy0; y <= hy0 + hh; y += 2) {
            setPixel(hx0, y, 56, 183, 100);
            setPixel(hx0 + hw, y, 56, 183, 100);
          }
        }
        if (file.anchors) {
          const anchorColors: Array<[number, number, number]> = [
            [255, 205, 117],
            [65, 166, 246],
            [255, 107, 151],
          ];
          let aIdx = 0;
          for (const [, byAnim] of Object.entries(file.anchors)) {
            const pt = byAnim[anim]?.[f];
            if (!pt) continue;
            const [ar, ag, ab] = anchorColors[aIdx++ % anchorColors.length];
            const ax = ox + Math.round(pt.x * logicalToPx);
            const ay = oy + Math.round(pt.y * logicalToPx);
            for (let d = -3; d <= 3; d++) {
              setPixel(ax + d, ay, ar, ag, ab);
              setPixel(ax, ay + d, ar, ag, ab);
            }
          }
        }
      }
    }
  }

  return { width: imgW, height: imgH, rgba };
}

export interface CompositeAnimSpec {
  label: string;
  bodyAnim: string;
  weaponAnim: string;
  embeddedHeldObject: boolean;
}

export const DEFAULT_SWORD_COMPOSITE_ANIMS: CompositeAnimSpec[] = [
  { label: 'sword-idle', bodyAnim: 'sword-idle', weaponAnim: 'idle', embeddedHeldObject: true },
  { label: 'sword-run', bodyAnim: 'sword-run', weaponAnim: 'run', embeddedHeldObject: true },
  { label: 'attack', bodyAnim: 'attack', weaponAnim: 'attack', embeddedHeldObject: true },
  { label: 'attack2', bodyAnim: 'attack2', weaponAnim: 'attack2', embeddedHeldObject: true },
  { label: 'attack3', bodyAnim: 'attack3', weaponAnim: 'attack3', embeddedHeldObject: true },
  { label: 'rise', bodyAnim: 'rise', weaponAnim: 'idle', embeddedHeldObject: false },
  { label: 'fall', bodyAnim: 'fall', weaponAnim: 'idle', embeddedHeldObject: false },
];

/**
 * Render a contact sheet of `bodyFile` + `weaponFile` composited together
 * using the exact runtime `snapAttachmentOriginToBodyGrid` and `drawGrip`
 * rules from `player-render.ts` and `weapon-visuals.ts`.
 */
export function renderEquipmentCompositeSheetRgba(
  bodyFile: SpriteFile,
  weaponFile: SpriteFile,
  options: ContactSheetOptions & {
    anims?: CompositeAnimSpec[];
    weaponOrigin?: { x: number; y: number };
  } = {},
): { width: number; height: number; rgba: Uint8Array } {
  const specs = (options.anims ?? DEFAULT_SWORD_COMPOSITE_ANIMS).filter(
    (s) => s.bodyAnim in bodyFile.anims && s.weaponAnim in weaponFile.anims,
  );
  if (!specs.length) {
    throw new Error('renderEquipmentCompositeSheetRgba: no matching body/weapon animation pairs');
  }

  const firstBody = compositeSpriteFrame(bodyFile, resolveAnimName(bodyFile, specs[0].bodyAnim), 0) ?? [''];
  const bodyTexelW = firstBody[0]?.length ?? 160;
  const bodyTexelH = firstBody.length || 110;
  const texelW = bodyTexelW;
  const texelH = Math.max(bodyTexelH, 168);
  const scale = Math.max(1, Math.round(options.scale ?? 3));
  const cellPad = 6;
  const cellW = texelW * scale + cellPad * 2;
  const cellH = texelH * scale + cellPad * 2;

  const getFrameCount = (file: SpriteFile, anim: string): number => {
    const resolved = resolveAnimName(file, anim);
    const entry = file.anims[resolved];
    if (!entry || typeof entry === 'string') return 1;
    return 'frameCount' in entry ? entry.frameCount : entry.frames.length;
  };

  const frameCounts = specs.map((s) =>
    s.weaponAnim === 'plunge' ? getFrameCount(weaponFile, s.weaponAnim) : getFrameCount(bodyFile, s.bodyAnim),
  );
  const maxFrames = Math.max(1, ...frameCounts);

  const imgW = maxFrames * cellW;
  const imgH = specs.length * cellH;
  const rgba = new Uint8Array(imgW * imgH * 4);
  const bodyPal = bodyFile.palette ?? {};
  const weaponPal = weaponFile.palette ?? {};

  const setPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= imgW || y >= imgH || a <= 0) return;
    const i = (y * imgW + x) * 4;
    if (a >= 255) {
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    } else {
      const alpha = a / 255;
      const inv = 1 - alpha;
      rgba[i] = Math.round(r * alpha + rgba[i] * inv);
      rgba[i + 1] = Math.round(g * alpha + rgba[i + 1] * inv);
      rgba[i + 2] = Math.round(b * alpha + rgba[i + 2] * inv);
      rgba[i + 3] = 255;
    }
  };

  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      const checker = ((x >> 3) + (y >> 3)) & 1;
      const v = checker ? 28 : 22;
      setPixel(x, y, v, v, v + 6, 255);
    }
  }

  const weaponLayers = isLayeredSpriteFile(weaponFile) ? weaponFile.layers : [];
  const legacyOrigin = options.weaponOrigin ?? { x: 16, y: 15.5 };

  for (let rowIdx = 0; rowIdx < specs.length; rowIdx++) {
    const spec = specs[rowIdx];
    const count = frameCounts[rowIdx];
    const bCount = getFrameCount(bodyFile, spec.bodyAnim);
    const wCount = getFrameCount(weaponFile, spec.weaponAnim);

    for (let f = 0; f < count; f++) {
      const bf = f % bCount;
      const wf = f % wCount;
      const bodyRows = compositeSpriteFrame(bodyFile, resolveAnimName(bodyFile, spec.bodyAnim), bf) ?? [];
      const frameRgba = new Uint8Array(texelW * texelH * 4);

      const blendFramePixel = (tx: number, ty: number, r: number, g: number, b: number, a: number) => {
        if (tx < 0 || ty < 0 || tx >= texelW || ty >= texelH || a <= 0) return;
        const o = (ty * texelW + tx) * 4;
        if (a >= 255 || frameRgba[o + 3] === 0) {
          frameRgba[o] = r;
          frameRgba[o + 1] = g;
          frameRgba[o + 2] = b;
          frameRgba[o + 3] = a;
        } else {
          const alpha = a / 255;
          const inv = 1 - alpha;
          frameRgba[o] = Math.round(r * alpha + frameRgba[o] * inv);
          frameRgba[o + 1] = Math.round(g * alpha + frameRgba[o + 1] * inv);
          frameRgba[o + 2] = Math.round(b * alpha + frameRgba[o + 2] * inv);
          frameRgba[o + 3] = Math.min(255, Math.round(a + frameRgba[o + 3] * inv));
        }
      };

      // 1. Draw body ('body' render tag)
      for (let y = 0; y < texelH; y++) {
        const line = bodyRows[y] ?? '';
        for (let x = 0; x < texelW; x++) {
          const ch = line[x] ?? '.';
          if (ch === '.' || ch === ' ') continue;
          const hex = bodyPal[ch];
          if (!hex) continue;
          const [r, g, b, a] = parseHexRgba(hex);
          blendFramePixel(x, y, r, g, b, a);
        }
      }

      // 2. Compute snapped attachment offset in texels
      const frontHand = bodyFile.anchors?.frontHand?.[spec.bodyAnim]?.[bf];
      const grip = weaponFile.anchors?.grip?.[spec.weaponAnim]?.[wf];
      let offsetX = 0;
      let offsetY = 0;
      if (frontHand && grip) {
        offsetX = Math.round((frontHand.x - grip.x) * 4);
        offsetY = Math.round((frontHand.y - grip.y) * 4);
      } else {
        // Legacy feet-relative placement (`spriteWeapon` fallback when a row omits `grip`)
        offsetX = Math.round((bodyTexelW / 8 - legacyOrigin.x) * 4);
        offsetY = Math.round((bodyTexelH / 4 - legacyOrigin.y) * 4);
      }

      // 3. Draw weapon layers in 'front-hand-held-object' band
      if (weaponLayers.length > 0) {
        for (const layer of weaponLayers) {
          if (spec.embeddedHeldObject && layer.composition !== 'overlay') continue;
          const wRows = layer.tracks[resolveAnimName(weaponFile, spec.weaponAnim)]?.[wf] ?? [];
          for (let wy = 0; wy < wRows.length; wy++) {
            const line = wRows[wy] ?? '';
            for (let wx = 0; wx < line.length; wx++) {
              const ch = line[wx] ?? '.';
              if (ch === '.' || ch === ' ') continue;
              const hex = weaponPal[ch];
              if (!hex) continue;
              const [r, g, b, a] = parseHexRgba(hex);
              blendFramePixel(wx + offsetX, wy + offsetY, r, g, b, a);
            }
          }
        }
      } else {
        const wRows = compositeSpriteFrame(weaponFile, resolveAnimName(weaponFile, spec.weaponAnim), wf) ?? [];
        for (let wy = 0; wy < wRows.length; wy++) {
          const line = wRows[wy] ?? '';
          for (let wx = 0; wx < line.length; wx++) {
            const ch = line[wx] ?? '.';
            if (ch === '.' || ch === ' ') continue;
            const hex = weaponPal[ch];
            if (!hex) continue;
            const [r, g, b, a] = parseHexRgba(hex);
            blendFramePixel(wx + offsetX, wy + offsetY, r, g, b, a);
          }
        }
      }

      // 4. Draw procedural leather grip (`drawGrip` in player-render.ts) when !embeddedHeldObject
      if (!spec.embeddedHeldObject && frontHand && grip) {
        const hx = Math.round(frontHand.x * 4);
        const hy = Math.round(frontHand.y * 4);
        for (let dy = -3; dy <= 2; dy++) {
          for (let dx = -3; dx <= 2; dx++) {
            blendFramePixel(hx + dx, hy + dy, 0x17, 0x16, 0x25, 255);
          }
        }
        for (let dy = -2; dy <= 1; dy++) {
          for (let dx = -2; dx <= 1; dx++) {
            blendFramePixel(hx + dx, hy + dy, 0x68, 0x40, 0x37, 255);
          }
        }
        blendFramePixel(hx, hy - 1, 0x9a, 0x5b, 0x45, 255);
        blendFramePixel(hx + 1, hy - 1, 0x9a, 0x5b, 0x45, 255);
      }

      const ox = f * cellW + cellPad;
      const oy = rowIdx * cellH + cellPad;

      for (let bx = 0; bx < texelW * scale; bx++) {
        setPixel(ox + bx, oy - 1, 55, 62, 78);
        setPixel(ox + bx, oy + texelH * scale, 55, 62, 78);
      }
      for (let by = 0; by < texelH * scale; by++) {
        setPixel(ox - 1, oy + by, 55, 62, 78);
        setPixel(ox + texelW * scale, oy + by, 55, 62, 78);
      }

      for (let ty = 0; ty < texelH; ty++) {
        for (let tx = 0; tx < texelW; tx++) {
          const src = (ty * texelW + tx) * 4;
          const a = frameRgba[src + 3];
          if (a === 0) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPixel(
                ox + tx * scale + sx,
                oy + ty * scale + sy,
                frameRgba[src],
                frameRgba[src + 1],
                frameRgba[src + 2],
                a,
              );
            }
          }
        }
      }

      if (options.showOverlays !== false && frontHand) {
        const logicalToPx = 4 * scale;
        const ax = ox + Math.round(frontHand.x * logicalToPx);
        const ay = oy + Math.round(frontHand.y * logicalToPx);
        for (let d = -3; d <= 3; d++) {
          setPixel(ax + d, ay, 255, 205, 117);
          setPixel(ax, ay + d, 255, 205, 117);
        }
      }
    }
  }

  return { width: imgW, height: imgH, rgba };
}

export interface ReferenceReliefOptions {
  /** Specific layer id to extract from a `LayeredSpriteFile` (instead of compositing all layers). */
  layerId?: string;
  /** Companion layer id whose union with `layerId` should also be checked for cross-layer pinholes. */
  companionLayerId?: string;
  /**
   * Minimum 4-connected component size in pixels to preserve (default `0` keeps only the
   * single largest component; set e.g. `6` for weapon overlays so the detached pommel cap
   * and multi-part blade segments survive while 1-3px speckles are pruned).
   */
  minComponentPixels?: number;
}

/**
 * Extract an articulated 3D `ReliefShape` from a reference `SpriteFile` across
 * `animNames`, ensuring 4-connected silhouette continuity and zero interior pinholes
 * so the 3D baker raymarches the exact sub-pixel face, cloth, hand, weapon, and stride
 * detail while passing all `critiqueSpriteFile` invariants.
 */
export function createReferenceReliefShape(
  refFile: SpriteFile,
  materialName: string,
  animNames: string[],
  originSub: [number, number],
  pitchDeg = 7,
  options: ReferenceReliefOptions = {},
): ReliefShape {
  const density = refFile.hd !== false ? 1 : 4;
  const rawPal = refFile.palette ?? {};
  const palette: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawPal)) {
    if (typeof v === 'string') palette[k] = v;
  }
  const minCompPx = options.minComponentPixels ?? 0;

  const extractLayerRows = (layerId: string | undefined, anim: string, frame: number): string[] => {
    if (layerId && isLayeredSpriteFile(refFile)) {
      const layer = refFile.layers.find((l) => l.id === layerId);
      return layer?.tracks[anim]?.[frame] ?? [];
    }
    return compositeSpriteFrame(refFile, anim, frame) ?? [];
  };

  const sanitizeFrameRows = (rawRows: string[], companionRows?: string[]): ReliefFrameGrid => {
    const h = rawRows.length;
    const w = rawRows[0]?.length ?? 1;
    const grid = rawRows.map((r) => r.split(''));

    const isFilled = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && grid[y][x] !== '.' && grid[y][x] !== ' ';

    // 1. Bridge any 8-connected diagonal-only pixel touch into 4-connectivity
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = isFilled(x, y);
        const b = isFilled(x + 1, y);
        const c = isFilled(x, y + 1);
        const d = isFilled(x + 1, y + 1);
        if (a && d && !b && !c) {
          grid[y + 1][x] = grid[y][x];
        } else if (b && c && !a && !d) {
          grid[y + 1][x + 1] = grid[y][x + 1];
        }
      }
    }

    // 2. Prune stray detached motes while keeping either the main silhouette component
    //    (minCompPx === 0) or all multi-part weapon/pommel components >= minCompPx.
    {
      const vis = new Uint8Array(w * h);
      const comps: Array<number[]> = [];
      const ortho = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (vis[idx] || !isFilled(x, y)) continue;
          vis[idx] = 1;
          const comp = [idx];
          let head = 0;
          while (head < comp.length) {
            const cur = comp[head++];
            const cx = cur % w, cy = Math.floor(cur / w);
            for (const [dx, dy] of ortho) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nIdx = ny * w + nx;
              if (vis[nIdx] || !isFilled(nx, ny)) continue;
              vis[nIdx] = 1;
              comp.push(nIdx);
            }
          }
          comps.push(comp);
        }
      }
      if (comps.length > 1) {
        comps.sort((a, b) => b.length - a.length);
        for (let c = 1; c < comps.length; c++) {
          if (minCompPx > 0 && comps[c].length >= minCompPx) continue;
          for (const idx of comps[c]) {
            grid[Math.floor(idx / w)][idx % w] = '.';
          }
        }
      }
    }

    // 3. Fill any enclosed interior transparent pinhole not reachable from the 4 borders
    const fillEnclosedHoles = (checkUnionWithCompanion: boolean) => {
      const ext = new Uint8Array(w * h);
      const q: number[] = [];
      const ortho = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
      const isUnionFilled = (x: number, y: number): boolean => {
        if (isFilled(x, y)) return true;
        if (!checkUnionWithCompanion || !companionRows) return false;
        const cCh = companionRows[y]?.[x] ?? '.';
        return cCh !== '.' && cCh !== ' ';
      };

      for (let x = 0; x < w; x++) {
        if (!isUnionFilled(x, 0)) { ext[x] = 1; q.push(x); }
        const bIdx = (h - 1) * w + x;
        if (!isUnionFilled(x, h - 1)) { ext[bIdx] = 1; q.push(bIdx); }
      }
      for (let y = 0; y < h; y++) {
        const lIdx = y * w;
        if (!isUnionFilled(0, y)) { ext[lIdx] = 1; q.push(lIdx); }
        const rIdx = y * w + (w - 1);
        if (!isUnionFilled(w - 1, y)) { ext[rIdx] = 1; q.push(rIdx); }
      }
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        const cx = cur % w, cy = Math.floor(cur / w);
        for (const [dx, dy] of ortho) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (!ext[nIdx] && !isUnionFilled(nx, ny)) {
            ext[nIdx] = 1;
            q.push(nIdx);
          }
        }
      }
      // Find enclosed transparent components and only fill genuine pinholes (<= 24px),
      // preserving large negative-space windows (e.g. between a character's torso and a slash crescent).
      const holeVisited = new Uint8Array(w * h);
      const smallHoleMask = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const startIdx = y * w + x;
          if (ext[startIdx] || holeVisited[startIdx] || isUnionFilled(x, y)) continue;
          holeVisited[startIdx] = 1;
          const comp = [startIdx];
          let hHead = 0;
          while (hHead < comp.length) {
            const cur = comp[hHead++];
            const cx = cur % w, cy = Math.floor(cur / w);
            for (const [dx, dy] of ortho) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nIdx = ny * w + nx;
              if (ext[nIdx] || holeVisited[nIdx] || isUnionFilled(nx, ny)) continue;
              holeVisited[nIdx] = 1;
              comp.push(nIdx);
            }
          }
          if (comp.length <= 24) {
            for (const cIdx of comp) smallHoleMask[cIdx] = 1;
          }
        }
      }

      // Iteratively fill small enclosed pinholes from adjacent filled pixels
      for (let pass = 0; pass < 6; pass++) {
        let changed = false;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            if (smallHoleMask[idx] && !isUnionFilled(x, y)) {
              for (const [dx, dy] of ortho) {
                if (isFilled(x + dx, y + dy)) {
                  grid[y][x] = grid[y + dy][x + dx];
                  changed = true;
                  break;
                } else if (checkUnionWithCompanion && companionRows) {
                  const cCh = companionRows[y + dy]?.[x + dx] ?? '.';
                  if (cCh !== '.' && cCh !== ' ') {
                    grid[y][x] = cCh;
                    changed = true;
                    break;
                  }
                }
              }
            }
          }
        }
        if (!changed) break;
      }
    };

    fillEnclosedHoles(false);
    if (companionRows) {
      fillEnclosedHoles(true);
    }

    return {
      w,
      h,
      originSub,
      rows: grid.map((r) => r.join('')),
    };
  };

  const animGrids: Record<string, ReliefFrameGrid[]> = {};
  let defaultGrid: ReliefFrameGrid | null = null;

  const composeAirborneGrid = (
    upperGrid: ReliefFrameGrid,
    legsGrid: ReliefFrameGrid,
    mode: 'rise' | 'fall',
    frame: 0 | 1,
  ): ReliefFrameGrid => {
    const w = upperGrid.w;
    const h = upperGrid.h;
    const out: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
    const plot = (x: number, y: number, ch: string) => {
      if (x >= 0 && x < w && y >= 0 && y < h && ch !== '.') {
        out[y][x] = ch;
      }
    };

    const wholeDy = mode === 'rise' ? -3 : -1;

    // 1. Lower body (y >= 65):
    //    - rise: high front-knee tuck + downward rear push-off leg from run[4] (dx = -2)
    //    - fall: gathered airborne landing-brace legs from run[0] (rear leg tucked under hip,
    //      front leg poised below center of gravity to catch the landing)
    if (mode === 'rise') {
      const legsDx = -2;
      for (let sy = 65; sy < h; sy++) {
        for (let sx = 0; sx < w; sx++) {
          const ch = legsGrid.rows[sy]?.[sx] ?? '.';
          if (ch === '.') continue;
          let dy = wholeDy;
          if (frame === 1 && sx >= 78 && sy >= 74) {
            dy -= 1; // subtle front knee apex tuck on frame 1
          }
          plot(sx + legsDx, sy + dy, ch);
        }
      }
    } else {
      // fall: first draw rear leg gathered forward & up under hip, then front leg poised below
      for (let sy = 70; sy < h; sy++) {
        for (let sx = 0; sx <= 80 && sx < w; sx++) {
          const ch = legsGrid.rows[sy]?.[sx] ?? '.';
          if (ch === '.') continue;
          const rearDy = wholeDy - 4 - (frame === 1 ? 1 : 0);
          plot(sx + 6, sy + rearDy, ch);
        }
      }
      for (let sy = 65; sy < h; sy++) {
        for (let sx = 70; sx < w; sx++) {
          if (sy >= 70 && sx < 78) continue;
          const ch = legsGrid.rows[sy]?.[sx] ?? '.';
          if (ch === '.') continue;
          const frontDx = -2;
          const frontDy = wholeDy + (sy >= 72 ? (frame === 1 ? 2 : 1) : 0);
          plot(sx + frontDx, sy + frontDy, ch);
        }
      }
    }

    // 2. Upper body (y <= 65): unified side-profile head, torso, both arms, and streaming scarf
    //    from run[0] (frame 0) and run[1] (frame 1), with neck-anchored vertical shear on the
    //    streaming scarf tails (downward trail on rise, upward billow on fall).
    for (let sy = 0; sy <= 65 && sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        const ch = upperGrid.rows[sy]?.[sx] ?? '.';
        if (ch === '.') continue;
        let scarfShearDy = 0;
        const isScarfTail = sx < 72 && sy >= 32 && sy <= (sx < 58 ? 60 : 54);
        if (isScarfTail) {
          const distFromNeck = 72 - sx;
          scarfShearDy =
            mode === 'rise'
              ? Math.round(distFromNeck * 0.18)
              : -Math.round(distFromNeck * 0.26);
        }
        plot(sx, sy + wholeDy + scarfShearDy, ch);
      }
    }

    return sanitizeFrameRows(out.map((r) => r.join('')));
  };

  for (const animName of animNames) {
    if (!(animName in refFile.anims)) {
      const runGrids = animGrids['run'];
      if ((animName === 'rise' || animName === 'fall') && runGrids && runGrids.length >= 5) {
        if (animName === 'rise') {
          animGrids[animName] = [
            composeAirborneGrid(runGrids[0], runGrids[4], 'rise', 0),
            composeAirborneGrid(runGrids[1], runGrids[4], 'rise', 1),
          ];
        } else {
          animGrids[animName] = [
            composeAirborneGrid(runGrids[0], runGrids[0], 'fall', 0),
            composeAirborneGrid(runGrids[1], runGrids[0], 'fall', 1),
          ];
        }
      }
      continue;
    }
    const resolved = resolveAnimName(refFile, animName);
    const entry = refFile.anims[resolved];
    const count =
      typeof entry === 'string' || !entry
        ? 1
        : 'frameCount' in entry
          ? entry.frameCount
          : entry.frames.length;
    const grids: ReliefFrameGrid[] = [];
    for (let f = 0; f < count; f++) {
      const rawRows = extractLayerRows(options.layerId, resolved, f);
      const compRows = options.companionLayerId
        ? extractLayerRows(options.companionLayerId, resolved, f)
        : undefined;
      if (rawRows.length > 0) {
        const g = sanitizeFrameRows(rawRows, compRows);
        grids.push(g);
        if (!defaultGrid) defaultGrid = g;
      }
    }
    if (grids.length > 0) {
      animGrids[animName] = grids;
    }
  }

  if (!defaultGrid) {
    throw new Error('createReferenceReliefShape: reference SpriteFile produced no frames');
  }

  return {
    type: 'relief',
    material: materialName,
    density,
    pitchDeg,
    thickness: 1.5,
    palette,
    grid: defaultGrid,
    animGrids,
    authoritative: true,
  };
}
