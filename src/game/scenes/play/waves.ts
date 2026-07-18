import { WaveRunner, chance, rand, t } from '@engine/index';
import { Monster, monsters } from '../../actors/monster';
import { Pickup } from '../../actors/pickup';
import { COLORS } from '../../content/palette';
import { waveTables, type WaveTable } from '../../content/waves';
import type { PlayHost } from './host';

/**
 * hitstop's wave combat: the engine's WaveRunner does the sequencing
 * (queue, telegraphs, clears, breathers, the goal); this class supplies
 * what's ours — wave composition from the room's table, spawn placement
 * (fliers inside the camera view, walkers at the arena edges), monster
 * creation, the WAVE / WAVE CLEAR announcements, and the gate-key drop
 * that ends a `waveGoal` room's gauntlet.
 */
export class WaveDirector {
  private runner: WaveRunner<string>;
  private keyDropped = false;

  constructor(private host: PlayHost) {
    this.runner = new WaveRunner<string>({
      compose: (wave) => this.table.compose(wave),

      place: (type) => {
        const g = this.host.game;
        const def = monsters.get(type);
        if (def.flies) {
          // Inside the (zoomed) camera view so the telegraph is visible.
          return {
            x: g.camera.x + 24 + rand(0, Math.max(40, g.camera.viewW - 48)),
            y: Math.max(20, g.camera.y + 16) + rand(0, g.camera.viewH * 0.35),
          };
        }
        const tilemap = this.host.tilemap;
        const x = chance(0.5) ? 24 : tilemap.worldW - 24 - def.w;
        return { x, y: tilemap.groundY(x) - def.h };
      },

      spawn: (type, x, y) => {
        const g = this.host.game;
        const m = g.world.spawn(new Monster(type, g, this.host.tilemap, x, y));
        g.feel.burst(m.cx, m.cy, 10, { color: m.def.colors, speed: 70, life: 0.35, drag: 3 });
      },

      alive: () => this.host.game.world.actors('enemy').length > 0,
      canProgress: () => {
        const p = this.host.player;
        return !!p && p.hp > 0;
      },

      timing: () => ({
        spawnInterval: this.table.spawnInterval ?? 0.45,
        telegraphTime: this.table.telegraph ?? 0.55,
        clearDelay: this.table.clearDelay ?? 1.2,
      }),
      goal: () => this.host.room.props?.waveGoal as number | undefined,

      onWave: (wave) => {
        const g = this.host.game;
        g.feel.sfx.play('wave');
        this.host.banner(t('WAVE {n}', { n: wave }), 1.5);
        g.events.emit('waveStart', { wave });
      },
      onClear: (wave) => {
        const g = this.host.game;
        this.host.banner(t('WAVE CLEAR!'), 1);
        g.feel.sfx.play('combo');
        g.events.emit('waveClear', { wave });
      },
      onGoal: () => this.dropGateKey(),
    });
  }

  /** Whether the current room runs waves at all. */
  get active(): boolean {
    return !!this.host.room.props?.waves;
  }

  get wave(): number {
    return this.runner.wave;
  }

  /** Monsters still queued to spawn this wave (replay state, debug). */
  get queued(): number {
    return this.runner.queued;
  }

  /** Telegraphs currently blinking in (replay state, debug). */
  get telegraphs(): number {
    return this.runner.telegraphs.length;
  }

  private get table(): WaveTable {
    const id = this.host.room.props?.waves;
    return waveTables.get(typeof id === 'string' && waveTables.has(id) ? id : 'default');
  }

  /** Forget everything (entering a room). */
  reset(): void {
    this.runner.reset();
    this.keyDropped = false;
  }

  /** Arm the waves on room entry. Pass `fromWave` to resume a checkpoint
   * mid-gauntlet (the saved wave restarts fresh); omit for a new run. */
  begin(fromWave = 1): void {
    this.runner.begin(fromWave);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.runner.update(dt);
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
    this.host.banner(t('THE GATE KEY DROPS'), 2);
    g.feel.sfx.play('levelup');
    g.feel.flash(0.15, COLORS.gold);
  }

  /** Blinking diamond telegraphs where a monster is about to appear. */
  renderMarkers(g: CanvasRenderingContext2D): void {
    for (const s of this.runner.telegraphs) {
      if (Math.floor(s.t * 10) % 2) continue;
      const def = monsters.get(s.spec);
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
