import { Game, GamepadInput, validateRoom } from '@engine/index';
import { KEYMAP, GAMEPAD, VIEW_W, VIEW_H, ZOOM, WORLD_ZOOM, type Action, type GameEvents, type ActionGame } from './defs';
import { registerSounds } from './content/sfx';
import { registerSongs } from './content/music';
import { registerEnemies } from './actors/enemies';
import { registerBosses } from './actors/boss';
import { registerNpcs } from './actors/npc';
import { registerItems } from './content/items';
import { registerWeapons } from './content/weapons';
import { registerSkills } from './content/skills';
import { registerSkillTree } from './content/skilltree';
import { registerStatuses } from './content/statuses';
import { registerConversations } from './content/conversations';
import { registerShops } from './content/shops';
import { registerPlaceables } from './content/placeables';
import { registerEffects } from './content/effects';
import { registerQuests } from './content/quests';
import { registerPortals } from './content/portals';
import { registerLocales } from './content/locales';
import { loadSettings } from './settings';
import './content/tiles';
import { PlayScene } from './scenes/play';

/**
 * Bootstrap: create the Game, register content, start the first scene.
 * Everything game-specific flows from here; the engine has no idea what
 * "hitstop the game" is.
 */
const canvas = document.getElementById('game') as HTMLCanvasElement;

const game: ActionGame = new Game<Action, GameEvents>({
  canvas,
  width: VIEW_W,
  height: VIEW_H,
  zoom: ZOOM,
  keymap: KEYMAP,
});
// The world renders 2x larger than the UI (Hollow Knight-ish character
// scale); camera scroll snaps to device pixels under both zooms.
game.camera.setZoom(WORLD_ZOOM);
game.camera.snap = 1 / (ZOOM * WORLD_ZOOM);

registerSounds(game.sfx);
registerSongs();
registerEnemies();
registerBosses();
registerNpcs();
registerWeapons();
registerItems();
registerSkills();
registerSkillTree();
registerStatuses();
registerConversations();
registerShops();
registerPlaceables(); // bridges monsters + NPCs; must come after them
registerEffects();
registerQuests();
registerPortals();
registerLocales();

// Gamepad: polled every frame, feeding the same action system. Attached to
// the game so the controls UI can rebind its buttons. Created before
// loadSettings so a saved pad mapping can be restored.
export const gamepad = new GamepadInput<Action>(game.input, GAMEPAD);
game.pad = gamepad;
game.onFrame(() => gamepad.poll());

loadSettings(game);

// Touch controls (hidden by CSS on pointer:fine devices). Buttons carry
// menu actions too, so touch players can drive dialogue and menus.
const bind = (id: string, ...actions: Action[]) => {
  const el = document.getElementById(id);
  if (el) for (const a of actions) game.input.bindTouchButton(el, a);
};
bind('bL', 'left');
bind('bR', 'right');
bind('bJ', 'jump', 'up');
bind('bA', 'attack', 'confirm');
bind('bD', 'dash', 'down');
bind('bI', 'interact'); // talk to NPCs / use, the touch equivalent of E
bind('bF', 'skill3'); // ice shard
bind('bM', 'menu'); // Esc: opens the system menu (and closes it — pause consumes 'menu')

// Taps on the canvas count as "any key" (start/restart on mobile) and, in
// logical screen coords, let menus be tapped directly (no on-screen arrows).
canvas.addEventListener('pointerdown', (e) => {
  game.sfx.unlock();
  game.input.notifyAnyPress();
  const r = canvas.getBoundingClientRect();
  game.input.notifyTap(
    ((e.clientX - r.left) / r.width) * VIEW_W,
    ((e.clientY - r.top) / r.height) * VIEW_H,
  );
});

// Belt-and-suspenders against mobile zoom: iOS Safari ignores
// `user-scalable=no` and touch-action for pinch, firing `gesture*` events
// instead, and can still double-tap-zoom. Swallow both so a double tap
// does nothing special. (Fullscreen is a deliberate opt-in in Options.)
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = e.timeStamp;
  if (now - lastTouchEnd < 300) e.preventDefault(); // kill the zoom half of a double-tap
  lastTouchEnd = now;
}, { passive: false });

// The level editor test-plays via localStorage: it writes the room JSON
// and opens the game with ?room=local, which replaces the whole world
// with that single room.
function testRoom() {
  if (new URLSearchParams(location.search).get('room') === 'local') {
    const raw = localStorage.getItem('hitstop.room');
    if (raw) {
      try {
        return validateRoom(JSON.parse(raw));
      } catch (err) {
        console.error('bad room in localStorage, ignoring', err);
      }
    }
  }
  return undefined;
}

game.scenes.switch(new PlayScene(game, testRoom()));
game.start();

// Handy for poking at the game from the console / bug reports.
declare global {
  interface Window {
    hitstop: typeof game;
    hitstopPad: typeof gamepad;
  }
}
window.hitstop = game;
window.hitstopPad = gamepad;
