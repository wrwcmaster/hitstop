/**
 * Run the game's own modules in Node, with no browser.
 *
 * A browser buys three things: a canvas, an audio context, and a fresh
 * page per run. The simulation needs none of them — it is fixed-step and
 * deterministic — so questions about geometry and physics do not need a
 * page, they need the modules. Vite's `ssrLoadModule` loads them with the
 * real `@engine` alias resolution, and `offscreen()` already returns a
 * drawing sink when there is no document (see engine/gfx/canvas.ts), so
 * the whole content layer imports.
 *
 * Measured: the engine loads in ~170ms and a room's tilemap in ~600ms,
 * against seconds for browser + dev server + page. All 22 recordings
 * replay bit-exactly through `bootGame`.
 *
 * What still needs a browser: rendering (this draws nothing), input
 * devices, and anything about how the game FEELS. Those are the cases
 * where the page is buying something real — use tools/agent-play/lib.mjs.
 */
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Enough browser to construct the game, and no more. Every stub here is
 * a sink: if the simulation ever depends on one returning something real,
 * that is a bug in the simulation — the sim must not read from the
 * presentation layer.
 */
function installHost() {
  if (globalThis.__hitstopHost) return globalThis.__hitstopHost.storage;
  const NOOP = () => {};
  const param = () => ({
    value: 0, setValueAtTime: NOOP, linearRampToValueAtTime: NOOP,
    exponentialRampToValueAtTime: NOOP, setTargetAtTime: NOOP,
    cancelScheduledValues: NOOP, setValueCurveAtTime: NOOP,
  });
  const audioNode = (extra = {}) => ({
    connect() { return audioNode(); }, disconnect: NOOP, start: NOOP, stop: NOOP, ...extra,
  });
  const ctx2d = () => new Proxy({
    getImageData: (_x, _y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(0, Math.trunc(w) * Math.trunc(h) * 4)),
      width: w, height: h,
    }),
    measureText: () => ({ width: 0 }),
    createPattern: () => null,
    createLinearGradient: () => ({ addColorStop: NOOP }),
    createRadialGradient: () => ({ addColorStop: NOOP }),
  }, { get: (t, p) => (p in t ? t[p] : NOOP), set: () => true });
  const listeners = () => ({ addEventListener: NOOP, removeEventListener: NOOP, dispatchEvent: () => true });
  const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d(), ...listeners() });

  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    /** Replace the whole store — a recording's embedded save. */
    load(obj) { store.clear(); for (const [k, v] of Object.entries(obj ?? {})) store.set(k, v); },
  };
  const location = {
    href: 'http://localhost/?harness=1&seed=1', search: '?harness=1&seed=1',
    pathname: '/', reload: NOOP, replace: NOOP, assign: NOOP,
  };
  const document = {
    ...listeners(), location, hidden: false,
    getElementById: () => canvas(), createElement: () => canvas(),
    querySelector: () => null, querySelectorAll: () => [],
    body: { ...listeners(), appendChild: NOOP, style: {} },
    documentElement: { style: {} },
  };
  globalThis.localStorage = storage;
  globalThis.location = location;
  globalThis.document = document;
  globalThis.window = {
    ...listeners(), document, location, localStorage: storage,
    innerWidth: 960, innerHeight: 540, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener: NOOP, removeEventListener: NOOP }),
    requestAnimationFrame: () => 0, cancelAnimationFrame: NOOP,
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = NOOP;
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = audioNode(); }
    createGain() { return audioNode({ gain: param() }); }
    createOscillator() { return audioNode({ frequency: param(), detune: param(), type: '' }); }
    createBiquadFilter() { return audioNode({ frequency: param(), Q: param(), gain: param(), type: '' }); }
    createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
    createBufferSource() { return audioNode({ buffer: null, playbackRate: param(), loop: false }); }
    createDynamicsCompressor() {
      return audioNode({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  globalThis.__hitstopHost = { storage };
  return storage;
}

let server = null;

/** The shared vite server. Started once; call `close()` when done. */
async function viteServer() {
  if (!server) {
    server = await createServer({
      root: repoRoot,
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'silent',
    });
  }
  return server;
}

export async function close() {
  if (server) { await server.close(); server = null; }
}

/**
 * The engine plus the game's tile definitions, ready for geometry and
 * physics questions. No game instance, no scenes, no player.
 */
export async function loadEngine() {
  installHost(); // tile art bakes at import even here
  const s = await viteServer();
  await s.ssrLoadModule('/src/game/content/tiles.ts');
  const engine = await s.ssrLoadModule('/src/engine/index.ts');
  const { ROOMS } = await s.ssrLoadModule('/src/game/content/rooms/index.ts');
  return { ...engine, ROOMS, server: s };
}

/**
 * The whole game, booted and stepping, exposing the same `__harness` the
 * browser does — so a recording replays here exactly as it does there.
 *
 * `fresh: true` re-evaluates the module graph first, which is how a tape
 * gets the isolation a new page gives it for free. It costs ~1.5s, so
 * only pay it when a previous run has already dirtied this process.
 */
export async function bootGame({ fresh = false, storage: initial } = {}) {
  const store = installHost();
  const s = await viteServer();
  if (fresh) s.moduleGraph.invalidateAll();
  if (initial !== undefined) store.load(initial);
  await s.ssrLoadModule('/src/game/main.ts');
  const harness = globalThis.window.__harness ?? globalThis.__harness;
  if (!harness) throw new Error('game booted but __harness is absent — is the harness build flag on?');
  return { harness, storage: store, game: globalThis.window.hitstop, server: s };
}
