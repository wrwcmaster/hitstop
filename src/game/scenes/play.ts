import {
  type Scene,
  type RoomDef,
  type TriggerDef,
  buildTilemap,
  Tilemap,
  tiles,
  drawText,
  textWidth,
  DebugOverlay,
  Triggers,
  DialogueScene,
  Minimap,
  Menu,
  itemDef,
  chance,
  rand,
  clamp,
} from '@engine/index';
import { VERSION, type ActionGame, type Action } from '../defs';
import { Player } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Npc, npcs } from '../actors/npc';
import { Pickup } from '../actors/pickup';
import { PauseScene } from './pause';
import { Background } from './background';
import { COLORS } from '../content/palette';
import { ROOMS, START_ROOM } from '../content/rooms';
import { saveStore, snapshotPlayer, restorePlayer, type SaveData } from '../save';
import {
  HEART,
  HEART_EMPTY,
  MANA_PIP,
  MANA_PIP_EMPTY,
  ICON_COIN,
  KNIGHT_IDLE_SPRITE,
  TEXEL,
  blit,
} from '../content/sprites';

/** Fallback music per room (rooms can override via props.music). */
const ROOM_MUSIC: Record<string, string> = {
  arena: 'overworld',
  cavern: 'depths',
  throne: 'depths',
};

/** A monster queued to spawn, currently telegraphing. */
interface PendingSpawn {
  t: number;
  x: number;
  y: number;
  type: string;
}

/** A door transition in progress: fade out, swap rooms, fade in. */
interface Transition {
  t: number;
  roomId: string;
  x: number;
  y: number;
}

const TRANSITION_TIME = 0.6;

type Phase = 'title' | 'play' | 'over';

/**
 * The game proper. One scene, three phases (title menu / playing / game
 * over), a world of connected rooms behind fade transitions, wave combat
 * where the room asks for it, a boss where the room placed one, and
 * checkpoint saves at every room entrance.
 */
export class PlayScene implements Scene {
  private roomId = START_ROOM;
  private room!: RoomDef;
  private tilemap!: Tilemap;
  private minimap!: Minimap;
  private triggers!: Triggers;
  private bg: Background;
  private debug: DebugOverlay;

  private phase: Phase = 'title';
  private player: Player | null = null;
  private transition: Transition | null = null;

  /** Story flags ('bossDefeated', ...). Serialized into saves. */
  private flags = new Set<string>();
  /** Fired once-trigger indices per room. Serialized into saves. */
  private firedTriggers: Record<string, number[]> = {};

  private score = 0;
  private best = 0;
  private combo = 0;
  private comboT = 0;
  private banner = '';
  private bannerT = 0;
  private overT = 0;
  private victoryT = 0;

  private wave = 0;
  private queue: string[] = [];
  private pending: PendingSpawn[] = [];
  private spawnT = 0;
  private clearT = 0;
  private clearShown = false;

  private titleMenu: Menu<Action>;

