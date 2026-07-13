import { Sfx } from '@engine/index';

/** Register all named sounds. Content refers to these by id. */
export function registerSounds(sfx: Sfx): void {
  sfx.define('slash', (s) => {
    s.tone(650, 180, 0.08, 'sawtooth', 0.07);
    s.hiss(0.05, 0.06);
  });
  sfx.define('hit', (s) => {
    s.hiss(0.07, 0.22);
    s.tone(210, 70, 0.09, 'square', 0.16);
  });
  sfx.define('kill', (s) => {
    s.hiss(0.18, 0.26);
    s.tone(420, 45, 0.26, 'sawtooth', 0.2);
  });
  sfx.define('hurt', (s) => {
    s.tone(300, 90, 0.22, 'square', 0.22);
    s.hiss(0.1, 0.15);
  });
  sfx.define('jump', (s) => s.tone(180, 520, 0.12, 'square', 0.07));
  sfx.define('dash', (s) => {
    s.hiss(0.1, 0.12);
    s.tone(950, 320, 0.1, 'sawtooth', 0.05);
  });
  sfx.define('land', (s) => s.hiss(0.04, 0.09));
  sfx.define('wave', (s) => {
    s.tone(330, 660, 0.18, 'triangle', 0.12);
    s.toneAt(120, 440, 880, 0.22, 'triangle', 0.12);
  });
  sfx.define('combo', (s) => s.tone(880, 1320, 0.08, 'square', 0.06));
  sfx.define('fireball', (s) => {
    s.hiss(0.12, 0.14);
    s.tone(520, 140, 0.22, 'sawtooth', 0.1);
  });
  sfx.define('pickup', (s) => s.tone(660, 990, 0.09, 'triangle', 0.1));
  sfx.define('coin', (s) => {
    s.tone(880, 880, 0.05, 'square', 0.07);
    s.toneAt(60, 1175, 1175, 0.12, 'square', 0.07);
  });
  sfx.define('heal', (s) => {
    s.tone(440, 660, 0.15, 'triangle', 0.12);
    s.toneAt(100, 550, 880, 0.18, 'triangle', 0.1);
  });
  sfx.define('equip', (s) => {
    s.hiss(0.05, 0.1);
    s.tone(330, 220, 0.1, 'square', 0.1);
  });
  sfx.define('menuMove', (s) => s.tone(440, 460, 0.04, 'square', 0.04));
  sfx.define('menuSelect', (s) => s.tone(550, 770, 0.07, 'square', 0.06));
  sfx.define('menuOpen', (s) => s.tone(220, 440, 0.1, 'triangle', 0.08));
  sfx.define('menuClose', (s) => s.tone(440, 220, 0.1, 'triangle', 0.08));
  sfx.define('blip', (s) => s.tone(700, 740, 0.03, 'square', 0.03));
  sfx.define('gulp', (s) => {
    s.tone(400, 80, 0.3, 'sine', 0.25);
    s.hiss(0.15, 0.12);
  });
  sfx.define('denied', (s) => {
    s.tone(220, 180, 0.09, 'square', 0.1);
    s.toneAt(90, 180, 150, 0.12, 'square', 0.1);
  });
  sfx.define('buy', (s) => {
    s.tone(660, 660, 0.06, 'square', 0.08);
    s.toneAt(70, 880, 880, 0.06, 'square', 0.08);
    s.toneAt(140, 1320, 1320, 0.12, 'square', 0.08);
  });
  sfx.define('splat', (s) => {
    s.hiss(0.08, 0.14);
    s.tone(260, 60, 0.12, 'sine', 0.14);
  });
  sfx.define('nova', (s) => {
    s.hiss(0.25, 0.2);
    s.tone(180, 900, 0.18, 'sawtooth', 0.12);
    s.toneAt(60, 900, 200, 0.3, 'triangle', 0.12);
  });
  sfx.define('levelup', (s) => {
    s.tone(523, 523, 0.09, 'square', 0.09);
    s.toneAt(90, 659, 659, 0.09, 'square', 0.09);
    s.toneAt(180, 784, 784, 0.09, 'square', 0.09);
    s.toneAt(270, 1047, 1047, 0.22, 'square', 0.1);
  });
  sfx.define('unlock', (s) => {
    s.tone(440, 880, 0.12, 'triangle', 0.12);
    s.toneAt(110, 660, 1320, 0.16, 'triangle', 0.1);
  });
}
