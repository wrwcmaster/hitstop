/// <reference types="vite/client" />

import {
  resolveSpriteGeometry, resolveAnim, sprite, epx,
  type Palette, type SpriteFile, type SpriteAnimData, type SpriteAnchor,
} from '@engine/index';
import { PAL } from '@game/content/palette';
// Composite preview: the editor borrows the GAME's renderers rather than
// imitating them, so what you see here — held weapon anchored to the
// body, slash trail sweeping on the attack clock — is exactly what the
// game draws. The weapon anchors and the trail are code, not sprites;
// no sprite-only overlay could show this truthfully.
import {
  drawHeldWeapon,
  drawWeaponTrail,
  weaponVisuals,
  rebuildSpriteWeapon,
} from '@game/content/weapon-visuals';
import { weapons, weaponTypeOf, allAttacks } from '@game/content/weapons';
import { KNIGHT_ANIMS, baseKnight, rebuildKnightSprite } from '@game/content/sprites';
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
let currentChar = firstPaintChar();
let painting = false;
let erasing = false;
type EditorTool = 'draw' | 'brush' | 'blur' | 'fill' | 'picker' | 'select';
let currentTool: EditorTool = 'draw';
let altPickerActive = false;
let picking = false;
let lastPaintCell: { x: number; y: number } | null = null;
let hoverPointer: { x: number; y: number } | null = null;
let strokePaletteChanged = false;
interface PixelRect { x: number; y: number; w: number; h: number }
interface PixelClipboard { w: number; h: number; rows: string[] }
interface SelectionMove {
  start: { x: number; y: number };
  original: PixelRect;
  source: PixelClipboard;
  baseFrame: string[];
  last: { x: number; y: number };
  moved: boolean;
}
type SelectionResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type SelectionHandle = SelectionResizeHandle | 'rotate';
interface SelectionHandleTransform {
  handle: SelectionHandle;
  original: PixelRect;
  source: PixelClipboard;
  baseFrame: string[];
  startPointer: { x: number; y: number };
  startAngle: number;
  lastKey: string;
  moved: boolean;
}
interface SharedSelection extends PixelRect {
  path: string | null;
  anim: string;
  frame: number;
  rows: string[];
  source: string;
  updatedAt: number;
}
let selection: PixelRect | null = null;
let selectionStart: { x: number; y: number } | null = null;
let selectionMove: SelectionMove | null = null;
let selectionHandleTransform: SelectionHandleTransform | null = null;
let pixelClipboard: PixelClipboard | null = null;
let refFile: SpriteFile | null = null;
let currentFileName = 'new sprite.json';
let currentRepoPath: string | null = null;
let selectedAnchorName = '';
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

const BRIDGE = '/__sprite-editor';
const bridgeClientId = `editor-${crypto.randomUUID()}`;
let bridgeRevision = 0;
let bridgeDirty = false;
let bridgeConnected = false;
let bridgeConflict = false;
let bridgePublishing = false;
let lastSharedFile = '';
let previewTimer = 0;

function emptyFrame(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}
function firstPaintChar(): string {
  const entry = Object.entries(file.palette ?? {}).find(([, c]) => c);
  return entry ? entry[0] : 'S';
}

const pal = (): Palette => file.palette ?? {};
/**
 * The animation being edited, RESOLVED: an alias entry ("plunge":
 * "attack") has no frames of its own, so selecting one jumps to its
 * target (see buildAnims) and this accessor follows the chain as a
 * belt-and-braces. Mutations through it therefore edit the target's
 * frames, which is the only thing an alias could mean in an editor.
 */
const anim = (): SpriteAnimData => resolveAnim(file, animName)!;
/** Concrete (non-alias) animations — the only ones with frames to edit,
 * resize, or export as art. */
const concreteAnims = (): [string, SpriteAnimData][] =>
  Object.entries(file.anims).filter((e): e is [string, SpriteAnimData] => typeof e[1] !== 'string');
const cur = () => anim().frames[frameIdx];
const W = () => cur()[0].length;
const H = () => cur().length;
const density = () => file.hd === false ? 4 : 1;

