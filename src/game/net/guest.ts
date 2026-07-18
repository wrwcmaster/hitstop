import {
  type Scene,
  type PeerLink,
  Tilemap,
  Minimap,
  buildTilemap,
  drawText,
  clamp,
  t,
} from '@engine/index';
import type { ActionGame } from '../defs';
import { COLORS } from '../content/palette';
import { ROOMS, START_ROOM } from '../content/rooms';
import { Player } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { Background } from '../scenes/background';
import { Hud } from '../scenes/play/hud';
import type { PlayHost } from '../scenes/play/host';
import { saveStore, newestSave, restorePlayer, type SaveData } from '../save';
import { displayName } from '../name';
import { NET_ACTIONS, parseMsg, type SnapMsg, type KnightSnap } from './protocol';

/** Beyond this far from the server's word, stop gliding and snap. */
const SNAP_DIST = 48;

/** A puppet: a real actor rendered with real code but never simulated —
 * each snapshot repositions it, and we glide between snapshots. */
interface Puppet {
  actor: Player | Monster | Pickup;
  tx: number;
  ty: number;
}

/**
 * The guest side of a co-op session: the host's world, rendered — plus
 * one locally *predicted* actor: your own knight. It runs real physics
 * against the same tilemap with your live input, so movement feels
 * instant; the host's authoritative position is folded back in as a
 * gentle correction (a snap when badly wrong). Everything else is a
 * puppet driven by 20Hz snapshots. Your saved knight travels with you:
 * a hello carries it in, periodic syncs carry its progress home.
 */
export class CoopGuestScene implements Scene {
  private tilemap: Tilemap | null = null;
  private minimap: Minimap | null = null;
  private bg: Background;
  private hud: Hud;
  private hudHost: { game: ActionGame; player: Player | null };
  private roomId = '';
  private puppets = new Map<number, Puppet>();
  /** The locally simulated knight (prediction) + the server's last word. */
  private me: Player | null = null;
  private serverMe: KnightSnap | null = null;
  /** The saved knight we brought along (drives local gear visuals too). */
  private profile: SaveData['player'] | undefined;
  private banner: string | null = null;
  private snap: SnapMsg | null = null;
  private uiT = 0;
  private closedT = -1;

  constructor(
    private game: ActionGame,
    private link: PeerLink,
  ) {
    this.bg = new Background(game.width, game.height);
    // The Hud reads host.game + host.player — our predicted knight fits.
    this.hudHost = { game, player: null };
    this.hud = new Hud(this.hudHost as PlayHost);
    this.profile = newestSave()?.player;
    link.onMessage = (raw) => {
      const m = parseMsg(raw);
      if (m?.t === 'snap') this.apply(m);
      if (m?.t === 'sync') this.persist(m.player);
      if (m?.t === 'bye') this.drop();
    };
    link.onClose = () => this.drop();
    // Bring my knight: name for the tag, snapshot for the host's copy.
    link.send(JSON.stringify({ t: 'hello', name: displayName('guest'), player: this.profile }));
  }

  /** Fold the host's word on my knight into my own save, so co-op gold,
   * XP, and gear survive the session. Creates a save if I had none. */
  private persist(player: SaveData['player']): void {
    const cur = saveStore.load();
    if (cur) {
      cur.player = player;
      cur.savedAt = Date.now();
      saveStore.save(cur);
    } else {
      saveStore.save({
        roomId: START_ROOM, best: 0, savedAt: Date.now(),
        flags: [], firedTriggers: {}, player,
      });
    }
  }

  private drop(): void {
    if (this.closedT < 0) this.closedT = 1.6;
  }

  /* ---------------- snapshots in ---------------- */

