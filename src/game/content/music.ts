import { defineSong } from '@engine/index';

/**
 * The soundtrack: five looping chip tunes. Tracks with different step
 * counts drift against each other, which keeps short loops from wearing
 * out their welcome. Compose with the sequencer's note names; volumes
 * are deliberately low — music sits under the SFX.
 */

/** Title Screen: upbeat, mystical intro (Am - F - C - G). */
defineSong('title', {
  bpm: 120,
  div: 2,
  tracks: [
    {
      wave: 'square',
      volume: 0.032,
      gate: 0.6,
      steps: [
        'E5', '-', 'D5', 'C5', 'B4', 'C5', 'D5', 'E5',
        'A4', '-', 'A4', 'B4', 'C5', '-', 'B4', 'A4',
        'G4', 'A4', 'B4', 'C5', 'D5', '-', 'C5', 'B4',
        'E5', '-', '-', '-', 'E4', 'F4', 'G#4', 'B4',
        'E5', '-', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4',
        'F5', '-', 'F5', 'G5', 'A5', '-', 'G5', 'F5',
        'G5', 'F5', 'E5', 'D5', 'E5', 'F5', 'G5', 'E5',
        'A5', '-', '-', '-', '-', '-', '-', '-',
      ],
    },
    {
      wave: 'sawtooth',
      volume: 0.016,
      gate: 0.8,
      steps: [
        'A3', '-', 'E4', '-', 'A3', '-', 'E4', '-',
        'F3', '-', 'C4', '-', 'F3', '-', 'C4', '-',
        'C3', '-', 'G3', '-', 'C3', '-', 'G3', '-',
        'E3', '-', 'B3', '-', 'E3', '-', 'B3', '-',
        'A3', '-', 'E4', '-', 'A3', '-', 'E4', '-',
        'F3', '-', 'C4', '-', 'F3', '-', 'C4', '-',
        'G3', '-', 'D4', '-', 'G3', '-', 'D4', '-',
        'A3', '-', 'E4', '-', 'A3', '-', '-', '-',
      ],
    },
    {
      wave: 'kick',
      volume: 0.07,
      steps: ['x', '-', '-', '-', 'x', '-', '-', '-'],
    },
    {
      wave: 'snare',
      volume: 0.04,
      steps: ['-', '-', '-', '-', 'x', '-', '-', '-'],
    },
    {
      wave: 'hihat',
      volume: 0.03,
      steps: ['-', 'x', '-', 'x', '-', 'x', '-', 'x'],
    },
  ],
});

/** Game Over: somber, tragic descending melody. */
defineSong('gameover', {
  bpm: 75,
  div: 2,
  tracks: [
    {
      wave: 'triangle',
      volume: 0.05,
      gate: 1.5,
      steps: [
        'A4', '-', '-', '-', 'G4', '-', '-', '-',
        'F4', '-', '-', '-', 'E4', '-', '-', '-',
        'D4', '-', 'E4', '-', 'F4', '-', 'D4', '-',
        'E4', '-', '-', '-', '-', '-', '-', '-',
      ],
    },
    {
      wave: 'sine',
      volume: 0.07,
      gate: 2.0,
      steps: [
        'A2', '-', '-', '-', 'G2', '-', '-', '-',
        'F2', '-', '-', '-', 'E2', '-', '-', '-',
        'D2', '-', '-', '-', 'F2', '-', '-', '-',
        'A2', '-', '-', '-', '-', '-', '-', '-',
      ],
    },
  ],
});

/** Arena (Overworld): mid-tempo, minor, forward motion (Am - F - G - Em). */
defineSong('overworld', {
  bpm: 112,
  div: 2,
  tracks: [
    {
      wave: 'square',
      volume: 0.035,
      gate: 0.55,
      steps: [
        'A2', '-', 'E3', '-', 'A2', '-', 'E3', 'A3',
        'F2', '-', 'C3', '-', 'F2', '-', 'C3', 'F3',
        'G2', '-', 'D3', '-', 'G2', '-', 'D3', 'G3',
        'E2', '-', 'B2', '-', 'E2', '-', 'B2', 'E3',
        'F2', '-', 'C3', '-', 'F2', '-', 'C3', 'F3',
        'G2', '-', 'D3', '-', 'G2', '-', 'D3', 'G3',
        'A2', '-', 'E3', '-', 'A2', '-', 'E3', 'A3',
        'E2', '-', 'B2', '-', 'E2', '-', 'B2', 'E3',
      ],
    },
    {
      wave: 'triangle',
      volume: 0.065,
      gate: 0.8,
      steps: [
        'A4', '-', 'C5', '-', 'E5', '-', 'C5', '-',
        'A4', '-', 'C5', 'E5', '-', '-', 'C5', '-',
        'G4', '-', 'B4', '-', 'D5', '-', 'B4', '-',
        'G4', '-', 'E4', 'G4', 'B4', '-', 'G4', '-',
        'F4', '-', 'A4', '-', 'C5', '-', 'A4', '-',
        'G4', '-', 'B4', '-', 'D5', '-', 'B4', '-',
        'A4', '-', 'C5', '-', 'E5', '-', 'C5', '-',
        'E4', '-', 'G#4', 'B4', 'E5', '-', 'B4', '-',
      ],
    },
    {
      wave: 'kick',
      volume: 0.065,
      steps: ['x', '-', '-', '-', 'x', '-', '-', '-'],
    },
    {
      wave: 'snare',
      volume: 0.035,
      steps: ['-', '-', '-', '-', 'x', '-', '-', '-'],
    },
    {
      wave: 'hihat',
      volume: 0.03,
      steps: ['x', '-', 'x', '-', 'x', '-', 'x', '-'],
    },
  ],
});