function concreteAnimName(name = animName): string {
  const seen = new Set<string>();
  let current = name;
  while (typeof file.anims[current] === 'string' && !seen.has(current)) {
    seen.add(current);
    current = file.anims[current] as string;
  }
  return current;
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

const SPRITE_ROOT = '/src/game/content/sprites/';
const spriteModules = import.meta.glob('/src/game/content/sprites/**/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, SpriteFile>;
const existingSprites = new Map(
  Object.entries(spriteModules)
    .map(([modulePath, spriteFile]) => [modulePath.slice(SPRITE_ROOT.length), spriteFile] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
);

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
  if (!path.includes('equipment/')) return;
  const stem = path.split('/').at(-1)!.replace(/\.json$/, '');
  ($('compBody') as HTMLSelectElement).value = 'player';
  if (weapons.has(stem)) {
    ($('compWeapon') as HTMLSelectElement).value = stem;
    rebuildMoveSelect(stem);
  } else {
    ($('compWeapon') as HTMLSelectElement).value = '';
    ($('compGear') as HTMLInputElement).checked = true;
    rebuildMoveSelect('');
  }
}

populateSpriteSelect('selectSprite');
populateSpriteSelect('selectRefSprite');

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
  save.disabled = !bridgeConnected || bridgeConflict || !currentRepoPath || !bridgeDirty;
}

function historySnapshot(spriteFile: SpriteFile = file, selected: PixelRect | null = selection): string {
  return JSON.stringify({ v: 1, file: spriteFile, selection: selected });
}

function parseHistorySnapshot(snapshot: string): { file: SpriteFile; selection: PixelRect | null } {
  const parsed = JSON.parse(snapshot) as { v?: unknown; file?: unknown; selection?: PixelRect | null };
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
  lastSharedFile = JSON.stringify(state.file);
  bridgeConflict = false;
  pendingBridgeState = null;
  updateBridgeStatus();
  schedulePreviewUpload();
}

function applyBridgeState(state: BridgeState, force = false): void {
  if (!force && state.revision <= bridgeRevision) return;
  const switchedSprite = state.path !== currentRepoPath;
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
    rememberForUndo();
    clearSelection(false);
    file = normalize(structuredClone(state.file));
    if (!file.anims[animName]) animName = Object.keys(file.anims)[0];
    frameIdx = Math.min(frameIdx, anim().frames.length - 1);
    currentChar = firstPaintChar();
    editVersion++;
    refreshUI();
    updateUndoRedoButtons();
    if (switchedSprite) fitGrid();
    if (state.source !== bridgeClientId) flash(`updated by ${state.source}`);
  }
  updateBridgeMeta(state);
  const select = $('selectSprite') as HTMLSelectElement;
  select.value = state.path ?? '';
  if (switchedSprite && state.path) configureCompositeForPath(state.path);
}

async function bridgeJson(path: string, init?: RequestInit): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${BRIDGE}${path}`, init);
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

function selectionSnapshot(): SharedSelection | null {
  if (!selection) return null;
  return {
    ...selection,
    path: currentRepoPath,
    anim: concreteAnimName(),
    frame: frameIdx,
    rows: cur().slice(selection.y, selection.y + selection.h)
      .map((row) => row.slice(selection!.x, selection!.x + selection!.w)),
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

async function openSharedSprite(path: string): Promise<boolean> {
  try {
    // A stroke can be waiting for the 160 ms publish tick when the user
    // changes the selector. Flush it first so `/open` sees a dirty shared
    // document and cannot replace work that existed only in this tab.
    if (lastSharedFile && JSON.stringify(file) !== lastSharedFile) {
      await publishSharedSprite();
      if (JSON.stringify(file) !== lastSharedFile || bridgeConflict) {
        flash('finish resolving the current shared edit before opening another');
        return false;
      }
    }
    const { response, body } = await bridgeJson('/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, source: bridgeClientId }),
    });
    if (response.status === 409) {
      const shared = (body.state as BridgeState | null) ?? null;
      if (shared) applyBridgeState(shared, true);
      flash('save the current shared sprite before opening another');
      return false;
    }
    if (!response.ok) throw new Error(String(body.error ?? response.statusText));
    applyBridgeState(body as unknown as BridgeState, true);
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

async function saveSharedSprite(): Promise<void> {
  if (!currentRepoPath || bridgeConflict) return;
  try {
    const { response, body } = await bridgeJson('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentRepoPath, baseRevision: bridgeRevision, source: bridgeClientId }),
    });
    if (response.status === 409) {
      pendingBridgeState = (body.state as BridgeState | null) ?? null;
      bridgeConflict = true;
      updateBridgeStatus();
      return;
    }
    if (!response.ok) throw new Error(String(body.error ?? response.statusText));
    updateBridgeMeta(body as unknown as BridgeState);
    flash(`saved ${currentRepoPath}`);
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
$('btnSaveRepo').onclick = () => void saveSharedSprite();

/* ---------------- palette ui ---------------- */

interface PaletteSortColor {
  hue: number;
  saturation: number;
  lightness: number;
  neutral: boolean;
}

function paletteSortColor(hex: string): PaletteSortColor | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
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
  return { hue, saturation, lightness, neutral: chroma < 0.08 || saturation < 0.12 };
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
          || a.sort.saturation - b.sort.saturation
          || a.index - b.index;
      }
      return a.sort.hue - b.sort.hue
        || a.sort.lightness - b.sort.lightness
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
    if (color) b.style.background = color;
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
}

$('btnAddColor').onclick = () => {
  saveHistory();
  const ch = ($('newChar') as HTMLInputElement).value || '?';
  const color = ($('newColor') as HTMLInputElement).value;
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
      refreshUI();
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
  file.anims[name] = { fps: 8, frames: [emptyFrame(W(), H())] };
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
  const next: SpriteFile['anims'] = {};
  for (const [k, v] of Object.entries(file.anims)) next[k === animName ? name : k] = v;
  file.anims = next;
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
  delete file.anims[animName];
  for (const anchors of Object.values(file.anchors ?? {})) delete anchors[animName];
  animName = Object.keys(file.anims)[0];
  frameIdx = 0;
  refreshUI();
};
($('fps') as HTMLInputElement).onchange = (e) => {
  anim().fps = Number((e.target as HTMLInputElement).value) || 1;
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

interface Rgb { r: number; g: number; b: number }

// Sprite files address colors with one-character palette keys. Soft tools
// therefore bake their result into real palette entries rather than hiding
// browser-only alpha in the canvas preview. Excluding dot, quote, and slash
// keeps rows easy to read while leaving ample room for generated blends.
const AUTO_PALETTE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#@$%&*+=!?~^;:,<>[]{}()_-|`';

