import { Registry, conversations, items, type TriggerDef } from '@engine/index';
import { COLORS } from '../../content/palette';
import type { PlayHost } from './host';
import { optionalFiniteNumber, optionalString, rejectUnknownProps, requireString } from '../../content/prop-validation';

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
    rejectUnknownProps(props, ['room', 'x', 'y', 'key'], path);
    requireString(props, 'room', path);
    const key = optionalString(props, 'key', path);
    if (key && !items.has(key)) throw new Error(`${path}.key: unknown item "${key}"`);
    optionalFiniteNumber(props, 'x', path);
    optionalFiniteNumber(props, 'y', path);
  },
  run(def, host) {
    const props = def.props!;
    const keyId = props.key as string | undefined;
    const p = host.player;
    if (keyId && p && !p.inventory.has(keyId)) {
      host.banner('THE GATE IS LOCKED', 1.2);
      host.game.feel.text(p.cx, p.y - 8, 'LOCKED', COLORS.red);
      host.game.sfx.play('denied');
      return;
    }
    host.goToRoom(props.room as string, props.x as number | undefined, props.y as number | undefined);
  },
});
