import { validateRoom, type RoomDef } from '@engine/index';
import arenaJson from './arena.json';
import tutorialJson from './tutorial.json';
import cavernJson from './cavern.json';
import throneJson from './throne.json';
import townJson from './town.json';
import grottoJson from './grotto.json';
import vaultJson from './vault.json';
import rampartsJson from './ramparts.json';
import testRoomJson from './test_room.json';
import corridorJson from './corridor.json';
import eastGateJson from './east_gate.json';
import mountainJson from './mountain.json';
import mountainPassageJson from './mountain_passage.json';
import undergroundJson from './underground.json';
import rivenLipJson from './riven_lip.json';
import rivenDescentJson from './riven_descent.json';
import spanBridgesJson from './span_bridges.json';
import undercutJson from './undercut.json';
import viseApproachJson from './vise_approach.json';
import viseArenaJson from './vise_arena.json';
import rivenFlueJson from './riven_flue.json';
import mournApproachJson from './mourn_approach.json';
import mournArenaJson from './mourn_arena.json';

/**
 * The world's rooms, by id. Door triggers reference these ids
 * (props.room). Add a room: drop the JSON here and register it.
 */
export const ROOMS: Record<string, RoomDef> = {
  // The training yard: a first-ever run starts here (RunStart.tutorial),
  // one door skips it, the other finishes it — both land in the arena.
  tutorial: validateRoom(tutorialJson),
  arena: validateRoom(arenaJson),
  cavern: validateRoom(cavernJson),
  throne: validateRoom(throneJson),
  town: validateRoom(townJson),
  grotto: validateRoom(grottoJson),
  vault: validateRoom(vaultJson),
  ramparts: validateRoom(rampartsJson),
  test_room: validateRoom(testRoomJson),
  corridor: validateRoom(corridorJson),
  // Hearthstead's east wall: the built threshold between the town's
  // open ground and the walled pass beyond it.
  'east-gate': validateRoom(eastGateJson),
  mountain: validateRoom(mountainJson),
  mountain_passage: validateRoom(mountainPassageJson),
  underground: validateRoom(undergroundJson),
  // The Riven: the crack under the Foundry's floor, and the only place
  // Wall Grip can be earned (docs/world-design.md, migration step 1).
  'riven-lip': validateRoom(rivenLipJson),
  'riven-descent': validateRoom(rivenDescentJson),
  'span-bridges': validateRoom(spanBridgesJson),
  undercut: validateRoom(undercutJson),
  'vise-approach': validateRoom(viseApproachJson),
  'vise-arena': validateRoom(viseArenaJson),
  'riven-flue': validateRoom(rivenFlueJson),
  // The Underbell: through the Riven's floor to the bell's shoulder,
  // where the Keeper of the voice hands over Shockwave.
  'mourn-approach': validateRoom(mournApproachJson),
  'mourn-arena': validateRoom(mournArenaJson),
};

export const START_ROOM = 'arena';
