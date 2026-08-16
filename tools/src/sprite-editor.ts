/// <reference types="vite/client" />

import {
  resolveSpriteGeometry, resolveAnim, resolveAnimName, resolveAnimTiming,
  compositeSpriteFrame, compositeSpriteFrameByTags, isLayeredSpriteFile, validateLayeredSpriteFile,
  sprite, epx,
  type Palette, type SpriteFile, type FlatSpriteFile, type LayeredSpriteFile,
  type SpriteAnimData, type LayeredSpriteAnimData, type SpriteLayerData, type SpriteAnchor,
} from '@engine/index';
import { PAL } from '@game/content/palette';
import {
  configurePlayerRenderTags,
  type PlayerRenderTagDef,
} from '@game/content/render-tags';
import repositoryRenderTagDefs from '@game/content/render-tags.json';
// Composite preview: the editor borrows the GAME's renderers rather than
// imitating them, so what you see here — held weapon anchored to the
// body, slash trail sweeping on the attack clock — is exactly what the
// game draws. The weapon anchors and the trail are code, not sprites;
// no sprite-only overlay could show this truthfully.
import {
  drawHeldWeaponTag,
  drawWeaponTrail,
  weaponVisuals,
  rebuildSpriteWeapon,
} from '@game/content/weapon-visuals';
import {
  weapons,
  weaponTypeOf,
  allAttacks,
  replaceWeaponCombatTuning,
  type WeaponCombatTuning,
  type WeaponCombatTuningEntry,
  type WeaponCombatTuningProfile,
} from '@game/content/weapons';
import repositoryWeaponCombat from '@game/content/weapon-combat.json';
import {
  KNIGHT_ANIMS,
  PLAYER_BODY_SPRITE_PATH,
  rebuildKnightSprite,
} from '@game/content/sprites';
import { rebuildGearVisual } from '@game/content/gear-visuals';
// The "player (full)" body drives a REAL Player — body-english, gear
// layers, held weapon and trail all come from Player.render, posed via
// its poseAttack seam. Content self-registers on import (the game's
// register*() functions are empty bodies that exist to force imports),
// so pulling in items and classes here fills every registry the
// constructor touches.
import { Player } from '@game/actors/player';
import '@game/content/items';
import '@game/content/classes';
import '@game/content/skills';
import '@game/content/skilltree';

/**
 * Sprite editor for the engine's per-sprite JSON format
 * (content/sprites/*.json): a palette plus named animations of 1x text
 * grids. Paint on a zoomed grid, manage animations and their frames, watch
 * every animation play at once (optionally EPX-upscaled to the game's 4x
 * "hd" density), then export/import the exact file the game loads.
 */

const MAX_GRID_SIZE = 160;
let cellSize = 24;

/* ---------------- state ---------------- */

let file: SpriteFile = {
  hd: true,
  palette: { ...PAL },
  anims: { idle: { fps: 8, frames: [emptyFrame(12, 14)] } },
};
let animName = 'idle';
let frameIdx = 0;
let previewStepFrame = 0;
let previewStepping = false;
let previewDisplayedFrame = 0;
let currentChar = firstPaintChar();
let painting = false;
let erasing = false;
type EditorTool = 'draw' | 'brush' | 'blur' | 'fill' | 'picker' | 'select' | 'magic';
let currentTool: EditorTool = 'draw';
let transformMode = false;
let altPickerActive = false;
let picking = false;
let lastPaintCell: { x: number; y: number } | null = null;
let hoverPointer: { x: number; y: number } | null = null;
let strokePaletteChanged = false;
interface PixelRect { x: number; y: number; w: number; h: number }
interface PixelSelection extends PixelRect { mask?: string[] }
interface PixelClipboard { w: number; h: number; rows: string[]; mask?: string[]; palette?: Palette }
interface SelectionMove {
  start: { x: number; y: number };
  original: PixelSelection;
  source: PixelClipboard;
  baseFrame: string[];
  last: { x: number; y: number };
  moved: boolean;
}
type SelectionResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type SelectionHandle = SelectionResizeHandle | 'rotate';
interface SelectionHandleTransform {
  handle: SelectionHandle;
  original: PixelSelection;
  source: PixelClipboard;
  baseFrame: string[];
  startPointer: { x: number; y: number };
  startAngle: number;
  lastKey: string;
  moved: boolean;
  flipX: boolean;
  flipY: boolean;
}
interface SharedSelection extends PixelRect {
  path: string | null;
  anim: string;
  frame: number;
  layerId?: string;
  rows: string[];
  mask?: string[];
  source: string;
  updatedAt: number;
}
let selection: PixelSelection | null = null;
type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';
let selectionModifierKeys = { shiftKey: false, altKey: false };
interface SelectionDrag {
  x: number;
  y: number;
  mode: SelectionCombineMode;
  base: Set<string>;
}
interface MagicSelectionDrag {
  initialMode: SelectionCombineMode;
  mode: SelectionCombineMode;
  last: { x: number; y: number };
}
let selectionStart: SelectionDrag | null = null;
let magicSelectionDrag: MagicSelectionDrag | null = null;
let selectionMove: SelectionMove | null = null;
let selectionHandleTransform: SelectionHandleTransform | null = null;
let pixelClipboard: PixelClipboard | null = null;
let refFile: SpriteFile | null = null;
let currentFileName = 'new sprite.json';
let currentRepoPath: string | null = null;
let selectedAnchorName = '';
let selectedAttachmentSlotName = '';
const FLAT_LAYER_ID = 'base';
let activeLayerId = FLAT_LAYER_ID;
let hiddenLayerIds = new Set<string>();
let lockedLayerIds = new Set<string>();
let soloLayerId: string | null = null;
// Versioned separately from the broad editor view state: older view snapshots
// could have Front Hand active merely because it used to be the fallback.
// They must not be mistaken for an intentional per-sprite layer choice.
const LAYER_SELECTIONS_KEY = 'hitstop.sprite-editor.layer-selections.v2';
let layerSelectionBySprite = readLayerSelections();
let layerExtractTargetId = '';
let layerExtractAnchorName = 'frontHand';
let layerExtractAnchorManuallySet = false;
const undoStack: string[] = [];
const redoStack: string[] = [];
const MAX_HISTORY = 100;

interface BridgeState {
  path: string | null;
  file: SpriteFile;
  revision: number;
  source: string;
  updatedAt: number;
  dirty: boolean;
}

/** Editor-only content metadata. The engine ignores it; tools use it to
 * discover capabilities without hardcoding character file names. */
interface SpriteEditorMetadata {
  canEquipWeapon?: boolean;
}

type EditorSpriteFile = SpriteFile & {
  editor?: SpriteEditorMetadata;
};

const BRIDGE = '/__sprite-editor';
const bridgeClientId = `editor-${crypto.randomUUID()}`;
let bridgeRevision = 0;
let bridgeDirty = false;
let bridgeConnected = false;
let bridgeConflict = false;
let bridgePublishing = false;
let lastSharedFile = '';
let lastRepositoryFile = '';
let previewTimer = 0;
const DRAFT_PREFIX = 'hitstop.sprite-editor.draft:';
const RENDER_TAG_DRAFT_KEY = 'hitstop.sprite-editor.render-tags.draft';
const WEAPON_COMBAT_DRAFT_KEY = 'hitstop.sprite-editor.weapon-combat.draft.v2';
let lastDraftSignature = '';
let editorViewReady = false;
let savedRenderTagSignature = JSON.stringify(repositoryRenderTagDefs);
let renderTagDefs: PlayerRenderTagDef[] = readRenderTagDraft();
let savedWeaponCombatSignature = JSON.stringify(repositoryWeaponCombat);
let weaponCombatTuning: WeaponCombatTuning = readWeaponCombatDraft();

function validWeaponCombatTuning(value: unknown): value is WeaponCombatTuning {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((rawProfile) => {
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) return false;
    const profile = rawProfile as WeaponCombatTuningProfile;
    return Number.isFinite(profile.fps) && profile.fps > 0
      && profile.moves && typeof profile.moves === 'object' && !Array.isArray(profile.moves)
      && Object.values(profile.moves).every((entry) => (
      entry && typeof entry === 'object' && !Array.isArray(entry)
      && Number.isInteger((entry as WeaponCombatTuningEntry).frameCount)
      && Array.isArray((entry as WeaponCombatTuningEntry).activeFrames)
      && (entry as WeaponCombatTuningEntry).activeFrames.length === 2
      && Object.values((entry as WeaponCombatTuningEntry).hitbox ?? {}).every(Number.isFinite)
      ));
  });
}

function readWeaponCombatDraft(): WeaponCombatTuning {
  try {
    const stored = JSON.parse(localStorage.getItem(WEAPON_COMBAT_DRAFT_KEY) ?? 'null') as unknown;
    if (validWeaponCombatTuning(stored)) return structuredClone(stored);
  } catch {
    // A malformed convenience draft must not prevent the editor opening.
  }
  return structuredClone(repositoryWeaponCombat) as unknown as WeaponCombatTuning;
}

function weaponCombatDirty(): boolean {
  return JSON.stringify(weaponCombatTuning) !== savedWeaponCombatSignature;
}

function persistWeaponCombatDraft(): void {
  try {
    if (weaponCombatDirty()) localStorage.setItem(WEAPON_COMBAT_DRAFT_KEY, JSON.stringify(weaponCombatTuning));
    else localStorage.removeItem(WEAPON_COMBAT_DRAFT_KEY);
  } catch {
    // Combat editing remains usable when storage is unavailable.
  }
}

for (const [typeId, tuning] of Object.entries(weaponCombatTuning)) {
  try { replaceWeaponCombatTuning(typeId, tuning); } catch { /* stale draft for a removed weapon type */ }
}

function validRenderTagDefs(value: unknown): value is PlayerRenderTagDef[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const definition = entry as Partial<PlayerRenderTagDef>;
    if (typeof definition.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(definition.id)
      || typeof definition.label !== 'string' || !definition.label.trim() || ids.has(definition.id)) return false;
    ids.add(definition.id);
    return true;
  }) && visualRenderTagIds().every((id) => ids.has(id));
}

function visualRenderTagIds(): string[] {
  return [...new Set(weaponVisuals.entries().flatMap(([, visual]) => [
    ...visual.renderTags,
    ...(visual.gripRenderTag ? [visual.gripRenderTag] : []),
  ]))];
}

function readRenderTagDraft(): PlayerRenderTagDef[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RENDER_TAG_DRAFT_KEY) ?? 'null') as unknown;
    if (validRenderTagDefs(stored)) return structuredClone(stored);
  } catch {
    // Ignore a malformed convenience draft and fall back to repository data.
  }
  return structuredClone(repositoryRenderTagDefs) as PlayerRenderTagDef[];
}

function renderTagIds(): string[] {
  return renderTagDefs.map((definition) => definition.id);
}

function renderTagEntries(): [string, PlayerRenderTagDef][] {
  return renderTagDefs.map((definition) => [definition.id, definition]);
}

function hasRenderTag(id: string): boolean {
  return renderTagDefs.some((definition) => definition.id === id);
}

function renderTagsDirty(): boolean {
  return JSON.stringify(renderTagDefs) !== savedRenderTagSignature;
}

function persistRenderTagDraft(): void {
  try {
    if (renderTagsDirty()) localStorage.setItem(RENDER_TAG_DRAFT_KEY, JSON.stringify(renderTagDefs));
    else localStorage.removeItem(RENDER_TAG_DRAFT_KEY);
  } catch {
    // Sprite editing remains usable when storage is unavailable.
  }
}

configurePlayerRenderTags(renderTagDefs);

interface StoredSpriteDraft {
  v: 1;
  path: string;
  file: SpriteFile;
  baseFile: string;
  updatedAt: number;
}

function draftKey(path: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(path)}`;
}

function readDraft(path: string): StoredSpriteDraft | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftKey(path)) ?? 'null') as StoredSpriteDraft | null;
    if (parsed?.v !== 1 || parsed.path !== path || !parsed.file?.anims) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Keep unsaved pixels when repository tag ids are renamed between sessions. */
function reconcileDraftRenderTags(draftFile: SpriteFile, repositoryFile: SpriteFile): void {
  const repositoryLayers = isLayeredSpriteFile(repositoryFile)
    ? new Map(repositoryFile.layers.map((layer) => [layer.id, layer.tag]))
    : new Map<string, string>();
  const repositoryFallback = repositoryFile.renderTag
    ?? (isLayeredSpriteFile(repositoryFile) ? repositoryFile.layers[0]?.tag : undefined);
  const replacementFor = (layerId?: string): string | undefined => {
    const matching = layerId ? repositoryLayers.get(layerId) : undefined;
    if (matching && hasRenderTag(matching)) return matching;
    if (repositoryFallback && hasRenderTag(repositoryFallback)) return repositoryFallback;
    return renderTagDefs[0]?.id;
  };

  if (isLayeredSpriteFile(draftFile)) {
    for (const layer of draftFile.layers) {
      if (!hasRenderTag(layer.tag)) layer.tag = replacementFor(layer.id) ?? layer.tag;
    }
  } else if (!draftFile.renderTag || !hasRenderTag(draftFile.renderTag)) {
    draftFile.renderTag = replacementFor();
  }
}

function storedDrafts(): StoredSpriteDraft[] {
  const drafts: StoredSpriteDraft[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key) ?? 'null') as StoredSpriteDraft | null;
      if (draft?.v === 1 && typeof draft.path === 'string' && draft.file?.anims) drafts.push(draft);
    } catch {
      // A damaged draft is ignored here and remains in storage for manual
      // recovery; saving healthy documents must still be possible.
    }
  }
  return drafts.sort((a, b) => a.path.localeCompare(b.path));
}

function clearDraft(path: string): void {
  localStorage.removeItem(draftKey(path));
  if (lastDraftSignature.startsWith(`${path}\0`)) lastDraftSignature = '';
}

function persistCurrentDraft(): void {
  if (!currentRepoPath) return;
  rememberWorkingSprite(currentRepoPath, file);
  const serialized = JSON.stringify(file);
  if (lastRepositoryFile && serialized === lastRepositoryFile) {
    clearDraft(currentRepoPath);
    return;
  }
  const signature = `${currentRepoPath}\0${lastRepositoryFile}\0${serialized}`;
  if (signature === lastDraftSignature) return;
  try {
    const draft: StoredSpriteDraft = {
      v: 1,
      path: currentRepoPath,
      file,
      baseFile: lastRepositoryFile,
      updatedAt: Date.now(),
    };
    localStorage.setItem(draftKey(currentRepoPath), JSON.stringify(draft));
    lastDraftSignature = signature;
  } catch (error) {
    flash(`local draft failed: ${(error as Error).message}`);
  }
}

function emptyFrame(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}
function firstPaintChar(): string {
  const entry = Object.entries(file.palette ?? {}).find(([, c]) => c);
  return entry ? entry[0] : 'S';
}

const pal = (): Palette => file.palette ?? {};

function readLayerSelections(): Record<string, string> {
  try {
    const stored = JSON.parse(sessionStorage.getItem(LAYER_SELECTIONS_KEY) ?? '{}') as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function persistLayerSelections(): void {
  try {
    sessionStorage.setItem(LAYER_SELECTIONS_KEY, JSON.stringify(layerSelectionBySprite));
  } catch {
    // Layer continuity is convenience state; storage denial must not block editing.
  }
}

function defaultActiveLayerId(spriteFile: SpriteFile = file): string {
  if (!isLayeredSpriteFile(spriteFile)) return FLAT_LAYER_ID;
  // The first authored/base layer is the safest editing surface. A foreground
  // detail such as Front Hand must never become active merely because it is
  // last in render order.
  return spriteFile.layers.find((layer) => layer.id === FLAT_LAYER_ID)?.id
    ?? spriteFile.layers.find((layer) => /^base$/i.test(layer.name))?.id
    ?? spriteFile.layers[0]?.id
    ?? FLAT_LAYER_ID;
}

function rememberActiveLayer(path: string | null = currentRepoPath): void {
  if (!path || !isLayeredSpriteFile(file) || !file.layers.some((layer) => layer.id === activeLayerId)) return;
  layerSelectionBySprite[path] = activeLayerId;
  persistLayerSelections();
}

function restoreActiveLayer(path: string | null, spriteFile: SpriteFile = file): void {
  if (!isLayeredSpriteFile(spriteFile)) {
    activeLayerId = FLAT_LAYER_ID;
    return;
  }
  const remembered = path ? layerSelectionBySprite[path] : undefined;
  activeLayerId = remembered && spriteFile.layers.some((layer) => layer.id === remembered)
    ? remembered
    : defaultActiveLayerId(spriteFile);
}
/**
 * The animation being edited, RESOLVED: an alias entry ("plunge":
 * "attack") has no frames of its own, so selecting one jumps to its
 * target (see buildAnims) and this accessor follows the chain as a
 * belt-and-braces. Mutations through it therefore edit the target's
 * frames, which is the only thing an alias could mean in an editor.
 */
const activeLayer = (): SpriteLayerData | null => isLayeredSpriteFile(file)
  ? file.layers.find((layer) => layer.id === activeLayerId) ?? file.layers.at(-1) ?? null
  : null;

function activeFrames(name = animName): string[][] {
  const target = resolveAnimName(file, name);
  if (isLayeredSpriteFile(file)) {
    const layer = activeLayer();
    if (!layer) throw new Error('layered sprite has no active layer');
    return layer.tracks[target];
  }
  const entry = file.anims[target];
  if (!entry || typeof entry === 'string') throw new Error(`animation ${target} has no frames`);
  return entry.frames;
}

const anim = (): SpriteAnimData => {
  const timing = resolveAnimTiming(file, animName);
  if (!timing) throw new Error(`unknown animation ${animName}`);
  return { fps: timing.fps, loop: timing.loop, frames: activeFrames() };
};
/** Concrete (non-alias) animations — the only ones with frames to edit,
 * resize, or export as art. */
const concreteAnimNames = (): string[] =>
  Object.entries(file.anims).filter(([, entry]) => typeof entry !== 'string').map(([name]) => name);
const concreteAnims = (): [string, SpriteAnimData][] =>
  concreteAnimNames().map((name) => [name, {
    fps: resolveAnimTiming(file, name)!.fps,
    loop: resolveAnimTiming(file, name)!.loop,
    frames: activeFrames(name),
  }]);
const cur = () => anim().frames[frameIdx];
const compositeCur = (index = frameIdx): string[] => {
  const include = (layer: SpriteLayerData) => (
    soloLayerId ? layer.id === soloLayerId : !hiddenLayerIds.has(layer.id)
  );
  return (isLayeredSpriteFile(file)
    ? compositeSpriteFrameByTags(file, animName, index, renderTagIds(), PAL, include)
    : compositeSpriteFrame(file, animName, index, PAL, include)) ?? cur();
};
const visibleAnim = (): SpriteAnimData => {
  const timing = resolveAnimTiming(file, animName)!;
  return {
    fps: timing.fps,
    loop: timing.loop,
    frames: Array.from({ length: timing.frameCount }, (_, index) => compositeCur(index)),
  };
};
const W = () => cur()[0].length;
const H = () => cur().length;
const density = () => file.hd === false ? 4 : 1;

function concreteAnimName(name = animName): string {
  return concreteAnimNameOf(file, name);
}

function concreteAnimNameOf(spriteFile: SpriteFile, name: string): string {
  return resolveAnimName(spriteFile, name);
}

function reconcileLayerState(reset = false): void {
  if (!isLayeredSpriteFile(file)) {
    activeLayerId = FLAT_LAYER_ID;
    hiddenLayerIds.clear();
    lockedLayerIds.clear();
    soloLayerId = null;
    return;
  }
  const ids = new Set(file.layers.map((layer) => layer.id));
  if (reset || !ids.has(activeLayerId)) activeLayerId = defaultActiveLayerId(file);
  hiddenLayerIds = new Set([...hiddenLayerIds].filter((id) => ids.has(id)));
  lockedLayerIds = new Set([...lockedLayerIds].filter((id) => ids.has(id)));
  if (soloLayerId && !ids.has(soloLayerId)) soloLayerId = null;
}

function uniqueLayerId(label: string): string {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';
  const ids = new Set(isLayeredSpriteFile(file) ? file.layers.map((layer) => layer.id) : []);
  let id = stem;
  for (let suffix = 2; ids.has(id); suffix++) id = `${stem}-${suffix}`;
  return id;
}

function defaultLayerTag(spriteFile: SpriteFile = file): string {
  const configured = spriteFile.renderTag;
  if (configured && hasRenderTag(configured)) return configured;
  const fallback = renderTagDefs[0]?.id;
  if (!fallback) throw new Error('at least one render tag is required');
  return fallback;
}

function ensureLayeredFile(): LayeredSpriteFile {
  if (isLayeredSpriteFile(file)) return file;
  const flat = file as FlatSpriteFile & EditorSpriteFile;
  const tracks: Record<string, string[][]> = {};
  const anims: Record<string, LayeredSpriteAnimData | string> = {};
  for (const [name, entry] of Object.entries(flat.anims)) {
    if (typeof entry === 'string') anims[name] = entry;
    else {
      tracks[name] = entry.frames;
      anims[name] = { fps: entry.fps, frameCount: entry.frames.length, loop: entry.loop };
    }
  }
  const { anims: _flatAnims, renderTag: _flatRenderTag, ...rest } = flat;
  file = {
    ...rest,
    anims,
    layers: [{ id: FLAT_LAYER_ID, name: 'Base', tag: defaultLayerTag(), tracks }],
  } as LayeredSpriteFile & EditorSpriteFile;
  activeLayerId = FLAT_LAYER_ID;
  reconcileLayerState();
  rememberActiveLayer();
  return file as LayeredSpriteFile;
}

function requireEditableLayer(): boolean {
  if (!isLayeredSpriteFile(file) || !lockedLayerIds.has(activeLayerId)) return true;
  flash(`layer “${activeLayer()?.name ?? activeLayerId}” is locked`);
  return false;
}

function currentAnchor(): SpriteAnchor | undefined {
  if (!selectedAnchorName) return undefined;
  return file.anchors?.[selectedAnchorName]?.[concreteAnimName()]?.[frameIdx];
}

function ensureCurrentAnchor(): SpriteAnchor {
  if (!selectedAnchorName) throw new Error('select an anchor first');
  const name = concreteAnimName();
  const target = resolveAnim(file, name)!;
  const group = (file.anchors ??= {})[selectedAnchorName] ??= {};
  const points = group[name] ??= Array.from(
    { length: target.frames.length },
    () => ({ x: W() / density() / 2, y: H() / density() / 2 }),
  );
  while (points.length < target.frames.length) points.push({ ...points.at(-1)! });
  return points[frameIdx];
}

function gridSize(rows: string[]): { w: number; h: number } {
  return {
    w: Math.max(1, ...rows.map((row) => row.length)),
    h: Math.max(1, rows.length),
  };
}

function geometryOf(spriteFile: SpriteFile, rows: string[]) {
  const grid = gridSize(rows);
  const density = spriteFile.hd === false ? 4 : 1;
  return resolveSpriteGeometry(spriteFile, grid.w / density, grid.h / density);
}

/* ---------------- dom ---------------- */

const $ = (id: string) => document.getElementById(id)!;
const grid = $('grid') as HTMLCanvasElement;
const gctx = grid.getContext('2d')!;
const brushCursor = $('brushCursor');
const preview = $('preview') as HTMLCanvasElement;
const pctx = preview.getContext('2d')!;
const TRANSPARENCY_CHECKER_SIZE = 12;

/** Photoshop-style transparency is a view-space aid, not sprite pixels. */
function drawTransparencyChecker(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  size = TRANSPARENCY_CHECKER_SIZE,
): void {
  context.fillStyle = '#f0f0f0';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#b8b8b8';
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if (((x / size) + (y / size)) % 2 === 0) continue;
      context.fillRect(x, y, Math.min(size, width - x), Math.min(size, height - y));
    }
  }
}

const SPRITE_ROOT = '/src/game/content/sprites/';
const spriteModules = import.meta.glob('/src/game/content/sprites/**/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, EditorSpriteFile>;
const existingSprites = new Map(
  Object.entries(spriteModules)
    .map(([modulePath, spriteFile]) => [modulePath.slice(SPRITE_ROOT.length), spriteFile] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
);

// `existingSprites` is the repository snapshot Vite imported when this page
// loaded. Keep a separate workspace view for documents the author has opened
// or left as browser-local drafts. Composite previews often render a second
// sprite (for example the knight while a sword is being edited), and that
// second sprite must come from the same live workspace as the canvas rather
// than the stale module snapshot.
const workingSprites = new Map<string, EditorSpriteFile>();

function rememberWorkingSprite(path: string, spriteFile: SpriteFile): void {
  workingSprites.set(path, normalize(structuredClone(spriteFile)) as EditorSpriteFile);
}

function latestWorkingSprite(path: string): SpriteFile | null {
  if (currentRepoPath === path) return file;
  return workingSprites.get(path) ?? existingSprites.get(path) ?? null;
}

// Restore the whole browser-local workspace up front. This also makes a
// direct link to an equipment sheet use an unsaved knight draft without first
// requiring the author to open the knight in this tab.
for (const draft of storedDrafts()) rememberWorkingSprite(draft.path, draft.file);

function populateSpriteSelect(id: string): void {
  const select = $(id) as HTMLSelectElement;
  for (const path of existingSprites.keys()) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path
      .replace(/\.json$/, '')
      .replaceAll('-', ' ')
      .replaceAll('/', ' / ');
    select.appendChild(option);
  }
}

function existingSprite(path: string): SpriteFile {
  const spriteFile = existingSprites.get(path);
  if (!spriteFile) throw new Error(`unknown sprite "${path}"`);
  // Editor mutations must not alter the cached module or reference layer.
  return normalize(structuredClone(spriteFile));
}

function configureCompositeForPath(path: string): void {
  const body = $('compBody') as HTMLSelectElement;
  const weapon = $('compWeapon') as HTMLSelectElement;
  const gear = $('compGear') as HTMLInputElement;
  previewStepping = false;
  previewStepFrame = 0;

  if (path.includes('equipment/')) {
    const stem = path.split('/').at(-1)!.replace(/\.json$/, '');
    // Equipment sheets need a concrete body because `edited sprite` is the
    // equipment itself. Prefer an authored body that declares it can equip a
    // weapon (Knight V2 today), but keep a body the author explicitly chose.
    // The old unconditional `player` assignment silently switched previews
    // back to the legacy full-player sheet, so frame N no longer represented
    // frame N of the body the author had just been editing.
    if (body.value === 'edited') {
      body.value = [...body.options]
        .find((option) => option.value.startsWith('sprite:'))?.value
        ?? 'player';
    }
    if (weapons.has(stem)) {
      weapon.value = stem;
      gear.checked = false;
      rebuildMoveSelect(stem);
    } else {
      weapon.value = '';
      gear.checked = true;
      rebuildMoveSelect('');
    }
    return;
  }

  // Composite controls describe the file currently being edited, rather
  // than global editor preferences. Without resetting them here, opening a
  // character after a weapon left the preview rendering the previous full
  // player + weapon while the grid correctly showed the new sprite.
  body.value = 'edited';
  weapon.value = '';
  gear.checked = false;
  rebuildMoveSelect('');
}

populateSpriteSelect('selectSprite');
populateSpriteSelect('selectRefSprite');

function activatePanel(group: 'left' | 'right', target: string): void {
  const panels = [...document.querySelectorAll<HTMLElement>(`[data-panel-page="${group}"]`)];
  // Saved view state from an older editor can name a panel that has since
  // become persistent (the palette used to be the `left-colors` tab). Keep
  // the current valid panel instead of hiding the whole workspace.
  if (!panels.some((panel) => panel.id === target)) return;
  document.querySelectorAll<HTMLButtonElement>(`[data-panel-tab="${group}"]`).forEach((button) => {
    const active = button.dataset.panelTarget === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  panels.forEach((panel) => {
    panel.hidden = panel.id !== target;
  });
  if (group === 'right' && target === 'right-combat') refreshCombatPanel();
}

for (const group of ['left', 'right'] as const) {
  document.querySelectorAll<HTMLButtonElement>(`[data-panel-tab="${group}"]`).forEach((button) => {
    button.onclick = () => activatePanel(group, button.dataset.panelTarget!);
  });
}

const VIEW_STATE_KEY = 'hitstop.sprite-editor.view';

interface EditorViewState {
  v: 1;
  path: string | null;
  anim: string;
  frame: number;
  paintChar: string;
  tool: EditorTool;
  transformMode?: boolean;
  zoom: number;
  anchor: string;
  selection: PixelSelection | null;
  layer?: { active: string; hidden: string[]; locked: string[]; solo: string | null };
  leftPanel?: string;
  rightPanel?: string;
  preview: { playing: boolean; stepping: boolean; frame: number };
  composite: {
    weapon: string;
    move: string;
    body: string;
    trail: boolean;
    hitbox: boolean;
    gear: boolean;
  };
  toggles: {
    showRef: boolean;
    onionSkin: boolean;
    showAnchors: boolean;
    showHitbox: boolean;
  };
  referencePath: string;
}

function activePanel(group: 'left' | 'right'): string | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-panel-page="${group}"]`)]
    .find((panel) => !panel.hidden)?.id;
}

