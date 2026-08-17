import {
  isLayeredSpriteFile,
  resolveAnimName,
  resolveAnimTiming,
  validateLayeredSpriteFile,
  type SpriteAnchor,
  type SpriteFile,
} from '../../src/engine/gfx/spritefile';

/**
 * Pure document operations for the sprite editor.
 *
 * The UI used to edit frame arrays, layer tracks, timeline counts, and
 * anchors independently. Those values are one aggregate: changing any one
 * without the others creates a document that can render for a moment and
 * then fail after a layer/frame/sprite switch. Keeping the aggregate rules
 * here gives UI handlers one operation to call and gives tests a DOM-free
 * seam.
 */

export interface SpriteDocumentCursor {
  animation: string;
  frame: number;
  layerId: string;
}

export interface FrameSize {
  w: number;
  h: number;
}

export type InsertFrameMode = 'empty' | 'duplicate';

function concreteAnimationNames(file: SpriteFile): string[] {
  return Object.entries(file.anims)
    .filter(([, entry]) => typeof entry !== 'string')
    .map(([name]) => name);
}

function rowsSize(rows: string[], label: string): FrameSize {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${label} needs at least one row`);
  const w = rows[0]?.length ?? 0;
  if (w < 1 || rows.some((row) => typeof row !== 'string' || row.length !== w)) {
    throw new Error(`${label} rows must have one equal, non-zero width`);
  }
  return { w, h: rows.length };
}

function emptyFrame(size: FrameSize): string[] {
  return Array.from({ length: size.h }, () => '.'.repeat(size.w));
}

function cloneFrame(rows: string[]): string[] {
  return rows.slice();
}

/**
 * Turn one borrowed animation into editable art of its own.
 *
 * Aliases are useful while a move intentionally shares art, but changing an
 * alias into a real timeline is an aggregate document edit: timing, every
 * layer, and every frame-aligned anchor must split together. Keeping that
 * protocol here prevents the UI (and future automation) from cloning only the
 * visible layer and leaving a document that fails on the next frame switch.
 */
export function materializeSpriteAnimationAlias(file: SpriteFile, animation: string): string {
  validateSpriteEditorDocument(file);
  const alias = file.anims[animation];
  if (alias === undefined) throw new Error(`unknown animation "${animation}"`);
  if (typeof alias !== 'string') throw new Error(`animation "${animation}" is already independent`);

  const target = resolveAnimName(file, animation);
  const timing = resolveAnimTiming(file, target);
  if (!timing) throw new Error(`animation "${animation}" cannot resolve its source`);

  if (isLayeredSpriteFile(file)) {
    file.anims[animation] = {
      fps: timing.fps,
      frameCount: timing.frameCount,
      ...(timing.loop === undefined ? {} : { loop: timing.loop }),
    };
    for (const layer of file.layers) {
      const source = layer.tracks[target];
      if (!source) throw new Error(`layer "${layer.id}" has no "${target}" track`);
      layer.tracks[animation] = source.map(cloneFrame);
    }
  } else {
    const source = file.anims[target];
    if (!source || typeof source === 'string') throw new Error(`animation "${target}" has no frames`);
    file.anims[animation] = {
      fps: source.fps,
      frames: source.frames.map(cloneFrame),
      ...(source.loop === undefined ? {} : { loop: source.loop }),
    };
  }

  for (const group of Object.values(file.anchors ?? {})) {
    // Runtime aliases may override their target's anchor path. Preserve that
    // authored override when present; otherwise make an independent copy of
    // the resolved source path.
    const source = group[animation] ?? group[target];
    if (source) group[animation] = source.map((point) => ({ ...point }));
  }

  validateSpriteEditorDocument(file);
  return target;
}

function frameTracks(file: SpriteFile, animation: string): string[][][] {
  const target = resolveAnimName(file, animation);
  if (isLayeredSpriteFile(file)) {
    return file.layers.map((layer) => {
      const frames = layer.tracks[target];
      if (!frames) throw new Error(`layer "${layer.id}" has no "${target}" track`);
      return frames;
    });
  }
  const entry = file.anims[target];
  if (!entry || typeof entry === 'string') throw new Error(`animation "${target}" has no frames`);
  return [entry.frames];
}

function anchorTracks(file: SpriteFile, animation: string): SpriteAnchor[][] {
  const target = resolveAnimName(file, animation);
  const equivalentNames = new Set(Object.keys(file.anims)
    .filter((name) => resolveAnimName(file, name) === target));
  return Object.values(file.anchors ?? {}).flatMap((group) => Object.entries(group)
    .filter(([name, points]) => equivalentNames.has(name) && Array.isArray(points))
    .map(([, points]) => points));
}

export function spriteDocumentFrameSize(file: SpriteFile): FrameSize {
  const first = concreteAnimationNames(file)[0];
  if (!first) throw new Error('sprite needs at least one concrete animation');
  return rowsSize(frameTracks(file, first)[0][0], `animation "${first}" frame 1`);
}

/** Validate editor-level invariants for both flat and layered files. */
export function validateSpriteEditorDocument(file: SpriteFile): void {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('file must be a SpriteFile object');
  if (!file.anims || typeof file.anims !== 'object' || Array.isArray(file.anims)) {
    throw new Error('sprite animations must be an object');
  }
  if (file.renderTag !== undefined && (typeof file.renderTag !== 'string' || !file.renderTag.trim())) {
    throw new Error('sprite renderTag must be non-empty');
  }
  if (file.w !== undefined && (!Number.isFinite(file.w) || file.w <= 0)) {
    throw new Error('sprite physical width must be positive');
  }
  if (file.h !== undefined && (!Number.isFinite(file.h) || file.h <= 0)) {
    throw new Error('sprite physical height must be positive');
  }
  if (file.hitbox && (typeof file.hitbox !== 'object' || Array.isArray(file.hitbox))) {
    throw new Error('sprite hitbox must be an object');
  }
  if (file.hitbox) {
    const values = [file.hitbox.x ?? 0, file.hitbox.y ?? 0, file.hitbox.w, file.hitbox.h];
    if (values.some((value) => value !== undefined && !Number.isFinite(value))
      || (file.hitbox.w !== undefined && file.hitbox.w <= 0)
      || (file.hitbox.h !== undefined && file.hitbox.h <= 0)) {
      throw new Error('sprite hitbox needs finite coordinates and positive width/height');
    }
  }
  const names = Object.keys(file.anims);
  if (!names.length) throw new Error('sprite needs at least one animation');
  const concrete = concreteAnimationNames(file);
  if (!concrete.length) throw new Error('sprite needs at least one concrete animation');
  for (const name of names) resolveAnimName(file, name);
  if (isLayeredSpriteFile(file)) validateLayeredSpriteFile(file);

  if (file.anchors !== undefined && (!file.anchors || typeof file.anchors !== 'object' || Array.isArray(file.anchors))) {
    throw new Error('sprite anchors must be an object');
  }
  if (file.attachmentSlots !== undefined
    && (!file.attachmentSlots || typeof file.attachmentSlots !== 'object' || Array.isArray(file.attachmentSlots))) {
    throw new Error('sprite attachmentSlots must be an object');
  }

  for (const name of concrete) {
    const timing = resolveAnimTiming(file, name);
    if (!timing || !Number.isFinite(timing.fps) || timing.fps <= 0 || timing.frameCount < 1) {
      throw new Error(`animation "${name}" needs positive fps and at least one frame`);
    }
    const tracks = frameTracks(file, name);
    let expected: FrameSize | undefined;
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      const frames = tracks[trackIndex];
      if (frames.length !== timing.frameCount) {
        throw new Error(`animation "${name}" track ${trackIndex + 1} expected ${timing.frameCount} frames, got ${frames.length}`);
      }
      for (let frame = 0; frame < frames.length; frame++) {
        const size = rowsSize(frames[frame], `animation "${name}" frame ${frame + 1}`);
        expected ??= size;
        if (size.w !== expected.w || size.h !== expected.h) {
          throw new Error(`animation "${name}" frame ${frame + 1} must be ${expected.w}x${expected.h}`);
        }
      }
    }

    for (const [anchorName, group] of Object.entries(file.anchors ?? {})) {
      const points = group[name];
      if (!points) continue;
      if (points.length !== timing.frameCount) {
        throw new Error(`anchor "${anchorName}.${name}" expected ${timing.frameCount} points, got ${points.length}`);
      }
      if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || (point.angle !== undefined && !Number.isFinite(point.angle)))) {
        throw new Error(`anchor "${anchorName}.${name}" contains a non-finite point`);
      }
    }
  }

  for (const [anchorName, group] of Object.entries(file.anchors ?? {})) {
    if (!anchorName.trim() || !group || typeof group !== 'object' || Array.isArray(group)) {
      throw new Error('sprite anchors need non-empty names and animation groups');
    }
    for (const [name, points] of Object.entries(group)) {
      if (!(name in file.anims)) throw new Error(`anchor "${anchorName}.${name}" uses missing animation "${name}"`);
      const timing = resolveAnimTiming(file, name);
      if (!timing) throw new Error(`anchor "${anchorName}.${name}" uses unresolved animation "${name}"`);
      if (!Array.isArray(points) || points.length !== timing.frameCount) {
        throw new Error(`anchor "${anchorName}.${name}" expected ${timing.frameCount} points, got ${Array.isArray(points) ? points.length : 0}`);
      }
      if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || (point.angle !== undefined && !Number.isFinite(point.angle)))) {
        throw new Error(`anchor "${anchorName}.${name}" contains a non-finite point`);
      }
    }
  }

  for (const [slotName, slot] of Object.entries(file.attachmentSlots ?? {})) {
    if (!slotName.trim() || !slot || typeof slot !== 'object' || Array.isArray(slot)
      || typeof slot.anchor !== 'string' || !slot.anchor.trim()) {
      throw new Error('sprite attachment slots need non-empty names and anchors');
    }
    if (!file.anchors?.[slot.anchor]) {
      throw new Error(`attachment slot "${slotName}" uses missing anchor "${slot.anchor}"`);
    }
  }

  if (file.palette !== undefined && (!file.palette || typeof file.palette !== 'object' || Array.isArray(file.palette))) {
    throw new Error('sprite palette must be an object');
  }
  for (const [key, color] of Object.entries(file.palette ?? {})) {
    if (key.length !== 1) throw new Error(`palette key "${key}" must be one character`);
    if (key === '.' && color !== null) throw new Error('palette key "." must be transparent');
    if (color !== null && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
      throw new Error(`palette color for "${key}" must be #RRGGBB, #RRGGBBAA, or null`);
    }
  }
}

