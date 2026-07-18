import { JsonStore } from '@engine/index';

/**
 * The knight's name — a device-level identity (not part of any save
 * slot), shown as a floating tag over each knight in multiplayer and
 * carried across the wire so the other player sees it too. Edited in
 * the co-op lobby.
 */
const store = new JsonStore<string>('hitstop.name', 1);

export const NAME_MAX = 12;

/** Trim, cap, and strip control characters (the font's Unicode
 * fallback draws everything printable — CJK names welcome). */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
}

export function playerName(): string {
  return store.load() ?? '';
}

export function setPlayerName(raw: string): void {
  store.save(cleanName(raw));
}

/** The name to show for this device, with a role-based fallback. */
export function displayName(role: 'host' | 'guest'): string {
  return playerName() || (role === 'host' ? 'PLAYER 1' : 'PLAYER 2');
}