function captureEditorViewState(): EditorViewState {
  return {
    v: 1,
    path: currentRepoPath,
    anim: animName,
    frame: frameIdx,
    paintChar: currentChar,
    tool: currentTool,
    transformMode,
    zoom: cellSize,
    anchor: selectedAnchorName,
    selection: selection ? cloneSelection(selection) : null,
    layer: {
      active: activeLayerId,
      hidden: [...hiddenLayerIds],
      locked: [...lockedLayerIds],
      solo: soloLayerId,
    },
    leftPanel: activePanel('left'),
    rightPanel: activePanel('right'),
    preview: {
      playing: ($('previewPlay') as HTMLInputElement).checked,
      stepping: previewStepping,
      frame: previewStepFrame,
    },
    composite: {
      weapon: ($('compWeapon') as HTMLSelectElement).value,
      move: ($('compMove') as HTMLSelectElement).value,
      body: ($('compBody') as HTMLSelectElement).value,
      trail: ($('compTrail') as HTMLInputElement).checked,
      hitbox: ($('compHitbox') as HTMLInputElement).checked,
      gear: ($('compGear') as HTMLInputElement).checked,
    },
    toggles: {
      showRef: ($('showRef') as HTMLInputElement).checked,
      onionSkin: ($('onionSkin') as HTMLInputElement).checked,
      showAnchors: ($('showAnchors') as HTMLInputElement).checked,
      showHitbox: ($('showHitbox') as HTMLInputElement).checked,
    },
    referencePath: ($('selectRefSprite') as HTMLSelectElement).value,
  };
}

function persistEditorViewState(state: EditorViewState = captureEditorViewState()): void {
  try {
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    // View continuity is a convenience; storage denial must never block save.
  }
}

function restoreEditorViewState(saved?: EditorViewState): void {
  try {
    const state = saved ?? JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY) ?? 'null') as EditorViewState | null;
    if (!state || state.v !== 1 || state.path !== currentRepoPath) return;

    if (file.anims[state.anim]) animName = state.anim;
    frameIdx = Math.max(0, Math.min(state.frame, anim().frames.length - 1));
    if (state.paintChar in (file.palette ?? {})) currentChar = state.paintChar;
    const savedTool = state.tool as string;
    if ((['draw', 'brush', 'blur', 'fill', 'picker', 'select', 'magic'] as EditorTool[]).includes(savedTool as EditorTool)) {
      currentTool = savedTool as EditorTool;
    } else if (savedTool === 'move') {
      // Migrate sessions from the old standalone Move tool.
      currentTool = 'select';
    }
    selectedAnchorName = state.anchor;
    if (state.layer) {
      hiddenLayerIds = new Set(state.layer.hidden);
      lockedLayerIds = new Set(state.layer.locked);
      soloLayerId = state.layer.solo;
      // Active-layer continuity has its own per-sprite store. Until the user
      // explicitly selects a layer for this sprite, opening it starts on Base
      // even if an older general view snapshot happened to contain Front Hand.
      restoreActiveLayer(currentRepoPath, file);
      reconcileLayerState();
    }
    previewStepping = state.preview.stepping;
    previewStepFrame = state.preview.frame;

    const weapon = $('compWeapon') as HTMLSelectElement;
    if ([...weapon.options].some((option) => option.value === state.composite.weapon)) {
      weapon.value = state.composite.weapon;
    }
    rebuildMoveSelect(weapon.value);
    const move = $('compMove') as HTMLSelectElement;
    if ([...move.options].some((option) => option.value === state.composite.move)) move.value = state.composite.move;
    const body = $('compBody') as HTMLSelectElement;
    if ([...body.options].some((option) => option.value === state.composite.body)) body.value = state.composite.body;

    ($('previewPlay') as HTMLInputElement).checked = state.preview.playing;
    ($('compTrail') as HTMLInputElement).checked = state.composite.trail;
    ($('compHitbox') as HTMLInputElement).checked = state.composite.hitbox;
    ($('compGear') as HTMLInputElement).checked = state.composite.gear;
    ($('showRef') as HTMLInputElement).checked = state.toggles.showRef;
    ($('onionSkin') as HTMLInputElement).checked = state.toggles.onionSkin;
    ($('showAnchors') as HTMLInputElement).checked = state.toggles.showAnchors;
    ($('showHitbox') as HTMLInputElement).checked = state.toggles.showHitbox;

    const reference = $('selectRefSprite') as HTMLSelectElement;
    if (state.referencePath && existingSprites.has(state.referencePath)) {
      reference.value = state.referencePath;
      refFile = existingSprite(state.referencePath);
    }

    refreshUI();
    updateToolUI();
    setGridZoom(state.zoom);
    if (state.leftPanel) activatePanel('left', state.leftPanel);
    if (state.rightPanel) activatePanel('right', state.rightPanel);
    const selected = state.selection;
    const restoredSelection = selected
      && selected.x >= 0 && selected.y >= 0
      && selected.x + selected.w <= W() && selected.y + selected.h <= H()
      ? selected
      : null;
    setSelection(restoredSelection);
    setTransformMode(Boolean(restoredSelection && (state.transformMode || savedTool === 'move')), false);
    schedulePreviewUpload();
    void publishSelection();
  } catch {
    // Ignore obsolete/malformed session UI state and use editor defaults.
  }
}

const editMenu = $('editMenu') as HTMLDetailsElement;
for (const id of ['btnUndo', 'btnRedo', 'btnCut', 'btnCopy', 'btnPaste', 'btnOpenLayerTags', 'btnOpenData']) {
  $(id).addEventListener('click', () => { editMenu.open = false; });
}
$('btnOpenLayerTags').addEventListener('click', () => {
  closeRenderTagCreate();
  buildRenderTagEditor();
  ($('renderTagsDialog') as HTMLDialogElement).showModal();
});
$('btnOpenData').addEventListener('click', () => activatePanel('right', 'right-data'));
document.addEventListener('pointerdown', (event) => {
  if (editMenu.open && !editMenu.contains(event.target as Node)) editMenu.open = false;
});

function flash(msg: string): void {
  const s = $('status');
  s.textContent = msg;
  setTimeout(() => {
    if (s.textContent === msg) s.textContent = '';
  }, 2000);
}

/* ---------------- live agent bridge ---------------- */

let pendingBridgeState: BridgeState | null = null;

function updateBridgeStatus(): void {
  const status = $('bridgeStatus');
  status.className = '';
  if (bridgeConflict) {
    status.classList.add('conflict');
    status.textContent = 'bridge: conflict (click to accept remote)';
    status.title = 'Your unsent edits and a remote edit overlap. Click to keep the remote revision; undo restores your local version.';
  } else if (!bridgeConnected) {
    status.textContent = 'bridge: offline';
    status.title = 'Start the Vite development server to share this document with an agent.';
  } else {
    status.classList.add(bridgeDirty ? 'dirty' : 'connected');
    const name = currentRepoPath ?? 'unsaved sprite';
    status.textContent = `bridge: ${name} r${bridgeRevision}${bridgeDirty ? ' *' : ''}`;
    status.title = bridgeDirty ? 'Shared changes have not been written to the repository.' : 'Browser and agent share this revision.';
  }
  const save = $('btnSaveRepo') as HTMLButtonElement;
  const draftCount = storedDrafts().length;
  const tagDirty = renderTagsDirty();
  const combatDirty = weaponCombatDirty();
  const pending = [
    draftCount ? `${draftCount} modified sprite${draftCount === 1 ? '' : 's'}` : '',
    tagDirty ? 'layer tags' : '',
    combatDirty ? 'combat tuning' : '',
  ].filter(Boolean);
  save.disabled = !bridgeConnected || bridgeConflict || (!bridgeDirty && draftCount === 0 && !tagDirty && !combatDirty);
  save.title = pending.length
    ? `Save ${pending.join(' and ')} to the repository`
    : 'Save all modified sprites, layer tags, and combat tuning to the repository';
}

function historySnapshot(spriteFile: SpriteFile = file, selected: PixelSelection | null = selection): string {
  return JSON.stringify({ v: 1, file: spriteFile, selection: selected });
}

function parseHistorySnapshot(snapshot: string): { file: SpriteFile; selection: PixelSelection | null } {
  const parsed = JSON.parse(snapshot) as { v?: unknown; file?: unknown; selection?: PixelSelection | null };
  if (parsed?.v === 1 && parsed.file) {
    return { file: parsed.file as SpriteFile, selection: parsed.selection ?? null };
  }
  // Accept snapshots created before selection transforms were added during a
  // hot-reload session.
  return { file: parsed as unknown as SpriteFile, selection: null };
}

function rememberForUndo(snapshot = JSON.stringify(file)): void {
  const state = historySnapshot(JSON.parse(snapshot) as SpriteFile, selection);
  if (undoStack[undoStack.length - 1] !== state) undoStack.push(state);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

function updateBridgeMeta(state: BridgeState): void {
  bridgeConnected = true;
  bridgeRevision = state.revision;
  bridgeDirty = state.dirty;
  currentRepoPath = state.path;
  if (state.path) currentFileName = state.path.split('/').at(-1)!;
  // The shared document is authoritative. Keep the picker in sync on every
  // acknowledgement too, not only when a remote file body is applied: an
  // async <select> change can otherwise leave its old option painted while
  // the canvas and bridge have already switched to the requested sprite.
  const spriteSelect = $('selectSprite') as HTMLSelectElement;
  spriteSelect.value = state.path ?? '';
  if (state.path) {
    // The URL is the reload contract for this stateless tool. Vite may reload
    // after a JSON write; keeping the active sprite here prevents that reload
    // from reopening the original/default query-string sprite.
    const url = new URL(location.href);
    if (url.searchParams.get('sprite') !== state.path) {
      url.searchParams.set('sprite', state.path);
      history.replaceState(null, '', url);
    }
  }
  // Compare like with like. `normalize` supplies editor-only defaults for
  // older files (for example `hd: true`); remembering the raw server shape
  // made the publish timer treat a freshly opened, untouched sprite as an
  // edit and immediately lock the shared document dirty.
  lastSharedFile = JSON.stringify(normalize(structuredClone(state.file)));
  if (!state.dirty) lastRepositoryFile = lastSharedFile;
  bridgeConflict = false;
  pendingBridgeState = null;
  updateBridgeStatus();
  schedulePreviewUpload();
}

function applyBridgeState(state: BridgeState, force = false): void {
  if (!force && state.revision <= bridgeRevision) return;
  const switchedSprite = state.path !== currentRepoPath;
  if (switchedSprite) rememberActiveLayer();
  const local = JSON.stringify(file);
  const unsentLocalEdit = Boolean(lastSharedFile) && local !== lastSharedFile;
  if (!force && state.source === bridgeClientId && unsentLocalEdit) {
    // The bridge may echo a stroke or transform revision while the same
    // pointer gesture has already advanced locally. Treat that echo as an
    // acknowledgement, not an incoming document: replacing the canvas here
    // would also clear the live selection halfway through a drag. Keeping the
    // older shared snapshot in lastSharedFile makes publishSharedSprite send
    // the newer local pixels immediately after the in-flight request settles.
    updateBridgeMeta(state);
    return;
  }
  if (!force && state.source !== bridgeClientId && unsentLocalEdit) {
    pendingBridgeState = state;
    bridgeConflict = true;
    updateBridgeStatus();
    return;
  }

  const incoming = JSON.stringify(state.file);
  if (incoming !== local) {
    if (switchedSprite) persistCurrentDraft();
    rememberForUndo();
    clearSelection(false);
    file = normalize(structuredClone(state.file));
    if (switchedSprite) restoreActiveLayer(state.path, file);
    else reconcileLayerState();
    if (!file.anims[animName]) animName = Object.keys(file.anims)[0];
    frameIdx = Math.min(frameIdx, anim().frames.length - 1);
    currentChar = firstPaintChar();
    editVersion++;
    refreshUI();
    updateUndoRedoButtons();
    if (switchedSprite) fitGrid();
    if (state.source !== bridgeClientId) flash(`updated by ${state.source}`);
  } else if (switchedSprite) {
    clearSelection(false);
    restoreActiveLayer(state.path, file);
    refreshUI();
    fitGrid();
  }
  updateBridgeMeta(state);
  if (switchedSprite && state.path) configureCompositeForPath(state.path);
}

async function bridgeJson(path: string, init?: RequestInit): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${BRIDGE}${path}`, init);
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

function selectionSnapshot(): SharedSelection | null {
  if (!selection) return null;
  const clip = pixelsInSelection(selection);
  return {
    ...selection,
    path: currentRepoPath,
    anim: concreteAnimName(),
    frame: frameIdx,
    layerId: isLayeredSpriteFile(file) ? activeLayerId : undefined,
    rows: clip.rows,
    mask: clip.mask,
    source: bridgeClientId,
    updatedAt: Date.now(),
  };
}

async function publishSelection(): Promise<void> {
  if (!bridgeConnected) return;
  try {
    await bridgeJson('/selection', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selection: selectionSnapshot() }),
    });
  } catch {
    // Selection is collaboration metadata, never worth taking the editor offline.
  }
}

const WEAPON_BODY_PREFIX = 'sprite:';

function spriteLabel(path: string): string {
  return path
    .replace(/\.json$/, '')
    .replaceAll('-', ' ')
    .replaceAll('/', ' / ');
}

function populateCompositeBodySelect(): void {
  const select = $('compBody') as HTMLSelectElement;
  for (const [path, spriteFile] of existingSprites) {
    if (spriteFile.editor?.canEquipWeapon !== true) continue;
    const option = document.createElement('option');
    option.value = `${WEAPON_BODY_PREFIX}${path}`;
    option.textContent = `body: ${spriteLabel(path)}`;
    select.appendChild(option);
  }
}

function selectedWeaponBody(bodySelection: string): SpriteFile | null {
  if (!bodySelection.startsWith(WEAPON_BODY_PREFIX)) return null;
  return latestWorkingSprite(bodySelection.slice(WEAPON_BODY_PREFIX.length));
}

populateCompositeBodySelect();

async function openSharedSprite(path: string): Promise<boolean> {
  try {
    // A stroke can be waiting for the 160 ms publish tick when the user
    // changes the selector. Flush it, then keep a browser-local draft keyed
    // by sprite path. Switching documents must never require a repository
    // save merely to protect work in progress.
    rememberActiveLayer();
    if (lastSharedFile && JSON.stringify(file) !== lastSharedFile) {
      await publishSharedSprite();
    }
    persistCurrentDraft();
    const draft = readDraft(path);
    const { response, body } = await bridgeJson('/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The editor has just persisted the previous document. `force` only
      // releases the bridge's single active slot; it never writes or deletes
      // either document in the repository.
      body: JSON.stringify({ path, source: bridgeClientId, force: true }),
    });
    if (response.status === 409) {
      const shared = (body.state as BridgeState | null) ?? null;
      if (shared) applyBridgeState(shared, true);
      flash('could not switch the shared sprite');
      return false;
    }
    if (!response.ok) throw new Error(String(body.error ?? response.statusText));
    applyBridgeState(body as unknown as BridgeState, true);
    if (draft) {
      const draftFile = structuredClone(draft.file);
      reconcileDraftRenderTags(draftFile, file);
      const restored = normalize(draftFile);
      // Drafts may predate flat-sprite render tags. Inherit the repository's
      // authored assignment instead of re-inferring a role from the filename.
      if (!isLayeredSpriteFile(restored) && !restored.renderTag && file.renderTag) {
        restored.renderTag = file.renderTag;
      }
      if (JSON.stringify(restored) !== JSON.stringify(file)) {
        rememberForUndo();
        clearSelection(false);
        file = restored;
        if (!file.anims[animName]) animName = Object.keys(file.anims)[0];
        frameIdx = Math.min(frameIdx, anim().frames.length - 1);
        currentChar = firstPaintChar();
        editVersion++;
        refreshUI();
        fitGrid();
        persistCurrentDraft();
        await publishSharedSprite();
        flash(draft.baseFile && draft.baseFile !== lastRepositoryFile
          ? `restored local draft for ${path} (repository changed)`
          : `restored local draft for ${path}`);
        return true;
      }
      clearDraft(path);
    }
    flash(`opened shared ${path}`);
    return true;
  } catch {
    bridgeConnected = false;
    updateBridgeStatus();
    return false;
  }
}

async function publishSharedSprite(): Promise<void> {
  if (bridgePublishing || bridgeConflict) return;
  const serialized = JSON.stringify(file);
  if (serialized === lastSharedFile) return;
  bridgePublishing = true;
  try {
    const { response, body } = await bridgeJson('/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: currentRepoPath,
        file,
        baseRevision: bridgeRevision,
        source: bridgeClientId,
      }),
    });
    if (response.status === 409) {
      pendingBridgeState = (body.state as BridgeState | null) ?? null;
      bridgeConflict = true;
      bridgeConnected = true;
      updateBridgeStatus();
      return;
    }
    if (!response.ok) throw new Error(String(body.error ?? response.statusText));
    updateBridgeMeta(body as unknown as BridgeState);
  } catch {
    bridgeConnected = false;
    updateBridgeStatus();
  } finally {
    bridgePublishing = false;
    // A paint stroke may have continued while its previous version was sent.
    if (!bridgeConflict && JSON.stringify(file) !== lastSharedFile) void publishSharedSprite();
  }
}

async function saveWorkspaceSprites(): Promise<void> {
  if (bridgeConflict) return;
  persistCurrentDraft();
  persistRenderTagDraft();
  const documents = new Map<string, SpriteFile>();
  for (const draft of storedDrafts()) documents.set(draft.path, draft.file);
  // The in-memory document is newer than both the bridge and localStorage
  // during a live pointer gesture, so it always wins for the active path.
  if (currentRepoPath && (bridgeDirty || JSON.stringify(file) !== lastRepositoryFile)) {
    documents.set(currentRepoPath, file);
  }
  const saveRenderTags = renderTagsDirty();
  const saveWeaponCombat = weaponCombatDirty();
  if (!documents.size && !saveRenderTags && !saveWeaponCombat) {
    flash('all sprites are already saved');
    updateBridgeStatus();
    return;
  }
  // Writing imported JSON modules can make Vite reload this page. Preserve
  // the editing context separately from sprite data so Save All is visually
  // inert: the same animation, frame, panels, composite, and selection return.
  const viewState = captureEditorViewState();
  persistEditorViewState(viewState);
  try {
    const { response, body } = await bridgeJson('/save-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: [...documents].map(([path, spriteFile]) => ({ path, file: spriteFile })),
        renderTags: saveRenderTags ? renderTagDefs : undefined,
        weaponCombat: saveWeaponCombat ? weaponCombatTuning : undefined,
        baseRevision: bridgeRevision,
        source: bridgeClientId,
      }),
    });
    if (response.status === 409) {
      pendingBridgeState = (body.state as BridgeState | null) ?? null;
      bridgeConflict = true;
      updateBridgeStatus();
      return;
    }
    if (!response.ok) throw new Error(String(body.error ?? response.statusText));
    const saved = Array.isArray(body.saved) ? body.saved.map(String) : [];
    for (const path of saved) clearDraft(path);
    const tagsSaved = body.renderTagsSaved === true;
    if (tagsSaved) {
      savedRenderTagSignature = JSON.stringify(renderTagDefs);
      localStorage.removeItem(RENDER_TAG_DRAFT_KEY);
    }
    const combatSaved = body.weaponCombatSaved === true;
    if (combatSaved) {
      savedWeaponCombatSignature = JSON.stringify(weaponCombatTuning);
      localStorage.removeItem(WEAPON_COMBAT_DRAFT_KEY);
    }
    const state = body.state as BridgeState | null;
    if (state) applyBridgeState(state, true);
    restoreEditorViewState(viewState);
    updateBridgeStatus();
    const parts = [
      saved.length ? `${saved.length} sprite${saved.length === 1 ? '' : 's'}` : '',
      tagsSaved ? 'layer tags' : '',
      combatSaved ? 'combat tuning' : '',
    ].filter(Boolean);
    flash(`saved ${parts.join(' and ')}`);
  } catch (error) {
    flash(`repo save failed: ${(error as Error).message}`);
  }
}

function schedulePreviewUpload(): void {
  window.clearTimeout(previewTimer);
  if (!bridgeConnected || !bridgeRevision) return;
  previewTimer = window.setTimeout(() => {
    preview.toBlob((blob) => {
      if (!blob) return;
      void fetch(`${BRIDGE}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-Sprite-Revision': String(bridgeRevision) },
        body: blob,
      }).catch(() => {});
    }, 'image/png');
  }, 180);
}

function connectBridgeEvents(): void {
  const events = new EventSource(`${BRIDGE}/events`);
  events.onopen = () => {
    bridgeConnected = true;
    updateBridgeStatus();
  };
  events.onerror = () => {
    bridgeConnected = false;
    updateBridgeStatus();
  };
  events.addEventListener('state', (event) => {
    const state = JSON.parse((event as MessageEvent<string>).data) as BridgeState;
    applyBridgeState(state);
  });
}

async function initializeBridge(): Promise<void> {
  connectBridgeEvents();
  const requested = new URLSearchParams(location.search).get('sprite');
  if (requested && await openSharedSprite(requested)) return;
  try {
    const { response, body } = await bridgeJson('/state');
    if (response.ok) applyBridgeState(body as unknown as BridgeState, true);
    else void publishSharedSprite();
  } catch {
    bridgeConnected = false;
    updateBridgeStatus();
  }
}

$('bridgeStatus').onclick = () => {
  if (bridgeConflict && pendingBridgeState) applyBridgeState(pendingBridgeState, true);
};
$('btnSaveRepo').onclick = () => void saveWorkspaceSprites();

/* ---------------- palette ui ---------------- */

interface PaletteSortColor {
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
  neutral: boolean;
}

function paletteSortColor(color: string): PaletteSortColor | null {
  const rgba = parseRgba(color);
  if (!rgba) return null;
  const r = rgba.r / 255;
  const g = rgba.g / 255;
  const b = rgba.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (chroma !== 0) {
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
  }
  // Hue becomes visually meaningless for near-grey ramps. Keep those ramps
  // together and order them by value instead of scattering them around the
  // chromatic palette.
  return {
    hue,
    saturation,
    lightness,
    alpha: rgba.a,
    neutral: chroma < 0.08 || saturation < 0.12,
  };
}

function sortedPaletteEntries(): [string, string][] {
  return Object.entries(pal())
    .filter((entry): entry is [string, string] => entry[0] !== '.' && typeof entry[1] === 'string')
    .map(([ch, color], index) => ({ ch, color, index, sort: paletteSortColor(color) }))
    .sort((a, b) => {
      if (!a.sort || !b.sort) return a.sort ? -1 : b.sort ? 1 : a.index - b.index;
      if (a.sort.neutral !== b.sort.neutral) return a.sort.neutral ? -1 : 1;
      if (a.sort.neutral) {
        return a.sort.lightness - b.sort.lightness
          || b.sort.alpha - a.sort.alpha
          || a.sort.saturation - b.sort.saturation
          || a.index - b.index;
      }
      return a.sort.hue - b.sort.hue
        || a.sort.lightness - b.sort.lightness
        || b.sort.alpha - a.sort.alpha
        || a.sort.saturation - b.sort.saturation
        || a.index - b.index;
    })
    .map(({ ch, color }) => [ch, color]);
}

function buildPalette(): void {
  const host = $('palette');
  host.innerHTML = '';
  // Sorting is display-only: palette characters and every authored frame stay
  // byte-for-byte unchanged.
  const entries: [string, string | null][] = [['.', null], ...sortedPaletteEntries()];
  for (const [ch, color] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `palette-cell${color ? '' : ' none'}${ch === currentChar ? ' active' : ''}`;
    b.title = color ? `${ch}  ${color}` : '.  erase';
    b.setAttribute('aria-label', color ? `palette ${ch}, ${color}` : 'erase transparent pixels');
    if (color) {
      const fill = document.createElement('span');
      fill.className = 'palette-color';
      fill.style.background = color;
      b.appendChild(fill);
    }
    b.onclick = () => {
      currentChar = ch;
      buildPalette();
    };
    host.appendChild(b);
  }
  const usage = paletteUsage();
  const total = Object.keys(pal()).filter((ch) => ch !== '.').length;
  const used = [...usage.keys()].filter((ch) => ch !== '.' && ch in pal()).length;
  $('paletteStatus').textContent = `${used}/${total}`;
  syncPaletteColorControls();
}

function paletteAlphaByte(): number {
  const percent = Math.max(0, Math.min(100, ($('paletteAlpha') as HTMLInputElement).valueAsNumber || 0));
  return Math.round(percent * 255 / 100);
}

function updatePaletteAlphaVisual(): void {
  const input = $('paletteAlpha') as HTMLInputElement;
  const percent = Math.max(0, Math.min(100, input.valueAsNumber || 0));
  input.style.setProperty('--alpha-fill', `${percent}%`);
  $('paletteAlphaValue').textContent = `${Math.round(percent)}%`;
}

function syncPaletteColorControls(): void {
  const selected = parseRgba(pal()[currentChar]);
  if (selected) {
    ($('newColor') as HTMLInputElement).value = rgbaHex({ ...selected, a: 255 });
    ($('paletteAlpha') as HTMLInputElement).value = String(Math.round(selected.a * 100 / 255));
  }
  updatePaletteAlphaVisual();
}

