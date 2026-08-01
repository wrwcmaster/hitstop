/**
 * Planner sets the goal; the learned net does the work — except when the
 * goal is "walk over there and nothing is trying to kill you", which is
 * not a skill worth spending a network on.
 *
 * This is the honest first version of the split. The net's goal slots are
 * currently zero-weighted (see grow.mjs — they were added after it was
 * trained, deliberately inert so the fighting survived), so it cannot yet
 * steer toward anything. Until those weights are trained, travelling in
 * an empty room is done by walking, which is exactly what the baseline
 * showed works: two of the three doors on the route fall to "hold a
 * direction" in 79-100 frames.
 *
 * The point of writing it this way is that the seam is real. When the
 * goal slots are trained, delete `travel` and the same runner should get
 * strictly better — and if it does not, that is a measurement worth
 * having rather than a refactor to argue about.
 */
import { actor } from './rollout.mjs';
import * as rules from '../policies/untouchable.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const blob = JSON.parse(fs.readFileSync(path.join(here, 'weights.json'), 'utf8'));

/** Anything closer than this and the fight matters more than the trip. */
const DANGER = 70;

export function make(goalOf) {
  const net = actor(Float64Array.from(blob.weights), blob.shape, goalOf);
  return (o) => {
    if (o?.ui?.blocking) return ['confirm'];
    if (!o?.player) return [];
    const goal = goalOf();

    // Something near, or the job is to kill: a fighter has the controls.
    const near = o.monsters.some((m) => m.distance !== 'far' && m.gap < DANGER)
      || o.shots.length > 0;
    if (!goal || goal.kind === 2 || near) {
      // Which fighter is measured, not preferred. Over ten held-out
      // seeds the rule-based policy clears the arena 6/10 against the
      // net's 3/10; against the Slime King the net kills him at 120/120
      // HP and the rule policy dies. So each takes the fight it is
      // better at, and the honest target for the learner is to take the
      // arena back by beating 6/10 rather than by being the newer idea.
      // "Is this a boss fight" comes from the observation, not from the
      // planner: a monster that names itself slime-king is the fact, and
      // the driver should not have to be told what it can already see.
      const boss = o.monsters.some((m) => m.type === 'slime-king');
      return boss ? net(o) : rules.decide(o);
    }

    // Clear road, somewhere to be. Walk, and hop at a wall or a ledge —
    // enough for the doors on this route, and no more than that.
    const dx = goal.x - (o.player.x + o.player.w / 2);
    const dir = dx > 0 ? 'right' : 'left';
    const room = dx > 0 ? o.space.right : o.space.left;
    const ledge = dx > 0 ? o.space.ledgeRight : o.space.ledgeLeft;
    const keys = [dir];
    if (o.player.onGround && (room < 12 || (ledge && room < 24))) keys.push('jump');
    return keys;
  };
}

/** The runner calls `make`; this exists so the module also satisfies the
 * plain policy shape used by arena-trial. */
const solo = make(() => null);
export const decide = (o) => solo(o);
export function reset() {}