  constructor(
    private game: ActionGame,
    /** Level-editor test rooms replace the whole world with one room. */
    private testRoom?: RoomDef,
  ) {
    this.bg = new Background(game.width, game.height);
    this.debug = new DebugOverlay(game as never);
    this.setRoom(this.startRoomId());
    this.best = saveStore.load()?.best ?? 0;

    // Debug cheats: only live while the debug overlay (backquote) is on.
    window.addEventListener('keydown', (e) => this.onCheatKey(e));

    this.titleMenu = new Menu<Action>(
      [
        { label: 'NEW GAME', onSelect: () => this.startRun(null) },
        {
          label: 'CONTINUE',
          disabled: () => !saveStore.exists(),
          onSelect: () => this.startRun(saveStore.load()),
        },
      ],
      { up: 'up', down: 'down', confirm: 'confirm' },
    );

    /* ---- combat & flow reactions (events, not couplings) ---- */
    game.events.on('hit', (info) => {
      if (info.target.team !== 'enemy') return; // the player being hit is not a combo
      this.combo++;
      this.comboT = 2;
      if (this.combo > 0 && this.combo % 5 === 0 && this.player) {
        game.feel.sfx.play('combo');
        game.feel.text(this.player.cx, this.player.y - 10, `COMBO X${this.combo}`, COLORS.gold);
      }
    });
    game.events.on('kill', (info) => {
      if (!(info.target instanceof Monster)) return;
      const mult = 1 + Math.min(3, Math.floor(this.combo / 5));
      const pts = info.target.def.score * mult;
      this.score += pts;
      game.feel.text(info.target.cx, info.target.y - 8, pts, COLORS.gold);
      this.player?.gainXp(info.target.def.xp ?? Math.round(info.target.def.score / 20));
      this.rollDrops(info.target);
      // A Devourer that swallowed your gear coughs it all back up — only
      // this one carried it, so only this kill returns it.
      const stolen = info.target.state.stolenItems;
      if (Array.isArray(stolen) && stolen.length) {
        stolen.forEach((id, i) => {
          const dx = (i - (stolen.length - 1) / 2) * 7;
          game.world.spawn(new Pickup(id as string, game, this.tilemap, info.target.cx + dx, info.target.y));
        });
        game.feel.text(info.target.cx, info.target.y - 16, 'GEAR FREED!', COLORS.gold);
      }
      if (info.target.def.boss) this.onBossDefeated();
    });
    game.events.on('score', ({ points, x, y }) => {
      this.score += points;
      game.feel.text(x, y, points, COLORS.gold);
    });
    game.events.on('playerHurt', () => {
      this.combo = 0;
      this.comboT = 0;
    });
    game.events.on('waveClear', () => {
      // SECOND WIND (skill tree): every cleared wave knits a wound.
      const p = this.player;
      if (p && p.hp > 0 && p.tree.has('v3') && p.hp < p.maxHp) {
        p.heal(1);
        game.feel.text(p.cx, p.y - 10, '+1 HP', COLORS.red);
        game.feel.sfx.play('heal');
      }
    });
    game.events.on('levelUp', () => this.autosave());
    game.events.on('playerDied', () => {
      this.phase = 'over';
      this.overT = 1.4;
      this.best = Math.max(this.best, this.score);
      // Persist the improved best onto the existing checkpoint.
      const save = saveStore.load();
      if (save && this.best > save.best) {
        save.best = this.best;
        saveStore.save(save);
      }
    });

    game.input.onAnyPress(() => {
      if (this.phase === 'over' && this.overT <= 0) this.startRun(saveStore.load());
    });
  }

  private startRoomId(): string {
    return this.testRoom ? 'test' : START_ROOM;
  }

  private roomById(id: string): RoomDef {
    if (this.testRoom && id === 'test') return this.testRoom;
    return ROOMS[id] ?? ROOMS[START_ROOM];
  }

  /* ---------------- runs & rooms ---------------- */

  private startRun(save: SaveData | null): void {
    const g = this.game;
    g.world.clear();
    g.feel.reset();
    this.player = new Player(g, this.tilemap, 0, 0); // positioned by setRoom
    g.world.spawn(this.player);
    if (save) {
      restorePlayer(this.player, save.player);
      this.flags = new Set(save.flags);
      this.firedTriggers = { ...save.firedTriggers };
      this.best = Math.max(this.best, save.best);
    } else {
      this.flags.clear();
      this.firedTriggers = {};
    }
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.victoryT = 0;
    this.phase = 'play';
    this.setRoom(save?.roomId ?? this.startRoomId());
    this.game.sfx.play('menuSelect');
  }

