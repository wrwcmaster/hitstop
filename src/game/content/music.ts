import { defineSong } from '@engine/index';

/**
 * The soundtrack: three looping chip tunes. Tracks with different step
 * counts drift against each other, which keeps short loops from wearing
 * out their welcome. Compose with the sequencer's note names; volumes
 * are deliberately low — music sits under the SFX.
 */

/** Arena: mid-tempo, minor, forward motion (Am - F - G - Em). */
defineSong('overworld', {
  bpm: 112,
  div: 2,
  tracks: [
    {
      wave: 'square',
      volume: 0.038,
      gate: 0.55,
      steps: [
        'A2', '-', 'E3', '-', 'A2', '-', 'E3', 'A3',
        'F2', '-', 'C3', '-', 'F2', '-', 'C3', 'F3',
        'G2', '-', 'D3', '-', 'G2', '-', 'D3', 'G3',
        'E2', '-', 'B2', '-', 'E2', '-', 'B2', 'E3',
      ],
    },
    {
      wave: 'triangle',
      volume: 0.07,
      gate: 0.8,
      steps: [
        'A4', '-', 'C5', '-', 'E5', '-', 'C5', '-',
        'A4', '-', 'C5', 'E5', '-', '-', 'C5', '-',
        'G4', '-', 'B4', '-', 'D5', '-', 'B4', '-',
        'G4', '-', 'E4', 'G4', 'B4', '-', 'G4', '-',
      ],
    },
    {
      wave: 'noise',
      volume: 0.018,
      steps: ['x', '-', '-', '-', 'x', '-', '-', 'x'],
    },
  ],
});

/** Cavern: slow, sparse, cold. */
defineSong('depths', {
  bpm: 84,
  div: 2,
  tracks: [
    {
      wave: 'sine',
      volume: 0.09,
      gate: 3.5,
      steps: [
        'A2', '-', '-', '-', '-', '-', '-', '-',
        'C3', '-', '-', '-', '-', '-', '-', '-',
        'G2', '-', '-', '-', '-', '-', '-', '-',
        'E2', '-', '-', '-', '-', '-', '-', '-',
      ],
    },
    {
      wave: 'triangle',
      volume: 0.045,
      gate: 1.4,
      steps: [
        '-', '-', '-', '-', 'E4', '-', '-', '-',
        '-', '-', '-', '-', 'D4', '-', '-', '-',
        '-', '-', '-', '-', 'C4', '-', 'B3', '-',
        '-', '-', '-', '-', '-', '-', '-', '-',
        '-', '-', '-', '-', 'A3', '-', '-', '-',
      ],
    },
  ],
});

/** Boss: fast, driving, relentless. */
defineSong('boss', {
  bpm: 144,
  div: 2,
  tracks: [
    {
      wave: 'sawtooth',
      volume: 0.032,
      gate: 0.5,
      steps: [
        'A2', 'A2', 'E3', 'A2', 'A2', 'A2', 'D3', 'C3',
        'F2', 'F2', 'C3', 'F2', 'F2', 'F2', 'E3', 'C3',
        'G2', 'G2', 'D3', 'G2', 'G2', 'G2', 'F3', 'D3',
        'E2', 'E2', 'B2', 'E2', 'E2', 'E2', 'G3', 'E3',
      ],
    },
    {
      wave: 'square',
      volume: 0.035,
      gate: 0.7,
      steps: [
        'A4', '-', '-', 'E5', '-', 'D5', 'C5', '-',
        '-', 'C5', '-', 'A4', '-', '-', 'C5', 'D5',
        'B4', '-', '-', 'D5', '-', 'C5', 'B4', '-',
        'G4', '-', 'A4', 'B4', 'C5', '-', 'B4', '-',
      ],
    },
    {
      wave: 'noise',
      volume: 0.022,
      steps: ['x', '-', 'x', '-', 'x', '-', 'x', 'x'],
    },
  ],
});

/** Importing this module registers the soundtrack. */
export function registerSongs(): void {}
