import { Registry, conversations, items, type TriggerDef } from '@engine/index';
import { COLORS } from '../../content/palette';
import type { PlayHost } from './host';
import { Monster } from '../../actors/monster';
import { optionalString, rejectUnknownProps, requireString } from '../../content/prop-validation';

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

export function defineTriggerAction(event: string, action: TriggerAction): void {
  triggerActions.register(event, action);
}

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

defineTriggerAction('door', {
  validateProps(props, path) {
    // No arrival coordinates: a door lands you at the destination's door
    // back here, so the doorway has one definition instead of two that
    // can disagree. See PlayScene.doorLanding.
    rejectUnknownProps(props, ['room', 'key', 'flag', 'lockedText', 'bossSeal', 'fallIn', 'leapUp'], path);
    for (const key of ['bossSeal', 'fallIn', 'leapUp']) {
      if (props[key] !== undefined && props[key] !== true) {
        throw new Error(`${path}.${key}: expected true or omitted`);
      }
    }
    requireString(props, 'room', path);
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
  const room = host.room;
  const roomW = Math.max(...room.tiles.map((r) => r.length)) * room.tileSize;
  const margin = room.tileSize * 3;
  return def.x <= margin || def.x + def.w >= roomW - margin;
}

/** Below this you are settling on a ledge; above it you are falling. */
const FALLING = 40;

/**
 * A shaft you drop into — the town well — taken by falling, not by
 * pressing a key.
 *
 * Opt-in per doorway (`fallIn`) rather than a blanket rule for every
 * interior passage, and gated on actually DESCENDING. Walking over the
 * mouth of a shaft while grounded leaves you standing on the lip; you go
 * down it because you jumped in, which is the whole appeal of a well.
 * The grotto shaft could take the same prop, but that one is a hole you
 * cross a room past, so it stays a deliberate press for now.
 */
function fallingIn(def: TriggerDef, host: PlayHost): boolean {
  return def.props?.fallIn === true && !!host.player && host.player.vy > FALLING;
}

/**
 * The other half of a vertical seam: a gap in the ceiling you jump up
 * through — how you leave the underground by the same well you dropped
 * down. Same shape as `fallIn`, opposite direction, and equally gated on
 * genuine motion so brushing the opening never counts.
 */
function leapingUp(def: TriggerDef, host: PlayHost): boolean {
  return def.props?.leapUp === true && !!host.player && host.player.vy < -FALLING;
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
