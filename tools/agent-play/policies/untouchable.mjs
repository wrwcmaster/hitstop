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

/**
 * How far a step of INTENT is planned to carry her, px/s.
 *
 * Not her measured speed, and deliberately so. She actually covers
 * 35.1px in 0.35s — 100px/s, ground and air alike, since air control
 * here is full — but planning with that number measured worse (4/10
 * against 6/10). A slightly long step makes the policy commit to
 * clearing a threat rather than shaving past it, and shaving past is
 * how it gets touched. Kept at the value that plays better, with the
 * real one written down so the next reader is not misled.
 */
const RUN = 110;

/** How far ahead a footstep is judged. A jump is judged over its own
 * airtime instead, because that is how long it commits her. */
const WALK_HORIZON = 0.35;

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
function boxGap(shiftX, p, e, t, riseY = 0) {
  const ex = e.dx + e.vx * t - shiftX;
  const ey = e.dy + e.vy * t - riseY;
  const gx = Math.abs(ex) - (p.w + (e.w ?? 6)) / 2;
  const gy = Math.abs(ey) - (p.h + (e.h ?? 6)) / 2;
  // Both axes must overlap to touch, so the wider separation is the gap.
  return Math.max(gx, gy);
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
function tightest(shift, p, o, opt) {
  const STEPS = 6;
  const { commit, rise } = arc(p, o, opt.jump);
  let worst = Infinity;
  for (let i = 1; i <= STEPS; i++) {
    const f = i / STEPS;
    const when = commit * f;
    for (const m of o.monsters) {
      if (m.distance === 'far') continue;   // cannot reach her within the horizon
      worst = Math.min(worst, boxGap(shift * f, p, m, when, rise(when)));
    }
    for (const sh of o.shots) worst = Math.min(worst, boxGap(shift * f, p, sh, when, rise(when)));
  }
  return worst;
}

/**
 * Her OWN trajectory over a move, and how long that move ties her hands.
 *
 * This is the same discipline the swing already gets. An attack is judged
 * across `commitT` because she cannot dodge during it; a jump has to be
 * judged across its airtime for exactly the same reason. She launches at
 * `jump.speed`, gravity takes it back at `jump.gravity`, and in between
 * there are no air brakes — the arc happens whether or not she likes how
 * it turns out. Scoring a jump over the same 0.35s horizon as a footstep
 * prices half a commitment and calls it a move; that version lost a seed
 * to fourteen hits.
 *
 * Returns the seconds she is committed for, and rise(t) — how far above
 * her launch height she is at time t, negative being up, matching dy.
 */
function arc(p, o, jumping) {
  const g = p.jump?.gravity ?? 1500;
  const v0 = p.jump?.speed ?? 400;
  if (jumping) {
    // Up and back down to the same floor: the full commitment.
    return { commit: (2 * v0) / g, rise: (t) => -v0 * t + 0.5 * g * t * t };
  }
  if (!p.onGround) {
    // Already in the air and still committed. Time left is however long
    // the remaining drop takes, from her current vertical speed.
    const h = o.space.below;
    const vy = p.vy;
    const left = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * h))) / g;
    return { commit: Math.max(0.05, left), rise: (t) => vy * t + 0.5 * g * t * t };
  }
  return { commit: WALK_HORIZON, rise: () => 0 };
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

/*
 * ON THE DASH, which this policy does not use — a result, not an
 * omission.
 *
 * `player.dash` ships speed, length, cooldown and immunity because the
 * dash is the strongest defensive verb the knight owns: contact damage
 * skips the dash state outright and it leaves i-frames behind, so 0.36s
 * of every 0.45s can be spent untouchable while covering ~48px. Against
 * a game whose damage is almost entirely contact, that ought to end the
 * problem. Three schedulings, each measured over ten seeds:
 *
 *   an ordinary travel option     6/10, and stalls past 25,000 frames
 *   only under 10px of air        3/10, worse than never dashing
 *   with a common score horizon   7/10, no stalls — but identical to
 *                                 the same horizon WITHOUT the dash
 *
 * The first two failed for one reason, and it is a trap in any policy
 * that scores options: a walk was judged over the next 0.35s while a
 * dash was judged from 0.36s onward, because its immunity made the early
 * moments free. Those are different futures. The walk carried the cost
 * of the dangerous right-now and the dash never saw it, so the dash won
 * comparisons it had not earned — hence dashing constantly, killing
 * nothing, and stalling. Judged over one horizon the spam stops, and the
 * dash then turns out to be worth nothing here: at 0.36s a bat's current
 * velocity no longer predicts where it will be, so the landing spot is a
 * guess. Doing better needs monster BEHAVIOUR modelled rather than
 * velocity extrapolated. That is the honest next step, and worth taking:
 * the unrestricted version produced the only untouched clear this policy
 * has ever managed — seed 7, five waves, zero hits.
 */

