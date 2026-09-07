import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  isLayeredSpriteFile,
  resolveAnimName,
  type SpriteFile,
} from '../src/engine/gfx/spritefile';
import { validateSpriteEditorDocument } from './src/sprite-editor-document';
import { validateRenderTagDefs, validateWeaponCombatTuning } from './src/sprite-editor-workspace';
import { analyzeSelectionGeometry } from './src/sprite-editor-selection';
import {
  applySpriteAgentTransaction,
  inspectSpriteAgentDocument,
  spriteAgentSourcePaths,
  SPRITE_AGENT_CAPABILITIES,
  SPRITE_AGENT_MAX_INSPECTIONS,
  SPRITE_AGENT_PROTOCOL_VERSION,
  type SpriteAgentCommand,
  type SpriteAgentCursor,
  type SpriteAgentFrameQuery,
  type SpriteAgentTransaction,
} from './src/sprite-editor-agent';

const API = '/__sprite-editor';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_WORKSPACE_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

interface ActiveSprite {
  path: string | null;
  file: unknown;
  revision: number;
  source: string;
  updatedAt: number;
  dirty: boolean;
  /** Last agent-targeted editor location; document revisions remain authoritative. */
  cursor?: SpriteAgentCursor;
}

interface ActiveSelection {
  path: string | null;
  anim: string;
  frame: number;
  layerId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: string[];
  mask?: string[];
  source: string;
  updatedAt: number;
}

interface NamedSelection extends ActiveSelection {
  name: string;
  createdAt: number;
}

interface NamedSelectionLibrary {
  version: 1;
  selections: Record<string, NamedSelection>;
}

/**
 * Development-only bridge between the browser sprite editor and local agents.
 * The browser and the agent exchange one revisioned document; repository writes
 * are a separate, explicit operation and are confined to the sprite directory.
 */
