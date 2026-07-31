/**
 * The observation, flattened into numbers a network can eat.
 *
 * This is the one place that decides what a learned policy is allowed to
 * know, which makes it the honest place to ask "is this field worth
 * anything" — train with it, train without it, compare. That question
 * defeated a whole day of hand-tuning, because a hand-written policy's
 * score moves for reasons unrelated to the field under test.
 *
 * Everything is scaled to roughly [-1, 1]. Not for elegance: an untrained
 * net starts with small weights, and a raw `dx` of 800 next to an
 * `onGround` of 1 means the first feature drowns the second before
 * learning begins.
 */

/** How many near monsters the net sees, closest first. */
export const MOBS = 4;
/** How many incoming shots it sees. */
export const SHOTS = 2;

/** Per-monster slots: present, dx, dy, gap, vx, vy, dmg, flies, reach, shoots. */
const MOB_F = 10;
/** Per-shot slots: present, dx, dy, vx, vy. */
const SHOT_F = 5;
/** Player + space block. */
const SELF_F = 16;

export const FEATURES = SELF_F + MOBS * MOB_F + SHOTS * SHOT_F + 2;

const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * Encode an observation. Returns a fresh Float64Array of length FEATURES.
 *
 * A null player (she is dead, or a menu owns the screen) encodes as all
 * zeros — the caller handles those cases before it ever gets here.
 */
export function encode(o, out = new Float64Array(FEATURES)) {
  out.fill(0);
  const p = o?.player;
  if (!p) return out;

  let i = 0;
  out[i++] = clamp(p.hp / p.maxHp);
  out[i++] = clamp(p.vx / 200);
  out[i++] = clamp(p.vy / 400);
  out[i++] = p.onGround ? 1 : 0;
  out[i++] = p.attackReady ? 1 : 0;
  out[i++] = clamp(p.invulnT / 0.6);
  out[i++] = clamp((p.busyT ?? 0) / 0.4);
  out[i++] = p.facing;
  out[i++] = p.dash?.ready ? 1 : 0;
  out[i++] = clamp(p.reach / 40);
  out[i++] = clamp((p.commitT ?? 0) / 0.5);
  out[i++] = clamp(o.space.left / 96);
  out[i++] = clamp(o.space.right / 96);
  out[i++] = o.space.ledgeLeft ? 1 : 0;
  out[i++] = o.space.ledgeRight ? 1 : 0;
  out[i++] = clamp(o.space.below / 160);

  // Near monsters, closest first — a stable order matters more than which
  // order, since slot 0 must mean the same kind of thing every frame.
  const near = o.monsters.filter((m) => m.distance !== 'far')
    .sort((a, b) => a.gap - b.gap);
  for (let k = 0; k < MOBS; k++) {
    const m = near[k];
    if (!m) { i += MOB_F; continue; }
    out[i++] = 1;
    out[i++] = clamp(m.dx / 200);
    out[i++] = clamp(m.dy / 100);
    out[i++] = clamp(m.gap / 200);
    out[i++] = clamp(m.vx / 200);
    out[i++] = clamp(m.vy / 200);
    out[i++] = clamp(m.dmg / 30);
    out[i++] = m.flies ? 1 : 0;
    out[i++] = m.distance === 'inReach' ? 1 : 0;
    out[i++] = m.shoots ? 1 : 0;
  }

  for (let k = 0; k < SHOTS; k++) {
    const s = o.shots[k];
    if (!s) { i += SHOT_F; continue; }
    out[i++] = 1;
    out[i++] = clamp(s.dx / 200);
    out[i++] = clamp(s.dy / 100);
    out[i++] = clamp(s.vx / 620);
    out[i++] = clamp(s.vy / 620);
  }

  // The far field, coarsely: how many are out there and which way the
  // nearest one lies. Enough to go and find the last straggler, which is
  // what stops a wave from ending.
  const far = o.monsters.filter((m) => m.distance === 'far');
  out[i++] = clamp(far.length / 4);
  out[i++] = far.length
    ? Math.sign(far.slice().sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx))[0].dx)
    : 0;
  return out;
}

/**
 * Every key combination the net can choose between.
 *
 * Deliberately a small closed set rather than a bit per key: 18 discrete
 * choices are far easier to learn than 9 independent binaries, and the
 * combinations left out (attack AND dash together, left AND right) are
 * ones the game ignores or that cancel.
 */
export const MOVES = (() => {
  const out = [];
  for (const dir of [[], ['left'], ['right']]) {
    for (const air of [[], ['jump']]) {
      for (const verb of [[], ['attack'], ['dash']]) {
        out.push([...dir, ...air, ...verb]);
      }
    }
  }
  return out;
})();
