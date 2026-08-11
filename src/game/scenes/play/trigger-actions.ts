import { GRAVITY, MAX_FALL, Registry, conversations, items, t, type TriggerDef } from '@engine/index';
import { COLORS } from '../../content/palette';
import type { PlayHost } from './host';
import { Monster } from '../../actors/monster';
import { optionalString, rejectUnknownProps, requireString } from '../../content/prop-validation';
import { provideTriggerValidators } from '../../content/room-features';
import { cutscenes } from '../../content/cutscenes';
import { edgeDoorSide } from './doorways';
import { promptText } from '../../defs';

/**
 * What each trigger `event` name means in the game. Room JSON stays pure
 * data; the scene routes a fired trigger here by name. Register a new
 * action (chest, checkpoint, ambush, cutscene...) and every room can use
 * it immediately — no scene changes. Unknown events are still emitted on
 * the game event bus for ad-hoc listeners, so they're never an error.
 */
export interface TriggerAction {
  run(def: TriggerDef, host: PlayHost): void;
  validateProps?(props: Record<string, unknown>, path: string): void;
  /**
   * Does this trigger fire the moment the player touches it, or wait for
   * the interact key? Omit it and the trigger fires on contact, which is
   * what a talk zone or an ambush wants.
   *
   * It is asked EVERY time rather than cached, because the answer can
   * change mid-room: a barred door starts as an interact prompt and
   * becomes a walk-through gap the instant you pick up its key.
   */
  autoFire?(def: TriggerDef, host: PlayHost): boolean;
}

export const triggerActions = new Registry<TriggerAction>('triggerAction');
// Hand room validation the validateProps half of this registry — content
// declares that seam (TriggerValidatorSource) but cannot import us.
provideTriggerValidators(triggerActions);

export function defineTriggerAction(event: string, action: TriggerAction): void {
  triggerActions.register(event, action);
}

defineTriggerAction('cutscene', {
  validateProps(props, path) {
    rejectUnknownProps(props, ['cutscene'], path);
    const id = requireString(props, 'cutscene', path);
    if (!cutscenes.has(id)) throw new Error(`${path}.cutscene: unknown cutscene "${id}"`);
  },
  run(def, host) {
    host.playCutscene(def.props!.cutscene as string);
  },
});

defineTriggerAction('talk', {
  validateProps(props, path) {
    rejectUnknownProps(props, ['conversation'], path);
    const id = requireString(props, 'conversation', path);
    if (!conversations.has(id)) throw new Error(`${path}.conversation: unknown conversation "${id}"`);
  },
  run(def, host) {
    host.openConversation(def.props!.conversation as string);
  },
});

// A zone that teaches: walking in shows one line on the HUD's hint slot
// and nothing else — no scene push, no pause, nothing to dismiss. Prompts
// resolve per device ('{jump}' names Space on keys and the pad's button
// when one is connected), so a tutorial never lies about the controls.
// once:false in the room JSON makes it refire on re-entry, which is what
// a station wants: come back confused, get told again.
defineTriggerAction('note', {
  validateProps(props, path) {
    rejectUnknownProps(props, ['text'], path);
    requireString(props, 'text', path);
  },
  run(def, host) {
    host.showHint(promptText(host.game, t(def.props!.text as string)), 4);
  },
});

defineTriggerAction('door', {
  validateProps(props, path) {
    // No arrival coordinates: a door lands you at the destination's door
    // back here, so the doorway has one definition instead of two that
    // can disagree. See PlayScene.doorLanding.
    rejectUnknownProps(
      props,
      ['room', 'key', 'flag', 'lockedText', 'bossSeal', 'fallIn', 'leapUp', 'trackX', 'label'],
      path,
    );
    for (const key of ['bossSeal', 'fallIn', 'leapUp', 'trackX']) {
      if (props[key] !== undefined && props[key] !== true) {
        throw new Error(`${path}.${key}: expected true or omitted`);
      }
    }
    requireString(props, 'room', path);
    optionalString(props, 'label', path); // sign text override ('SKIP TUTORIAL')
    const key = optionalString(props, 'key', path);
    if (key && !items.has(key)) throw new Error(`${path}.key: unknown item "${key}"`);
    optionalString(props, 'flag', path);
    optionalString(props, 'lockedText', path);
  },
  /**
   * Walk into a doorway in the outer wall and it answers: through if it
   * is open, a refusal if it is barred. Neither needs a key press, and a
   * barred one cannot nag, because triggers are edge-triggered — you get
   * one refusal per approach, not one per frame.
   */
  autoFire: (def, host) => inOuterWall(def, host) || fallingIn(def, host) || leapingUp(def, host),
  run(def, host) {
    const props = def.props!;
    if (doorLocked(def, host)) {
      const p = host.player;
      host.banner((props.lockedText as string) ?? 'THE GATE IS LOCKED', 1.2);
      if (p) host.game.feel.text(p.cx, p.y - 8, 'LOCKED', COLORS.red);
      host.game.sfx.play('denied');
      return;
    }
    host.goToRoom(props.room as string);
  },
});

/**
 * Is this doorway in the room's outer wall?
 *
 * Only those walk you through on contact. An INTERIOR passage — the
 * shaft down to the grotto, the stair up to the ramparts — sits in the
 * middle of a floor you have every reason to walk across, so making it
 * fire on touch means you can no longer cross your own room without
 * being swallowed by it. Those wait for interact, which is also how
 * Castlevania does it: doors live at the edges, and the way down is
 * something you choose.
 *
 * A regression test caught this rather than playtesting: the bat-bounds
 * fixture walks east across the cavern and started falling into the
 * grotto halfway.
 */