export function spriteEditorBridge(root: string): Plugin {
  const spriteRoot = path.resolve(root, 'src/game/content/sprites');
  const renderTagsPath = path.resolve(root, 'src/game/content/render-tags.json');
  const weaponCombatPath = path.resolve(root, 'src/game/content/weapon-combat.json');
  const namedSelectionsPath = path.resolve(root, 'tools/sprite-editor-selections.json');
  let active: ActiveSprite | null = null;
  let selection: ActiveSelection | null = null;
  let preview: Buffer | null = null;
  let previewRevision = 0;
  let comparison: Buffer | null = null;
  let comparisonRevision = 0;
  const listeners = new Set<ServerResponse>();

  const publish = (): void => {
    if (!active) return;
    const message = `event: state\ndata: ${JSON.stringify(active)}\n\n`;
    for (const listener of listeners) listener.write(message);
  };

  const publishSelection = (): void => {
    const message = `event: selection\ndata: ${JSON.stringify({ selection })}\n\n`;
    for (const listener of listeners) listener.write(message);
  };

  const spritePath = (raw: unknown): { relative: string; absolute: string } => {
    const requested = String(raw ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (!requested || !requested.endsWith('.json') || requested.split('/').includes('..')) {
      throw new Error('sprite path must be a relative .json path');
    }
    const absolute = path.resolve(spriteRoot, ...requested.split('/'));
    const prefix = `${spriteRoot}${path.sep}`;
    if (!absolute.startsWith(prefix)) throw new Error('sprite path escapes the sprite directory');
    const relative = path.relative(spriteRoot, absolute).split(path.sep).join('/');
    return { relative, absolute };
  };

  const readBody = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) throw new Error('request body is too large');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  };

  const jsonBody = async (
    req: IncomingMessage,
    limit = MAX_JSON_BYTES,
  ): Promise<Record<string, unknown>> => {
    const body = await readBody(req, limit);
    if (!body.length) return {};
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON body must be an object');
    return parsed as Record<string, unknown>;
  };

  const selectionName = (raw: unknown): string => {
    const name = decodeURIComponent(String(raw ?? '')).trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) {
      throw new Error('selection name must use 1-64 letters, numbers, dots, underscores, or hyphens');
    }
    return name;
  };

  const normalizedSelection = (raw: unknown, fallbackSource = 'api'): ActiveSelection => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('selection must be an object');
    }
    const value = raw as Record<string, unknown>;
    const rows = value.rows;
    const mask = value.mask;
    const numbers = ['frame', 'x', 'y', 'w', 'h'] as const;
    if (numbers.some((key) => !Number.isInteger(value[key]))
      || Number(value.frame) < 0
      || Number(value.x) < 0 || Number(value.y) < 0 || Number(value.w) < 1 || Number(value.h) < 1
      || typeof value.anim !== 'string' || !value.anim
      || !Array.isArray(rows) || !rows.every((row) => typeof row === 'string')
      || rows.length !== Number(value.h) || rows.some((row) => row.length !== Number(value.w))) {
      throw new Error('selection needs a zero-based frame, integer bounds, animation, and matching pixel rows');
    }
    if (mask !== undefined && (!Array.isArray(mask) || mask.length !== Number(value.h)
      || !mask.every((row) => typeof row === 'string' && row.length === Number(value.w) && /^[1.]+$/.test(row)))) {
      throw new Error('selection mask must match the selection bounds');
    }
    return {
      path: value.path == null ? null : String(value.path),
      anim: value.anim,
      frame: Number(value.frame),
      layerId: value.layerId == null ? undefined : String(value.layerId),
      x: Number(value.x),
      y: Number(value.y),
      w: Number(value.w),
      h: Number(value.h),
      rows: (rows as string[]).slice(),
      mask: mask === undefined ? undefined : (mask as string[]).slice(),
      source: String(value.source ?? fallbackSource),
      updatedAt: Number(value.updatedAt) || Date.now(),
    };
  };

  const selectionResponse = (value: ActiveSelection | NamedSelection | null): Record<string, unknown> => ({
    selection: value,
    geometry: value ? analyzeSelectionGeometry(value) : null,
  });

  const readNamedSelections = async (): Promise<NamedSelectionLibrary> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(namedSelectionsPath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, selections: {} };
      throw error;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('named selection library must be an object');
    }
    const value = parsed as { version?: unknown; selections?: unknown };
    if (value.version !== 1 || !value.selections || typeof value.selections !== 'object' || Array.isArray(value.selections)) {
      throw new Error('named selection library must use version 1 and contain selections');
    }
    const selections: Record<string, NamedSelection> = {};
    for (const [rawName, rawSelection] of Object.entries(value.selections)) {
      const name = selectionName(rawName);
      const normalized = normalizedSelection(rawSelection, `named:${name}`);
      const createdAt = Number((rawSelection as Record<string, unknown>).createdAt);
      selections[name] = { ...normalized, name, createdAt: createdAt || normalized.updatedAt };
    }
    return { version: 1, selections };
  };

  const writeNamedSelections = async (library: NamedSelectionLibrary): Promise<void> => {
    const selections = Object.fromEntries(Object.entries(library.selections).sort(([a], [b]) => a.localeCompare(b)));
    await fs.writeFile(namedSelectionsPath, `${JSON.stringify({ version: 1, selections }, null, 2)}\n`, 'utf8');
  };

  const frameRows = (
    file: SpriteFile,
    anim: string,
    frame: number,
    layerId?: string,
  ): { rows: string[]; layerId?: string } => {
    if (!(anim in file.anims)) throw new Error(`unknown animation "${anim}"`);
    const concrete = resolveAnimName(file, anim);
    if (isLayeredSpriteFile(file)) {
      const resolvedLayerId = layerId ?? file.layers[0]?.id;
      const layer = file.layers.find((candidate) => candidate.id === resolvedLayerId);
      if (!layer) throw new Error(`unknown layer "${resolvedLayerId ?? ''}"`);
      const rows = layer.tracks[concrete]?.[frame];
      if (!rows) throw new Error(`frame ${frame} is outside animation "${anim}"`);
      return { rows, layerId: layer.id };
    }
    const entry = file.anims[concrete];
    const rows = typeof entry === 'string' ? undefined : entry.frames[frame];
    if (!rows) throw new Error(`frame ${frame} is outside animation "${anim}"`);
    return { rows };
  };

  const validateSprite = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('file must be a SpriteFile object');
    validateSpriteEditorDocument(candidate as SpriteFile);
  };

  const matchesRepository = async (relative: string | null, candidate: unknown): Promise<boolean> => {
    if (!relative) return false;
    try {
      const target = spritePath(relative);
      const saved = JSON.parse(await fs.readFile(target.absolute, 'utf8')) as unknown;
      return JSON.stringify(saved) === JSON.stringify(candidate);
    } catch {
      return false;
    }
  };

  const listSprites = async (directory = spriteRoot, prefix = ''): Promise<string[]> => {
    const out: string[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...await listSprites(path.join(directory, entry.name), relative));
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(relative);
    }
    return out.sort();
  };

  const validateSpriteRenderTagReferences = async (
    renderTags: { id: string; label: string }[],
    pending: { target: { relative: string }; file: unknown }[],
  ): Promise<void> => {
    const known = new Set(renderTags.map((tag) => tag.id));
    const overrides = new Map(pending.map((document) => [document.target.relative, document.file]));
    const missing = new Map<string, string[]>();
    for (const relative of await listSprites()) {
      const sprite = (overrides.get(relative)
        ?? JSON.parse(await fs.readFile(spritePath(relative).absolute, 'utf8'))) as {
        renderTag?: unknown;
        layers?: unknown;
      };
      const note = (tag: unknown, detail: string): void => {
        if (typeof tag !== 'string' || known.has(tag)) return;
        const references = missing.get(tag) ?? [];
        references.push(`${relative} - ${detail}`);
        missing.set(tag, references);
      };
      note(sprite.renderTag, 'flat sprite render tag');
      if (Array.isArray(sprite.layers)) for (const rawLayer of sprite.layers) {
        const layer = rawLayer as { id?: unknown; name?: unknown; tag?: unknown };
        note(layer.tag, `layer "${String(layer.name ?? layer.id ?? 'unnamed')}"`);
      }
    }
    if (missing.size) {
      const details = [...missing].map(([tag, references]) => `"${tag}": ${references.join(', ')}`).join('; ');
      throw new Error(`cannot remove render tags with sprite dependencies: ${details}`);
    }
  };

  const headers = (res: ServerResponse, contentType = 'application/json'): void => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sprite-Revision');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  };

  const send = (res: ServerResponse, status: number, value: unknown): void => {
    headers(res);
    res.statusCode = status;
    res.end(JSON.stringify(value));
  };

  const statePayload = (state: ActiveSprite, includeFile = false): Omit<ActiveSprite, 'file'> & { file?: unknown } => {
    const { file, ...summary } = state;
    return includeFile ? { ...summary, file } : summary;
  };

  return {
    name: 'hitstop-sprite-editor-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(API)) return next();
        // Vite serves the game to the LAN, but a filesystem-writing tool must
        // remain local even when somebody opens that public development URL.
        const remote = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
          return send(res, 403, { error: 'the sprite editor bridge is local-only' });
        }
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) {
          return send(res, 403, { error: 'cross-origin sprite editor requests are not allowed' });
        }
        if (req.method === 'OPTIONS') {
          headers(res);
          res.statusCode = 204;
          return res.end();
        }

        try {
          if (req.method === 'GET' && url.pathname === `${API}/sprites`) {
            return send(res, 200, { sprites: await listSprites() });
          }

          if (req.method === 'GET' && url.pathname === `${API}/capabilities`) {
            return send(res, 200, {
              ...SPRITE_AGENT_CAPABILITIES,
              namedSelections: {
                persistent: true,
                routes: {
                  list: `GET ${API}/named-selections`,
                  read: `GET ${API}/named-selections/:name`,
                  save: `PUT ${API}/named-selections/:name`,
                  apply: `POST ${API}/named-selections/:name/apply`,
                  delete: `DELETE ${API}/named-selections/:name`,
                },
              },
            });
          }

          if (req.method === 'GET' && url.pathname === `${API}/render-tags`) {
            const renderTags = JSON.parse(await fs.readFile(renderTagsPath, 'utf8')) as unknown;
            validateRenderTagDefs(renderTags);
            return send(res, 200, { renderTags });
          }

          if (req.method === 'GET' && url.pathname === `${API}/state`) {
            return active ? send(res, 200, active) : send(res, 404, { error: 'no sprite is open' });
          }

          if (req.method === 'GET' && url.pathname === `${API}/selection`) {
            return send(res, 200, selectionResponse(selection));
          }

          if (req.method === 'GET' && url.pathname === `${API}/named-selections`) {
            const library = await readNamedSelections();
            const selections = Object.values(library.selections).map((saved) => ({
              name: saved.name,
              path: saved.path,
              anim: saved.anim,
              frame: saved.frame,
              layerId: saved.layerId,
              x: saved.x,
              y: saved.y,
              w: saved.w,
              h: saved.h,
              pixelCount: saved.mask
                ? saved.mask.reduce((count, row) => count + [...row].filter((cell) => cell === '1').length, 0)
                : saved.w * saved.h,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
            }));
            return send(res, 200, { version: library.version, selections });
          }

          const namedSelectionRoute = url.pathname.match(new RegExp(`^${API}/named-selections/([^/]+?)(/apply)?$`));
          if (namedSelectionRoute) {
            const name = selectionName(namedSelectionRoute[1]);
            const applying = namedSelectionRoute[2] === '/apply';
            const library = await readNamedSelections();

            if (req.method === 'GET' && !applying) {
              const saved = library.selections[name];
              return saved
                ? send(res, 200, selectionResponse(saved))
                : send(res, 404, { error: `unknown named selection "${name}"` });
            }

            if (req.method === 'PUT' && !applying) {
              const body = await jsonBody(req);
              const candidate = body.selection === undefined ? selection : normalizedSelection(body.selection);
              if (!candidate) return send(res, 409, { error: 'there is no live selection to save' });
              const now = Date.now();
              const previous = library.selections[name];
              const saved: NamedSelection = {
                ...candidate,
                name,
                createdAt: previous?.createdAt ?? now,
                updatedAt: now,
              };
              library.selections[name] = saved;
              await writeNamedSelections(library);
              return send(res, previous ? 200 : 201, { selection: saved });
            }

            if (req.method === 'DELETE' && !applying) {
              if (!library.selections[name]) return send(res, 404, { error: `unknown named selection "${name}"` });
              delete library.selections[name];
              await writeNamedSelections(library);
              return send(res, 200, { deleted: name });
            }

            if (req.method === 'POST' && applying) {
              const saved = library.selections[name];
              if (!saved) return send(res, 404, { error: `unknown named selection "${name}"` });
              if (!active) return send(res, 404, { error: 'no sprite is open' });
              const body = await jsonBody(req);
              const targetPath = body.path == null ? active.path : spritePath(body.path).relative;
              if (targetPath !== active.path) {
                return send(res, 409, { error: `open "${targetPath}" before applying the named selection`, state: active });
              }
              const anim = String(body.anim ?? active.cursor?.animation ?? saved.anim);
              const frame = Number(body.frame ?? active.cursor?.frame ?? saved.frame);
              if (!Number.isInteger(frame) || frame < 0) throw new Error('target frame must be a zero-based integer');
              const requestedLayer = body.layerId == null
                ? active.cursor?.layerId ?? saved.layerId
                : String(body.layerId);
              const x = Number(body.x ?? saved.x);
              const y = Number(body.y ?? saved.y);
              if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
                throw new Error('target x and y must be non-negative integers');
              }
              const target = frameRows(active.file as SpriteFile, anim, frame, requestedLayer);
              const width = target.rows[0]?.length ?? 0;
              if (y + saved.h > target.rows.length || x + saved.w > width) {
                throw new Error(`named selection "${name}" does not fit the target frame at ${x},${y}`);
              }
              selection = {
                path: active.path,
                anim,
                frame,
                layerId: target.layerId,
                x,
                y,
                w: saved.w,
                h: saved.h,
                rows: target.rows.slice(y, y + saved.h).map((row) => row.slice(x, x + saved.w)),
                mask: saved.mask?.slice(),
                source: `named:${name}`,
                updatedAt: Date.now(),
              };
              publishSelection();
              return send(res, 200, { name, selection });
            }
          }

          if (req.method === 'POST' && url.pathname === `${API}/inspect`) {
            const body = await jsonBody(req);
            const requestedPath = body.path == null ? active?.path ?? null : spritePath(body.path).relative;
            let file: SpriteFile;
            let revision: number | null = null;
            if (active && requestedPath === active.path) {
              file = active.file as SpriteFile;
              revision = active.revision;
            } else {
              if (!requestedPath) return send(res, 404, { error: 'no sprite is open' });
              file = JSON.parse(await fs.readFile(spritePath(requestedPath).absolute, 'utf8')) as SpriteFile;
              validateSprite(file);
            }
            const queries = body.frames === undefined ? [] : body.frames;
            if (!Array.isArray(queries)) return send(res, 400, { error: 'frames must be an array' });
            if (queries.length > SPRITE_AGENT_MAX_INSPECTIONS) {
              return send(res, 400, { error: `cannot inspect more than ${SPRITE_AGENT_MAX_INSPECTIONS} frames at once` });
            }
            const normalizedQueries = structuredClone(queries) as SpriteAgentFrameQuery[];
            for (const query of normalizedQueries) {
              if (!query || typeof query !== 'object' || Array.isArray(query)) {
                return send(res, 400, { error: 'each frame query must be an object' });
              }
              if (query.path) {
                const queryPath = spritePath(query.path).relative;
                if (queryPath !== requestedPath) {
                  return send(res, 400, { error: 'inspect frame paths must match the requested document path' });
                }
                query.path = queryPath;
              }
            }
            const inspection = inspectSpriteAgentDocument(
              { activePath: requestedPath, active: file },
              normalizedQueries,
            );
            return send(res, 200, { revision, dirty: active?.path === requestedPath ? active.dirty : false, inspection });
          }

          if (req.method === 'PUT' && url.pathname === `${API}/selection`) {
            const body = await jsonBody(req);
            if (body.selection == null) {
              selection = null;
              publishSelection();
              return send(res, 200, { selection });
            }
            selection = normalizedSelection(body.selection, 'browser');
            publishSelection();
            return send(res, 200, { selection });
          }

          if (req.method === 'POST' && url.pathname === `${API}/open`) {
            const body = await jsonBody(req);
            const target = spritePath(body.path);
            // `dirty` is a description of repository state, not merely a
            // record that some client sent PUT. An edit that was reverted to
            // the saved pixels must not strand every editor tab on that file.
            const hasUnsavedChanges = active?.dirty
              && !(await matchesRepository(active.path, active.file));
            if (hasUnsavedChanges && body.force !== true) {
              return send(res, 409, { error: 'the active sprite has unsaved shared changes', state: active });
            }
            const file = JSON.parse(await fs.readFile(target.absolute, 'utf8')) as unknown;
            validateSprite(file);
            active = {
              path: target.relative,
              file,
              revision: (active?.revision ?? 0) + 1,
              source: String(body.source ?? 'api'),
              updatedAt: Date.now(),
              dirty: false,
            };
            preview = null;
            previewRevision = 0;
            selection = null;
            publish();
            return send(res, 200, active);
          }

          if (req.method === 'PUT' && url.pathname === `${API}/state`) {
            const body = await jsonBody(req);
            validateSprite(body.file);
            const targetPath = body.path == null ? null : spritePath(body.path).relative;
            const baseRevision = Number(body.baseRevision ?? 0);
            if (active && baseRevision !== active.revision) {
              return send(res, 409, { error: 'revision conflict', state: active });
            }
            if (!active && baseRevision !== 0) {
              return send(res, 409, { error: 'revision conflict', state: null });
            }
            const serialized = JSON.stringify(body.file);
            const dirty = !(await matchesRepository(targetPath, body.file));
            if (active && active.path === targetPath && JSON.stringify(active.file) === serialized) {
              if (active.dirty !== dirty) {
                active = {
                  ...active,
                  revision: active.revision + 1,
                  source: String(body.source ?? 'api'),
                  updatedAt: Date.now(),
                  dirty,
                };
                publish();
              }
              return send(res, 200, active);
            }
            active = {
              path: targetPath,
              file: body.file,
              revision: (active?.revision ?? 0) + 1,
              source: String(body.source ?? 'api'),
              updatedAt: Date.now(),
              dirty,
            };
            publish();
            return send(res, 200, active);
          }

          if (req.method === 'POST' && url.pathname === `${API}/commands`) {
            const body = await jsonBody(req);
            if (!active) return send(res, 404, { error: 'no sprite is open' });
            if (Number(body.baseRevision) !== active.revision) {
              return send(res, 409, { error: 'revision conflict', state: active });
            }
            if (!Array.isArray(body.commands)) return send(res, 400, { error: 'commands must be an array' });
            if (body.protocolVersion !== undefined && body.protocolVersion !== SPRITE_AGENT_PROTOCOL_VERSION) {
              return send(res, 400, {
                error: `unsupported protocolVersion ${String(body.protocolVersion)}; expected ${SPRITE_AGENT_PROTOCOL_VERSION}`,
              });
            }
            spriteAgentSourcePaths(body.commands); // Validate envelopes before reading nested fields.
            const commands = structuredClone(body.commands) as SpriteAgentCommand[];
            for (const command of commands) {
              if ((command.op === 'frame.copy' || command.op === 'frame.copyAligned') && command.from.path) {
                command.from.path = spritePath(command.from.path).relative;
              }
              if ('target' in command && command.target && 'path' in command.target && command.target.path) {
                command.target.path = spritePath(command.target.path).relative;
              }
              if ((command.op === 'frame.copy' || command.op === 'frame.copyAligned') && command.to.path) {
                command.to.path = spritePath(command.to.path).relative;
              }
            }
            const inspectQueries = body.inspect === undefined
              ? undefined
              : structuredClone(body.inspect) as SpriteAgentFrameQuery[];
            if (inspectQueries !== undefined && !Array.isArray(inspectQueries)) {
              return send(res, 400, { error: 'inspect must be an array' });
            }
            if ((inspectQueries?.length ?? 0) > SPRITE_AGENT_MAX_INSPECTIONS) {
              return send(res, 400, { error: `cannot inspect more than ${SPRITE_AGENT_MAX_INSPECTIONS} frames at once` });
            }
            for (const query of inspectQueries ?? []) {
              if (!query || typeof query !== 'object' || Array.isArray(query)) {
                return send(res, 400, { error: 'each inspection query must be an object' });
              }
              if (query.path) query.path = spritePath(query.path).relative;
            }
            const sourcePaths = [...new Set([
              ...spriteAgentSourcePaths(commands),
              ...(inspectQueries ?? []).flatMap((query) => query.path ? [query.path] : []),
            ])]
              .map((relative) => spritePath(relative))
              .filter((target) => target.relative !== active!.path);
            const documents = new Map<string, SpriteFile>();
            for (const target of sourcePaths) {
              const file = JSON.parse(await fs.readFile(target.absolute, 'utf8')) as SpriteFile;
              validateSprite(file);
              documents.set(target.relative, file);
            }
            const transaction: SpriteAgentTransaction = {
              protocolVersion: body.protocolVersion as number | undefined,
              commands,
              inspect: inspectQueries,
              dryRun: body.dryRun === true,
            };
            const result = applySpriteAgentTransaction({
              activePath: active.path,
              active: active.file as SpriteFile,
              documents,
            }, transaction);
            if (transaction.dryRun) {
              return send(res, 200, {
                dryRun: true,
                changed: result.changed,
                cursor: result.cursor,
                results: result.results,
                inspection: result.inspection,
                state: statePayload({ ...active, file: result.file, cursor: result.cursor ?? active.cursor }, body.includeFile === true),
              });
            }
            if (!result.changed) {
              return send(res, 200, {
                dryRun: false,
                changed: false,
                cursor: result.cursor,
                results: result.results,
                inspection: result.inspection,
                state: statePayload(active, body.includeFile === true),
              });
            }
            const dirty = !(await matchesRepository(active.path, result.file));
            active = {
              ...active,
              file: result.file,
              revision: active.revision + 1,
              source: String(body.source ?? 'agent'),
              updatedAt: Date.now(),
              dirty,
              cursor: result.cursor ?? active.cursor,
            };
            preview = null;
            previewRevision = 0;
            selection = null;
            publish();
            return send(res, 200, {
              dryRun: false,
              changed: result.changed,
              cursor: result.cursor,
              results: result.results,
              inspection: result.inspection,
              state: statePayload(active, body.includeFile === true),
            });
          }

          if (req.method === 'POST' && url.pathname === `${API}/save`) {
            const body = await jsonBody(req);
            if (!active) return send(res, 404, { error: 'no sprite is open' });
            if (Number(body.baseRevision) !== active.revision) {
              return send(res, 409, { error: 'revision conflict', state: active });
            }
            const target = spritePath(body.path ?? active.path);
            const text = `${JSON.stringify(active.file, null, 2)}\n`;
            const temporary = `${target.absolute}.tmp`;
            await fs.writeFile(temporary, text, 'utf8');
            await fs.rename(temporary, target.absolute);
            active = {
              ...active,
              path: target.relative,
              revision: active.revision + 1,
              dirty: false,
              updatedAt: Date.now(),
              source: String(body.source ?? 'api'),
            };
            publish();
            return send(res, 200, active);
          }

          if (req.method === 'POST' && url.pathname === `${API}/save-all`) {
            const body = await jsonBody(req, MAX_WORKSPACE_JSON_BYTES);
            if (!Array.isArray(body.documents)) {
              return send(res, 400, { error: 'documents must be an array' });
            }
            if (body.documents.length > 128) {
              return send(res, 400, { error: 'too many sprite documents' });
            }
            // Resolve and validate the complete workspace before writing any
            // file. A malformed inactive draft must not leave half of the
            // user's other sprites saved and half still pending.
            const seen = new Set<string>();
            const documents = body.documents.map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error('each document needs a path and SpriteFile');
              }
              const document = entry as { path?: unknown; file?: unknown };
              const target = spritePath(document.path);
              if (seen.has(target.relative)) throw new Error(`duplicate sprite path "${target.relative}"`);
              seen.add(target.relative);
              validateSprite(document.file);
              return { target, file: document.file };
            });
            const renderTags = body.renderTags;
            if (renderTags !== undefined) {
              validateRenderTagDefs(renderTags);
              await validateSpriteRenderTagReferences(renderTags, documents);
            }
            const weaponCombat = body.weaponCombat;
            if (weaponCombat !== undefined) validateWeaponCombatTuning(weaponCombat);

            const activeDocument = active
              ? documents.find((document) => document.target.relative === active!.path)
              : undefined;
            // An unrelated active sprite can keep publishing preview/editor
            // revisions while inactive drafts are saved. Only an active file
            // included in this batch participates in revision conflict checks.
            if (activeDocument
              && active
              && Number(body.baseRevision) !== active.revision
              && String(body.source ?? 'api') !== active.source) {
              return send(res, 409, { error: 'revision conflict', state: active });
            }

            const writeBatch = [
              ...documents.map((document) => ({
                target: document.target.absolute,
                text: `${JSON.stringify(document.file, null, 2)}\n`,
              })),
              ...(renderTags === undefined ? [] : [{
                target: renderTagsPath,
                text: `${JSON.stringify(renderTags, null, 2)}\n`,
              }]),
              ...(weaponCombat === undefined ? [] : [{
                target: weaponCombatPath,
                text: `${JSON.stringify(weaponCombat, null, 2)}\n`,
              }]),
            ].map((write) => ({
              ...write,
              temporary: `${write.target}.tmp-${randomUUID()}`,
            }));
            // Stage every byte before replacing any repository file. Disk or
            // permission failures during staging therefore leave the entire
            // workspace untouched instead of saving an arbitrary prefix.
            try {
              const staged = await Promise.allSettled(
                writeBatch.map((write) => fs.writeFile(write.temporary, write.text, 'utf8')),
              );
              const failed = staged.find((result): result is PromiseRejectedResult => result.status === 'rejected');
              if (failed) throw failed.reason;
              for (const write of writeBatch) await fs.rename(write.temporary, write.target);
            } catch (error) {
              await Promise.allSettled(writeBatch.map((write) => fs.rm(write.temporary, { force: true })));
              throw error;
            }

            if (active && activeDocument) {
              // Saving acknowledges the exact browser document included in
              // the batch. Keeping it active avoids the old open/save/open
              // sequence that reset the editor to another sprite.
              active = {
                ...active,
                file: activeDocument.file,
                revision: active.revision + 1,
                dirty: false,
                updatedAt: Date.now(),
                source: String(body.source ?? 'api'),
              };
              publish();
            }
            return send(res, 200, {
              saved: documents.map((document) => document.target.relative),
              renderTagsSaved: renderTags !== undefined,
              weaponCombatSaved: weaponCombat !== undefined,
              state: active,
            });
          }

          if (req.method === 'POST' && url.pathname === `${API}/preview`) {
            if (!active) return send(res, 404, { error: 'no sprite is open' });
            const revision = Number(req.headers['x-sprite-revision'] ?? 0);
            if (revision !== active.revision) return send(res, 409, { error: 'preview revision is stale', state: active });
            preview = await readBody(req, MAX_PREVIEW_BYTES);
            previewRevision = revision;
            return send(res, 200, { revision, bytes: preview.length });
          }

          if (req.method === 'GET' && url.pathname === `${API}/preview.png`) {
            if (!preview || !active || previewRevision !== active.revision) {
              return send(res, 404, { error: 'no preview for the active revision' });
            }
            headers(res, 'image/png');
            res.setHeader('X-Sprite-Revision', String(previewRevision));
            res.statusCode = 200;
            return res.end(preview);
          }

          if (req.method === 'POST' && url.pathname === `${API}/comparison`) {
            if (!active) return send(res, 404, { error: 'no sprite is open' });
            const revision = Number(req.headers['x-sprite-revision'] ?? 0);
            if (revision !== active.revision) return send(res, 409, { error: 'comparison revision is stale', state: active });
            comparison = await readBody(req, MAX_PREVIEW_BYTES);
            comparisonRevision = revision;
            return send(res, 200, { revision, bytes: comparison.length });
          }

          if (req.method === 'GET' && url.pathname === `${API}/comparison.png`) {
            if (!comparison || !active || comparisonRevision !== active.revision) {
              return send(res, 404, { error: 'no comparison for the active revision' });
            }
            headers(res, 'image/png');
            res.setHeader('X-Sprite-Revision', String(comparisonRevision));
            res.statusCode = 200;
            return res.end(comparison);
          }

          if (req.method === 'GET' && url.pathname === `${API}/events`) {
            headers(res, 'text/event-stream');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            listeners.add(res);
            res.write(': connected\n\n');
            if (active) res.write(`event: state\ndata: ${JSON.stringify(active)}\n\n`);
            res.write(`event: selection\ndata: ${JSON.stringify({ selection })}\n\n`);
            req.on('close', () => listeners.delete(res));
            return;
          }

          return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
        } catch (error) {
          return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