/**
 * How fast each kind eats the gap, px/s, with the knight standing still.
 * Measured by staging one fight per kind: tools/agent-play/measure.mjs.
 *
 * This table replaces a guess, and the guess was not close. The margin
 * used to be `6 + damage/4` — about 8px in front of a bat — chosen
 * because it sounded like enough. A bat closes at 189px/s. Over a 0.34s
 * swing that is 64px of ground, so she was demanding an eighth of the
 * room she needed, which is why bats have led the damage table all day.
 */
const CLOSE_RATE = { slime: 82, bat: 189, brute: 55, archer: 0, gunner: 0 };

/**
 * Clear air a swing must respect: what this thing can cover while the
 * swing has the controls. Derived, so it stays right if a weapon gets
 * slower or a monster gets faster.
 */
const room = (m, p) => (CLOSE_RATE[m?.type] ?? 100) * (p.commitT || 0.3);

/** Worst gap while she is locked in a swing: pinned, for commitT. */
function swingSafety(p, o) {
  const STEPS = 5;
  let worst = Infinity;
  for (let i = 1; i <= STEPS; i++) {
    const when = (p.commitT || 0.3) * (i / STEPS);
    for (const m of o.monsters) {
      if (m.distance === 'far') continue;
      worst = Math.min(worst, boxGap(0, p, m, when, 0));
    }
    for (const sh of o.shots) worst = Math.min(worst, boxGap(0, p, sh, when, 0));
  }
  return worst;
}

