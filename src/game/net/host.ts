import { Input, Projectile, type PeerLink } from '@engine/index';
import { KEYMAP, type Action, type ActionGame } from '../defs';
import { Player } from '../actors/player';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { restorePlayer, snapshotPlayer, type SaveData } from '../save';
import { cleanName } from '../name';
import { NET_ACTIONS, SNAP_HZ, parseMsg, type SnapMsg } from './protocol';

/** How often the guest's knight state is synced back for their save. */
const SYNC_STEPS = 120; // 2s of fixed steps

/**
 * The host side of a co-op session. The guest's knight is a real Player
 * in the host's world, driven by a private Input that this session feeds
 * from the guest's action stream — the rest of the game can't tell it
 * from a local knight. Snapshots of the world go back the other way.
 */
export class CoopHost {
  /** The guest's knight (spawned/positioned by the scene). */
  guest: Player | null = null;

  private remote = new Input<Action>(KEYMAP);
  private held = new Set<Action>();
  private wanted: Action[] = [];
  private stepN = 0;
  private stepsPerSnap = Math.max(1, Math.round(60 / SNAP_HZ));
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  /** The guest's saved knight, if their hello beat the spawn. */
  private profile: SaveData['player'] | null = null;
  /** The guest's overhead tag (from their hello). */
  private guestName = 'PLAYER 2';
  /** Set when the guest vanishes; the scene shows a banner and detaches. */
  dropped = false;

  constructor(
    private game: ActionGame,
    private link: PeerLink,
  ) {
    link.onMessage = (raw) => {
      const m = parseMsg(raw);
      if (m?.t === 'in') this.wanted = m.held.filter((a) => NET_ACTIONS.includes(a));
      if (m?.t === 'hello') {
        this.guestName = cleanName(m.name ?? '') || 'PLAYER 2';
        if (this.guest) this.guest.name = this.guestName;
        // Their saved knight walks in: gear, gold, skills, quests intact.
        if (m.player) {
          if (this.guest) restorePlayer(this.guest, m.player);
          else this.profile = m.player;
        }
      }
      if (m?.t === 'bye') {
        this.syncBack(); // last chance to send their progress home
        this.dropped = true;
      }
    };
    link.onClose = () => { this.dropped = true; };
  }

  /** Bind a freshly spawned knight to the remote stream. */
  adopt(p: Player): void {
    this.guest = p;
    p.source = this.remote;
    p.name = this.guestName;
    if (this.profile) {
      restorePlayer(p, this.profile);
      this.profile = null;
    }
  }

  /** Ship the guest knight's current state back for their local save. */
  private syncBack(): void {
    if (!this.guest) return;
    this.link.send(JSON.stringify({ t: 'sync', player: snapshotPlayer(this.guest) }));
  }

  /** Before the world steps: turn the latest held-set into press/release edges. */
  applyInput(): void {
    const now = new Set(this.wanted);
    for (const a of now) if (!this.held.has(a)) this.remote.press(a);
    for (const a of this.held) if (!now.has(a)) this.remote.release(a);
    this.held = now;
  }

  /** After the world steps: snapshot cadence + edge-flag cleanup. */
  step(view: { roomId: string; score: number; banner: string | null }): void {
    this.remote.endStep();
    this.stepN++;
    if (this.stepN % SYNC_STEPS === 0) this.syncBack();
    if (this.stepN % this.stepsPerSnap !== 0) return;
    this.link.send(JSON.stringify(this.snapshot(view)));
  }

  private id(o: object): number {
    let n = this.ids.get(o);
    if (n === undefined) {
      n = this.nextId++;
      this.ids.set(o, n);
    }
    return n;
  }

  private snapshot(view: { roomId: string; score: number; banner: string | null }): SnapMsg {
    const g = this.guest;
    const snap: SnapMsg = {
      t: 'snap',
      room: view.roomId,
      you: g ? this.id(g) : 0,
      knights: [],
      mobs: [],
      picks: [],
      shots: [],
      hud: {
        hp: g?.hp ?? 0, maxHp: g?.maxHp ?? 1, mp: g?.mp ?? 0, maxMp: g?.maxMp ?? 1,
        gold: g?.gold ?? 0, level: g?.progression.level ?? 1, score: view.score,
      },
      banner: view.banner,
    };
    for (const e of this.game.world.all()) {
      if (e instanceof Player) {
        snap.knights.push({
          id: this.id(e), name: e.name, x: r(e.x), y: r(e.y), facing: e.facing,
          state: e.fsm.state, st: r(e.fsm.t), animT: r(e.animT),
          hp: e.hp, maxHp: e.maxHp,
        });
      } else if (e instanceof Monster) {
        snap.mobs.push({
          id: this.id(e), type: e.type, x: r(e.x), y: r(e.y), facing: e.facing,
          animT: r(e.animT), hp: e.hp, maxHp: e.maxHp,
        });
      } else if (e instanceof Pickup) {
        snap.picks.push({ id: this.id(e), item: e.itemId, x: r(e.x), y: r(e.y) });
      } else if (e instanceof Projectile) {
        snap.shots.push({ x: r(e.x), y: r(e.y), w: e.w, h: e.h });
      }
    }
    return snap;
  }

  close(): void {
    this.link.send(JSON.stringify({ t: 'bye' }));
    this.link.close();
  }
}

/** Wire precision: 0.1px is plenty and keeps snapshots compact. */
function r(n: number): number {
  return Math.round(n * 10) / 10;
}
