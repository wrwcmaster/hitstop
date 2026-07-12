import {
  type Scene,
  type RoomDef,
  buildTilemap,
  Tilemap,
  tiles,
  drawText,
  DebugOverlay,
  chance,
  rand,
  clamp,
} from '@engine/index';
import type { ActionGame } from '../defs';
import { Player } from '../actors/player';
import { Monster, monsters } from '../actors/monster';
import { Background } from './background';
import { COLORS } from '../content/palette';
import { HEART, HEART_EMPTY, KNIGHT_IDLE_SPRITE } from '../content/sprites';

/** A monster queued to spawn, currently telegraphing. */
interface PendingSpawn {
  t: number;
  x: number;
  y: number;
  type: string;
}

type Phase = 'title' | 'play' | 'over';

/**
 * The wave-survival arena. One scene, three phases: title overlay,
 * playing, game-over overlay (the world keeps simulating through death —
 * corpses fall, particles settle).
 */
export class PlayScene implements Scene {
  private tilemap: Tilemap;
  private bg: Background;
  private debug: DebugOverlay;

  private phase: Phase = 'title';
  private player: Player | null = null;

  private score = 0;
  private best = 0;
  private wave = 0;
  private combo = 0;
  private comboT = 0;
  private banner = '';
  private bannerT = 0;
  private overT = 0;

  private queue: string[] = [];
  private pending: PendingSpawn[] = [];
  private spawnT = 0;
  private clearT = 0;
  private clearShown = false;

  constructor(
    private game: ActionGame,
    private room: RoomDef,
  ) {
    this.tilemap = buildTilemap(room);
    this.bg = new Background(game.width, game.height);
    this.debug = new DebugOverlay(game as never);
    game.camera.setBounds(0, -30, this.tilemap.worldW, this.tilemap.worldH);

    // Scoring, combo and flow react to combat via events — content and
    // engine never know about score.
    game.events.on('hit', () => {
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
    });
    game.events.on('playerHurt', () => {
      this.combo = 0;
      this.comboT = 0;
    });
    game.events.on('playerDied', () => {
      this.phase = 'over';
      this.overT = 1.4;
      this.best = Math.max(this.best, this.score);
    });

    game.input.onAnyPress(() => this.onAnyPress());
  }

  private onAnyPress(): void {
    if (this.phase === 'title') this.startRun();
    else if (this.phase === 'over' && this.overT <= 0) this.startRun();
  }

  private startRun(): void {
    const g = this.game;
    g.world.clear();
    g.feel.reset();
    this.player = g.world.spawn(new Player(g, this.tilemap, this.room.playerSpawn.x, this.room.playerSpawn.y));
    // Rooms can pre-place monsters (the arena spawns via waves instead).
    for (const e of this.room.entities) {
      if (monsters.has(e.type)) g.world.spawn(new Monster(e.type, g, this.tilemap, e.x, e.y));
    }
    this.score = 0;
    this.wave = 0;
    this.combo = 0;
    this.comboT = 0;
    this.queue = [];
    this.pending = [];
    this.spawnT = 0;
    this.clearT = 0;
    this.phase = 'play';
    this.nextWave();
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
    if (this.phase !== 'play') return;
    const g = this.game;
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0) {
      this.spawnT = 0.45;
      const type = this.queue.shift()!;
      const def = monsters.get(type);
      let x: number, y: number;
      if (def.flies) {
        x = g.camera.x + 40 + rand(0, g.width - 80);
        y = 36 + rand(0, 44);
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
    if (this.phase !== 'title') {
      g.world.update(dt);
      this.updateSpawns(dt);
      this.comboT = Math.max(0, this.comboT - dt);
      if (this.comboT <= 0) this.combo = 0;
    }
    this.bannerT = Math.max(0, this.bannerT - dt);

    if (this.player) {
      // Camera leads the player: facing offset + velocity lookahead.
      const p = this.player;
      const tx = p.cx - g.width / 2 + p.facing * 24 + p.vx * 0.12;
      g.camera.follow(tx, 0, dt);
    }
  }

  frame(realDt: number): void {
    this.overT = Math.max(0, this.overT - realDt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const g = this.game;
    this.bg.render(ctx, g.camera.x);
    g.camera.begin(ctx);
    this.tilemap.render(ctx, g.camera.x, g.camera.y, g.width, g.height);
    this.renderSpawnMarkers(ctx);
    g.world.render(ctx);
    g.feel.renderWorld(ctx);
    this.debug.renderWorld(ctx);
    g.camera.end(ctx);

    if (this.phase === 'title') this.renderTitle(ctx);
    else this.renderHUD(ctx);
    if (this.phase === 'over') this.renderOver(ctx);
    this.debug.renderScreen(ctx);
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
        g.drawImage(i < p.hp ? HEART : HEART_EMPTY, 6 + i * 9, 6);
      }
    }
    drawText(g, `SCORE ${this.score}`, gm.width - 6, 7, COLORS.white, 1, 'right');
    drawText(g, `WAVE ${this.wave}`, gm.width / 2, 7, COLORS.steel, 1, 'center');
    if (this.combo >= 2) {
      drawText(g, `COMBO X${this.combo}`, gm.width / 2, 18, COLORS.gold, 1, 'center');
      g.fillStyle = COLORS.gold;
      g.fillRect(Math.round(gm.width / 2 - 15), 26, Math.round((30 * this.comboT) / 2), 2);
    }
    if (this.bannerT > 0) drawText(g, this.banner, gm.width / 2, 58, COLORS.white, 3, 'center');
  }

  private renderTitle(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    g.fillStyle = 'rgba(7,7,13,0.55)';
    g.fillRect(0, 0, gm.width, gm.height);
    g.save();
    g.translate(gm.width / 2 - 18, 118);
    g.scale(3, 3);
    g.drawImage(KNIGHT_IDLE_SPRITE, 0, 0);
    g.restore();
    drawText(g, 'HITSTOP', gm.width / 2, 52, COLORS.white, 4, 'center');
    drawText(g, 'GAME FEEL IS THE FOUNDATION', gm.width / 2, 84, COLORS.steel, 1, 'center');
    drawText(g, 'MOVE: ARROWS / WASD', gm.width / 2, 176, COLORS.steelDark, 1, 'center');
    drawText(g, 'ATTACK: Z OR J - DASH: X OR K', gm.width / 2, 188, COLORS.steelDark, 1, 'center');
    drawText(g, 'JUMP: SPACE / W / UP', gm.width / 2, 200, COLORS.steelDark, 1, 'center');
    if (Math.floor(performance.now() / 400) % 2) {
      drawText(g, 'PRESS ANY KEY', gm.width / 2, 226, COLORS.gold, 2, 'center');
    }
  }

  private renderOver(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    g.fillStyle = 'rgba(7,7,13,0.55)';
    g.fillRect(0, 0, gm.width, gm.height);
    drawText(g, 'GAME OVER', gm.width / 2, 70, COLORS.red, 4, 'center');
    drawText(g, `SCORE ${this.score}`, gm.width / 2, 110, COLORS.white, 2, 'center');
    drawText(g, `BEST ${this.best}`, gm.width / 2, 130, COLORS.steel, 1, 'center');
    drawText(g, `WAVES SURVIVED: ${Math.max(0, this.wave - 1)}`, gm.width / 2, 144, COLORS.steel, 1, 'center');
    if (this.overT <= 0 && Math.floor(performance.now() / 400) % 2) {
      drawText(g, 'PRESS ANY KEY', gm.width / 2, 190, COLORS.gold, 2, 'center');
    }
  }
}
