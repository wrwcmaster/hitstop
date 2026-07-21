import { validateRoom, type RoomDef } from '@engine/index';
import arenaJson from './arena.json';
import cavernJson from './cavern.json';
import throneJson from './throne.json';
import townJson from './town.json';
import grottoJson from './grotto.json';
import vaultJson from './vault.json';
import rampartsJson from './ramparts.json';
import testRoomJson from './test_room.json';
import corridorJson from './corridor.json';
import mountainJson from './mountain.json';
import undergroundJson from './underground.json';

/**
 * The world's rooms, by id. Door triggers reference these ids
 * (props.room). Add a room: drop the JSON here and register it.
 */
export const ROOMS: Record<string, RoomDef> = {
  arena: validateRoom(arenaJson),
  cavern: validateRoom(cavernJson),
  throne: validateRoom(throneJson),
  town: validateRoom(townJson),
  grotto: validateRoom(grottoJson),
  vault: validateRoom(vaultJson),
  ramparts: validateRoom(rampartsJson),
  test_room: validateRoom(testRoomJson),
  corridor: validateRoom(corridorJson),
  mountain: validateRoom(mountainJson),
  underground: validateRoom(undergroundJson),
};

export const START_ROOM = 'arena';
