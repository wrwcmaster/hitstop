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
  /** Begin a fade transition into another room. */
  goToRoom(roomId: string, x?: number, y?: number): void;
  /** Push the dialogue scene for a conversation id. */
  openConversation(id: string): void;
  /** Read a story flag ('bossDefeated', 'visited:town', ...). */
  hasFlag(id: string): boolean;
}