function colorFromPaletteControls(): Rgba {
  const rgb = parseRgba(($('newColor') as HTMLInputElement).value) ?? { r: 56, g: 183, b: 100, a: 255 };
  return { ...rgb, a: paletteAlphaByte() };
}

function updateSelectedPaletteColor(): void {
  if (currentChar === '.' || typeof pal()[currentChar] !== 'string') return;
  saveHistory();
  (file.palette ??= {})[currentChar] = rgbaHex(colorFromPaletteControls());
  editVersion++;
  buildPalette();
  redraw();
  syncIO();
}

($('paletteAlpha') as HTMLInputElement).oninput = () => {
  updatePaletteAlphaVisual();
};
($('paletteAlpha') as HTMLInputElement).onchange = updateSelectedPaletteColor;
($('newColor') as HTMLInputElement).onchange = updateSelectedPaletteColor;

$('btnAddColor').onclick = () => {
  saveHistory();
  const ch = ($('newChar') as HTMLInputElement).value || '?';
  const color = rgbaHex(colorFromPaletteControls());
  (file.palette ??= {})[ch] = color;
  currentChar = ch;
  buildPalette();
  redraw();
};

/* ---------------- attachment anchors ---------------- */

function buildAnchors(): void {
  const names = Object.keys(file.anchors ?? {});
  if (selectedAnchorName && !names.includes(selectedAnchorName)) selectedAnchorName = '';
  // For player sheets, open on the primary weapon grip instead of whichever
  // anchor happens to be serialized first.  After handedness is corrected,
  // rearHand is often first and its screen-right marker looks like a broken
  // weapon anchor even though it is the knight's left/off hand.
  if (!selectedAnchorName && names.length) {
    selectedAnchorName = names.includes('frontHand') ? 'frontHand' : names[0];
  }

  const select = $('anchorName') as HTMLSelectElement;
  select.innerHTML = '<option value="">-- none --</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  select.value = selectedAnchorName;

  const point = currentAnchor();
  const x = $('anchorX') as HTMLInputElement;
  const y = $('anchorY') as HTMLInputElement;
  x.disabled = y.disabled = !selectedAnchorName;
  x.value = point ? String(point.x) : '';
  y.value = point ? String(point.y) : '';
  ($('btnDelAnchor') as HTMLButtonElement).disabled = !selectedAnchorName;
}

function buildAttachmentSlots(): void {
  const slots = file.attachmentSlots ?? {};
  const names = Object.keys(slots);
  if (selectedAttachmentSlotName && !names.includes(selectedAttachmentSlotName)) {
    selectedAttachmentSlotName = '';
  }
  if (!selectedAttachmentSlotName && names.length) selectedAttachmentSlotName = names[0];

  const slotSelect = $('attachmentSlotName') as HTMLSelectElement;
  slotSelect.innerHTML = '<option value="">-- none --</option>';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    slotSelect.appendChild(option);
  }
  slotSelect.value = selectedAttachmentSlotName;

  const anchorSelect = $('attachmentSlotAnchor') as HTMLSelectElement;
  anchorSelect.innerHTML = '<option value="">-- anchor --</option>';
  for (const name of Object.keys(file.anchors ?? {})) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    anchorSelect.appendChild(option);
  }
  const selected = slots[selectedAttachmentSlotName];
  anchorSelect.value = selected?.anchor ?? '';
  anchorSelect.disabled = !selected;
  ($('btnDelAttachmentSlot') as HTMLButtonElement).disabled = !selected;
}

($('anchorName') as HTMLSelectElement).onchange = (event) => {
  selectedAnchorName = (event.target as HTMLSelectElement).value;
  buildAnchors();
  redraw();
};

$('btnAddAnchor').onclick = () => {
  const name = prompt('anchor name (e.g. frontHand, rearHand, head):', '')?.trim();
  if (!name) return;
  if (file.anchors?.[name]) {
    flash('anchor already exists');
    return;
  }
  saveHistory();
  const groups: Record<string, SpriteAnchor[]> = {};
  for (const [animId, entry] of concreteAnims()) {
    groups[animId] = entry.frames.map(() => ({
      x: entry.frames[0][0].length / density() / 2,
      y: entry.frames[0].length / density() / 2,
    }));
  }
  (file.anchors ??= {})[name] = groups;
  selectedAnchorName = name;
  refreshUI();
};

$('btnDelAnchor').onclick = () => {
  if (!selectedAnchorName || !file.anchors) return;
  const usedBy = Object.entries(file.attachmentSlots ?? {})
    .find(([, slot]) => slot.anchor === selectedAnchorName)?.[0];
  if (usedBy) {
    flash(`anchor is used by slot ${usedBy}`);
    return;
  }
  saveHistory();
  delete file.anchors[selectedAnchorName];
  selectedAnchorName = '';
  refreshUI();
};

function onAnchorChange(): void {
  if (!selectedAnchorName) return;
  const x = ($('anchorX') as HTMLInputElement).valueAsNumber;
  const y = ($('anchorY') as HTMLInputElement).valueAsNumber;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  saveHistory();
  Object.assign(ensureCurrentAnchor(), { x, y });
  redraw();
  syncIO();
}

($('anchorX') as HTMLInputElement).onchange = onAnchorChange;
($('anchorY') as HTMLInputElement).onchange = onAnchorChange;
($('showAnchors') as HTMLInputElement).onchange = () => redraw();

($('attachmentSlotName') as HTMLSelectElement).onchange = (event) => {
  selectedAttachmentSlotName = (event.target as HTMLSelectElement).value;
  buildAttachmentSlots();
};

$('btnAddAttachmentSlot').onclick = () => {
  const anchors = Object.keys(file.anchors ?? {});
  if (!anchors.length) {
    flash('add an anchor before creating a slot');
    return;
  }
  const name = prompt('attachment slot name (e.g. mainHand, head, back):', '')?.trim();
  if (!name) return;
  if (file.attachmentSlots?.[name]) {
    flash('attachment slot already exists');
    return;
  }
  saveHistory();
  (file.attachmentSlots ??= {})[name] = {
    anchor: anchors.includes(selectedAnchorName) ? selectedAnchorName : anchors[0],
  };
  selectedAttachmentSlotName = name;
  buildAttachmentSlots();
  syncIO();
};

$('btnDelAttachmentSlot').onclick = () => {
  if (!selectedAttachmentSlotName || !file.attachmentSlots) return;
  saveHistory();
  delete file.attachmentSlots[selectedAttachmentSlotName];
  if (!Object.keys(file.attachmentSlots).length) delete file.attachmentSlots;
  selectedAttachmentSlotName = '';
  buildAttachmentSlots();
  syncIO();
};

($('attachmentSlotAnchor') as HTMLSelectElement).onchange = (event) => {
  const slot = file.attachmentSlots?.[selectedAttachmentSlotName];
  const anchor = (event.target as HTMLSelectElement).value;
  if (!slot || !file.anchors?.[anchor] || slot.anchor === anchor) return;
  saveHistory();
  slot.anchor = anchor;
  syncIO();
};

/* ---------------- layers ---------------- */

function tagDependencies(id: string): string[] {
  const dependencies: string[] = [];
  for (const [visualId, visual] of weaponVisuals.entries()) {
    if (visual.renderTags.includes(id)) dependencies.push(`Weapon visual “${visualId}” — render band`);
    if (visual.gripRenderTag === id) dependencies.push(`Weapon visual “${visualId}” — grip overlay band`);
  }
  const documents = new Map<string, SpriteFile>(existingSprites);
  for (const draft of storedDrafts()) documents.set(draft.path, draft.file);
  documents.set(currentRepoPath ?? '(current unsaved sprite)', file);
  for (const [path, spriteFile] of documents) {
    if (spriteFile.renderTag === id) {
      dependencies.push(`${path} — flat sprite render tag`);
    }
    if (!isLayeredSpriteFile(spriteFile)) continue;
    for (const layer of spriteFile.layers.filter((candidate) => candidate.tag === id)) {
      dependencies.push(`${path} — layer “${layer.name}” (${layer.id})`);
    }
  }
  if (renderTagDefs.length === 1) dependencies.push('Layer tag registry — at least one tag must remain');
  return [...new Set(dependencies)];
}

function renderTagsChanged(rebuildEditor = true): void {
  configurePlayerRenderTags(renderTagDefs);
  persistRenderTagDraft();
  if (rebuildEditor) buildRenderTagEditor();
  buildLayers();
  redraw();
  updateBridgeStatus();
}

function moveRenderTag(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= renderTagDefs.length) return;
  [renderTagDefs[index], renderTagDefs[target]] = [renderTagDefs[target], renderTagDefs[index]];
  renderTagsChanged();
}

function buildRenderTagEditor(): void {
  const host = $('renderTagsEditor');
  host.innerHTML = '';
  renderTagDefs.forEach((definition, index) => {
    const entry = document.createElement('div');
    entry.className = 'render-tag-entry';
    const row = document.createElement('div');
    row.className = 'render-tag-row';

    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.title = 'Render this tag one band farther back';
    up.disabled = index === 0;
    up.onclick = () => moveRenderTag(index, -1);

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.title = 'Render this tag one band farther forward';
    down.disabled = index === renderTagDefs.length - 1;
    down.onclick = () => moveRenderTag(index, 1);

    const id = document.createElement('input');
    id.value = definition.id;
    id.readOnly = true;
    id.title = 'Stable tag id';
    id.setAttribute('aria-label', `Tag id ${definition.id}`);

    const label = document.createElement('input');
    label.value = definition.label;
    label.setAttribute('aria-label', `Label for ${definition.id}`);
    label.oninput = () => {
      if (!label.value.trim()) return;
      definition.label = label.value;
      renderTagsChanged(false);
    };
    label.onblur = () => {
      const next = label.value.trim();
      if (!next) {
        label.value = definition.label;
        flash('tag label cannot be empty');
      } else if (next !== definition.label) {
        definition.label = next;
        label.value = next;
        renderTagsChanged(false);
      }
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    const dependencies = tagDependencies(definition.id);
    remove.title = 'Delete this unused tag';
    remove.setAttribute('aria-label', `Delete ${definition.label}`);
    remove.onclick = () => {
      if (!confirm(`Delete unused layer tag “${definition.label}”?`)) return;
      renderTagDefs.splice(index, 1);
      renderTagsChanged();
    };

    row.append(up, down, id, label);
    if (dependencies.length === 0) row.appendChild(remove);
    entry.appendChild(row);
    if (dependencies.length) {
      const dependencyList = document.createElement('ul');
      dependencyList.className = 'render-tag-dependencies';
      dependencyList.setAttribute('aria-label', `Dependencies for ${definition.label}`);
      for (const dependency of dependencies) {
        const item = document.createElement('li');
        item.textContent = dependency;
        dependencyList.appendChild(item);
      }
      entry.appendChild(dependencyList);
    }
    host.appendChild(entry);
  });
}

const renderTagCreate = $('renderTagCreate');
const renderTagNewId = $('renderTagNewId') as HTMLInputElement;
const renderTagNewLabel = $('renderTagNewLabel') as HTMLInputElement;

function closeRenderTagCreate(): void {
  renderTagCreate.hidden = true;
  renderTagNewId.value = '';
  renderTagNewLabel.value = '';
}

$('btnAddRenderTag').onclick = () => {
  renderTagCreate.hidden = false;
  renderTagNewId.focus();
};

$('btnCancelRenderTag').onclick = closeRenderTagCreate;

function addRenderTag(): void {
  const rawId = renderTagNewId.value.trim();
  const label = renderTagNewLabel.value.trim();
  if (!rawId || !label) {
    flash('tag id and label are required');
    (!rawId ? renderTagNewId : renderTagNewLabel).focus();
    return;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(rawId)) {
    flash('tag id must use lowercase letters, numbers, and hyphens');
    renderTagNewId.focus();
    return;
  }
  if (hasRenderTag(rawId)) {
    flash('layer tag already exists');
    renderTagNewId.focus();
    return;
  }
  renderTagDefs.push({ id: rawId, label });
  closeRenderTagCreate();
  renderTagsChanged();
}

$('btnConfirmRenderTag').onclick = addRenderTag;
for (const input of [renderTagNewId, renderTagNewLabel]) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addRenderTag();
    else if (event.key === 'Escape') closeRenderTagCreate();
  });
}

for (const id of ['btnCloseRenderTags', 'btnDoneRenderTags']) {
  $(id).onclick = () => {
    closeRenderTagCreate();
    ($('renderTagsDialog') as HTMLDialogElement).close();
  };
}

function eachLayerTrack(name: string, visit: (frames: string[][], layer: SpriteLayerData) => void): void {
  if (!isLayeredSpriteFile(file)) {
    visit(activeFrames(name), { id: FLAT_LAYER_ID, name: 'Base', tag: defaultLayerTag(), tracks: {} });
    return;
  }
  const target = resolveAnimName(file, name);
  for (const layer of file.layers) visit(layer.tracks[target], layer);
}

function setTimelineFrameCount(name: string, count: number): void {
  if (!isLayeredSpriteFile(file)) return;
  const target = resolveAnimName(file, name);
  const entry = file.anims[target];
  if (entry && typeof entry !== 'string') entry.frameCount = count;
}

function makeTransparentTracks(): Record<string, string[][]> {
  const tracks: Record<string, string[][]> = {};
  for (const name of concreteAnimNames()) {
    const timing = resolveAnimTiming(file, name)!;
    tracks[name] = Array.from({ length: timing.frameCount }, () => emptyFrame(W(), H()));
  }
  return tracks;
}

function buildLayers(): void {
  reconcileLayerState();
  const host = $('layers');
  host.innerHTML = '';
  const layers = isLayeredSpriteFile(file)
    ? renderTagIds().slice().reverse().flatMap((tag) => (
      (file as LayeredSpriteFile).layers.filter((layer) => layer.tag === tag).reverse()
    ))
    : [{ id: FLAT_LAYER_ID, name: 'Base', tag: defaultLayerTag(), tracks: {} }];
  for (const layer of layers) {
    const row = document.createElement('div');
    row.className = `layer-row${layer.id === activeLayerId ? ' active' : ''}`;

    const eye = document.createElement('button');
    eye.textContent = hiddenLayerIds.has(layer.id) ? '○' : '●';
    eye.className = `layer-toggle ${hiddenLayerIds.has(layer.id) ? 'off' : 'on'}`;
    eye.title = hiddenLayerIds.has(layer.id) ? 'Show layer' : 'Hide layer';
    eye.disabled = !isLayeredSpriteFile(file);
    eye.onclick = () => {
      if (hiddenLayerIds.has(layer.id)) hiddenLayerIds.delete(layer.id);
      else hiddenLayerIds.add(layer.id);
      buildLayers();
      redraw();
    };

    const solo = document.createElement('button');
    solo.textContent = 'S';
    solo.className = `layer-toggle ${soloLayerId === layer.id ? 'on' : ''}`;
    solo.title = soloLayerId === layer.id ? 'Show all layers' : 'Solo this layer';
    solo.disabled = !isLayeredSpriteFile(file);
    solo.onclick = () => {
      soloLayerId = soloLayerId === layer.id ? null : layer.id;
      buildLayers();
      redraw();
    };

    const name = document.createElement('button');
    name.className = 'layer-name';
    name.textContent = layer.name;
    name.title = 'Select layer; double-click to rename';
    name.onclick = () => {
      if (activeLayerId === layer.id) return;
      activeLayerId = layer.id;
      rememberActiveLayer();
      clearSelection(false);
      host.querySelector('.layer-row.active')?.classList.remove('active');
      row.classList.add('active');
      redraw();
      void publishSelection();
    };
    name.ondblclick = (event) => {
      if (!isLayeredSpriteFile(file)) return;
      event.preventDefault();
      event.stopPropagation();

      const editor = document.createElement('input');
      editor.className = 'layer-name layer-name-editor';
      editor.value = layer.name;
      editor.title = 'Enter to rename; Escape to cancel';
      let finished = false;
      const finish = (commit: boolean): void => {
        if (finished) return;
        finished = true;
        const label = editor.value.trim();
        if (commit && label && label !== layer.name) {
          saveHistory();
          layer.name = label;
          syncIO();
        }
        buildLayers();
      };
      editor.onkeydown = (keyEvent) => {
        if (keyEvent.key === 'Enter') {
          keyEvent.preventDefault();
          finish(true);
        } else if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          finish(false);
        }
      };
      editor.onblur = () => finish(true);
      name.replaceWith(editor);
      editor.focus();
      editor.select();
    };

    const tag = document.createElement('select');
    tag.className = 'layer-tag';
    tag.title = 'Shared render tag; tag order controls cross-sprite compositing';
    for (const [id, definition] of renderTagEntries()) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = definition.label;
      tag.appendChild(option);
    }
    tag.value = layer.tag;
    tag.onchange = () => {
      if (layer.tag === tag.value) return;
      saveHistory();
      if (isLayeredSpriteFile(file)) layer.tag = tag.value;
      else file.renderTag = tag.value;
      buildLayers();
      redraw();
      syncIO();
    };

    const lock = document.createElement('button');
    lock.textContent = lockedLayerIds.has(layer.id) ? '◆' : '◇';
    lock.className = `layer-toggle ${lockedLayerIds.has(layer.id) ? 'on' : ''}`;
    lock.title = lockedLayerIds.has(layer.id) ? 'Unlock layer' : 'Lock layer';
    lock.disabled = !isLayeredSpriteFile(file);
    lock.onclick = () => {
      if (lockedLayerIds.has(layer.id)) lockedLayerIds.delete(layer.id);
      else lockedLayerIds.add(layer.id);
      buildLayers();
    };

    row.append(eye, solo, name, tag, lock);
    host.appendChild(row);
  }

  const layerFile = isLayeredSpriteFile(file) ? file : null;
  const layered = Boolean(layerFile);
  const index = layerFile ? layerFile.layers.findIndex((layer) => layer.id === activeLayerId) : 0;
  const activeTag = layerFile?.layers[index]?.tag;
  const canMoveUp = Boolean(layerFile && index < layerFile.layers.length - 1
    && layerFile.layers[index + 1].tag === activeTag);
  const canMoveDown = Boolean(layerFile && index > 0 && layerFile.layers[index - 1].tag === activeTag);
  $('layerStatus').textContent = layerFile ? `${layerFile.layers.length} layers` : 'flat sprite';
  ($('btnDupLayer') as HTMLButtonElement).disabled = !layered;
  ($('btnLayerUp') as HTMLButtonElement).disabled = !canMoveUp;
  ($('btnLayerDown') as HTMLButtonElement).disabled = !canMoveDown;
  ($('btnMergeLayer') as HTMLButtonElement).disabled = !canMoveDown;
  ($('btnDelLayer') as HTMLButtonElement).disabled = !layerFile || layerFile.layers.length <= 1;
  ($('btnFlattenLayers') as HTMLButtonElement).disabled = !layered;
  buildLayerExtractionControls();
}

function buildLayerExtractionControls(): void {
  const target = $('layerExtractTarget') as HTMLSelectElement;
  const anchor = $('layerExtractAnchor') as HTMLSelectElement;
  const layered = isLayeredSpriteFile(file) ? file : null;
  const targets = layered?.layers.filter((layer) => layer.id !== activeLayerId) ?? [];

  target.innerHTML = targets.length ? '' : '<option value="">-- add another layer --</option>';
  for (const layer of targets) {
    const option = document.createElement('option');
    option.value = layer.id;
    option.textContent = layer.name;
    target.appendChild(option);
  }
  if (!targets.some((layer) => layer.id === layerExtractTargetId)) {
    layerExtractTargetId = targets.find((layer) => /front.?hand/i.test(`${layer.name} ${layer.tag}`))?.id
      ?? targets[0]?.id
      ?? '';
  }
  target.value = layerExtractTargetId;

  anchor.innerHTML = '<option value="">fixed position</option>';
  const anchorNames = Object.keys(file.anchors ?? {});
  for (const name of anchorNames) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    anchor.appendChild(option);
  }
  if (!layerExtractAnchorManuallySet && anchorNames.includes('frontHand')) {
    layerExtractAnchorName = 'frontHand';
  } else if (layerExtractAnchorName && !anchorNames.includes(layerExtractAnchorName)) {
    layerExtractAnchorName = anchorNames.includes(selectedAnchorName) ? selectedAnchorName : '';
  }
  anchor.value = layerExtractAnchorName;

  const source = activeLayer();
  const targetLayer = layered?.layers.find((layer) => layer.id === layerExtractTargetId);
  const ready = Boolean(layered && source && targetLayer && selection && !lockedLayerIds.has(source.id));
  ($('btnExtractSelection') as HTMLButtonElement).disabled = !ready;
  ($('btnExtractNext') as HTMLButtonElement).disabled = !ready;
  $('layerExtractStatus').textContent = layered && source && targetLayer
    ? `Source: ${source.name}. Select the part to move into ${targetLayer.name}.`
    : 'Select pixels on an active source layer after adding a destination layer.';
}

($('layerExtractTarget') as HTMLSelectElement).onchange = (event) => {
  layerExtractTargetId = (event.target as HTMLSelectElement).value;
  buildLayerExtractionControls();
};

($('layerExtractAnchor') as HTMLSelectElement).onchange = (event) => {
  layerExtractAnchorManuallySet = true;
  layerExtractAnchorName = (event.target as HTMLSelectElement).value;
};

function selectionForNextFrame(value: PixelSelection, fromFrame: number, toFrame: number): PixelSelection | null {
  let dx = 0;
  let dy = 0;
  if (layerExtractAnchorName) {
    const anchors = file.anchors?.[layerExtractAnchorName]?.[concreteAnimName()];
    const from = anchors?.[fromFrame];
    const to = anchors?.[toFrame];
    if (from && to) {
      dx = Math.round((to.x - from.x) * density());
      dy = Math.round((to.y - from.y) * density());
    }
  }
  const shifted = new Set<string>();
  for (const key of selectionCells(value)) {
    const [x, y] = key.split(',').map(Number);
    const nextX = x + dx;
    const nextY = y + dy;
    if (nextX >= 0 && nextY >= 0 && nextX < W() && nextY < H()) {
      shifted.add(`${nextX},${nextY}`);
    }
  }
  return selectionFromCells(shifted);
}

function extractSelectionToLayer(advance: boolean): void {
  if (!isLayeredSpriteFile(file) || !selection || !requireEditableLayer()) return;
  const source = activeLayer();
  const target = file.layers.find((layer) => layer.id === layerExtractTargetId);
  if (!source || !target || source.id === target.id) return;
  const animation = concreteAnimName();
  const sourceRows = source.tracks[animation]?.[frameIdx];
  const targetRows = target.tracks[animation]?.[frameIdx];
  if (!sourceRows || !targetRows) {
    flash('source and target layers do not share this frame');
    return;
  }
  const clip = pixelsInSelection(selection, sourceRows);
  const movedPixels = clip.rows.reduce((count, row) => count + [...row]
    .filter((pixel) => pixel !== '.' && pal()[pixel] !== null).length, 0);
  if (!movedPixels) {
    flash('the selection contains no pixels on the source layer');
    return;
  }

  saveHistory();
  clearSelectionPixels(sourceRows, selection);
  pastePixels(targetRows, clip, selection.x, selection.y, true);
  editVersion++;

  const previousFrame = frameIdx;
  const canAdvance = advance && frameIdx < anim().frames.length - 1;
  if (canAdvance) {
    frameIdx++;
    previewStepping = false;
    setSelection(selectionForNextFrame(selection, previousFrame, frameIdx));
    buildFrames();
    buildAnchors();
  }
  redraw();
  syncIO();
  schedulePreviewUpload();
  void publishSelection();
  flash(canAdvance
    ? `moved ${movedPixels} pixels to ${target.name}; frame ${frameIdx + 1} is ready`
    : `moved ${movedPixels} pixels to ${target.name}${advance ? '; last frame reached' : ''}`);
}

$('btnExtractSelection').onclick = () => extractSelectionToLayer(false);
$('btnExtractNext').onclick = () => extractSelectionToLayer(true);

$('btnAddLayer').onclick = () => {
  saveHistory();
  const layered = ensureLayeredFile();
  const label = `Layer ${layered.layers.length + 1}`;
  const layer: SpriteLayerData = {
    id: uniqueLayerId(label),
    name: label,
    tag: activeLayer()?.tag ?? defaultLayerTag(),
    tracks: makeTransparentTracks(),
  };
  layered.layers.push(layer);
  activeLayerId = layer.id;
  rememberActiveLayer();
  buildLayers();
  redraw();
  syncIO();
};

$('btnDupLayer').onclick = () => {
  if (!isLayeredSpriteFile(file)) return;
  const source = activeLayer();
  if (!source) return;
  saveHistory();
  const index = file.layers.indexOf(source);
  const copy = structuredClone(source);
  copy.id = uniqueLayerId(`${source.id}-copy`);
  copy.name = `${source.name} copy`;
  file.layers.splice(index + 1, 0, copy);
  activeLayerId = copy.id;
  rememberActiveLayer();
  buildLayers();
  redraw();
  syncIO();
};

function moveLayer(delta: -1 | 1): void {
  if (!isLayeredSpriteFile(file)) return;
  const index = file.layers.findIndex((layer) => layer.id === activeLayerId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= file.layers.length) return;
  if (file.layers[index].tag !== file.layers[target].tag) return;
  saveHistory();
  [file.layers[index], file.layers[target]] = [file.layers[target], file.layers[index]];
  buildLayers();
  redraw();
  syncIO();
}

$('btnLayerUp').onclick = () => moveLayer(1);
$('btnLayerDown').onclick = () => moveLayer(-1);

$('btnMergeLayer').onclick = () => {
  if (!isLayeredSpriteFile(file)) return;
  const index = file.layers.findIndex((layer) => layer.id === activeLayerId);
  if (index <= 0) return;
  saveHistory();
  const top = file.layers[index];
  const bottom = file.layers[index - 1];
  if (top.tag !== bottom.tag) return;
  for (const name of concreteAnimNames()) {
    for (let frame = 0; frame < top.tracks[name].length; frame++) {
      const over = top.tracks[name][frame];
      const under = [...bottom.tracks[name][frame]];
      for (let y = 0; y < over.length; y++) for (let x = 0; x < over[y].length; x++) {
        const ch = over[y][x];
        if (ch === '.' || pal()[ch] === null) continue;
        under[y] = under[y].slice(0, x) + ch + under[y].slice(x + 1);
      }
      bottom.tracks[name][frame] = under;
    }
  }
  file.layers.splice(index, 1);
  activeLayerId = bottom.id;
  reconcileLayerState();
  rememberActiveLayer();
  buildLayers();
  redraw();
  syncIO();
};

$('btnDelLayer').onclick = () => {
  if (!isLayeredSpriteFile(file) || file.layers.length <= 1) return;
  const index = file.layers.findIndex((layer) => layer.id === activeLayerId);
  if (index < 0 || !confirm(`Delete layer “${file.layers[index].name}”?`)) return;
  saveHistory();
  file.layers.splice(index, 1);
  activeLayerId = file.layers[Math.min(index, file.layers.length - 1)].id;
  reconcileLayerState();
  rememberActiveLayer();
  clearSelection(false);
  buildLayers();
  redraw();
  syncIO();
};