export function reconcileSpriteDocumentCursor(
  file: SpriteFile,
  cursor: SpriteDocumentCursor,
  defaultLayerId = 'base',
): SpriteDocumentCursor {
  const animation = file.anims[cursor.animation]
    ? cursor.animation
    : Object.keys(file.anims)[0];
  const timing = resolveAnimTiming(file, animation);
  if (!timing) throw new Error(`animation "${animation}" cannot be resolved`);
  const frame = Math.max(0, Math.min(Math.trunc(cursor.frame) || 0, timing.frameCount - 1));
  const layerId = isLayeredSpriteFile(file)
    ? (file.layers.some((layer) => layer.id === cursor.layerId)
      ? cursor.layerId
      : file.layers.find((layer) => layer.id === defaultLayerId)?.id ?? file.layers[0].id)
    : defaultLayerId;
  return { animation, frame, layerId };
}

export function insertSpriteFrame(
  file: SpriteFile,
  animation: string,
  index: number,
  mode: InsertFrameMode,
): number {
  validateSpriteEditorDocument(file);
  const target = resolveAnimName(file, animation);
  const tracks = frameTracks(file, target);
  const count = tracks[0].length;
  if (!Number.isInteger(index) || index < 0 || index > count) throw new Error(`frame insertion index ${index} is out of range`);
  const sourceIndex = Math.max(0, Math.min(index - 1, count - 1));
  const size = rowsSize(tracks[0][sourceIndex], `animation "${target}" frame ${sourceIndex + 1}`);
  for (const track of tracks) {
    const rows = mode === 'duplicate' ? cloneFrame(track[sourceIndex]) : emptyFrame(size);
    track.splice(index, 0, rows);
  }
  if (isLayeredSpriteFile(file)) {
    const entry = file.anims[target];
    if (!entry || typeof entry === 'string') throw new Error(`animation "${target}" has no timeline`);
    entry.frameCount = count + 1;
  }
  for (const points of anchorTracks(file, target)) {
    const fallback = points[sourceIndex] ?? { x: size.w / 2, y: size.h / 2 };
    points.splice(index, 0, { ...fallback });
  }
  validateSpriteEditorDocument(file);
  return index;
}

