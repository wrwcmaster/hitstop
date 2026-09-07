import { items, earnables, validateRoom } from '@engine/index';
import type { TestScenario } from '../defs';
import { ROOMS } from '../content/rooms';
import { placeables } from '../content/placeables';
import { validateRoomContent } from '../content/room-features';

/** Reject misspelled references before a scenario tears down the current world. */
export function validateScenario(scenario: TestScenario): void {
  if (scenario.roomDef) {
    validateRoomContent(validateRoom(scenario.roomDef), 'scenario');
  } else if (scenario.room !== undefined && !ROOMS[scenario.room]) {
    throw new Error(`Unknown scenario room: ${scenario.room}`);
  }
  for (const id of [...scenario.player?.give ?? [], ...scenario.player?.equip ?? []]) items.get(id);
  for (const id of scenario.player?.earned ?? []) earnables.get(id);
  for (const entity of scenario.spawn ?? []) {
    const def = placeables.get(entity.type);
    def.validateProps?.(entity.props ?? {}, `scenario.spawn.${entity.type}`);
  }
}