$('btnFlattenLayers').onclick = () => {
  if (!isLayeredSpriteFile(file) || !confirm('Flatten all layers? This can be undone.')) return;
  saveHistory();
  const layered = file as LayeredSpriteFile & EditorSpriteFile;
  const anims: Record<string, SpriteAnimData | string> = {};
  for (const [name, entry] of Object.entries(layered.anims)) {
    if (typeof entry === 'string') anims[name] = entry;
    else anims[name] = {
      fps: entry.fps,
      loop: entry.loop,
      frames: Array.from(
        { length: entry.frameCount },
        (_, frame) => compositeSpriteFrameByTags(layered, name, frame, renderTagIds(), PAL)!,
      ),
    };
  }
  const renderTag = [...renderTagIds()].reverse()
    .find((tag) => layered.layers.some((layer) => layer.tag === tag));
  const { layers: _layers, anims: _layeredAnims, ...rest } = layered;
  file = { ...rest, renderTag, anims } as FlatSpriteFile & EditorSpriteFile;
  reconcileLayerState(true);
  clearSelection(false);
  refreshUI();
};

/* ---------------- animations ui ---------------- */

function buildAnims(): void {
  const host = $('anims');
  host.innerHTML = '';
  for (const name of Object.keys(file.anims)) {
    const entry = file.anims[name];
    const b = document.createElement('button');
    // An alias borrows another animation's frames; label the borrow so
    // "plunge→attack" reads as "no art of its own yet".
    b.textContent = typeof entry === 'string' ? `${name}→${entry}` : name;
    b.title = typeof entry === 'string'
      ? `alias: edits under this name change "${entry}"`
      : name;
    b.className = name === animName ? 'active' : '';
    b.style.marginRight = '4px';
    b.onclick = () => {
      clearSelection(false);
      animName = name;
      frameIdx = 0;
      previewStepping = false;
      previewStepFrame = 0;
      refreshUI();
      schedulePreviewUpload();
      void publishSelection();
    };
    host.appendChild(b);
  }
  ($('fps') as HTMLInputElement).value = String(anim().fps);
}

$('btnAddAnim').onclick = () => {
  const name = prompt('animation name (e.g. idle, run, air):', '')?.trim();
  if (!name) return;
  if (file.anims[name]) {
    flash('already exists');
    return;
  }
  saveHistory();
  if (isLayeredSpriteFile(file)) {
    file.anims[name] = { fps: 8, frameCount: 1 };
    for (const layer of file.layers) layer.tracks[name] = [emptyFrame(W(), H())];
  } else {
    file.anims[name] = { fps: 8, frames: [emptyFrame(W(), H())] };
  }
  for (const anchors of Object.values(file.anchors ?? {})) {
    anchors[name] = [{ x: W() / density() / 2, y: H() / density() / 2 }];
  }
  animName = name;
  frameIdx = 0;
  refreshUI();
};
$('btnRenameAnim').onclick = () => {
  const name = prompt('rename animation:', animName)?.trim();
  if (!name || name === animName) return;
  if (file.anims[name]) {
    flash('already exists');
    return;
  }
  saveHistory();
  // Rebuild in order, swapping the key so button order is stable.
  if (isLayeredSpriteFile(file)) {
    const next: LayeredSpriteFile['anims'] = {};
    for (const [key, value] of Object.entries(file.anims)) {
      next[key === animName ? name : key] = value === animName ? name : value;
    }
    file.anims = next;
    for (const layer of file.layers) {
      if (layer.tracks[animName]) {
        layer.tracks[name] = layer.tracks[animName];
        delete layer.tracks[animName];
      }
    }
  } else {
    const next: FlatSpriteFile['anims'] = {};
    for (const [key, value] of Object.entries(file.anims)) {
      next[key === animName ? name : key] = value === animName ? name : value;
    }
    file.anims = next;
  }
  for (const anchors of Object.values(file.anchors ?? {})) {
    if (anchors[animName]) {
      anchors[name] = anchors[animName];
      delete anchors[animName];
    }
  }
  animName = name;
  refreshUI();
};
$('btnDelAnim').onclick = () => {
  const names = Object.keys(file.anims);
  if (names.length <= 1) {
    flash('need at least one');
    return;
  }
  saveHistory();
  const deleted = animName;
  delete file.anims[animName];
  if (isLayeredSpriteFile(file)) {
    for (const layer of file.layers) delete layer.tracks[deleted];
  }
  for (const [name, entry] of Object.entries(file.anims)) {
    if (entry === deleted) delete file.anims[name];
  }
  for (const anchors of Object.values(file.anchors ?? {})) delete anchors[animName];
  animName = Object.keys(file.anims)[0];
  frameIdx = 0;
  refreshUI();
};
($('fps') as HTMLInputElement).onchange = (e) => {
  const name = concreteAnimName();
  const entry = file.anims[name];
  if (entry && typeof entry !== 'string') entry.fps = Number((e.target as HTMLInputElement).value) || 1;
  syncIO();
};

/* ---------------- editing ---------------- */

function setPixel(x: number, y: number, ch: string): void {
  if (x < 0 || y < 0 || x >= W() || y >= H()) return;
  const f = cur();
  if (f[y][x] === ch) return;
  f[y] = f[y].slice(0, x) + ch + f[y].slice(x + 1);
  editVersion++;
}

interface Rgba { r: number; g: number; b: number; a: number }

