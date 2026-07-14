import { validateRoom, type RoomDef } from '@engine/index';
import arenaJson from './arena.json';
import cavernJson from './cavern.json';
import throneJson from './throne.json';
import testRoomJson from './test_room.json';

/**
 * The world's rooms, by id. Door triggers reference these ids
 * (props.room). Add a room: drop the JSON here and register it.
 */
export const ROOMS: Record<string, RoomDef> = {
  arena: validateRoom(arenaJson),
  cavern: validateRoom(cavernJson),
  throne: validateRoom(throneJson),
  test_room: validateRoom(testRoomJson),
};

export const START_ROOM = 'arena';
