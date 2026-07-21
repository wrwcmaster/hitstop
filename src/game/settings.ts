import { JsonStore, locale, setLocale } from '@engine/index';
import { KEYMAP, GAMEPAD, type ActionGame, type Action } from './defs';

/** Persisted user options (separate from save games). */
export interface Settings {
  master: number;
  music: number;
  sfx: number;
  /**
   * Only the keyboard bindings the player CHANGED (code -> actions); an
   * empty array records a key they unbound. Absent means pure defaults.
   */
  keys?: Record<string, Action[]>;
  /** Same, for gamepad buttons (index -> actions). */
  pad?: Record<number, Action[]>;
  /** UI language ('en', 'zh', ...). Absent = English. */
  locale?: string;
}

export const settingsStore = new JsonStore<Settings>('hitstop.settings', 3);

/**
 * v2 persisted a FULL snapshot of every binding, which quietly froze the
 * defaults as of the first time a player opened the options menu — and
 * since saving happens on any change at all, nudging the volume was
 * enough to do it. A later change to a default key could then never
 * reach them: when ArrowUp stopped being a jump key, anyone with saved
 * settings kept jumping on ArrowUp forever.
 *
 * v3 stores only what the player actually rebound, so untouched keys
 * always track the current defaults.
 */
const legacyStore = new JsonStore<Settings>('hitstop.settings', 2);

/** Carry volumes and language forward; drop the frozen binding snapshots. */
function migrateLegacy(): Settings | null {
  const old = legacyStore.load();
  if (!old) return null;
  const moved: Settings = {
    master: old.master,
    music: old.music,
    sfx: old.sfx,
    locale: old.locale,
  };
  settingsStore.save(moved);
  return moved;
}

type Bindings = Record<string, Action | Action[]>;

/**
 * The bindings that differ from `defaults` — the player's actual edits.
 * A key present in the defaults but missing now is recorded as `[]`, so
 * "I unbound this" survives a round trip and isn't undone by the merge.
 */
function changedFrom(defaults: Bindings, current: Record<string, Action[]>): Record<string, Action[]> {
  const norm = (v: Action | Action[] | undefined): string =>
    (v === undefined ? [] : Array.isArray(v) ? v : [v]).join(',');
  const diff: Record<string, Action[]> = {};
  for (const code of new Set([...Object.keys(defaults), ...Object.keys(current)])) {
    const now = current[code] ?? [];
    if (norm(now) !== norm(defaults[code])) diff[code] = now;
  }
  return diff;
}

/** Current defaults with the player's edits laid over the top. */
function applyChanges(defaults: Bindings, changes: Record<string, Action[]>): Bindings {
  const map: Bindings = { ...defaults };
  for (const [code, actions] of Object.entries(changes)) {
    if (actions.length) map[code] = actions;
    else delete map[code];
  }
  return map;
}

export function loadSettings(game: ActionGame): void {
  const s = settingsStore.load() ?? migrateLegacy();
  if (!s) return;
  game.audio.setVolume('master', s.master);
  game.audio.setVolume('music', s.music);
  game.audio.setVolume('sfx', s.sfx);
  if (s.keys) game.input.setKeymap(applyChanges(KEYMAP, s.keys));
  // Button indices are numbers, but object keys are strings at runtime —
  // the merge is index-agnostic, so it round-trips through the string form.
  if (s.pad && game.pad) {
    const merged = applyChanges(GAMEPAD.buttons as Bindings, s.pad as unknown as Record<string, Action[]>);
    game.pad.setButtonMap(merged as unknown as Record<number, Action | Action[]>);
  }
  if (s.locale) setLocale(s.locale);
}

export function saveSettings(game: ActionGame): void {
  const keys = changedFrom(KEYMAP, game.input.getKeymap());
  const padNow = game.pad?.getButtonMap();
  const pad = padNow
    ? changedFrom(GAMEPAD.buttons as Bindings, padNow as unknown as Record<string, Action[]>)
    : undefined;
  settingsStore.save({
    master: game.audio.getVolume('master'),
    music: game.audio.getVolume('music'),
    sfx: game.audio.getVolume('sfx'),
    // Omit entirely when nothing was rebound, so an untouched profile
    // carries no binding data to go stale in the first place.
    keys: Object.keys(keys).length ? keys : undefined,
    pad: pad && Object.keys(pad).length ? (pad as unknown as Record<number, Action[]>) : undefined,
    locale: locale(),
  });
}
