import { tiles, buildTilemap, validateRoom, type RoomDef } from '@engine/index';
import '@game/content/tiles';
import '@game/actors/enemies';
import { monsters } from '@game/actors/monster';
import arenaJson from '@game/content/rooms/arena.json';

/**
 * Level editor.
 *
 * Everything it knows comes from the same registries the game uses:
 * the tile palette is whatever content registered in `tiles`, the entity
 * palette is whatever registered in `monsters`. Register a new tile or
 * monster and it shows up here with zero editor changes.
 *
 * Rooms are edited in the RoomDef JSON format (see engine/level/room.ts).
 * "Test play" writes the room to localStorage and opens the game with
 * ?room=local for an instant edit → play loop.
 */

const ZOOM = 3;

type Mode = 'tile' | 'entity' | 'spawn';

/* ---------------- state ---------------- */

let room: RoomDef = structuredClone(arenaJson) as RoomDef;
let mode: Mode = 'tile';
/** Selected legend char in tile mode. */
let tileChar = '#';
let entityType = 'slime';
let painting = false;
let erasing = false;

/** Chars available for the legend, in palette order. */
const LEGEND_CHARS = ['#', '=', '-', '~', '%', '&', '@', '$'];

/* ---------------- dom ---------------- */

const canvas = document.getElementById('ed') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const $ = (id: string) => document.getElementById(id)!;
const status = $('status');

function flash(msg: string): void {
  status.textContent = msg;
  setTimeout(() => {
    if (status.textContent === msg) status.textContent = '';
  }, 2000);
}

/* ---------------- palettes ---------------- */

function charForTile(tileId: string): string | undefined {
  for (const [ch, id] of Object.entries(room.legend)) if (id === tileId) return ch;
  return undefined;
}

/** Ensure a legend char exists for a tile id, allocating one if needed. */
function ensureLegend(tileId: string): string {
  const existing = charForTile(tileId);
  if (existing) return existing;
  const used = new Set(Object.keys(room.legend));
  const ch = LEGEND_CHARS.find((c) => !used.has(c));
  if (!ch) throw new Error('out of legend characters');
  room.legend[ch] = tileId;
  return ch;
}

function buildModeButtons(): void {
  const host = $('modes');
  host.innerHTML = '';
  (['tile', 'entity', 'spawn'] as Mode[]).forEach((m) => {
    const b = document.createElement('button');
    b.textContent = m === 'spawn' ? 'player spawn' : m === 'tile' ? 'tiles' : 'entities';
    b.className = mode === m ? 'active' : '';
    b.onclick = () => {
      mode = m;
      buildModeButtons();
    };
    host.appendChild(b);
    host.appendChild(document.createTextNode(' '));
  });
}

function buildTilePalette(): void {
  const host = $('tiles');
  host.innerHTML = '';
  for (const id of tiles.ids()) {
    if (id === '') continue;
    const row = document.createElement('div');
    row.className = 'swatch';
    // Render one tile as its swatch.
    const chipCanvas = document.createElement('canvas');
    chipCanvas.width = chipCanvas.height = room.tileSize;
    chipCanvas.className = 'chip';
    tiles.get(id).draw?.(chipCanvas.getContext('2d')!, 0, 0, room.tileSize, 0, 0);
    const b = document.createElement('button');
    const ch = charForTile(id);
    b.textContent = `${id}${ch ? ` (${ch})` : ''}`;
    b.className = mode === 'tile' && room.legend[tileChar] === id ? 'active' : '';
    b.onclick = () => {
      mode = 'tile';
      tileChar = ensureLegend(id);
      refreshUI();
    };
    row.appendChild(chipCanvas);
    row.appendChild(b);
    host.appendChild(row);
  }
}

function buildEntityPalette(): void {
  const host = $('entities');
  host.innerHTML = '';
  for (const id of monsters.ids()) {
    const def = monsters.get(id);
    const row = document.createElement('div');
    row.className = 'swatch';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = def.colors[0];
    const b = document.createElement('button');
    b.textContent = `${id} (hp ${def.hp})`;
    b.className = mode === 'entity' && entityType === id ? 'active' : '';
    b.onclick = () => {
      mode = 'entity';
      entityType = id;
      refreshUI();
    };
    row.appendChild(chip);
    row.appendChild(b);
    host.appendChild(row);
  }
}

/* ---------------- editing ---------------- */

function setTile(tx: number, ty: number, ch: string): void {
  if (tx < 0 || ty < 0 || ty >= room.tiles.length) return;
  const row = room.tiles[ty];
  if (tx >= row.length) return;
  room.tiles[ty] = row.slice(0, tx) + ch + row.slice(tx + 1);
}

function cellFromEvent(e: MouseEvent): { tx: number; ty: number; x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / ZOOM;
  const y = (e.clientY - r.top) / ZOOM;
  return { tx: Math.floor(x / room.tileSize), ty: Math.floor(y / room.tileSize), x, y };
}