// Sprite files address colors with one-character palette keys. Soft tools
// therefore bake their result into real palette entries rather than hiding
// browser-only alpha in the canvas preview. Excluding dot, quote, and slash
// keeps rows easy to read while leaving ample room for generated blends.
const AUTO_PALETTE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+=!?~^;:,<>[]{}()_-|`';

function parseRgba(color: string | null | undefined): Rgba | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color ?? '');
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
    a: match[2] ? Number.parseInt(match[2], 16) : 255,
  };
}

function rgbaHex(color: Rgba): string {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16).padStart(2, '0');
  const rgb = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
  return color.a >= 254.5 ? rgb : `${rgb}${byte(color.a)}`;
}

function mixRgba(from: Rgba, to: Rgba, amount: number): Rgba {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
    a: from.a + (to.a - from.a) * amount,
  };
}

function colorDistance(a: Rgba, b: Rgba): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2
    + (a.b - b.b) ** 2 + (a.a - b.a) ** 2;
}

function paletteUsage(): Map<string, number> {
  const usage = new Map<string, number>();
  for (const name of concreteAnimNames()) {
    eachLayerTrack(name, (frames) => {
      for (const frame of frames) {
        for (const row of frame) {
          for (const ch of row) usage.set(ch, (usage.get(ch) ?? 0) + 1);
        }
      }
    });
  }
  return usage;
}

interface PaletteCompaction { changed: boolean; merged: number; removed: number }

function compactPalette(removeUnused = true): PaletteCompaction {
  const usage = paletteUsage();
  const groups = new Map<string, string[]>();
  for (const [ch, color] of Object.entries(pal())) {
    if (ch === '.' || typeof color !== 'string') continue;
    const parsed = parseRgba(color);
    const key = parsed ? rgbaHex(parsed) : color.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(ch);
    groups.set(key, group);
  }

  const remap = new Map<string, string>();
  for (const chars of groups.values()) {
    if (chars.length < 2) continue;
    // Preserve the selected key when possible; otherwise keep the most-used
    // key so the compacted JSON remains stable and readable.
    const canonical = chars.includes(currentChar)
      ? currentChar
      : [...chars].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0))[0];
    for (const ch of chars) if (ch !== canonical) remap.set(ch, canonical);
  }

  if (remap.size) {
    for (const name of concreteAnimNames()) {
      eachLayerTrack(name, (frames) => {
        for (let index = 0; index < frames.length; index++) {
          frames[index] = frames[index].map((row) => [...row].map((ch) => remap.get(ch) ?? ch).join(''));
        }
      });
    }
    currentChar = remap.get(currentChar) ?? currentChar;
    for (const ch of remap.keys()) delete (file.palette ?? {})[ch];
  }

  const afterRemapUsage = paletteUsage();
  let removed = 0;
  if (removeUnused) {
    for (const ch of Object.keys(pal())) {
      if (ch === '.' || ch === currentChar || afterRemapUsage.has(ch)) continue;
      delete (file.palette ?? {})[ch];
      removed++;
    }
  }

  const changed = remap.size > 0 || removed > 0;
  if (changed) editVersion++;
  return { changed, merged: remap.size, removed };
}

function paletteCharFor(color: Rgba): string {
  // Small quantization absorbs imperceptible differences caused by repeated
  // feathered stamps and lets neighboring edge pixels reuse colors.
  const quantized = {
    r: Math.min(255, Math.round(color.r / 8) * 8),
    g: Math.min(255, Math.round(color.g / 8) * 8),
    b: Math.min(255, Math.round(color.b / 8) * 8),
    a: Math.min(255, Math.round(color.a / 8) * 8),
  };
  const hex = rgbaHex(quantized);
  let nearest = '';
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [ch, value] of Object.entries(pal())) {
    const rgba = parseRgba(value);
    if (!rgba) continue;
    if (rgbaHex(rgba) === hex) return ch;
    const distance = colorDistance(quantized, rgba);
    if (distance < nearestDistance) {
      nearest = ch;
      nearestDistance = distance;
    }
  }

  // Reuse a visually equivalent swatch. Otherwise add the blend while a
  // readable palette key remains, then degrade gracefully to the closest
  // existing color instead of corrupting the one-character frame format.
  if (nearest && nearestDistance <= 12 ** 2) return nearest;
  const free = [...AUTO_PALETTE_CHARS].find((ch) => !(ch in pal()));
  // A stroke can make a source color unused before the automatic compaction
  // at mouse-up. Recycle that slot when the key space is full.
  const usage = free ? null : paletteUsage();
  const recyclable = free ?? Object.keys(pal()).find((ch) =>
    ch !== '.' && ch !== currentChar && !usage?.has(ch),
  );
  if (!recyclable) return nearest || currentChar;
  (file.palette ??= {})[recyclable] = hex;
  strokePaletteChanged = true;
  return recyclable;
}

function brushSize(): number {
  const input = $('brushSize') as HTMLInputElement;
  const value = Math.round(input.valueAsNumber || 1);
  return Math.max(1, Math.min(32, value));
}

function brushStrength(dx: number, dy: number, size = brushSize()): number {
  const distance = Math.hypot(dx, dy);
  const outer = (size + 1) / 2;
  if (distance >= outer) return 0;
  const core = Math.max(0.55, outer * 0.55);
  if (distance <= core) return 1;
  return (outer - distance) / Math.max(0.001, outer - core);
}

function paintBrush(centerX: number, centerY: number, erase: boolean): void {
  const selected = parseRgba(pal()[currentChar]);
  if (!erase && (!selected || currentChar === '.')) erase = true;
  const extent = Math.ceil((brushSize() + 1) / 2);
  for (let dy = -extent; dy <= extent; dy++) {
    for (let dx = -extent; dx <= extent; dx++) {
      const strength = brushStrength(dx, dy);
      if (strength <= 0) continue;
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= W() || y >= H()) continue;
      if (erase) {
        setPixel(x, y, '.');
        continue;
      }
      const oldChar = cur()[y][x];
      const old = parseRgba(pal()[oldChar]);
      if (strength >= 0.995) setPixel(x, y, currentChar);
      else if (old) setPixel(x, y, paletteCharFor(mixRgba(old, selected!, strength)));
      else setPixel(x, y, paletteCharFor({ ...selected!, a: selected!.a * strength }));
    }
  }
}

function blurBrush(centerX: number, centerY: number, erase: boolean): void {
  if (erase) {
    paintBrush(centerX, centerY, true);
    return;
  }
  const source = cur().slice();
  const size = brushSize();
  const extent = Math.ceil((size + 1) / 2);
  const sampleRadius = Math.max(1, Math.floor(size / 2));
  for (let dy = -extent; dy <= extent; dy++) {
    for (let dx = -extent; dx <= extent; dx++) {
      const strength = brushStrength(dx, dy, size);
      if (strength <= 0) continue;
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= W() || y >= H()) continue;
      const original = parseRgba(pal()[source[y][x]]);
      if (!original) continue; // blur color, but never grow the silhouette
      let premultipliedR = 0;
      let premultipliedG = 0;
      let premultipliedB = 0;
      let alpha = 0;
      let count = 0;
      for (let sy = -sampleRadius; sy <= sampleRadius; sy++) {
        for (let sx = -sampleRadius; sx <= sampleRadius; sx++) {
          if (Math.hypot(sx, sy) > sampleRadius + 0.25) continue;
          const sample = parseRgba(pal()[source[y + sy]?.[x + sx]]);
          const sampleAlpha = (sample?.a ?? 0) / 255;
          premultipliedR += (sample?.r ?? 0) * sampleAlpha;
          premultipliedG += (sample?.g ?? 0) * sampleAlpha;
          premultipliedB += (sample?.b ?? 0) * sampleAlpha;
          alpha += sample?.a ?? 0;
          count++;
        }
      }
      if (!count) continue;
      const averageAlpha = alpha / count;
      const alphaWeight = alpha / 255;
      const average = {
        r: alphaWeight ? premultipliedR / alphaWeight : original.r,
        g: alphaWeight ? premultipliedG / alphaWeight : original.g,
        b: alphaWeight ? premultipliedB / alphaWeight : original.b,
        a: averageAlpha,
      };
      setPixel(x, y, paletteCharFor(mixRgba(original, average, strength)));
    }
  }
}

function floodFill(startX: number, startY: number, fillChar: string): void {
  const f = cur();
  const targetChar = f[startY]?.[startX];
  if (targetChar === undefined || targetChar === fillChar) return;
  
  const w = W();
  const h = H();
  const queue: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    
    if (f[y]?.[x] === targetChar) {
      setPixel(x, y, fillChar);
      
      if (x > 0) queue.push([x - 1, y]);
      if (x < w - 1) queue.push([x + 1, y]);
      if (y > 0) queue.push([x, y - 1]);
      if (y < h - 1) queue.push([x, y + 1]);
    }
  }
}

grid.addEventListener('contextmenu', (e) => e.preventDefault());
grid.addEventListener('mousedown', (e) => {
  if (currentTool !== 'magic' && currentTool !== 'select' && !transformMode
    && e.altKey && e.shiftKey && selectedAnchorName) {
    e.preventDefault();
    const bounds = grid.getBoundingClientRect();
    const sourceX = Math.floor((e.clientX - bounds.left) / cellSize);
    const sourceY = Math.floor((e.clientY - bounds.top) / cellSize);
    saveHistory();
    Object.assign(ensureCurrentAnchor(), { x: sourceX / density(), y: sourceY / density() });
    buildAnchors();
    redraw();
    syncIO();
    return;
  }
  if (currentTool === 'magic' && !transformMode) {
    e.preventDefault();
    if (e.button === 2) {
      clearSelection();
      return;
    }
    if (e.button !== 0) return;
    beginMagicSelection(e);
    return;
  }
  if (!transformMode && ((e.altKey && currentTool !== 'select') || currentTool === 'picker')) {
    e.preventDefault();
    if (e.button !== 0) return;
    picking = true;
    pickColor(e);
    return;
  }
  if (transformMode) {
    e.preventDefault();
    if (e.button === 2) {
      clearSelection();
      return;
    }
    if (e.button !== 0) return;
    if (!selection) {
      setTransformMode(false);
      return;
    }
    const handle = selectionHandleAt(e);
    if (handle) {
      beginSelectionHandleTransform(handle, e);
      return;
    }
    const point = gridCell(e);
    if (selectionContains(selection, point.x, point.y)) {
      beginSelectionMove(point);
    }
    return;
  }
  if (currentTool === 'select') {
    e.preventDefault();
    if (e.button === 2) {
      clearSelection();
      return;
    }
    if (e.button !== 0) return;
    const mode = selectionCombineMode(e);
    const point = gridCell(e);
    selectionStart = { ...point, mode, base: selectionCells(selection) };
    ($('selectionAngle') as HTMLInputElement).value = '0';
    applyRectangularSelection(point);
    return;
  }
  if (!requireEditableLayer()) return;
  saveHistory();
  erasing = e.button === 2;
  painting = true;
  lastPaintCell = null;
  paint(e);
});
grid.addEventListener('mousemove', (e) => {
  hoverPointer = { x: e.clientX, y: e.clientY };
  updateBrushCursor();
  updateSelectionModifierCursor(e);
  if (picking) {
    pickColor(e, false);
    return;
  }
  if (magicSelectionDrag) {
    updateMagicSelectionDrag(gridCell(e));
    return;
  }
  if (selectionHandleTransform) {
    updateSelectionHandleTransform(e);
    return;
  }
  if (selectionStart) {
    applyRectangularSelection(gridCell(e));
    return;
  }
  if (selectionMove) {
    moveSelectionDrag(gridCell(e));
    return;
  }
  updateSelectionCursor(e);
  if (painting && currentTool !== 'fill') paint(e); // Don't drag-fill for bucket
});
grid.addEventListener('mouseleave', () => {
  hoverPointer = null;
  grid.classList.remove('selection-movable');
  if (!selectionHandleTransform) grid.style.cursor = '';
  updateBrushCursor();
});
window.addEventListener('mouseup', () => {
  picking = false;
  if (magicSelectionDrag) {
    const mode = magicSelectionDrag.initialMode;
    magicSelectionDrag = null;
    void publishSelection();
    const count = selection ? selectionPixelCount(selection) : 0;
    flash(count ? `selected ${count} pixels (${mode})` : 'selection cleared');
  }
  if (selectionStart) {
    const mode = selectionStart.mode;
    selectionStart = null;
    void publishSelection();
    const count = selection ? selectionPixelCount(selection) : 0;
    // A plain rectangle is normally the boundary of an object the author
    // wants to manipulate next. Modifier-assisted add/subtract/intersect
    // gestures stay in Select so several refinements can be made in a row.
    if (count && mode === 'replace') setTransformMode(true);
    flash(count ? `selected ${count} pixels (${mode})` : 'selection cleared');
  }
  if (selectionMove) {
    const moved = selectionMove.moved;
    selectionMove = null;
    if (moved) {
      syncIO();
      void publishSelection();
    }
  }
  if (selectionHandleTransform) {
    const completedTransform = selectionHandleTransform;
    const moved = completedTransform.moved;
    const handle = completedTransform.handle;
    selectionHandleTransform = null;
    if (moved) {
      syncIO();
      void publishSelection();
      const flipped = [
        completedTransform.flipX ? 'horizontal' : '',
        completedTransform.flipY ? 'vertical' : '',
      ].filter(Boolean).join(' + ');
      flash(handle === 'rotate'
        ? 'rotated selection'
        : flipped ? `resized + flipped ${flipped}` : 'resized selection');
    }
    ($('selectionAngle') as HTMLInputElement).value = '0';
    grid.style.cursor = transformMode ? 'default' : currentTool === 'select' ? 'cell' : '';
  }
  if (painting) {
    painting = false;
    lastPaintCell = null;
    if (strokePaletteChanged) {
      // Keep deliberately prepared but unused swatches during ordinary
      // painting. The manual compact action is the explicit opt-in to remove
      // those; automatic maintenance only coalesces exact duplicates.
      compactPalette(false);
      buildPalette();
    }
    strokePaletteChanged = false;
    syncIO();
  }
});

function gridCell(e: MouseEvent): { x: number; y: number } {
  const r = grid.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(W() - 1, Math.floor((e.clientX - r.left) / cellSize))),
    y: Math.max(0, Math.min(H() - 1, Math.floor((e.clientY - r.top) / cellSize))),
  };
}

function pickColor(e: MouseEvent, announce = true): void {
  const { x, y } = gridCell(e);
  // Sampling follows what the artist sees, while painting still targets only
  // the active layer. This makes it possible to borrow a base-layer shade for
  // a correction layer without temporarily merging the artwork.
  currentChar = compositeCur()[y][x];
  buildPalette();
  if (announce) {
    const color = pal()[currentChar];
    flash(currentChar === '.' ? `picked transparency at ${x},${y}` : `picked ${currentChar} ${color} at ${x},${y}`);
  }
}

function magicTolerance(): number {
  return Math.max(0, Math.min(255, Math.round(($('magicTolerance') as HTMLInputElement).valueAsNumber || 0)));
}

function selectionCombineMode(e: { shiftKey: boolean; altKey: boolean }): SelectionCombineMode {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return 'replace';
}

function combineSelectionCells(
  existing: Set<string>,
  incoming: Set<string>,
  mode: SelectionCombineMode,
): Set<string> {
  if (mode === 'add') return new Set([...existing, ...incoming]);
  if (mode === 'subtract') return new Set([...existing].filter((key) => !incoming.has(key)));
  if (mode === 'intersect') return new Set([...existing].filter((key) => incoming.has(key)));
  return incoming;
}

function applyRectangularSelection(point: { x: number; y: number }): void {
  if (!selectionStart) return;
  const minX = Math.min(selectionStart.x, point.x);
  const maxX = Math.max(selectionStart.x, point.x);
  const minY = Math.min(selectionStart.y, point.y);
  const maxY = Math.max(selectionStart.y, point.y);
  const rectangle = new Set<string>();
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    rectangle.add(`${x},${y}`);
  }
  setSelection(selectionFromCells(combineSelectionCells(selectionStart.base, rectangle, selectionStart.mode)));
}

function magicMatchCells(startX: number, startY: number): Set<string> {
  const rows = cur();
  const seedChar = rows[startY]?.[startX];
  const result = new Set<string>();
  if (seedChar === undefined) return result;
  const seed = parseRgba(pal()[seedChar]);
  const threshold = magicTolerance() ** 2;
  const matches = (x: number, y: number): boolean => {
    const candidateChar = rows[y]?.[x];
    if (candidateChar === undefined) return false;
    if (!seed) return !parseRgba(pal()[candidateChar]);
    const candidate = parseRgba(pal()[candidateChar]);
    // RGBA has four independent 0-255 channels. Average their squared
    // differences so the UI tolerance keeps its advertised 0-255 range:
    // 255 includes even black versus white, while palette quantization can
    // continue using the unnormalized distance metric above.
    return Boolean(candidate && colorDistance(seed, candidate) / 4 <= threshold);
  };

  if (!(($('magicContiguous') as HTMLInputElement).checked)) {
    for (let y = 0; y < H(); y++) for (let x = 0; x < W(); x++) {
      if (matches(x, y)) result.add(`${x},${y}`);
    }
    return result;
  }

  const queue: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index];
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (!matches(x, y)) continue;
    result.add(key);
    if (x > 0) queue.push([x - 1, y]);
    if (x + 1 < W()) queue.push([x + 1, y]);
    if (y > 0) queue.push([x, y - 1]);
    if (y + 1 < H()) queue.push([x, y + 1]);
  }
  return result;
}

function applyMagicSelectionAt(
  existing: Set<string>,
  point: { x: number; y: number },
  mode: SelectionCombineMode,
): Set<string> {
  // Subtraction is intentionally pencil-like. A region-aware subtraction is
  // too destructive when an artist is cleaning a few accidental wand pixels.
  const matched = mode === 'subtract'
    ? new Set([`${point.x},${point.y}`])
    : magicMatchCells(point.x, point.y);
  return combineSelectionCells(existing, matched, mode);
}

function beginMagicSelection(e: MouseEvent): void {
  const point = gridCell(e);
  const initialMode = selectionCombineMode(e);
  const next = applyMagicSelectionAt(selectionCells(selection), point, initialMode);
  setSelection(selectionFromCells(next));
  magicSelectionDrag = {
    initialMode,
    // A normal click establishes the new selection. Continuing the same
    // gesture expands it, matching how artists paint a wand selection.
    mode: initialMode === 'replace' ? 'add' : initialMode,
    last: point,
  };
}

function pointsOnGridLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  if (!steps) return [to];
  const points: Array<{ x: number; y: number }> = [];
  let previous = '';
  for (let step = 1; step <= steps; step++) {
    const point = {
      x: Math.round(from.x + (to.x - from.x) * step / steps),
      y: Math.round(from.y + (to.y - from.y) * step / steps),
    };
    const key = `${point.x},${point.y}`;
    if (key !== previous) points.push(point);
    previous = key;
  }
  return points;
}

function updateMagicSelectionDrag(point: { x: number; y: number }): void {
  const drag = magicSelectionDrag;
  if (!drag || (point.x === drag.last.x && point.y === drag.last.y)) return;
  let cells = selectionCells(selection);
  let changed = false;
  for (const nextPoint of pointsOnGridLine(drag.last, point)) {
    const key = `${nextPoint.x},${nextPoint.y}`;
    // Add-mode wand drags only need work when the pointer leaves the current
    // selection. Subtract-mode keeps erasing individual pixels along the path.
    if (drag.mode === 'add' && cells.has(key)) continue;
    if (drag.mode === 'subtract' && !cells.has(key)) continue;
    const next = applyMagicSelectionAt(cells, nextPoint, drag.mode);
    if (next.size !== cells.size || [...next].some((cell) => !cells.has(cell))) changed = true;
    cells = next;
  }
  drag.last = point;
  if (changed) setSelection(selectionFromCells(cells));
}

function shiftSelectionColors(startX: number, startY: number): void {
  if (!selection || !selectionContains(selection, startX, startY)) {
    flash('select an area, then click a source color inside it');
    return;
  }
  const sourceChar = cur()[startY]?.[startX];
  const source = parseRgba(pal()[sourceChar]);
  const target = parseRgba(pal()[currentChar]);
  if (!source || !target || currentChar === '.') {
    flash('color match needs a visible source and paint color');
    return;
  }
  const delta = { r: target.r - source.r, g: target.g - source.g, b: target.b - source.b };
  let changed = 0;
  for (let y = selection.y; y < selection.y + selection.h; y++) {
    for (let x = selection.x; x < selection.x + selection.w; x++) {
      if (!selectionContains(selection, x, y)) continue;
      const original = parseRgba(pal()[cur()[y][x]]);
      if (!original) continue;
      const next = x === startX && y === startY
        ? currentChar
        : paletteCharFor({
          r: original.r + delta.r,
          g: original.g + delta.g,
          b: original.b + delta.b,
          a: original.a,
        });
      if (cur()[y][x] !== next) {
        setPixel(x, y, next);
        changed++;
      }
    }
  }
  flash(changed
    ? `matched ${changed} selected pixels from ${pal()[sourceChar]} to ${pal()[currentChar]}`
    : 'selected colors already match');
}

function pointInRect(point: { x: number; y: number }, rect: PixelRect): boolean {
  return point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.w && point.y < rect.y + rect.h;
}

function cloneSelection(value: PixelSelection): PixelSelection {
  return { ...value, mask: value.mask?.slice() };
}

function selectionContains(value: PixelSelection, x: number, y: number): boolean {
  if (!pointInRect({ x, y }, value)) return false;
  return !value.mask || value.mask[y - value.y]?.[x - value.x] === '1';
}

function selectionPixelCount(value: PixelSelection): number {
  if (!value.mask) return value.w * value.h;
  let count = 0;
  for (const row of value.mask) for (const bit of row) if (bit === '1') count++;
  return count;
}

function selectionCells(value: PixelSelection | null): Set<string> {
  const cells = new Set<string>();
  if (!value) return cells;
  for (let y = value.y; y < value.y + value.h; y++) {
    for (let x = value.x; x < value.x + value.w; x++) {
      if (selectionContains(value, x, y)) cells.add(`${x},${y}`);
    }
  }
  return cells;
}

function selectionFromCells(cells: Set<string>): PixelSelection | null {
  if (!cells.size) return null;
  const points = [...cells].map((key) => key.split(',').map(Number) as [number, number]);
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return {
    x: minX,
    y: minY,
    w,
    h,
    mask: Array.from({ length: h }, (_, dy) =>
      Array.from({ length: w }, (_, dx) => cells.has(`${minX + dx},${minY + dy}`) ? '1' : '.').join(''),
    ),
  };
}

function pixelsInRect(rect: PixelRect, rows = cur()): PixelClipboard {
  return {
    w: rect.w,
    h: rect.h,
    rows: Array.from({ length: rect.h }, (_, y) =>
      rows[rect.y + y].slice(rect.x, rect.x + rect.w),
    ),
  };
}

function pixelsInSelection(value: PixelSelection, rows = cur()): PixelClipboard {
  const clip = pixelsInRect(value, rows);
  if (!value.mask) return clip;
  return {
    ...clip,
    rows: clip.rows.map((row, y) => [...row]
      .map((pixel, x) => value.mask![y][x] === '1' ? pixel : '.')
      .join('')),
    mask: value.mask.slice(),
  };
}

function clearRect(rows: string[], rect: PixelRect): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    rows[y] = rows[y].slice(0, rect.x) + '.'.repeat(rect.w) + rows[y].slice(rect.x + rect.w);
  }
}

function clearSelectionPixels(rows: string[], value: PixelSelection): void {
  if (!value.mask) {
    clearRect(rows, value);
    return;
  }
  for (let dy = 0; dy < value.h; dy++) {
    const destination = [...rows[value.y + dy]];
    for (let dx = 0; dx < value.w; dx++) {
      if (value.mask[dy][dx] === '1') destination[value.x + dx] = '.';
    }
    rows[value.y + dy] = destination.join('');
  }
}

function pastePixels(
  rows: string[],
  clip: PixelClipboard,
  x: number,
  y: number,
  ignoreTransparent = false,
): void {
  const pastedW = Math.min(clip.w, rows[0].length - x);
  const pastedH = Math.min(clip.h, rows.length - y);
  for (let dy = 0; dy < pastedH; dy++) {
    if (!ignoreTransparent) {
      rows[y + dy] = rows[y + dy].slice(0, x)
        + clip.rows[dy].slice(0, pastedW)
        + rows[y + dy].slice(x + pastedW);
      continue;
    }
    const destination = [...rows[y + dy]];
    for (let dx = 0; dx < pastedW; dx++) {
      if (clip.mask && clip.mask[dy]?.[dx] !== '1') continue;
      const pixel = clip.rows[dy][dx];
      if (pixel !== '.') destination[x + dx] = pixel;
    }
    rows[y + dy] = destination.join('');
  }
}

function beginSelectionMove(point: { x: number; y: number }): void {
  if (!requireEditableLayer()) return;
  if (!selection) return;
  const original = cloneSelection(selection);
  const baseFrame = cur().slice();
  const source = pixelsInSelection(original, baseFrame);
  clearSelectionPixels(baseFrame, original);
  selectionMove = {
    start: point,
    original,
    source,
    baseFrame,
    last: { x: original.x, y: original.y },
    moved: false,
  };
}

function moveSelectionDrag(point: { x: number; y: number }): void {
  if (!selectionMove) return;
  const x = Math.max(0, Math.min(W() - selectionMove.original.w,
    selectionMove.original.x + point.x - selectionMove.start.x));
  const y = Math.max(0, Math.min(H() - selectionMove.original.h,
    selectionMove.original.y + point.y - selectionMove.start.y));
  if (x === selectionMove.last.x && y === selectionMove.last.y) return;
  if (!selectionMove.moved) saveHistory();
  selectionMove.moved = true;
  selectionMove.last = { x, y };
  const rows = selectionMove.baseFrame.slice();
  pastePixels(rows, selectionMove.source, x, y, true);
  anim().frames[frameIdx] = rows;
  editVersion++;
  setSelection({ x, y, w: selectionMove.original.w, h: selectionMove.original.h, mask: selectionMove.source.mask?.slice() });
}

function gridPointer(e: MouseEvent): { x: number; y: number } {
  const bounds = grid.getBoundingClientRect();
  return {
    x: (e.clientX - bounds.left) / cellSize,
    y: (e.clientY - bounds.top) / cellSize,
  };
}

function selectionHandlePositions(rect: PixelRect): Array<{
  handle: SelectionHandle;
  x: number;
  y: number;
  stemX?: number;
  stemY?: number;
}> {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  const middleX = (left + right) / 2;
  const middleY = (top + bottom) / 2;
  const rotationGap = 24 / cellSize;
  const rotateAbove = top * cellSize >= 32;
  const rotateBelow = (H() - bottom) * cellSize >= 32;
  const rotationHandle = rotateAbove
    ? { handle: 'rotate' as const, x: middleX, y: top - rotationGap, stemX: middleX, stemY: top }
    : rotateBelow
      ? { handle: 'rotate' as const, x: middleX, y: bottom + rotationGap, stemX: middleX, stemY: bottom }
      : { handle: 'rotate' as const, x: middleX, y: top + Math.min(rect.h / 2, rotationGap), stemX: middleX, stemY: top };
  return [
    { handle: 'nw', x: left, y: top },
    { handle: 'n', x: middleX, y: top },
    { handle: 'ne', x: right, y: top },
    { handle: 'e', x: right, y: middleY },
    { handle: 'se', x: right, y: bottom },
    { handle: 's', x: middleX, y: bottom },
    { handle: 'sw', x: left, y: bottom },
    { handle: 'w', x: left, y: middleY },
    rotationHandle,
  ];
}

function selectionHandleAt(e: MouseEvent): SelectionHandle | null {
  if (!transformMode || !selection) return null;
  const pointer = gridPointer(e);
  const handles = selectionHandlePositions(selection);
  // Rotation wins where a very small selection makes handles overlap.
  handles.sort((a, b) => Number(b.handle === 'rotate') - Number(a.handle === 'rotate'));
  for (const handle of handles) {
    const distance = Math.hypot(
      (pointer.x - handle.x) * cellSize,
      (pointer.y - handle.y) * cellSize,
    );
    if (distance <= (handle.handle === 'rotate' ? 11 : 9)) return handle.handle;
  }
  return null;
}

function updateSelectionCursor(e?: MouseEvent): void {
  grid.classList.remove('selection-movable');
  if (selectionCombineMode(selectionModifierKeys) !== 'replace') {
    grid.style.cursor = '';
    return;
  }
  if (!transformMode || !selection || !e) {
    grid.style.cursor = '';
    return;
  }
  const handle = selectionHandleAt(e);
  const cursors: Partial<Record<SelectionHandle, string>> = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
    se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
    rotate: 'grab',
  };
  if (handle) {
    grid.style.cursor = cursors[handle] ?? 'default';
    return;
  }
  const point = gridCell(e);
  if (selectionContains(selection, point.x, point.y)) {
    grid.classList.add('selection-movable');
    grid.style.cursor = 'move';
  } else {
    grid.style.cursor = 'default';
  }
}

function beginSelectionHandleTransform(handle: SelectionHandle, e: MouseEvent): void {
  if (!requireEditableLayer()) return;
  if (!selection) return;
  const original = cloneSelection(selection);
  const sourceFrame = cur().slice();
  const baseFrame = sourceFrame.slice();
  clearSelectionPixels(baseFrame, original);
  const pointer = gridPointer(e);
  const centerX = original.x + original.w / 2;
  const centerY = original.y + original.h / 2;
  selectionHandleTransform = {
    handle,
    original,
    source: pixelsInSelection(original, sourceFrame),
    baseFrame,
    startPointer: pointer,
    startAngle: Math.atan2(pointer.y - centerY, pointer.x - centerX),
    lastKey: '',
    moved: false,
    flipX: false,
    flipY: false,
  };
  grid.style.cursor = handle === 'rotate' ? 'grabbing' : grid.style.cursor;
}

function applyLiveSelectionTransform(
  transform: SelectionHandleTransform,
  clip: PixelClipboard,
  x: number,
  y: number,
  key: string,
): void {
  if (key === transform.lastKey) return;
  if (!transform.moved) saveHistory();
  transform.moved = true;
  transform.lastKey = key;
  const rows = transform.baseFrame.slice();
  pastePixels(rows, clip, x, y, true);
  anim().frames[frameIdx] = rows;
  editVersion++;
  setSelection({ x, y, w: clip.w, h: clip.h, mask: clip.mask?.slice() });
}

function updateSelectionHandleTransform(e: MouseEvent): void {
  const transform = selectionHandleTransform;
  if (!transform) return;
  const pointer = gridPointer(e);
  if (transform.handle === 'rotate') {
    const centerX = transform.original.x + transform.original.w / 2;
    const centerY = transform.original.y + transform.original.h / 2;
    const angle = Math.atan2(pointer.y - centerY, pointer.x - centerX);
    let degrees = (angle - transform.startAngle) * 180 / Math.PI;
    degrees = ((degrees + 540) % 360) - 180;
    if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
    if (Math.abs(degrees) < 0.5) degrees = 0;
    const roundedDegrees = Math.round(degrees * 10) / 10;
    ($('selectionAngle') as HTMLInputElement).value = String(roundedDegrees);
    const rotated = rotateSelectionRows(transform.source, roundedDegrees);
    if (rotated.w > W() || rotated.h > H()) return;
    const x = Math.max(0, Math.min(W() - rotated.w,
      Math.round(centerX - rotated.w / 2)));
    const y = Math.max(0, Math.min(H() - rotated.h,
      Math.round(centerY - rotated.h / 2)));
    applyLiveSelectionTransform(transform, rotated, x, y, `rotate:${roundedDegrees}`);
    return;
  }

  const original = transform.original;
  let left = original.x;
  let right = original.x + original.w;
  let top = original.y;
  let bottom = original.y + original.h;
  let flipX = false;
  let flipY = false;
  if (transform.handle.includes('w')) {
    const fixed = right;
    let moving = Math.max(0, Math.min(W(), Math.round(pointer.x)));
    if (moving === fixed) moving = Math.max(0, fixed - 1);
    left = Math.min(moving, fixed);
    right = Math.max(moving, fixed);
    flipX = moving > fixed;
  } else if (transform.handle.includes('e')) {
    const fixed = left;
    let moving = Math.max(0, Math.min(W(), Math.round(pointer.x)));
    if (moving === fixed) moving = Math.min(W(), fixed + 1);
    left = Math.min(moving, fixed);
    right = Math.max(moving, fixed);
    flipX = moving < fixed;
  }
  if (transform.handle.includes('n')) {
    const fixed = bottom;
    let moving = Math.max(0, Math.min(H(), Math.round(pointer.y)));
    if (moving === fixed) moving = Math.max(0, fixed - 1);
    top = Math.min(moving, fixed);
    bottom = Math.max(moving, fixed);
    flipY = moving > fixed;
  } else if (transform.handle.includes('s')) {
    const fixed = top;
    let moving = Math.max(0, Math.min(H(), Math.round(pointer.y)));
    if (moving === fixed) moving = Math.min(H(), fixed + 1);
    top = Math.min(moving, fixed);
    bottom = Math.max(moving, fixed);
    flipY = moving < fixed;
  }
  const width = right - left;
  const height = bottom - top;
  transform.flipX = flipX;
  transform.flipY = flipY;
  const scaled = scaleSelectionRows(transform.source, width, height, flipX, flipY);
  applyLiveSelectionTransform(
    transform,
    scaled,
    left,
    top,
    `resize:${left},${top},${width},${height},${Number(flipX)},${Number(flipY)}`,
  );
}

function setSelection(next: PixelSelection | null): void {
  selection = next;
  const transformEnded = !selection && transformMode;
  if (transformEnded) transformMode = false;
  ($('btnCut') as HTMLButtonElement).disabled = !selection;
  ($('btnCopy') as HTMLButtonElement).disabled = !selection;
  updateSelectionTransformControls();
  const selectionW = $('selectionW') as HTMLInputElement;
  const selectionH = $('selectionH') as HTMLInputElement;
  if (selection) {
    selectionW.value = String(selection.w);
    selectionH.value = String(selection.h);
  }
  $('selectionStatus').textContent = selection
    ? `selection: ${selectionPixelCount(selection)} px in ${selection.w}x${selection.h} at ${selection.x},${selection.y} · shared with agent`
    : 'selection: none';
  buildLayerExtractionControls();
  if (transformEnded) updateToolUI();
  redraw();
}

function clearSelection(publish = true): void {
  selectionStart = null;
  magicSelectionDrag = null;
  selectionMove = null;
  selectionHandleTransform = null;
  grid.classList.remove('selection-movable');
  grid.style.cursor = '';
  setSelection(null);
  if (publish) void publishSelection();
}

// Treat the empty canvas workspace like an art application's pasteboard:
// clicking it dismisses the current pixel selection. Checking the direct
// target keeps canvas gestures and every surrounding panel/control intact.
$('center').addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target !== event.currentTarget || !selection) return;
  clearSelection();
});

function paint(e: MouseEvent): void {
  const r = grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / cellSize);
  const y = Math.floor((e.clientY - r.top) / cellSize);
  if (currentTool === 'fill') {
    const mode = ($('fillMode') as HTMLSelectElement).value;
    if (mode === 'match' && !erasing) shiftSelectionColors(x, y);
    else floodFill(x, y, erasing ? '.' : currentChar);
  } else if (currentTool === 'draw') {
    setPixel(x, y, erasing ? '.' : currentChar);
  } else if (currentTool === 'brush' || currentTool === 'blur') {
    const previous = lastPaintCell;
    if (previous?.x === x && previous.y === y) return;
    const steps = previous ? Math.max(Math.abs(x - previous.x), Math.abs(y - previous.y)) : 0;
    for (let step = 0; step <= steps; step++) {
      const amount = steps ? step / steps : 1;
      const stampX = previous ? Math.round(previous.x + (x - previous.x) * amount) : x;
      const stampY = previous ? Math.round(previous.y + (y - previous.y) * amount) : y;
      if (currentTool === 'brush') paintBrush(stampX, stampY, erasing);
      else blurBrush(stampX, stampY, erasing);
    }
    lastPaintCell = { x, y };
  }
  redraw();
}

/* ---------------- frames ---------------- */

function buildFrames(): void {
  const host = $('frames');
  host.innerHTML = '';
  anim().frames.forEach((_, i) => {
    const b = document.createElement('button');
    b.textContent = String(i + 1);
    b.className = i === frameIdx ? 'active' : '';
    b.onclick = () => {
      clearSelection(false);
      frameIdx = i;
      previewStepping = false;
      buildFrames();
      buildAnchors();
      redraw();
      schedulePreviewUpload();
      void publishSelection();
    };
    host.appendChild(b);
  });
  $('frameOf').textContent = `${animName} · ${frameIdx + 1}/${anim().frames.length}`;
  ($('btnFrameLeft') as HTMLButtonElement).disabled = frameIdx === 0;
  ($('btnFrameRight') as HTMLButtonElement).disabled = frameIdx === anim().frames.length - 1;
}

$('btnAddFrame').onclick = () => {
  saveHistory();
  eachLayerTrack(animName, (frames) => frames.push(emptyFrame(W(), H())));
  setTimelineFrameCount(animName, anim().frames.length);
  for (const anchors of Object.values(file.anchors ?? {})) {
    const points = anchors[concreteAnimName()];
    if (points) points.push({ ...(points.at(-1) ?? { x: W() / density() / 2, y: H() / density() / 2 }) });
  }
  frameIdx = anim().frames.length - 1;
  buildFrames();
  buildAnchors();
  buildAttachmentSlots();
  redraw();
  syncIO();
};
$('btnDupFrame').onclick = () => {
  saveHistory();
  eachLayerTrack(animName, (frames) => frames.splice(frameIdx + 1, 0, [...frames[frameIdx]]));
  setTimelineFrameCount(animName, anim().frames.length);
  for (const anchors of Object.values(file.anchors ?? {})) {
    const points = anchors[concreteAnimName()];
    if (points) points.splice(frameIdx + 1, 0, { ...(points[frameIdx] ?? { x: W() / density() / 2, y: H() / density() / 2 }) });
  }
  frameIdx++;
  buildFrames();
  buildAnchors();
  redraw();
  syncIO();
};
function moveSelectedFrame(delta: -1 | 1): void {
  const frames = anim().frames;
  const target = frameIdx + delta;
  if (target < 0 || target >= frames.length) return;
  saveHistory();
  eachLayerTrack(animName, (track) => {
    [track[frameIdx], track[target]] = [track[target], track[frameIdx]];
  });
  for (const anchors of Object.values(file.anchors ?? {})) {
    const points = anchors[concreteAnimName()];
    if (points?.length === frames.length) {
      [points[frameIdx], points[target]] = [points[target], points[frameIdx]];
    }
  }
  frameIdx = target;
  previewStepping = false;
  buildFrames();
  buildAnchors();
  redraw();
  syncIO();
  schedulePreviewUpload();
  void publishSelection();
}

$('btnFrameLeft').onclick = () => moveSelectedFrame(-1);
$('btnFrameRight').onclick = () => moveSelectedFrame(1);
$('btnDelFrame').onclick = () => {
  if (anim().frames.length <= 1) return;
  saveHistory();
  eachLayerTrack(animName, (frames) => frames.splice(frameIdx, 1));
  setTimelineFrameCount(animName, anim().frames.length);
  for (const anchors of Object.values(file.anchors ?? {})) anchors[concreteAnimName()]?.splice(frameIdx, 1);
  frameIdx = Math.min(frameIdx, anim().frames.length - 1);
  buildFrames();
  buildAnchors();
  redraw();
  syncIO();
};

$('btnResize').onclick = () => {
  const w = Number(($('w') as HTMLInputElement).value);
  const h = Number(($('h') as HTMLInputElement).value);
  if (!(w >= 1 && h >= 1 && w <= MAX_GRID_SIZE && h <= MAX_GRID_SIZE)) return;
  saveHistory();
  // Resize every frame of every animation so the sprite stays uniform.
  for (const name of concreteAnimNames()) {
    eachLayerTrack(name, (frames) => {
      for (let index = 0; index < frames.length; index++) {
        const next: string[] = [];
        for (let y = 0; y < h; y++) next.push((frames[index][y] ?? '').slice(0, w).padEnd(w, '.'));
        frames[index] = next;
      }
    });
  }
  redraw();
  syncIO();
};

function redraw(): void {
  grid.width = W() * cellSize;
  grid.height = H() * cellSize;
  gctx.imageSmoothingEnabled = false;

  // 1. Transparency is a fixed view-space checker. It deliberately ignores
  // cellSize, so zooming the sprite never turns checker tiles into pixels.
  drawTransparencyChecker(gctx, grid.width, grid.height);

  // 3. Draw reference sprite if enabled
  const showRef = ($('showRef') as HTMLInputElement)?.checked ?? true;
  if (refFile && showRef) {
    const refAnim = resolveAnim(refFile, animName in refFile.anims ? animName : Object.keys(refFile.anims)[0]);
    if (refAnim) {
      const refFrame = refAnim.frames[frameIdx % refAnim.frames.length];
      if (refFrame) {
        gctx.save();
        gctx.globalAlpha = 0.3;
        for (let y = 0; y < H(); y++) {
          for (let x = 0; x < W(); x++) {
            const char = refFrame[y]?.[x];
            if (char) {
              const color = (refFile.palette ?? {})[char] ?? PAL[char];
              if (color) {
                gctx.fillStyle = color;
                gctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
              }
            }
          }
        }
        gctx.restore();
      }
    }
  }

  // 4. Draw onion skin if enabled
  const onion = ($('onionSkin') as HTMLInputElement)?.checked ?? false;
  if (onion && frameIdx > 0) {
    const prevFrame = compositeCur(frameIdx - 1);
    if (prevFrame) {
      gctx.save();
      gctx.globalAlpha = 0.2;
      for (let y = 0; y < H(); y++) {
        for (let x = 0; x < W(); x++) {
          const color = pal()[prevFrame[y]?.[x]] ?? PAL[prevFrame[y]?.[x]];
          if (color) {
            gctx.fillStyle = color;
            gctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          }
        }
      }
      gctx.restore();
    }
  }

  // 5. Draw current frame solid pixels
  const visibleFrame = compositeCur();
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      const color = pal()[visibleFrame[y][x]] ?? PAL[visibleFrame[y][x]];
      if (color) {
        gctx.fillStyle = color;
        gctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  // 6. Grid lines
  gctx.strokeStyle = 'rgba(35, 40, 48, 0.18)';
  for (let x = 0; x <= W(); x++) {
    gctx.beginPath();
    gctx.moveTo(x * cellSize + 0.5, 0);
    gctx.lineTo(x * cellSize + 0.5, H() * cellSize);
    gctx.stroke();
  }
  for (let y = 0; y <= H(); y++) {
    gctx.beginPath();
    gctx.moveTo(0, y * cellSize + 0.5);
    gctx.lineTo(W() * cellSize, y * cellSize);
    gctx.stroke();
  }

  if (selection) {
    const x = selection.x * cellSize;
    const y = selection.y * cellSize;
    const w = selection.w * cellSize;
    const h = selection.h * cellSize;
    gctx.save();
    gctx.fillStyle = 'rgba(255,205,117,0.12)';
    if (selection.mask) {
      for (let dy = 0; dy < selection.h; dy++) for (let dx = 0; dx < selection.w; dx++) {
        if (selection.mask[dy][dx] === '1') gctx.fillRect(x + dx * cellSize, y + dy * cellSize, cellSize, cellSize);
      }
    } else {
      gctx.fillRect(x, y, w, h);
    }
    gctx.strokeStyle = '#ffcd75';
    gctx.lineWidth = 2;
    gctx.setLineDash([Math.max(3, cellSize / 3), Math.max(2, cellSize / 5)]);
    if (selection.mask) {
      const mask = selection.mask;
      gctx.setLineDash([]);
      gctx.lineWidth = Math.max(1, Math.min(2, cellSize / 6));
      for (let dy = 0; dy < selection.h; dy++) for (let dx = 0; dx < selection.w; dx++) {
        if (mask[dy][dx] !== '1') continue;
        const px = x + dx * cellSize;
        const py = y + dy * cellSize;
        const selectedAt = (mx: number, my: number) => mask[my]?.[mx] === '1';
        gctx.beginPath();
        if (!selectedAt(dx, dy - 1)) { gctx.moveTo(px, py); gctx.lineTo(px + cellSize, py); }
        if (!selectedAt(dx + 1, dy)) { gctx.moveTo(px + cellSize, py); gctx.lineTo(px + cellSize, py + cellSize); }
        if (!selectedAt(dx, dy + 1)) { gctx.moveTo(px + cellSize, py + cellSize); gctx.lineTo(px, py + cellSize); }
        if (!selectedAt(dx - 1, dy)) { gctx.moveTo(px, py + cellSize); gctx.lineTo(px, py); }
        gctx.stroke();
      }
    } else {
      gctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
    }
    gctx.restore();

    if (transformMode) {
      const handles = selectionHandlePositions(selection);
      const rotation = handles.find((handle) => handle.handle === 'rotate');
      gctx.save();
      gctx.setLineDash([]);
      gctx.lineWidth = 2;
      if (rotation?.stemX !== undefined && rotation.stemY !== undefined) {
        gctx.strokeStyle = '#ffcd75';
        gctx.beginPath();
        gctx.moveTo(rotation.stemX * cellSize, rotation.stemY * cellSize);
        gctx.lineTo(rotation.x * cellSize, rotation.y * cellSize);
        gctx.stroke();
      }
      for (const handle of handles) {
        const handleX = handle.x * cellSize;
        const handleY = handle.y * cellSize;
        if (handle.handle === 'rotate') {
          gctx.fillStyle = '#38b764';
          gctx.strokeStyle = '#07070d';
          gctx.beginPath();
          gctx.arc(handleX, handleY, 6, 0, Math.PI * 2);
          gctx.fill();
          gctx.stroke();
        } else {
          gctx.fillStyle = '#f4f4f4';
          gctx.strokeStyle = '#33447f';
          gctx.fillRect(handleX - 4, handleY - 4, 8, 8);
          gctx.strokeRect(handleX - 4, handleY - 4, 8, 8);
        }
      }
      gctx.restore();
    }
  }

  if (($('showAnchors') as HTMLInputElement)?.checked) {
    const point = currentAnchor();
    if (point) {
      const x = point.x * density() * cellSize;
      const y = point.y * density() * cellSize;
      const radius = Math.max(4, Math.min(10, cellSize * 0.7));
      gctx.save();
      gctx.strokeStyle = '#ffcd75';
      gctx.lineWidth = 2;
      gctx.beginPath();
      gctx.moveTo(x - radius, y); gctx.lineTo(x + radius, y);
      gctx.moveTo(x, y - radius); gctx.lineTo(x, y + radius);
      gctx.stroke();
      gctx.fillStyle = '#07070d';
      gctx.fillRect(x - 2, y - 2, 4, 4);
      gctx.font = `${Math.max(10, Math.min(14, cellSize))}px monospace`;
      gctx.textBaseline = 'bottom';
      gctx.fillStyle = '#ffcd75';
      gctx.fillText(selectedAnchorName, x + radius + 3, y - 3);
      gctx.restore();
    }
  }
}

/* ---------------- composite preview ---------------- */

/**
 * Bumped whenever `file` changes (paint, undo, load...). The composite
 * re-bakes an edited weapon sheet into its registered visual lazily —
 * only when this moves — so painting stays cheap.
 */
let editVersion = 0;
let rebuiltVersion = -1;
let rebuiltKnightSignature = '';

function maybeRebakeEditedEquipment(): void {
  if (rebuiltVersion === editVersion) return;
  rebuiltVersion = editVersion;

  // Player.render reads the registered knight sprite, while the raw-sheet
  // preview reads the editor document directly. Rebuild the registered body
  // from the latest workspace document so those two preview routes cannot
  // disagree about pixels, layers, or hand anchors after unsaved edits.
  const knightFile = latestWorkingSprite(PLAYER_BODY_SPRITE_PATH);
  if (knightFile) {
    const knightSignature = JSON.stringify(knightFile);
    if (knightSignature !== rebuiltKnightSignature) {
      rebuildKnightSprite(knightFile);
      rebuiltKnightSignature = knightSignature;
      // Player copied the old anim set during construction; rebuild the
      // render-only mannequin so the shared draft appears immediately.
      posePlayer = null;
      posePlayerError = '';
    }
  }
  // "rusty-sword.json" -> visual id "rusty-sword"; a no-op for sheets
  // that aren't a registered sprite weapon.
  const id = currentFileName.replace(/\.json$/, '');
  rebuildSpriteWeapon(id, file);
  rebuildGearVisual(id, file);
}

/**
 * A knight to pose. She is constructed against no-op stand-ins for the
 * game and the tilemap: render() and poseAttack() draw and place — they
 * never simulate — so the only surfaces touched are the ones stubbed.
 * Built lazily and kept, so equipping gear or swapping weapons persists
 * between frames like it would in play.
 */
let posePlayer: Player | null = null;
let posePlayerError = '';

function getPosePlayer(): Player | null {
  if (posePlayer || posePlayerError) return posePlayer;
  try {
    const noop = () => {};
    const stubSfx = { play: noop };
    const stubGame = {
      input: { held: () => false, pressed: () => false, consumePress: () => false, axis: () => 0 },
      sfx: stubSfx,
      feel: { text: noop, impact: noop, shake: noop, sfx: stubSfx, particles: { burst: noop, clear: noop } },
      events: { emit: noop, on: () => noop },
      world: { actors: () => [], all: () => [], spawn: (e: unknown) => e },
      // beginAttack opens a strike on state entry; a hit-nothing stub.
      combat: { strike: () => ({ apply: () => [] }), hit: noop },
      camera: { x: 0, y: 0 },
    } as unknown as ConstructorParameters<typeof Player>[0];
    const stubCollision = {
      tileSize: 8,
      worldW: 10000,
      worldH: 10000,
      bounds: { x: 0, y: 0, w: 10000, h: 10000 },
      *solidsNear() { /* nothing to collide with */ },
      waterAt: () => false,
      submersion: () => 0,
      hazardAt: () => 0,
      groundY: () => 10000,
      tileAt: () => '',
    } as unknown as ConstructorParameters<typeof Player>[1];
    posePlayer = new Player(stubGame, stubCollision, 0, 0);
  } catch (e) {
    posePlayerError = String(e);
  }
  return posePlayer;
}

/**
 * A weapon's moveset, labeled the way a player thinks of it. The combo
 * swings and every contextual move usually share ONE sheet animation
 * ('attack'), differing in trail, timing, aim and body motion — which is
 * exactly why the composite needs a selector: the sheet alone cannot say
 * which move you are looking at.
 */
interface WeaponMoveView {
  key: string;
  label: string;
  def: ReturnType<typeof allAttacks>[number];
}

function movesOf(weaponId: string): WeaponMoveView[] {
  const type = weaponTypeOf(weapons.get(weaponId));
  const out: WeaponMoveView[] = [];
  type.attacks.forEach((def, i) => out.push({ key: `combo${i}`, label: `combo ${i + 1}`, def }));
  for (const key of ['aerial', 'plunge', 'upper', 'dashAttack'] as const) {
    const def = type[key];
    if (def) out.push({ key, label: key === 'dashAttack' ? 'dash' : key, def });
  }
  return out;
}

function selectedCombatMove(): { weaponId: string; typeId: string; move: WeaponMoveView } | null {
  const weaponId = ($('compWeapon') as HTMLSelectElement).value;
  if (!weaponId || !weapons.has(weaponId)) return null;
  const moves = movesOf(weaponId);
  const moveId = ($('combatMove') as HTMLSelectElement).value;
  const move = moves.find((candidate) => candidate.key === moveId) ?? moves[0];
  if (!move) return null;
  return { weaponId, typeId: weapons.get(weaponId).type, move };
}

function combatPanelActive(): boolean {
  return !$('right-combat').hidden;
}

function combatFrameCount(move: WeaponMoveView): number {
  const bodySelection = ($('compBody') as HTMLSelectElement).value;
  if (bodySelection === 'player') {
    const bodyAnim = KNIGHT_ANIMS.right[move.def.animation]
      ?? KNIGHT_ANIMS.right.attack
      ?? KNIGHT_ANIMS.right.idle;
    return Math.max(1, bodyAnim?.frames.length ?? 1);
  }

  const bodyFile = selectedWeaponBody(bodySelection)
    ?? (bodySelection === 'edited' && (file as EditorSpriteFile).editor?.canEquipWeapon ? file : null);
  if (bodyFile) {
    const timing = resolveAnimTiming(bodyFile, move.def.animation)
      ?? resolveAnimTiming(bodyFile, 'attack')
      ?? resolveAnimTiming(bodyFile, animName);
    if (timing) return Math.max(1, timing.frameCount);
  }

  const editedTiming = resolveAnimTiming(file, move.def.animation)
    ?? resolveAnimTiming(file, 'attack')
    ?? resolveAnimTiming(file, animName);
  return Math.max(1, editedTiming?.frameCount ?? anim().frames.length);
}

function syncCombatTimelineLabels(entry: WeaponCombatTuningEntry): void {
  const [start, end] = entry.activeFrames;
  $('combatActiveBand').style.left = `${((start - 1) / entry.frameCount) * 100}%`;
  $('combatActiveBand').style.width = `${((end - start + 1) / entry.frameCount) * 100}%`;
  $('combatActiveStartLabel').textContent = `start frame ${start}`;
  $('combatActiveEndLabel').textContent = `end frame ${end}`;
  $('combatFrameCountLabel').textContent = `${entry.frameCount} frames · one shared attack clock`;
}

function combatEntryFromMove(move: WeaponMoveView): WeaponCombatTuningEntry {
  const frameCount = combatFrameCount(move);
  const centerFrame = (progress: number): number => Math.max(
    1,
    Math.min(frameCount, Math.floor(progress * frameCount + 0.5) + 1),
  );
  const endFrame = (progress: number): number => Math.max(
    1,
    Math.min(frameCount, Math.ceil(progress * frameCount - 0.5)),
  );
  return {
    frameCount,
    activeFrames: [centerFrame(move.def.active[0]), endFrame(move.def.active[1])],
    hitbox: { ...move.def.hitbox },
  };
}

function combatEntryFor(
  typeId: string,
  move: WeaponMoveView,
): WeaponCombatTuningEntry {
  const fallback = combatEntryFromMove(move);
  const stored = weaponCombatTuning[typeId]?.moves[move.key];
  if (!stored) return fallback;
  const frameCount = fallback.frameCount;
  return {
    frameCount,
    activeFrames: [
      Math.max(1, Math.min(stored.activeFrames[0], frameCount)),
      Math.max(1, Math.min(stored.activeFrames[1], frameCount)),
    ],
    hitbox: { ...stored.hitbox },
  };
}

function refreshCombatPanel(): void {
  const select = $('combatMove') as HTMLSelectElement;
  const weaponId = ($('compWeapon') as HTMLSelectElement).value;
  const previous = select.value;
  select.innerHTML = '';
  const moves = weaponId && weapons.has(weaponId) ? movesOf(weaponId) : [];
  for (const move of moves) {
    const option = document.createElement('option');
    option.value = move.key;
    option.textContent = move.label;
    select.appendChild(option);
  }
  const animationMatch = moves.find((move) => move.def.animation === animName)?.key;
  const compositeMove = ($('compMove') as HTMLSelectElement).value;
  const wanted = compositeMove || previous || animationMatch;
  if (wanted && moves.some((move) => move.key === wanted)) select.value = wanted;
  const selection = selectedCombatMove();
  $('combatWeaponLabel').textContent = selection ? `${selection.weaponId} / ${selection.typeId}` : 'select a weapon in Compose';
  const controls = [
    'combatMove', 'combatFps', 'combatActiveStart', 'combatActiveEnd',
    'combatForward', 'combatY', 'combatW', 'combatH',
  ].map((id) => $(id) as HTMLInputElement | HTMLSelectElement);
  controls.forEach((control) => { control.disabled = !selection; });
  if (!selection) return;
  const entry = combatEntryFor(selection.typeId, selection.move);
  const sharedFps = weaponCombatTuning[selection.typeId]?.fps
    ?? entry.frameCount / selection.move.def.duration;
  ($('combatFps') as HTMLInputElement).value = String(sharedFps);
  for (const id of ['combatActiveStart', 'combatActiveEnd']) {
    const control = $(id) as HTMLInputElement;
    control.max = String(entry.frameCount);
  }
  ($('combatActiveStart') as HTMLInputElement).value = String(entry.activeFrames[0]);
  ($('combatActiveEnd') as HTMLInputElement).value = String(entry.activeFrames[1]);
  ($('combatAim') as HTMLSelectElement).value = selection.move.def.aim ?? 'forward';
  ($('combatForward') as HTMLInputElement).value = String(entry.hitbox.forward);
  ($('combatY') as HTMLInputElement).value = String(entry.hitbox.y);
  ($('combatW') as HTMLInputElement).value = String(entry.hitbox.w);
  ($('combatH') as HTMLInputElement).value = String(entry.hitbox.h);
  syncCombatTimelineLabels(entry);
}

function updateCombatTuningFromControls(): void {
  const selection = selectedCombatMove();
  if (!selection) return;
  const fps = ($('combatFps') as HTMLInputElement).valueAsNumber;
  const frameCount = combatFrameCount(selection.move);
  let start = Math.round(($('combatActiveStart') as HTMLInputElement).valueAsNumber);
  let end = Math.round(($('combatActiveEnd') as HTMLInputElement).valueAsNumber);
  const hitbox = {
    forward: ($('combatForward') as HTMLInputElement).valueAsNumber,
    y: ($('combatY') as HTMLInputElement).valueAsNumber,
    w: ($('combatW') as HTMLInputElement).valueAsNumber,
    h: ($('combatH') as HTMLInputElement).valueAsNumber,
  };
  if (!(fps > 0) || !Object.values(hitbox).every(Number.isFinite) || !(hitbox.w > 0) || !(hitbox.h > 0)) return;
  start = Math.max(1, Math.min(start, frameCount));
  end = Math.max(1, Math.min(end, frameCount));
  if (start > end) {
    const changedStart = document.activeElement === $('combatActiveStart');
    if (changedStart) end = start;
    else start = end;
  }
  const entry: WeaponCombatTuningEntry = { frameCount, activeFrames: [start, end], hitbox };
  const previous = weaponCombatTuning[selection.typeId];
  const moves = { ...(previous?.moves ?? {}) };
  // Grounded combo animations deliberately share one playback rate. Seed
  // their frame-native records together the first time the artist changes
  // that clock, so changing this one field cannot leave attack2/attack3 on
  // an older millisecond duration.
  for (const move of movesOf(selection.weaponId)) {
    if (move.key.startsWith('combo') && !moves[move.key]) {
      moves[move.key] = combatEntryFromMove(move);
    }
  }
  moves[selection.move.key] = entry;
  weaponCombatTuning[selection.typeId] = { fps, moves };
  replaceWeaponCombatTuning(selection.typeId, weaponCombatTuning[selection.typeId]);
  for (const id of ['combatActiveStart', 'combatActiveEnd']) {
    const control = $(id) as HTMLInputElement;
    control.max = String(frameCount);
  }
  ($('combatActiveStart') as HTMLInputElement).value = String(start);
  ($('combatActiveEnd') as HTMLInputElement).value = String(end);
  syncCombatTimelineLabels(entry);
  persistWeaponCombatDraft();
  updateBridgeStatus();
  schedulePreviewUpload();
}

/** Refill the move selector for the chosen weapon, keeping a still-valid
 * selection where possible. */
function rebuildMoveSelect(weaponId: string): void {
  const sel = $('compMove') as HTMLSelectElement;
  const prev = sel.value;
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'move: auto';
  sel.appendChild(auto);
  if (!weaponId || !weapons.has(weaponId)) return;
  for (const m of movesOf(weaponId)) {
    const o = document.createElement('option');
    o.value = m.key;
    o.textContent = `move: ${m.label}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/**
 * The attack hitbox overlay: dim while the box is merely placed, red
 * while the `active` window makes it real. Placement mirrors
 * Player.attackBox exactly — forward aims off the body's front edge
 * (facing right here), down off the feet, up off the head — so what the
 * panel shows is where the game would actually hit.
 */
