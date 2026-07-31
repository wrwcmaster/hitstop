/**
 * Measure the numbers a playing agent needs, by staging fights.
 *
 *   node tools/agent-play/measure.mjs
 *
 * The alternative — pick two candidate values, run ten seeds, keep the
 * winner — fits the sample rather than learning anything, and with
 * differences of a clear or two it mostly fits noise. Worse, it leaves
 * the number stranded: it is right for this weapon against these waves
 * and silently wrong the moment either changes.
 *
 * Every constant a policy needs has a real referent in the game. How
 * fast does a bat actually close? How far does a slime travel while a
 * swing has the controls? How long after a swing is she exposed? Those
 * are facts, they are cheap to measure, and a policy derived from them
 * needs no tuning at all.
 *
 * Each experiment stages one controlled fight, drives it deterministically
 * and reports what happened. Nothing here scores play; it only measures.
 */
import { bootGame, close } from './headless.mjs';

const KINDS = ['slime', 'bat', 'brute', 'archer', 'gunner'];
const FLOOR = 214;   // the arena's floor line for a standing knight
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6) => String(Math.round(v * 10) / 10).padStart(n);

const { harness, game } = await bootGame({ fresh: true, seed: 1 });
const scene = () => game.scenes.all().find((s) => s.constructor.name === 'PlayScene');

/** Stage a fight: one monster, the knight where we put her. */
function stage(type, dx, opts = {}) {
  harness.beginRun({ kind: 'scenario', scenario: {
    room: 'arena', quiet: true,
    player: { x: 400, y: 192, give: ['great-sword'], equip: ['great-sword'] },
    spawn: [{ type, x: 400 + dx, y: opts.y ?? FLOOR }],
  } });
  harness.step([], 30);           // let the room settle and her land
  return scene();
}

const mob = () => game.world.all().find((e) => e.constructor.name === 'Monster' && !e.dead);
const shot = () => game.world.all().find((e) => e.constructor.name === 'Projectile' && !e.dead);
const gapTo = (p, m) => Math.max(
  Math.abs(m.cx - p.cx) - (p.w + m.w) / 2,
  Math.abs(m.cy - p.cy) - (p.h + m.h) / 2,
);

/**
 * CLOSING SPEED: how fast each kind eats the gap while she stands still.
 *
 * This is the number behind every safety margin. A margin is not a taste,
 * it is "how much ground can this thing cover while I am unable to
 * react", so it falls straight out of this multiplied by whatever has
 * the controls.
 */
function closing(type) {
  stage(type, 140);
  const p = scene().player;
  let prev = null, fastest = 0, reached = null;
  for (let f = 1; f <= 600; f++) {
    const m = mob();
    if (!m) break;
    const g = gapTo(p, m);
    if (prev !== null && prev - g > fastest) fastest = prev - g;
    if (g <= 0 && reached === null) reached = f / 60;
    prev = g;
    harness.step([], 1);          // she never moves: this is the monster's doing
  }
  return { closeRate: fastest * 60, reachedIn: reached };
}

/**
 * SHOT SPEED: how fast a fired thing travels, and so how far away a
 * shooter's arrow still matters.
 */
function ballistics(type) {
  stage(type, 150);
  for (let f = 0; f < 600; f++) {
    harness.step([], 1);
    const s = shot();
    if (s) return { speed: Math.hypot(s.vx, s.vy) };
  }
  return { speed: null };
}

/**
 * POST-SWING EXPOSURE: swing next to something, then stand still. How
 * long until it lands a hit?
 *
 * That interval is what the back-off after an attack is actually for,
 * and it has been a guessed "+10 frames" this whole time.
 */
function exposure(type) {
  stage(type, 34);
  const p = scene().player;
  harness.step([], 40);           // let it walk into contact range
  const hp0 = p.hp;
  harness.step(['attack'], 2);    // commit
  let hurtAt = null;
  for (let f = 1; f <= 240 && hurtAt === null; f++) {
    harness.step([], 1);
    if (!scene().player || scene().player.hp < hp0) hurtAt = f / 60;
    if (!mob()) return { hurtAfterSwing: null, died: true };
  }
  return { hurtAfterSwing: hurtAt, died: false };
}

console.log('CLOSING SPEED — gap eaten per second, knight stationary');
console.log(pad('kind', 9), pad('px/s', 8), 'touched her after');
const rates = {};
for (const k of KINDS) {
  const r = closing(k);
  rates[k] = r.closeRate;
  console.log(pad(k, 9), num(r.closeRate, 8),
    r.reachedIn === null ? '  (never reached her)' : `  ${r.reachedIn.toFixed(2)}s`);
}

console.log('\nSHOT SPEED');
for (const k of ['archer', 'gunner']) {
  const b = ballistics(k);
  console.log(pad(k, 9), b.speed === null ? 'no shot in 10s' : num(b.speed, 8) + ' px/s');
}

console.log('\nPOST-SWING EXPOSURE — swing beside it, then stand still');
for (const k of KINDS) {
  const e = exposure(k);
  console.log(pad(k, 9), e.died ? 'killed it outright'
    : e.hurtAfterSwing === null ? 'never punished (4s)'
      : `hit ${e.hurtAfterSwing.toFixed(2)}s after the swing began`);
}

const worst = Math.max(...Object.values(rates));
console.log('\nDERIVED');
console.log('  fastest closer          ', num(worst), 'px/s');
console.log('  ground covered during a  0.34s swing commit:', num(worst * 0.34), 'px');
console.log('  ^ that is the safety margin a swing must respect, per kind:');
for (const k of KINDS) console.log('     ', pad(k, 9), num(rates[k] * 0.34), 'px');

await close();
process.exit(0);
