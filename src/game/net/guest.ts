import {
  type Scene,
  type PeerLink,
  type Solid,
  Tilemap,
  Minimap,
  RoomPatches,
  Letterbox,
  buildTilemap,
  drawText,
  clamp,
  t,
} from '@engine/index';
import type { ActionGame } from '../defs';
import { COLORS } from '../content/palette';
import { ROOMS, START_ROOM } from '../content/rooms';
import { drawCrest } from '../actors/shockwave';
import { DEFAULT_SONG } from '../content/music';
import { Player, type AttackContext } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { drawPlatform, drawLever, drawPlate, drawBarrier, type GizmoSnap } from '../actors/gizmos';
import { drawArrow, drawBullet } from '../content/ballistics';
import { Background } from '../scenes/background';
import { Hud } from '../scenes/play/hud';
import type { PlayHost } from '../scenes/play/host';
import { saveStore, newestSave, restorePlayer, type SaveData } from '../save';
import { displayName } from '../name';
import { NET_ACTIONS, parseMsg, type SnapMsg, type KnightSnap } from './protocol';

/** Beyond this far from the server's word, stop gliding and snap. */
const SNAP_DIST = 48;

/** Mirror a puppet knight's worn gear onto its Equipment (so it renders
 * the same weapon and armor as the real knight). Only rewears when the
 * set actually changed — equip() is cheap but this avoids churning every
 * snapshot for gear that rarely moves. */
function applyGear(knight: Player, gear?: [string, string][]): void {
  const want = gear ?? [];
  const have = knight.equipment.slots();
  if (have.length === want.length && have.every(([s, id], i) => want[i]?.[0] === s && want[i]?.[1] === id)) {
    return;
  }
  knight.equipment.clear();
  for (const [, id] of want) knight.equipment.equip(id);
}

/** A puppet: a real actor rendered with real code but never simulated —
 * each snapshot repositions it, and we glide between snapshots. */
interface Puppet {
  actor: Player | Monster | Pickup;
  tx: number;
  ty: number;
}

/** A gizmo puppet: rendered from its snap, gliding toward the newest
 * one. Platforms and closed barriers dock a solid into the guest's
 * tilemap so the predicted knight can stand on / bump into them. */