/** Turn a chosen movement option into the keys that perform it. */
function go(opt, keys) {
  if (!opt) return keys;
  if (opt.jump) keys.push('jump');
  if (opt.dir) keys.push(opt.dir > 0 ? 'right' : 'left');
  return keys;
}

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

  // Where could she be a third of a second from now? Only somewhere the
  // room actually allows — `space` is what stops a retreat becoming a
  // corner or a fall, which is how an earlier version kept getting caught
  // with its shoulders against a wall.
  const step = RUN * WALK_HORIZON;
  // A ledge only forbids the move when she would actually reach it. The
  // first version vetoed a whole direction on `ledgeLeft` alone, but that
  // flag comes with a DISTANCE — `left: 94` means 94px of good floor and
  // then a drop, and her step is 38. A trace found her pinned against a
  // bat with both directions refused and nothing pressed, holding still
  // for ten frames while it closed, with three quarters of the arena
  // open behind her.
  const canGo = (space, ledge) => space >= step && (!ledge || space > step);
  const options = [{ dir: 0, shift: 0 }];
  if (canGo(o.space.left, o.space.ledgeLeft)) options.push({ dir: -1, shift: -step });
  if (canGo(o.space.right, o.space.ledgeRight)) options.push({ dir: 1, shift: step });
  // Jump is a move like any other and belongs on the menu — but it is
  // scored over its OWN airtime, not a footstep's horizon. Pricing it
  // over 0.35s when it commits her for 0.53s lost a seed to fourteen
  // hits: it looked safe because the scoring stopped before the landing.
  if (p.onGround) {
    options.push({ dir: 0, shift: 0, jump: true });
    if (canGo(o.space.left, o.space.ledgeLeft)) options.push({ dir: -1, shift: -step, jump: true });
    if (canGo(o.space.right, o.space.ledgeRight)) options.push({ dir: 1, shift: step, jump: true });
  }
  for (const opt of options) opt.gap = tightest(opt.shift, p, o, opt);
  options.sort((a, b) => b.gap - a.gap);
  const best = options[0];
  const standing = options.find((opt) => opt.dir === 0);

  // A shot already in the air outranks everything: it is the one threat
  // that does not care how far away its owner is.
  //
  // Jumping is the answer, and I checked the hard way. The reasoning
  // against it was sound — both shooters solve a ballistic arc, and the
  // archer aims 0.22s AHEAD of where she is walking, so "arrows fly
  // flat" is simply false. Removing the jump on that basis cost three
  // clears, 3/5 -> 1/5, with everything else held identical. Leaving the
  // ground dodges these shots whatever the arc is; the physics was right
  // and the conclusion drawn from it was not.
  // How near a shot has to be to matter is its SPEED times the time she
  // needs to leave the line — not a round number. Arrows fly at 318px/s
  // and bullets at 620, so one figure cannot serve both: 110px was 0.35s
  // of arrow and 0.18s of bullet, which is no warning at all.
  const incoming = o.shots.filter((s) =>
    Math.hypot(s.dx, s.dy) < Math.hypot(s.vx, s.vy) * WALK_HORIZON);
  if (incoming.length) {
    if (p.onGround && !best.jump) keys.push('jump');
    return go(best, keys);
  }

  // A drawn bow is a shot that has not been fired yet, and 0.45s of
  // warning is worth more than 0.3s of arrow. The archer's whole tell is
  // mode 'aim' — it holds still while drawing, and it leads her walk,
  // so the counter is to already be moving somewhere else by the time it
  // looses. Only when nothing is close enough to hit: a monster in her
  // face outranks a bowman across the room.
  // Measured honestly: reacting to this has not yet paid. Moving off
  // the spot whenever a bow is drawn scored 3/5 -> 2/5; using it to pick
  // a retreat direction changed nothing at all. The signal is real and
  // 339 frames of it appear in a single run — this policy just has not
  // found the use. Left in, and left visible, for whoever does.
  const drawing = o.monsters.some((m) => m.mode === 'aim');

  const target = o.monsters.filter((m) => m.distance !== 'far')
    .sort((a, b) => a.gap - b.gap)[0];

  // Nothing within arm's length: go and find something. A far monster is
  // reported as a name and a bearing and nothing else, which is all this
  // needs — but ignoring them entirely is not an option. Standing still
  // because no threat is CLOSE is how she died on wave 4 of every seed,
  // shot to pieces by archers she was never going to walk towards.
  if (!target) {
    if (drawing && (best.dir || best.jump)) return go(best, keys);
    const away = o.monsters.slice().sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx))[0];
    if (away) keys.push(away.dx > 0 ? 'right' : 'left');
    return keys;
  }
  const need = room(target, p);

  // A swing is a promise to stand still for `commitT`. Judge it over that
  // whole window with her PINNED where she is — because during it, she
  // is. Deciding on the current instant is how she kept swinging at a
  // slime that was safe when she pressed and touching her when the
  // animation let go.
  // Tried and rejected: swinging early to MEET a closing bat, on the
  // theory that fleeing cannot beat 80px/s. Measured, it turned dodges
  // into trades — hits went from 2-6 per run to 3-10 and one run died.
  // Against contact damage the blade is not a shield; distance is.
  if (target.distance === 'inReach' && p.attackReady && recover <= 0) {
    // Zero margin is not a margin: "will not literally touch me" left her
    // trading blows with brutes, and she loses trades. Demand real air.
    // A bat needs 64px of margin and her reach is 33: those cannot both
    // be satisfied, and that is not a bug in the arithmetic — it is the
    // game telling the truth. You cannot trade with something closing at
    // 189px/s using a swing that takes the controls for a third of a
    // second. So the other half of the rule: swing when it is NOT coming
    // at you. Bats weave, overshoot and turn; the moment after the pass
    // is free, and it is the only free one.
    const receding = (target.dx * target.vx + target.dy * target.vy) >= 0;
    if (swingSafety(p, o) > need * 0.6 || receding) {
      // Back off only from something that actually punishes the recovery.
      // Staged and measured (measure.mjs): after a swing beside it, a bat
      // lands a hit 0.38s later — just past the 0.34s commit — while a
      // slime and a brute never punish a stationary knight at all, out to
      // four seconds. Retreating from those two buys nothing and costs
      // the tempo that ends the wave.
      recover = (CLOSE_RATE[target.type] ?? 100) > 100
        ? Math.round((p.commitT || 0.3) * 60) + 10
        : 0;
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
    return go(best, keys);
  }

  // Free hits: contact costs nothing while i-frames burn, so spend them
  // swinging rather than running. Fleeing through them wastes the one
  // advantage a hit hands back.
  if (p.invulnT > (p.commitT || 0.3) && p.attackReady && o.monsters.some((m) => m.distance === 'inReach')) {
    keys.push('attack');
    return keys;
  }

  // Comfortable? Then close the distance — but only to the edge of the
  // swing. Walking INTO a body is the single most common way this policy
  // used to take damage, and the arena is not survivable by running.
  if (standing.gap >= need) {
    const want = p.reach - 4;
    if (Math.abs(target.dx) > want) keys.push(target.dx > 0 ? 'right' : 'left');
    // Otherwise she is INSIDE swinging distance and still cannot swing —
    // the thing is overhead, or beneath the arc, or the blade is not
    // ready. That combination used to emit no keys at all, and standing
    // still is the worst answer available: a trace of the arena showed
    // twelve consecutive frames of nothing while a bat fell from gap 17
    // to gap 0 and hit her. Every unexplained bat and slime hit was this.
    // If she cannot strike it, she gives ground.
    else return go(best, keys);
    // Bats hover out of a ground swing's arc — genuinely out, now that
    // `inReach` is a real hitbox overlap instead of a radius that quietly
    // claimed she could hit anything within 31px in any direction. A
    // grounded swing is a horizontal box at chest height; the only way to
    // put a bat inside it is to leave the floor, and the aerial attack
    // that follows reports its own reach.
    if (target.flies && target.dy < -8 && target.dy > -26 && p.onGround
      && Math.abs(target.dx) < p.reach) keys.push('jump');
    return keys;
  }

  // Crowded: take the safest option available, floor or air.
  return go(best, keys);
}
