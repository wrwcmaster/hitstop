import { Registry, conversations, items, type TriggerDef } from '@engine/index';
import { COLORS } from '../../content/palette';
import type { PlayHost } from './host';
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
    rejectUnknownProps(props, ['room', 'key', 'flag', 'lockedText'], path);
    requireString(props, 'room', path);
    const key = optionalString(props, 'key', path);
    if (key && !items.has(key)) throw new Error(`${path}.key: unknown item "${key}"`);
    optionalString(props, 'flag', path);
    optionalString(props, 'lockedText', path);
  },
  /**
   * An open doorway is a gap in the wall: walk into it and you are
   * through, no key press. A barred one waits for interact instead, so
   * refusing you is a deliberate act — auto-firing it would howl LOCKED
   * every frame you stood in the opening.
   */
  autoFire: (def, host) => !doorLocked(def, host) && inOuterWall(def, host),
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
 * Is this doorway barred? Two kinds of lock: a key item in the
 * inventory, or a story flag (`props.flag` — 'bossDefeated' seals the
 * town road until then).
 */
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

function doorLocked(def: TriggerDef, host: PlayHost): boolean {
  const props = def.props!;
  const keyId = props.key as string | undefined;
  const flag = props.flag as string | undefined;
  const p = host.player;
  return !!((keyId && p && !p.inventory.has(keyId)) || (flag && !host.hasFlag(flag)));
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
