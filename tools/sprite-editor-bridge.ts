import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

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
    const anims = (candidate as { anims?: unknown }).anims;
    if (!anims || typeof anims !== 'object' || Array.isArray(anims) || !Object.keys(anims).length) {
      throw new Error('sprite needs at least one animation');
    }
    const renderTag = (candidate as { renderTag?: unknown }).renderTag;
    if (renderTag !== undefined && (typeof renderTag !== 'string' || !renderTag.trim())) {
      throw new Error('sprite renderTag must be non-empty');
    }
    const layers = (candidate as { layers?: unknown }).layers;
    const layered = Array.isArray(layers);
    const concreteCounts = new Map<string, number>();
    for (const [name, value] of Object.entries(anims)) {
      if (typeof value === 'string') continue;
      if (!value || typeof value !== 'object') throw new Error(`animation "${name}" needs timing data or an alias`);
      if (layered) {
        const count = (value as { frameCount?: unknown }).frameCount;
        if (!Number.isInteger(count) || Number(count) < 1) {
          throw new Error(`layered animation "${name}" needs a positive frameCount`);
        }
        concreteCounts.set(name, Number(count));
        continue;
      }
      if (!Array.isArray((value as { frames?: unknown }).frames)) {
        throw new Error(`animation "${name}" needs frames or an alias`);
      }
      const frames = (value as { frames: unknown[] }).frames;
      if (!frames.length) throw new Error(`animation "${name}" has no frames`);
      concreteCounts.set(name, frames.length);
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
    if (layered) {
      if (!layers.length) throw new Error('layered sprite needs at least one layer');
      const ids = new Set<string>();
      for (const rawLayer of layers) {
        if (!rawLayer || typeof rawLayer !== 'object' || Array.isArray(rawLayer)) throw new Error('sprite layer must be an object');
        const layer = rawLayer as { id?: unknown; name?: unknown; tag?: unknown; tracks?: unknown };
        if (typeof layer.id !== 'string' || !layer.id.trim() || ids.has(layer.id)) throw new Error('sprite layers need unique ids');
        if (typeof layer.name !== 'string' || !layer.name.trim()) throw new Error(`layer "${layer.id}" needs a name`);
        if (typeof layer.tag !== 'string' || !layer.tag.trim()) throw new Error(`layer "${layer.id}" needs a render tag`);
        if (!layer.tracks || typeof layer.tracks !== 'object' || Array.isArray(layer.tracks)) {
          throw new Error(`layer "${layer.id}" needs tracks`);
        }
        ids.add(layer.id);
        const tracks = layer.tracks as Record<string, unknown>;
        for (const [name, count] of concreteCounts) {
          const frames = tracks[name];
          if (!Array.isArray(frames) || frames.length !== count) {
            throw new Error(`layer "${layer.id}.${name}" needs ${count} frames`);
          }
          for (const frame of frames) {
            if (!Array.isArray(frame) || !frame.length || !frame.every((row) => typeof row === 'string')) {
              throw new Error(`layer "${layer.id}.${name}" has an invalid frame`);
            }
            const width = (frame[0] as string).length;
            if (!width || !frame.every((row) => (row as string).length === width)) {
              throw new Error(`layer "${layer.id}.${name}" frames must be rectangular`);
            }
          }
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
          if (!resolved || typeof resolved !== 'object') {
            throw new Error(`anchor "${pointName}.${animName}" refers to an unknown animation`);
          }
          const frameCount = layered
            ? Number((resolved as { frameCount?: unknown }).frameCount)
            : Array.isArray((resolved as { frames?: unknown }).frames)
              ? (resolved as { frames: unknown[] }).frames.length
              : 0;
          if (!frameCount) throw new Error(`anchor "${pointName}.${animName}" refers to an invalid animation`);
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
    const slots = (candidate as { attachmentSlots?: unknown }).attachmentSlots;
    if (slots !== undefined) {
      if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
        throw new Error('sprite attachmentSlots must be an object');
      }
      for (const [slotName, rawSlot] of Object.entries(slots)) {
        const slot = rawSlot as { anchor?: unknown };
        if (!slotName.trim() || !rawSlot || typeof rawSlot !== 'object' || Array.isArray(rawSlot)
          || typeof slot.anchor !== 'string' || !slot.anchor.trim()) {
          throw new Error('sprite attachment slots need names and anchors');
        }
        if (!anchors || typeof anchors !== 'object' || !(slot.anchor in anchors)) {
          throw new Error(`attachment slot "${slotName}" uses unknown anchor "${slot.anchor}"`);
        }
      }
    }
  };

  const validateRenderTags = (candidate: unknown): asserts candidate is { id: string; label: string }[] => {
    if (!Array.isArray(candidate) || !candidate.length) throw new Error('render tags need a non-empty array');
    const ids = new Set<string>();
    for (const raw of candidate) {
      const tag = raw as { id?: unknown; label?: unknown };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || typeof tag.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(tag.id)
        || typeof tag.label !== 'string' || !tag.label.trim() || ids.has(tag.id)) {
        throw new Error('render tags need unique lowercase ids and non-empty labels');
      }
      ids.add(tag.id);
    }
  };

  const validateWeaponCombat = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('weapon combat tuning must be an object');
    }
    const movePattern = /^(combo\d+|aerial|plunge|upper|dashAttack)$/;
    for (const [typeId, rawProfile] of Object.entries(candidate)) {
      if (!/^[a-z][a-z0-9-]*$/.test(typeId)
        || !rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
        throw new Error('weapon combat tuning needs lowercase weapon-type ids');
      }
      const profile = rawProfile as { fps?: unknown; moves?: unknown };
      if (typeof profile.fps !== 'number' || !Number.isFinite(profile.fps) || profile.fps <= 0) {
        throw new Error(`weapon combat tuning "${typeId}" needs a positive shared fps`);
      }
      if (!profile.moves || typeof profile.moves !== 'object' || Array.isArray(profile.moves)) {
        throw new Error(`weapon combat tuning "${typeId}" needs a moves object`);
      }
      const rawMoves = profile.moves as Record<string, unknown>;
      for (const [moveId, rawEntry] of Object.entries(rawMoves)) {
        if (!movePattern.test(moveId)
          || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
          throw new Error(`weapon combat tuning has invalid move "${typeId}.${moveId}"`);
        }
        const entry = rawEntry as {
          frameCount?: unknown;
          activeFrames?: unknown;
          hitbox?: unknown;
        };
        if (!Number.isInteger(entry.frameCount) || Number(entry.frameCount) < 1) {
          throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs a positive frameCount`);
        }
        if (!Array.isArray(entry.activeFrames) || entry.activeFrames.length !== 2
          || entry.activeFrames.some((value) => !Number.isInteger(value))) {
          throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs activeFrames [start, end]`);
        }
        const [start, end] = entry.activeFrames as number[];
        if (start < 1 || start > end || end > Number(entry.frameCount)) {
          throw new Error(
            `weapon combat tuning "${typeId}.${moveId}" needs 1 <= active start <= active end <= frameCount`,
          );
        }
        if (!entry.hitbox || typeof entry.hitbox !== 'object' || Array.isArray(entry.hitbox)) {
          throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs a hitbox`);
        }
        const hitbox = entry.hitbox as Record<string, unknown>;
        for (const field of ['forward', 'y', 'w', 'h']) {
          if (typeof hitbox[field] !== 'number' || !Number.isFinite(hitbox[field])) {
            throw new Error(`weapon combat tuning "${typeId}.${moveId}" hitbox.${field} must be finite`);
          }
        }
        if ((hitbox.w as number) <= 0 || (hitbox.h as number) <= 0) {
          throw new Error(`weapon combat tuning "${typeId}.${moveId}" hitbox size must be positive`);
        }
      }
    }
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

          if (req.method === 'GET' && url.pathname === `${API}/render-tags`) {
            const renderTags = JSON.parse(await fs.readFile(renderTagsPath, 'utf8')) as unknown;
            validateRenderTags(renderTags);
            return send(res, 200, { renderTags });
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
              validateRenderTags(renderTags);
              await validateSpriteRenderTagReferences(renderTags, documents);
            }
            const weaponCombat = body.weaponCombat;
            if (weaponCombat !== undefined) validateWeaponCombat(weaponCombat);

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

            for (const document of documents) {
              const text = `${JSON.stringify(document.file, null, 2)}\n`;
              const temporary = `${document.target.absolute}.tmp`;
              await fs.writeFile(temporary, text, 'utf8');
              await fs.rename(temporary, document.target.absolute);
            }
            if (renderTags !== undefined) {
              const temporary = `${renderTagsPath}.tmp`;
              await fs.writeFile(temporary, `${JSON.stringify(renderTags, null, 2)}\n`, 'utf8');
              await fs.rename(temporary, renderTagsPath);
            }
            if (weaponCombat !== undefined) {
              const temporary = `${weaponCombatPath}.tmp`;
              await fs.writeFile(temporary, `${JSON.stringify(weaponCombat, null, 2)}\n`, 'utf8');
              await fs.rename(temporary, weaponCombatPath);
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