/** Cavern (Depths): slow, sparse, cold. */
defineSong('depths', {
  bpm: 84,
  div: 2,
  tracks: [
    {
      wave: 'sine',
      volume: 0.08,
      gate: 3.5,
      steps: [
        'A2', '-', '-', '-', '-', '-', '-', '-',
        'C3', '-', '-', '-', '-', '-', '-', '-',
        'F2', '-', '-', '-', '-', '-', '-', '-',
        'E2', '-', '-', '-', '-', '-', '-', '-',
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
        'E4', '-', 'A4', '-', 'B4', '-', 'C5', '-',
        'B4', '-', '-', '-', 'G4', '-', '-', '-',
        'A4', '-', '-', '-', 'F4', '-', '-', '-',
        'E4', '-', '-', '-', '-', '-', '-', '-',
        'E4', '-', 'A4', '-', 'B4', '-', 'C5', '-',
        'D5', '-', '-', '-', 'B4', '-', '-', '-',
        'C5', '-', 'B4', '-', 'A4', '-', 'G#4', '-',
        'A4', '-', '-', '-', '-', '-', '-', '-',
      ],
    },
    {
      wave: 'kick',
      volume: 0.04,
      steps: ['x', '-', '-', '-', '-', '-', '-', '-'],
    },
    {
      wave: 'hihat',
      volume: 0.015,
      steps: ['-', '-', 'x', '-', '-', '-', 'x', '-'],
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
      volume: 0.03,
      gate: 0.5,
      steps: [
        'A2', 'A2', 'E3', 'A2', 'A2', 'A2', 'D3', 'C3',
        'F2', 'F2', 'C3', 'F2', 'F2', 'F2', 'E3', 'C3',
        'G2', 'G2', 'D3', 'G2', 'G2', 'G2', 'F3', 'D3',
        'E2', 'E2', 'B2', 'E2', 'E2', 'E2', 'G3', 'E3',
        'F2', 'F2', 'F2', 'F2', 'G2', 'G2', 'G2', 'G2',
        'A2', 'A2', 'E3', 'A2', 'A2', 'A2', 'E3', 'A2',
        'F2', 'F2', 'F2', 'F2', 'G2', 'G2', 'G2', 'G2',
        'E2', 'E2', 'E2', 'E2', 'E2', 'E2', 'E2', 'E2',
      ],
    },
    {
      wave: 'square',
      volume: 0.032,
      gate: 0.7,
      steps: [
        'A4', '-', '-', 'E5', '-', 'D5', 'C5', '-',
        '-', 'C5', '-', 'A4', '-', '-', 'C5', 'D5',
        'B4', '-', '-', 'D5', '-', 'C5', 'B4', '-',
        'G4', '-', 'A4', 'B4', 'C5', '-', 'B4', '-',
        'C5', '-', 'C5', 'D5', 'E5', '-', 'E5', 'F5',
        'E5', 'D5', 'C5', 'B4', 'A4', '-', '-', '-',
        'D5', '-', 'D5', 'E5', 'F5', '-', 'F5', 'G5',
        'E5', '-', '-', '-', '-', '-', '-', '-',
      ],
    },
    {
      wave: 'kick',
      volume: 0.075,
      steps: ['x', '-', 'x', '-', 'x', '-', 'x', '-'],
    },
    {
      wave: 'snare',
      volume: 0.045,
      steps: ['-', '-', '-', '-', 'x', '-', '-', '-'],
    },
    {
      wave: 'hihat',
      volume: 0.03,
      steps: ['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'],
    },
  ],
});

/** Importing this module registers the soundtrack. */
export function registerSongs(): void {}
