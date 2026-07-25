/**
 * Replay recorded runs and verify they reproduce exactly.
 *
 *   npm run replay                    # every recording in recordings/
 *   npm run replay -- path/to/run.json [more.json ...]
 *   npm run replay -- --rerecord path/to/run.json
 *
 * `--rerecord` replays the same tape and writes the checkpoint hashes it
 * produces back into the file. Use it ONLY when a divergence is a change
 * you meant to make — new content in a room the tape walks through, say.
 * A divergence you did not intend is a regression the recording caught,
 * and refreshing the hashes would throw that away.
 *
 * Works on any v2 recording — an agent session from the bridge or a human
 * run saved with `__replay.save()` in the browser console. Each is
 * replayed against a fresh page booted with the recording's seed and
 * boot-time localStorage, feeding the input tape on the exact sim steps
 * it was captured on, and comparing the state hash at every checkpoint
 * (once per second of game time).
 *
 * If the dev server isn't running, one is started on port 5199 for the
 * duration of the run.
 *
 * Exit 0: every recording reproduced. Exit 1: divergence — either
 * nondeterminism or a gameplay change (a regression the recording caught).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openSession, GAME_URL } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const rerecord = args.includes('--rerecord');
let files = args.filter((a) => a !== '--rerecord');
if (!files.length) {
  const dir = path.join(here, 'recordings');
  files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f))
    : [];
  if (!files.length) {
    console.error('no recordings found in tools/agent-play/recordings/');
    process.exit(2);
  }
}

/** Make sure a game server is up; start a throwaway vite if not. */
async function ensureServer() {
  try {
    await fetch(GAME_URL, { signal: AbortSignal.timeout(2000) });
    return { url: GAME_URL, stop: () => {} };
  } catch {
    /* not running — start one */
  }
  const port = 5199;
  const url = `http://localhost:${port}/`;
  console.log(`game server not running — starting vite on :${port}`);
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return { url, stop: () => child.kill() };
    } catch {
      /* keep waiting */
    }
  }
  child.kill();
  throw new Error('vite failed to start');
}

async function replayOne(browser, baseUrl, file) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const name = path.basename(file);
  if (rec.v !== 3) {
    console.error(`${name}: unsupported recording version ${rec.v} (re-record with the current build)`);
    return false;
  }
  if (rec.tainted) {
    console.warn(`${name}: SKIP — recorded with ${rec.tainted} (network play can't replay)`);
    return true;
  }

  const secs = (rec.end / 60).toFixed(1);
  console.log(`${name}: seed=${rec.seed} mode=${rec.mode} start=${rec.start?.kind} ${rec.tape.length} inputs, ${rec.end} steps (${secs}s)`);
  const session = await openSession(browser, rec.seed, { baseUrl, storage: rec.storage ?? {} });
  // Begin the run the recorded way and arm the tape (the start itself is
  // deferred to the next update tick, same as a live menu select).
  await session.page.evaluate((r) => window.__harness.replayRun(r), rec);

  let ok = true;
  const fresh = [];
  for (const [target, expected] of rec.checks) {
    const got = await session.page.evaluate((t) => {
      window.__harness.runTo(t);
      return window.__harness.hashNow();
    }, target);
    fresh.push([target, got]);
    if (rerecord) continue;
    if (got !== expected) {
      ok = false;
      console.error(`  DIVERGED at step ${target} (${(target / 60).toFixed(1)}s): recorded ${expected}, replayed ${got}`);
      console.error('  replayed state:', JSON.stringify(await session.page.evaluate(() => window.__harness.state())));
      break;
    }
  }
  if (session.errors.length) {
    ok = false;
    console.error('  page errors during replay:', session.errors);
  }
  if (ok && rerecord) {
    const changed = fresh.filter(([t, h], i) => rec.checks[i][0] !== t || rec.checks[i][1] !== h).length;
    rec.checks = fresh;
    // Keep the file's own layout: some are pretty-printed by hand, some
    // came straight out of the browser as one line.
    const pretty = fs.readFileSync(file, 'utf8').includes('\n  "v"');
    fs.writeFileSync(file, JSON.stringify(rec, null, pretty ? 2 : 0) + (pretty ? '\n' : ''));
    console.log(`  RERECORDED — ${changed}/${fresh.length} checkpoint hashes rewritten`);
  } else if (ok) {
    const final = await session.page.evaluate(() => window.__harness.state());
    console.log(`  PASS — ${rec.checks.length} checkpoints matched; final: score=${final.score} hp=${final.player?.hp} wave=${final.wave?.n}`);
  }
  await session.context.close();
  return ok;
}

const server = await ensureServer();
const browser = await launchBrowser();
let failures = 0;
for (const file of files) {
  if (!(await replayOne(browser, server.url, file))) failures++;
}
await browser.close();
server.stop();
console.log(failures ? `\n${failures}/${files.length} recording(s) FAILED` : `\nall ${files.length} recording(s) reproduced exactly`);
process.exit(failures ? 1 : 0);
