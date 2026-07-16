import {
  type Scene,
  type RoomDef,
  type TriggerDef,
  buildTilemap,
  Tilemap,
  drawText,
  DebugOverlay,
  Triggers,
  DialogueScene,
  Minimap,
  itemDef,
  chance,
  clamp,
} from '@engine/index';
import { type ActionGame, type Action } from '../defs';
import { Player } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { placeables, type PlaceableCtx } from '../content/placeables';
import { PauseScene } from './pause';
import { OptionsScene } from './options';
import { Background } from './background';
import { COLORS } from '../content/palette';
import { ROOMS, START_ROOM } from '../content/rooms';
import { saveStore, snapshotPlayer, restorePlayer, type SaveData } from '../save';
import type { PlayHost } from './play/host';
import { WaveDirector } from './play/waves';
import { triggerActions } from './play/trigger-actions';
import { Hud, type GateMarker } from './play/hud';
import { TitleScreen, renderGameOver } from './play/screens';
import { CHEATS, cheatFor } from './play/cheats';

/** Fallback music per room (rooms can override via props.music). */
const ROOM_MUSIC: Record<string, string> = {
  arena: 'overworld',
  cavern: 'depths',
  throne: 'depths',
};

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
 * The game proper: three phases (title menu / playing / game over) over a
 * world of connected rooms. This scene owns the run/room lifecycle, the
 * score, and the event wiring; the moving parts live in focused modules
 * under `play/` — WaveDirector (wave combat + the gate key), trigger
 * actions (what door/talk/... mean), Hud (screen-space drawing), the
 * title/game-over screens, and the cheat table. Each sees the scene only
 * through the narrow PlayHost seam.
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
  /** Free-running clock for idle UI wobble (the gate marker). */
  private uiT = 0;
  /** A keyed door in the current room, for the floating gate marker. */
  private gateMarker: GateMarker | null = null;

  private host: PlayHost;
  private waves: WaveDirector;
  private hud: Hud;
  private title: TitleScreen;
  /** Everything to unhook when the scene leaves the stack (see exit). */
  private disposers: (() => void)[] = [];

  constructor(
    private game: ActionGame,
    /** Level-editor test rooms replace the whole world with one room. */
    private testRoom?: RoomDef,
  ) {
    this.bg = new Background(game.width, game.height);
    this.debug = new DebugOverlay(game as never);

    // The one window collaborators get into this scene.
    const scene = this;
    this.host = {
      game,
      get player() { return scene.player; },
      get tilemap() { return scene.tilemap; },
      get room() { return scene.room; },
      banner: (text, seconds = 1.2) => this.showBanner(text, seconds),
      goToRoom: (roomId, x, y) => this.goToRoom(roomId, x, y),
      openConversation: (id) => this.openConversation(id),
    };
    this.waves = new WaveDirector(this.host);
    this.hud = new Hud(this.host);
    this.title = new TitleScreen(game, {
      newGame: () => this.startRun(null),
      continueRun: () => this.startRun(saveStore.load()),
      testRoom: () => this.startTestRoom(),
      options: () => {
        game.sfx.play('menuSelect');
        game.scenes.push(new OptionsScene(game));
      },
    });

    this.setRoom(this.startRoomId());
    this.best = saveStore.load()?.best ?? 0;

    // Debug cheats: only live while the debug overlay (backquote) is on.
    const onCheat = (e: KeyboardEvent) => this.onCheatKey(e);
    window.addEventListener('keydown', onCheat);
    this.disposers.push(() => window.removeEventListener('keydown', onCheat));

    /* ---- combat & flow reactions (events, not couplings). Every
       subscription's unsubscribe is kept, so a replaced scene doesn't
       leave stale listeners behind (released in exit()). ---- */
    const on = (off: () => void) => this.disposers.push(off);
    on(game.events.on('hit', (info) => {
      if (info.target.team !== 'enemy') return; // the player being hit is not a combo
      this.combo++;
      this.comboT = 2;
      if (this.combo > 0 && this.combo % 5 === 0 && this.player) {
        game.feel.sfx.play('combo');
        game.feel.text(this.player.cx, this.player.y - 10, `COMBO X${this.combo}`, COLORS.gold);
      }
    }));
    on(game.events.on('kill', (info) => {
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
    }));
    on(game.events.on('score', ({ points, x, y }) => {
      this.score += points;
      game.feel.text(x, y, points, COLORS.gold);
    }));
    on(game.events.on('playerHurt', () => {
      this.combo = 0;
      this.comboT = 0;
    }));
    on(game.events.on('waveClear', () => {
      // SECOND WIND (skill tree): every cleared wave knits a wound.
      const p = this.player;
      if (p && p.hp > 0 && p.tree.has('v3') && p.hp < p.maxHp) {
        p.heal(1);
        game.feel.text(p.cx, p.y - 10, '+1 HP', COLORS.red);
        game.feel.sfx.play('heal');
      }
    }));
    on(game.events.on('levelUp', () => this.autosave()));
    on(game.events.on('playerDied', () => {
      this.phase = 'over';
      this.overT = 1.4;
      this.best = Math.max(this.best, this.score);
      // Persist the improved best onto the existing checkpoint.
      const save = saveStore.load();
      if (save && this.best > save.best) {
        save.best = this.best;
        saveStore.save(save);
      }
      this.updateMusic();
    }));

    on(game.input.onAnyPress(() => {
      if (this.phase === 'over' && this.overT <= 0) this.startRun(saveStore.load());
    }));
  }

  /** Scene left the stack: release every listener this scene installed. */
  exit(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  private startRoomId(): string {
    return this.testRoom ? 'test' : START_ROOM;
  }

  private roomById(id: string): RoomDef {
    if (this.testRoom && id === 'test') return this.testRoom;
    return ROOMS[id] ?? ROOMS[START_ROOM];
  }

  private showBanner(text: string, seconds: number): void {
    this.banner = text;
    this.bannerT = seconds;
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

  private startTestRoom(): void {
    const g = this.game;
    g.world.clear();
    g.feel.reset();
    this.player = new Player(g, this.tilemap, 0, 0); // positioned by setRoom
    this.player.gold = 999; // Give plenty of gold for testing!
    g.world.spawn(this.player);

    this.flags.clear();
    this.firedTriggers = {};
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.victoryT = 0;
    this.phase = 'play';
    this.setRoom('test_room');
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

    this.waves.reset();

    // A keyed door → show a floating gate marker, lit once its key is held.
    this.gateMarker = null;
    for (const t of this.room.triggers ?? []) {
      if (t.event === 'door' && typeof t.props?.key === 'string') {
        this.gateMarker = { x: t.x + t.w / 2, y: t.y, keyId: t.props.key };
        break;
      }
    }

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

    // Pre-placed entities, spawned through the placeables catalog — the
    // same one the level editor and test spawner use. Unknown types are
    // skipped (a room can reference content that isn't registered yet).
    const ctx: PlaceableCtx = { game: g, tilemap: this.tilemap, flags: this.flags };
    for (const e of this.room.entities) {
      if (!placeables.has(e.type)) continue;
      const p = placeables.get(e.type);
      if (p.shouldSpawn && !p.shouldSpawn(ctx, e)) continue;
      p.spawn(ctx, e);
    }

    this.updateMusic();

    if (this.phase === 'play') {
      if (this.waves.active) this.waves.begin();
      this.autosave();
      if (id !== START_ROOM || this.bannerT <= 0) {
        this.showBanner(this.room.name.toUpperCase(), 1.2);
      }
    }
  }

  /** Begin a fade transition into another room (door travel). */
  private goToRoom(roomId: string, x?: number, y?: number): void {
    this.transition = {
      t: 0,
      roomId,
      x: x ?? this.roomById(roomId).playerSpawn.x,
      y: y ?? this.roomById(roomId).playerSpawn.y,
    };
    this.game.sfx.play('menuOpen');
  }

  /** Boss rooms play the boss theme while the boss lives; otherwise the room's track. */
  private updateMusic(): void {
    if (this.phase === 'title') {
      this.game.music.play('title');
      return;
    }
    if (this.phase === 'over') {
      this.game.music.play('gameover');
      return;
    }
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
    this.showBanner('VICTORY!', 2);
    this.victoryT = 1.6; // let the gibs settle before the epilogue speaks
    this.autosave();
    this.updateMusic(); // the boss theme dies with him
  }

  /* ---------------- triggers & dialogue ---------------- */

  private handleTrigger(def: TriggerDef): void {
    this.firedTriggers[this.roomId] = this.triggers.exportFired();
    // Always on the bus (custom events, ad-hoc listeners), then routed to
    // whatever registered action gives the event its meaning.
    this.game.events.emit('trigger', { event: def.event, props: def.props });
    if (triggerActions.has(def.event)) triggerActions.get(def.event)(def, this.host);
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

  /* ---------------- scene interface ---------------- */

  update(dt: number): void {
    const g = this.game;
    this.uiT += dt;

    if (this.phase === 'title') {
      this.title.update(g.input);
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
    if (this.phase === 'play') this.waves.update(dt);
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
    this.waves.renderMarkers(ctx);
    g.world.render(ctx);
    if (this.phase === 'play') this.hud.renderGateMarker(ctx, this.gateMarker, this.uiT);
    g.feel.renderWorld(ctx);
    this.debug.renderWorld(ctx);
    g.camera.end(ctx);
    this.bg.renderVignette(ctx);

    if (this.phase === 'title') {
      this.title.render(ctx);
    } else {
      this.hud.render(
        ctx,
        {
          score: this.score,
          combo: this.combo,
          comboT: this.comboT,
          banner: this.banner,
          bannerT: this.bannerT,
          label: this.waves.active ? `WAVE ${this.waves.wave}` : this.room.name.toUpperCase(),
          uiT: this.uiT,
        },
        this.minimap,
        this.currentBoss(),
      );
    }
    if (this.phase === 'over') {
      renderGameOver(ctx, g, { score: this.score, best: this.best, ready: this.overT <= 0 });
    }
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
    const cheat = cheatFor(e.code);
    if (!cheat) return;
    cheat.run({
      game: this.game,
      player: p,
      tilemap: this.tilemap,
      say: (t, c = COLORS.gold) => this.game.feel.text(p.cx, p.y - 18, t, c),
    });
    this.game.sfx.play('unlock');
  }

  private renderCheatLegend(g: CanvasRenderingContext2D): void {
    const x = this.game.width - 4;
    drawText(g, 'CHEATS', x, 22, COLORS.gold, 1, 'right');
    CHEATS.forEach((c, i) => drawText(g, c.label, x, 32 + i * 8, '#38b764', 1, 'right'));
  }
}