interface CombatPreviewGeometry {
  body: { x: number; y: number; w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
  aim: 'forward' | 'up' | 'down';
  viewW: number;
  viewH: number;
}

let combatPreviewGeometry: CombatPreviewGeometry | null = null;
let combatPreviewActive = false;
let compositePreviewFrame: number | null = null;
const ATTACK_PREVIEW_CAP = 0.5;
const ATTACK_PREVIEW_HOLD = 0.35;

function attackPreviewClock(
  t: number,
  def: WeaponMoveView['def'],
  frameCount: number,
  pausedFrame?: number,
): { progress: number; live: boolean; frame: number; time: number } {
  const duration = Math.max(1 / 120, Math.min(def.duration, ATTACK_PREVIEW_CAP));
  if (pausedFrame !== undefined) {
    const frame = Math.max(0, Math.min(pausedFrame, frameCount - 1));
    const progress = (frame + 0.5) / frameCount;
    return { progress, live: true, frame, time: progress * duration };
  }
  const time = t % (duration + ATTACK_PREVIEW_HOLD);
  const live = time < duration;
  const progress = live ? Math.min(1, time / duration) : 1;
  const frame = Math.min(Math.floor(Math.min(progress, 0.999999) * frameCount), frameCount - 1);
  return { progress, live, frame, time };
}

function attackRect(
  def: ReturnType<typeof allAttacks>[number],
  body: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const hb = def.hitbox;
  const aim = def.aim ?? 'forward';
  const cx = body.x + body.w / 2;
  return aim === 'down'
    ? { x: cx - hb.w / 2, y: body.y + body.h + hb.forward, w: hb.w, h: hb.h }
    : aim === 'up'
      ? { x: cx - hb.w / 2, y: body.y - hb.forward - hb.h, w: hb.w, h: hb.h }
      : { x: body.x + body.w + hb.forward, y: body.y + body.h / 2 - hb.h / 2 + hb.y, w: hb.w, h: hb.h };
}

function drawAttackBox(
  g: CanvasRenderingContext2D,
  def: ReturnType<typeof allAttacks>[number],
  body: { x: number; y: number; w: number; h: number },
  progress: number,
): void {
  const rect = attackRect(def, body);
  const live = progress > def.active[0] && progress < def.active[1];
  g.save();
  g.strokeStyle = live ? '#ff4444' : '#566c86';
  g.globalAlpha = live ? 0.9 : 0.45;
  g.lineWidth = 0.5;
  g.strokeRect(rect.x + 0.25, rect.y + 0.25, rect.w - 0.5, rect.h - 0.5);
  if (live) {
    g.fillStyle = '#ff4444';
    g.globalAlpha = 0.15;
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  g.restore();
}

/** Equip exactly `id` in `slot`, adding to the bag on first use. */
function ensureEquipped(p: Player, slot: string, id: string | null): void {
  if (p.equipment.get(slot) === id) return;
  if (id === null) {
    p.equipment.unequip(slot);
  } else {
    if (!p.inventory.has(id)) p.inventory.add(id);
    p.equipment.equip(id);
  }
  p.syncStats();
}

/**
 * Player.render derives its locomotion animation from physics state instead
 * of accepting an animation name. The editor does not simulate physics, so
 * explicitly pose the mannequin to the state represented by the selected
 * animation. Without this, a newly constructed mannequin remains airborne:
 * an `idle` preview then draws the body's `air` anchors while the raw-sheet
 * preview correctly draws `idle`.
 */
function posePlayerLocomotion(p: Player, animation: string): void {
  p.vx = 0;
  p.vy = 0;
  switch (animation) {
    case 'run':
      p.onGround = true;
      p.vx = 120;
      break;
    case 'rise':
      p.onGround = false;
      p.vy = -120;
      break;
    case 'fall':
      p.onGround = false;
      p.vy = 120;
      break;
    case 'air':
      p.onGround = false;
      break;
    default:
      // Attack sheets and equipment-only animations use the neutral grounded
      // body unless the selected move below explicitly poses an attack.
      p.onGround = true;
      break;
  }
}

/** The body is the authority for a neutral composite's frame clock. */
function resolveCompositeBodyClock(bodySelection: string, requestedAnimation = animName) {
  const selectedBody = selectedWeaponBody(bodySelection);
  const bodyFile = selectedBody ?? file;
  const requestedBodyAnim = resolveAnim(bodyFile, requestedAnimation)
    ? requestedAnimation
    : requestedAnimation !== 'attack' && resolveAnim(bodyFile, 'attack')
      ? 'attack'
    : resolveAnim(bodyFile, 'idle')
      ? 'idle'
      : Object.keys(bodyFile.anims)[0];
  const bodyAnim = resolveAnim(bodyFile, requestedBodyAnim);
  const fullPlayerAnim = bodySelection === 'player'
    ? KNIGHT_ANIMS.right[requestedAnimation]
      ?? KNIGHT_ANIMS.right.attack
      ?? KNIGHT_ANIMS.right.idle
      ?? Object.values(KNIGHT_ANIMS.right)[0]
    : undefined;
  const renderedAnim = fullPlayerAnim ?? bodyAnim;
  const fps = renderedAnim?.fps || 1;
  const frameCount = Math.max(1, renderedAnim?.frames.length ?? 1);
  return {
    bodyFile,
    requestedBodyAnim,
    bodyAnim,
    fps,
    frameCount,
    loop: renderedAnim?.loop !== false,
    cycle: frameCount / fps,
  };
}

/**
 * The joint view: body + held weapon + attack trail on one clock,
 * drawn by the same code the game uses (see Player.render — body at a
 * feet origin, weapon inside that transform, trail in world space).
 *
 * One cycle = the attack's frame count / shared combat FPS plus a beat of
 * hold. Asset-local FPS values never create a second attack clock.
 */
function renderComposite(t: number, pausedFrame?: number): boolean {
  combatPreviewGeometry = null;
  combatPreviewActive = false;
  compositePreviewFrame = null;
  const weaponId = ($('compWeapon') as HTMLSelectElement).value;
  const hasWeapon = Boolean(weaponId && weapons.has(weaponId));
  const bodySel = ($('compBody') as HTMLSelectElement).value;
  // A full player is useful without a weapon when editing armor. Raw
  // edited/knight sheets only become a composite when a weapon is chosen.
  if (!hasWeapon && bodySel !== 'player') return false;
  const a = anim();
  if (!a || !a.frames.length) return false;

  const wdef = hasWeapon ? weapons.get(weaponId) : null;
  const moves = hasWeapon ? movesOf(weaponId) : [];
  // A move is a candidate when its animation is the one on screen — or
  // when its animation is MISSING from the sheet and the screen shows
  // 'attack', the pattern it falls back to in game. So the base swing
  // still previews every un-arted move via the selector, and a move
  // gains its own art the moment its animation exists.
  const sheetHas = (name: string) => !!wdef && !!weaponVisuals.get(wdef.visual).animations?.includes(name);
  const candidates = moves.filter((m) =>
    m.def.animation === animName || (animName === 'attack' && !sheetHas(m.def.animation)));
  const wantKey = ($('compMove') as HTMLSelectElement).value;
  const move = candidates.find((m) => m.key === wantKey) ?? candidates[0];
  const atkDef = move?.def;
  // Neutral equipment is frame-aligned to the selected body, so the body
  // owns the preview frame set. A move without dedicated body art falls back
  // to the base attack sheet, never to idle.
  const bodyClock = resolveCompositeBodyClock(bodySel, atkDef?.animation ?? animName);
  const {
    bodyFile,
    requestedBodyAnim,
    bodyAnim,
    fps: bodyFps,
    frameCount: bodyFrameCount,
    cycle: bodyCycle,
  } = bodyClock;
  // Long moves are time-compressed. The plunge's 0.9s duration is a
  // MAXIMUM — in play the landing cuts it short — so previewed raw it
  // is three-quarters of a second of nothing moving. Compression sweeps
  // the full progress on a shorter wall clock; every trail and pose
  // clock is a fraction of progress, so the whole move scales together.
  // The label owns up to it with an xN tag.
  const realDur = atkDef?.duration ?? 0;
  const speedup = realDur > ATTACK_PREVIEW_CAP ? realDur / ATTACK_PREVIEW_CAP : 1;
  const moveTag = move ? ` [${move.label}${speedup > 1 ? ` x${speedup.toFixed(1)}` : ''}]` : '';
  // When the previewed anim isn't one this weapon attacks WITH, say
  // where the attack lives instead of only that it's absent.
  const noAttackHint = !hasWeapon || atkDef
    ? ''
    : `  (attacks play on: ${[...new Set(moves.map((m) => m.def.animation))].join(', ') || 'none'})`;

  // Authored FPS is now the one combat clock. Body, weapon, trail, hitbox,
  // timeline label, and stepping all consume this same progress. The quiet
  // beat after a move holds its final pose; it does not restart a sheet whose
  // local animation metadata happens to be shorter.
  const attackClock = atkDef
    ? attackPreviewClock(t, atkDef, bodyFrameCount, pausedFrame)
    : null;
  const tIn = attackClock?.time ?? (t % bodyCycle);
  const pose = atkDef && attackClock
    ? { progress: attackClock.progress, def: atkDef }
    : undefined;
  const attackLive = attackClock?.live ?? false;
  combatPreviewActive = Boolean(
    pose && attackLive
    && pose.progress > pose.def.active[0]
    && pose.progress < pose.def.active[1]
  );
  compositePreviewFrame = attackClock?.frame ?? null;

  // Game parity: the game draws a world pixel at 8 screen px (ZOOM 4 x
  // WORLD_ZOOM 2), and judging attack art at any other size is judging
  // different art. The viewport is trimmed to what the widest swing (the
  // dash trail, ~24px around the origin) actually needs, and the side
  // panel widens while the composite is active to hold it.
  const SCALE = 8;
  const VW = 52, VH = 42;
  const fx = VW / 2, fy = 34;
  preview.width = VW * SCALE;
  preview.height = VH * SCALE;
  pctx.imageSmoothingEnabled = false;
  drawTransparencyChecker(pctx, preview.width, preview.height);
  pctx.save();
  pctx.scale(SCALE, SCALE);
  // Ground line, so the feet anchor reads.
  pctx.fillStyle = '#1f2a57';
  pctx.fillRect(0, fy, VW, 1);

  // The full player: everything Player.render owns — body-english,
  // gear layers, held weapon, trail — posed at this progress.
  if (bodySel === 'player') {
    const p = getPosePlayer();
    if (p) {
      ensureEquipped(p, 'weapon', hasWeapon ? weaponId : null);
      const gearOn = ($('compGear') as HTMLInputElement).checked;
      ensureEquipped(p, 'helmet', gearOn ? 'iron-helmet' : null);
      ensureEquipped(p, 'armor', gearOn ? 'steel-armor' : null);
      p.facing = 1;
      posePlayerLocomotion(p, animName);
      p.animT = tIn;
      p.renderTrail = attackLive && ($('compTrail') as HTMLInputElement).checked;
      p.poseAttack(pose ? pose.def : null, pose ? pose.progress : 0);
      p.x = fx - p.w / 2;
      p.y = fy - p.h;
      if (atkDef) {
        const body = { x: p.x, y: p.y, w: p.w, h: p.h };
        combatPreviewGeometry = {
          body,
          rect: attackRect(atkDef, body),
          aim: atkDef.aim ?? 'forward',
          viewW: VW,
          viewH: VH,
        };
      }
      try {
        p.render(pctx);
      } catch (e) {
        posePlayerError = String(e);
      }
      // The player's own box math is the truth; draw straight from it.
      if (pose && attackLive && ($('compHitbox') as HTMLInputElement).checked) {
        drawAttackBox(pctx, pose.def, { x: p.x, y: p.y, w: p.w, h: p.h }, pose.progress);
      }
      pctx.restore();
      pctx.fillStyle = '#ffcd75';
      pctx.font = '11px monospace';
      pctx.fillText(
        posePlayerError
          ? 'player render failed: ' + posePlayerError.slice(0, 40)
          : `${animName}${moveTag}${hasWeapon ? ` + ${weaponId}` : ''} (full player)${noAttackHint}`,
        6, preview.height - 6,
      );
      return true;
    }
    // Construction failed: fall back to the sheet body, but say why.
    pctx.restore();
    pctx.fillStyle = '#b13e53';
    pctx.font = '11px monospace';
    pctx.fillText('player unavailable: ' + posePlayerError.slice(0, 44), 6, preview.height - 6);
    return true;
  }

  // Body: the sheet being edited, or the registered knight when the
  // edited sheet is the weapon itself. Draw size comes from the sprite's
  // DECLARED geometry (knight art is 35x63 cells drawn at 10x18), never
  // from the baked image — the game scales exactly the same way.
  let bodyImg: HTMLCanvasElement;
  let frame: number;
  let dw: number;
  let dh: number;
  if (!bodyAnim?.frames.length) {
    pctx.restore();
    return false;
  }
  frame = attackClock
    ? Math.min(attackClock.frame, bodyAnim.frames.length - 1)
    : pausedFrame === undefined
      ? bodyAnim.loop === false
        ? Math.min(Math.floor(tIn * bodyFps), bodyAnim.frames.length - 1)
        : Math.floor(tIn * bodyFps) % bodyAnim.frames.length
      : Math.min(pausedFrame, bodyAnim.frames.length - 1);
  if (compositePreviewFrame === null) compositePreviewFrame = frame;
  const rows = bodyAnim.frames[frame] ?? [];
  const bodyGeometry = geometryOf(bodyFile, rows);
  dw = bodyGeometry.w;
  dh = bodyGeometry.h;
  if (atkDef) {
    const body = { x: fx - dw / 2, y: fy - dh, w: dw, h: dh };
    combatPreviewGeometry = {
      body,
      rect: attackRect(atkDef, body),
      aim: atkDef.aim ?? 'forward',
      viewW: VW,
      viewH: VH,
    };
  }

  pctx.save();
  pctx.translate(fx, fy);
  // Attachment points are authored from the sheet's top-left, while
  // held-weapon renderers work from the player's feet-centred origin.
  // Feed the raw-sheet composite the same converted hand anchors that
  // Player.render uses; otherwise it silently falls back to a generic
  // hand position and cannot reveal handedness mistakes in draft art.
  const sheetAnchor = (name: string): { x: number; y: number } | undefined => {
    const concreteBodyAnim = concreteAnimNameOf(bodyFile, requestedBodyAnim);
    const point = bodyFile.anchors?.[name]?.[concreteBodyAnim]?.[frame];
    return point ? { x: point.x - dw / 2, y: point.y - dh } : undefined;
  };
  // The weapon draw needs an animation its sheet actually has; outside
  // an attack pose, fall back to idle rather than throwing mid-paint.
  const known = weaponVisuals.get(wdef!.visual).animations;
  const weaponAnim = !known || known.includes(animName) ? animName : 'idle';
  const weaponContext = {
    facing: 1 as const, anim: weaponAnim, frame, animT: tIn,
    bodyW: dw, bodyH: dh,
    frontHand: sheetAnchor('frontHand'),
    rearHand: sheetAnchor('rearHand'),
    // A paused authoring preview is frame-addressed, not time-addressed.
    // Leaving the attack pose attached here made spriteWeapon() remap the
    // selected frame through the move's real duration (for example, frame 2
    // of a six-frame 12fps sheet became frame 4 of a 0.16s attack). During
    // playback the real attack clock remains authoritative; while paused,
    // omitting it makes the weapon follow this explicit body/frame index.
    attack: pausedFrame === undefined ? pose : undefined,
  };
  const bodyLayerVisible = (layer: SpriteLayerData): boolean => (
    bodyFile !== file
      || (soloLayerId ? layer.id === soloLayerId : !hiddenLayerIds.has(layer.id))
  );
  const bodyRowsForTag = (tag: string): string[] | undefined => {
    if (!isLayeredSpriteFile(bodyFile)) {
      return tag === defaultLayerTag(bodyFile) ? rows : undefined;
    }
    if (!bodyFile.layers.some((layer) => layer.tag === tag && bodyLayerVisible(layer))) return undefined;
    return compositeSpriteFrame(
      bodyFile,
      requestedBodyAnim,
      frame,
      PAL,
      (layer) => layer.tag === tag && bodyLayerVisible(layer),
    );
  };

  // Raw-sheet previews must use the same shared render-band order as
  // Player.render. Flattening the body first and drawing the weapon last
  // hid authored overlays such as a front hand intended to cover its grip.
  for (const tag of renderTagIds()) {
    const tagRows = bodyRowsForTag(tag);
    if (tagRows) {
      bodyImg = sprite(
        bodyFile.hd === false ? tagRows : epx(epx(tagRows)),
        bodyFile.palette ?? PAL,
      );
      pctx.drawImage(bodyImg, -dw / 2, -dh, dw, dh);
    }
    try {
      drawHeldWeaponTag(pctx, wdef!.visual, weaponContext, tag);
    } catch { /* a half-painted sheet mid-edit; next frame will catch up */ }
  }
  pctx.restore();

  if (pose && attackLive && ($('compTrail') as HTMLInputElement).checked) {
    try {
      drawWeaponTrail(pctx, wdef!.visual, {
        x: fx, y: fy - dh * 0.45, facing: 1,
        colors: [...wdef!.colors], attack: pose,
      });
    } catch { /* ditto */ }
  }
  // dw/dh are the sprite's DECLARED physical dims (see above), which is
  // the body the game's box math would use.
  if (pose && attackLive && ($('compHitbox') as HTMLInputElement).checked) {
    drawAttackBox(pctx, pose.def, { x: fx - dw / 2, y: fy - dh, w: dw, h: dh }, pose.progress);
  }
  pctx.restore();

  pctx.fillStyle = '#ffcd75';
  pctx.font = '11px monospace';
  pctx.fillText(
    `${animName}${moveTag} + ${weaponId}${noAttackHint}`,
    6, preview.height - 6,
  );
  return true;
}

function currentPreviewTiming(): { fps: number; frameCount: number; loop: boolean } {
  const bodySelection = ($('compBody') as HTMLSelectElement).value;
  const weaponId = ($('compWeapon') as HTMLSelectElement).value;
  if ((weaponId && weapons.has(weaponId)) || bodySelection === 'player') {
    const clock = resolveCompositeBodyClock(bodySelection, selectedCombatMove()?.move.def.animation ?? animName);
    return { fps: clock.fps, frameCount: clock.frameCount, loop: clock.loop };
  }
  const a = anim();
  return {
    fps: a?.fps || 1,
    frameCount: Math.max(1, a?.frames.length ?? 1),
    loop: a?.loop !== false,
  };
}

function previewFrameAt(t: number, timing: ReturnType<typeof currentPreviewTiming>): number {
  const raw = Math.floor(t * timing.fps);
  return timing.loop
    ? ((raw % timing.frameCount) + timing.frameCount) % timing.frameCount
    : Math.min(raw, timing.frameCount - 1);
}

function updateCombatHitboxOverlay(): void {
  const overlay = $('combatHitboxOverlay');
  const geometry = combatPreviewGeometry;
  if (!combatPanelActive() || !geometry || !selectedCombatMove()) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  overlay.classList.toggle('active', combatPreviewActive);
  overlay.style.left = `${geometry.rect.x / geometry.viewW * 100}%`;
  overlay.style.top = `${geometry.rect.y / geometry.viewH * 100}%`;
  overlay.style.width = `${geometry.rect.w / geometry.viewW * 100}%`;
  overlay.style.height = `${geometry.rect.h / geometry.viewH * 100}%`;
}

interface CombatHitboxDrag {
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  geometry: CombatPreviewGeometry;
  hitbox: WeaponCombatTuningEntry['hitbox'];
}

let combatHitboxDrag: CombatHitboxDrag | null = null;

function setCombatHitboxFields(hitbox: WeaponCombatTuningEntry['hitbox']): void {
  ($('combatForward') as HTMLInputElement).value = String(Math.round(hitbox.forward * 4) / 4);
  ($('combatY') as HTMLInputElement).value = String(Math.round(hitbox.y * 4) / 4);
  ($('combatW') as HTMLInputElement).value = String(Math.round(hitbox.w * 4) / 4);
  ($('combatH') as HTMLInputElement).value = String(Math.round(hitbox.h * 4) / 4);
  updateCombatTuningFromControls();
}

$('combatHitboxOverlay').addEventListener('pointerdown', (event) => {
  const pointer = event as PointerEvent;
  const selected = selectedCombatMove();
  if (!selected || !combatPreviewGeometry) return;
  const mode = (pointer.target as HTMLElement).dataset.combatHandle === 'resize' ? 'resize' : 'move';
  combatHitboxDrag = {
    mode,
    pointerId: pointer.pointerId,
    startX: pointer.clientX,
    startY: pointer.clientY,
    geometry: structuredClone(combatPreviewGeometry),
    hitbox: { ...selected.move.def.hitbox },
  };
  ($('combatHitboxOverlay') as HTMLElement).setPointerCapture(pointer.pointerId);
  pointer.preventDefault();
});

$('combatHitboxOverlay').addEventListener('pointermove', (event) => {
  const pointer = event as PointerEvent;
  const drag = combatHitboxDrag;
  if (!drag || pointer.pointerId !== drag.pointerId) return;
  const bounds = preview.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const dx = (pointer.clientX - drag.startX) * drag.geometry.viewW / bounds.width;
  const dy = (pointer.clientY - drag.startY) * drag.geometry.viewH / bounds.height;
  const next = { ...drag.hitbox };
  if (drag.mode === 'move') {
    if (drag.geometry.aim === 'forward') {
      next.forward += dx;
      next.y += dy;
    } else {
      next.forward += drag.geometry.aim === 'up' ? -dy : dy;
    }
  } else {
    next.w = Math.max(0.25, drag.hitbox.w + dx);
    next.h = Math.max(0.25, drag.hitbox.h + dy);
    if (drag.geometry.aim === 'forward') {
      // Keep the top edge under the pointer while resizing the centered box.
      next.y += (next.h - drag.hitbox.h) / 2;
    }
  }
  setCombatHitboxFields(next);
  pointer.preventDefault();
});

function finishCombatHitboxDrag(event: Event): void {
  const pointer = event as PointerEvent;
  if (!combatHitboxDrag || pointer.pointerId !== combatHitboxDrag.pointerId) return;
  combatHitboxDrag = null;
}

$('combatHitboxOverlay').addEventListener('pointerup', finishCombatHitboxDrag);
$('combatHitboxOverlay').addEventListener('pointercancel', finishCombatHitboxDrag);

function renderPreview(): void {
  maybeRebakeEditedEquipment();
  const hd = ($('hd') as HTMLInputElement).checked;
  const p = pal();
  const a = visibleAnim();
  // Editing is frame-oriented: the game-scale preview must show the frame
  // selected in the grid unless the author explicitly asks to play the
  // animation. Previously the preview always ran on wall-clock time, so its
  // body, reference, and weapon anchors rarely matched the frame being edited.
  const previewPlaying = ($('previewPlay') as HTMLInputElement).checked;
  const timing = currentPreviewTiming();
  const pausedFrame = previewStepping
    ? ((previewStepFrame % timing.frameCount) + timing.frameCount) % timing.frameCount
    : Math.min(frameIdx, timing.frameCount - 1);
  const t = previewPlaying ? performance.now() / 1000 : pausedFrame / timing.fps;
  const composite = renderComposite(t, previewPlaying ? undefined : pausedFrame);
  const displayedFrame = previewPlaying
    ? (compositePreviewFrame ?? previewFrameAt(t, timing))
    : pausedFrame;
  previewDisplayedFrame = displayedFrame;
  $('previewFrame').textContent = `${displayedFrame + 1}/${timing.frameCount}`;
  updateCombatHitboxOverlay();
  const context = $('previewContext');
  if (composite) {
    const weapon = ($('compWeapon') as HTMLSelectElement).value || 'no weapon';
    const bodySelect = $('compBody') as HTMLSelectElement;
    const body = bodySelect.selectedOptions[0]?.textContent?.replace(/^body:\s*/, '') ?? bodySelect.value;
    const moveSelect = $('compMove') as HTMLSelectElement;
    const move = moveSelect.value
      ? moveSelect.selectedOptions[0]?.textContent?.replace(/^move:\s*/, '')
      : undefined;
    context.textContent = [animName, weapon, body, move].filter(Boolean).join(' · ');
  } else {
    context.textContent = `${animName} · sprite`;
  }
  // The preview is persistent across workspace tabs, so its composite
  // determines the panel width regardless of which editor panel is open.
  $('side-right').classList.toggle('wide', composite);
  if (composite) {
    requestAnimationFrame(renderPreview);
    return;
  }

  if (!a || !a.frames.length) {
    requestAnimationFrame(renderPreview);
    return;
  }

  const idx = displayedFrame;
  const rows = a.frames[idx] ?? [];

  const { w, h, hitbox } = geometryOf(file, rows);

  const displayW = w * 8; // scaled by ZOOM (4) * WORLD_ZOOM (2) = 8
  const displayH = h * 8;

  preview.width = displayW + 16;
  preview.height = displayH + 24;

  pctx.imageSmoothingEnabled = false;
  drawTransparencyChecker(pctx, preview.width, preview.height);

  // Draw active animation text label
  pctx.fillStyle = 'rgba(7, 7, 13, 0.78)';
  pctx.fillRect(0, 0, preview.width, 20);
  pctx.fillStyle = '#ffcd75';
  pctx.font = '11px monospace';
  pctx.fillText(`${animName}  ${a.fps}fps`, 8, 16);

  const isHighRes = file.hd === false;
  const drawRows = (isHighRes || !hd) ? rows : epx(epx(rows));
  const img = sprite(drawRows, p);

  const x = 8;
  const y = 20;

  // Draw reference sprite behind current frame if enabled
  const showRef = ($('showRef') as HTMLInputElement)?.checked ?? true;
  if (refFile && showRef) {
    const refAnim = resolveAnim(refFile, animName in refFile.anims ? animName : Object.keys(refFile.anims)[0]);
    if (refAnim) {
      const refIdx = refAnim.frames.length
        ? previewPlaying
          ? Math.floor(t * (refAnim.fps || 1)) % refAnim.frames.length
          : Math.min(displayedFrame, refAnim.frames.length - 1)
        : 0;
      const refRows = refAnim.frames[refIdx] ?? [];

      const refGeometry = geometryOf(refFile, refRows);
      const refIsHighRes = refFile.hd === false;
      const refDrawRows = (refIsHighRes || !hd) ? refRows : epx(epx(refRows));
      const refImg = sprite(refDrawRows, refFile.palette ?? PAL);

      pctx.save();
      pctx.globalAlpha = 0.3;
      pctx.drawImage(refImg, x, y, refGeometry.w * 8, refGeometry.h * 8);
      pctx.restore();
    }
  }

  // Draw active sprite frame
  pctx.drawImage(img, x, y, w * 8, h * 8);

  // Draw hitbox border (if enabled)
  if (($('showHitbox') as HTMLInputElement).checked) {
    pctx.save();
    pctx.strokeStyle = 'rgba(255, 68, 68, 0.85)';
    pctx.lineWidth = 1;
    const hx = x + hitbox.x * 8;
    const hy = y + hitbox.y * 8;
    const hw = hitbox.w * 8;
    const hh = hitbox.h * 8;
    pctx.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);
    pctx.restore();
  }
  requestAnimationFrame(renderPreview);
}

/* ---------------- io ---------------- */

function syncIO(): void {
  ($('io') as HTMLTextAreaElement).value = JSON.stringify(file, null, 2);
  ($('w') as HTMLInputElement).value = String(W());
  ($('h') as HTMLInputElement).value = String(H());

  const geometry = geometryOf(file, cur());
  ($('physW') as HTMLInputElement).value = String(geometry.w);
  ($('physH') as HTMLInputElement).value = String(geometry.h);
  ($('boxX') as HTMLInputElement).value = String(geometry.hitbox.x);
  ($('boxY') as HTMLInputElement).value = String(geometry.hitbox.y);
  ($('boxW') as HTMLInputElement).value = String(geometry.hitbox.w);
  ($('boxH') as HTMLInputElement).value = String(geometry.hitbox.h);
}

$('btnExport').onclick = () => {
  syncIO();
  navigator.clipboard?.writeText(($('io') as HTMLTextAreaElement).value);
  flash('copied to clipboard');
};

// Load a .json sprite file straight from disk.
$('btnLoad').onclick = () => ($('fileInput') as HTMLInputElement).click();
($('fileInput') as HTMLInputElement).onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      rememberActiveLayer();
      file = normalize(JSON.parse(String(reader.result)));
      animName = Object.keys(file.anims)[0];
      frameIdx = 0;
      currentChar = firstPaintChar();
      currentFileName = f.name;
      currentRepoPath = null;
      restoreActiveLayer(null, file);
      editVersion++;
      undoStack.length = 0;
      redoStack.length = 0;
      updateUndoRedoButtons();
      refreshUI();
      fitGrid();
      flash(`loaded ${f.name}`);
      ($('selectSprite') as HTMLSelectElement).value = ''; // clear dropdown
    } catch (err) {
      flash(`load failed: ${(err as Error).message}`);
    }
  };
  reader.readAsText(f);
  input.value = ''; // allow re-loading the same file
};

