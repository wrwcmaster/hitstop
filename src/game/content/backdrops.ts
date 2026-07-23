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