  /**
   * Make `id` the live room: rebuild tilemap/minimap/triggers, keep only
   * the player, place them, spawn the room's monsters, start waves if the
   * room wants them, and drop a checkpoint save.
   */
  private setRoom(id: string, spawnX?: number, spawnY?: number): void {
    const g = this.game;
    this.roomId = id;
    this.room = this.roomById(id);
    this.tilemap = buildTilemap(this.room);
    this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
    this.triggers = new Triggers(this.room.triggers ?? []);
    this.triggers.importFired(this.firedTriggers[id] ?? []);
    // Stop the view 16px above the room's true bottom so the frame shows
    // a lip of ground, not a wall of underground rock.
    g.camera.setBounds(0, -30, this.tilemap.worldW, this.tilemap.worldH - 16);

    g.world.retain((e) => e === this.player);
    g.feel.particles.clear();
    g.feel.floaters.clear();

    // Reset wave machinery; arm it only if this room runs waves.
    this.queue = [];
    this.pending = [];
    this.spawnT = 0;
    this.clearT = 0;
    this.wave = 0;

    // Snap the camera so the new room doesn't smear in; with no player
    // yet (title screen), aim at the spawn point.
    const aimX = this.player ? (spawnX ?? this.room.playerSpawn.x) : this.room.playerSpawn.x;
    const aimY = this.player ? (spawnY ?? this.room.playerSpawn.y) : this.room.playerSpawn.y;
    if (this.player) {
      this.player.collision = this.tilemap;
      this.player.x = aimX;
      this.player.y = aimY;
      this.player.vx = 0;
      this.player.vy = 0;
    }
    g.camera.x = clamp(aimX - g.camera.viewW / 2, 0, Math.max(0, this.tilemap.worldW - g.camera.viewW));
    g.camera.y = clamp(aimY - g.camera.viewH * 0.62, -30, Math.max(-30, this.tilemap.worldH - g.camera.viewH));

    // Pre-placed monsters and NPCs; a defeated boss stays defeated.
    for (const e of this.room.entities) {
      if (npcs.has(e.type)) {
        this.game.world.spawn(new Npc(e.type, this.game, this.tilemap, e.x, e.y));
        continue;
      }
      if (!monsters.has(e.type)) continue;
      if (monsters.get(e.type).boss && this.flags.has('bossDefeated')) continue;
      this.game.world.spawn(new Monster(e.type, this.game, this.tilemap, e.x, e.y));
    }

    this.updateMusic();

    if (this.phase === 'play') {
      if (this.roomWantsWaves()) this.nextWave();
      this.autosave();
      if (id !== START_ROOM || this.bannerT <= 0) {
        this.banner = this.room.name.toUpperCase();
        this.bannerT = 1.2;
      }
    }
  }

  /** Boss rooms play the boss theme while the boss lives; otherwise the room's track. */
  private updateMusic(): void {
    // Just-spawned entities are still in the world's spawn queue, so also
    // consult the room def when deciding if a boss is (about to be) alive.
    const bossAlive =
      this.currentBoss() !== null ||
      this.room.entities.some(
        (e) => monsters.has(e.type) && monsters.get(e.type).boss && !this.flags.has('bossDefeated'),
      );
    if (bossAlive && this.phase === 'play') {
      this.game.music.play('boss');
      return;
    }
    const song = (this.room.props?.music as string) ?? ROOM_MUSIC[this.roomId] ?? 'overworld';
    this.game.music.play(song);
  }

  private roomWantsWaves(): boolean {
    return !!this.room.props?.waves;
  }

  private autosave(): void {
    if (this.testRoom || !this.player) return;
    saveStore.save({
      roomId: this.roomId,
      best: this.best,
      flags: [...this.flags],
      firedTriggers: this.firedTriggers,
      player: snapshotPlayer(this.player),
    });
  }

  /* ---------------- loot ---------------- */

  private rollDrops(m: Monster): void {
    if (!m.def.drops || !this.player) return;
    for (const drop of m.def.drops) {
      // Equipment is once-per-save: skip if already owned.
      const def = itemDef(drop.id);
      if (def.kind === 'equipment' &&
          (this.player.inventory.has(drop.id) || this.player.equipment.isEquipped(drop.id))) {
        continue;
      }
      if (chance(drop.chance)) {
        this.game.world.spawn(new Pickup(drop.id, this.game, this.tilemap, m.cx, m.cy));
      }
    }
  }

  /* ---------------- boss ---------------- */

  private currentBoss(): Monster | null {
    for (const a of this.game.world.actors('enemy')) {
      if (a instanceof Monster && a.def.boss) return a;
    }
    return null;
  }

  private onBossDefeated(): void {
    this.flags.add('bossDefeated');
    this.banner = 'VICTORY!';
    this.bannerT = 2;
    this.victoryT = 1.6; // let the gibs settle before the epilogue speaks
    this.autosave();
    this.updateMusic(); // the boss theme dies with him
  }

  /* ---------------- triggers & dialogue ---------------- */

