import { Registry, chance } from '@engine/index';

/**
 * Wave tables: named recipes for endless-wave combat. A room opts in with
 * `props.waves: "<table id>"` — the id names a table registered here, so
 * different rooms can run different gauntlets (and the WaveDirector never
 * hardcodes a composition). Extra knobs a room can set in its props:
 *
 *   waveGoal: 5            // clearing this wave drops...
 *   gateKey: 'gate-key'    // ...this item (see the locked-door trigger)
 */
export interface WaveTable {
  /** Monster type ids to spawn for wave `wave` (1-based). */
  compose(wave: number): string[];
  /** Seconds between individual spawns (default 0.45). */
  spawnInterval?: number;
  /** Telegraph time before each monster appears (default 0.55). */
  telegraph?: number;
  /** Breather after WAVE CLEAR before the next wave (default 1.2). */
  clearDelay?: number;
}

export const waveTables = new Registry<WaveTable>('waveTable');

export function defineWaveTable(id: string, table: WaveTable): void {
  waveTables.register(id, table);
}

// The classic arena mix: slimes forever, bats from wave 2, brutes from 3,
// two more monsters per wave.
defineWaveTable('default', {
  compose(wave) {
    const out: string[] = [];
    const n = 2 + wave;
    for (let i = 0; i < n; i++) {
      let type = 'slime';
      if (wave >= 2 && chance(0.4)) type = 'bat';
      if (wave >= 3 && chance(0.22)) type = 'brute';
      out.push(type);
    }
    return out;
  },
});