  private apply(s: SnapMsg): void {
    this.snap = s;
    this.banner = s.banner;
    if (s.room !== this.roomId) this.enterRoom(s.room);
    const seen = new Set<number>();
    for (const k of s.knights) {
      // My own knight is predicted locally, not puppeted — remember the
      // server's word for the correction pass in update().
      if (k.id === s.you) {
        this.serverMe = k;
        continue;
      }
      seen.add(k.id);
      const p = this.puppet(k.id, () => new Player(this.game, this.tilemap!, k.x, k.y));
      const knight = p.actor as Player;
      p.tx = k.x;
      p.ty = k.y;
      knight.name = k.name ?? '';
      knight.facing = k.facing as 1 | -1;
      knight.hp = k.hp;
      knight.maxHp = k.maxHp;
      knight.animT = k.animT;
      if (knight.fsm.state !== k.state) {
        try { knight.fsm.set(k.state); } catch { /* unknown state: keep pose */ }
      }
      knight.fsm.t = k.st;
    }
    for (const m of s.mobs) {
      if (!monsters.has(m.type)) continue;
      seen.add(m.id);
      const p = this.puppet(m.id, () => new Monster(m.type, this.game, this.tilemap!, m.x, m.y));
      const mob = p.actor as Monster;
      p.tx = m.x;
      p.ty = m.y;
      mob.facing = m.facing as 1 | -1;
      mob.animT = m.animT;
      mob.hp = m.hp;
      mob.maxHp = m.maxHp;
    }
    for (const pk of s.picks) {
      seen.add(pk.id);
      const p = this.puppet(pk.id, () => new Pickup(pk.item, this.game, this.tilemap!, pk.x, pk.y));
      p.tx = pk.x;
      p.ty = pk.y;
    }
    for (const id of this.puppets.keys()) if (!seen.has(id)) this.puppets.delete(id);

    // The predicted knight carries the authoritative HUD numbers.
    const me = this.me;
    if (me) {
      me.hp = s.hud.hp;
      me.maxHp = s.hud.maxHp;
      me.mp = s.hud.mp;
      me.mpCap = s.hud.maxMp;
      me.gold = s.hud.gold;
      me.progression.restore({ xp: 0, level: s.hud.level, skillPoints: 0 });
      this.hudHost.player = me;
    }
  }

  private puppet(id: number, make: () => Player | Monster | Pickup): Puppet {
    let p = this.puppets.get(id);
    if (!p) {
      let actor: Player | Monster | Pickup;
      try {
        actor = make();
      } catch {
        // A content mismatch shouldn't kill the session; skip via a dud.
        actor = new Pickup('coin', this.game, this.tilemap!, -999, -999);
      }
      p = { actor, tx: actor.x, ty: actor.y };
      this.puppets.set(id, p);
    }
    return p;
  }

  private enterRoom(id: string): void {
    this.roomId = id;
    this.puppets.clear();
    this.serverMe = null;
    const room = ROOMS[id];
    if (!room) return;
    this.tilemap = buildTilemap(room);
    this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
    this.game.camera.setBounds(0, -30, this.tilemap.worldW, this.tilemap.worldH - 16);
    this.game.music.play((room.props?.music as string) ?? 'depths');
    // Respawn the predicted knight on the new ground. It lives in the
    // (otherwise empty) local world so real physics can drive it.
    this.game.world.clear();
    this.me = new Player(this.game, this.tilemap, room.playerSpawn.x, room.playerSpawn.y);
    this.me.name = displayName('guest');
    if (this.profile) restorePlayer(this.me, this.profile); // my gear, my look
    this.game.world.spawn(this.me);
    this.hudHost.player = this.me;
  }

  /* ---------------- update / render ---------------- */

