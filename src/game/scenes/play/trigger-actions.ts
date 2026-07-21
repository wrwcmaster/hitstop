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
  run(def, host) {
    const props = def.props!;
    const p = host.player;
    // Two kinds of lock: a key item in the inventory, or a story flag
    // (props.flag — e.g. 'bossDefeated' seals the town road until then).
    const keyId = props.key as string | undefined;
    const flag = props.flag as string | undefined;
    const locked =
      (keyId && p && !p.inventory.has(keyId)) ||
      (flag && !host.hasFlag(flag));
    if (locked) {
      host.banner((props.lockedText as string) ?? 'THE GATE IS LOCKED', 1.2);
      if (p) host.game.feel.text(p.cx, p.y - 8, 'LOCKED', COLORS.red);
      host.game.sfx.play('denied');
      return;
    }
    host.goToRoom(props.room as string);
  },
});

defineTriggerAction('portal', {
  validateProps(props, path) {
    rejectUnknownProps(props, [], path);
  },
  // A `portal` trigger no longer opens the menu on contact — that forced a
  // destination choice mid-fight. It now marks an interaction zone that
  // PlayScene drives: stand on the pad and press interact (E) to travel.
  // Kept registered so room JSON stays validated; the run is intentionally
  // inert.
  run() {},
});
