import { Registry } from '@engine/index';

/**
 * The portal network. Each key location registers a destination: a room
 * to warp to and where you land in it. A portal pad (a 'portal' trigger,
 * drawn as a `portal` tile) offers a menu of every destination the player
 * has *visited* — the town always among them once the king falls, so you
 * can always get home. The player opens it by pressing interact (E) while
 * standing on the pad, so it never forces a choice mid-fight.
 *
 * Adding a stop is pure data: register a destination here and drop a
 * 'portal' trigger + `portal` tiles in that room's JSON.
 */
export interface PortalDest {
  /** Room id to warp into. */
  room: string;
  /** Menu label ("Haven — town of the living"). */
  label: string;
  /** Where you land (defaults to the room's playerSpawn if omitted). */
  x?: number;
  y?: number;
  /** Menu order (low first). */
  order: number;
}

export const portals = new Registry<PortalDest>('portal');

export function definePortal(id: string, def: PortalDest): void {
  portals.register(id, def);
}

// You now arrive standing on the destination room's portal pad (PlayScene
// computes the spot), so you step out of the portal you travelled to. The
// x/y below are only a fallback for a room with no portal trigger.
definePortal('arena', {
  room: 'arena',
  label: 'Greenwood - the arena gate',
  x: 150, y: 200,
  order: 1,
});

definePortal('cavern', {
  room: 'cavern',
  label: 'Sunless Cavern',
  x: 150, y: 216,
  order: 2,
});

definePortal('throne', {
  room: 'throne',
  label: "Slime King's throne",
  x: 40, y: 216,
  order: 3,
});

definePortal('town', {
  room: 'town',
  label: 'Haven - the town square',
  x: 120, y: 216,
  order: 4,
});

definePortal('grotto', {
  room: 'grotto',
  label: 'The Drowned Grotto',
  x: 60, y: 78,
  order: 5,
});

/** Destinations in menu order (the caller filters by what's visited). */
export function portalDests(): PortalDest[] {
  return portals.ids()
    .map((id) => portals.get(id))
    .sort((a, b) => a.order - b.order);
}

/** Importing this module registers the portal network. */
export function registerPortals(): void {}
