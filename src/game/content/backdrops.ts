import { Registry } from '@engine/index';

export interface BackdropLayer {
  color: string;
  /** Screen-space baseline before vertical camera parallax. */
  base: number;
  /** Peak height. */
  amp: number;
  /** Width of one triangular rise and fall. */
  step: number;
  parallaxX: number;
  parallaxY: number;
}

export interface BackdropDef {
  /** Top-to-bottom sky bands. */
  bands: string[];
  stars: { dust: number; near: number; bright: number };
  moon?: {
    x: number;
    y: number;
    radius: number;
    color: string;
    crater: string;
    glow: string;
  };
  layers: BackdropLayer[];
  /** Sparse wind-driven snow/dust streaks. */
  drift?: {
    color: string;
    count: number;
    speed: number;
    fall: number;
  };
}

export const backdrops = new Registry<BackdropDef>('backdrop');

export function defineBackdrop(id: string, def: BackdropDef): void {
  backdrops.register(id, def);
}

defineBackdrop('night', {
  bands: ['#080a18', '#0a0c1e', '#0c0f26', '#0e122c', '#101532', '#121838', '#141b3e'],
  stars: { dust: 340, near: 80, bright: 16 },
  moon: {
    x: 0.82, y: 0.18, radius: 17,
    color: '#e8e0c8', crater: '#d5cbae', glow: 'rgba(232,224,200,0.28)',
  },
  layers: [
    { color: '#101430', base: 228, amp: 82, step: 260, parallaxX: 0.08, parallaxY: 0.015 },
    { color: '#12173a', base: 236, amp: 68, step: 190, parallaxX: 0.16, parallaxY: 0.025 },
    { color: '#181e49', base: 246, amp: 52, step: 125, parallaxX: 0.35, parallaxY: 0.04 },
  ],
});

/**
 * The Riven: looking ACROSS a crack rather than out at a sky. No moon,
 * almost no stars — the few points of light are wet stone catching what
 * little there is. The far wall is drawn as receding cliff layers, so
 * depth reads sideways, and dust falls forever because in a crack it
 * always does.
 */
defineBackdrop('riven', {
  bands: ['#05070f', '#070a16', '#0a0f22', '#0d142c', '#101938', '#141f44', '#182450'],
  stars: { dust: 90, near: 14, bright: 3 },
  layers: [
    { color: '#0a1024', base: 118, amp: 96, step: 176, parallaxX: 0.06, parallaxY: 0.03 },
    { color: '#0f172f', base: 138, amp: 78, step: 118, parallaxX: 0.13, parallaxY: 0.05 },
    { color: '#14203f', base: 156, amp: 58, step: 74, parallaxX: 0.26, parallaxY: 0.075 },
    { color: '#1b2c53', base: 172, amp: 36, step: 46, parallaxX: 0.44, parallaxY: 0.1 },
  ],
  drift: {
    color: 'rgba(143,182,214,0.34)',
    count: 26,
    speed: 7,
    fall: 17,
  },
});

defineBackdrop('mountain-pass', {
  bands: ['#070b19', '#0b1124', '#101a31', '#16243b', '#1c3047', '#274157', '#35586b'],
  stars: { dust: 230, near: 48, bright: 9 },
  moon: {
    x: 0.72, y: 0.16, radius: 13,
    color: '#e8f2ef', crater: '#b8cfce', glow: 'rgba(193,232,231,0.3)',
  },
  layers: [
    { color: '#0c1428', base: 132, amp: 69, step: 154, parallaxX: 0.05, parallaxY: 0.035 },
    { color: '#111e34', base: 145, amp: 55, step: 104, parallaxX: 0.11, parallaxY: 0.055 },
    { color: '#172b40', base: 154, amp: 39, step: 68, parallaxX: 0.22, parallaxY: 0.08 },
    { color: '#203b4d', base: 162, amp: 25, step: 42, parallaxX: 0.38, parallaxY: 0.11 },
  ],
  drift: {
    color: 'rgba(220,241,238,0.46)',
    count: 34,
    speed: 21,
    fall: 5,
  },
});
