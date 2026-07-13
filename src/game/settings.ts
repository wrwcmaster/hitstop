import { JsonStore } from '@engine/index';
import type { ActionGame, Action } from './defs';

/** Persisted user options (separate from save games). */
export interface Settings {
  master: number;
  music: number;
  sfx: number;
  /** Full keyboard bindings snapshot (code -> actions). Absent = defaults. */
  keys?: Record<string, Action[]>;
  /** Gamepad button bindings snapshot (index -> actions). Absent = defaults. */
  pad?: Record<number, Action[]>;
}

export const settingsStore = new JsonStore<Settings>('hitstop.settings', 2);

export function loadSettings(game: ActionGame): void {
  const s = settingsStore.load();
  if (!s) return;
  game.audio.setVolume('master', s.master);
  game.audio.setVolume('music', s.music);
  game.audio.setVolume('sfx', s.sfx);
  if (s.keys) game.input.setKeymap(s.keys);
  if (s.pad && game.pad) game.pad.setButtonMap(s.pad);
}

export function saveSettings(game: ActionGame): void {
  settingsStore.save({
    master: game.audio.getVolume('master'),
    music: game.audio.getVolume('music'),
    sfx: game.audio.getVolume('sfx'),
    keys: game.input.getKeymap(),
    pad: game.pad?.getButtonMap(),
  });
}
