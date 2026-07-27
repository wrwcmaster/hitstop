/**
 * HTTP bridge so an LLM agent (or curl) can play hitstop turn-based.
 *
 *   node tools/agent-play/server.mjs        # needs `npm run dev` running
 *
 * Endpoints (JSON in/out):
 *   POST /session    {seed?}                → fresh deterministic session
 *   POST /step       {down?: string[], frames?: number} → play, get state
 *   GET  /state                             → current state, no time passes
 *   GET  /tiles      ?room=&c0=&c1=&r0=&r1= → resolved tilemap as ASCII;
 *                    no ?room reads the LIVE room, patches and all
 *   GET  /screenshot                        → PNG of the game canvas;
 *                    ?around=player&r=80&scale=2 for a small clip instead
 *                    (cheap probes: prefer /tiles, then a clipped shot)
 *   GET  /snapshot                          → the live moment as a
 *                    TestScenario (+ what a scenario can't carry);
 *                    POST it back to /scenario to re-enter it
 *   GET  /recording                         → the session's replayable log
 *   POST /save       {name?}                → write recording to recordings/
 *   POST /shutdown                          → close browser and exit
 *
 * The whole session is recorded in-page; save it and re-run with
 * replay.mjs to verify the run reproduces bit-for-bit.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchBrowser, openSession, step, state, recording,
  tileGrid, snapWorld, snapshotScenario,
} from './lib.mjs';

const PORT = Number(process.env.AGENT_PLAY_PORT ?? 8791);
const here = path.dirname(fileURLToPath(import.meta.url));
const recDir = path.join(here, 'recordings');

const browser = await launchBrowser();
let session = null;

async function ensureSession() {
  if (!session) throw new Error('no session — POST /session first');
  return session;
}

async function handle(req, res, body) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'POST /session': {
      if (session) await session.context.close().catch(() => {});
      const seed = Number(body.seed ?? 1) >>> 0 || 1;
      session = await openSession(browser, seed);
      // Optionally drop straight into a test scenario (room + loadout +
      // monsters) instead of the title screen — see POST /scenario.
      if (body.scenario) {
        const st = await session.page.evaluate(
          (sc) => window.__harness.beginRun({ kind: 'scenario', scenario: sc }),
          body.scenario,
        );
        return { seed, state: st };
      }
      return { seed, state: await state(session.page) };
    }
    case 'POST /scenario': {
      const s = await ensureSession();
      // The body IS the scenario: { room?, roomDef?, player?, spawn? }.
      const st = await s.page.evaluate(
        (sc) => window.__harness.beginRun({ kind: 'scenario', scenario: sc }),
        body,
      );
      if (s.errors.length) st.pageErrors = s.errors.splice(0);
      return st;
    }
    case 'POST /step': {
      const s = await ensureSession();
      const down = Array.isArray(body.down) ? body.down : [];
      const frames = Number(body.frames ?? 1);
      const out = await step(s.page, down, frames);
      if (s.errors.length) out.pageErrors = s.errors.splice(0);
      return out;
    }
    case 'GET /state': {
      const s = await ensureSession();
      return state(s.page);
    }
    case 'GET /tiles': {
      const s = await ensureSession();
      const q = url.searchParams;
      const range = ['c0', 'c1', 'r0', 'r1'].every((k) => q.has(k))
        ? [Number(q.get('c0')), Number(q.get('c1')), Number(q.get('r0')), Number(q.get('r1'))]
        : null;
      return tileGrid(s.page, q.get('room'), range);
    }
    case 'GET /screenshot': {
      const s = await ensureSession();
      const q = url.searchParams;
      let png;
      if (q.has('around')) {
        // A targeted clip: reading a whole frame to answer a local
        // question is the expensive habit this endpoint replaces.
        const around = q.get('around');
        const at = around === 'player'
          ? 'player'
          : { x: Number(around.split(',')[0]), y: Number(around.split(',')[1]) };
        const r = Math.min(Number(q.get('r') ?? 80), 200);
        const scale = Math.min(Number(q.get('scale') ?? 2), 4);
        png = await snapWorld(s.page, { at, r, scale });
      } else {
        png = await s.page.locator('canvas#game').screenshot();
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
      return null;
    }
    case 'GET /snapshot': {
      const s = await ensureSession();
      return snapshotScenario(s.page);
    }
    case 'GET /recording': {
      const s = await ensureSession();
      return recording(s.page);
    }
    case 'POST /save': {
      const s = await ensureSession();
      const rec = await recording(s.page);
      if (!rec) throw new Error('no run started yet — recordings are per-run');
      const name = String(body.name ?? `run-${rec.seed}-${Date.now()}`).replace(/[^\w.-]/g, '_');
      fs.mkdirSync(recDir, { recursive: true });
      const file = path.join(recDir, name.endsWith('.json') ? name : `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(rec));
      return { saved: file, inputs: rec.tape.length, steps: rec.end, seed: rec.seed };
    }
    case 'POST /shutdown': {
      setTimeout(async () => {
        await browser.close().catch(() => {});
        process.exit(0);
      }, 50);
      return { bye: true };
    }
    default:
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `no route ${route}` }));
      return null;
  }
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try {
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'bad JSON body' }));
      }
      try {
        const out = await handle(req, res, body);
        if (out !== null) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    });
  })
  .listen(PORT, () => console.log(`agent-play bridge on http://localhost:${PORT} (game: ${process.env.HITSTOP_URL ?? 'http://localhost:5173/'})`));