  private handleTrigger(def: TriggerDef): void {
    this.firedTriggers[this.roomId] = this.triggers.exportFired();
    this.game.events.emit('trigger', { event: def.event, props: def.props });
    if (def.event === 'talk' && typeof def.props?.conversation === 'string') {
      this.openConversation(def.props.conversation);
    } else if (def.event === 'door' && typeof def.props?.room === 'string') {
      this.transition = {
        t: 0,
        roomId: def.props.room,
        x: (def.props.x as number) ?? this.roomById(def.props.room).playerSpawn.x,
        y: (def.props.y as number) ?? this.roomById(def.props.room).playerSpawn.y,
      };
      this.game.sfx.play('menuOpen');
    }
  }

  private openConversation(id: string): void {
    this.game.scenes.push(
      new DialogueScene<Action>(this.game, id, {
        confirm: 'confirm',
        up: 'up',
        down: 'down',
        blip: () => this.game.feel.sfx.play('blip'),
      }),
    );
  }

  /* ---------------- waves ---------------- */

  private nextWave(): void {
    this.wave++;
    this.clearShown = false;
    this.game.feel.sfx.play('wave');
    this.banner = `WAVE ${this.wave}`;
    this.bannerT = 1.5;
    const n = 2 + this.wave;
    for (let i = 0; i < n; i++) {
      let type = 'slime';
      if (this.wave >= 2 && chance(0.4)) type = 'bat';
      if (this.wave >= 3 && chance(0.22)) type = 'brute';
      this.queue.push(type);
    }
    this.game.events.emit('waveStart', { wave: this.wave });
  }

