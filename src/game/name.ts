import { JsonStore } from '@engine/index';

/**
 * The knight's name — a device-level identity (not part of any save
 * slot), shown as a floating tag over each knight in multiplayer and
 * carried across the wire so the other player sees it too. Edited in
 * the co-op lobby.
 */
const store = new JsonStore<string>('hitstop.name', 1);

export const NAME_MAX = 12;

/** Trim, cap, and strip anything the pixel font can't draw. */
export function cleanName(raw: string): string {
  return raw.replace(/[^ -~]/g, '').trim().slice(0, NAME_MAX);
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
