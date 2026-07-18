/**
 * Shared Playwright plumbing for the agent-play bridge and replay runner.
 *
 * Browser resolution order:
 *   PW_EXECUTABLE (explicit path) → PW_CHANNEL (e.g. msedge/chrome) →
 *   bundled chromium → msedge channel fallback (Windows dev boxes).
 */
import { chromium } from 'playwright';

export const GAME_URL = process.env.HITSTOP_URL ?? 'http://localhost:5173/';

export async function launchBrowser() {
  const opts = { headless: true, args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.PW_EXECUTABLE) {
    return chromium.launch({ ...opts, executablePath: process.env.PW_EXECUTABLE });
  }
  if (process.env.PW_CHANNEL) {
    return chromium.launch({ ...opts, channel: process.env.PW_CHANNEL });
  }
  try {
    return await chromium.launch(opts);
  } catch {
    return chromium.launch({ ...opts, channel: 'msedge' });
  }
}

/**
 * Open a fresh harness session: new context (clean localStorage — nothing
 * leaks between runs), optionally pre-seeded with a recording's boot-time
 * storage (saves/settings), navigate with ?harness=1&seed=N, wait for the
 * page to expose __harness.
 */
export async function openSession(browser, seed, { baseUrl = GAME_URL, storage = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (Object.keys(storage).length) {
    await context.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const url = new URL(baseUrl);
  url.searchParams.set('harness', '1');
  url.searchParams.set('seed', String(seed));
  await page.goto(url.toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__harness, null, { timeout: 15000 });
  return { context, page, errors, seed };
}

/** Hold exactly `down` for `frames` fixed steps; returns the resulting state. */
export function step(page, down = [], frames = 1) {
  return page.evaluate(([d, n]) => window.__harness.step(d, n), [down, frames]);
}

export function state(page) {
  return page.evaluate(() => window.__harness.state());
}

export function recording(page) {
  return page.evaluate(() => window.__harness.recording());
}
