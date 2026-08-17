import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { SpriteFile } from '../src/engine/gfx/spritefile';
import { validateSpriteEditorDocument } from './src/sprite-editor-document';
import { validateRenderTagDefs, validateWeaponCombatTuning } from './src/sprite-editor-workspace';
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

/**
 * Development-only bridge between the browser sprite editor and local agents.
 * The browser and the agent exchange one revisioned document; repository writes
 * are a separate, explicit operation and are confined to the sprite directory.
 */
export function spriteEditorBridge(root: string): Plugin {
  const spriteRoot = path.resolve(root, 'src/game/content/sprites');
  const renderTagsPath = path.resolve(root, 'src/game/content/render-tags.json');
  const weaponCombatPath = path.resolve(root, 'src/game/content/weapon-combat.json');
  let active: ActiveSprite | null = null;
  let selection: ActiveSelection | null = null;
  let preview: Buffer | null = null;
  let previewRevision = 0;
  const listeners = new Set<ServerResponse>();

  const publish = (): void => {
    if (!active) return;
    const message = `event: state\ndata: ${JSON.stringify(active)}\n\n`;
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
            return send(res, 200, SPRITE_AGENT_CAPABILITIES);
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
            return send(res, 200, { selection });
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
              return send(res, 200, { selection });
            }
            const value = body.selection as Record<string, unknown>;
            const rows = value.rows;
            const mask = value.mask;
            const numbers = ['frame', 'x', 'y', 'w', 'h'] as const;
            if (numbers.some((key) => !Number.isInteger(value[key]))
              || Number(value.x) < 0 || Number(value.y) < 0 || Number(value.w) < 1 || Number(value.h) < 1
              || typeof value.anim !== 'string' || !Array.isArray(rows) || !rows.every((row) => typeof row === 'string')
              || rows.length !== Number(value.h) || rows.some((row) => row.length !== Number(value.w))) {
              return send(res, 400, { error: 'selection needs integer bounds and matching pixel rows' });
            }
            if (mask !== undefined && (!Array.isArray(mask) || mask.length !== Number(value.h)
              || !mask.every((row) => typeof row === 'string' && row.length === Number(value.w) && /^[1.]+$/.test(row)))) {
              return send(res, 400, { error: 'selection mask must match the selection bounds' });
            }
            selection = {
              path: value.path == null ? null : String(value.path),
              anim: value.anim,
              frame: Number(value.frame),
              layerId: value.layerId == null ? undefined : String(value.layerId),
              x: Number(value.x),
              y: Number(value.y),
              w: Number(value.w),
              h: Number(value.h),
              rows: rows as string[],
              mask: mask as string[] | undefined,
              source: String(value.source ?? 'browser'),
              updatedAt: Number(value.updatedAt) || Date.now(),
            };
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
              if (command.op === 'frame.copy' && command.from.path) {
                command.from.path = spritePath(command.from.path).relative;
              }
              if ('target' in command && command.target && 'path' in command.target && command.target.path) {
                command.target.path = spritePath(command.target.path).relative;
              }
              if (command.op === 'frame.copy' && command.to.path) {
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

          if (req.method === 'GET' && url.pathname === `${API}/events`) {
            headers(res, 'text/event-stream');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            listeners.add(res);
            res.write(': connected\n\n');
            if (active) res.write(`event: state\ndata: ${JSON.stringify(active)}\n\n`);
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
