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
  items,
  validateRoom,
  chance,
  clamp,
  overlaps,
  t,
} from '@engine/index';
import { menuLine, prettyCode, prettyButton, REPLAY_PENDING_KEY, type ActionGame, type Action, type RunStart, type TestScenario } from '../defs';
import { Player } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { placeables, type PlaceableCtx } from '../content/placeables';
import { validateRoomContent } from '../content/room-features';
import { PauseScene } from './pause';
import { OptionsScene } from './options';
import { SaveSlotsScene } from './saveslots';
import { Background } from './background';
import { COLORS } from '../content/palette';
import { ROOMS, START_ROOM } from '../content/rooms';
import { DEFAULT_SONG } from '../content/music';
import { saveStore, slotStore, newestSave, snapshotPlayer, restorePlayer, type SaveData } from '../save';
import type { PlayHost } from './play/host';
import { WaveDirector } from './play/waves';
import { triggerActions } from './play/trigger-actions';
import { PortalScene } from './portal';
import { Hud, type GateMarker } from './play/hud';
import { TitleScreen, renderGameOver } from './play/screens';
import { CHEATS, cheatFor } from './play/cheats';
import { pickReplayFile } from '@engine/index';
import { CoopHost } from '../net/host';
import { CoopGuestScene } from '../net/guest';
import { CoopScene } from './coop';
import { displayName } from '../name';
import type { PeerLink } from '@engine/index';

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
  /** Live co-op hosting session (guest knight + snapshot stream). */
  private coop: CoopHost | null = null;

  /** Story flags ('bossDefeated', ...). Serialized into saves. */
  private flags = new Set<string>();
  /** Fired once-trigger indices per room. Serialized into saves. */
  private firedTriggers: Record<string, number[]> = {};
  /** A checkpoint's wave, consumed by the next setRoom so a saved gauntlet
   * resumes where it left off rather than restarting at wave 1. */
  private pendingWave = 0;

  private score = 0;
  private best = 0;
  private combo = 0;
  private comboT = 0;
  private banner = '';
  private bannerT = 0;
  private overT = 0;
  private victoryT = 0;
  /** Which epilogue the fallen boss earned (see MonsterDef.epilogue). */
  private pendingEpilogue = 'victory';
  /** Free-running clock for idle UI wobble (the gate marker). */
  private uiT = 0;
  /** A keyed door in the current room, for the floating gate marker. */
  private gateMarker: GateMarker | null = null;
  /** Doors and portals in the current room. Both are interaction zones:
   * stand on one and press interact (E) — no auto-fire on contact. */
  private interactZones: TriggerDef[] = [];
  /** The door/portal the player is standing on, for the prompt. */
  private nearInteract: TriggerDef | null = null;

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
      get roomId() { return scene.roomId; },
      banner: (text, seconds = 1.2) => this.showBanner(text, seconds),
      goToRoom: (roomId, x, y) => this.goToRoom(roomId, x, y),
      openConversation: (id) => this.openConversation(id),
      hasFlag: (id) => this.flags.has(id),
    };
    this.waves = new WaveDirector(this.host);
    this.hud = new Hud(this.host);
    this.title = new TitleScreen(game, {
      newGame: () => this.beginRun({ kind: 'new' }),
      continueRun: () => this.beginRun({ kind: 'continue' }),
      loadGame: () => {
        game.sfx.play('menuSelect');
        game.scenes.push(new SaveSlotsScene(game, 'load', { loadFrom: (slot) => this.beginRun({ kind: 'slot', slot }) }));
      },
      coop: () => {
        game.sfx.play('menuSelect');
        game.scenes.push(new CoopScene(game, {
          hostStart: (link) => this.startCoopHost(link),
          guestStart: (link) => this.startCoopGuest(link),
        }));
      },
      testRoom: () => this.beginRun({ kind: 'testroom' }),
      watchReplay: () => {
        game.sfx.play('menuSelect');
        pickReplayFile(REPLAY_PENDING_KEY);
      },
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
    // Levers and pressure plates write story flags through this seam,
    // so puzzle state persists in saves like any other flag.
    on(game.events.on('setFlag', ({ id, on: value }) => {
      if (value) this.flags.add(id);
      else this.flags.delete(id);
    }));
    on(game.events.on('hit', (info) => {
      if (info.target.team !== 'enemy') return; // the player being hit is not a combo
      this.combo++;
      this.comboT = 2;
      if (this.combo > 0 && this.combo % 5 === 0 && this.player) {
        game.feel.sfx.play('combo');
        game.feel.text(this.player.cx, this.player.y - 10, t('COMBO X{n}', { n: this.combo }), COLORS.gold);
      }
    }));
    on(game.events.on('kill', (info) => {
      if (!(info.target instanceof Monster)) return;
      const mult = 1 + Math.min(3, Math.floor(this.combo / 5));
      const pts = info.target.def.score * mult;
      this.score += pts;
      game.feel.text(info.target.cx, info.target.y - 8, pts, COLORS.gold);
      const xp = info.target.def.xp ?? Math.round(info.target.def.score / 20);
      this.player?.gainXp(xp);
      this.coop?.guest?.gainXp(xp); // both knights grow in co-op
      this.rollDrops(info.target);
      // Quest progress: any kill may advance an accepted quest.
      for (const q of this.player?.quests.onKill(info.target.type) ?? []) {
        if (q.justCompleted) {
          this.showBanner(t('QUEST COMPLETE!'), 1.5);
          game.feel.sfx.play('levelup');
        } else {
          game.feel.text(info.target.cx, info.target.y - 16, `${q.n}/${q.need}`, COLORS.gold);
        }
      }
      // A Devourer that swallowed your gear coughs it all back up — only
      // this one carried it, so only this kill returns it.
      const stolen = info.target.state.stolenItems;
      if (Array.isArray(stolen) && stolen.length) {
        stolen.forEach((id, i) => {
          const dx = (i - (stolen.length - 1) / 2) * 7;
          game.world.spawn(new Pickup(id as string, game, this.tilemap, info.target.cx + dx, info.target.y));
        });
        game.feel.text(info.target.cx, info.target.y - 16, t('GEAR FREED!'), COLORS.gold);
      }
      if (info.target.def.boss) this.onBossDefeated(info.target);
    }));
    on(game.events.on('score', ({ points, x, y }) => {
      this.score += points;
      game.feel.text(x, y, points, COLORS.gold);
    }));
    on(game.events.on('playerHurt', () => {
      this.combo = 0;
      this.comboT = 0;
    }));
    on(game.events.on('waveStart', ({ wave }) => {
      // Checkpoint each new wave so a death (or reload) resumes the wave
      // you were fighting, not the room's first. Wave 1 coincides with the
      // room-entry autosave, so only the advances need their own.
      if (wave > 1) this.autosave();
    }));
    on(game.events.on('waveClear', () => {
      // SECOND WIND (skill tree): every cleared wave knits a wound.
      const p = this.player;
      if (p && p.hp > 0 && p.capabilities.has('secondWind') && p.hp < p.maxHp) {
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
      if (this.phase === 'over' && this.overT <= 0) this.beginRun({ kind: 'autosave' });
    }));
  }

  /** Scene left the stack: release every listener this scene installed. */
  exit(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.coop?.close();
    this.coop = null;
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

  /** Leave the current run for the title screen. A fresh PlayScene boots
   * at the title; `switch` runs this scene's exit() (disposers, co-op
   * teardown). Progress is whatever the autosave last checkpointed —
   * the same contract as closing the tab, so no separate confirm. */
  private returnToTitle(): void {
    this.game.scenes.switch(new PlayScene(this.game));
  }

  /** A run start waiting for the next update tick (see beginRun). */
  private pendingStart: RunStart | null = null;

  /**
   * Every way a solo run begins funnels through here — title menu,
   * game-over restart, pause restart/load, and replays. The start is
   * DEFERRED to the top of the next update so it lands on a step
   * boundary no matter where it was requested from (menu callback,
   * any-key handler, replay driver) — that's what keeps recorded runs
   * and their replays tick-identical. The dispatch emits `runStart`
   * first, so the replay recorder can reseed the gameplay RNG and cut a
   * fresh per-run tape before the starter draws a single random number.
   */
  beginRun(start: RunStart): void {
    this.pendingStart = start;
  }

  private dispatchStart(start: RunStart): void {
    this.game.events.emit('runStart', start);
    switch (start.kind) {
      case 'new': return this.startRun(null);
      case 'continue': return this.startRun(newestSave());
      case 'autosave': return this.startRun(saveStore.load());
      case 'slot': return this.loadSlot(start.slot);
      case 'testroom': return this.startTestRoom();
      case 'scenario': return this.startScenario(start.scenario);
    }
  }

  /** A serializable snapshot for the replay recorder (the engine hashes
   * it for divergence checks; agents read it to decide their next move). */
  replayState(): { phase: string; roomId: string; score: number; wave: { n: number; queued: number; pending: number } } {
    return {
      phase: this.phase,
      roomId: this.roomId,
      score: this.score,
      wave: { n: this.waves.wave, queued: this.waves.queued, pending: this.waves.telegraphs },
    };
  }

  /** Begin hosting: the run starts from the newest save with the guest's
   * knight alongside — a real Player fed by the remote action stream. */
  startCoopHost(link: PeerLink): void {
    this.coop = new CoopHost(this.game, link);
    this.startRun(newestSave()); // names both knights, spawns the guest's
  }

  /** Become the guest: swap to the snapshot-rendering scene entirely. */
  startCoopGuest(link: PeerLink): void {
    const g = this.game;
    const guest = new CoopGuestScene(g, link);
    guest.onLeave = () => g.scenes.switch(new PlayScene(g));
    g.scenes.switch(guest);
  }

  private startRun(save: SaveData | null): void {
    const g = this.game;
    g.world.clear();
    g.feel.reset();
    this.player = new Player(g, this.tilemap, 0, 0); // positioned by setRoom
    g.world.spawn(this.player);
    if (this.coop) {
      this.player.name = displayName('host'); // tags live while co-op does
      this.coop.setHostName(this.player.name); // so a same-named guest differs
      const knight = new Player(g, this.tilemap, 0, 0); // positioned by setRoom
      this.coop.adopt(knight);
      g.world.spawn(knight);
    }
    if (save) {
      restorePlayer(this.player, save.player);
      this.flags = new Set(save.flags);
      // Legacy saves predate per-boss slain flags: their 'bossDefeated'
      // could only have meant the Slime King.
      if (this.flags.has('bossDefeated') && ![...this.flags].some((f) => f.startsWith('slain:'))) {
        this.flags.add('slain:slime-king');
      }
      this.firedTriggers = { ...save.firedTriggers };
      this.best = Math.max(this.best, save.best);
      this.pendingWave = save.wave ?? 0; // resume a saved gauntlet mid-run
    } else {
      this.flags.clear();
      this.firedTriggers = {};
      this.pendingWave = 0;
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
   * Start a declarative test scenario (see TestScenario) — the
   * agent/editor-friendly test room. Loads the named/inline room, kits
   * the knight out, and drops the requested monsters. Runs through the
   * same beginRun funnel, so a scenario replays exactly (the whole
   * scenario rides the recording's runStart).
   */
  private startScenario(s: TestScenario): void {
    const g = this.game;
    g.world.clear();
    g.feel.reset();
    this.player = new Player(g, this.tilemap, 0, 0); // positioned by setRoom
    g.world.spawn(this.player);

    const pl = s.player ?? {};
    this.player.gold = pl.gold ?? 999;
    for (const id of pl.give ?? []) if (items.has(id)) this.player.inventory.add(id);
    for (const id of pl.equip ?? []) {
      if (!items.has(id)) continue;
      if (!this.player.inventory.has(id)) this.player.inventory.add(id);
      this.player.equipment.equip(id);
    }
    this.player.syncStats();
    if (pl.hp != null) this.player.hp = clamp(pl.hp, 1, this.player.maxHp);

    this.flags.clear();
    this.firedTriggers = {};
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.victoryT = 0;
    this.phase = 'play';

    // Inline RoomDef rides the existing 'test' slot; else a registered id.
    this.testRoom = s.roomDef ? validateRoom(s.roomDef) : this.testRoom;
    const roomId = s.roomDef ? 'test' : (s.room && ROOMS[s.room] ? s.room : 'test_room');
    this.setRoom(roomId, pl.x, pl.y);

    // Requested monsters, spawned through the same placeables catalog as
    // a room's own entities — unknown types are skipped, not fatal.
    const ctx: PlaceableCtx = { game: g, tilemap: this.tilemap, flags: this.flags };
    for (const e of s.spawn ?? []) {
      if (!placeables.has(e.type)) continue;
      placeables.get(e.type).spawn(ctx, { type: e.type, x: e.x, y: e.y ?? 0, props: e.props });
    }
    g.sfx.play('menuSelect');
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
    // Portal network: a visited key location becomes a destination.
    if (this.player) this.flags.add(`visited:${id}`);
    validateRoomContent(this.room, id);
    this.tilemap = buildTilemap(this.room);
    this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
    this.triggers = new Triggers(this.room.triggers ?? []);
    this.triggers.importFired(this.firedTriggers[id] ?? []);
    // Stop the view 16px above the room's true bottom so the frame shows
    // a lip of ground, not a wall of underground rock.
    g.camera.setBounds(0, -30, this.tilemap.worldW, this.tilemap.worldH - 16);

    g.world.retain((e) => e === this.player || e === this.coop?.guest);
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
    // Doors and portals are interaction zones (press E), not auto-fires.
    this.interactZones = (this.room.triggers ?? []).filter(
      (t) => t.event === 'door' || t.event === 'portal',
    );
    this.nearInteract = null;

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
    const knight = this.coop?.guest;
    if (knight) {
      knight.collision = this.tilemap;
      knight.x = aimX + 14; // beside the host, not inside them
      knight.y = aimY;
      knight.vx = 0;
      knight.vy = 0;
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
      if (this.waves.active) this.waves.begin(this.pendingWave || 1);
      this.pendingWave = 0; // consumed: later room entries start fresh
      this.autosave();
      if (id !== START_ROOM || this.bannerT <= 0) {
        this.showBanner(t(this.room.name.toUpperCase()), 1.2);
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
    this.game.music.play((this.room.props?.music as string) ?? DEFAULT_SONG);
  }

  /** The current run as save data (null on test rooms / no player). */
  private buildSave(): SaveData | null {
    if (this.testRoom || !this.player) return null;
    return {
      roomId: this.roomId,
      best: this.best,
      savedAt: Date.now(),
      flags: [...this.flags],
      firedTriggers: this.firedTriggers,
      wave: this.waves.active ? this.waves.wave : undefined,
      player: snapshotPlayer(this.player),
    };
  }

  private autosave(): void {
    const data = this.buildSave();
    if (data) saveStore.save(data);
  }

  /** Manual save into a slot (the pause menu's SAVE GAME). */
  private saveToSlot(slot: number): void {
    const data = this.buildSave();
    if (!data) return;
    slotStore(slot).save(data);
    this.showBanner(t('GAME SAVED'), 1);
  }

  /** Resume from any slot (pause LOAD GAME / title LOAD GAME). */
  private loadSlot(slot: number): void {
    const data = slotStore(slot).load();
    if (data) this.startRun(data);
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

  private onBossDefeated(boss: Monster): void {
    this.flags.add('bossDefeated');
    this.flags.add(`slain:${boss.type}`);
    this.pendingEpilogue = boss.def.epilogue ?? 'victory';
    this.showBanner(t('VICTORY!'), 2);
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
    // Doors and portals don't fire on contact — they wait for interact
    // (see useInteract). Everything else runs its action on entry.
    if (def.event === 'door' || def.event === 'portal') return;
    if (triggerActions.has(def.event)) triggerActions.get(def.event).run(def, this.host);
  }

  /** Use the door/portal the player is standing on (interact pressed). */
  private useInteract(def: TriggerDef): void {
    if (def.event === 'portal') this.openPortal();
    else triggerActions.get('door').run(def, this.host); // traverse / lock feedback
  }

  /** A door/portal's floating prompt: where a door leads, or "TRAVEL". */
  private renderInteractPrompt(ctx: CanvasRenderingContext2D, z: TriggerDef): void {
    const key = this.interactKeyLabel();
    const dest = z.event === 'portal' ? t('TRAVEL') : this.doorLabel(z);
    const label = key ? `${key}  ${dest}` : dest;
    const bob = Math.sin(this.uiT * 4) * 1.5;
    drawText(ctx, label, z.x + z.w / 2, z.y - 6 + bob, COLORS.gold, 1, 'center');
  }

  /** The place a door leads, for its prompt (localized room name). */
  private doorLabel(z: TriggerDef): string {
    const dest = z.props?.room as string | undefined;
    const name = dest ? ROOMS[dest]?.name : undefined;
    return name ? t(name.toUpperCase()) : t('DOOR');
  }

  /** Device-aware interact label (pad button / key), '' on touch. */
  private interactKeyLabel(): string {
    const pad = this.game.pad;
    if (pad?.connected) {
      const b = pad.buttonsFor('interact')[0];
      return b != null ? prettyButton(b) : 'Y';
    }
    if (typeof window !== 'undefined' && !window.matchMedia('(pointer: fine)').matches) return '';
    const code = this.game.input.codesFor('interact')[0];
    return code ? prettyCode(code) : 'E';
  }

  /** Open the portal destination menu (interact on a portal pad). */
  private openPortal(): void {
    const g = this.game;
    g.sfx.play('menuSelect');
    g.scenes.push(
      new PortalScene(
        g,
        this.roomId,
        (room) => this.roomId === room || this.flags.has(`visited:${room}`),
        (dest) => {
          // Step out of the destination's portal pad, not a fixed offset —
          // you should appear where the portal is. (Safe now that pads are
          // interact-only and won't re-open on contact.)
          const land = this.portalLanding(dest.room);
          this.goToRoom(dest.room, land?.x ?? dest.x, land?.y ?? dest.y);
        },
      ),
    );
  }

  /** Where to arrive when warping into `roomId`: centered on its portal
   * pad so the traveller emerges from the portal. Null if it has none. */
  private portalLanding(roomId: string): { x: number; y: number } | null {
    const pad = ROOMS[roomId]?.triggers?.find((tr) => tr.event === 'portal');
    if (!pad) return null;
    const pw = this.player?.w ?? 14;
    return { x: pad.x + pad.w / 2 - pw / 2, y: pad.y };
  }

  private openConversation(id: string): void {
    this.game.scenes.push(
      new DialogueScene<Action>(this.game, id, {
        confirm: 'confirm',
        up: 'up',
        down: 'down',
        choiceLineHeight: menuLine(10),
        blip: () => this.game.feel.sfx.play('blip'),
      }),
    );
  }

  /* ---------------- scene interface ---------------- */

  update(dt: number): void {
    const g = this.game;
    this.uiT += dt;

    // A queued run start lands here, on a step boundary, and takes the
    // whole tick (the world's first sim step is the NEXT update) — the
    // same shape as a title-phase tick, so replays line up exactly.
    if (this.pendingStart) {
      const start = this.pendingStart;
      this.pendingStart = null;
      this.dispatchStart(start);
      return;
    }

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
      g.scenes.push(new PauseScene(g, this.player, {
        onRestart: () => this.beginRun({ kind: 'autosave' }),
        onTitle: () => this.returnToTitle(),
        onSaveSlot: (slot) => this.saveToSlot(slot),
        onLoadSlot: (slot) => this.beginRun({ kind: 'slot', slot }),
      }));
      return;
    }

    this.coop?.applyInput(); // remote edges land before the world steps
    g.world.update(dt);
    if (this.coop) {
      this.coop.step({ roomId: this.roomId, score: this.score, banner: this.bannerT > 0 ? this.banner : null });
      if (this.coop.dropped) this.endCoop();
    }
    if (this.phase === 'play') this.waves.update(dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    if (this.phase === 'play' && this.player && this.player.hp > 0) {
      this.triggers.update(this.player, (f) => this.handleTrigger(f.def));
      // Doors & portals: stand on one and press interact to use it. Checked
      // after the world step so an NPC in range wins the key first.
      const p = this.player;
      this.nearInteract = this.interactZones.find((z) => overlaps(p, z)) ?? null;
      if (this.nearInteract && g.input.consumePress('interact')) this.useInteract(this.nearInteract);
    } else {
      this.nearInteract = null;
    }
    if (this.victoryT > 0) {
      this.victoryT -= dt;
      if (this.victoryT <= 0) this.openConversation(this.pendingEpilogue);
    }
    this.bannerT = Math.max(0, this.bannerT - dt);

    if (this.player) {
      // Camera leads the player: facing offset + velocity lookahead,
      // and (with the zoomed-in view) follows vertically too, biased so
      // more of the world above the knight is visible than below.
      // With a co-op guest alive, aim at the midpoint of the two knights.
      const p = this.player;
      const knight = this.coop?.guest;
      const cam = g.camera;
      let ax = p.cx + p.facing * 18 + p.vx * 0.1;
      let ay = p.cy + p.vy * 0.05;
      if (knight && knight.hp > 0) {
        ax = (p.cx + knight.cx) / 2;
        ay = (p.cy + knight.cy) / 2;
      }
      cam.follow(ax - cam.viewW / 2, ay - cam.viewH * 0.62, dt);
    }
  }

  /** Tear down a co-op session (guest left or link died). */
  private endCoop(): void {
    if (!this.coop) return;
    if (this.coop.guest) this.coop.guest.dead = true;
    this.coop.close();
    this.coop = null;
    if (this.player) this.player.name = ''; // solo again: tag off
    this.showBanner(t('GUEST LEFT'), 1.5);
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
    if (this.phase === 'play' && this.nearInteract) this.renderInteractPrompt(ctx, this.nearInteract);
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
          label: this.waves.active ? t('WAVE {n}', { n: this.waves.wave }) : t(this.room.name.toUpperCase()),
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