export function removeSpriteFrame(file: SpriteFile, animation: string, index: number): number {
  validateSpriteEditorDocument(file);
  const target = resolveAnimName(file, animation);
  const tracks = frameTracks(file, target);
  const count = tracks[0].length;
  if (count <= 1) throw new Error(`animation "${target}" must keep at least one frame`);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`frame ${index} is out of range`);
  for (const track of tracks) track.splice(index, 1);
  if (isLayeredSpriteFile(file)) {
    const entry = file.anims[target];
    if (!entry || typeof entry === 'string') throw new Error(`animation "${target}" has no timeline`);
    entry.frameCount = count - 1;
  }
  for (const points of anchorTracks(file, target)) points.splice(index, 1);
  validateSpriteEditorDocument(file);
  return Math.min(index, count - 2);
}

export function moveSpriteFrame(file: SpriteFile, animation: string, from: number, to: number): number {
  validateSpriteEditorDocument(file);
  const target = resolveAnimName(file, animation);
  const tracks = frameTracks(file, target);
  const count = tracks[0].length;
  if (![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < count)) {
    throw new Error(`frame move ${from} -> ${to} is out of range`);
  }
  if (from === to) return to;
  for (const track of tracks) {
    const [moved] = track.splice(from, 1);
    track.splice(to, 0, moved);
  }
  for (const points of anchorTracks(file, target)) {
    const [moved] = points.splice(from, 1);
    points.splice(to, 0, moved);
  }
  validateSpriteEditorDocument(file);
  return to;
}

