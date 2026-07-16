import { Registry, type TriggerDef } from '@engine/index';
import { COLORS } from '../../content/palette';
import type { PlayHost } from './host';

/**
 * What each trigger `event` name means in the game. Room JSON stays pure
 * data; the scene routes a fired trigger here by name. Register a new
 * action (chest, checkpoint, ambush, cutscene...) and every room can use
 * it immediately — no scene changes. Unknown events are still emitted on
 * the game event bus for ad-hoc listeners, so they're never an error.
 */
export type TriggerAction = (def: TriggerDef, host: PlayHost) => void;

export const triggerActions = new Registry<TriggerAction>('triggerAction');

export function defineTriggerAction(event: string, action: TriggerAction): void {
  triggerActions.register(event, action);
}

defineTriggerAction('talk', (def, host) => {
  if (typeof def.props?.conversation === 'string') host.openConversation(def.props.conversation);
});

defineTriggerAction('door', (def, host) => {
  if (typeof def.props?.room !== 'string') return;
  // A keyed door stays locked until the player holds its key item.
  const keyId = def.props.key as string | undefined;
  const p = host.player;
  if (keyId && p && !p.inventory.has(keyId)) {
    host.banner('THE GATE IS LOCKED', 1.2);
    host.game.feel.text(p.cx, p.y - 8, 'LOCKED', COLORS.red);
    host.game.sfx.play('denied');
    return;
  }
  host.goToRoom(def.props.room, def.props.x as number | undefined, def.props.y as number | undefined);
});