  update(dt: number): void {
    this.uiT += dt;
    if (this.closedT >= 0) {
      this.closedT -= dt;
      if (this.closedT <= 0) this.leave();
      return;
    }
    // Esc leaves the session (there's no pause to open — the world is remote).
    if (this.game.input.consumePress('menu') || this.game.input.consumePress('cancel')) {
      this.link.send(JSON.stringify({ t: 'bye' }));
      this.leave();
      return;
    }
    // Stream what's held right now; the host turns it into edges.
    this.link.send(JSON.stringify({ t: 'in', held: NET_ACTIONS.filter((a) => this.game.input.held(a)) }));

    // Prediction: my knight runs real physics with my live input — zero
    // felt latency — then the server's word pulls it into line.
    this.game.world.update(dt);
    const me = this.me;
    const sv = this.serverMe;
    if (me && sv) {
      const dx = sv.x - me.x;
      const dy = sv.y - me.y;
      if (Math.hypot(dx, dy) > SNAP_DIST) {
        me.x = sv.x;
        me.y = sv.y;
      } else {
        const pull = Math.min(1, dt * 4);
        me.x += dx * pull;
        me.y += dy * pull;
      }
      // Life-or-death states are the host's call, not a prediction.
      const grim = sv.state === 'dead' || sv.state === 'swallowed';
      const meGrim = me.fsm.is('dead', 'swallowed');
      if (grim !== meGrim) {
        try { me.fsm.set(grim ? sv.state : 'move'); } catch { /* keep pose */ }
      }
    }

    // Glide puppets toward their snapshot targets (~2 snapshots of travel),
    // and keep animation clocks ticking between snapshots.
    const blend = Math.min(1, dt * 12);
    for (const p of this.puppets.values()) {
      p.actor.x += (p.tx - p.actor.x) * blend;
      p.actor.y += (p.ty - p.actor.y) * blend;
      if (p.actor instanceof Player || p.actor instanceof Monster) p.actor.animT += dt;
      if (p.actor instanceof Player) p.actor.fsm.t += dt;
    }
    if (me) {
      const cam = this.game.camera;
      const tx = me.cx - cam.viewW / 2 + me.facing * 18 + me.vx * 0.1;
      const ty = me.cy - cam.viewH * 0.62 + me.vy * 0.05;
      cam.follow(tx, ty, dt);
      cam.x = clamp(cam.x, 0, Math.max(0, (this.tilemap?.worldW ?? cam.viewW) - cam.viewW));
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    this.bg.render(g, gm.camera.x);
    if (this.tilemap) {
      gm.camera.begin(g);
      this.tilemap.render(g, gm.camera.x, gm.camera.y, gm.camera.viewW, gm.camera.viewH);
      const sorted = [...this.puppets.values()].sort((a, b) => a.actor.layer - b.actor.layer);
      for (const p of sorted) p.actor.render(g);
      this.me?.render(g); // the predicted knight, on top of the puppets
      // Projectiles come across as plain rects; draw them as glow dots.
      for (const s of this.snap?.shots ?? []) {
        g.fillStyle = COLORS.gold;
        g.fillRect(Math.round(s.x), Math.round(s.y), Math.max(2, s.w), Math.max(2, s.h));
        g.fillStyle = COLORS.white;
        g.fillRect(Math.round(s.x + s.w / 4), Math.round(s.y + s.h / 4), Math.max(1, s.w / 2), Math.max(1, s.h / 2));
      }
      gm.feel.renderWorld(g); // puppet state-enter hooks spawn real particles
      gm.camera.end(g);
    }
    if (this.snap && this.hudHost.player && this.minimap) {
      const boss = [...this.puppets.values()]
        .map((p) => p.actor)
        .find((a): a is Monster => a instanceof Monster && !!a.def.boss && a.hp > 0) ?? null;
      this.hud.render(g, {
        score: this.snap.hud.score,
        combo: 0,
        comboT: 0,
        banner: this.banner ?? '',
        bannerT: this.banner ? 1 : 0,
        label: this.roomId.toUpperCase(),
        uiT: this.uiT,
      }, this.minimap, boss);
    }
    drawText(g, t('CO-OP GUEST'), gm.width - 6, gm.height - 10, COLORS.steelDark, 1, 'right');
    if (this.closedT >= 0) {
      g.fillStyle = 'rgba(7,7,13,0.6)';
      g.fillRect(0, 0, gm.width, gm.height);
      drawText(g, t('CONNECTION LOST'), gm.width / 2, gm.height / 2 - 4, COLORS.red, 2, 'center');
    }
  }

  private leave(): void {
    // Keep the channel up a beat so the host's final sync can land
    // (persist() still runs until the close fires).
    const link = this.link;
    setTimeout(() => link.close(), 500);
    this.game.world.clear();
    // Import here would be circular; the scene that started us handles return.
    this.onLeave?.();
  }

  /** Set by the launcher: return to the title flow. */
  onLeave: (() => void) | null = null;
}
