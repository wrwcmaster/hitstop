/**
 * A policy whose only goal is to finish the arena WITHOUT BEING HIT.
 *
 * It exists to answer a question about perception, not to be clever: an
 * agent driving on positions alone died on wave 3, hurt twelve times, ten
 * of them by bats. Everything here is a direct consequence of a field
 * that `__observe()` added, and nothing here needs cleverness the game
 * does not already show you.
 *
 * Two doctrines, learned the expensive way and in this order:
 *
 *   SPACE IS SAFETY. Nearly all damage here is contact damage, so the
 *   question each turn is not "can I hit something" but "is anything
 *   about to reach me".
 *
 *   BUT FLEEING IS NOT A PLAN. The arena is closed and the waves do not
 *   stop, so an agent that only retreats loses by attrition — an earlier
 *   version of this file swung 8 times in 3000 frames and was dead by
 *   wave 4 with ten hits. Space has to be bought by killing things.
 */

/** Where a body will be in `t` seconds if it keeps doing what it is doing. */
const lead = (e, t) => ({ x: e.x + e.vx * t, y: e.y + e.vy * t });

/** Run speed, px/s — how far a step of intent actually carries her. */
const RUN = 110;

/**
 * Pixels of clear air between two boxes: <= 0 means they are touching.
 *
 * The quantity has to be a BOX GAP, not a distance between centres. The
 * version before this one scored centre distance and demanded 34px of it
 * before swinging — more than her own 31px reach, so "safe enough to
 * attack" and "close enough to hit" could never both be true and she
 * simply never attacked. Contact damage is an overlap test in the sim;
 * anything else is a different game's geometry.
 */
function boxGap(px, py, pw, ph, e, t) {
  const s = lead(e, t);
  const dx = Math.abs(px - (s.x + e.w / 2)) - (pw + e.w) / 2;
  const dy = Math.abs(py - (s.y + e.h / 2)) - (ph + e.h) / 2;
  // Both axes must overlap to touch, so the wider separation is the gap.
  return Math.max(dx, dy);
}

/**
 * The tightest moment of a move: the worst gap anywhere along it.
 *
 * Scoring only the endpoint says "run through the slime" is a fine idea,
 * because you end up comfortably on the far side of it — and that is
 * exactly what an earlier version did, walking 17px -> 12px into a slime
 * and calling it a retreat. It is the same endpoint-versus-path mistake
 * the engine's mover had before it started sweeping: where you FINISH is
 * not where you WENT. So sample the crossing, each threat led forward by
 * the time the step will actually have taken when she is there.
 */
function tightest(fromX, toX, p, o, t) {
  const STEPS = 5;
  const cy = p.y + p.h / 2;
  let worst = Infinity;
  for (let i = 1; i <= STEPS; i++) {
    const f = i / STEPS;
    const x = fromX + (toX - fromX) * f;
    const when = t * f;
    for (const m of o.monsters) worst = Math.min(worst, boxGap(x, cy, p.w, p.h, m, when));
    for (const s of o.shots) {
      worst = Math.min(worst, boxGap(x, cy, p.w, p.h, { ...s, w: 6, h: 6 }, when));
    }
  }
  return worst;
}

/**
 * Frames left in the back-off after a swing. The only state this policy
 * keeps, and it has to be state: nothing in the observation says "you
 * committed to an attack a moment ago", and that moment is exactly when
 * she is standing next to something angry with her guard down.
 */
let recover = 0;

/** Forget that memory. Call between runs, or a run inherits the last
 * one's half-finished back-off and starts by walking backwards. */
export function reset() {
  recover = 0;
}

/**
 * Clear air she insists on keeping, in px. Heavier hits earn more.
 *
 * Also tried and rejected: scaling this with the thing's SPEED, on the
 * reasoning that ~8px is a tenth of a second in front of a bat doing
 * 80px/s, so she reacts too late. It sounds right and it measures worse —
 * 24 hits across the five seeds against 20, and slower runs, because a
 * bigger no-go zone means more time spent backing up and less spent
 * ending the wave. Both experiments point the same way: the margin is not
 * where the remaining damage lives.
 */
const room = (m) => 6 + (m?.contactDamage ?? 0) / 4;

/**
 * One turn of play. `o` is the observation; returns the keys to hold.
 */
