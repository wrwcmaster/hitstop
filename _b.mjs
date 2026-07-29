import { bootGame, close } from './tools/agent-play/headless.mjs';
import { readFileSync, readdirSync } from 'node:fs';
const dir = 'tools/agent-play/recordings';
const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const target = process.argv[2];
const prefix = all.slice(0, all.indexOf(target));
const load = (n) => JSON.parse(readFileSync(dir + '/' + n + '.json', 'utf8'));
const play = (h, s, name) => {
  const rec = load(name);
  s.load(rec.storage ?? {});
  h.replayRun(rec);
  let ok = true;
  for (const [step, want] of rec.checks) { h.runTo(step); if (h.hashNow() !== want) { ok = false; break; } }
  return ok;
};
// Try each single predecessor, then grow a suffix window backwards.
for (const pre of prefix) {
  const { harness, storage } = await bootGame({ fresh: true });
  play(harness, storage, pre);
  const ok = play(harness, storage, target);
  await close();
  if (!ok) { console.log('MINIMAL single poisoner: ' + pre + ' -> ' + target); process.exit(0); }
}
console.log('no single predecessor poisons ' + target + '; trying growing suffixes');
for (let k = 2; k <= prefix.length; k++) {
  const chain = prefix.slice(prefix.length - k);
  const { harness, storage } = await bootGame({ fresh: true });
  for (const p of chain) play(harness, storage, p);
  const ok = play(harness, storage, target);
  await close();
  console.log('  suffix[' + chain.join(',') + '] -> ' + (ok ? 'pass' : 'DIVERGES'));
  if (!ok) process.exit(0);
}
console.log('full prefix does not reproduce??');
process.exit(0);
