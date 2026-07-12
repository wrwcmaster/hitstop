import { Game, validateRoom } from '@engine/index';
import { KEYMAP, VIEW_W, VIEW_H, type Action, type GameEvents } from './defs';
import { registerSounds } from './content/sfx';
import { registerEnemies } from './actors/enemies';
import { registerItems } from './content/items';
import { registerSkills } from './content/skills';
import { registerConversations } from './content/conversations';
import './content/tiles';
import { PlayScene } from './scenes/play';
import arenaJson from './content/rooms/arena.json';

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
registerItems();
registerSkills();
registerConversations();

// Touch controls (hidden by CSS on pointer:fine devices).
const bind = (id: string, action: Action) => {
  const el = document.getElementById(id);
  if (el) game.input.bindTouchButton(el, action);
};
bind('bL', 'left');
bind('bR', 'right');
bind('bJ', 'jump');
bind('bA', 'attack');
bind('bD', 'dash');

// Taps on the canvas count as "any key" (start/restart on mobile).
canvas.addEventListener('pointerdown', () => {
  game.sfx.unlock();
  game.input.notifyAnyPress();
});

// The level editor test-plays via localStorage: it writes the room JSON
// and opens the game with ?room=local.
function loadRoom() {
  if (new URLSearchParams(location.search).get('room') === 'local') {
    const raw = localStorage.getItem('hitstop.room');
    if (raw) {
      try {
        return validateRoom(JSON.parse(raw));
      } catch (err) {
        console.error('bad room in localStorage, falling back to arena', err);
      }
    }
  }
  return validateRoom(arenaJson);
}

game.scenes.switch(new PlayScene(game, loadRoom()));
game.start();

// Handy for poking at the game from the console / bug reports.
declare global {
  interface Window {
    hitstop: typeof game;
  }
}
window.hitstop = game;
