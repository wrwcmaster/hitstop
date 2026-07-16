import { tiles, chance, rand, clamp } from '@engine/index';
import { Monster, monsters } from '../../actors/monster';
import { Pickup } from '../../actors/pickup';
import { COLORS } from '../../content/palette';
import { waveTables, type WaveTable } from '../../content/waves';
import type { PlayHost } from './host';

/** A monster queued to spawn, currently telegraphing. */
interface PendingSpawn {
  t: number;
  x: number;
  y: number;
  type: string;
}

/**
 * Runs a room's endless-wave combat: composes each wave from the room's
 * wave table (`props.waves`), telegraphs and spawns monsters, announces
 * WAVE / WAVE CLEAR, and — if the room sets a `waveGoal` — drops the
 * room's `gateKey` when that wave is cleared and stops the gauntlet.
 */
export class WaveDirector {
  wave = 0;
  private queue: string[] = [];
  private pending: PendingSpawn[] = [];
  private spawnT = 0;
  private clearT = 0;
  private clearShown = false;
  private keyDropped = false;

  constructor(private host: PlayHost) {}

  /** Whether the current room runs waves at all. */
  get active(): boolean {
    return !!this.host.room.props?.waves;
  }

  private get table(): WaveTable {
    const id = this.host.room.props?.waves;
    return waveTables.get(typeof id === 'string' && waveTables.has(id) ? id : 'default');
  }

  /** Forget everything (entering a room). */
  reset(): void {
    this.wave = 0;
    this.queue = [];
    this.pending = [];
    this.spawnT = 0;
    this.clearT = 0;
    this.clearShown = false;
    this.keyDropped = false;
  }

  /** Arm the first wave (rooms that want waves, on entry). */
  begin(): void {
    this.nextWave();
  }

  private nextWave(): void {
    const g = this.host.game;
    this.wave++;
    this.clearShown = false;
    g.feel.sfx.play('wave');
    this.host.banner(`WAVE ${this.wave}`, 1.5);
    this.queue.push(...this.table.compose(this.wave));
    g.events.emit('waveStart', { wave: this.wave });
  }

  update(dt: number): void {
    if (!this.active) return;
    const g = this.host.game;
    const tilemap = this.host.tilemap;
    const player = this.host.player;

    // Feed the telegraph queue.
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0) {
      this.spawnT = this.table.spawnInterval ?? 0.45;
      const type = this.queue.shift()!;
      const def = monsters.get(type);
      let x: number, y: number;
      if (def.flies) {
        // Inside the (zoomed) camera view so the telegraph is visible.
        x = g.camera.x + 24 + rand(0, Math.max(40, g.camera.viewW - 48));
        y = Math.max(20, g.camera.y + 16) + rand(0, g.camera.viewH * 0.35);
      } else {
        x = chance(0.5) ? 24 : tilemap.worldW - 24 - def.w;
        y = this.groundYAt(x) - def.h;
      }
      this.pending.push({ t: this.table.telegraph ?? 0.55, x, y, type });
    }

    // Telegraphs mature into monsters.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        const m = g.world.spawn(new Monster(s.type, g, tilemap, s.x, s.y));
        g.feel.burst(m.cx, m.cy, 10, { color: m.def.colors, speed: 70, life: 0.35, drag: 3 });
        this.pending.splice(i, 1);
      }
    }

    // Wave cleared → breather → next wave (or the gate key at the goal).
    const enemiesLeft = g.world.actors('enemy').length;
    if (!this.queue.length && !this.pending.length && !enemiesLeft && player && player.hp > 0) {
      if (!this.clearShown) {
        this.clearShown = true;
        this.host.banner('WAVE CLEAR!', 1);
        g.feel.sfx.play('combo');
        g.events.emit('waveClear', { wave: this.wave });
      }
      this.clearT += dt;
      if (this.clearT >= (this.table.clearDelay ?? 1.2)) {
        this.clearT = 0;
        const goal = this.host.room.props?.waveGoal as number | undefined;
        if (goal && this.wave >= goal) this.dropGateKey();
        else this.nextWave();
      }
    }
  }

  /** Cleared the gauntlet: drop the gate key (once) and stop the waves. */
  private dropGateKey(): void {
    if (this.keyDropped) return;
    this.keyDropped = true;
    const g = this.host.game;
    const keyId = this.host.room.props?.gateKey as string | undefined;
    const p = this.host.player;
    if (!keyId || !p) return;
    if (!p.inventory.has(keyId)) {
      g.world.spawn(new Pickup(keyId, g, this.host.tilemap, p.cx, p.cy - 8));
    }
    this.host.banner('THE GATE KEY DROPS', 2);
    g.feel.sfx.play('levelup');
    g.feel.flash(0.15, COLORS.gold);
  }

  /** Scan down the tile column at x for the top of the first solid tile. */
  private groundYAt(x: number): number {
    const tilemap = this.host.tilemap;
    const ts = tilemap.tileSize;
    const tx = clamp(Math.floor(x / ts), 0, tilemap.cols - 1);
    for (let ty = 0; ty < tilemap.rows; ty++) {
      if (tiles.get(tilemap.tileAt(tx, ty)).solid) return ty * ts;
    }
    return tilemap.worldH - ts;
  }

  /** Blinking diamond telegraphs where a monster is about to appear. */
  renderMarkers(g: CanvasRenderingContext2D): void {
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
}