$('selectSprite').onchange = async (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (!val) return;
  if (await openSharedSprite(val)) return;
  // A connected bridge returning false refused the switch to protect dirty
  // shared work. Do not then load a local copy anyway: that would make the
  // picker, canvas, preview, and bridge each describe different sprites.
  if (bridgeConnected) return;
  try {
    rememberActiveLayer();
    file = existingSprite(val);
    animName = Object.keys(file.anims)[0];
    frameIdx = 0;
    currentChar = firstPaintChar();
    editVersion++;

    const parts = val.split('/');
    currentFileName = parts[parts.length - 1];
    currentRepoPath = val;
    restoreActiveLayer(val, file);

    configureCompositeForPath(val);

    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoRedoButtons();
    refreshUI();
    fitGrid();
    flash(`loaded ${val}`);
  } catch (err) {
    flash(`load failed: ${(err as Error).message}`);
  }
};

// Save the current sprite as a downloadable .json.
$('btnSave').onclick = () => {
  syncIO();
  const blob = new Blob([($('io') as HTMLTextAreaElement).value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentFileName;
  a.click();
  URL.revokeObjectURL(a.href);
  flash('saved');
};

$('btnImport').onclick = () => {
  try {
    const raw = JSON.parse(($('io') as HTMLTextAreaElement).value);
    saveHistory();
    file = normalize(raw);
    animName = Object.keys(file.anims)[0];
    frameIdx = 0;
    currentChar = firstPaintChar();
    refreshUI();
    flash('imported');
  } catch (err) {
    flash(`import failed: ${(err as Error).message}`);
  }
};

/** Accept the SpriteFile format, or the older { palette, frames, fps }. */
function normalize(raw: unknown): SpriteFile {
  const r = raw as Record<string, unknown>;
  if (r && typeof r === 'object' && r.anims) {
    const f = r as unknown as SpriteFile;
    if (!f.anims || !Object.keys(f.anims).length) throw new Error('no animations');
    const normalized = { ...f, hd: f.hd ?? true, palette: f.palette ?? { ...PAL } };
    if (isLayeredSpriteFile(normalized)) {
      // Drafts created by the first layer-system release predate render tags.
      // Give them the role default once, then every saved layer is explicit.
      for (const layer of normalized.layers) layer.tag ||= defaultLayerTag(normalized);
      validateLayeredSpriteFile(normalized);
      for (const layer of normalized.layers) {
        if (!hasRenderTag(layer.tag)) throw new Error(`sprite layer "${layer.id}" uses unknown player render tag "${layer.tag}"`);
      }
    }
    geometryOf(normalized, resolveAnim(normalized, Object.keys(normalized.anims)[0])?.frames[0] ?? []);
    return normalized;
  }
  if (r && Array.isArray(r.frames)) {
    return {
      hd: true,
      palette: (r.palette as Palette) ?? { ...PAL },
      anims: { idle: { fps: Number(r.fps) || 8, frames: r.frames as string[][] } },
    };
  }
  throw new Error('unrecognized sprite json');
}

/* ---------------- tools & reference & nudge ---------------- */

function updateToolUI(): void {
  const visibleTool: EditorTool = altPickerActive ? 'picker' : currentTool;
  $('btnToolDraw').classList.toggle('active', visibleTool === 'draw');
  $('btnToolBrush').classList.toggle('active', visibleTool === 'brush');
  $('btnToolBlur').classList.toggle('active', visibleTool === 'blur');
  $('btnToolFill').classList.toggle('active', visibleTool === 'fill');
  $('btnToolPicker').classList.toggle('active', visibleTool === 'picker');
  $('btnToolSelect').classList.toggle('active', visibleTool === 'select');
  $('btnToolMagic').classList.toggle('active', visibleTool === 'magic');
  grid.classList.toggle('selecting', visibleTool === 'select' && !transformMode);
  grid.classList.toggle('magic-selecting', visibleTool === 'magic' && !transformMode);
  grid.classList.toggle('selection-transforming', transformMode);
  grid.classList.toggle('picking', visibleTool === 'picker');
  grid.classList.toggle('soft-tool', visibleTool === 'brush' || visibleTool === 'blur');
  if (!transformMode) {
    grid.classList.remove('selection-movable');
    grid.style.cursor = '';
  } else if (!selectionHandleTransform) {
    grid.style.cursor = 'default';
  }
  updateSelectionModifierCursor();
  const hasSize = !transformMode && (currentTool === 'brush' || currentTool === 'blur');
  const hasMagic = currentTool === 'magic' && !transformMode;
  const hasFill = currentTool === 'fill' && !transformMode;
  const hasTransform = transformMode;
  $('brushSizeConfig').hidden = !hasSize;
  $('magicConfig').hidden = !hasMagic;
  $('fillConfig').hidden = !hasFill;
  $('transformConfig').hidden = !hasTransform;
  $('toolConfigEmpty').hidden = hasSize || hasMagic || hasFill || hasTransform;
  $('toolConfigTitle').textContent = hasSize
    ? `${currentTool === 'brush' ? 'soft brush' : 'blur'} settings`
    : hasMagic ? 'magic selection settings'
      : hasFill ? 'fill settings'
        : hasTransform ? 'transform selection' : 'tool settings';
  $('brushSizeLabel').textContent = currentTool === 'blur' ? 'blur size' : 'brush size';
  $('toolConfigHint').textContent = currentTool === 'blur'
    ? 'Averages neighboring colors at the center and feathers the effect toward the edge.'
    : 'The solid center overwrites color; the soft edge blends into neighboring pixels.';
  updateSelectionTransformControls();
  updateBrushCursor();
}

function updateSelectionTransformControls(): void {
  const toggle = $('transformMode') as HTMLInputElement;
  toggle.disabled = !selection;
  toggle.checked = Boolean(selection) && transformMode;
  const enabled = Boolean(selection) && transformMode;
  for (const id of [
    'btnRotateSelectionLeft', 'btnRotateSelectionRight', 'btnRotateSelection', 'btnResizeSelection',
    'btnNudgeLeft', 'btnNudgeRight', 'btnNudgeUp', 'btnNudgeDown',
  ]) {
    ($(id) as HTMLButtonElement).disabled = !enabled;
  }
  ($('selectionW') as HTMLInputElement).disabled = !enabled;
  ($('selectionH') as HTMLInputElement).disabled = !enabled;
  ($('selectionAngle') as HTMLInputElement).disabled = !enabled;
}

function updateSelectionModifierCursor(keys?: { shiftKey: boolean; altKey: boolean }): void {
  if (keys) selectionModifierKeys = { shiftKey: keys.shiftKey, altKey: keys.altKey };
  const selectionTool = !transformMode && (currentTool === 'select' || currentTool === 'magic');
  const mode = selectionTool ? selectionCombineMode(selectionModifierKeys) : 'replace';
  grid.classList.toggle('selection-add', mode === 'add');
  grid.classList.toggle('selection-subtract', mode === 'subtract');
  grid.classList.toggle('selection-intersect', mode === 'intersect');
  if (mode !== 'replace') {
    grid.classList.remove('selection-movable');
    grid.style.cursor = '';
  } else if (currentTool === 'select' && !selectionHandleTransform) {
    // Pointer movement will refine this to move/resize when appropriate.
    grid.style.cursor = 'cell';
  }
}

function updateBrushCursor(): void {
  const visible = Boolean(hoverPointer)
    && !altPickerActive
    && (currentTool === 'brush' || currentTool === 'blur');
  brushCursor.style.display = visible ? 'block' : 'none';
  if (!visible || !hoverPointer) return;
  const diameter = Math.max(3, (brushSize() + 1) * cellSize);
  brushCursor.style.left = `${hoverPointer.x}px`;
  brushCursor.style.top = `${hoverPointer.y}px`;
  brushCursor.style.width = `${diameter}px`;
  brushCursor.style.height = `${diameter}px`;
  brushCursor.style.color = currentTool === 'blur' ? '#68c6ff' : '#ffcd75';
  brushCursor.classList.toggle('blur', currentTool === 'blur');
}

function setTool(tool: EditorTool): void {
  transformMode = false;
  currentTool = tool;
  if (tool === 'brush' || tool === 'blur' || tool === 'magic' || tool === 'fill') {
    activatePanel('left', 'left-tool');
  }
  updateToolUI();
  redraw();
}

function setTransformMode(enabled: boolean, focusPanel = true): void {
  transformMode = enabled && Boolean(selection);
  if (transformMode && focusPanel) activatePanel('left', 'left-tool');
  updateToolUI();
  redraw();
}

$('btnToolDraw').onclick = () => setTool('draw');
$('btnToolBrush').onclick = () => setTool('brush');
$('btnToolBlur').onclick = () => setTool('blur');
$('btnToolFill').onclick = () => setTool('fill');
$('btnToolPicker').onclick = () => setTool('picker');
$('btnToolSelect').onclick = () => setTool('select');
$('btnToolMagic').onclick = () => setTool('magic');
($('transformMode') as HTMLInputElement).onchange = (event) => {
  setTransformMode((event.target as HTMLInputElement).checked);
};

$('btnCompactPalette').onclick = () => {
  const before = JSON.stringify(file);
  const result = compactPalette();
  if (!result.changed) {
    flash('palette already compact');
    return;
  }
  rememberForUndo(before);
  updateUndoRedoButtons();
  buildPalette();
  redraw();
  syncIO();
  flash(`palette compacted: ${result.merged} duplicate, ${result.removed} unused`);
};

function setBrushSize(next: number): void {
  const input = $('brushSize') as HTMLInputElement;
  input.value = String(Math.max(1, Math.min(32, Math.round(next))));
  updateBrushCursor();
}

($('brushSize') as HTMLInputElement).oninput = (e) => {
  setBrushSize((e.target as HTMLInputElement).valueAsNumber);
};
$('btnBrushSizeDown').onclick = () => setBrushSize(brushSize() - 1);
$('btnBrushSizeUp').onclick = () => setBrushSize(brushSize() + 1);

function copySelection(): PixelClipboard | null {
  const snapshot = selectionSnapshot();
  if (!snapshot) return null;
  const copiedPalette: Palette = { '.': null };
  for (const ch of new Set(snapshot.rows.flatMap((row) => [...row]))) {
    copiedPalette[ch] = ch === '.' ? null : (pal()[ch] ?? null);
  }
  pixelClipboard = {
    w: snapshot.w,
    h: snapshot.h,
    rows: snapshot.rows,
    mask: snapshot.mask?.slice(),
    palette: copiedPalette,
  };
  const envelope = JSON.stringify({ kind: 'hitstop-sprite-selection', v: 2, ...snapshot, palette: copiedPalette });
  void navigator.clipboard?.writeText(envelope).catch(() => {});
  flash(`copied ${snapshot.w}x${snapshot.h} pixels`);
  return pixelClipboard;
}

function cutSelection(): void {
  if (!requireEditableLayer()) return;
  if (!selection || !copySelection()) return;
  saveHistory();
  clearSelectionPixels(cur(), selection);
  redraw();
  syncIO();
  void publishSelection();
  flash(`cut ${selection.w}x${selection.h} pixels`);
}

function deleteSelectionContents(): void {
  if (!selection || !requireEditableLayer()) return;
  saveHistory();
  clearSelectionPixels(cur(), selection);
  redraw();
  syncIO();
  schedulePreviewUpload();
  void publishSelection();
  flash(`cleared ${selectionPixelCount(selection)} selected pixels`);
}

function parsePixelClipboard(text: string): PixelClipboard | null {
  try {
    const value = JSON.parse(text) as {
      kind?: unknown;
      w?: unknown;
      h?: unknown;
      rows?: unknown;
      mask?: unknown;
      palette?: unknown;
    };
    if (value.kind !== 'hitstop-sprite-selection' || !Number.isInteger(value.w) || !Number.isInteger(value.h)
      || !Array.isArray(value.rows) || !value.rows.every((row) => typeof row === 'string')) return null;
    const w = Number(value.w);
    const h = Number(value.h);
    if (w < 1 || h < 1 || value.rows.length !== h || value.rows.some((row) => row.length !== w)) return null;
    const mask = value.mask;
    if (mask !== undefined && (!Array.isArray(mask) || mask.length !== h
      || !mask.every((row) => typeof row === 'string' && row.length === w && /^[1.]+$/.test(row)))) return null;
    let copiedPalette: Palette | undefined;
    if (value.palette !== undefined) {
      if (!value.palette || typeof value.palette !== 'object' || Array.isArray(value.palette)) return null;
      const entries = Object.entries(value.palette as Record<string, unknown>);
      if (!entries.every(([ch, color]) => ch.length === 1 && (typeof color === 'string' || color === null))) return null;
      copiedPalette = Object.fromEntries(entries) as Palette;
    }
    return {
      w,
      h,
      rows: value.rows as string[],
      mask: mask as string[] | undefined,
      palette: copiedPalette,
    };
  } catch {
    return null;
  }
}

function remapClipboardPalette(clip: PixelClipboard): {
  clip: PixelClipboard;
  added: number;
  approximated: number;
} {
  // Version-1 clipboard payloads did not carry colors. Preserve their old
  // same-document behavior rather than guessing what their characters meant.
  if (!clip.palette) return { clip, added: 0, approximated: 0 };

  const destination = pal();
  const destinationUsage = paletteUsage();
  const reserved = new Set<string>();
  const used = new Set(clip.rows.flatMap((row) => [...row]));
  const remap = new Map<string, string>([['.', '.']]);
  let added = 0;
  let approximated = 0;

  for (const sourceChar of used) {
    if (sourceChar === '.') continue;
    const color = clip.palette[sourceChar];
    if (!color) {
      remap.set(sourceChar, '.');
      continue;
    }
    const parsedSource = parseRgba(color);
    const normalized = parsedSource ? rgbaHex(parsedSource) : color.toLowerCase();
    const normalizedDestinationChar = parseRgba(destination[sourceChar]);
    if ((normalizedDestinationChar ? rgbaHex(normalizedDestinationChar) : destination[sourceChar]?.toLowerCase()) === normalized) {
      remap.set(sourceChar, sourceChar);
      continue;
    }
    const existing = Object.entries(destination)
      .find(([ch, value]) => {
        if (ch === '.') return false;
        const parsed = parseRgba(value);
        return (parsed ? rgbaHex(parsed) : value?.toLowerCase()) === normalized;
      })?.[0];
    if (existing) {
      remap.set(sourceChar, existing);
      continue;
    }

    const free = [...AUTO_PALETTE_CHARS].find((ch) => !(ch in destination));
    const recyclable = free ?? Object.keys(destination).find((ch) =>
      ch !== '.' && ch !== currentChar && !destinationUsage.has(ch) && !reserved.has(ch),
    );
    if (recyclable) {
      destination[recyclable] = color;
      reserved.add(recyclable);
      remap.set(sourceChar, recyclable);
      added++;
      continue;
    }

    const sourceRgba = parseRgba(color);
    let nearest = '';
    let nearestDistance = Number.POSITIVE_INFINITY;
    if (sourceRgba) {
      for (const [ch, value] of Object.entries(destination)) {
        const rgba = parseRgba(value);
        if (!rgba) continue;
        const distance = colorDistance(sourceRgba, rgba);
        if (distance < nearestDistance) {
          nearest = ch;
          nearestDistance = distance;
        }
      }
    }
    remap.set(sourceChar, nearest || (destination[currentChar] ? currentChar : '.'));
    approximated++;
  }

  return {
    clip: {
      ...clip,
      rows: clip.rows.map((row) => [...row].map((ch) => remap.get(ch) ?? '.').join('')),
    },
    added,
    approximated,
  };
}

async function pasteSelection(): Promise<void> {
  if (!requireEditableLayer()) return;
  let clip = pixelClipboard;
  if (!clip) {
    try { clip = parsePixelClipboard(await navigator.clipboard.readText()); } catch { /* permission denied */ }
  }
  if (!clip) {
    flash('copy a sprite selection first');
    return;
  }
  const x = selection?.x ?? 0;
  const y = selection?.y ?? 0;
  const pastedW = Math.min(clip.w, W() - x);
  const pastedH = Math.min(clip.h, H() - y);
  if (pastedW <= 0 || pastedH <= 0) return;
  saveHistory();
  const remapped = remapClipboardPalette(clip);
  clip = remapped.clip;
  const rows = cur().slice();
  // A copied selection behaves like an image object: transparent pixels
  // reveal the destination instead of punching holes through it.
  pastePixels(rows, clip, x, y, true);
  anim().frames[frameIdx] = rows;
  editVersion++;
  const clippedMask = clip.mask?.slice(0, pastedH).map((row) => row.slice(0, pastedW));
  setSelection({ x, y, w: pastedW, h: pastedH, mask: clippedMask });
  setTransformMode(true);
  if (remapped.added) buildPalette();
  syncIO();
  schedulePreviewUpload();
  void publishSelection();
  flash(`pasted ${pastedW}x${pastedH} pixels${remapped.added ? `; added ${remapped.added} colors` : ''}`
    + `${remapped.approximated ? `; palette full, approximated ${remapped.approximated}` : ''}`);
}

function commitSelectionPixels(
  clip: PixelClipboard,
  x: number,
  y: number,
  message: string,
): void {
  if (!selection) return;
  saveHistory();
  const rows = cur().slice();
  clearSelectionPixels(rows, selection);
  pastePixels(rows, clip, x, y, true);
  anim().frames[frameIdx] = rows;
  editVersion++;
  setSelection({ x, y, w: clip.w, h: clip.h, mask: clip.mask?.slice() });
  syncIO();
  void publishSelection();
  flash(message);
}

function moveSelectionBy(dx: number, dy: number): void {
  if (!transformMode) return;
  if (!requireEditableLayer()) return;
  if (!selection) return;
  const x = Math.max(0, Math.min(W() - selection.w, selection.x + dx));
  const y = Math.max(0, Math.min(H() - selection.h, selection.y + dy));
  if (x === selection.x && y === selection.y) return;
  commitSelectionPixels(pixelsInSelection(selection), x, y, `moved selection to ${x},${y}`);
}

function scaleSelectionRows(
  source: PixelClipboard,
  w: number,
  h: number,
  flipX = false,
  flipY = false,
): PixelClipboard {
  return {
    w,
    h,
    rows: Array.from({ length: h }, (_, y) => {
      const scaledY = Math.min(source.h - 1, Math.floor(y * source.h / h));
      const sourceY = flipY ? source.h - 1 - scaledY : scaledY;
      return Array.from({ length: w }, (_, x) => {
        const scaledX = Math.min(source.w - 1, Math.floor(x * source.w / w));
        const sourceX = flipX ? source.w - 1 - scaledX : scaledX;
        return source.rows[sourceY][sourceX];
      }).join('');
    }),
    mask: source.mask && Array.from({ length: h }, (_, y) => {
      const scaledY = Math.min(source.h - 1, Math.floor(y * source.h / h));
      const sourceY = flipY ? source.h - 1 - scaledY : scaledY;
      return Array.from({ length: w }, (_, x) => {
        const scaledX = Math.min(source.w - 1, Math.floor(x * source.w / w));
        const sourceX = flipX ? source.w - 1 - scaledX : scaledX;
        return source.mask![sourceY][sourceX];
      }).join('');
    }),
  };
}

function resizeSelection(): void {
  if (!transformMode) return;
  if (!requireEditableLayer()) return;
  if (!selection) return;
  const requestedW = Math.round(($('selectionW') as HTMLInputElement).valueAsNumber);
  const requestedH = Math.round(($('selectionH') as HTMLInputElement).valueAsNumber);
  if (!(requestedW >= 1 && requestedH >= 1 && requestedW <= W() && requestedH <= H())) {
    flash(`selection size must fit ${W()}x${H()} canvas`);
    setSelection(selection);
    return;
  }
  if (requestedW === selection.w && requestedH === selection.h) {
    flash('selection already has that size');
    return;
  }
  const source = pixelsInSelection(selection);
  const scaled = scaleSelectionRows(source, requestedW, requestedH);
  const x = Math.max(0, Math.min(W() - requestedW,
    Math.round(selection.x + (selection.w - requestedW) / 2)));
  const y = Math.max(0, Math.min(H() - requestedH,
    Math.round(selection.y + (selection.h - requestedH) / 2)));
  commitSelectionPixels(scaled, x, y, `resized selection to ${requestedW}x${requestedH}`);
}

function rotateSelectionQuarter(source: PixelClipboard, clockwise: boolean): PixelClipboard {
  return {
    w: source.h,
    h: source.w,
    rows: Array.from({ length: source.w }, (_, y) =>
      Array.from({ length: source.h }, (_, x) => clockwise
        ? source.rows[source.h - 1 - x][y]
        : source.rows[x][source.w - 1 - y],
      ).join(''),
    ),
    mask: source.mask && Array.from({ length: source.w }, (_, y) =>
      Array.from({ length: source.h }, (_, x) => clockwise
        ? source.mask![source.h - 1 - x][y]
        : source.mask![x][source.w - 1 - y],
      ).join(''),
    ),
  };
}

/**
 * Rotates indexed sprite pixels without creating gaps. Each destination
 * pixel is mapped back into the original selection and samples its nearest
 * source pixel. Quarter turns stay lossless; arbitrary angles necessarily
 * rasterize onto a new axis-aligned pixel grid.
 */
function rotateSelectionRows(source: PixelClipboard, degrees: number): PixelClipboard {
  const normalized = ((degrees % 360) + 360) % 360;
  const quarterTurns = Math.round(normalized / 90) % 4;
  const quarterAngle = quarterTurns * 90;
  if (Math.abs(normalized - quarterAngle) < 0.0001 || Math.abs(normalized - 360) < 0.0001) {
    let result = source;
    for (let turn = 0; turn < quarterTurns; turn++) result = rotateSelectionQuarter(result, true);
    return result;
  }

  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const width = Math.max(1, Math.ceil(
    Math.abs(source.w * cosine) + Math.abs(source.h * sine) - 1e-9,
  ));
  const height = Math.max(1, Math.ceil(
    Math.abs(source.w * sine) + Math.abs(source.h * cosine) - 1e-9,
  ));
  return {
    w: width,
    h: height,
    rows: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        const destinationX = x + 0.5 - width / 2;
        const destinationY = y + 0.5 - height / 2;
        const sourceX = cosine * destinationX + sine * destinationY + source.w / 2;
        const sourceY = -sine * destinationX + cosine * destinationY + source.h / 2;
        const sampleX = Math.floor(sourceX);
        const sampleY = Math.floor(sourceY);
        return sampleX >= 0 && sampleX < source.w && sampleY >= 0 && sampleY < source.h
          ? source.rows[sampleY][sampleX]
          : '.';
      }).join(''),
    ),
    mask: source.mask && Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        const destinationX = x + 0.5 - width / 2;
        const destinationY = y + 0.5 - height / 2;
        const sourceX = cosine * destinationX + sine * destinationY + source.w / 2;
        const sourceY = -sine * destinationX + cosine * destinationY + source.h / 2;
        const sampleX = Math.floor(sourceX);
        const sampleY = Math.floor(sourceY);
        return sampleX >= 0 && sampleX < source.w && sampleY >= 0 && sampleY < source.h
          ? source.mask![sampleY][sampleX]
          : '.';
      }).join(''),
    ),
  };
}

