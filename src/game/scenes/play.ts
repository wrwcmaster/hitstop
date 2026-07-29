import {
  type Scene,
  type RoomDef,
  type TriggerDef,
  buildTilemap,
  Tilemap,
  drawText,
  textWidth,
  DebugOverlay,
  Triggers,
  DialogueScene,
  Minimap,
  RoomPatches,
  Director,
  entityKey,
  itemDef,
  items,
  validateRoom,
  tiles,
  chance,
  clamp,
  overlaps,
  t,
  moveAndCollide,
  placeBody,
  type Solid,
} from '@engine/index';
import { menuLine, prettyCode, prettyButton, promptText, REPLAY_PENDING_KEY, type ActionGame, type Action, type RunStart, type TestScenario } from '../defs';
import { Player } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { placeables, type PlaceableCtx } from '../content/placeables';
import { cutscenes, scriptInput, type CutsceneCtx } from '../content/cutscenes';
import { validateRoomContent } from '../content/room-features';
import { reactToSurface } from '../content/surface-reactions';
import { PauseScene } from './pause';
import { MapScene } from './map';
import { OptionsScene } from './options';
import { SaveSlotsScene } from './saveslots';
import { Background } from './background';
import { COLORS } from '../content/palette';
import { ROOMS, START_ROOM } from '../content/rooms';
import { earnableDef, earnables } from '@engine/index';
import { DEFAULT_SONG } from '../content/music';
import { saveStore, slotStore, newestSave, snapshotPlayer, restorePlayer, type SaveData } from '../save';
import type { PlayHost } from './play/host';
import { WaveDirector } from './play/waves';
import { triggerActions, doorLocked } from './play/trigger-actions';
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
import { edgeDoorSide, openEdgeDoorways } from './play/doorways';

/** A door transition in progress: fade out, swap rooms, fade in. */
interface Transition {
  t: number;
  fromRoomId: string;
  roomId: string;
  x: number;
  y: number;
  /**
   * A doorway that has to open before the fade starts: seconds left, and
   * the opening it fills. Absent for a plain gap in the wall, which has
   * nothing to open.
   */
  open?: { left: number; x: number; y: number; w: number; h: number };
  /** Horizontal edge gaps keep the knight moving naturally through the fade. */
  walk?: { out: -1 | 1; into: -1 | 1 };
  /**
   * The surface the knight was standing on when this crossing began, if
   * she was standing at all. A threshold HAS a floor: the two rooms' floors
   * meet at the doorway, and she is on both while she walks through. Only
   * one room is loaded at a time, so past the edge the tiles simply stop —
   * and she was falling off the end of the world for the last frames of
   * every walked crossing. Absent when she crosses airborne, because then
   * there is no floor under her and the arc is the truth.
   */
  thresholdY?: number;
}

const TRANSITION_TIME = 0.6;
/**
 * A vertical seam does not use Transition at all: the room swaps at the
 * exact step of the crossing and the simulation never pauses, so every
 * collision after the crossing happens — and RENDERS — in the room that
 * owns it. The fade is pure cosmetics over live play. The previous
 * design paused the sim and advanced a hidden proxy body in the far
 * room while still drawing the knight in the old one; every mismatch
 * between those two worlds surfaced as a lie on screen, most famously
 * being "blocked by air" in one room by a ceiling that exists in the
 * other.
 */