interface GizPuppet {
  snap: GizmoSnap;
  x: number;
  y: number;
  solid: Solid;
  docked: boolean;
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
  private gizmos = new Map<number, GizPuppet>();
  /** The locally simulated knight (prediction) + the server's last word. */
  private me: Player | null = null;
  private serverMe: KnightSnap | null = null;
  /** The saved knight we brought along (drives local gear visuals too). */
  private profile: SaveData['player'] | undefined;
  /**
   * The live room's differences from its authored JSON, as the host last
   * reported them. Held here rather than applied and forgotten, because
   * `enterRoom` rebuilds the tilemap from the immutable RoomDef and the
   * hole has to be put back.
   */
  private patches = new RoomPatches();
  private banner: string | null = null;
  private snap: SnapMsg | null = null;
  private uiT = 0;
  private closedT = -1;
  /** The host's directed shot while its cutscene runs (see SnapMsg.cine):
   * we mirror the camera and the letterbox for its duration. */
  private cine: { x: number; y: number } | null = null;
  private cineBox = new Letterbox();

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
    // The host's word on my knight is also the only way my PREDICTED
    // knight learns about a verb won mid-session: the boss grants it to
    // the host's copy, and without this my local copy would keep failing
    // its `earned.has(...)` gate until I quit and reloaded — a wall my own
    // knight could climb on the host's screen but not on mine.
    this.profile = player;
    if (this.me) this.me.earned.restore(player.earned, { game: this.me.game, player: this.me });
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
    this.cine = s.cine ?? null;
    const enteredRoom = s.room !== this.roomId;
    if (enteredRoom) this.enterRoom(s.room);
    // Geometry the host has changed. Arrives on room entry and whenever
    // it changes; applied AFTER enterRoom, which has just rebuilt the map
    // from the authored room and undone everything the world did to it.
    if (s.patch) {
      this.patches.restore({ [s.room]: s.patch });
      this.applyPatch();
    }
    const seen = new Set<number>();
    for (const k of s.knights) {
      // My own knight is predicted locally, not puppeted — remember the
      // server's word for the correction pass in update(). Take the host's
      // tag for it too: the host disambiguates a name that collides with
      // its own, so this is what keeps two same-named knights distinct.
      if (k.id === s.you) {
        this.serverMe = k;
        if (this.me) {
          if (k.name) this.me.name = k.name;
          // Room entry is a discontinuity, not prediction error: begin at
          // the host's actual doorway landing and frame it immediately.
          if (enteredRoom) {
            this.me.x = k.x;
            this.me.y = k.y;
            this.me.facing = k.facing as 1 | -1;
          }
        }
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
      applyGear(knight, k.gear);
      // The shape goes on BEFORE the state, because entering 'attack' is
      // what reads it — set it after and the first frame poses wrong.
      if (k.ac) knight.poseAttackAs(k.ac as AttackContext);
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

    // Gizmos: refresh state, dock/undock solids to match the host's world.
    const gizSeen = new Set<number>();
    for (const gz of s.giz ?? []) {
      gizSeen.add(gz.id);
      let p = this.gizmos.get(gz.id);
      if (!p) {
        p = {
          snap: gz,
          x: gz.x,
          y: gz.y,
          solid: { x: gz.x, y: gz.y, w: gz.w, h: gz.h, dynamic: true },
          docked: false,
        };
        this.gizmos.set(gz.id, p);
      }
      p.snap = gz;
      const wantSolid = gz.kind === 'platform' || (gz.kind === 'barrier' && !gz.on);
      const solids = this.tilemap?.extraSolids;
      if (solids && wantSolid !== p.docked) {
        if (wantSolid) solids.push(p.solid);
        else {
          const i = solids.indexOf(p.solid);
          if (i >= 0) solids.splice(i, 1);
        }
        p.docked = wantSolid;
      }
    }
    for (const [id, p] of this.gizmos) {
      if (gizSeen.has(id)) continue;
      if (p.docked) {
        const solids = this.tilemap?.extraSolids;
        const i = solids?.indexOf(p.solid) ?? -1;
        if (solids && i >= 0) solids.splice(i, 1);
      }
      this.gizmos.delete(id);
    }

    // The predicted knight carries the authoritative HUD numbers.
    const me = this.me;
    if (me) {
      me.hp = s.hud.hp;
      me.maxHp = s.hud.maxHp;
      me.mp = s.hud.mp;
      me.mpCap = s.hud.maxMp;
      me.gold = s.hud.gold;
      me.air = s.hud.air ?? 1;
      me.progression.restore({ xp: 0, level: s.hud.level, skillPoints: 0 });
      this.hudHost.player = me;
    }
    if (enteredRoom) this.snapCamera();
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

  /** Stamp the host's geometry onto our copy of the room. */
  private applyPatch(): void {
    if (!this.tilemap) return;
    this.patches.applyTiles(this.roomId, this.tilemap);
    this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
  }

  private enterRoom(id: string): void {
    this.roomId = id;
    this.puppets.clear();
    this.gizmos.clear(); // buildTilemap starts extraSolids fresh
    this.serverMe = null;
    const room = ROOMS[id];
    if (!room) return;
    this.tilemap = buildTilemap(room);
    this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
    this.game.camera.setBounds(0, -30, this.tilemap.worldW, this.tilemap.worldH - 16);
    this.game.music.play((room.props?.music as string) ?? DEFAULT_SONG);
    // Respawn the predicted knight on the new ground. It lives in the
    // (otherwise empty) local world so real physics can drive it.
    this.game.world.clear();
    this.me = new Player(this.game, this.tilemap, room.playerSpawn.x, room.playerSpawn.y);
    this.me.name = displayName('guest');
    if (this.profile) restorePlayer(this.me, this.profile); // my gear, my look
    this.game.world.spawn(this.me);
    // A room we have been in before may already have holes in it.
    this.applyPatch();
    this.hudHost.player = this.me;
  }

  /* ---------------- update / render ---------------- */

  private cameraTarget(): { x: number; y: number } | null {
    const me = this.me;
    if (!me) return null;
    const cam = this.game.camera;
    return {
      x: me.cx - cam.viewW / 2 + me.facing * 18 + me.vx * 0.1,
      y: me.cy - cam.viewH * 0.62 + me.vy * 0.05,
    };
  }

  private snapCamera(): void {
    const target = this.cameraTarget();
    if (!target) return;
    const cam = this.game.camera;
    cam.x = clamp(target.x, cam.minX, Math.max(cam.minX, cam.maxX - cam.viewW));
    cam.y = clamp(target.y, cam.minY, Math.max(cam.minY, cam.maxY - cam.viewH));
  }

  update(dt: number): void {
    this.uiT += dt;
    if (this.closedT >= 0) {
      this.closedT -= dt;
      if (this.closedT <= 0) this.leave();
      return;
    }
    // Esc leaves the session (there's no pause to open — the world is
    // remote) — EXCEPT during a cutscene, where menu means what it means
    // on the host: skip. The request goes up; the host fast-forwards for
    // both screens. Cancel still leaves, so a guest is never trapped.
    if (this.game.input.consumePress('menu')) {
      if (this.cine) {
        this.link.send(JSON.stringify({ t: 'skip' }));
      } else {
        this.link.send(JSON.stringify({ t: 'bye' }));
        this.leave();
        return;
      }
    }
    if (this.game.input.consumePress('cancel')) {
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
    // Gizmos glide the same way; their solids track so the predicted
    // knight rides a platform instead of clipping through it.
    for (const p of this.gizmos.values()) {
      const ddx = (p.snap.x - p.x) * blend;
      const ddy = (p.snap.y - p.y) * blend;
      // Carry my predicted knight if she stands on this platform.
      const s = p.solid;
      if (me && p.snap.kind === 'platform' && p.docked &&
          Math.abs(me.y + me.h - s.y) < 2 && me.x + me.w > s.x - 1 && me.x < s.x + s.w + 1 && me.vy >= 0) {
        me.x += ddx;
        me.y += ddy;
      }
      p.x += ddx;
      p.y += ddy;
      s.x = p.x;
      s.y = p.y;
      s.w = p.snap.w;
      s.h = p.snap.h;
    }
    // During the host's cutscene the shot is the director's: glide to the
    // host camera instead of framing my own knight. My knight stays live
    // (prediction and input keep running — the world doesn't pause), the
    // camera just isn't mine for a few seconds.
    this.cineBox.update(dt, !!this.cine && this.closedT < 0);
    if (this.cine) {
      this.game.camera.follow(this.cine.x, this.cine.y, dt);
    } else if (me) {
      const cam = this.game.camera;
      const target = this.cameraTarget()!;
      cam.follow(target.x, target.y, dt);
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const backdrop = ROOMS[this.roomId]?.props?.backdrop as string | undefined;
    this.bg.render(g, gm.camera.x, gm.camera.y, backdrop ?? 'night', this.uiT);
    if (this.tilemap) {
      gm.camera.begin(g);
      this.tilemap.render(g, gm.camera.x, gm.camera.y, gm.camera.viewW, gm.camera.viewH);
      // Machinery draws under the actors, with the shared gizmo looks.
      for (const p of this.gizmos.values()) {
        const s = p.snap;
        if (s.kind === 'platform') drawPlatform(g, p.x, p.y, s.w, s.h);
        else if (s.kind === 'lever') drawLever(g, p.x, p.y, s.on);
        else if (s.kind === 'plate') drawPlate(g, p.x, p.y, s.on);
        else drawBarrier(g, p.x, p.y, s.w, s.h, s.on);
      }
      const sorted = [...this.puppets.values()].sort((a, b) => a.actor.layer - b.actor.layer);
      for (const p of sorted) p.actor.render(g);
      this.me?.render(g); // the predicted knight, on top of the puppets
      // Projectiles come across as plain rects; ballistic kinds carry
      // their velocity so arrows/bullets draw for real, the rest glow.
      // Surface waves get their own snapshot kind and the same drawing
      // routine the live wave uses, so a remote Shockwave is the picture
      // it is on the host rather than a generic glowing dot.
      for (const w of this.snap?.waves ?? []) {
        drawCrest(g, w.c, this.tilemap.tileSize);
      }
      for (const s of this.snap?.shots ?? []) {
        if (s.k === 'arrow') drawArrow(g, s.x, s.y, s.vx ?? 1, s.vy ?? 0);
        else if (s.k === 'bullet') drawBullet(g, s.x, s.y, s.vx ?? 1, s.vy ?? 0);
        else {
          g.fillStyle = COLORS.gold;
          g.fillRect(Math.round(s.x), Math.round(s.y), Math.max(2, s.w), Math.max(2, s.h));
          g.fillStyle = COLORS.white;
          g.fillRect(Math.round(s.x + s.w / 4), Math.round(s.y + s.h / 4), Math.max(1, s.w / 2), Math.max(1, s.h / 2));
        }
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
        // Usage hints are the host's screen: the grant happens there, and
        // the guest's own is delivered by the sync that follows.
        hint: '',
        hintT: 0,
        label: this.roomId.toUpperCase(),
        uiT: this.uiT,
      }, this.minimap, boss);
    }
    this.cineBox.render(g, gm.width, gm.height); // the host's scene frames both screens
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
