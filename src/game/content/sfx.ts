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
}
