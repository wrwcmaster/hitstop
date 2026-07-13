import { JsonStore } from '@engine/index';
import type { ActionGame } from './defs';

/** Persisted user options (separate from save games). */
export interface Settings {
  master: number;
  music: number;
  sfx: number;
}

export const settingsStore = new JsonStore<Settings>('hitstop.settings', 1);

export function loadSettings(game: ActionGame): void {
  const s = settingsStore.load();
  if (!s) return;
  game.audio.setVolume('master', s.master);
  game.audio.setVolume('music', s.music);
  game.audio.setVolume('sfx', s.sfx);
}

export function saveSettings(game: ActionGame): void {
  settingsStore.save({
    master: game.audio.getVolume('master'),
    music: game.audio.getVolume('music'),
    sfx: game.audio.getVolume('sfx'),
  });
}
