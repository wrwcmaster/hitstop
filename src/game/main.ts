import { Game, validateRoom } from '@engine/index';
import { KEYMAP, VIEW_W, VIEW_H, type Action, type GameEvents } from './defs';
import { registerSounds } from './content/sfx';
import { registerEnemies } from './actors/enemies';
import { registerBosses } from './actors/boss';
import { registerItems } from './content/items';
import { registerSkills } from './content/skills';
import { registerConversations } from './content/conversations';
import './content/tiles';
import { PlayScene } from './scenes/play';

/**
 * Bootstrap: create the Game, register content, start the first scene.
 * Everything game-specific flows from here; the engine has no idea what
 * "hitstop the game" is.
 */
const canvas = document.getElementById('game') as HTMLCanvasElement;

const game = new Game<Action, GameEvents>({
  canvas,
  width: VIEW_W,
  height: VIEW_H,
  keymap: KEYMAP,
});

registerSounds(game.sfx);
registerEnemies();
registerBosses();
registerItems();
registerSkills();
registerConversations();

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

// Taps on the canvas count as "any key" (start/restart on mobile).
canvas.addEventListener('pointerdown', () => {
  game.sfx.unlock();
  game.input.notifyAnyPress();
});

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
  }
}
window.hitstop = game;
