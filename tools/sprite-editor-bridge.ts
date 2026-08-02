import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const API = '/__sprite-editor';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

interface ActiveSprite {
  path: string | null;
  file: unknown;
  revision: number;
  source: string;
  updatedAt: number;
  dirty: boolean;
}

interface ActiveSelection {
  path: string | null;
  anim: string;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: string[];
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
    const relative = String(raw ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (!relative || !relative.endsWith('.json') || relative.split('/').includes('..')) {
      throw new Error('sprite path must be a relative .json path');
    }
    const absolute = path.resolve(spriteRoot, ...relative.split('/'));
    const prefix = `${spriteRoot}${path.sep}`;
    if (!absolute.startsWith(prefix)) throw new Error('sprite path escapes the sprite directory');
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

  const jsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const body = await readBody(req, MAX_JSON_BYTES);
    if (!body.length) return {};
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON body must be an object');
    return parsed as Record<string, unknown>;
  };

  const validateSprite = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('file must be a SpriteFile object');
    const anims = (candidate as { anims?: unknown }).anims;
    if (!anims || typeof anims !== 'object' || Array.isArray(anims) || !Object.keys(anims).length) {
      throw new Error('sprite needs at least one animation');
    }
    for (const [name, value] of Object.entries(anims)) {
      if (typeof value === 'string') continue;
      if (!value || typeof value !== 'object' || !Array.isArray((value as { frames?: unknown }).frames)) {
        throw new Error(`animation "${name}" needs frames or an alias`);
      }
      const frames = (value as { frames: unknown[] }).frames;
      if (!frames.length) throw new Error(`animation "${name}" has no frames`);
      for (const frame of frames) {
        if (!Array.isArray(frame) || !frame.length || !frame.every((row) => typeof row === 'string')) {
          throw new Error(`animation "${name}" has an invalid frame`);
        }
        const width = (frame[0] as string).length;
        if (!width || !frame.every((row) => (row as string).length === width)) {
          throw new Error(`animation "${name}" frames must be rectangular`);
        }
      }
    }
    const anchors = (candidate as { anchors?: unknown }).anchors;
    if (anchors !== undefined) {
      if (!anchors || typeof anchors !== 'object' || Array.isArray(anchors)) throw new Error('sprite anchors must be an object');
      for (const [pointName, groups] of Object.entries(anchors)) {
        if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new Error(`anchor "${pointName}" must contain animations`);
        for (const [animName, points] of Object.entries(groups)) {
          if (!Array.isArray(points)) throw new Error(`anchor "${pointName}.${animName}" must be an array`);
          const seen = new Set<string>();
          let resolvedName = animName;
          let resolved = (anims as Record<string, unknown>)[resolvedName];
          while (typeof resolved === 'string') {
            if (seen.has(resolvedName)) throw new Error(`animation alias cycle at "${animName}"`);
            seen.add(resolvedName);
            resolvedName = resolved;
            resolved = (anims as Record<string, unknown>)[resolvedName];
          }
          if (!resolved || typeof resolved !== 'object' || !Array.isArray((resolved as { frames?: unknown }).frames)) {
            throw new Error(`anchor "${pointName}.${animName}" refers to an unknown animation`);
          }
          const frameCount = (resolved as { frames: unknown[] }).frames.length;
          if (points.length !== frameCount) {
            throw new Error(`anchor "${pointName}.${animName}" needs ${frameCount} points, got ${points.length}`);
          }
          for (const point of points) {
            const p = point as { x?: unknown; y?: unknown; angle?: unknown };
            if (!point || typeof point !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.y)
              || (p.angle !== undefined && !Number.isFinite(p.angle))) {
              throw new Error(`anchor "${pointName}.${animName}" needs finite x/y/angle values`);
            }
          }
        }
      }
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

          if (req.method === 'GET' && url.pathname === `${API}/state`) {
            return active ? send(res, 200, active) : send(res, 404, { error: 'no sprite is open' });
          }

          if (req.method === 'GET' && url.pathname === `${API}/selection`) {
            return send(res, 200, { selection });
          }

          if (req.method === 'PUT' && url.pathname === `${API}/selection`) {
            const body = await jsonBody(req);
            if (body.selection == null) {
              selection = null;
              return send(res, 200, { selection });
            }
            const value = body.selection as Record<string, unknown>;
            const rows = value.rows;
            const numbers = ['frame', 'x', 'y', 'w', 'h'] as const;
            if (numbers.some((key) => !Number.isInteger(value[key]))
              || Number(value.x) < 0 || Number(value.y) < 0 || Number(value.w) < 1 || Number(value.h) < 1
              || typeof value.anim !== 'string' || !Array.isArray(rows) || !rows.every((row) => typeof row === 'string')
              || rows.length !== Number(value.h) || rows.some((row) => row.length !== Number(value.w))) {
              return send(res, 400, { error: 'selection needs integer bounds and matching pixel rows' });
            }
            selection = {
              path: value.path == null ? null : String(value.path),
              anim: value.anim,
              frame: Number(value.frame),
              x: Number(value.x),
              y: Number(value.y),
              w: Number(value.w),
              h: Number(value.h),
              rows: rows as string[],
              source: String(value.source ?? 'browser'),
              updatedAt: Number(value.updatedAt) || Date.now(),
            };
            return send(res, 200, { selection });
          }

          if (req.method === 'POST' && url.pathname === `${API}/open`) {
            const body = await jsonBody(req);
            const target = spritePath(body.path);
            if (active?.dirty && body.force !== true) {
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
            if (active && active.path === targetPath && JSON.stringify(active.file) === serialized) {
              return send(res, 200, active);
            }
            active = {
              path: targetPath,
              file: body.file,
              revision: (active?.revision ?? 0) + 1,
              source: String(body.source ?? 'api'),
              updatedAt: Date.now(),
              dirty: true,
            };
            publish();
            return send(res, 200, active);
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