  private updateSpawns(dt: number): void {
    if (this.phase !== 'play' || !this.roomWantsWaves()) return;
    const g = this.game;
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0) {
      this.spawnT = 0.45;
      const type = this.queue.shift()!;
      const def = monsters.get(type);
      let x: number, y: number;
      if (def.flies) {
        // Inside the (zoomed) camera view so the telegraph is visible.
        x = g.camera.x + 24 + rand(0, Math.max(40, g.camera.viewW - 48));
        y = Math.max(20, g.camera.y + 16) + rand(0, g.camera.viewH * 0.35);
      } else {
        x = chance(0.5) ? 24 : this.tilemap.worldW - 24 - def.w;
        y = this.groundYAt(x) - def.h;
      }
      this.pending.push({ t: 0.55, x, y, type });
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        const m = g.world.spawn(new Monster(s.type, g, this.tilemap, s.x, s.y));
        g.feel.burst(m.cx, m.cy, 10, { color: m.def.colors, speed: 70, life: 0.35, drag: 3 });
        this.pending.splice(i, 1);
      }
    }
    const enemiesLeft = g.world.actors('enemy').length;
    if (!this.queue.length && !this.pending.length && !enemiesLeft && this.player && this.player.hp > 0) {
      if (!this.clearShown) {
        this.clearShown = true;
        this.banner = 'WAVE CLEAR!';
        this.bannerT = 1;
        this.game.feel.sfx.play('combo');
        this.game.events.emit('waveClear', { wave: this.wave });
      }
      this.clearT += dt;
      if (this.clearT >= 1.2) {
        this.clearT = 0;
        this.nextWave();
      }
    }
  }

  /** Scan down the tile column at x for the top of the first solid tile. */
  private groundYAt(x: number): number {
    const ts = this.tilemap.tileSize;
    const tx = clamp(Math.floor(x / ts), 0, this.tilemap.cols - 1);
    for (let ty = 0; ty < this.tilemap.rows; ty++) {
      if (tiles.get(this.tilemap.tileAt(tx, ty)).solid) return ty * ts;
    }
    return this.tilemap.worldH - ts;
  }

  /* ---------------- scene interface ---------------- */

  update(dt: number): void {
    const g = this.game;

    if (this.phase === 'title') {
      this.titleMenu.update(g.input);
      return;
    }

    // Door transition: the world holds its breath while the screen fades.
    if (this.transition) {
      const tr = this.transition;
      const before = tr.t;
      tr.t += dt;
      if (before < TRANSITION_TIME / 2 && tr.t >= TRANSITION_TIME / 2) {
        this.setRoom(tr.roomId, tr.x, tr.y);
      }
      if (tr.t >= TRANSITION_TIME) this.transition = null;
      return;
    }

    if (this.phase === 'play' && this.player && g.input.consumePress('menu')) {
      g.scenes.push(new PauseScene(g, this.player, { onRestart: () => this.startRun(saveStore.load()) }));
      return;
    }

    g.world.update(dt);
    this.updateSpawns(dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    if (this.phase === 'play' && this.player && this.player.hp > 0) {
      this.triggers.update(this.player, (f) => this.handleTrigger(f.def));
    }
    if (this.victoryT > 0) {
      this.victoryT -= dt;
      if (this.victoryT <= 0) this.openConversation('victory');
    }
    this.bannerT = Math.max(0, this.bannerT - dt);

    if (this.player) {
      // Camera leads the player: facing offset + velocity lookahead,
      // and (with the zoomed-in view) follows vertically too, biased so
      // more of the world above the knight is visible than below.
      const p = this.player;
      const cam = g.camera;
      const tx = p.cx - cam.viewW / 2 + p.facing * 18 + p.vx * 0.1;
      const ty = p.cy - cam.viewH * 0.62 + p.vy * 0.05;
      cam.follow(tx, ty, dt);
    }
  }

  frame(realDt: number): void {
    this.overT = Math.max(0, this.overT - realDt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const g = this.game;
    this.bg.render(ctx, g.camera.x);
    g.camera.begin(ctx);
    this.tilemap.render(ctx, g.camera.x, g.camera.y, g.camera.viewW, g.camera.viewH);
    this.renderSpawnMarkers(ctx);
    g.world.render(ctx);
    g.feel.renderWorld(ctx);
    this.debug.renderWorld(ctx);
    g.camera.end(ctx);
    this.bg.renderVignette(ctx);

    if (this.phase === 'title') this.renderTitle(ctx);
    else this.renderHUD(ctx);
    if (this.phase === 'over') this.renderOver(ctx);
    if (this.transition) {
      const tr = this.transition;
      const half = TRANSITION_TIME / 2;
      const a = tr.t < half ? tr.t / half : (TRANSITION_TIME - tr.t) / half;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = '#07070d';
      ctx.fillRect(0, 0, g.width, g.height);
      ctx.globalAlpha = 1;
    }
    this.debug.renderScreen(ctx);
    if (this.debug.enabled && this.phase === 'play') this.renderCheatLegend(ctx);
  }

  /* ---------------- debug cheats (only when the overlay is on) ---------------- */

  private onCheatKey(e: KeyboardEvent): void {
    if (!this.debug.enabled || this.phase !== 'play') return;
    const p = this.player;
    if (!p || p.hp <= 0) return;
    const feel = this.game.feel;
    const say = (t: string, c: string = COLORS.gold) => feel.text(p.cx, p.y - 18, t, c);
    switch (e.code) {
      case 'Digit1': p.gold += 100; say('GOLD +100'); break;
      case 'Digit2': p.gainXp(100); break; // gainXp shows its own floater
      case 'Digit3': p.progression.skillPoints += 3; say('SKILL +3', COLORS.blue); break;
      case 'Digit4': p.hp = p.maxHp; p.mp = p.maxMp; feel.flash(0.12, COLORS.white); say('FULL HEAL', COLORS.red); break;
      case 'Digit5': p.godMode = !p.godMode; say(p.godMode ? 'GOD ON' : 'GOD OFF'); break;
      case 'Digit6':
        for (const id of ['great-sword', 'iron-charm', 'potion', 'potion', 'haste-draught']) p.inventory.add(id);
        say('GEAR GRANTED');
        break;
      case 'Digit7':
        for (const en of this.game.world.actors('enemy')) {
          if (en instanceof Monster) {
            this.game.combat.hit(en, {
              damage: 9999, targets: 'enemy', attacker: p, strength: 0.6, colors: [COLORS.white],
            });
          }
        }
        say('KILL ALL', COLORS.red);
        break;
      case 'Digit8':
        this.game.world.spawn(new Monster('devourer', this.game, this.tilemap, p.cx + 34, p.cy - 24));
        say('DEVOURER', COLORS.purple);
        break;
      default:
        return;
    }
    this.game.sfx.play('unlock');
  }

  private renderCheatLegend(g: CanvasRenderingContext2D): void {
    const x = this.game.width - 4;
    drawText(g, 'CHEATS', x, 22, COLORS.gold, 1, 'right');
    const items = ['1 gold', '2 xp', '3 skill', '4 heal', '5 god', '6 gear', '7 kill', '8 devourer'];
    items.forEach((t, i) => drawText(g, t, x, 32 + i * 8, '#38b764', 1, 'right'));
  }

  /* ---------------- drawing ---------------- */

  /** Blinking diamond telegraphs where a monster is about to appear. */
  private renderSpawnMarkers(g: CanvasRenderingContext2D): void {
    for (const s of this.pending) {
      if (Math.floor(s.t * 10) % 2) continue;
      const def = monsters.get(s.type);
      const col = def.colors[0] ?? COLORS.white;
      const r = 2 + (0.55 - s.t) * 10;
      g.save();
      g.translate(Math.round(s.x + def.w / 2), Math.round(s.y + def.h / 2));
      g.rotate(Math.PI / 4);
      g.strokeStyle = col;
      g.lineWidth = 1;
      g.strokeRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
  }

  private renderHUD(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const p = this.player;
    if (p) {
      for (let i = 0; i < p.maxHp; i++) {
        blit(g, i < p.hp ? HEART : HEART_EMPTY, 6 + i * 9, 6);
      }
      for (let i = 0; i < p.maxMp; i++) {
        blit(g, i < p.mp ? MANA_PIP : MANA_PIP_EMPTY, 7 + i * 7, 15);
      }
      // Skill readiness: fireball cooldown wedge next to the mana row.
      const cdMax = 1.1;
      const cd = p.skills.cooldownLeft('fireball');
      const ready = p.skills.ready('fireball');
      const sx = 10 + p.maxMp * 7;
      drawText(g, 'C', sx, 15, ready ? COLORS.gold : COLORS.steelDark);
      if (cd > 0) {
        g.fillStyle = COLORS.steelDark;
        g.fillRect(sx, 21, Math.round(5 * (cd / cdMax)), 1);
      }
      // Purse.
      blit(g, ICON_COIN, 6, 23);
      drawText(g, String(p.gold), 14, 24, COLORS.gold);
      // Level + XP bar (+ a nudge when skill points are waiting).
      drawText(g, `LV ${p.progression.level}`, 6, 33, COLORS.white);
      g.fillStyle = '#07070d';
      g.fillRect(28, 34, 32, 3);
      g.fillStyle = COLORS.gold;
      g.fillRect(28, 34, Math.round(32 * p.progression.fraction), 3);
      if (p.progression.skillPoints > 0 && Math.floor(p.animT * 2) % 2 === 0) {
        drawText(g, `${p.progression.skillPoints} SP - ESC`, 64, 33, COLORS.gold);
      }
      // Active buffs/debuffs: chip + remaining-time sliver.
      let by = 42;
      for (const s of p.statuses.list()) {
        g.fillStyle = s.def.color;
        g.fillRect(6, by, 4, 4);
        drawText(g, s.def.name, 13, by, s.def.color);
        g.fillStyle = s.def.color;
        g.fillRect(13, by + 6, Math.round(textWidth(s.def.name) * s.fraction), 1);
        by += 10;
      }
      // Swallowed: the escape prompt IS the HUD priority.
      if (p.fsm.is('swallowed')) {
        drawText(g, 'MASH TO ESCAPE!', gm.width / 2, 84, COLORS.white, 2, 'center');
        const w = 60;
        const x = gm.width / 2 - w / 2;
        g.fillStyle = '#07070d';
        g.fillRect(x - 1, 97, w + 2, 5);
        g.strokeStyle = COLORS.purple;
        g.strokeRect(x - 1.5, 96.5, w + 3, 6);
        g.fillStyle = COLORS.white;
        g.fillRect(x, 98, Math.round(w * Math.min(1, p.escapeN / p.escapeNeed)), 3);
      }
    }
    drawText(g, `SCORE ${this.score}`, gm.width - 6, 7, COLORS.white, 1, 'right');
    const label = this.roomWantsWaves() ? `WAVE ${this.wave}` : this.room.name.toUpperCase();
    drawText(g, label, gm.width / 2, 7, COLORS.steel, 1, 'center');
    this.renderMinimap(g);
    this.renderBossBar(g);
    if (this.combo >= 2) {
      drawText(g, `COMBO X${this.combo}`, gm.width / 2, 18, COLORS.gold, 1, 'center');
      g.fillStyle = COLORS.gold;
      g.fillRect(Math.round(gm.width / 2 - 15), 26, Math.round((30 * this.comboT) / 2), 2);
    }
    if (this.bannerT > 0) drawText(g, this.banner, gm.width / 2, 58, COLORS.white, 3, 'center');
  }

  private renderBossBar(g: CanvasRenderingContext2D): void {
    const boss = this.currentBoss();
    if (!boss) return;
    const gm = this.game;
    const w = 160;
    const x = (gm.width - w) / 2;
    const y = gm.height - 18;
    drawText(g, boss.def.displayName ?? 'BOSS', gm.width / 2, y - 8, COLORS.gold, 1, 'center');
    g.fillStyle = '#07070d';
    g.fillRect(x - 1, y - 1, w + 2, 6);
    g.strokeStyle = COLORS.navyLight;
    g.strokeRect(x - 1.5, y - 1.5, w + 3, 7);
    g.fillStyle = boss.hp <= boss.maxHp / 2 ? COLORS.red : COLORS.green;
    g.fillRect(x, y, Math.round(w * Math.max(0, boss.hp) / boss.maxHp), 4);
  }

  private renderMinimap(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const markers: { x: number; y: number; color: string; size?: number }[] = [
      ...gm.world.actors('enemy').map((e) => ({
        x: e.cx, y: e.cy, color: COLORS.red,
        size: e instanceof Monster && e.def.boss ? 2 : 1,
      })),
      ...gm.world
        .all()
        .filter((e): e is Pickup => e instanceof Pickup && !e.dead)
        .map((e) => ({ x: e.x, y: e.y, color: COLORS.gold })),
    ];
    if (this.player && this.player.hp > 0) {
      markers.push({ x: this.player.cx, y: this.player.cy, color: COLORS.green });
    }
    this.minimap.render(
      g,
      gm.width - this.minimap.width - 6,
      16,
      markers,
      { x: gm.camera.x, y: Math.max(0, gm.camera.y), w: gm.camera.viewW, h: gm.camera.viewH },
    );
  }

  private renderTitle(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    g.fillStyle = 'rgba(7,7,13,0.55)';
    g.fillRect(0, 0, gm.width, gm.height);
    g.save();
    g.translate(gm.width / 2 - 18, 108);
    g.scale(3, 3);
    g.drawImage(KNIGHT_IDLE_SPRITE, 0, 0, KNIGHT_IDLE_SPRITE.width / TEXEL, KNIGHT_IDLE_SPRITE.height / TEXEL);
    g.restore();
    drawText(g, 'HITSTOP', gm.width / 2, 48, COLORS.white, 4, 'center');
    drawText(g, 'Game feel is the foundation', gm.width / 2, 80, COLORS.steel, 1, 'center');
    this.titleMenu.render(g, gm.width / 2 - 24, 162, { lineHeight: 13 });
    drawText(g, 'Move: Arrows / WASD - Jump: Space', gm.width / 2, 208, COLORS.steelDark, 1, 'center');
    drawText(g, 'Attack: Z - Dash: X - Skill: C - Menu: Esc', gm.width / 2, 220, COLORS.steelDark, 1, 'center');
    drawText(g, 'Z or Enter to select', gm.width / 2, 238, COLORS.gold, 1, 'center');
    // Small build version, tucked in the corner.
    drawText(g, `v${VERSION}`, gm.width - 6, gm.height - 10, COLORS.steelDark, 1, 'right');
  }

  private renderOver(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    g.fillStyle = 'rgba(7,7,13,0.55)';
    g.fillRect(0, 0, gm.width, gm.height);
    drawText(g, 'GAME OVER', gm.width / 2, 70, COLORS.red, 4, 'center');
    drawText(g, `SCORE ${this.score}`, gm.width / 2, 110, COLORS.white, 2, 'center');
    drawText(g, `BEST ${this.best}`, gm.width / 2, 130, COLORS.steel, 1, 'center');
    if (saveStore.exists()) {
      drawText(g, 'You will wake at the last gate', gm.width / 2, 148, COLORS.steel, 1, 'center');
    }
    if (this.overT <= 0 && Math.floor(performance.now() / 400) % 2) {
      drawText(g, 'Press any key', gm.width / 2, 190, COLORS.gold, 2, 'center');
    }
  }
}