function rotateSelectionBy(degrees: number, message?: string): void {
  if (!transformMode) return;
  if (!requireEditableLayer()) return;
  if (!selection || !Number.isFinite(degrees)) return;
  if (Math.abs(degrees % 360) < 0.0001) {
    flash('enter a non-zero rotation');
    return;
  }
  const source = pixelsInSelection(selection);
  const rotated = rotateSelectionRows(source, degrees);
  if (rotated.w > W() || rotated.h > H()) {
    flash(`rotated selection does not fit ${W()}x${H()} canvas`);
    return;
  }
  const x = Math.max(0, Math.min(W() - rotated.w,
    Math.round(selection.x + (selection.w - rotated.w) / 2)));
  const y = Math.max(0, Math.min(H() - rotated.h,
    Math.round(selection.y + (selection.h - rotated.h) / 2)));
  commitSelectionPixels(rotated, x, y, message ?? `rotated selection by ${degrees}°`);
}

function rotateSelection(clockwise: boolean): void {
  if (!requireEditableLayer()) return;
  rotateSelectionBy(clockwise ? 90 : -90, `rotated selection ${clockwise ? 'right' : 'left'} 90°`);
}

$('btnCopy').onclick = () => { copySelection(); };
$('btnCut').onclick = () => cutSelection();
$('btnPaste').onclick = () => void pasteSelection();
$('btnRotateSelectionLeft').onclick = () => rotateSelection(false);
$('btnRotateSelectionRight').onclick = () => rotateSelection(true);
$('btnRotateSelection').onclick = () => {
  const input = $('selectionAngle') as HTMLInputElement;
  rotateSelectionBy(input.valueAsNumber);
  input.value = '0';
};
$('btnResizeSelection').onclick = () => resizeSelection();
($('selectionW') as HTMLInputElement).addEventListener('keydown', (event) => {
  if (event.key === 'Enter') resizeSelection();
});
($('selectionH') as HTMLInputElement).addEventListener('keydown', (event) => {
  if (event.key === 'Enter') resizeSelection();
});
($('selectionAngle') as HTMLInputElement).addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const input = event.currentTarget as HTMLInputElement;
  rotateSelectionBy(input.valueAsNumber);
  input.value = '0';
});

const GRID_ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

function setGridZoom(value: number): void {
  cellSize = Math.max(GRID_ZOOMS[0], Math.min(GRID_ZOOMS.at(-1)!, Math.round(value)));
  ($('gridZoomPercent') as HTMLInputElement).value = String(cellSize * 100);
  redraw();
}

function fitGrid(): void {
  const center = $('center');
  const availableW = Math.max(1, center.clientWidth - 40);
  const availableH = Math.max(1, center.clientHeight - 40);
  const ideal = Math.floor(Math.min(availableW / W(), availableH / H()));
  setGridZoom([...GRID_ZOOMS].reverse().find((size) => size <= ideal) ?? GRID_ZOOMS[0]);
}

($('gridZoomPercent') as HTMLInputElement).onchange = (event) => {
  setGridZoom(Number((event.target as HTMLInputElement).value) / 100);
};
$('btnGridZoomOut').onclick = () => {
  setGridZoom([...GRID_ZOOMS].reverse().find((size) => size < cellSize) ?? GRID_ZOOMS[0]);
};
$('btnGridZoomIn').onclick = () => {
  setGridZoom(GRID_ZOOMS.find((size) => size > cellSize) ?? GRID_ZOOMS.at(-1)!);
};
$('btnFitGrid').onclick = () => fitGrid();

$('btnLoadRef').onclick = () => ($('refFileInput') as HTMLInputElement).click();
($('refFileInput') as HTMLInputElement).onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      refFile = normalize(JSON.parse(String(reader.result)));
      redraw();
      schedulePreviewUpload();
      flash(`loaded reference: ${f.name}`);
      ($('selectRefSprite') as HTMLSelectElement).value = ''; // clear dropdown
    } catch (err) {
      flash(`reference load failed: ${(err as Error).message}`);
    }
  };
  reader.readAsText(f);
  input.value = '';
};

$('selectRefSprite').onchange = (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (!val) {
    refFile = null;
    redraw();
    schedulePreviewUpload();
    return;
  }
  try {
    refFile = existingSprite(val);
    redraw();
    schedulePreviewUpload();
    flash(`loaded reference: ${val}`);
  } catch (err) {
    flash(`reference load failed: ${(err as Error).message}`);
  }
};

($('showRef') as HTMLInputElement).onchange = () => {
  redraw();
  schedulePreviewUpload();
};
($('onionSkin') as HTMLInputElement).onchange = () => redraw();

$('btnNudgeLeft').onclick = () => moveSelectionBy(-1, 0);
$('btnNudgeRight').onclick = () => moveSelectionBy(1, 0);
$('btnNudgeUp').onclick = () => moveSelectionBy(0, -1);
$('btnNudgeDown').onclick = () => moveSelectionBy(0, 1);

/* ---------------- history (undo / redo) ---------------- */

function saveHistory(): void {
  editVersion++; // every mutation funnels through here first
  const stateStr = historySnapshot();
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === stateStr) {
    return;
  }
  undoStack.push(stateStr);
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack.length = 0; // Clear redo stack on new action
  updateUndoRedoButtons();
}

function undo(): void {
  if (undoStack.length === 0) return;
  const currentStr = historySnapshot();
  redoStack.push(currentStr);
  
  const prevStateStr = undoStack.pop()!;
  const previous = parseHistorySnapshot(prevStateStr);
  file = normalize(previous.file);
  editVersion++;
  
  if (!file.anims[animName]) {
    animName = Object.keys(file.anims)[0];
  }
  const maxIdx = anim().frames.length - 1;
  frameIdx = Math.min(frameIdx, maxIdx);
  selection = null;
  refreshUI();
  setSelection(previous.selection);
  void publishSelection();
  updateUndoRedoButtons();
  flash('undo');
}

function redo(): void {
  if (redoStack.length === 0) return;
  const currentStr = historySnapshot();
  undoStack.push(currentStr);
  
  const nextStateStr = redoStack.pop()!;
  const next = parseHistorySnapshot(nextStateStr);
  file = normalize(next.file);
  editVersion++;
  
  if (!file.anims[animName]) {
    animName = Object.keys(file.anims)[0];
  }
  const maxIdx = anim().frames.length - 1;
  frameIdx = Math.min(frameIdx, maxIdx);
  selection = null;
  refreshUI();
  setSelection(next.selection);
  void publishSelection();
  updateUndoRedoButtons();
  flash('redo');
}

function updateUndoRedoButtons(): void {
  const btnUndo = $('btnUndo') as HTMLButtonElement;
  const btnRedo = $('btnRedo') as HTMLButtonElement;
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

$('btnUndo').onclick = () => undo();
$('btnRedo').onclick = () => redo();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editMenu.open) {
    e.preventDefault();
    editMenu.open = false;
    return;
  }
  updateSelectionModifierCursor(e);
  if (e.key === 'Alt' && currentTool !== 'magic' && currentTool !== 'select' && !transformMode) {
    e.preventDefault();
    altPickerActive = true;
    updateToolUI();
    return;
  }
  const target = e.target as HTMLElement | null;
  const typing = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
  const key = e.key.toLowerCase();
  if (!typing && (e.ctrlKey || e.metaKey) && key === 'c' && selection) {
    e.preventDefault();
    copySelection();
  }
  if (!typing && (e.ctrlKey || e.metaKey) && key === 'x' && selection) {
    e.preventDefault();
    cutSelection();
  }
  if (!typing && (e.ctrlKey || e.metaKey) && key === 'v') {
    e.preventDefault();
    void pasteSelection();
  }
  if (!typing && key === 'escape' && selection) {
    e.preventDefault();
    clearSelection();
  }
  if (!typing && selection && !e.ctrlKey && !e.metaKey && !e.altKey
    && (key === 'delete' || key === 'backspace')) {
    e.preventDefault();
    deleteSelectionContents();
    return;
  }
  if (!typing && key === 'm' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    setTool('select');
  }
  if (!typing && selection && transformMode && key.startsWith('arrow')) {
    e.preventDefault();
    const distance = e.shiftKey ? 4 : 1;
    if (key === 'arrowleft') moveSelectionBy(-distance, 0);
    else if (key === 'arrowright') moveSelectionBy(distance, 0);
    else if (key === 'arrowup') moveSelectionBy(0, -distance);
    else if (key === 'arrowdown') moveSelectionBy(0, distance);
  }
  if (!typing && !e.ctrlKey && !e.metaKey) {
    if (key === 'v') {
      e.preventDefault();
      setTransformMode(!transformMode);
      return;
    }
    const shortcut: Partial<Record<string, EditorTool>> = {
      p: 'draw',
      b: 'brush',
      u: 'blur',
      g: 'fill',
      w: 'magic',
    };
    const tool = shortcut[key];
    if (tool) {
      e.preventDefault();
      setTool(tool);
    }
  }
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
  }
  if ((e.ctrlKey || e.metaKey) && key === 'y') {
    e.preventDefault();
    redo();
  }
});

window.addEventListener('keyup', (e) => {
  updateSelectionModifierCursor(e);
  if (e.key !== 'Alt') return;
  e.preventDefault();
  altPickerActive = false;
  updateToolUI();
});

window.addEventListener('blur', () => {
  selectionModifierKeys = { shiftKey: false, altKey: false };
  magicSelectionDrag = null;
  altPickerActive = false;
  picking = false;
  updateToolUI();
});

($('hd') as HTMLInputElement).onchange = (e) => {
  file.hd = (e.target as HTMLInputElement).checked;
  syncIO();
  schedulePreviewUpload();
};

// Physical size inputs → write to file.w / file.h
function onPhysChange(): void {
  const pw = ($('physW') as HTMLInputElement).valueAsNumber;
  const ph = ($('physH') as HTMLInputElement).valueAsNumber;
  if (!(pw > 0) || !(ph > 0)) {
    flash('physical size must be positive');
    syncIO();
    return;
  }
  saveHistory();
  file.w = pw;
  file.h = ph;
  syncIO();
}
($('physW') as HTMLInputElement).onchange = onPhysChange;
($('physH') as HTMLInputElement).onchange = onPhysChange;

// Hitbox inputs → write to file.hitbox
function onHitboxChange(): void {
  const bx = ($('boxX') as HTMLInputElement).valueAsNumber;
  const by = ($('boxY') as HTMLInputElement).valueAsNumber;
  const bw = ($('boxW') as HTMLInputElement).valueAsNumber;
  const bh = ($('boxH') as HTMLInputElement).valueAsNumber;
  if (!Number.isFinite(bx) || !Number.isFinite(by) || !(bw > 0) || !(bh > 0)) {
    flash('hitbox needs finite x/y and positive w/h');
    syncIO();
    return;
  }
  const { w, h } = geometryOf(file, cur());
  saveHistory();
  // Only store hitbox if it differs from the full physical size at origin
  if (bx === 0 && by === 0 && bw === w && bh === h) {
    delete file.hitbox;
  } else {
    file.hitbox = { x: bx, y: by, w: bw, h: bh };
  }
  syncIO();
}
($('boxX') as HTMLInputElement).onchange = onHitboxChange;
($('boxY') as HTMLInputElement).onchange = onHitboxChange;
($('boxW') as HTMLInputElement).onchange = onHitboxChange;
($('boxH') as HTMLInputElement).onchange = onHitboxChange;

/* ---------------- boot ---------------- */

function refreshUI(): void {
  reconcileLayerState();
  buildPalette();
  buildLayers();
  buildAnims();
  buildFrames();
  buildAnchors();
  buildAttachmentSlots();
  redraw();
  syncIO();

  const hdCheckbox = $('hd') as HTMLInputElement;
  if (hdCheckbox) hdCheckbox.checked = file.hd ?? true;
  refreshCombatPanel();
  updateBridgeStatus();
}

refreshUI();
// Editor state, surfaced for scripted verification (the same doorway
// __harness/__replay give the game proper).
Object.defineProperty(window, '__editor', {
  value: {
    get file() { return file; },
    get currentFileName() { return currentFileName; },
    get currentRepoPath() { return currentRepoPath; },
    get animName() { return animName; },
    get frameIdx() { return frameIdx; },
    get editVersion() { return editVersion; },
    get rebuiltVersion() { return rebuiltVersion; },
    get selection() { return selectionSnapshot(); },
    get bridge() {
      return {
        connected: bridgeConnected,
        revision: bridgeRevision,
        dirty: bridgeDirty,
        conflict: bridgeConflict,
        clientId: bridgeClientId,
      };
    },
    open(path: string) { return openSharedSprite(path); },
    replace(next: SpriteFile, path: string | null = currentRepoPath) {
      rememberActiveLayer();
      rememberForUndo();
      file = normalize(structuredClone(next));
      currentRepoPath = path;
      currentFileName = path?.split('/').at(-1) ?? currentFileName;
      restoreActiveLayer(path, file);
      animName = Object.keys(file.anims)[0];
      frameIdx = 0;
      currentChar = firstPaintChar();
      editVersion++;
      refreshUI();
      updateUndoRedoButtons();
      void publishSharedSprite();
    },
    setPixels(changes: { anim?: string; frame?: number; layerId?: string; pixels: { x: number; y: number; char: string }[] }) {
      const targetName = changes.anim ?? animName;
      const concrete = resolveAnimName(file, targetName);
      let frames: string[][];
      if (isLayeredSpriteFile(file)) {
        const layer = file.layers.find((candidate) => candidate.id === (changes.layerId ?? activeLayerId));
        if (!layer) throw new Error(`unknown layer "${changes.layerId ?? activeLayerId}"`);
        frames = layer.tracks[concrete];
      } else {
        const targetAnim = file.anims[concrete];
        if (!targetAnim || typeof targetAnim === 'string') throw new Error(`unknown animation "${targetName}"`);
        frames = targetAnim.frames;
      }
      const targetFrame = changes.frame ?? frameIdx;
      const rows = frames[targetFrame];
      if (!rows) throw new Error(`unknown frame ${targetFrame} in "${targetName}"`);
      rememberForUndo();
      for (const pixel of changes.pixels) {
        if (pixel.char.length !== 1) throw new Error('pixel char must be one character');
        if (pixel.y < 0 || pixel.y >= rows.length || pixel.x < 0 || pixel.x >= rows[pixel.y].length) continue;
        rows[pixel.y] = rows[pixel.y].slice(0, pixel.x) + pixel.char + rows[pixel.y].slice(pixel.x + 1);
      }
      editVersion++;
      refreshUI();
      updateUndoRedoButtons();
      void publishSharedSprite();
    },
    save() { return saveWorkspaceSprites(); },
  },
});

// Composite weapon picker: every registered weapon except bare hands.
{
  const sel = $('compWeapon') as HTMLSelectElement;
  sel.onchange = () => {
    previewStepping = false;
    previewStepFrame = 0;
    rebuildMoveSelect(sel.value);
    refreshCombatPanel();
    schedulePreviewUpload();
  };
  for (const id of weapons.ids()) {
    if (id === 'unarmed') continue;
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
}

function stepPreview(delta: number): void {
  const play = $('previewPlay') as HTMLInputElement;
  const timing = currentPreviewTiming();
  const start = previewStepping
    ? previewStepFrame
    : play.checked
      ? previewDisplayedFrame
      : Math.min(frameIdx, timing.frameCount - 1);
  play.checked = false;
  previewStepFrame = ((start + delta) % timing.frameCount + timing.frameCount) % timing.frameCount;
  previewStepping = true;
  schedulePreviewUpload();
}

$('previewPrev').onclick = () => stepPreview(-1);
$('previewNext').onclick = () => stepPreview(1);
($('previewPlay') as HTMLInputElement).addEventListener('change', () => {
  if (($('previewPlay') as HTMLInputElement).checked) previewStepping = false;
});
for (const id of ['compMove', 'compBody']) {
  $(id).addEventListener('change', () => {
    previewStepping = false;
    previewStepFrame = 0;
    if (id === 'compMove') refreshCombatPanel();
  });
}

($('combatMove') as HTMLSelectElement).addEventListener('change', () => {
  const combatMove = ($('combatMove') as HTMLSelectElement).value;
  const compositeMove = $('compMove') as HTMLSelectElement;
  if ([...compositeMove.options].some((option) => option.value === combatMove)) {
    compositeMove.value = combatMove;
  }
  const selected = selectedCombatMove();
  if (selected && file.anims[selected.move.def.animation]) {
    animName = selected.move.def.animation;
    frameIdx = 0;
    refreshUI();
  } else {
    refreshCombatPanel();
  }
  previewStepping = false;
  previewStepFrame = 0;
  schedulePreviewUpload();
});

for (const id of [
  'combatFps', 'combatActiveStart', 'combatActiveEnd',
  'combatForward', 'combatY', 'combatW', 'combatH',
]) {
  $(id).addEventListener('input', updateCombatTuningFromControls);
  $(id).addEventListener('change', updateCombatTuningFromControls);
}

// These controls change only the rendered preview, not the sprite document.
// Keep the bridge snapshot in lockstep so agents and other editor clients see
// the same selected pose/composite as the author looking at this tab.
for (const id of ['previewPlay', 'compMove', 'compBody', 'compTrail', 'compHitbox', 'compGear', 'showHitbox']) {
  ($(id) as HTMLInputElement | HTMLSelectElement).addEventListener('change', schedulePreviewUpload);
}

rebuildMoveSelect(($('compWeapon') as HTMLSelectElement).value);
renderPreview();
updateBridgeStatus();
void initializeBridge().then(() => {
  restoreEditorViewState();
  editorViewReady = true;
  persistEditorViewState();
});
window.setInterval(() => {
  persistCurrentDraft();
  if (editorViewReady) persistEditorViewState();
  void publishSharedSprite();
}, 160);
window.addEventListener('beforeunload', () => {
  persistCurrentDraft();
  if (editorViewReady) persistEditorViewState();
});
