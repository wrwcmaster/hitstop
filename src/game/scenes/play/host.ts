import type { Tilemap, RoomDef } from '@engine/index';
import type { ActionGame } from '../../defs';
import type { Player } from '../../actors/player';

/**
 * The narrow seam between PlayScene and its collaborators (wave director,
 * trigger actions, HUD, cheats). Everything here is either a live read of
 * scene state or one of a handful of verbs the scene performs — so the
 * modules under play/ never reach into scene internals, and the scene
 * never needs to know how they work.
 */
export interface PlayHost {
  readonly game: ActionGame;
  readonly player: Player | null;
  readonly tilemap: Tilemap;
  readonly room: RoomDef;
  /** Id of the live room ('arena', 'town', ...). */
  readonly roomId: string;

  /** Show the big center-screen banner ("WAVE 3", "THE GATE IS LOCKED"). */
  banner(text: string, seconds?: number): void;
  /** The usage line under the banner — small text, device-resolved. */
  showHint(text: string, seconds: number): void;
  /** Begin a fade transition into another room. */
  goToRoom(roomId: string, x?: number, y?: number): void;
  /** Push the dialogue scene for a conversation id. */
  openConversation(id: string): void;
  /** Read a story flag ('bossDefeated', 'visited:town', ...). */
  hasFlag(id: string): boolean;
  /**
   * Change a tile for good ('' clears it). The single way anything alters
   * a room's geometry: the scene writes the live map AND records a room
   * patch, so the change survives leaving, saving, and loading. Writing
   * `tilemap.setTile` directly changes only the copy you are standing in,
   * and the room grows back the moment you walk out.
   */
  mutateTile(tx: number, ty: number, id: string): void;
  /**
   * Play a registered cutscene (content/cutscenes.ts) over the live
   * world: the scene hands the director the player's controls and the
   * camera until the timeline ends or is skipped.
   */
  playCutscene(id: string): void;
}