function applyPaint(e: MouseEvent): void {
  const { tx, ty, x, y } = cellFromEvent(e);
  if (mode === 'tile') {
    setTile(tx, ty, erasing ? '.' : tileChar);
    redraw();
  } else if (mode === 'entity') {
    if (erasing) {
      const idx = room.entities.findIndex(
        (en) => Math.abs(en.x - x) < 12 && Math.abs(en.y - y) < 12,
      );
      if (idx >= 0) room.entities.splice(idx, 1);
    } else if (!painting) {
      const def = monsters.get(entityType);
      room.entities.push({
        type: entityType,
        x: Math.round(x - def.w / 2),
        y: Math.round(y - def.h),
      });
    }
    redraw();
  } else if (mode === 'spawn' && !erasing) {
    room.playerSpawn = { x: Math.round(x), y: Math.round(y) };
    redraw();
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  erasing = e.button === 2;
  applyPaint(e);
  painting = true;
});
canvas.addEventListener('mousemove', (e) => {
  if (painting && mode === 'tile') applyPaint(e);
});
window.addEventListener('mouseup', () => {
  painting = false;
  syncJson();
});

/* ---------------- rendering ---------------- */

function redraw(): void {
  const tilemap = buildTilemap(room);
  canvas.width = tilemap.worldW * ZOOM;
  canvas.height = tilemap.worldH * ZOOM;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(ZOOM, 0, 0, ZOOM, 0, 0);

  ctx.fillStyle = '#0a0c1c';
  ctx.fillRect(0, 0, tilemap.worldW, tilemap.worldH);
  tilemap.render(ctx, 0, 0, tilemap.worldW, tilemap.worldH);

  // Grid.
  ctx.strokeStyle = 'rgba(148,176,194,0.08)';
  ctx.lineWidth = 1 / ZOOM;
  for (let x = 0; x <= tilemap.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * room.tileSize, 0);
    ctx.lineTo(x * room.tileSize, tilemap.worldH);
    ctx.stroke();
  }
  for (let y = 0; y <= tilemap.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * room.tileSize);
    ctx.lineTo(tilemap.worldW, y * room.tileSize);
    ctx.stroke();
  }

  // Entities.
  for (const en of room.entities) {
    const def = monsters.has(en.type) ? monsters.get(en.type) : null;
    ctx.fillStyle = def ? def.colors[0] : '#b13e53';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(en.x, en.y, def?.w ?? 10, def?.h ?? 10);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f4f4f4';
    ctx.font = '4px monospace';
    ctx.fillText(en.type, en.x, en.y - 1);
  }

  // Player spawn.
  ctx.strokeStyle = '#38b764';
  ctx.lineWidth = 2 / ZOOM;
  ctx.strokeRect(room.playerSpawn.x - 5, room.playerSpawn.y - 7, 10, 14);
  ctx.fillStyle = '#38b764';
  ctx.font = '4px monospace';
  ctx.fillText('spawn', room.playerSpawn.x - 5, room.playerSpawn.y - 9);
}

/* ---------------- io ---------------- */

function syncJson(): void {
  ($('json') as HTMLTextAreaElement).value = JSON.stringify(room, null, 1);
  ($('roomName') as HTMLInputElement).value = room.name;
  ($('cols') as HTMLInputElement).value = String(room.tiles[0]?.length ?? 0);
  ($('rows') as HTMLInputElement).value = String(room.tiles.length);
}

function refreshUI(): void {
  buildModeButtons();
  buildTilePalette();
  buildEntityPalette();
  syncJson();
  redraw();
}

$('btnExport').onclick = () => {
  syncJson();
  ($('json') as HTMLTextAreaElement).select();
  navigator.clipboard?.writeText(JSON.stringify(room, null, 1));
  flash('copied to clipboard');
};

$('btnImport').onclick = () => {
  try {
    room = validateRoom(JSON.parse(($('json') as HTMLTextAreaElement).value));
    refreshUI();
    flash('imported');
  } catch (err) {
    flash(`import failed: ${(err as Error).message}`);
  }
};

$('btnDownload').onclick = () => {
  const blob = new Blob([JSON.stringify(room, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${room.name || 'room'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('btnPlay').onclick = () => {
  room.name = ($('roomName') as HTMLInputElement).value || room.name;
  localStorage.setItem('hitstop.room', JSON.stringify(room));
  window.open('/?room=local', 'hitstop-testplay');
};

($('roomName') as HTMLInputElement).onchange = (e) => {
  room.name = (e.target as HTMLInputElement).value;
  syncJson();
};

$('btnResize').onclick = () => {
  const cols = Number(($('cols') as HTMLInputElement).value);
  const rows = Number(($('rows') as HTMLInputElement).value);
  if (!(cols >= 20 && rows >= 10)) {
    flash('too small');
    return;
  }
  const next: string[] = [];
  for (let y = 0; y < rows; y++) {
    const src = room.tiles[y] ?? '';
    next.push(src.slice(0, cols).padEnd(cols, '.'));
  }
  room.tiles = next;
  refreshUI();
};

refreshUI();