const SEAM_FADE = 0.25;
/** Fast enough to clear the threshold before the screen reaches black. */
const EDGE_WALK_SPEED = 72;
/** How far the threshold floor reaches past the boundary (see moveThroughEdge). */
const THRESHOLD_RUN = 128;
/** How long a door takes to haul itself up out of the way. */
const DOOR_OPEN_TIME = 0.35;

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
  /**
   * How the world differs from its authored rooms — broken floors, looted
   * chests. Rooms are rebuilt from immutable JSON on every visit, so this
   * is the only thing that makes a change to one outlive walking out of
   * it. Serialized into saves.
   */
  private patches = new RoomPatches();
  /**
   * A run that must never be written home: the level editor's test room,
   * a `?scenario=` setup, the debug jump to the test room. They are
   * throwaway worlds with a fully kitted knight, and letting one autosave
   * would overwrite a real run with a sandbox — now that a sandbox can
   * also break the scenery, the same rule has to cover the rubble.
   */
  private sandbox = false;
  /** A mutation landed this frame; rebake the minimap once, in update. */
  private minimapDirty = false;
  /** Debounce for the wave's per-tile shatter reports (see waveSurface). */
  private shatterCd = 0;
  /** A checkpoint's wave, consumed by the next setRoom so a saved gauntlet
   * resumes where it left off rather than restarting at wave 1. */
  private pendingWave = 0;

  private score = 0;
  private best = 0;
  private combo = 0;
  private comboT = 0;
  private banner = '';
  private bannerT = 0;
  /** A second, smaller line under the banner: how to use what you just
   * won. Outlives the banner, since reading it is the point. */
  private hint = '';
  private hintT = 0;
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
  /** Last known locked state per door trigger index, to spot the moment
   * one relents while the player is standing in it. */
  private doorWasLocked = new Map<number, boolean>();

  /** Scripted sequences over the live world (see content/cutscenes.ts). */
  private director = new Director<CutsceneCtx>();
  /** The scripted hands holding the player's controls while one plays. */
  private cutsceneInput: ReturnType<typeof scriptInput> | null = null;
  /** Seconds of cosmetic fade left after an instant vertical-seam swap. */
  private seamFade = 0;
  /** Where the scene found the co-op guest: held there for its duration
   * so live physics can't carry an off-camera knight somewhere she
   * can't see (see the anchor block in update). */

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
      mutateTile: (tx, ty, id) => this.mutateTile(tx, ty, id),
      playCutscene: (id) => this.playCutscene(id),
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
      // Scenery that pays out once: empty its slot in the room so the
      // walk back in finds it already broken (see MonsterDef.persistent).
      if (info.target.def.persistent) this.retireEntity(info.target.origin);
      if (info.target.def.boss) this.onBossDefeated(info.target);
    }));
    on(game.events.on('plungeLand', (e) => this.breakSurface(e)));
    on(game.events.on('surfaceWave', (e) => this.waveSurface(e)));
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
        p.heal(20);
        game.feel.text(p.cx, p.y - 10, '+20 HP', COLORS.red);
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
    this.stopCutscene();
    this.coop?.close();
    this.coop = null;
  }

  /** Drop a live cutscene without running it (teardown/run reset only —
   * in play, skipping is the correct exit). */
  private stopCutscene(): void {
    this.director.stop();
    if (this.player && this.player.source === this.cutsceneInput) this.player.source = null;
    this.cutsceneInput = null;
  }

  private startRoomId(): string {
    return this.testRoom ? 'test' : START_ROOM;
  }

  private roomById(id: string): RoomDef {
    if (this.testRoom && id === 'test') return this.testRoom;
    return ROOMS[id] ?? ROOMS[START_ROOM];
  }

  /** The usage line under the banner (see `hint`). */
  private showHint(text: string, seconds: number): void {
    this.hint = text;
    this.hintT = seconds;
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
    this.stopCutscene(); // a run reset mid-cutscene must not strand scripted hands
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
  replayState(): { phase: string; roomId: string; score: number; wave: { n: number; queued: number; pending: number }; patches?: number } {
    const patches = this.patches.count();
    return {
      phase: this.phase,
      roomId: this.roomId,
      score: this.score,
      wave: { n: this.waves.wave, queued: this.waves.queued, pending: this.waves.telegraphs },
      // Geometry the run has changed. A count, not the whole set: enough
      // to diverge on a floor that broke in one pass and not the other,
      // and it keeps the per-frame hash small. Omitted while nothing is
      // broken so a run that never touches the scenery hashes exactly as
      // it did before rooms could be changed — which is what lets the
      // existing recordings stay valid regression tests.
      ...(patches ? { patches } : {}),
    };
  }

  /** Begin hosting: the run starts from the newest save with the guest's
   * knight alongside — a real Player fed by the remote action stream. */
  startCoopHost(link: PeerLink): void {
    this.coop = new CoopHost(this.game, link);
    // The guest's menu press during a scene means the same thing the
    // host's does: skip. Honored only while the director is live.
    this.coop.onSkip = () => {
      if (this.director.active) this.director.skip();
    };
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
    this.sandbox = false;
    this.game.quietDialogue = false;
    if (save) {
      restorePlayer(this.player, save.player);
      this.flags = new Set(save.flags);
      this.firedTriggers = { ...save.firedTriggers };
      this.patches.restore(save.patches);
      this.best = Math.max(this.best, save.best);
      this.pendingWave = save.wave ?? 0; // resume a saved gauntlet mid-run
    } else {
      this.flags.clear();
      this.firedTriggers = {};
      this.patches.clear();
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

    this.sandbox = true;
    this.game.quietDialogue = false;
    this.flags.clear();
    this.firedTriggers = {};
    this.patches.clear();
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
    // Boss verbs, without the boss: a scenario that wants to exercise
    // Impact Drop or Air Step starts already owning them.
    for (const id of pl.earned ?? []) {
      if (earnables.has(id)) this.player.earned.grant(id, { game: this.player.game, player: this.player });
    }
    if (pl.hp != null) this.player.hp = clamp(pl.hp, 1, this.player.maxHp);

    this.sandbox = true;
    // Rides the recorded runStart like every other scenario field, so
    // replays agree. See ActionGame.quietDialogue for why it lives there.
    this.game.quietDialogue = s.quiet === true;
    this.flags.clear();
    this.firedTriggers = {};
    this.patches.clear();
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
  private cameraTarget(fallbackX: number, fallbackY: number): { x: number; y: number } {
    const cam = this.game.camera;
    const p = this.player;
    if (!p) {
      return { x: fallbackX - cam.viewW / 2, y: fallbackY - cam.viewH * 0.62 };
    }
    let ax = p.cx + p.facing * 18 + p.vx * 0.1;
    let ay = p.cy + p.vy * 0.05;
    const knight = this.coop?.guest;
    if (knight && knight.hp > 0) {
      ax = (p.cx + knight.cx) / 2;
      ay = (p.cy + knight.cy) / 2;
    }
    return { x: ax - cam.viewW / 2, y: ay - cam.viewH * 0.62 };
  }

  /** Jump straight to the same clamped target normal follow will use. */
  private snapCamera(fallbackX: number, fallbackY: number): void {
    const cam = this.game.camera;
    const target = this.cameraTarget(fallbackX, fallbackY);
    cam.x = clamp(target.x, cam.minX, Math.max(cam.minX, cam.maxX - cam.viewW));
    cam.y = clamp(target.y, cam.minY, Math.max(cam.minY, cam.maxY - cam.viewH));
  }

  /* ---------------- room mutations ---------------- */

  /**
   * Change a tile in the live room AND remember it (see PlayHost). Both
   * halves matter: the map is a throwaway copy rebuilt on every visit,
   * and the patch is what the next build replays.
   */
  private mutateTile(tx: number, ty: number, id: string): void {
    if (tx < 0 || ty < 0 || tx >= this.tilemap.cols || ty >= this.tilemap.rows) return;
    if (!tiles.has(id) || this.tilemap.tileAt(tx, ty) === id) return;
    this.tilemap.setTile(tx, ty, id);
    this.patches.setTile(this.roomId, tx, ty, id);
    // The minimap bakes the room's shape when it is built, so a fresh
    // hole has to be baked in to show up — but ONE bake per frame: a
    // Shockwave shatters a dozen tiles in a burst, and rebaking the
    // whole map per tile would be quadratic for no visible difference.
    this.minimapDirty = true;
  }

  /** Empty a slot the room authored, for good (looted chests). */
  private retireEntity(key: string): void {
    // Only a slot the ROOM placed can be emptied. Waves, scenarios, and
    // the test spawner all spawn through the same catalog and so carry a
    // key too; theirs belongs to no slot and must not delete one.
    if (!key || !this.room.entities.some((e) => entityKey(e) === key)) return;
    this.patches.removeEntity(this.roomId, key);
  }

  /**
   * An Impact Drop landed — does the floor survive it? The engine hands
   * over the tiles under her feet with their content-defined traits, and
   * the surface-reaction registry decides what each one does about the
   * blow. Neither the knight nor this method names a tile id or a trait,
   * so a new reacting surface is a registry entry and a tile, not an
   * edit here.
   */
  private breakSurface(at: { x: number; y: number; w: number; h: number }): void {
    let acted = false;
    for (const tile of this.tilemap.probeTiles(at, 'down', 2)) {
      if (reactToSurface(this.host, tile, 'plunge')) acted = true;
    }
    if (!acted) return;
    this.game.feel.shake(0.5);
    this.game.sfx.play('shatter');
  }

  /** A Shockwave front reached a tile — same registry, sideways. */
  private waveSurface(at: { tx: number; ty: number }): void {
    const tile = this.tilemap.tileRef(at.tx, at.ty);
    // One crack per burst, not one per tile: the wave reports each tile
    // as its front arrives, and a run of weak stone would otherwise
    // machine-gun the same sound a dozen times in a third of a second.
    if (tile && reactToSurface(this.host, tile, 'wave') && this.shatterCd <= 0) {
      this.shatterCd = 0.18;
      this.game.sfx.play('shatter');
    }
  }

  /* ---------------- cutscenes ---------------- */

  /**
   * Hand the world to the director. The player's controls are swapped
   * for a scripted Input — the SAME seam a co-op remote uses — so the
   * knight stays a live, simulated actor throughout; nothing is faked.
   * Ending (or skipping: a fast-forward, never an abort) hands them back.
   */
  private playCutscene(id: string): void {
    if (!cutscenes.has(id) || !this.player) return;
    const input = scriptInput();
    this.cutsceneInput = input;
    const ctx: CutsceneCtx = { game: this.game, host: this.host, input };
    this.player.source = input;
    this.director.play(cutscenes.get(id)(ctx), ctx, () => {
      if (this.player && this.player.source === input) this.player.source = null;
      this.cutsceneInput = null;
    });
  }

  /**
   * Co-op assembly gate for triggers marked `assemble: true` — critical
   * moments (a cutscene, a boss intro) hold at the threshold until every
   * knight is gathered. Solo, or with the partner down, there is nobody
   * to wait for. The trigger stays unfired while held (see
   * Triggers.update's gate), so standing in place fires it the moment
   * the partner arrives; meanwhile the host sees why nothing happened.
   */
  private assembled(def: TriggerDef): boolean {
    if (!def.props?.assemble) return true;
    const guest = this.coop?.guest;
    const p = this.player;
    if (!guest || !p || guest.hp <= 0) return true;
    const near = Math.abs(guest.cx - p.cx) < 200 && Math.abs(guest.cy - p.cy) < 140;
    if (!near) this.showHint(t('WAIT FOR YOUR PARTNER'), 0.5);
    return near;
  }

  private setRoom(id: string, spawnX?: number, spawnY?: number): void {
    const g = this.game;
    this.roomId = id;
    this.room = this.roomById(id);
    // Portal network: a visited key location becomes a destination.
    if (this.player) this.flags.add(`visited:${id}`);
    validateRoomContent(this.room, id);
    this.tilemap = buildTilemap(this.room);
    // The room as the world left it, replayed over the room as authored —
    // before anything measures the map (minimap, camera bounds) and long
    // before anyone stands on it.
    this.patches.applyTiles(id, this.tilemap);
    openEdgeDoorways(this.room, this.tilemap);
    this.minimapDirty = false; // freshly baked below; a stale flag would rebake it
    this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
    this.triggers = new Triggers(this.room.triggers ?? []);
    this.triggers.importFired(this.firedTriggers[id] ?? []);
    // The frame is the room, exactly — no margin at either end.
    //
    // It used to stop 16px above the bottom and extend 30px past the top.
    // Both were crops around content, and both lied. The bottom reserve
    // hid padding rows rooms carried from before the camera could scroll
    // down at all; a constant cannot know how much foundation a room drew,
    // so the visible strip ranged 8px to 59px, and the band it created —
    // reachable by physics, not by the camera — is what cut the knight's
    // feet off in the flue. The top margin was the same shape upside
    // down: 30px of void above every ceiling, so a ceiling door's sign
    // had somewhere to render. Riven-lip's roof floated under a strip of
    // nothing instead of reading as the underside of underground's floor.
    //
    // Rooms author their own sky and their own foundation. Signs render
    // inside the room (see renderDoorSigns).
    g.camera.setBounds(0, 0, this.tilemap.worldW, this.tilemap.worldH);

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
    this.interactZones = (this.room.triggers ?? []).filter((t) => (
      t.event === 'portal'
      || (t.event === 'door' && t.props?.fallIn !== true && t.props?.leapUp !== true)
    ));
    this.nearInteract = null;

    // Snap the camera so the new room doesn't smear in; with no player
    // yet (title screen), aim at the spawn point.
    const aimX = this.player ? (spawnX ?? this.room.playerSpawn.x) : this.room.playerSpawn.x;
    const aimY = this.player ? (spawnY ?? this.room.playerSpawn.y) : this.room.playerSpawn.y;
    // Arrivals go through placement, not assignment — a body may only be
    // put where a body could have moved. If the computed spot is buried
    // (a door landing that lands in rock), fall back to the room's own
    // spawn rather than leaving her inside the wall, where collision
    // cannot see her and she would walk straight through it.
    if (this.player) {
      this.player.collision = this.tilemap;
      if (!placeBody(this.player, aimX, aimY, this.tilemap)) {
        placeBody(this.player, this.room.playerSpawn.x, this.room.playerSpawn.y, this.tilemap);
      }
      this.player.vx = 0;
      this.player.vy = 0;
    }
    const knight = this.coop?.guest;
    if (knight) {
      knight.collision = this.tilemap;
      if (!placeBody(knight, aimX + 14, aimY, this.tilemap)) { // beside the host, not inside them
        placeBody(knight, this.room.playerSpawn.x, this.room.playerSpawn.y, this.tilemap);
      }
      knight.vx = 0;
      knight.vy = 0;
    }
    // You never fire a doorway you materialized inside. `Triggers`
    // enforces it for the edge-driven doors it runs. Vertical seams need
    // no such memory: their velocity gate IS the protection — you arrive
    // in a fall-in rising and a leap-up falling, so the seam you came
    // through fails its own gate by construction, and the moment the arc
    // genuinely reverses, firing again (back the way you came) is the
    // splice behaving correctly, not a bug to suppress.
    if (this.player) this.triggers.prime(this.player, (def) => def.event === 'door');
    // Use the exact target and bounds normal follow uses. Previously this
    // clamped against worldH instead of camera.maxY (which intentionally
    // sits 16px higher to show a ground lip), then followed the player's
    // centre instead of the top-left spawn point. The first live frame
    // corrected both differences and visibly dropped the whole floor.
    this.snapCamera(aimX, aimY);

    // Pre-placed entities, spawned through the placeables catalog — the
    // same one the level editor and test spawner use. Unknown types are
    // skipped (a room can reference content that isn't registered yet).
    const ctx: PlaceableCtx = { game: g, tilemap: this.tilemap, flags: this.flags };
    for (const e of this.room.entities) {
      if (!placeables.has(e.type)) continue;
      if (this.patches.isRemoved(id, entityKey(e))) continue; // looted, for good
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

  /** Build the run's current collision view of a room before entering it. */
  private collisionMapFor(roomId: string): Tilemap {
    const room = this.roomById(roomId);
    const map = buildTilemap(room);
    this.patches.applyTiles(roomId, map);
    openEdgeDoorways(room, map);
    return map;
  }

  /**
   * Where you come out when you walk through a doorway into `toRoom`:
   * at that room's own door back here. The two triggers stop being a
   * warp to authored coordinates and become two sides of one doorway, so
   * a door leads somewhere consistent, turning round and walking back
   * returns you to the spot you left, and neither end can drift from the
   * other. Same bargain portals already make by landing on the pad.
   *
   * Safe to land ON the trigger: doors are interact-only and never fire
   * on contact, so you arrive standing in the doorway, not bounced
   * straight back.
   *
   * Null when the far side has no door home (a one-way drop), leaving
   * the caller to fall back to the room's own spawn.
   */
  private doorLanding(toRoom: string): { x: number; y: number; carry?: boolean } | null {
    const dest = ROOMS[toRoom];
    const back = dest?.triggers?.find(
      (tr) => tr.event === 'door' && tr.props?.room === this.roomId,
    );
    if (!back) return null;
    const leaving = this.room.triggers?.find(
      (tr) => tr.event === 'door' && tr.props?.room === toRoom,
    );
    const trackedSeam = back.props?.trackX === true && leaving?.props?.trackX === true;
    const edgePair = !!leaving
      && edgeDoorSide(this.room, leaving) !== null
      && edgeDoorSide(dest, back) !== null;
    const pw = this.player?.w ?? 14;
    const ph = this.player?.h ?? 18;

    // NOTHING lands inside stone — that check belongs to every kind of
    // doorway, not just the sideways one. A landing buried in rock either
    // wedges you or squeezes you somewhere arbitrary, and the seam it
    // arrives through makes no difference to how bad that is. The map is
    // built WITH this run's patches, so a floor the player smashed reads
    // as the hole it now is.
    const map = this.collisionMapFor(toRoom);
    const buried = (x: number, y: number): boolean => {
      for (const s of map.solidsNear({ x, y, w: pw, h: ph })) {
        if (!s.oneWay && x < s.x + s.w && s.x < x + pw && y < s.y + s.h && s.y < y + ph) return true;
      }
      return false;
    };
    /**
     * Nudge a vertical-seam landing out of any lip it overlaps — always
     * DOWNWARD, the near side for both arrival kinds (rising into a floor
     * shaft, falling out of a ceiling gap). Stepping the other way once
     * "found air" on the far side of an unsmashed cap, which teleported
     * the knight through a tile of solid rock; sliding down only ever
     * expels her from the face she is already touching. If the mouth is
     * blocked, she arrives beneath the blockage, bonks, and the seam
     * sends her honestly back the way she came.
     */
    const settle = (x: number, y: number): { x: number; y: number } | null => {
      for (let d = 0; d <= 4 * dest.tileSize; d++) {
        if (!buried(x, y + d)) return { x, y: y + d };
      }
      return null;
    };

    // A VERTICAL seam — a shaft marked fallIn/leapUp on the far side —
    // is entered along its axis, not from beside. You arrive IN the
    // opening, and `carry` keeps your velocity through the transition:
    // fall down the well and you emerge under the far ceiling still
    // falling; jump up it and the same jump lifts you out of the well's
    // mouth on the other side. The room swap becomes a splice in one
    // continuous arc, which is what makes it read as one place.
    // Preserve where the knight crossed a vertical seam. Wide breakable
    // floors may only be open beneath the exact tiles she smashed; always
    // returning at the trigger's centre can put her under intact stone.
    // Mapping the source fraction onto the far opening also makes unequal
    // shaft widths join as one continuous passage.
    const verticalX = (): number => {
      if (!trackedSeam || !this.player || !leaving || leaving.w <= 0) {
        return back.x + back.w / 2 - pw / 2;
      }
      const along = clamp((this.player.cx - leaving.x) / leaving.w, 0, 1);
      return clamp(back.x + back.w * along - pw / 2, back.x, back.x + back.w - pw);
    };
    // Vertical seams fire at the source trigger's far edge (the plane
    // where that room's drawn shaft ends) and arrive at the far edge of
    // the destination's own trigger — its matching boundary. Between the
    // two rooms every drawn pixel of both shafts gets flown through, in
    // the room that draws it: leave through the ceiling and you enter
    // the far shaft from its very bottom, still rising; drop out of a
    // floor and you fall in from the far ceiling's top. What stops you
    // is whatever solid geometry the shaft actually contains — a
    // breakable lid stops a weak jump ON SCREEN, not in an invisible
    // elsewhere.
    if (back.props?.leapUp === true) {
      const at = settle(verticalX(), back.y);
      return at && { ...at, carry: true };
    }
    if (back.props?.fallIn === true) {
      const at = settle(verticalX(), back.y + back.h - ph);
      return at && { ...at, carry: true };
    }
    // Step OUT of the doorway, not into it. Landing on the trigger was
    // fine while doors waited for interact, but an open doorway now
    // fires on contact — arriving inside one would throw you straight
    // back the way you came, forever. Emerging beside it also just reads
    // better: you walk out of the door into the room.
    const roomW = Math.max(...dest.tiles.map((r) => r.length)) * dest.tileSize;
    const outward = back.x + back.w / 2 < roomW / 2 ? 1 : -1;
    const x = outward === 1 ? back.x + back.w + 2 : back.x - pw - 2;
    // A horizontal seam maps the exact height at which it was crossed,
    // rather than pinning every arrival to the destination floor. Equal
    // trigger heights preserve Y offset exactly; unequal ones scale it.
    // Together with carried velocity below, a jump stays a jump across
    // the room boundary and a fall keeps falling. The clamp is the same
    // backstop every body obeys, applied to a placement: whatever height
    // the mapping proposes, you arrive inside the room.
    const destH = dest.tiles.length * dest.tileSize;
    const y = clamp(
      edgePair && this.player && leaving && leaving.h > 0
        ? back.y + (this.player.y - leaving.y) * (back.h / leaving.h)
        : back.y + back.h - ph,
      0,
      destH - ph,
    );
    // Stepping out sideways assumes a doorway you walk through. A shaft
    // you FALL down has no beside — the town well is two tiles wide with
    // rock either side — so let the caller fall back to the room's spawn
    // rather than burying you in stone.
    return buried(x, y) ? null : { x, y, carry: edgePair };
  }

  private goToRoom(roomId: string, x?: number, y?: number): void {
    // Explicit coordinates win (portals pick their own pad); otherwise
    // pair up with the doorway on the far side, then the room's spawn.
    const land = x === undefined && y === undefined ? this.doorLanding(roomId) : null;
    const spawn = this.roomById(roomId).playerSpawn;
    const walk = this.edgeWalk(roomId) ?? undefined;
    // A VERTICAL seam (carry without a walk — edge pairs carry velocity
    // too, but walk their fade) swaps rooms at the exact step of the
    // crossing — see SEAM_FADE. The arc continues unbroken: setRoom
    // zeroes velocity for ordinary doors, so hand it back across the call.
    if (land?.carry && !walk && this.player) {
      const vx = this.player.vx;
      const vy = this.player.vy;
      this.setRoom(roomId, land.x, land.y);
      this.player.vx = vx;
      this.player.vy = vy;
      this.seamFade = SEAM_FADE;
      return;
    }
    this.transition = {
      t: 0,
      fromRoomId: this.roomId,
      roomId,
      x: x ?? land?.x ?? spawn.x,
      y: y ?? land?.y ?? spawn.y,
      open: this.doorwayArt(roomId) ?? undefined,
      walk,
      thresholdY: walk && this.player?.onGround ? this.player.y + this.player.h : undefined,
    };
    if (this.player) this.player.interactionsEnabled = false;
    this.game.sfx.play(this.transition.open ? 'unlock' : 'menuOpen');
  }

  /**
   * A flush horizontal opening is one continuous threshold. Keep walking
   * toward the old room's outside, then away from the new room's edge,
   * instead of freezing as soon as the hitbox touches a trigger.
   */
  private edgeWalk(toRoom: string): { out: -1 | 1; into: -1 | 1 } | null {
    const leaving = this.room.triggers?.find(
      (tr) => tr.event === 'door' && tr.props?.room === toRoom,
    );
    const dest = ROOMS[toRoom];
    const entering = dest?.triggers?.find(
      (tr) => tr.event === 'door' && tr.props?.room === this.roomId,
    );
    if (!leaving || !entering || !dest) return null;
    const out = edgeDoorSide(this.room, leaving);
    const farSide = edgeDoorSide(dest, entering);
    if (out === null || farSide === null) return null;
    return { out, into: farSide === -1 ? 1 : -1 };
  }

  private moveThroughEdge(direction: -1 | 1, dt: number): void {
    const p = this.player;
    if (!p || dt <= 0) return;

    // The rest of the world pauses behind the fade, but the crossing
    // knight does not: real position, real gravity, real solids. The
    // only licence an edge-walk takes is dropping the level's x-backstop
    // (via a boundless solids-only source), because crossing the
    // boundary is the entire point of this moment.
    //
    // It used to clamp x INTO the room, collide there, and restore x —
    // and colliding at a made-up position meant the resolver could find
    // a wall that the real body never touched. Jump out through the
    // vault's doorway and the clamped ghost stood inside the solid wall
    // ABOVE the door; the resolver ejected it upward one tile per frame,
    // riding the wall to the ceiling, and the door then faithfully
    // mapped that height to a landing outside the far room. Real
    // position, honest answer: a wall above the door stops you until
    // you drop into the opening, then you walk through it.
    // The threshold's own floor, for the frames she is outside the room.
    // Walking out is the point of this moment, but the tiles end at the
    // boundary, so a knight who WALKED through a doorway used to walk off
    // the end of the world and fall — and the height re-map at the swap
    // then faithfully carried that accidental fall into the next room
    // (110 -> 114.2 -> arriving 4px low, every walked edge door). She is
    // standing on a floor that continues; the engine just cannot see the
    // half of it that belongs to the room being loaded. This is that half,
    // and only that half: it lies entirely outside the boundary, so no
    // real hole in either room is ever paved over by it.
    const floorY = this.transition?.thresholdY;
    const slab: Solid | null = floorY === undefined ? null : {
      x: direction === -1 ? -THRESHOLD_RUN : this.tilemap.worldW,
      y: floorY,
      w: THRESHOLD_RUN,
      h: this.tilemap.tileSize,
    };
    p.facing = direction;
    p.vx = direction * EDGE_WALK_SPEED;
    p.advanceTransitionAir(dt);
    moveAndCollide(p, dt, {
      solidsNear: (rect) => {
        const near = [...p.collision.solidsNear(rect)];
        if (slab && rect.x < slab.x + slab.w && slab.x < rect.x + rect.w
          && rect.y < slab.y + slab.h && slab.y < rect.y + rect.h) near.push(slab);
        return near;
      },
    });
    p.animT += dt;
  }

  /**
   * The opening filled by an actual door on the way out to `toRoom`, or
   * null if this exit is a bare gap. Only a doorway with a door in it has
   * anything to swing out of the way, which is why walking through most
   * of them cuts straight to the fade.
   */
  private doorwayArt(toRoom: string): { left: number; x: number; y: number; w: number; h: number } | null {
    const leaving = this.room.triggers?.find(
      (tr) => tr.event === 'door' && tr.props?.room === toRoom,
    );
    if (!leaving) return null;
    const ts = this.tilemap.tileSize;
    const col = Math.round(leaving.x / ts);
    const r0 = Math.floor(leaving.y / ts);
    const r1 = Math.floor((leaving.y + leaving.h - 1) / ts);
    if (this.tilemap.tileAt(col, r0) !== 'gate') return null;
    return { left: DOOR_OPEN_TIME, x: col * ts, y: r0 * ts, w: ts, h: (r1 - r0 + 1) * ts };
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

  /** The current run as save data (null in a sandbox / with no player). */
  private buildSave(): SaveData | null {
    if (this.testRoom || this.sandbox || !this.player) return null;
    return {
      roomId: this.roomId,
      best: this.best,
      savedAt: Date.now(),
      flags: [...this.flags],
      firedTriggers: this.firedTriggers,
      patches: this.patches.snapshot(),
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
    // The reward is the louder news, so it takes the banner when there is
    // one. Granted BEFORE the autosave below, so the ability is in the
    // checkpoint you would reload — earning it and losing it to a crash
    // on the walk out would be the worst possible bug here.
    if (!this.grantBossReward(boss)) this.showBanner(t('VICTORY!'), 2);
    this.victoryT = 1.6; // let the gibs settle before the epilogue speaks
    this.autosave();
    this.updateMusic(); // the boss theme dies with him
  }

  /**
   * Hand over whatever this boss owns — a verb, a key item, an off-tree
   * skill; the catalog decides, and this only reports the news. Returns
   * true if any knight actually earned something; false covers every
   * "nothing new" case: no reward declared, nobody to receive it, and
   * re-killing a boss whose unlock is already held. Only a new grant
   * plays the
   * fanfare, which is what stops a reload or a replay from re-announcing
   * (restoring a save fills the set silently).
   */
  private grantBossReward(boss: Monster): boolean {
    const id = boss.def.grants;
    if (!id) return false;
    // Every knight who was in the room earns it. In co-op the guest is a
    // real Player whose progress is synced back to their own save, so
    // rewarding only the host would quietly write the emptiness home —
    // both fought the boss, both keep the reward.
    let fresh = false;
    for (const p of [this.player, this.coop?.guest ?? null]) {
      if (p && p.earned.grant(id, { game: p.game, player: p })) fresh = true;
    }
    if (!fresh) return false;
    const def = earnableDef(id);
    this.showBanner(t(def.name), 2.4);
    // ...and how to USE it, in the buttons this player actually has. A
    // verb whose banner names it and nothing else is a verb you go and
    // look up; the hint's inputs are resolved per device, so a pad says
    // X and a phone shows the on-screen glyph rather than a key nobody
    // has pressed.
    this.showHint(promptText(this.game, t(def.desc)), 5);
    // The floater is anchored on the local knight, who may be gone (a
    // guest can land the killing blow after the host falls); the banner
    // and flash still carry the news either way.
    const p = this.player;
    if (p) this.game.feel.text(p.cx, p.y - 12, t('NEW ABILITY'), COLORS.gold, 1);
    this.game.feel.flash(0.5, COLORS.gold);
    this.game.sfx.play('unlock');
    return true;
  }

  /* ---------------- triggers & dialogue ---------------- */

  private handleTrigger(def: TriggerDef): void {
    this.firedTriggers[this.roomId] = this.triggers.exportFired();
    // Always on the bus (custom events, ad-hoc listeners), then routed to
    // whatever registered action gives the event its meaning.
    this.game.events.emit('trigger', { event: def.event, props: def.props });
    // An action decides for itself whether touching it is enough (see
    // TriggerAction.autoFire): an open doorway is, a barred one and a
    // portal pad are not, and those wait for interact (see useInteract).
    if (this.firesOnContact(def)) triggerActions.get(def.event).run(def, this.host);
  }

  /**
   * Does touching this trigger run it? Anything without an opinion fires
   * on contact, which is what talk zones and ambushes want.
   */
  private firesOnContact(def: TriggerDef): boolean {
    if (!triggerActions.has(def.event)) return false;
    const action = triggerActions.get(def.event);
    return action.autoFire ? action.autoFire(def, this.host) : true;
  }

  /** Use the door/portal the player is standing on (interact pressed). */
  private useInteract(def: TriggerDef): void {
    if (def.event === 'portal') this.openPortal();
    else triggerActions.get('door').run(def, this.host); // traverse / lock feedback
  }

  /** A door/portal's floating prompt: where a door leads, or "TRAVEL". */
  /**
   * A standing sign over every doorway naming where it goes.
   *
   * This replaced a floating "E CAVERN" that only appeared once you were
   * already standing in the opening — useless twice over, since by then
   * you are through, and since walking in no longer needs a key press.
   * A sign you can read from across the room is what actually helps: you
   * pick your exit before you commit to walking to it.
   *
   * Dimmed rather than hidden at distance, so a room full of doors
   * doesn't turn into a wall of shouting gold text.
   */
  /**
   * A door that stops being locked while you are standing in it.
   *
   * Triggers fire on entry, so a doorway that refused you has had its one
   * go: kill the boss with your shoulder against his door and nothing
   * happens until you walk away and back, which reads as the door being
   * broken. Watch each doorway's locked state and re-arm the trigger the
   * moment it relents.
   */
  private rearmUnsealedDoors(): void {
    (this.room.triggers ?? []).forEach((def, index) => {
      if (def.event !== 'door') return;
      const locked = doorLocked(def, this.host);
      if (this.doorWasLocked.get(index) && !locked) this.triggers.rearm(index);
      this.doorWasLocked.set(index, locked);
    });
  }

  /**
   * Vertical seams fire on their motion CONDITION, not only on entry.
   *
   * Entry-edge triggering has a blind spot a shaft walks straight into:
   * arrive in the town well from below on a jump too weak to clear the
   * mouth, and you fall back down INSIDE the trigger you were placed in —
   * there is no entry edge left to fire. The honest outcome of a failed
   * exit is to fall back through the seam to the room below, so a
   * fallIn/leapUp door is checked every frame the player overlaps it.
   *
   * An arrival is primed only while its carried arc still travels INTO
   * the room. Once collision or gravity reverses that arc, the matching
   * return condition disarms the prime and fires immediately. Geometry
   * therefore gets the final word: a clear, strong jump exits; an intact
   * ceiling or short hop returns, with no pocket the knight can strand in.
   */
  private updateVerticalSeams(): void {
    const p = this.player;
    if (!p || this.transition) return;
    for (const def of this.room.triggers ?? []) {
      if (def.event !== 'door') continue;
      if (def.props?.fallIn !== true && def.props?.leapUp !== true) continue;
      if (!overlaps(p, def)) continue;
      if (doorLocked(def, this.host)) continue;
      if (this.firesOnContact(def)) {
        triggerActions.get('door').run(def, this.host);
        return;
      }
    }
  }

  private renderDoorSigns(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    const worldW = this.tilemap.worldW;
    const viewLeft = this.game.camera.x;
    const viewRight = viewLeft + this.game.camera.viewW;
    for (const z of this.room.triggers ?? []) {
      if (z.event !== 'door') continue;
      const doorX = z.x + z.w / 2;
      const label = this.doorLabel(z);
      const words = label.split(/\s+/);
      let lines = [label];
      if (textWidth(label) > 48 && words.length > 1) {
        let split = 1;
        let best = Number.POSITIVE_INFINITY;
        for (let i = 1; i < words.length; i++) {
          const left = words.slice(0, i).join(' ');
          const right = words.slice(i).join(' ');
          const score = Math.max(textWidth(left), textWidth(right));
          if (score < best) {
            best = score;
            split = i;
          }
        }
        lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
      }
      // Edge doors and scrolling rooms can put the authored door centre
      // outside the readable viewport. Clamp by the actual widest line,
      // not a fixed margin, so no destination name can be clipped.
      const halfWidth = Math.max(...lines.map((line) => textWidth(line))) / 2;
      const left = Math.max(0, viewLeft) + halfWidth + 2;
      const right = Math.min(worldW, viewRight) - halfWidth - 2;
      const textX = left <= right ? clamp(doorX, left, right) : (left + right) / 2;
      const near = p ? Math.abs(p.cx - doorX) < 70 : false;
      const besidePortal = (this.room.triggers ?? []).some((other) => (
        other.event === 'portal'
        && Math.abs((other.x + other.w / 2) - doorX) < 70
        && Math.abs((other.y + other.h / 2) - (z.y + z.h / 2)) < 70
      ));
      ctx.globalAlpha = near ? 1 : 0.45;
      const lineHeight = 8;
      // Above the doorway by preference — but a ceiling door's "above" is
      // outside the room, and the frame no longer extends past the roof to
      // cover for it. Clamp into the room the same way the line above
      // clamps horizontally, so the sign drops below the lintel instead
      // of demanding a strip of void to live in.
      const top = Math.max(0, this.game.camera.y) + 2;
      const bottom = Math.min(this.tilemap.worldH, this.game.camera.y + this.game.camera.viewH)
        - lines.length * lineHeight - 2;
      const wanted = z.y - 9 - (lines.length - 1) * lineHeight - (besidePortal ? 14 : 0);
      const textY = top <= bottom ? clamp(wanted, top, bottom) : wanted;
      lines.forEach((line, index) => {
        drawText(ctx, line, textX, textY + index * lineHeight, near ? COLORS.gold : COLORS.steel, 1, 'center');
      });
      ctx.globalAlpha = 1;
    }
  }

  /**
   * The door hauling itself up out of the opening, portcullis fashion —
   * which is what the banded timber already looks like, and reads far
   * better than sliding two 8px halves apart.
   *
   * Drawn over the tilemap's own copy of the door, but before actors, and
   * clipped to the opening. The gate disappears into the lintel while the
   * player crossing the threshold remains in the foreground.
   */
  private renderDoorOpening(ctx: CanvasRenderingContext2D): void {
    const o = this.transition?.open;
    if (!o) return;
    const p = clamp(1 - o.left / DOOR_OPEN_TIME, 0, 1);
    const ts = this.tilemap.tileSize;
    ctx.save();
    ctx.beginPath();
    ctx.rect(o.x, o.y, o.w, o.h);
    ctx.clip();
    ctx.fillStyle = '#07070d';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    const lift = Math.round(p * (o.h + ts));
    const gate = tiles.get('gate');
    for (let i = 0; i * ts < o.h + ts; i++) {
      gate.draw?.(ctx, o.x, o.y + i * ts - lift, ts, 0, i);
    }
    ctx.restore();
  }

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
    if (this.game.quietDialogue) return; // a quiet scenario reads the world, not the script
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
    this.seamFade = Math.max(0, this.seamFade - dt);

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
      // Haul the door up first; the fade waits until it is out of the way,
      // so you watch it open rather than being yanked through a shut one.
      if (tr.open && tr.open.left > 0) {
        tr.open.left -= dt;
        return;
      }
      const half = TRANSITION_TIME / 2;
      const before = tr.t;
      const after = Math.min(TRANSITION_TIME, before + dt);
      const outDt = Math.max(0, Math.min(after, half) - Math.min(before, half));
      if (tr.walk) this.moveThroughEdge(tr.walk.out, outDt);
      tr.t = after;
      if (before < half && after >= half) {
        // The fade-out half may have advanced a jump or fall. Re-map that
        // CURRENT height at the threshold instead of using the Y captured
        // when the transition began, keeping both halves of the arc
        // continuous.
        const liveLanding = tr.walk ? this.doorLanding(tr.roomId) : null;
        if (tr.walk && this.player) this.player.facing = tr.walk.into;
        // The arc's SPEED has to survive the swap too. setRoom zeroes
        // velocity — right for an ordinary door, where you arrive at a
        // standstill — but an edge pair is one continuous threshold, and
        // the instant-swap branch in goToRoom already hands velocity back
        // across the same call. Without this the height was re-mapped
        // (above) while the fall that produced it was thrown away, so a
        // jump or a drop through the opening restarted from rest on the
        // far side. Horizontal speed stays the transition's to own: the
        // walk drives it, and tr.t >= TRANSITION_TIME zeroes it on purpose.
        const carriedVy = liveLanding?.carry && this.player ? this.player.vy : null;
        this.setRoom(tr.roomId, liveLanding?.x ?? tr.x, liveLanding?.y ?? tr.y);
        if (carriedVy !== null && this.player) this.player.vy = carriedVy;
      }
      const inDt = Math.max(0, after - half) - Math.max(0, before - half);
      if (tr.walk) this.moveThroughEdge(tr.walk.into, inDt);
      if (tr.t >= TRANSITION_TIME) {
        if (tr.walk && this.player) this.player.vx = 0;
        if (this.player) this.player.interactionsEnabled = true;
        this.transition = null;
      }
      return;
    }

    if (this.phase === 'play') this.rearmUnsealedDoors();
    if (this.phase === 'play') this.updateVerticalSeams();

    // World map: an overlay, so the run simply freezes behind it.
    if (this.phase === 'play' && this.player && g.input.consumePress('map')) {
      g.scenes.push(new MapScene(g, {
        current: this.roomId,
        explored: (id) => this.flags.has(`visited:${id}`),
      }));
      return;
    }

    // While the director holds the stage, menu means "skip", not
    // "pause" — and a skip fast-forwards the timeline, so everything the
    // cutscene was going to do still happens.
    if (this.director.active && g.input.consumePress('menu')) {
      this.director.skip();
    }

    if (this.phase === 'play' && this.player && !this.director.active && g.input.consumePress('menu')) {
      g.scenes.push(new PauseScene(g, this.player, {
        onRestart: () => this.beginRun({ kind: 'autosave' }),
        onTitle: () => this.returnToTitle(),
        onSaveSlot: (slot) => this.saveToSlot(slot),
        onLoadSlot: (slot) => this.beginRun({ kind: 'slot', slot }),
      }));
      return;
    }

    this.coop?.applyInput(); // remote edges land before the world steps
    this.director.update(dt); // scripted presses land before the world steps too
    // Cinematic protection, host-authoritative: while the director owns
    // the stage neither knight can be hurt OR drown. The host's hands
    // are scripted and the guest's are off (neutral input on both
    // sides), so damage taken now would be unavoidable rather than
    // answerable. invulnT covers combat/hazard/contact and decays
    // within a beat of control returning; cineShield covers the breath
    // (drowning bypasses invulnT) and clears the step the scene ends.
    {
      const cine = this.director.active;
      const guest = this.coop?.guest ?? null;
      for (const p of [this.player, guest]) {
        if (!p) continue;
        p.cineShield = cine;
        if (cine) p.invulnT = Math.max(p.invulnT, 0.1);
      }
      // The guest knight is STOOD DOWN for the scene's duration, not
      // frozen: her drive is zeroed each step (an impulse, which
      // mechanisms may apply) and physics keeps running. On solid
      // ground that is indistinguishable from the old position anchor;
      // mid-air she falls and lands like a body, because a cutscene is
      // a camera choice, not an exemption from gravity. The anchor this
      // replaces restored her coordinates after the world stepped —
      // the exact kind of position-setting that puts bodies where
      // movement never could.
      if (cine && guest) guest.vx = 0;
    }
    g.world.update(dt);
    this.cutsceneInput?.endStep(); // scripted press/release edges last one step
    if (this.coop) {
      this.coop.step({
        roomId: this.roomId,
        score: this.score,
        banner: this.bannerT > 0 ? this.banner : null,
        // Geometry the run has changed in THIS room, so a guest's tilemap
        // agrees with the host's about what is solid. The revision is the
        // cheap per-step read; the session calls patch() — the deep copy —
        // only when the revision (or room) has actually moved.
        patchRev: this.patches.revision,
        patch: () => this.patches.snapshot()[this.roomId],
        // While a cutscene directs the camera, the guest mirrors the shot.
        cine: this.director.active ? { x: g.camera.x, y: g.camera.y } : null,
      });
      if (this.coop.dropped) this.endCoop();
    }
    if (this.phase === 'play') this.waves.update(dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    // No trigger fires while the director holds the stage: a scripted
    // walk crossing a talk zone would push a modal dialogue that freezes
    // this scene (only the top scene updates) and strand the cutscene
    // mid-step. Once-triggers only mark fired when they actually fire,
    // so anything she is left standing in fires on the first frame after
    // control returns — which is exactly the sequencing a reveal
    // followed by a conversation wants.
    if (this.phase === 'play' && this.player && this.player.hp > 0 && !this.director.active) {
      // Vertical seams gate their ENTRY on the motion test, not just the
      // firing: brushing a seam below falling speed must not consume the
      // edge, or a locked shaft spends its one refusal silently — you
      // stood on the choked flue's rubble and never read the sign. Held
      // at the threshold, the entry lands the moment the motion is real,
      // and a locked door then refuses once per approach as designed.
      const seamStillApproaching = (def: TriggerDef): boolean =>
        def.event === 'door'
        && (def.props?.fallIn === true || def.props?.leapUp === true)
        && !this.firesOnContact(def);
      this.triggers.update(
        this.player,
        (f) => this.handleTrigger(f.def),
        (def) => this.assembled(def) && !seamStillApproaching(def),
      );
      // Doors & portals: stand on one and press interact to use it. Checked
      // after the world step so an NPC in range wins the key first.
      const p = this.player;
      // Only zones still waiting on the key: an unlocked door walks you
      // through on contact, so prompting for E on it would be a lie.
      this.nearInteract = this.interactZones.find((z) => overlaps(p, z) && !this.firesOnContact(z)) ?? null;
      if (this.nearInteract && g.input.consumePress('interact')) this.useInteract(this.nearInteract);
    } else {
      this.nearInteract = null;
    }
    if (this.victoryT > 0) {
      this.victoryT -= dt;
      if (this.victoryT <= 0) this.openConversation(this.pendingEpilogue);
    }
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.hintT = Math.max(0, this.hintT - dt);
    this.shatterCd = Math.max(0, this.shatterCd - dt);
    if (this.minimapDirty) {
      this.minimapDirty = false;
      this.minimap = new Minimap(this.tilemap, { maxW: 64, maxH: 22 });
    }

    if (this.player && !this.director.active) {
      // Camera leads the player: facing offset + velocity lookahead,
      // and (with the zoomed-in view) follows vertically too, biased so
      // more of the world above the knight is visible than below.
      // With a co-op guest alive, aim at the midpoint of the two knights.
      // While a cutscene plays the director owns the camera instead.
      const cam = g.camera;
      const target = this.cameraTarget(this.player.x, this.player.y);
      cam.follow(target.x, target.y, dt);
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
    this.bg.render(
      ctx,
      g.camera.x,
      g.camera.y,
      (this.room.props?.backdrop as string | undefined) ?? 'night',
      this.uiT,
    );
    g.camera.begin(ctx);
    this.tilemap.render(ctx, g.camera.x, g.camera.y, g.camera.viewW, g.camera.viewH);
    this.renderDoorOpening(ctx);
    this.waves.renderMarkers(ctx);
    g.world.render(ctx);
    if (this.phase === 'play') this.hud.renderGateMarker(ctx, this.gateMarker, this.uiT);
    this.director.renderLetterbox(ctx, g.width, g.height);
    if (this.phase === 'play') this.renderDoorSigns(ctx);
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
          hint: this.hint,
          hintT: this.hintT,
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
    } else if (this.seamFade > 0) {
      // The seam's fade-in: cosmetic only, over a live, running world.
      ctx.globalAlpha = clamp(this.seamFade / SEAM_FADE, 0, 1);
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