export function resizeSpriteDocument(file: SpriteFile, w: number, h: number): void {
  validateSpriteEditorDocument(file);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error('sprite dimensions must be positive integers');
  }
  for (const name of concreteAnimationNames(file)) {
    for (const track of frameTracks(file, name)) {
      for (let frame = 0; frame < track.length; frame++) {
        track[frame] = Array.from(
          { length: h },
          (_, y) => (track[frame][y] ?? '').slice(0, w).padEnd(w, '.'),
        );
      }
    }
  }
  validateSpriteEditorDocument(file);
}

/** Return every alias that ultimately depends on the named animation. */
function dependentAnimationNames(file: SpriteFile, animation: string): Set<string> {
  const removed = new Set<string>([animation]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of Object.entries(file.anims)) {
      if (typeof entry === 'string' && removed.has(entry) && !removed.has(name)) {
        removed.add(name);
        changed = true;
      }
    }
  }
  return removed;
}

export function deleteSpriteAnimation(file: SpriteFile, animation: string): string {
  validateSpriteEditorDocument(file);
  if (!file.anims[animation]) throw new Error(`unknown animation "${animation}"`);
  const concreteBefore = concreteAnimationNames(file);
  const target = resolveAnimName(file, animation);
  if (typeof file.anims[animation] !== 'string' && concreteBefore.length <= 1) {
    throw new Error('sprite must keep at least one concrete animation');
  }
  const removed = dependentAnimationNames(file, animation);
  // Deleting a concrete target must also remove aliases that resolve to it,
  // including alias-to-alias chains. Deleting one alias leaves its target.
  if (animation === target) {
    for (const name of Object.keys(file.anims)) {
      if (resolveAnimName(file, name) === target) removed.add(name);
    }
  }
  for (const name of removed) delete file.anims[name];
  if (isLayeredSpriteFile(file) && removed.has(target)) {
    for (const layer of file.layers) delete layer.tracks[target];
  }
  for (const group of Object.values(file.anchors ?? {})) {
    for (const name of removed) delete group[name];
  }
  const next = Object.keys(file.anims)[0];
  validateSpriteEditorDocument(file);
  return next;
}