function inOuterWall(def: TriggerDef, host: PlayHost): boolean {
  return edgeDoorSide(host.room, def) !== null;
}

/** Below this you are settling on a ledge; above it you are falling. */
const FALLING = 40;

/** The simulation's fixed step: crossings are resolved sub-step against it. */
const STEP = 1 / 60;

/**
 * The downward motion this frame's crossing test should believe.
 *
 * Two corrections over reading `vy`, both about the fact that this runs
 * BEFORE the player's own step:
 *
 * - The step will apply gravity before moving, so the fall covers
 *   `(vy + g·dt)·dt`, not `vy·dt`. Predicting with the smaller number
 *   under-reaches the plane by a third of a pixel every time.
 * - If the LAST step already ended against the level boundary, the
 *   backstop clamped the body and zeroed vy — erasing the very motion
 *   that proves a crossing. Where a shaft runs to the room's edge (the
 *   vise-approach drop: plane 296, worldH 296) the wall and the seam sit
 *   at the same coordinate, so losing that evidence would strand the
 *   knight on the boundary with no velocity left to fire the seam ever
 *   again. The contact recorded the speed it stopped, so use it.
 */
function fallSpeed(p: NonNullable<PlayHost['player']>): number {
  const ground = p.lastCollision?.ground;
  if (ground?.boundary && p.vy === 0) return ground.impactVelocity;
  return Math.min(p.vy + GRAVITY * STEP, MAX_FALL);
}

/**
 * A shaft you drop into — the town well — taken by falling, not by
 * pressing a key.
 *
 * Opt-in per doorway (`fallIn`) rather than a blanket rule for every
 * interior passage, and gated on actually DESCENDING. Walking over the
 * mouth of a shaft while grounded leaves you standing on the lip; you go
 * down it because you jumped in, which is the whole appeal of a well.
 */
function fallingIn(def: TriggerDef, host: PlayHost): boolean {
  const p = host.player;
  if (def.props?.fallIn !== true || !p) return false;
  const vy = fallSpeed(p);
  if (vy <= FALLING) return false;
  // The seam fires at a plane, tested against the motion this step will
  // actually make. An OPEN shaft's plane is the band's far edge — the
  // point where this room's drawn shaft ends; firing on first touch used
  // to swap rooms while the knight was visibly short of the opening. A
  // LOCKED shaft is full (the choked flue's rubble IS the blockage), so
  // its far edge is unreachable by construction: its plane is the near
  // edge, where falling onto it constitutes the attempt the refusal
  // answers.
  const plane = doorLocked(def, host) ? def.y : def.y + def.h;
  return p.y + p.h + vy * STEP >= plane;
}

/**
 * The other half of a vertical seam: a gap in the ceiling you jump up
 * through — how you leave the underground by the same well you dropped
 * down. Same shape as `fallIn`, opposite direction, and equally gated on
 * genuine motion so brushing the opening never counts.
 */
function leapingUp(def: TriggerDef, host: PlayHost): boolean {
  const p = host.player;
  if (def.props?.leapUp !== true || !p) return false;
  // Mirror of fallSpeed: gravity works AGAINST a rise, so this step
  // climbs `(vy + g·dt)·dt` — less than vy·dt, and predicting with the
  // larger number would fire the seam for a jump that dies short of the
  // ceiling. A rise stopped by the boundary is the room's own roof,
  // which is a bonk, not a crossing, so there is nothing to recover.
  const vy = p.vy + GRAVITY * STEP;
  if (vy >= -FALLING) return false;
  // The same planes as fallingIn, mirrored upward: open = the band's
  // top (the ceiling plane), locked = the band's bottom, where rising
  // into the blocked gap is the attempt.
  const plane = doorLocked(def, host) ? def.y + def.h : def.y;
  return p.y + vy * STEP <= plane;
}

/**
 * Is this doorway barred? Three ways: a key item, a story flag
 * (`bossDefeated` seals the town road until then), or a boss seal.
 */
export function doorLocked(def: TriggerDef, host: PlayHost): boolean {
  const props = def.props!;
  const keyId = props.key as string | undefined;
  const flag = props.flag as string | undefined;
  const p = host.player;
  if (props.bossSeal === true && bossAlive(host)) return true;
  return !!((keyId && p && !p.inventory.has(keyId)) || (flag && !host.hasFlag(flag)));
}

/**
 * A boss seal locks while the boss draws breath, which is the opposite
 * of every other lock here (those open once you have earned something).
 * Asking the world directly rather than raising a flag means the seal
 * cannot be left set: kill the boss and the doors are open on the very
 * next frame, including if he dies to something other than the player.
 */
function bossAlive(host: PlayHost): boolean {
  return host.game.world
    .actors('enemy')
    .some((a) => a instanceof Monster && a.def.boss && a.hp > 0);
}

defineTriggerAction('portal', {
  validateProps(props, path) {
    rejectUnknownProps(props, [], path);
  },
  // Never on contact: a warp menu that opened when you brushed the pad
  // forced a destination choice mid-fight.
  autoFire: () => false,
  // A `portal` trigger no longer opens the menu on contact — that forced a
  // destination choice mid-fight. It now marks an interaction zone that
  // PlayScene drives: stand on the pad and press interact (E) to travel.
  // Kept registered so room JSON stays validated; the run is intentionally
  // inert.
  run() {},
});