function parseRgb(color: string | null | undefined): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? '');
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function rgbHex(color: Rgb): string {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16).padStart(2, '0');
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function paletteUsage(): Map<string, number> {
  const usage = new Map<string, number>();
  for (const [, target] of concreteAnims()) {
    for (const frame of target.frames) {
      for (const row of frame) {
        for (const ch of row) usage.set(ch, (usage.get(ch) ?? 0) + 1);
      }
    }
  }
  return usage;
}

interface PaletteCompaction { changed: boolean; merged: number; removed: number }

function compactPalette(removeUnused = true): PaletteCompaction {
  const usage = paletteUsage();
  const groups = new Map<string, string[]>();
  for (const [ch, color] of Object.entries(pal())) {
    if (ch === '.' || typeof color !== 'string') continue;
    const key = color.toLowerCase();
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
    for (const [, target] of concreteAnims()) {
      target.frames = target.frames.map((frame) => frame.map((row) =>
        [...row].map((ch) => remap.get(ch) ?? ch).join(''),
      ));
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

function paletteCharFor(color: Rgb): string {
  // Small quantization absorbs imperceptible differences caused by repeated
  // feathered stamps and lets neighboring edge pixels reuse colors.
  const quantized = {
    r: Math.min(255, Math.round(color.r / 8) * 8),
    g: Math.min(255, Math.round(color.g / 8) * 8),
    b: Math.min(255, Math.round(color.b / 8) * 8),
  };
  const hex = rgbHex(quantized);
  let nearest = '';
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [ch, value] of Object.entries(pal())) {
    const rgb = parseRgb(value);
    if (!rgb) continue;
    if ((value ?? '').toLowerCase() === hex) return ch;
    const distance = colorDistance(quantized, rgb);
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
  const selected = parseRgb(pal()[currentChar]);
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
      const old = parseRgb(pal()[oldChar]);
      if (strength >= 0.995) setPixel(x, y, currentChar);
      else if (old) setPixel(x, y, paletteCharFor(mixRgb(old, selected!, strength)));
      // The format has binary transparency. At the silhouette edge, use a
      // half-coverage cutoff rather than inventing a matte-background color.
      else if (strength >= 0.5) setPixel(x, y, currentChar);
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
      const original = parseRgb(pal()[source[y][x]]);
      if (!original) continue; // blur color, but never grow the silhouette
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = -sampleRadius; sy <= sampleRadius; sy++) {
        for (let sx = -sampleRadius; sx <= sampleRadius; sx++) {
          if (Math.hypot(sx, sy) > sampleRadius + 0.25) continue;
          const sample = parseRgb(pal()[source[y + sy]?.[x + sx]]);
          if (!sample) continue;
          r += sample.r;
          g += sample.g;
          b += sample.b;
          count++;
        }
      }
      if (!count) continue;
      const average = { r: r / count, g: g / count, b: b / count };
      setPixel(x, y, paletteCharFor(mixRgb(original, average, strength)));
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
  if (e.altKey && e.shiftKey && selectedAnchorName) {
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
  if (e.altKey || currentTool === 'picker') {
    e.preventDefault();
    if (e.button !== 0) return;
    picking = true;
    pickColor(e);
    return;
  }
  if (currentTool === 'select') {
    e.preventDefault();
    if (e.button === 2) {
      setSelection(null);
      void publishSelection();
      return;
    }
    if (e.button !== 0) return;
    const handle = selectionHandleAt(e);
    if (selection && handle) {
      beginSelectionHandleTransform(handle, e);
      return;
    }
    const point = gridCell(e);
    if (selection && pointInRect(point, selection)) {
      beginSelectionMove(point);
      return;
    }
    selectionStart = point;
    ($('selectionAngle') as HTMLInputElement).value = '0';
    setSelection({ x: point.x, y: point.y, w: 1, h: 1 });
    return;
  }
  saveHistory();
  erasing = e.button === 2;
  painting = true;
  lastPaintCell = null;
  paint(e);
});
grid.addEventListener('mousemove', (e) => {
  hoverPointer = { x: e.clientX, y: e.clientY };
  updateBrushCursor();
  if (picking) {
    pickColor(e, false);
    return;
  }
  if (selectionHandleTransform) {
    updateSelectionHandleTransform(e);
    return;
  }
  if (selectionStart) {
    const point = gridCell(e);
    const x = Math.min(selectionStart.x, point.x);
    const y = Math.min(selectionStart.y, point.y);
    setSelection({ x, y, w: Math.abs(point.x - selectionStart.x) + 1, h: Math.abs(point.y - selectionStart.y) + 1 });
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
  if (selectionStart) {
    selectionStart = null;
    void publishSelection();
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
    const moved = selectionHandleTransform.moved;
    const handle = selectionHandleTransform.handle;
    selectionHandleTransform = null;
    if (moved) {
      syncIO();
      void publishSelection();
      flash(handle === 'rotate' ? 'rotated selection' : 'resized selection');
    }
    ($('selectionAngle') as HTMLInputElement).value = '0';
    grid.style.cursor = currentTool === 'select' ? 'cell' : '';
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
  currentChar = cur()[y][x];
  buildPalette();
  if (announce) {
    const color = pal()[currentChar];
    flash(currentChar === '.' ? `picked transparency at ${x},${y}` : `picked ${currentChar} ${color} at ${x},${y}`);
  }
}

function pointInRect(point: { x: number; y: number }, rect: PixelRect): boolean {
  return point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.w && point.y < rect.y + rect.h;
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

function clearRect(rows: string[], rect: PixelRect): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    rows[y] = rows[y].slice(0, rect.x) + '.'.repeat(rect.w) + rows[y].slice(rect.x + rect.w);
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
      const pixel = clip.rows[dy][dx];
      if (pixel !== '.') destination[x + dx] = pixel;
    }
    rows[y + dy] = destination.join('');
  }
}

function beginSelectionMove(point: { x: number; y: number }): void {
  if (!selection) return;
  const original = { ...selection };
  const baseFrame = cur().slice();
  const source = pixelsInRect(original, baseFrame);
  clearRect(baseFrame, original);
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
  setSelection({ x, y, w: selectionMove.original.w, h: selectionMove.original.h });
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
  if (currentTool !== 'select' || !selection) return null;
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
  if (currentTool !== 'select' || !selection || !e) {
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
  if (pointInRect(gridCell(e), selection)) {
    grid.classList.add('selection-movable');
    grid.style.cursor = 'move';
  } else {
    grid.style.cursor = 'cell';
  }
}

function beginSelectionHandleTransform(handle: SelectionHandle, e: MouseEvent): void {
  if (!selection) return;
  const original = { ...selection };
  const sourceFrame = cur().slice();
  const baseFrame = sourceFrame.slice();
  clearRect(baseFrame, original);
  const pointer = gridPointer(e);
  const centerX = original.x + original.w / 2;
  const centerY = original.y + original.h / 2;
  selectionHandleTransform = {
    handle,
    original,
    source: pixelsInRect(original, sourceFrame),
    baseFrame,
    startPointer: pointer,
    startAngle: Math.atan2(pointer.y - centerY, pointer.x - centerX),
    lastKey: '',
    moved: false,
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
  setSelection({ x, y, w: clip.w, h: clip.h });
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
  if (transform.handle.includes('w')) left = Math.max(0, Math.min(right - 1, Math.round(pointer.x)));
  if (transform.handle.includes('e')) right = Math.max(left + 1, Math.min(W(), Math.round(pointer.x)));
  if (transform.handle.includes('n')) top = Math.max(0, Math.min(bottom - 1, Math.round(pointer.y)));
  if (transform.handle.includes('s')) bottom = Math.max(top + 1, Math.min(H(), Math.round(pointer.y)));
  const width = right - left;
  const height = bottom - top;
  const scaled = scaleSelectionRows(transform.source, width, height);
  applyLiveSelectionTransform(transform, scaled, left, top, `resize:${left},${top},${width},${height}`);
}

function setSelection(next: PixelRect | null): void {
  selection = next;
  ($('btnCut') as HTMLButtonElement).disabled = !selection;
  ($('btnCopy') as HTMLButtonElement).disabled = !selection;
  for (const id of ['btnRotateSelectionLeft', 'btnRotateSelectionRight', 'btnRotateSelection', 'btnResizeSelection']) {
    ($(id) as HTMLButtonElement).disabled = !selection;
  }
  const selectionW = $('selectionW') as HTMLInputElement;
  const selectionH = $('selectionH') as HTMLInputElement;
  const selectionAngle = $('selectionAngle') as HTMLInputElement;
  selectionW.disabled = !selection;
  selectionH.disabled = !selection;
  selectionAngle.disabled = !selection;
  if (selection) {
    selectionW.value = String(selection.w);
    selectionH.value = String(selection.h);
  }
  $('selectionStatus').textContent = selection
    ? `selection: ${selection.w}x${selection.h} at ${selection.x},${selection.y} · shared with agent`
    : 'selection: none';
  redraw();
}

function clearSelection(publish = true): void {
  selectionStart = null;
  selectionMove = null;
  selectionHandleTransform = null;
  grid.classList.remove('selection-movable');
  grid.style.cursor = '';
  setSelection(null);
  if (publish) void publishSelection();
}

function paint(e: MouseEvent): void {
  const r = grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / cellSize);
  const y = Math.floor((e.clientY - r.top) / cellSize);
  if (currentTool === 'fill') {
    floodFill(x, y, erasing ? '.' : currentChar);
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
      buildFrames();
      buildAnchors();
      redraw();
      void publishSelection();
    };
    host.appendChild(b);
  });
  $('frameOf').textContent = `${animName} · ${frameIdx + 1}/${anim().frames.length}`;
  ($('btnFrameFirst') as HTMLButtonElement).disabled = frameIdx === 0;
}

$('btnAddFrame').onclick = () => {
  saveHistory();
  anim().frames.push(emptyFrame(W(), H()));
  for (const anchors of Object.values(file.anchors ?? {})) {
    const points = anchors[concreteAnimName()];
    if (points) points.push({ ...(points.at(-1) ?? { x: W() / density() / 2, y: H() / density() / 2 }) });
  }
  frameIdx = anim().frames.length - 1;
  buildFrames();
  buildAnchors();
  redraw();
  syncIO();
};
$('btnDupFrame').onclick = () => {
  saveHistory();
  anim().frames.splice(frameIdx + 1, 0, [...cur()]);
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
$('btnFrameFirst').onclick = () => {
  if (frameIdx === 0) return;
  saveHistory();
  const first = frameIdx;
  const frames = anim().frames;
  frames.push(...frames.splice(0, first));
  for (const anchors of Object.values(file.anchors ?? {})) {
    const points = anchors[concreteAnimName()];
    if (points?.length === frames.length) points.push(...points.splice(0, first));
  }
  frameIdx = 0;
  buildFrames();
  buildAnchors();
  redraw();
  syncIO();
  flash(`frame ${first + 1} is now frame 1`);
};
$('btnDelFrame').onclick = () => {
  if (anim().frames.length <= 1) return;
  saveHistory();
  anim().frames.splice(frameIdx, 1);
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
  for (const [, a] of concreteAnims()) {
    a.frames = a.frames.map((f: string[]) => {
      const next: string[] = [];
      for (let y = 0; y < h; y++) next.push((f[y] ?? '').slice(0, w).padEnd(w, '.'));
      return next;
    });
  }
  redraw();
  syncIO();
};

function redraw(): void {
  grid.width = W() * cellSize;
  grid.height = H() * cellSize;
  gctx.imageSmoothingEnabled = false;

  // 1. Draw base background (gaps/borders)
  gctx.fillStyle = '#080a18';
  gctx.fillRect(0, 0, grid.width, grid.height);

  // 2. Draw inset checkerboard for all cells
  const inset = Math.max(1, Math.min(3, Math.floor(cellSize / 8)));
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      gctx.fillStyle = (x + y) % 2 ? '#141830' : '#0f1226';
      gctx.fillRect(x * cellSize + inset, y * cellSize + inset, cellSize - inset * 2, cellSize - inset * 2);
      
      gctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      gctx.strokeRect(x * cellSize + inset + 0.5, y * cellSize + inset + 0.5, cellSize - inset * 2 - 1, cellSize - inset * 2 - 1);
    }
  }

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
    const prevFrame = anim().frames[frameIdx - 1];
    if (prevFrame) {
      gctx.save();
      gctx.globalAlpha = 0.2;
      for (let y = 0; y < H(); y++) {
        for (let x = 0; x < W(); x++) {
          const color = pal()[prevFrame[y]?.[x]];
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
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      const color = pal()[cur()[y][x]];
      if (color) {
        gctx.fillStyle = color;
        gctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  // 6. Grid lines
  gctx.strokeStyle = 'rgba(148,176,194,0.1)';
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
    gctx.fillRect(x, y, w, h);
    gctx.strokeStyle = '#ffcd75';
    gctx.lineWidth = 2;
    gctx.setLineDash([Math.max(3, cellSize / 3), Math.max(2, cellSize / 5)]);
    gctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
    gctx.restore();

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

function maybeRebakeEditedEquipment(): void {
  if (rebuiltVersion === editVersion) return;
  rebuiltVersion = editVersion;
  if (currentRepoPath === 'knight.json' || currentFileName === 'knight.json') {
    rebuildKnightSprite(file);
    // Player copied the old anim set during construction; rebuild the
    // render-only mannequin so the shared draft appears immediately.
    posePlayer = null;
    posePlayerError = '';
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
function movesOf(weaponId: string): { key: string; label: string; def: ReturnType<typeof allAttacks>[number] }[] {
  const type = weaponTypeOf(weapons.get(weaponId));
  const out: { key: string; label: string; def: ReturnType<typeof allAttacks>[number] }[] = [];
  type.attacks.forEach((def, i) => out.push({ key: `combo${i}`, label: `combo ${i + 1}`, def }));
  for (const key of ['aerial', 'plunge', 'upper', 'dashAttack'] as const) {
    const def = type[key];
    if (def) out.push({ key, label: key === 'dashAttack' ? 'dash' : key, def });
  }
  return out;
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
function drawAttackBox(
  g: CanvasRenderingContext2D,
  def: ReturnType<typeof allAttacks>[number],
  body: { x: number; y: number; w: number; h: number },
  progress: number,
): void {
  const hb = def.hitbox;
  const aim = def.aim ?? 'forward';
  const cx = body.x + body.w / 2;
  const rect = aim === 'down'
    ? { x: cx - hb.w / 2, y: body.y + body.h + hb.forward, w: hb.w, h: hb.h }
    : aim === 'up'
      ? { x: cx - hb.w / 2, y: body.y - hb.forward - hb.h, w: hb.w, h: hb.h }
      : { x: body.x + body.w + hb.forward, y: body.y + body.h / 2 - hb.h / 2 + hb.y, w: hb.w, h: hb.h };
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
 * The joint view: body + held weapon + attack trail on one clock,
 * drawn by the same code the game uses (see Player.render — body at a
 * feet origin, weapon inside that transform, trail in world space).
 *
 * One cycle = the attack's real duration plus a beat of hold, or the
 * animation's own length if that is longer, so the trail sweeps at its
 * true speed and you still get a readable pause between swings.
 */
function renderComposite(t: number): boolean {
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
  // Long moves are time-compressed. The plunge's 0.9s duration is a
  // MAXIMUM — in play the landing cuts it short — so previewed raw it
  // is three-quarters of a second of nothing moving. Compression sweeps
  // the full progress on a shorter wall clock; every trail and pose
  // clock is a fraction of progress, so the whole move scales together.
  // The label owns up to it with an xN tag.
  const ATTACK_PREVIEW_CAP = 0.5;
  const realDur = atkDef?.duration ?? 0;
  const speedup = realDur > ATTACK_PREVIEW_CAP ? realDur / ATTACK_PREVIEW_CAP : 1;
  const moveTag = move ? ` [${move.label}${speedup > 1 ? ` x${speedup.toFixed(1)}` : ''}]` : '';
  // When the previewed anim isn't one this weapon attacks WITH, say
  // where the attack lives instead of only that it's absent.
  const noAttackHint = !hasWeapon || atkDef
    ? ''
    : `  (attacks play on: ${[...new Set(moves.map((m) => m.def.animation))].join(', ') || 'none'})`;

  const fps = a.fps || 1;
  const animCycle = a.frames.length / fps;
  const dur = Math.min(realDur, ATTACK_PREVIEW_CAP);
  const cycle = Math.max(animCycle, dur + 0.35);
  const tIn = t % cycle;
  const pose = atkDef && tIn <= dur
    ? { progress: Math.min(1, tIn / dur), def: atkDef }
    : undefined;

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
  pctx.fillStyle = '#0a0c1c';
  pctx.fillRect(0, 0, preview.width, preview.height);
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
      p.animT = tIn;
      p.renderTrail = ($('compTrail') as HTMLInputElement).checked;
      p.poseAttack(pose ? pose.def : null, pose ? pose.progress : 0);
      p.x = fx - p.w / 2;
      p.y = fy - p.h;
      try {
        p.render(pctx);
      } catch (e) {
        posePlayerError = String(e);
      }
      // The player's own box math is the truth; draw straight from it.
      if (pose && ($('compHitbox') as HTMLInputElement).checked) {
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
  if (bodySel === 'knight') {
    const set = KNIGHT_ANIMS.right;
    const ka = set[animName] ?? set.idle ?? Object.values(set)[0];
    frame = ka.loop === false
      ? Math.min(Math.floor(tIn * ka.fps), ka.frames.length - 1)
      : Math.floor(tIn * ka.fps) % ka.frames.length;
    bodyImg = ka.frames[frame];
    dw = baseKnight.w;
    dh = baseKnight.h;
  } else {
    frame = a.loop === false
      ? Math.min(Math.floor(tIn * fps), a.frames.length - 1)
      : Math.floor(tIn * fps) % a.frames.length;
    const rows = a.frames[frame] ?? [];
    bodyImg = sprite(file.hd === false ? rows : epx(epx(rows)), pal());
    const geo = geometryOf(file, rows);
    dw = geo.w;
    dh = geo.h;
  }

  pctx.save();
  pctx.translate(fx, fy);
  pctx.drawImage(bodyImg, -dw / 2, -dh, dw, dh);
  // Attachment points are authored from the sheet's top-left, while
  // held-weapon renderers work from the player's feet-centred origin.
  // Feed the raw-sheet composite the same converted hand anchors that
  // Player.render uses; otherwise it silently falls back to a generic
  // hand position and cannot reveal handedness mistakes in draft art.
  const sheetAnchor = (name: string): { x: number; y: number } | undefined => {
    const point = bodySel === 'knight'
      ? baseKnight.anchor?.(name, animName, frame)
      : file.anchors?.[name]?.[concreteAnimName()]?.[frame];
    return point ? { x: point.x - dw / 2, y: point.y - dh } : undefined;
  };
  // The weapon draw needs an animation its sheet actually has; outside
  // an attack pose, fall back to idle rather than throwing mid-paint.
  const known = weaponVisuals.get(wdef!.visual).animations;
  const weaponAnim = !known || known.includes(animName) ? animName : 'idle';
  try {
    drawHeldWeapon(pctx, wdef!.visual, {
      facing: 1, anim: weaponAnim, frame, animT: tIn,
      bodyW: dw, bodyH: dh,
      frontHand: sheetAnchor('frontHand'),
      rearHand: sheetAnchor('rearHand'),
      attack: pose,
    });
  } catch { /* a half-painted sheet mid-edit; next frame will catch up */ }
  pctx.restore();

  if (pose && ($('compTrail') as HTMLInputElement).checked) {
    try {
      drawWeaponTrail(pctx, wdef!.visual, {
        x: fx, y: fy - dh * 0.45, facing: 1,
        colors: [...wdef!.colors], attack: pose,
      });
    } catch { /* ditto */ }
  }
  // dw/dh are the sprite's DECLARED physical dims (see above), which is
  // the body the game's box math would use.
  if (pose && ($('compHitbox') as HTMLInputElement).checked) {
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

function renderPreview(): void {
  maybeRebakeEditedEquipment();
  const hd = ($('hd') as HTMLInputElement).checked;
  const p = pal();
  const t = performance.now() / 1000;

  const composite = renderComposite(t);
  // Give the game-scale composite the panel width it needs; hand the
  // space back the moment the weapon is deselected.
  $('side-right').classList.toggle('wide', composite);
  if (composite) {
    requestAnimationFrame(renderPreview);
    return;
  }

  const a = anim();
  if (!a || !a.frames.length) {
    requestAnimationFrame(renderPreview);
    return;
  }

  const idx = Math.floor(t * (a.fps || 1)) % a.frames.length;
  const rows = a.frames[idx] ?? [];

  const { w, h, hitbox } = geometryOf(file, rows);

  const displayW = w * 8; // scaled by ZOOM (4) * WORLD_ZOOM (2) = 8
  const displayH = h * 8;

  preview.width = displayW + 16;
  preview.height = displayH + 24;

  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#0a0c1c';
  pctx.fillRect(0, 0, preview.width, preview.height);

  // Draw active animation text label
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
      const refIdx = refAnim.frames.length ? Math.floor(t * (refAnim.fps || 1)) % refAnim.frames.length : 0;
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
      file = normalize(JSON.parse(String(reader.result)));
      animName = Object.keys(file.anims)[0];
      frameIdx = 0;
      currentChar = firstPaintChar();
      currentFileName = f.name;
      currentRepoPath = null;
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
  try {
    file = existingSprite(val);
    animName = Object.keys(file.anims)[0];
    frameIdx = 0;
    currentChar = firstPaintChar();
    editVersion++;

    const parts = val.split('/');
    currentFileName = parts[parts.length - 1];
    currentRepoPath = val;

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
  grid.classList.toggle('selecting', visibleTool === 'select');
  grid.classList.toggle('picking', visibleTool === 'picker');
  grid.classList.toggle('soft-tool', visibleTool === 'brush' || visibleTool === 'blur');
  if (visibleTool !== 'select') {
    grid.classList.remove('selection-movable');
    grid.style.cursor = '';
  } else if (!selectionHandleTransform) {
    grid.style.cursor = 'cell';
  }
  updateBrushCursor();
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
  currentTool = tool;
  updateToolUI();
  redraw();
}

$('btnToolDraw').onclick = () => setTool('draw');
$('btnToolBrush').onclick = () => setTool('brush');
$('btnToolBlur').onclick = () => setTool('blur');
$('btnToolFill').onclick = () => setTool('fill');
$('btnToolPicker').onclick = () => setTool('picker');
$('btnToolSelect').onclick = () => setTool('select');

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
  pixelClipboard = { w: snapshot.w, h: snapshot.h, rows: snapshot.rows };
  const envelope = JSON.stringify({ kind: 'hitstop-sprite-selection', v: 1, ...snapshot });
  void navigator.clipboard?.writeText(envelope).catch(() => {});
  flash(`copied ${snapshot.w}x${snapshot.h} pixels`);
  return pixelClipboard;
}

function cutSelection(): void {
  if (!selection || !copySelection()) return;
  saveHistory();
  for (let y = selection.y; y < selection.y + selection.h; y++) {
    const row = cur()[y];
    cur()[y] = row.slice(0, selection.x) + '.'.repeat(selection.w) + row.slice(selection.x + selection.w);
  }
  redraw();
  syncIO();
  void publishSelection();
  flash(`cut ${selection.w}x${selection.h} pixels`);
}

function parsePixelClipboard(text: string): PixelClipboard | null {
  try {
    const value = JSON.parse(text) as { kind?: unknown; w?: unknown; h?: unknown; rows?: unknown };
    if (value.kind !== 'hitstop-sprite-selection' || !Number.isInteger(value.w) || !Number.isInteger(value.h)
      || !Array.isArray(value.rows) || !value.rows.every((row) => typeof row === 'string')) return null;
    const w = Number(value.w);
    const h = Number(value.h);
    if (w < 1 || h < 1 || value.rows.length !== h || value.rows.some((row) => row.length !== w)) return null;
    return { w, h, rows: value.rows as string[] };
  } catch {
    return null;
  }
}

async function pasteSelection(): Promise<void> {
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
  const rows = cur().slice();
  // A copied selection behaves like an image object: transparent pixels
  // reveal the destination instead of punching holes through it.
  pastePixels(rows, clip, x, y, true);
  anim().frames[frameIdx] = rows;
  editVersion++;
  setSelection({ x, y, w: pastedW, h: pastedH });
  syncIO();
  void publishSelection();
  flash(`pasted ${pastedW}x${pastedH} pixels`);
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
  clearRect(rows, selection);
  pastePixels(rows, clip, x, y, true);
  anim().frames[frameIdx] = rows;
  editVersion++;
  setSelection({ x, y, w: clip.w, h: clip.h });
  syncIO();
  void publishSelection();
  flash(message);
}

function moveSelectionBy(dx: number, dy: number): void {
  if (!selection) return;
  const x = Math.max(0, Math.min(W() - selection.w, selection.x + dx));
  const y = Math.max(0, Math.min(H() - selection.h, selection.y + dy));
  if (x === selection.x && y === selection.y) return;
  commitSelectionPixels(pixelsInRect(selection), x, y, `moved selection to ${x},${y}`);
}

function scaleSelectionRows(source: PixelClipboard, w: number, h: number): PixelClipboard {
  return {
    w,
    h,
    rows: Array.from({ length: h }, (_, y) => {
      const sourceY = Math.min(source.h - 1, Math.floor(y * source.h / h));
      return Array.from({ length: w }, (_, x) => {
        const sourceX = Math.min(source.w - 1, Math.floor(x * source.w / w));
        return source.rows[sourceY][sourceX];
      }).join('');
    }),
  };
}

function resizeSelection(): void {
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
  const source = pixelsInRect(selection);
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
  };
}

function rotateSelectionBy(degrees: number, message?: string): void {
  if (!selection || !Number.isFinite(degrees)) return;
  if (Math.abs(degrees % 360) < 0.0001) {
    flash('enter a non-zero rotation');
    return;
  }
  const source = pixelsInRect(selection);
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
    return;
  }
  try {
    refFile = existingSprite(val);
    redraw();
    flash(`loaded reference: ${val}`);
  } catch (err) {
    flash(`reference load failed: ${(err as Error).message}`);
  }
};

($('showRef') as HTMLInputElement).onchange = () => redraw();
($('onionSkin') as HTMLInputElement).onchange = () => redraw();

$('btnNudgeLeft').onclick = () => nudge(-1, 0);
$('btnNudgeRight').onclick = () => nudge(1, 0);
$('btnNudgeUp').onclick = () => nudge(0, -1);
$('btnNudgeDown').onclick = () => nudge(0, 1);

function nudge(dx: number, dy: number): void {
  saveHistory();
  const w = W();
  const h = H();
  const f = cur();
  const next: string[] = [];
  
  for (let y = 0; y < h; y++) {
    const srcY = (y - dy + h) % h;
    let row = '';
    for (let x = 0; x < w; x++) {
      const srcX = (x - dx + w) % w;
      row += f[srcY][srcX];
    }
    next.push(row);
  }
  
  anim().frames[frameIdx] = next;
  const logicalW = w / density();
  const logicalH = h / density();
  const concrete = concreteAnimName();
  let movedAnchor = false;
  for (const groups of Object.values(file.anchors ?? {})) {
    const point = groups[concrete]?.[frameIdx];
    if (!point) continue;
    point.x = (point.x + dx / density() + logicalW) % logicalW;
    point.y = (point.y + dy / density() + logicalH) % logicalH;
    movedAnchor = true;
  }
  if (movedAnchor) buildAnchors();
  redraw();
  syncIO();
}

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
  if (e.key === 'Alt') {
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
  if (!typing && key === 'm' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    setTool('select');
  }
  if (!typing && selection && currentTool === 'select' && key.startsWith('arrow')) {
    e.preventDefault();
    const distance = e.shiftKey ? 4 : 1;
    if (key === 'arrowleft') moveSelectionBy(-distance, 0);
    else if (key === 'arrowright') moveSelectionBy(distance, 0);
    else if (key === 'arrowup') moveSelectionBy(0, -distance);
    else if (key === 'arrowdown') moveSelectionBy(0, distance);
  }
  if (!typing && !e.ctrlKey && !e.metaKey) {
    const shortcut: Partial<Record<string, EditorTool>> = {
      p: 'draw',
      b: 'brush',
      u: 'blur',
      g: 'fill',
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
  if (e.key !== 'Alt') return;
  e.preventDefault();
  altPickerActive = false;
  updateToolUI();
});

window.addEventListener('blur', () => {
  altPickerActive = false;
  picking = false;
  updateToolUI();
});

($('hd') as HTMLInputElement).onchange = (e) => {
  file.hd = (e.target as HTMLInputElement).checked;
  syncIO();
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
  buildPalette();
  buildAnims();
  buildFrames();
  buildAnchors();
  redraw();
  syncIO();

  const hdCheckbox = $('hd') as HTMLInputElement;
  if (hdCheckbox) hdCheckbox.checked = file.hd ?? true;
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
      rememberForUndo();
      file = normalize(structuredClone(next));
      currentRepoPath = path;
      currentFileName = path?.split('/').at(-1) ?? currentFileName;
      animName = Object.keys(file.anims)[0];
      frameIdx = 0;
      currentChar = firstPaintChar();
      editVersion++;
      refreshUI();
      updateUndoRedoButtons();
      void publishSharedSprite();
    },
    setPixels(changes: { anim?: string; frame?: number; pixels: { x: number; y: number; char: string }[] }) {
      const targetName = changes.anim ?? animName;
      const targetAnim = resolveAnim(file, targetName);
      if (!targetAnim) throw new Error(`unknown animation "${targetName}"`);
      const targetFrame = changes.frame ?? frameIdx;
      const rows = targetAnim.frames[targetFrame];
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
    save() { return saveSharedSprite(); },
  },
});

// Composite weapon picker: every registered weapon except bare hands.
{
  const sel = $('compWeapon') as HTMLSelectElement;
  sel.onchange = () => rebuildMoveSelect(sel.value);
  for (const id of weapons.ids()) {
    if (id === 'unarmed') continue;
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
}

rebuildMoveSelect(($('compWeapon') as HTMLSelectElement).value);
renderPreview();
updateBridgeStatus();
void initializeBridge();
window.setInterval(() => void publishSharedSprite(), 160);