export function decide(o) {
  const keys = [];
  if (!o) return keys;

  // A panel on top of the world freezes it and takes the keyboard, so
  // nothing else in this function means anything until it is gone. This
  // is not a corner case: walking over a dropped weapon opens "Equip
  // this?", and an agent that ignored it stood there for 36,000 frames,
  // one and a half waves from a win, holding no keys at all.
  if (o.ui?.blocking) {
    keys.push('confirm');
    return keys;
  }

  const p = o.player;
  if (!p || p.hp <= 0) return keys;
  const t = 0.35;
  const here = { x: p.x + p.w / 2, y: p.y + p.h / 2 };

  // Where could she be a third of a second from now? Only somewhere the
  // room actually allows — `space` is what stops a retreat becoming a
  // corner or a fall, which is how an earlier version kept getting caught
  // with its shoulders against a wall.
  const step = RUN * t;
  const options = [{ dir: 0, x: here.x }];
  if (o.space.left > step * 0.6 && !o.space.ledgeLeft) options.push({ dir: -1, x: here.x - step });
  if (o.space.right > step * 0.6 && !o.space.ledgeRight) options.push({ dir: 1, x: here.x + step });
  for (const opt of options) opt.gap = tightest(here.x, opt.x, p, o, t);
  options.sort((a, b) => b.gap - a.gap);
  const best = options[0];
  const standing = options.find((opt) => opt.dir === 0);

  // A shot already in the air outranks everything: it is the one threat
  // that does not care how far away its owner is. Arrows fly flat, so
  // leaving the floor is the reliable answer to them.
  const incoming = o.shots.filter((s) => s.closing && s.dist < 110);
  if (incoming.length) {
    if (p.onGround) keys.push('jump');
    if (best.dir) keys.push(best.dir > 0 ? 'right' : 'left');
    return keys;
  }

  const target = o.monsters.slice().sort((a, b) => a.dist - b.dist)[0];
  if (!target) return keys;
  const need = room(target);

  // A swing is a promise to stand still for `commitT`. Judge it over that
  // whole window with her PINNED where she is — because during it, she
  // is. Deciding on the current instant is how she kept swinging at a
  // slime that was safe when she pressed and touching her when the
  // animation let go.
  // Tried and rejected: swinging early to MEET a closing bat, on the
  // theory that fleeing cannot beat 80px/s. Measured, it turned dodges
  // into trades — hits went from 2-6 per run to 3-10 and one run died.
  // Against contact damage the blade is not a shield; distance is.
  if (target.inReach && p.attackReady && recover <= 0) {
    // Zero margin is not a margin: "will not literally touch me" left her
    // trading blows with brutes, and she loses trades. Demand real air.
    if (tightest(here.x, here.x, p, o, p.commitT || 0.3) > need * 0.6) {
      recover = Math.round((p.commitT || 0.3) * 60) + 10;
      keys.push('attack');
      return keys;
    }
  }

  // Hit and run. The frames just after a swing are the ones she is hit
  // in: the commit has expired, she is still shoulder to shoulder with
  // whatever she just swung at, and the obvious move — swing again — is a
  // trade. Back out of reach instead, then come back in.
  if (recover > 0) {
    recover--;
    if (best.dir) keys.push(best.dir > 0 ? 'right' : 'left');
    return keys;
  }

  // Free hits: contact costs nothing while i-frames burn, so spend them
  // swinging rather than running. Fleeing through them wastes the one
  // advantage a hit hands back.
  if (p.invulnT > 0.15 && p.attackReady && o.monsters.some((m) => m.inReach)) {
    keys.push('attack');
    return keys;
  }

  // Comfortable? Then close the distance — but only to the edge of the
  // swing. Walking INTO a body is the single most common way this policy
  // used to take damage, and the arena is not survivable by running.
  if (standing.gap >= need) {
    const want = p.reach - 4;
    if (Math.abs(target.dx) > want) keys.push(target.dx > 0 ? 'right' : 'left');
    // Bats hover out of a ground swing's arc; jump to bring them into it,
    // but only when one is level enough that the swing will actually land.
    if (target.flies && target.dy < -8 && target.dy > -26 && p.onGround
      && Math.abs(target.dx) < p.reach) keys.push('jump');
    return keys;
  }

  // Crowded: take the safest ground available.
  if (best.dir) keys.push(best.dir > 0 ? 'right' : 'left');
  return keys;
}
