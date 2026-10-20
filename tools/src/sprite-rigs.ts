import { createReferenceReliefShape, type BakerRigDef } from './sprite-baker';
import type { SpriteFile } from '../../src/engine/gfx/spritefile';
import knightV2Raw from '../../src/game/content/sprites/knight-v2.json';

/**
 * Built-in 3D CSG & Skeletal Rigs for the Headless 3D-to-2D Toon/Pixel Baker.
 *
 * Authored at `hd: false` (4x sub-pixel density: 4 source pixels per logical
 * game pixel, matching `knight-v2.json`), with 5-stop material ramps,
 * multi-joint skeletal articulation, secondary follow-through motion, and
 * 3D bone sockets projected into `SpriteFile.anchors`.
 */

export const MOURN_RIG: BakerRigDef = {
  name: 'mourn',
  w: 44,
  h: 38,
  hd: false,
  origin: { x: 21, y: 34 },
  hitbox: { x: 5, y: 7, w: 34, h: 28 },
  cameraPitch: 10,
  lightDir: [-0.48, 0.68, 0.55],
  outlineColor: '#120d1d',
  outlineMode: 'outside',
  creaseThreshold: 1.4,
  rearShadeZ: -2.0,
  critic: {
    expectedAnims: ['listen', 'toll', 'pounce', 'fixate', 'keen'],
    expectedHitboxSize: { w: 34, h: 28 },
    groundedAnims: ['listen'],
  },
  materials: {
    bellBronze: {
      deepShadow: '#191426',
      shadow: '#27203a',
      mid: '#3e3556',
      lit: '#5a4e7a',
      highlight: '#8273a8',
      specular: 0.91,
    },
    bellRim: {
      deepShadow: '#191426',
      shadow: '#1f192e',
      mid: '#312945',
      lit: '#4b4066',
      highlight: '#6f6094',
      specular: 0.89,
    },
    verdigris: {
      deepShadow: '#1d3033',
      shadow: '#2b4749',
      mid: '#3f6a68',
      lit: '#5c948c',
      highlight: '#8cc4b8',
    },
    deadstoneKnot: {
      deepShadow: '#524969',
      shadow: '#73688f',
      mid: '#a195c2',
      lit: '#d2c7eb',
      highlight: '#f5f2ff',
      specular: 0.86,
    },
    listeningEar: {
      deepShadow: '#635120',
      shadow: '#8f7835',
      mid: '#c4a954',
      lit: '#ebd98a',
      highlight: '#fff9d6',
      specular: 0.84,
    },
  },
  bones: [
    {
      id: 'root',
      pos: [0, 0, 0],
    },
    {
      id: 'body',
      parent: 'root',
      pos: [0, 3, 0],
      partGroup: 'bellBody',
      shapes: [
        // Main hunched bell mantle (high-detail lathed 3D profile)
        {
          type: 'lathe',
          material: 'bellBronze',
          profile: [
            [0, 13.6],
            [1.6, 14.3],
            [3.8, 12.8],
            [7.5, 11.4],
            [11.5, 10.4],
            [15.5, 9.2],
            [19.0, 7.2],
            [21.5, 4.8],
            [23.2, 2.2],
          ],
        },
        // Heavy lower flaring lip ring
        {
          type: 'torus',
          material: 'bellRim',
          op: 'smoothUnion',
          blend: 0.7,
          offset: [0, 1.7, 0],
          radius: 13.1,
          tube: 1.9,
          axis: 'y',
        },
        // Lower waist decorative relief band
        {
          type: 'torus',
          material: 'bellRim',
          op: 'smoothUnion',
          blend: 0.45,
          offset: [0, 6.2, 0],
          radius: 11.4,
          tube: 0.95,
          axis: 'y',
        },
        // Mid waist filigree rib band
        {
          type: 'torus',
          material: 'bellRim',
          op: 'smoothUnion',
          blend: 0.45,
          offset: [0, 11.2, 0],
          radius: 10.2,
          tube: 0.95,
          axis: 'y',
        },
        // Verdigris weathered patina plates along the front mantle
        {
          type: 'capsule',
          material: 'verdigris',
          op: 'smoothUnion',
          blend: 0.35,
          a: [-4.8, 12.5, 8.8],
          b: [-5.6, 7.0, 10.2],
          radius: 1.15,
          radiusB: 0.75,
        },
        {
          type: 'capsule',
          material: 'verdigris',
          op: 'smoothUnion',
          blend: 0.35,
          a: [3.2, 11.8, 9.2],
          b: [4.0, 6.8, 10.5],
          radius: 1.05,
          radiusB: 0.7,
        },
        // Ornate tiered crown yoke & suspension loop
        {
          type: 'box',
          material: 'bellRim',
          op: 'union',
          offset: [-0.8, 22.4, 0],
          size: [4.2, 1.8, 3.0],
          bevel: 0.6,
        },
        {
          type: 'torus',
          material: 'listeningEar',
          op: 'union',
          offset: [-0.8, 24.0, 0],
          radius: 1.7,
          tube: 0.65,
          axis: 'z',
        },
      ],
    },
    {
      id: 'clapper',
      parent: 'body',
      pos: [0, 1.2, 2.4],
      partGroup: 'clapper',
      shapes: [
        {
          type: 'capsule',
          material: 'bellRim',
          a: [0, 3.5, 0],
          b: [0, 0, 0],
          radius: 1.1,
          radiusB: 1.4,
        },
        {
          type: 'sphere',
          material: 'listeningEar',
          offset: [0, -0.3, 0.4],
          radius: 2.5,
        },
      ],
    },
    {
      id: 'ear',
      parent: 'body',
      pos: [9.2, 11.4, 4.6],
      partGroup: 'ear',
      shapes: [
        // Brass mounting collar
        {
          type: 'torus',
          material: 'bellRim',
          offset: [-0.8, 0.2, -0.5],
          radius: 2.1,
          tube: 0.75,
          axis: 'x',
        },
        // Acoustic resonator horn on the leading flank
        {
          type: 'cylinder',
          material: 'listeningEar',
          a: [-1.5, 0, -1],
          b: [3.1, 0.8, 1.5],
          radius: 1.75,
          radiusB: 3.45,
        },
        // Outer golden trumpet flare rim
        {
          type: 'torus',
          material: 'listeningEar',
          op: 'smoothUnion',
          blend: 0.35,
          offset: [3.0, 0.8, 1.5],
          rot: [0, -25, 10],
          radius: 3.1,
          tube: 0.7,
          axis: 'x',
        },
        // Dark inner ear drum membrane
        {
          type: 'sphere',
          material: 'bellRim',
          offset: [3.1, 0.8, 1.6],
          radius: 1.95,
        },
      ],
    },
    {
      id: 'knots',
      parent: 'body',
      pos: [0, 0, 0],
      partGroup: 'knots',
      shapes: [
        {
          type: 'capsule',
          material: 'deadstoneKnot',
          a: [-7.8, 14.2, 4.0],
          b: [-9.2, 19.2, 4.6],
          radius: 1.85,
          radiusB: 1.1,
        },
        {
          type: 'capsule',
          material: 'deadstoneKnot',
          a: [-3.8, 16.2, 5.2],
          b: [-4.5, 21.4, 5.8],
          radius: 1.95,
          radiusB: 1.15,
        },
        {
          type: 'capsule',
          material: 'deadstoneKnot',
          a: [0.6, 16.5, 5.5],
          b: [1.0, 21.6, 6.0],
          radius: 1.95,
          radiusB: 1.15,
        },
        {
          type: 'capsule',
          material: 'deadstoneKnot',
          a: [4.6, 15.2, 4.8],
          b: [5.5, 19.8, 5.4],
          radius: 1.8,
          radiusB: 1.1,
        },
        {
          type: 'capsule',
          material: 'deadstoneKnot',
          a: [7.6, 13.4, 3.6],
          b: [8.8, 17.4, 4.2],
          radius: 1.65,
          radiusB: 1.0,
        },
      ],
    },
  ],
  sockets: {
    earTip: {
      bone: 'ear',
      pos: [2.8, 0.8, 1.5],
      dir: [1, 0.2, 0],
    },
  },
  anims: {
    listen: {
      fps: 6,
      frames: 6,
      pose(t) {
        const phase = t * Math.PI * 2;
        const wave = Math.sin(phase);
        const lag = Math.sin(phase - 0.9);
        return {
          body: {
            pos: [0, wave * 0.65, 0],
            rot: [0, wave * 5, -wave * 2.5],
          },
          ear: {
            rot: [0, wave * 10, lag * 7],
            scale: [1 + wave * 0.06, 1 + wave * 0.06, 1],
          },
          clapper: {
            pos: [-lag * 1.6, 0, 0],
            rot: [0, 0, -lag * 12],
          },
          knots: {
            pos: [0, lag * 0.35, 0],
          },
        };
      },
    },
    toll: {
      fps: 9,
      frames: 6,
      pose(_t, frame) {
        const yOff = [0.8, 2.4, 3.2, -2.0, -0.8, 0.2][frame] ?? 0;
        const tilt = [4, 10, 14, -9, -4, 1][frame] ?? 0;
        const clapperSwing = [-1.8, -3.6, -4.8, 4.4, 2.2, -0.6][frame] ?? 0;
        const earFlare = [1.0, 1.08, 1.14, 0.94, 1.04, 1.0][frame] ?? 1;
        return {
          body: {
            pos: [0, yOff, 0],
            rot: [0, tilt * 0.4, tilt],
          },
          clapper: {
            pos: [clapperSwing, -0.8, 0],
          },
          ear: {
            scale: [earFlare, earFlare, 1],
            rot: [0, 0, tilt * 0.6],
          },
          knots: {
            pos: [0, frame === 3 ? 0.9 : frame === 2 ? -0.4 : 0, 0],
          },
        };
      },
    },
    pounce: {
      fps: 9,
      frames: 4,
      pose(_t, frame) {
        const yOff = [-1.6, 1.8, 2.5, -1.0][frame] ?? 0;
        const rz = [-11, 10, 16, -7][frame] ?? 0;
        const clapperX = [2.2, -2.5, -3.5, 1.8][frame] ?? 0;
        return {
          body: {
            pos: [0, yOff, 0],
            rot: [0, 0, rz],
          },
          ear: {
            rot: [0, 0, rz * 0.6],
          },
          clapper: {
            pos: [clapperX, -0.5, 0],
          },
        };
      },
    },
    fixate: {
      fps: 6,
      frames: 4,
      pose(t) {
        const pulse = Math.sin(t * Math.PI * 2);
        const lean = -13 + pulse * 3.5;
        return {
          body: {
            pos: [1.0 + pulse * 0.4, 0.2, 0],
            rot: [0, 8 + pulse * 4, lean],
          },
          ear: {
            pos: [0.8, -1.6 + pulse * 0.5, 0],
            rot: [0, pulse * 8, lean - 6],
            scale: [1.08 + pulse * 0.05, 1.08 - pulse * 0.04, 1],
          },
          clapper: {
            pos: [1.5 - pulse * 1.0, -0.4, 0],
          },
        };
      },
    },
    keen: {
      fps: 8,
      frames: 4,
      pose(_t, frame) {
        const lift = [0.6, 1.6, 2.2, 1.1][frame] ?? 1;
        const tilt = [5, 11, 15, 8][frame] ?? 6;
        const clapperX = [-2.2, 2.6, -2.8, 2.0][frame] ?? 0;
        return {
          body: {
            pos: [0, lift, 0],
            rot: [0, 0, tilt],
          },
          ear: {
            rot: [0, 0, tilt + 8],
            scale: [1.1, 1.1, 1],
          },
          clapper: {
            pos: [clapperX, -0.6, 0],
          },
        };
      },
    },
  },
};

export const WALLCRAWLER_RIG: BakerRigDef = {
  name: 'wallcrawler',
  w: 24,
  h: 20,
  hd: false,
  origin: { x: 13, y: 16 },
  hitbox: { x: 5, y: 4, w: 14, h: 12 },
  cameraPitch: 6,
  lightDir: [-0.45, 0.7, 0.55],
  outlineColor: '#0e131f',
  outlineMode: 'outside',
  creaseThreshold: 1.1,
  rearShadeZ: -0.8,
  critic: {
    expectedAnims: ['climb', 'balk', 'lunge'],
    expectedHitboxSize: { w: 14, h: 12 },
    groundedAnims: [],
  },
  materials: {
    carapace: {
      deepShadow: '#162038',
      shadow: '#233354',
      mid: '#3b587d',
      lit: '#587da6',
      highlight: '#8cb4d9',
      specular: 0.9,
    },
    plateRidge: {
      deepShadow: '#1d2b47',
      shadow: '#2e4469',
      mid: '#4a6b94',
      lit: '#6f96c2',
      highlight: '#a9d1f5',
      specular: 0.88,
    },
    claws: {
      deepShadow: '#2a3d5c',
      shadow: '#3f5f85',
      mid: '#6389b3',
      lit: '#96bfe6',
      highlight: '#dff0ff',
      specular: 0.86,
    },
    eyes: {
      shadow: '#9e6b1b',
      mid: '#d99e32',
      lit: '#ffcb6b',
      highlight: '#fff8db',
      emissive: true,
    },
  },
  bones: [
    {
      id: 'body',
      pos: [0, 6, 0],
      partGroup: 'carapace',
      shapes: [
        // Main vaulted dorsal shell
        {
          type: 'ellipsoid',
          material: 'carapace',
          radii: [4.8, 4.6, 3.8],
        },
        // Overlapping thoracic chitin segments
        {
          type: 'box',
          material: 'plateRidge',
          op: 'smoothUnion',
          blend: 0.55,
          offset: [0.4, 2.1, 1.4],
          rot: [0, 0, -10],
          size: [3.2, 1.0, 2.5],
          bevel: 0.45,
        },
        {
          type: 'box',
          material: 'plateRidge',
          op: 'smoothUnion',
          blend: 0.55,
          offset: [0.8, 0.0, 1.6],
          size: [3.5, 1.1, 2.7],
          bevel: 0.45,
        },
        {
          type: 'box',
          material: 'plateRidge',
          op: 'smoothUnion',
          blend: 0.55,
          offset: [0.4, -2.1, 1.4],
          rot: [0, 0, 10],
          size: [3.2, 1.0, 2.5],
          bevel: 0.45,
        },
        // Serrated front mandibles facing +X into the shaft
        {
          type: 'capsule',
          material: 'claws',
          a: [3.2, 1.1, 1.6],
          b: [5.4, 0.5, 1.8],
          radius: 0.85,
          radiusB: 0.45,
        },
        {
          type: 'capsule',
          material: 'claws',
          a: [3.2, -1.1, 1.6],
          b: [5.4, -0.5, 1.8],
          radius: 0.85,
          radiusB: 0.45,
        },
        // Four cold amber compound eyes watching the shaft
        {
          type: 'sphere',
          material: 'eyes',
          offset: [3.6, 2.0, 2.3],
          radius: 1.05,
        },
        {
          type: 'sphere',
          material: 'eyes',
          offset: [4.1, 0.8, 2.6],
          radius: 0.85,
        },
        {
          type: 'sphere',
          material: 'eyes',
          offset: [4.1, -0.8, 2.6],
          radius: 0.85,
        },
        {
          type: 'sphere',
          material: 'eyes',
          offset: [3.6, -2.0, 2.3],
          radius: 1.05,
        },
      ],
    },
    {
      id: 'limbTop',
      parent: 'body',
      pos: [-1.0, 2.7, 1.2],
      partGroup: 'limbTop',
      shapes: [
        // Femur
        {
          type: 'capsule',
          material: 'plateRidge',
          a: [0, 0, 0],
          b: [-3.0, 1.8, 0.4],
          radius: 1.35,
          radiusB: 1.05,
        },
        // Hooked tibia claw gripping wall (-X)
        {
          type: 'capsule',
          material: 'claws',
          op: 'smoothUnion',
          blend: 0.3,
          a: [-3.0, 1.8, 0.4],
          b: [-5.6, 0.8, 0.5],
          radius: 1.05,
          radiusB: 0.65,
        },
      ],
    },
    {
      id: 'limbUpperMid',
      parent: 'body',
      pos: [-1.2, 0.9, -1.1],
      partGroup: 'limbUpperMid',
      shapes: [
        {
          type: 'capsule',
          material: 'plateRidge',
          a: [0, 0, 0],
          b: [-3.2, 0.9, -0.4],
          radius: 1.35,
          radiusB: 1.05,
        },
        {
          type: 'capsule',
          material: 'claws',
          op: 'smoothUnion',
          blend: 0.3,
          a: [-3.2, 0.9, -0.4],
          b: [-5.8, -0.1, -0.5],
          radius: 1.05,
          radiusB: 0.65,
        },
      ],
    },
    {
      id: 'limbLowerMid',
      parent: 'body',
      pos: [-1.2, -0.9, 1.2],
      partGroup: 'limbLowerMid',
      shapes: [
        {
          type: 'capsule',
          material: 'plateRidge',
          a: [0, 0, 0],
          b: [-3.2, -0.9, 0.4],
          radius: 1.35,
          radiusB: 1.05,
        },
        {
          type: 'capsule',
          material: 'claws',
          op: 'smoothUnion',
          blend: 0.3,
          a: [-3.2, -0.9, 0.4],
          b: [-5.8, 0.1, 0.5],
          radius: 1.05,
          radiusB: 0.65,
        },
      ],
    },
    {
      id: 'limbBottom',
      parent: 'body',
      pos: [-1.0, -2.7, -1.1],
      partGroup: 'limbBottom',
      shapes: [
        {
          type: 'capsule',
          material: 'plateRidge',
          a: [0, 0, 0],
          b: [-3.0, -1.8, -0.4],
          radius: 1.35,
          radiusB: 1.05,
        },
        {
          type: 'capsule',
          material: 'claws',
          op: 'smoothUnion',
          blend: 0.3,
          a: [-3.0, -1.8, -0.4],
          b: [-5.6, -0.8, -0.5],
          radius: 1.05,
          radiusB: 0.65,
        },
      ],
    },
  ],
  anims: {
    climb: {
      fps: 10,
      frames: 6,
      pose(t) {
        const phase = t * Math.PI * 2;
        const a = Math.sin(phase);
        const b = Math.cos(phase);
        return {
          body: { pos: [b * 0.3, a * 0.6, 0], rot: [0, a * 4, a * 5] },
          limbTop: { rot: [0, 0, a * 18] },
          limbUpperMid: { rot: [0, 0, -a * 18] },
          limbLowerMid: { rot: [0, 0, b * 18] },
          limbBottom: { rot: [0, 0, -b * 18] },
        };
      },
    },
    balk: {
      fps: 9,
      frames: 4,
      pose(_t, frame) {
        const splay = [14, 22, -8, -16][frame] ?? 0;
        const pullX = [0.6, 1.3, 0.9, 0.3][frame] ?? 0;
        return {
          body: { pos: [pullX, 0, 0], rot: [0, 0, -6 - frame * 2] },
          limbTop: { rot: [0, 0, splay] },
          limbUpperMid: { rot: [0, 0, -splay * 0.8] },
          limbLowerMid: { rot: [0, 0, splay * 0.8] },
          limbBottom: { rot: [0, 0, -splay] },
        };
      },
    },
    lunge: {
      fps: 12,
      frames: 4,
      pose(_t, frame) {
        const xOff = [-1.0, 1.6, 2.0, 0.4][frame] ?? 0;
        const sx = [0.9, 1.16, 1.12, 0.98][frame] ?? 1;
        const sy = [1.08, 0.88, 0.9, 1.02][frame] ?? 1;
        const sweep = [-16, 22, 26, 8][frame] ?? 0;
        return {
          body: { pos: [xOff, 0, 0], scale: [sx, sy, 1] },
          limbTop: { rot: [0, 0, sweep] },
          limbUpperMid: { rot: [0, 0, sweep * 0.65] },
          limbLowerMid: { rot: [0, 0, -sweep * 0.65] },
          limbBottom: { rot: [0, 0, -sweep] },
        };
      },
    },
  },
};

export const ADVENTURER_HUMANOID_RIG: BakerRigDef = {
  name: 'adventurer-poc',
  w: 40,
  h: 27.5,
  hd: false,
  origin: { x: 20, y: 26.5 },
  hitbox: { x: 14.25, y: 4, w: 8.5, h: 23.5 },
  editor: { canEquipWeapon: true },
  cameraPitch: 7,
  lightDir: [-0.48, 0.68, 0.55],
  outlineColor: '#020103',
  outlineMode: 'outside',
  creaseThreshold: 0.48,
  rearShadeZ: -1.45,
  critic: {
    expectedAnims: ['idle', 'run', 'air', 'rise', 'fall'],
    expectedHitboxSize: { w: 8.5, h: 23.5 },
    groundedAnims: ['idle', 'run'],
    allowBorderTouch: ['bottom'],
  },
  materials: {
    skin: {
      crease: '#3d221a',
      deepShadow: '#89523e',
      shadow: '#89523e',
      mid: '#b47757',
      lit: '#dc9e77',
      highlight: '#f4c89f',
      specular: 0.92,
    },
    hair: {
      crease: '#1f1116',
      deepShadow: '#3d221a',
      shadow: '#592d1b',
      mid: '#793c19',
      lit: '#9e5323',
      highlight: '#be692d',
    },
    eyeLash: {
      shadow: '#1f1116',
      mid: '#1f1116',
      lit: '#3d221a',
      emissive: true,
    },
    sclera: {
      shadow: '#e3ecee',
      mid: '#f3f7f5',
      lit: '#f3f7f5',
      highlight: '#f3f7f5',
      emissive: true,
    },
    eyeIris: {
      shadow: '#2d3f44',
      mid: '#48685f',
      lit: '#78a973',
      highlight: '#78a973',
      emissive: true,
    },
    jerkinLeather: {
      crease: '#1f1116',
      deepShadow: '#3d221a',
      shadow: '#592d1b',
      mid: '#793c19',
      lit: '#9e5323',
      highlight: '#be692d',
    },
    trousersDark: {
      crease: '#131d29',
      deepShadow: '#1b1e23',
      shadow: '#2a292a',
      mid: '#3c3c3d',
      lit: '#535b5d',
      highlight: '#6a7676',
    },
    scarfTeal: {
      crease: '#10111c',
      deepShadow: '#22272f',
      shadow: '#30363a',
      mid: '#40464b',
      lit: '#535b5d',
      highlight: '#6a7676',
    },
    boots: {
      crease: '#1f1116',
      deepShadow: '#3d221a',
      shadow: '#592d1b',
      mid: '#793c19',
      lit: '#9e5323',
      highlight: '#be692d',
    },
    beltGold: {
      crease: '#1f1116',
      deepShadow: '#3d221a',
      shadow: '#793c19',
      mid: '#9e5323',
      lit: '#be692d',
      highlight: '#f4c89f',
    },
  },
  bones: [
    {
      id: 'root',
      pos: [0, 0, 0],
      partGroup: 'reliefBody',
      shapes: [
        createReferenceReliefShape(
          knightV2Raw as unknown as SpriteFile,
          'jerkinLeather',
          ['idle', 'run', 'rise', 'fall'],
          [80, 106],
          7,
        ),
      ],
    },
    {
      id: 'pelvis',
      parent: 'root',
      pos: [0.25, 10.55, 0],
      partGroup: 'tunicHem',
      shapes: [
        // Flared brown leather tunic skirt / peplum overhanging dark trousers with diagonal pleats
        {
          type: 'box',
          material: 'jerkinLeather',
          partGroup: 'tunicHem',
          offset: [-0.35, 0.35, 0],
          size: [2.25, 0.92, 1.68],
          bevel: 0.28,
          folds: { freq: 2.6, amp: 0.22, axis: 'xy' },
        },
      ],
    },
    {
      id: 'torso',
      parent: 'pelvis',
      pos: [0, 3.65, 0],
      partGroup: 'torso',
      shapes: [
        // Fitted athletic brown leather chest jerkin with diagonal cloth folds
        {
          type: 'capsule',
          material: 'jerkinLeather',
          partGroup: 'torso',
          a: [0, 0.75, 0],
          b: [0, -1.85, 0],
          radius: 1.82,
          radiusB: 1.48,
          folds: { freq: 2.4, amp: 0.22, axis: 'yx' },
        },
        // Lower diagonal teal scarf fold sweeping from left shoulder down-right across chest
        {
          type: 'capsule',
          material: 'scarfTeal',
          partGroup: 'scarfLower',
          a: [-2.45, 2.05, 0.95],
          via: [-0.05, 1.25, 1.78],
          b: [2.15, 0.95, 1.05],
          radius: 0.88,
          radiusB: 0.76,
          folds: { freq: 2.2, amp: 0.2, axis: 'xy' },
        },
        // Upper diagonal neck collar scarf fold tucked cleanly under the chin
        {
          type: 'capsule',
          material: 'scarfTeal',
          partGroup: 'scarfUpper',
          a: [-2.25, 2.75, 0.85],
          via: [0.05, 2.05, 1.65],
          b: [2.05, 1.72, 0.92],
          radius: 0.86,
          radiusB: 0.74,
          folds: { freq: 2.2, amp: 0.2, axis: 'yx' },
        },
      ],
    },
    {
      id: 'scarfBase',
      parent: 'torso',
      pos: [-1.85, 1.75, -0.65],
      partGroup: 'scarfUpper',
      shapes: [
        // Upper flowing scarf ribbon (scoops down-left from collar and flicks horizontally at tip)
        {
          type: 'capsule',
          material: 'scarfTeal',
          partGroup: 'scarfUpper',
          a: [0.35, 0.2, 0.05],
          via: [-1.55, -0.25, -0.1],
          b: [-3.45, 0.25, -0.2],
          radius: 0.68,
          radiusB: 0.44,
          folds: { freq: 2.4, amp: 0.2, axis: 'xy' },
        },
        // Lower secondary scarf ribbon (separated below upper ribbon to form forked V-gap)
        {
          type: 'capsule',
          material: 'scarfTeal',
          partGroup: 'scarfLower',
          a: [0.25, -0.2, 0.2],
          via: [-1.45, -1.05, 0.15],
          b: [-3.35, -1.85, 0.1],
          radius: 0.64,
          radiusB: 0.38,
          folds: { freq: 2.4, amp: 0.2, axis: 'yx' },
        },
      ],
    },
    {
      id: 'scarfTip',
      parent: 'scarfBase',
      pos: [-3.15, 0.25, -0.2],
      partGroup: 'scarfUpper',
      shapes: [
        {
          type: 'capsule',
          material: 'scarfTeal',
          partGroup: 'scarfUpper',
          a: [0, 0, 0],
          via: [-0.95, 0.05, -0.1],
          b: [-1.85, 0.15, -0.2],
          radius: 0.46,
          radiusB: 0.28,
          folds: { freq: 2.4, amp: 0.18, axis: 'x' },
        },
      ],
    },
    {
      id: 'head',
      parent: 'torso',
      pos: [0.15, 6.15, 0.65],
      partGroup: 'face',
      shapes: [
        // Compact upright anime/pixel head & jawline matching knight-v2 (unified 'face' partGroup so no chin seam)
        {
          type: 'ellipsoid',
          material: 'skin',
          partGroup: 'face',
          offset: [0.1, -0.35, 0],
          radii: [2.18, 2.45, 2.25],
        },
        // Subtle 3/4 anime jawline & cheek plane (smoothly blended into face)
        {
          type: 'box',
          material: 'skin',
          partGroup: 'face',
          op: 'smoothUnion',
          blend: 0.55,
          offset: [0.85, -0.58, 1.05],
          rot: [0, 0, -6],
          size: [0.92, 0.82, 1.05],
          bevel: 0.38,
        },
        // Ear (tucked on left side of face behind temple lock)
        {
          type: 'sphere',
          material: 'skin',
          partGroup: 'ear',
          offset: [-1.05, -0.22, 1.95],
          radius: 0.62,
        },
        // Dark horizontal upper eyelash/brow arch directly over the eye
        {
          type: 'box',
          material: 'eyeLash',
          partGroup: 'eyeLash',
          offset: [1.05, 0.52, 2.12],
          size: [0.64, 0.16, 0.48],
          bevel: 0.03,
        },
        // Crisp vertical pixel eye: white sclera on left + emerald green iris on right
        {
          type: 'box',
          material: 'sclera',
          partGroup: 'eyeSclera',
          offset: [0.74, 0.02, 2.02],
          size: [0.32, 0.48, 0.48],
          bevel: 0.03,
        },
        {
          type: 'box',
          material: 'eyeIris',
          partGroup: 'eyeIris',
          offset: [1.26, 0.02, 2.08],
          size: [0.34, 0.48, 0.48],
          bevel: 0.03,
        },
        // Base hair crown volume with strand fold modulation
        {
          type: 'ellipsoid',
          material: 'hair',
          partGroup: 'hairCrown',
          offset: [-0.45, 1.55, -0.1],
          radii: [2.75, 2.15, 2.65],
          folds: { freq: 2.5, amp: 0.26, axis: 'xy' },
        },
        // Signature tall top-center spiky tuft sweeping up-right (knight-v2 crown spike)
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairTopSpike',
          a: [-0.05, 2.45, 0.25],
          via: [0.45, 3.75, 0.35],
          b: [1.15, 4.65, 0.35],
          radius: 1.08,
          radiusB: 0.32,
          folds: { freq: 2.4, amp: 0.2, axis: 'x' },
        },
        // Tall upper-left spiky tuft sweeping up-left
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairLeftUpper',
          a: [-0.95, 2.35, 0.05],
          via: [-1.85, 3.55, 0.0],
          b: [-2.85, 4.35, -0.1],
          radius: 1.12,
          radiusB: 0.32,
          folds: { freq: 2.4, amp: 0.2, axis: 'xy' },
        },
        // Rear-upper swept spike (creates sharp triangular notch on left silhouette)
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairLeftMid',
          a: [-1.55, 1.75, -0.05],
          via: [-3.05, 2.35, -0.15],
          b: [-4.55, 2.65, -0.25],
          radius: 1.15,
          radiusB: 0.32,
          folds: { freq: 2.2, amp: 0.2, axis: 'y' },
        },
        // Rear-mid swept spike pointing outward-left
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairLeftLower',
          a: [-1.75, 0.75, -0.1],
          via: [-3.25, 0.85, -0.2],
          b: [-4.75, 0.65, -0.3],
          radius: 1.15,
          radiusB: 0.32,
          folds: { freq: 2.2, amp: 0.2, axis: 'y' },
        },
        // Lower nape swept spike above scarf
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairNape',
          a: [-1.65, -0.25, -0.15],
          via: [-2.85, -0.65, -0.25],
          b: [-4.05, -1.25, -0.35],
          radius: 1.02,
          radiusB: 0.32,
          folds: { freq: 2.2, amp: 0.18, axis: 'xy' },
        },
        // Front-right upper brow spike sweeping out to the right
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairRightUpper',
          a: [0.55, 2.35, 1.25],
          via: [2.15, 2.25, 1.55],
          b: [3.65, 1.75, 1.75],
          radius: 1.05,
          radiusB: 0.32,
          folds: { freq: 2.4, amp: 0.2, axis: 'yx' },
        },
        // Front-right lower bang spike framing the upper-right brow
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairRightLower',
          a: [1.15, 1.75, 1.55],
          via: [2.05, 1.15, 1.85],
          b: [2.65, 0.52, 1.98],
          radius: 0.78,
          radiusB: 0.3,
          folds: { freq: 2.6, amp: 0.2, axis: 'xy' },
        },
        // Central brow bang lock dipping diagonally to top of brow
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairBangs',
          a: [-0.05, 2.05, 1.85],
          via: [0.42, 1.32, 2.08],
          b: [0.62, 0.72, 2.14],
          radius: 0.78,
          radiusB: 0.34,
          folds: { freq: 2.6, amp: 0.22, axis: 'x' },
        },
        // Temple / sideburn lock framing the cheek between ear and eye
        {
          type: 'capsule',
          material: 'hair',
          partGroup: 'hairSide',
          a: [-0.52, 1.35, 1.92],
          via: [-0.42, 0.35, 2.08],
          b: [-0.38, -0.52, 1.98],
          radius: 0.62,
          radiusB: 0.3,
          folds: { freq: 2.4, amp: 0.18, axis: 'y' },
        },
      ],
    },
    {
      id: 'armFront',
      parent: 'torso',
      pos: [-2.15, 1.65, 1.25],
      partGroup: 'armFront',
      shapes: [
        // Neutral vertical bare muscular shoulder & bicep (rotated by idle/run poses)
        {
          type: 'capsule',
          material: 'skin',
          partGroup: 'armFront',
          a: [0, 0, 0],
          via: [-0.08, -1.35, 0.1],
          b: [0, -2.65, 0.15],
          radius: 1.04,
          radiusB: 0.9,
        },
      ],
    },
    {
      id: 'forearmFront',
      parent: 'armFront',
      pos: [0, -2.65, 0.15],
      partGroup: 'gauntletBodyF',
      shapes: [
        // Wide flared brown leather gauntlet cuff at forearm top
        {
          type: 'box',
          material: 'jerkinLeather',
          partGroup: 'gauntletCuffF',
          offset: [0, -0.25, 0.05],
          size: [1.06, 0.42, 1.0],
          bevel: 0.16,
          folds: { freq: 2.8, amp: 0.18, axis: 'x' },
        },
        // Fitted fingerless brown leather gauntlet body & metacarpal back-plate
        {
          type: 'capsule',
          material: 'boots',
          partGroup: 'gauntletBodyF',
          a: [0, -0.45, 0.06],
          b: [0, -2.02, 0.15],
          radius: 0.98,
          radiusB: 0.84,
          folds: { freq: 2.6, amp: 0.2, axis: 'yx' },
        },
        // Articulated thumb wrap across upper-front edge of clenched fist (smoothly blended)
        {
          type: 'box',
          material: 'skin',
          partGroup: 'fingersF',
          offset: [0.38, -2.18, 0.34],
          size: [0.36, 0.28, 0.36],
          bevel: 0.12,
        },
        // Sculpted curled knuckle row peeking from bottom-front of fingerless glove
        {
          type: 'box',
          material: 'skin',
          partGroup: 'fingersF',
          op: 'smoothUnion',
          blend: 0.22,
          offset: [0.18, -2.48, 0.22],
          size: [0.64, 0.42, 0.54],
          bevel: 0.18,
          folds: { freq: 3.6, amp: 0.22, axis: 'x' },
        },
      ],
    },
    {
      id: 'armRear',
      parent: 'torso',
      pos: [2.05, 1.55, -0.55],
      partGroup: 'armRear',
      shapes: [
        // Neutral vertical bare muscular shoulder & bicep on rear/right side
        {
          type: 'capsule',
          material: 'skin',
          partGroup: 'armRear',
          a: [0, 0, 0],
          via: [0.08, -1.3, 0.05],
          b: [0, -2.55, 0.1],
          radius: 0.98,
          radiusB: 0.86,
        },
      ],
    },
    {
      id: 'forearmRear',
      parent: 'armRear',
      pos: [0, -2.55, 0.1],
      partGroup: 'gauntletBodyR',
      shapes: [
        // Flared brown leather gauntlet cuff on rear arm
        {
          type: 'box',
          material: 'jerkinLeather',
          partGroup: 'gauntletCuffR',
          offset: [0, -0.25, 0.05],
          size: [1.02, 0.4, 0.96],
          bevel: 0.16,
          folds: { freq: 2.8, amp: 0.18, axis: 'x' },
        },
        // Fingerless leather glove body & back-plate along -Y
        {
          type: 'capsule',
          material: 'boots',
          partGroup: 'gauntletBodyR',
          a: [0, -0.45, 0.05],
          b: [0, -1.98, 0.1],
          radius: 0.92,
          radiusB: 0.8,
          folds: { freq: 2.6, amp: 0.2, axis: 'yx' },
        },
        // Articulated thumb wrap on rear hand
        {
          type: 'box',
          material: 'skin',
          partGroup: 'fingersR',
          offset: [0.34, -2.14, 0.28],
          size: [0.34, 0.26, 0.34],
          bevel: 0.12,
        },
        // Sculpted curled knuckle row on rear hand
        {
          type: 'box',
          material: 'skin',
          partGroup: 'fingersR',
          op: 'smoothUnion',
          blend: 0.22,
          offset: [0.16, -2.42, 0.18],
          size: [0.6, 0.4, 0.5],
          bevel: 0.18,
          folds: { freq: 3.6, amp: 0.22, axis: 'x' },
        },
      ],
    },
    {
      id: 'legFront',
      parent: 'pelvis',
      pos: [-1.05, -0.45, 0.75],
      partGroup: 'thighFront',
      shapes: [
        // Neutral vertical dark cloth thigh (rotated into A-stance in idle and full stride in run)
        {
          type: 'capsule',
          material: 'trousersDark',
          partGroup: 'thighFront',
          a: [0, 0, 0],
          via: [0.08, -2.35, 0.05],
          b: [0, -4.65, 0],
          radius: 1.28,
          radiusB: 1.06,
          folds: { freq: 2.4, amp: 0.24, axis: 'yx' },
        },
      ],
    },
    {
      id: 'shinFront',
      parent: 'legFront',
      pos: [0, -4.65, 0],
      partGroup: 'bootShaftF',
      shapes: [
        // Upper calf dark trousers segment below knee pivot so bent knees stay dark trousers
        {
          type: 'capsule',
          material: 'trousersDark',
          partGroup: 'thighFront',
          a: [0, 0, 0],
          b: [0, -0.95, 0],
          radius: 1.04,
          radiusB: 0.98,
          folds: { freq: 2.4, amp: 0.22, axis: 'xy' },
        },
        // Flared brown leather boot cuff at mid-calf
        {
          type: 'box',
          material: 'jerkinLeather',
          partGroup: 'bootCuffF',
          offset: [0, -1.05, 0.05],
          size: [1.14, 0.44, 1.06],
          bevel: 0.18,
          folds: { freq: 2.6, amp: 0.16, axis: 'x' },
        },
        // Neutral vertical brown leather boot shin shaft
        {
          type: 'capsule',
          material: 'boots',
          partGroup: 'bootShaftF',
          a: [0, -1.25, 0],
          b: [0, -4.25, 0],
          radius: 1.06,
          radiusB: 0.96,
          folds: { freq: 2.2, amp: 0.18, axis: 'y' },
        },
        // Forward-pointing (+X) sculpted boot vamp, heel & toe cap
        {
          type: 'box',
          material: 'boots',
          partGroup: 'bootFootF',
          offset: [0.42, -4.45, 0.05],
          size: [1.28, 0.74, 1.0],
          bevel: 0.26,
        },
      ],
    },
    {
      id: 'legRear',
      parent: 'pelvis',
      pos: [1.1, -0.45, -0.65],
      partGroup: 'thighRear',
      shapes: [
        // Neutral vertical dark cloth thigh on rear/right leg
        {
          type: 'capsule',
          material: 'trousersDark',
          partGroup: 'thighRear',
          a: [0, 0, 0],
          via: [0.08, -2.35, -0.05],
          b: [0, -4.65, 0],
          radius: 1.24,
          radiusB: 1.02,
          folds: { freq: 2.4, amp: 0.24, axis: 'yx' },
        },
      ],
    },
    {
      id: 'shinRear',
      parent: 'legRear',
      pos: [0, -4.65, 0],
      partGroup: 'bootShaftR',
      shapes: [
        // Upper calf dark trousers segment below knee pivot so bent knees stay dark trousers
        {
          type: 'capsule',
          material: 'trousersDark',
          partGroup: 'thighRear',
          a: [0, 0, 0],
          b: [0, -0.95, 0],
          radius: 1.0,
          radiusB: 0.94,
          folds: { freq: 2.4, amp: 0.22, axis: 'xy' },
        },
        // Flared brown leather boot cuff on right leg at mid-calf
        {
          type: 'box',
          material: 'jerkinLeather',
          partGroup: 'bootCuffR',
          offset: [0, -1.05, 0.02],
          size: [1.12, 0.42, 1.02],
          bevel: 0.18,
          folds: { freq: 2.6, amp: 0.16, axis: 'x' },
        },
        {
          type: 'capsule',
          material: 'boots',
          partGroup: 'bootShaftR',
          a: [0, -1.25, 0],
          b: [0, -4.25, 0],
          radius: 1.04,
          radiusB: 0.94,
          folds: { freq: 2.2, amp: 0.18, axis: 'y' },
        },
        // Forward-pointing (+X) sculpted boot vamp, heel & toe cap
        {
          type: 'box',
          material: 'boots',
          partGroup: 'bootFootR',
          offset: [0.52, -4.45, 0],
          size: [1.36, 0.74, 0.98],
          bevel: 0.26,
        },
      ],
    },
  ],
  sockets: {
    frontHand: {
      bone: 'forearmFront',
      pos: [0.22, -2.45, 0.22],
      dir: [1, -0.2, 0],
    },
    rearHand: {
      bone: 'forearmRear',
      pos: [0.18, -2.4, 0.16],
      dir: [1, -0.2, 0],
    },
    head: {
      bone: 'head',
      pos: [0.85, 2.35, 0],
    },
  },
  attachmentSlots: {
    mainHand: { anchor: 'frontHand' },
    offHand: { anchor: 'rearHand' },
    head: { anchor: 'head' },
  },
  anims: {
    idle: {
      fps: 4,
      frames: 5,
      pose(_t, frame) {
        // Exact 5-frame breathing & scarf-breeze cycle measured from knight-v2.json
        const chestDrop = [0, -0.22, -0.28, -0.1, 0][frame] ?? 0;
        const fHandDx   = [0, 2, -2, -2, 0][frame] ?? 0;
        const scarfPuff = [18, 16, 8, 16, 14][frame] ?? 16;
        const scarfLen  = [0.38, 0.38, 0.56, 0.40, 0.42][frame] ?? 0.38;
        return {
          torso: { pos: [0, chestDrop, 0] },
          head: { pos: [0.15, -0.15 - chestDrop * 0.5, 0] },
          scarfBase: {
            pos: [1.05, -0.15, 0],
            rot: [0, 0, scarfPuff],
            scale: [scarfLen, 0.52, 0.7],
          },
          scarfTip: {
            rot: [0, 0, scarfPuff + 8],
            scale: [scarfLen, 0.45, 0.7],
          },
          // Heroic 3/4 A-frame arm framing matching knight-v2.json anchors:
          // frontHand -> [-3.0, 10.0], rearHand -> [+3.88, 11.75]
          armFront: { pos: [0, -0.25, 0], rot: [0, 0, -18 + fHandDx] },
          forearmFront: { rot: [0, 0, 22] },
          armRear: { pos: [-0.2, -0.15, 0], rot: [0, 0, 16] },
          forearmRear: { rot: [0, 0, 14] },
          // Heroic 3/4 A-frame leg stance with both boots planted and toes angled right (+X)
          legFront: { rot: [0, 0, -10] },
          shinFront: { rot: [0, 0, 2] },
          legRear: { rot: [0, 0, 12] },
          shinRear: { rot: [0, 0, -4] },
        };
      },
    },
    run: {
      fps: 10,
      frames: 8,
      pose(_t, frame) {
        const f = frame % 8;
        // 8-keyframe biomechanical running cycle matched frame-for-frame to knight-v2.json (F0..F7):
        // Note: pelvis.rz = -3°, so world thigh = THIGH - 3°, world shin = THIGH + KNEE - 3°
        const THIGH_R = [36, 42, 25, -6, -34, -38, -34, 46];
        const KNEE_R  = [-28, -8, -22, -8, -10, -48, -54, -132];
        const HIP_XR  = [0.2, 0.3, 0.1, -0.2, -0.4, -0.4, -0.3, -0.35];
        const HIP_YR  = [0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.4, 0.55];

        const THIGH_F = [-38, -38, -34, 44, 48, 42, 25, -4];
        const KNEE_F  = [-32, -48, -54, -122, -72, -8, -22, -6];
        const HIP_XF  = [-0.4, -0.4, -0.3, -0.35, 0.2, 0.3, 0.1, -0.2];
        const HIP_YF  = [0.0, 0.2, 0.4, 0.55, 0.65, 0.0, 0.0, 0.0];
        // When shinFront folds back behind thighFront (F2, F3), shift its Z so thighFront and legRear stay in front!
        const SHIN_F_Z = [-0.2, -0.35, -0.55, -1.55, 0.0, 0.0, 0.0, 0.0];

        // 8-keyframe biomechanical arm swing matched to knight-v2.json:
        // F0,F1: armFront swings back with elbow bent down (-46° shoulder, +44° elbow); armRear punches forward
        // F2: armFront swings down along side (-14° shoulder, +22° elbow); armRear holds forward punch
        // F3,F7: armFront hangs down with forearm across waist (-4° shoulder, +48° elbow); armRear tucked behind chest
        // F4,F5,F6: armFront upper arm angles down-right (+32°..+38°) in center of torso while gauntlet bends horizontally across chest to dx=+5.5; armRear stays occluded behind torso!
        const SHOULDER_F  = [-46, -46, -14, -4, 32, 38, 32, -4];
        const ELBOW_F     = [44,  44,  22,  48, 66, 70, 66, 48];
        const SHOULDER_FX = [-0.55, -0.55, -0.25, 0.0, 0.35, 0.45, 0.35, 0.0];
        const FOREARM_FSY = [1.0, 1.0, 1.0, 1.0, 1.28, 1.32, 1.28, 1.0];

        const SHOULDER_R  = [44, 44, 34, 8, -14, -14, -10, 8];
        const ELBOW_R     = [64, 64, 54, 44, 24, 24,  20,  44];
        const SHOULDER_RX = [1.15, 1.15, 0.95, 0.0, -0.15, -0.15, -0.15, 0.0];
        const FOREARM_RSY = [1.28, 1.32, 1.24, 1.0, 1.0, 1.0, 1.0, 1.0];

        // Pelvis vertical bounce (keeps head consistently at h=23..19 across all 8 frames like knight-v2)
        const PELVIS_Y = [0.0, 0.2, -0.25, -0.35, 0.0, 0.2, -0.25, -0.35];
        // Positive rz counter-rotates the -9° spine lean so the scarf streams horizontally behind the shoulder
        const SCARF_BASE_Z = [22, 18, 12, 14, 16, 18, 12, 14];
        const SCARF_TIP_Z  = [6, 8, 4, 6, 6, 8, 4, 6];

        return {
          pelvis: { pos: [0.1, PELVIS_Y[f], 0], rot: [0, 0, -3] },
          torso: { pos: [0.15, -0.1, 0], rot: [0, 0, -6] },
          head: { pos: [0.2, -0.15 - PELVIS_Y[f] * 0.5, 0], rot: [0, 0, 9] },
          // Scarf unfurls and streams horizontally behind the neck (-X)
          scarfBase: { pos: [-0.1, 0.15, 0], rot: [0, 0, SCARF_BASE_Z[f]] },
          scarfTip: { rot: [0, 0, SCARF_TIP_Z[f]] },
          // Align hips onto the side-profile sprint centerline:
          // legRear leads on F0..F3, legFront leads on F4..F7
          legRear: { pos: [-1.1 + HIP_XR[f], HIP_YR[f], 0], rot: [0, 0, THIGH_R[f]] },
          shinRear: { rot: [0, 0, KNEE_R[f]] },
          legFront: { pos: [1.05 + HIP_XF[f], HIP_YF[f], 0], rot: [0, 0, THIGH_F[f]] },
          shinFront: { pos: [0, 0, SHIN_F_Z[f]], rot: [0, 0, KNEE_F[f]] },
          // Align shoulders onto sprint centerline
          armFront: { pos: [1.55 + SHOULDER_FX[f], -0.35, 0.25], rot: [0, 0, SHOULDER_F[f]] },
          forearmFront: { rot: [0, 0, ELBOW_F[f]], scale: [1, FOREARM_FSY[f], 1] },
          armRear: { pos: [-2.05 + SHOULDER_RX[f], -0.25, -0.35], rot: [0, 0, SHOULDER_R[f]] },
          forearmRear: { rot: [0, 0, ELBOW_R[f]], scale: [1, FOREARM_RSY[f], 1] },
        };
      },
    },
    air: {
      fps: 1,
      frames: 1,
      aliasOf: 'idle',
    },
    rise: {
      fps: 8,
      frames: 2,
      loop: false,
      pose(_t, frame) {
        return {
          pelvis: { pos: [0.1, 0.75, 0], rot: [0, 0, -3] },
          torso: { pos: [0.15, -0.1, 0], rot: [0, 0, -6] },
          head: { pos: [0.2, -0.15, 0], rot: [0, 0, 9] },
          scarfBase: { pos: [-0.1, 0.15, 0], rot: [0, 0, 18 + frame * 4] },
          scarfTip: { rot: [0, 0, 6 + frame * 2] },
          legFront: { pos: [0.85, 0.4, 0], rot: [0, 0, 48] },
          shinFront: { rot: [0, 0, -72] },
          legRear: { pos: [-0.9, 0, 0], rot: [0, 0, -34] },
          shinRear: { rot: [0, 0, -10] },
          armFront: { pos: [1.0, -0.35, 0.25], rot: [0, 0, -46] },
          forearmFront: { rot: [0, 0, 44] },
          armRear: { pos: [-0.9, -0.25, -0.35], rot: [0, 0, 44] },
          forearmRear: { rot: [0, 0, 64], scale: [1, 1.28, 1] },
        };
      },
    },
    fall: {
      fps: 8,
      frames: 2,
      loop: false,
      pose(_t, frame) {
        return {
          pelvis: { pos: [0.1, 0.0, 0], rot: [0, 0, -3] },
          torso: { pos: [0.15, -0.1, 0], rot: [0, 0, -6] },
          head: { pos: [0.2, -0.15, 0], rot: [0, 0, 9] },
          scarfBase: { pos: [-0.1, 0.15, 0], rot: [0, 0, 22 - frame * 4] },
          scarfTip: { rot: [0, 0, 6 + frame * 2] },
          legFront: { pos: [0.65, 0, 0], rot: [0, 0, -38] },
          shinFront: { rot: [0, 0, -32] },
          legRear: { pos: [-0.9, 0, 0], rot: [0, 0, 36] },
          shinRear: { rot: [0, 0, -28] },
          armFront: { pos: [1.0, -0.35, 0.25], rot: [0, 0, -46] },
          forearmFront: { rot: [0, 0, 44] },
          armRear: { pos: [-0.9, -0.25, -0.35], rot: [0, 0, 44] },
          forearmRear: { rot: [0, 0, 64], scale: [1, 1.28, 1] },
        };
      },
    },
  },
};

export const DUMMY_RIG: BakerRigDef = {
  name: 'dummy',
  w: 20,
  h: 26,
  hd: false,
  origin: { x: 10, y: 23 },
  hitbox: { x: 4, y: 3, w: 12, h: 20 },
  cameraPitch: 8,
  lightDir: [-0.45, 0.7, 0.55],
  outlineColor: '#12131c',
  outlineMode: 'outside',
  creaseThreshold: 1.2,
  rearShadeZ: -1.5,
  critic: {
    expectedAnims: ['idle'],
    expectedHitboxSize: { w: 12, h: 20 },
    groundedAnims: ['idle'],
  },
  materials: {
    woodPost: {
      deepShadow: '#1c202e',
      shadow: '#282f44',
      mid: '#3d4869',
      lit: '#5d6d8e',
      highlight: '#8fa0ba',
    },
    strawCoat: {
      deepShadow: '#3d2314',
      shadow: '#593620',
      mid: '#7d512d',
      lit: '#a66f40',
      highlight: '#cf985f',
    },
    burlapGold: {
      deepShadow: '#6b4812',
      shadow: '#8f631d',
      mid: '#ba882f',
      lit: '#e3b34b',
      highlight: '#ffe89e',
    },
    targetRed: {
      deepShadow: '#42151e',
      shadow: '#66202d',
      mid: '#963040',
      lit: '#c44958',
      highlight: '#eb7885',
    },
    stitchDark: {
      shadow: '#090a10',
      mid: '#151824',
      lit: '#262b3d',
    },
  },
  bones: [
    {
      id: 'post',
      pos: [0, 0, 0],
      partGroup: 'post',
      shapes: [
        // Vertical timber stake planted into the ground
        {
          type: 'cylinder',
          material: 'woodPost',
          a: [0, 0.2, 0],
          b: [0, 15.2, 0],
          radius: 1.65,
          radiusB: 1.45,
        },
        // Heavy iron/timber ground base cross-brace
        {
          type: 'box',
          material: 'woodPost',
          offset: [0, 0.9, 0],
          size: [3.1, 0.85, 2.2],
          bevel: 0.3,
        },
        // Crossbar training arms
        {
          type: 'cylinder',
          material: 'woodPost',
          a: [-5.3, 11.8, 0],
          b: [5.3, 11.8, 0],
          radius: 1.35,
          radiusB: 1.35,
        },
      ],
    },
    {
      id: 'torso',
      parent: 'post',
      pos: [0, 10.6, 0.3],
      partGroup: 'torso',
      shapes: [
        // Padded straw training vest
        {
          type: 'ellipsoid',
          material: 'strawCoat',
          radii: [3.6, 3.9, 2.9],
        },
        // Painted crimson target ring on chest
        {
          type: 'torus',
          material: 'targetRed',
          offset: [0.5, 0.3, 2.1],
          radius: 1.65,
          tube: 0.55,
          axis: 'z',
        },
        {
          type: 'sphere',
          material: 'burlapGold',
          offset: [0.5, 0.3, 2.35],
          radius: 0.8,
        },
        // Rope waist lashing
        {
          type: 'torus',
          material: 'burlapGold',
          offset: [0, -1.8, 0],
          radius: 2.75,
          tube: 0.75,
          axis: 'y',
        },
        // Bound straw shoulder bundles
        {
          type: 'sphere',
          material: 'burlapGold',
          offset: [-4.2, 1.2, 0],
          radius: 1.45,
        },
        {
          type: 'sphere',
          material: 'burlapGold',
          offset: [4.2, 1.2, 0],
          radius: 1.45,
        },
      ],
    },
    {
      id: 'head',
      parent: 'torso',
      pos: [0, 5.4, 0.2],
      partGroup: 'head',
      shapes: [
        // Stitched burlap sack head
        {
          type: 'ellipsoid',
          material: 'burlapGold',
          offset: [0, 0.5, 0],
          radii: [3.25, 3.15, 2.85],
        },
        // Neck rope tie
        {
          type: 'torus',
          material: 'strawCoat',
          offset: [0, -1.7, 0],
          radius: 1.9,
          tube: 0.55,
          axis: 'y',
        },
        // Button / cross-stitch eyes & stitched mouth seam
        {
          type: 'sphere',
          material: 'stitchDark',
          offset: [1.55, 0.75, 2.35],
          radius: 0.9,
        },
        {
          type: 'sphere',
          material: 'stitchDark',
          offset: [-0.75, 0.75, 2.45],
          radius: 0.9,
        },
        {
          type: 'capsule',
          material: 'stitchDark',
          a: [-0.6, -0.7, 2.45],
          b: [1.4, -0.6, 2.35],
          radius: 0.42,
          radiusB: 0.42,
        },
      ],
    },
  ],
  anims: {
    idle: {
      fps: 4,
      frames: 4,
      pose(t) {
        const phase = t * Math.PI * 2;
        const rustle = Math.sin(phase);
        return {
          torso: { rot: [0, rustle * 3, rustle * 2] },
          head: { rot: [0, -rustle * 5, -rustle * 3.5] },
        };
      },
    },
  },
};

export const ARCHER_RIG: BakerRigDef = {
  name: 'archer',
  w: 22,
  h: 24,
  hd: false,
  origin: { x: 11, y: 21 },
  hitbox: { x: 5, y: 4, w: 12, h: 17 },
  cameraPitch: 8,
  lightDir: [-0.45, 0.7, 0.55],
  outlineColor: '#0e1312',
  outlineMode: 'outside',
  creaseThreshold: 1.15,
  rearShadeZ: -0.9,
  critic: {
    expectedAnims: ['idle', 'walk', 'aim'],
    expectedHitboxSize: { w: 12, h: 17 },
    groundedAnims: ['idle', 'walk', 'aim'],
  },
  materials: {
    cloakGreen: {
      deepShadow: '#131f12',
      shadow: '#1d2e1b',
      mid: '#2d452a',
      lit: '#43663e',
      highlight: '#64915d',
    },
    leatherWood: {
      deepShadow: '#29170e',
      shadow: '#3d2416',
      mid: '#5e3922',
      lit: '#825332',
      highlight: '#ad7348',
    },
    bowYew: {
      deepShadow: '#452814',
      shadow: '#693e20',
      mid: '#945b30',
      lit: '#bf7b45',
      highlight: '#e6a367',
      specular: 0.88,
    },
    bowStringFletch: {
      shadow: '#8c9996',
      mid: '#b8c7c4',
      lit: '#e1eded',
      highlight: '#ffffff',
    },
    hoodVoid: {
      shadow: '#07070c',
      mid: '#0e0e16',
      lit: '#1b1b29',
    },
    eyeGlint: {
      shadow: '#b8862d',
      mid: '#e0b048',
      lit: '#ffcd75',
      highlight: '#fff6d6',
      emissive: true,
    },
  },
  bones: [
    {
      id: 'pelvis',
      pos: [0, 5.2, 0],
      partGroup: 'cloak',
    },
    {
      id: 'legFront',
      parent: 'pelvis',
      pos: [0.9, 0, 1.0],
      partGroup: 'legFront',
      shapes: [
        {
          type: 'capsule',
          material: 'leatherWood',
          a: [0, 0, 0],
          b: [0.2, -3.8, 0],
          radius: 1.55,
          radiusB: 1.35,
        },
        {
          type: 'box',
          material: 'leatherWood',
          offset: [0.6, -4.0, 0],
          size: [1.55, 0.8, 1.2],
          bevel: 0.3,
        },
      ],
    },
    {
      id: 'legRear',
      parent: 'pelvis',
      pos: [-0.9, 0, -1.0],
      partGroup: 'legRear',
      shapes: [
        {
          type: 'capsule',
          material: 'leatherWood',
          a: [0, 0, 0],
          b: [-0.2, -3.8, 0],
          radius: 1.5,
          radiusB: 1.3,
        },
        {
          type: 'box',
          material: 'leatherWood',
          offset: [0.2, -4.0, 0],
          size: [1.5, 0.8, 1.15],
          bevel: 0.3,
        },
      ],
    },
    {
      id: 'cloakBody',
      parent: 'pelvis',
      pos: [0, 0.5, 0],
      partGroup: 'cloak',
      shapes: [
        // Layered ranger cloak mantle
        {
          type: 'cylinder',
          material: 'cloakGreen',
          a: [0, -2.1, 0],
          b: [0, 5.8, 0],
          radius: 4.05,
          radiusB: 2.95,
        },
        // Cross-chest leather quiver baldric strap
        {
          type: 'capsule',
          material: 'leatherWood',
          a: [-2.4, 4.6, 2.2],
          b: [2.2, 0.6, 2.5],
          radius: 0.85,
          radiusB: 0.85,
        },
        // Quiver slung behind the shoulder + fletched arrows
        {
          type: 'cylinder',
          material: 'leatherWood',
          a: [-2.3, 1.5, -1.4],
          b: [-3.7, 6.6, -1.4],
          radius: 1.35,
          radiusB: 1.55,
        },
        {
          type: 'capsule',
          material: 'bowStringFletch',
          a: [-3.3, 6.2, -1.4],
          b: [-4.4, 8.2, -1.4],
          radius: 0.65,
          radiusB: 0.85,
        },
        {
          type: 'capsule',
          material: 'bowStringFletch',
          a: [-2.6, 6.4, -1.1],
          b: [-3.4, 8.5, -1.1],
          radius: 0.65,
          radiusB: 0.85,
        },
      ],
    },
    {
      id: 'head',
      parent: 'cloakBody',
      pos: [0.3, 7.2, 0.3],
      partGroup: 'head',
      shapes: [
        // Deep cowled hunter hood + trailing point
        {
          type: 'ellipsoid',
          material: 'cloakGreen',
          offset: [-0.3, 0.5, 0],
          radii: [3.6, 3.4, 3.2],
        },
        {
          type: 'capsule',
          material: 'cloakGreen',
          op: 'smoothUnion',
          blend: 0.5,
          a: [-1.2, 1.6, 0],
          b: [-4.2, 0.3, 0],
          radius: 1.75,
          radiusB: 0.85,
        },
        // Shadowed hood interior
        {
          type: 'sphere',
          material: 'hoodVoid',
          offset: [1.6, 0.2, 1.2],
          radius: 1.95,
        },
        // Sharp golden hunter eye glint
        {
          type: 'sphere',
          material: 'eyeGlint',
          offset: [2.75, 0.5, 1.95],
          radius: 0.95,
        },
      ],
    },
    {
      id: 'armFront',
      parent: 'cloakBody',
      pos: [1.1, 4.2, 1.8],
      partGroup: 'armFront',
      shapes: [
        // Bow arm sleeve & bracer
        {
          type: 'capsule',
          material: 'cloakGreen',
          a: [0, 0, 0],
          b: [1.8, -0.6, 0.3],
          radius: 1.35,
          radiusB: 1.15,
        },
        {
          type: 'capsule',
          material: 'leatherWood',
          a: [1.6, -0.5, 0.3],
          b: [3.2, -0.9, 0.4],
          radius: 1.15,
          radiusB: 1.0,
        },
        // Recurved yew bow limbs & taut bowstring
        {
          type: 'capsule',
          material: 'bowYew',
          a: [3.4, -0.8, 0.5],
          b: [2.5, 3.8, 0.5],
          radius: 0.9,
          radiusB: 0.65,
        },
        {
          type: 'capsule',
          material: 'bowYew',
          a: [3.4, -0.8, 0.5],
          b: [2.5, -5.2, 0.5],
          radius: 0.9,
          radiusB: 0.65,
        },
        {
          type: 'capsule',
          material: 'bowStringFletch',
          a: [2.4, 3.6, 0.4],
          b: [2.4, -5.0, 0.4],
          radius: 0.48,
          radiusB: 0.48,
        },
      ],
    },
  ],
  sockets: {
    bowHand: {
      bone: 'armFront',
      pos: [3.2, -0.9, 0.4],
      dir: [1, 0, 0],
    },
  },
  anims: {
    idle: {
      fps: 5,
      frames: 5,
      pose(t) {
        const phase = t * Math.PI * 2;
        const sway = Math.sin(phase);
        const breath = Math.cos(phase);
        return {
          cloakBody: { pos: [sway * 0.35, breath * 0.45, 0], rot: [0, sway * 4, sway * 3.5] },
          head: { pos: [0, breath * 0.35, 0], rot: [0, 0, -sway * 3.5] },
          armFront: { rot: [0, 0, -6 + sway * 8] },
        };
      },
    },
    walk: {
      fps: 9,
      frames: 6,
      pose(t) {
        const phase = t * Math.PI * 2;
        const stride = Math.sin(phase);
        const coStride = Math.cos(phase);
        const bob = Math.cos(phase * 2) * 0.4;
        const lag = Math.sin(phase - 0.9);
        return {
          pelvis: { pos: [coStride * 0.35, bob, 0], rot: [0, stride * 6, -4] },
          cloakBody: { pos: [0, lag * 0.3, 0], rot: [0, stride * 8, -5 + coStride * 4] },
          head: { pos: [coStride * 0.2, -bob * 0.4, 0], rot: [0, -coStride * 4, 4 - lag * 4] },
          legFront: { pos: [0, Math.max(0, coStride) * 0.55, 0], rot: [0, 0, stride * 28 + coStride * 10] },
          legRear: { pos: [0, Math.max(0, -coStride) * 0.55, 0], rot: [0, 0, -stride * 28 - coStride * 10] },
          armFront: { pos: [coStride * 0.25, 0, 0], rot: [0, 0, -stride * 16 + lag * 10] },
        };
      },
    },
    aim: {
      fps: 6,
      frames: 4,
      pose(_t, frame) {
        const lift = [10, 18, 24, 20][frame] ?? 18;
        const lean = [2, 5, 8, 6][frame] ?? 5;
        return {
          cloakBody: { rot: [0, 0, lean] },
          head: { pos: [0.2 + frame * 0.15, 0, 0], rot: [0, 0, -5] },
          armFront: { pos: [0.3, 0.4, 0], rot: [0, 0, lift] },
        };
      },
    },
  },
};

export const GUNNER_RIG: BakerRigDef = {
  name: 'gunner',
  w: 29,
  h: 22,
  hd: false,
  origin: { x: 14, y: 18 },
  hitbox: { x: 8, y: 4, w: 13, h: 14 },
  cameraPitch: 8,
  lightDir: [-0.45, 0.7, 0.55],
  outlineColor: '#120b12',
  outlineMode: 'outside',
  creaseThreshold: 1.15,
  rearShadeZ: -0.9,
  critic: {
    expectedAnims: ['idle', 'aim'],
    expectedHitboxSize: { w: 13, h: 14 },
    groundedAnims: ['idle', 'aim'],
  },
  materials: {
    impCoat: {
      deepShadow: '#260b12',
      shadow: '#3d131e',
      mid: '#612130',
      lit: '#8f3041',
      highlight: '#bd485b',
    },
    impSkin: {
      deepShadow: '#4f131a',
      shadow: '#751f29',
      mid: '#a8283b',
      lit: '#d6495d',
      highlight: '#f57a8b',
    },
    brassGold: {
      deepShadow: '#5e3e10',
      shadow: '#8f631d',
      mid: '#c28e32',
      lit: '#ebbd57',
      highlight: '#fff3bd',
      specular: 0.86,
    },
    gunSteel: {
      deepShadow: '#161a29',
      shadow: '#242b40',
      mid: '#3c4769',
      lit: '#5f7091',
      highlight: '#9cb8cc',
      specular: 0.88,
    },
  },
  bones: [
    {
      id: 'pelvis',
      pos: [0, 4.4, 0],
      partGroup: 'coat',
    },
    {
      id: 'legFront',
      parent: 'pelvis',
      pos: [1.2, 0, 1.0],
      partGroup: 'legFront',
      shapes: [
        {
          type: 'capsule',
          material: 'impCoat',
          a: [0, 0, 0],
          b: [0.3, -3.1, 0],
          radius: 1.6,
          radiusB: 1.4,
        },
        {
          type: 'box',
          material: 'gunSteel',
          offset: [0.6, -3.2, 0],
          size: [1.5, 0.75, 1.2],
          bevel: 0.25,
        },
      ],
    },
    {
      id: 'legRear',
      parent: 'pelvis',
      pos: [-1.2, 0, -1.0],
      partGroup: 'legRear',
      shapes: [
        {
          type: 'capsule',
          material: 'impCoat',
          a: [0, 0, 0],
          b: [-0.3, -3.1, 0],
          radius: 1.55,
          radiusB: 1.35,
        },
        {
          type: 'box',
          material: 'gunSteel',
          offset: [0.1, -3.2, 0],
          size: [1.45, 0.75, 1.15],
          bevel: 0.25,
        },
      ],
    },
    {
      id: 'torso',
      parent: 'pelvis',
      pos: [0, 1.2, 0],
      partGroup: 'coat',
      shapes: [
        // Crimson bombardier coat & flared coat-tail
        {
          type: 'ellipsoid',
          material: 'impCoat',
          offset: [0, 1.6, 0],
          radii: [4.5, 4.0, 3.8],
        },
        {
          type: 'capsule',
          material: 'impCoat',
          op: 'smoothUnion',
          blend: 0.5,
          a: [-2.4, 0.8, 0],
          b: [-5.2, -1.2, 0],
          radius: 1.6,
          radiusB: 0.9,
        },
        // Gold powder bandolier + 3 cylindrical powder charges
        {
          type: 'capsule',
          material: 'brassGold',
          a: [-2.6, 3.7, 2.8],
          b: [2.6, 0.2, 2.8],
          radius: 1.05,
          radiusB: 1.05,
        },
        {
          type: 'sphere',
          material: 'brassGold',
          offset: [-1.2, 2.8, 3.3],
          radius: 0.95,
        },
        {
          type: 'sphere',
          material: 'brassGold',
          offset: [0.3, 1.8, 3.4],
          radius: 0.95,
        },
      ],
    },
    {
      id: 'head',
      parent: 'torso',
      pos: [0.3, 5.8, 0.4],
      partGroup: 'head',
      shapes: [
        // Imp head & pointed ear
        {
          type: 'ellipsoid',
          material: 'impSkin',
          offset: [0, 0.4, 0],
          radii: [3.5, 2.8, 3.2],
        },
        {
          type: 'capsule',
          material: 'impSkin',
          a: [-1.2, 0.8, 1.8],
          b: [-3.6, 1.8, 2.2],
          radius: 0.95,
          radiusB: 0.45,
        },
        // Tricorne/bicorne bombardier cap + brass trim
        {
          type: 'box',
          material: 'impCoat',
          offset: [0.4, 1.8, 0.6],
          rot: [0, 0, -6],
          size: [3.6, 1.1, 2.6],
          bevel: 0.4,
        },
        // Glowing brass monocle / aiming lens
        {
          type: 'sphere',
          material: 'brassGold',
          offset: [2.5, 0.4, 2.1],
          radius: 1.15,
        },
      ],
    },
    {
      id: 'musket',
      parent: 'torso',
      pos: [1.0, 2.0, 2.2],
      partGroup: 'musket',
      shapes: [
        // Carved wooden/brass buttstock
        {
          type: 'capsule',
          material: 'brassGold',
          a: [-2.6, -0.8, 0],
          b: [1.8, 0, 0],
          radius: 1.5,
          radiusB: 1.25,
        },
        // Flintlock hammer & lockplate
        {
          type: 'box',
          material: 'brassGold',
          offset: [1.2, 0.9, 0.4],
          size: [0.9, 0.85, 0.7],
          bevel: 0.2,
        },
        // Long iron barrel + brass barrel band + flared blunderbuss/musket muzzle
        {
          type: 'cylinder',
          material: 'gunSteel',
          a: [1.4, 0.1, 0],
          b: [8.8, 0.2, 0],
          radius: 1.25,
          radiusB: 1.35,
        },
        {
          type: 'torus',
          material: 'brassGold',
          offset: [5.2, 0.15, 0],
          radius: 1.15,
          tube: 0.42,
          axis: 'x',
        },
        {
          type: 'torus',
          material: 'gunSteel',
          offset: [8.5, 0.2, 0],
          radius: 1.25,
          tube: 0.52,
          axis: 'x',
        },
      ],
    },
  ],
  sockets: {
    muzzle: {
      bone: 'musket',
      pos: [9.0, 0.2, 0],
      dir: [1, 0, 0],
    },
  },
  anims: {
    idle: {
      fps: 5,
      frames: 5,
      pose(t) {
        const phase = t * Math.PI * 2;
        const breath = Math.sin(phase);
        const sway = Math.cos(phase);
        return {
          torso: { pos: [0, breath * 0.45, 0], rot: [0, sway * 4, sway * 3.5] },
          head: { pos: [0, breath * 0.35, 0], rot: [0, 0, -sway * 3.5] },
          musket: { rot: [0, 0, -7 + breath * 6] },
        };
      },
    },
    aim: {
      fps: 8,
      frames: 4,
      pose(_t, frame) {
        const recoilX = [0.2, 0.4, -0.6, 0.1][frame] ?? 0;
        const musketPitch = [2, 5, 9, 4][frame] ?? 3;
        return {
          torso: { pos: [recoilX, 0, 0], rot: [0, 0, 4 + frame * 1.5] },
          head: { pos: [0.4, -0.3, 0], rot: [0, 0, -4] },
          musket: { pos: [0.2 + recoilX * 0.6, 0.9, 0], rot: [0, 0, musketPitch] },
        };
      },
    },
  },
};

export const VISE_RIG: BakerRigDef = {
  name: 'vise',
  w: 38,
  h: 36,
  hd: false,
  origin: { x: 19, y: 31 },
  hitbox: { x: 4, y: 5, w: 30, h: 26 },
  cameraPitch: 6,
  lightDir: [-0.45, 0.7, 0.55],
  outlineColor: '#0c1221',
  outlineMode: 'outside',
  creaseThreshold: 1.3,
  rearShadeZ: -1.5,
  critic: {
    expectedAnims: ['traverse', 'lunge', 'rockfall', 'pinSlam'],
    expectedHitboxSize: { w: 30, h: 26 },
    groundedAnims: [],
  },
  materials: {
    carapaceOuter: {
      deepShadow: '#121b30',
      shadow: '#1b2845',
      mid: '#2d446b',
      lit: '#42638c',
      highlight: '#648ab5',
    },
    carapaceRidge: {
      deepShadow: '#1b2845',
      shadow: '#2d446b',
      mid: '#42638c',
      lit: '#648ab5',
      highlight: '#9bc3eb',
      specular: 0.87,
    },
    pincerClaw: {
      deepShadow: '#2a3d5c',
      shadow: '#3f5f85',
      mid: '#648ab5',
      lit: '#9bc3eb',
      highlight: '#e3f3ff',
      specular: 0.85,
    },
    spineEyes: {
      shadow: '#a8761e',
      mid: '#e0b048',
      lit: '#ffd278',
      highlight: '#fff9de',
      emissive: true,
    },
  },
  bones: [
    {
      id: 'body',
      pos: [0, 13, 0],
      partGroup: 'carapace',
      shapes: [
        // Broad armored wall-hugging dorsal shell
        {
          type: 'ellipsoid',
          material: 'carapaceOuter',
          radii: [12.0, 11.0, 6.8],
        },
        // Four segmented thoracic armor plates
        {
          type: 'box',
          material: 'carapaceRidge',
          op: 'smoothUnion',
          blend: 0.8,
          offset: [0.3, 6.2, 2.1],
          rot: [0, 0, -8],
          size: [6.8, 1.8, 3.8],
          bevel: 0.7,
        },
        {
          type: 'box',
          material: 'carapaceRidge',
          op: 'smoothUnion',
          blend: 0.8,
          offset: [0.8, 2.1, 2.5],
          rot: [0, 0, -3],
          size: [7.6, 1.9, 4.2],
          bevel: 0.7,
        },
        {
          type: 'box',
          material: 'carapaceRidge',
          op: 'smoothUnion',
          blend: 0.8,
          offset: [0.8, -2.1, 2.5],
          rot: [0, 0, 3],
          size: [7.6, 1.9, 4.2],
          bevel: 0.7,
        },
        {
          type: 'box',
          material: 'carapaceRidge',
          op: 'smoothUnion',
          blend: 0.8,
          offset: [0.3, -6.2, 2.1],
          rot: [0, 0, 8],
          size: [6.8, 1.8, 3.8],
          bevel: 0.7,
        },
        // Rear wall-gripping anchor spikes (-X)
        {
          type: 'capsule',
          material: 'pincerClaw',
          a: [-9.0, 5.5, 0],
          b: [-13.2, 6.8, 0],
          radius: 1.6,
          radiusB: 0.8,
        },
        {
          type: 'capsule',
          material: 'pincerClaw',
          a: [-9.5, 0.0, 0],
          b: [-13.6, 0.0, 0],
          radius: 1.7,
          radiusB: 0.85,
        },
        {
          type: 'capsule',
          material: 'pincerClaw',
          a: [-9.0, -5.5, 0],
          b: [-13.2, -6.8, 0],
          radius: 1.6,
          radiusB: 0.8,
        },
        // Three golden compound spine eyes watching the shaft (+X)
        {
          type: 'sphere',
          material: 'spineEyes',
          offset: [6.4, 5.4, 6.0],
          radius: 2.1,
        },
        {
          type: 'sphere',
          material: 'spineEyes',
          offset: [7.2, 0.0, 6.4],
          radius: 2.35,
        },
        {
          type: 'sphere',
          material: 'spineEyes',
          offset: [6.4, -5.4, 6.0],
          radius: 2.1,
        },
      ],
    },
    {
      id: 'crestTop',
      parent: 'body',
      pos: [-1.5, 8.2, 1.6],
      partGroup: 'crestTop',
      shapes: [
        // Upper crushing pincer arm + serrated front claw
        {
          type: 'capsule',
          material: 'carapaceRidge',
          a: [0, 0, 0],
          b: [5.5, 2.2, 1.0],
          radius: 2.2,
          radiusB: 1.75,
        },
        {
          type: 'capsule',
          material: 'pincerClaw',
          op: 'smoothUnion',
          blend: 0.4,
          a: [5.5, 2.2, 1.0],
          b: [10.8, 0.2, 1.4],
          radius: 1.75,
          radiusB: 0.85,
        },
      ],
    },
    {
      id: 'crestBottom',
      parent: 'body',
      pos: [-1.5, -8.2, 1.6],
      partGroup: 'crestBottom',
      shapes: [
        // Lower crushing pincer arm + serrated front claw
        {
          type: 'capsule',
          material: 'carapaceRidge',
          a: [0, 0, 0],
          b: [5.5, -2.2, 1.0],
          radius: 2.2,
          radiusB: 1.75,
        },
        {
          type: 'capsule',
          material: 'pincerClaw',
          op: 'smoothUnion',
          blend: 0.4,
          a: [5.5, -2.2, 1.0],
          b: [10.8, -0.2, 1.4],
          radius: 1.75,
          radiusB: 0.85,
        },
      ],
    },
  ],
  anims: {
    traverse: {
      fps: 8,
      frames: 6,
      pose(t) {
        const phase = t * Math.PI * 2;
        const wave = Math.sin(phase);
        const coWave = Math.cos(phase);
        return {
          body: { pos: [coWave * 0.4, wave * 0.9, 0], rot: [0, wave * 4, wave * 4.5] },
          crestTop: { rot: [0, 0, wave * 14] },
          crestBottom: { rot: [0, 0, -wave * 14] },
        };
      },
    },
    lunge: {
      fps: 10,
      frames: 4,
      pose(_t, frame) {
        const xOff = [-1.5, -0.6, 1.8, 0.8][frame] ?? 0;
        const sx = [0.91, 0.95, 1.09, 1.02][frame] ?? 1;
        const sy = [1.07, 1.04, 0.93, 0.98][frame] ?? 1;
        const jaw = [20, 12, -18, -8][frame] ?? 0;
        return {
          body: {
            pos: [xOff, 0, 0],
            scale: [sx, sy, 1],
          },
          crestTop: { rot: [0, 0, jaw] },
          crestBottom: { rot: [0, 0, -jaw] },
        };
      },
    },
    rockfall: {
      fps: 10,
      frames: 4,
      pose(_t, frame) {
        const xOff = [-1.2, 0.9, -0.9, 0.7][frame] ?? 0;
        const yOff = [0.8, -0.8, 0.6, -0.6][frame] ?? 0;
        const rz = [6, -6, 5, -5][frame] ?? 0;
        const jaw = [16, -12, 14, -10][frame] ?? 0;
        return {
          body: { pos: [xOff, yOff, 0], rot: [0, 0, rz] },
          crestTop: { rot: [0, 0, jaw] },
          crestBottom: { rot: [0, 0, -jaw] },
        };
      },
    },
    pinSlam: {
      fps: 10,
      frames: 4,
      pose(_t, frame) {
        const xOff = [-1.6, -0.8, 1.5, 0.6][frame] ?? 0;
        const rz = [-6, -3, 6, 2][frame] ?? 0;
        const jaw = [-16, -8, 22, 12][frame] ?? 0;
        return {
          body: { pos: [xOff, 0, 0], rot: [0, 0, rz] },
          crestTop: { rot: [0, 0, jaw] },
          crestBottom: { rot: [0, 0, -jaw] },
        };
      },
    },
  },
};

export const VISE_NEST_RIG: BakerRigDef = {
  name: 'vise-nest',
  w: 22,
  h: 26,
  hd: false,
  origin: { x: 11, y: 23 },
  hitbox: { x: 3, y: 3, w: 16, h: 20 },
  cameraPitch: 6,
  lightDir: [-0.45, 0.7, 0.55],
  outlineColor: '#0c1221',
  outlineMode: 'outside',
  creaseThreshold: 1.2,
  rearShadeZ: -1.5,
  critic: {
    expectedAnims: ['idle', 'ready'],
    expectedHitboxSize: { w: 16, h: 20 },
    groundedAnims: [],
  },
  materials: {
    nestWall: {
      deepShadow: '#121d2e',
      shadow: '#1b2b42',
      mid: '#2b4467',
      lit: '#3f5f85',
      highlight: '#5b7fa8',
    },
    broodSac: {
      deepShadow: '#2a415e',
      shadow: '#3f5f85',
      mid: '#5b7fa8',
      lit: '#8fb6d6',
      highlight: '#d6ecff',
      specular: 0.86,
    },
    embryoGold: {
      shadow: '#b8862d',
      mid: '#e0b048',
      lit: '#ffcd75',
      highlight: '#fff6d6',
      emissive: true,
    },
  },
  bones: [
    {
      id: 'cluster',
      pos: [0, 10, 0],
      partGroup: 'cluster',
      shapes: [
        {
          type: 'ellipsoid',
          material: 'nestWall',
          radii: [7.2, 8.8, 5.5],
        },
        {
          type: 'sphere',
          material: 'nestWall',
          op: 'smoothUnion',
          blend: 1.0,
          offset: [-2.8, 4.2, 1.5],
          radius: 4.5,
        },
        {
          type: 'sphere',
          material: 'nestWall',
          op: 'smoothUnion',
          blend: 1.0,
          offset: [2.6, -4.0, 1.5],
          radius: 4.8,
        },
        // Organic chitinous resin ribs wrapping the hive
        {
          type: 'capsule',
          material: 'nestWall',
          op: 'smoothUnion',
          blend: 0.6,
          a: [-6.0, 6.2, 1.0],
          b: [4.2, 1.8, 3.0],
          radius: 1.3,
          radiusB: 0.85,
        },
        {
          type: 'capsule',
          material: 'nestWall',
          op: 'smoothUnion',
          blend: 0.6,
          a: [-5.8, -1.8, 1.2],
          b: [4.5, -5.5, 2.8],
          radius: 1.3,
          radiusB: 0.85,
        },
      ],
    },
    {
      id: 'sacTop',
      parent: 'cluster',
      pos: [-1.8, 3.8, 3.2],
      partGroup: 'sacTop',
      shapes: [
        {
          type: 'sphere',
          material: 'broodSac',
          radius: 2.85,
        },
        {
          type: 'sphere',
          material: 'embryoGold',
          offset: [0.45, 0.2, 1.65],
          radius: 1.4,
        },
      ],
    },
    {
      id: 'sacMid',
      parent: 'cluster',
      pos: [2.2, 0.4, 3.4],
      partGroup: 'sacMid',
      shapes: [
        {
          type: 'sphere',
          material: 'broodSac',
          radius: 3.1,
        },
        {
          type: 'sphere',
          material: 'embryoGold',
          offset: [0.55, 0.0, 1.85],
          radius: 1.5,
        },
      ],
    },
    {
      id: 'sacLow',
      parent: 'cluster',
      pos: [-1.2, -3.8, 3.0],
      partGroup: 'sacLow',
      shapes: [
        {
          type: 'sphere',
          material: 'broodSac',
          radius: 2.75,
        },
        {
          type: 'sphere',
          material: 'embryoGold',
          offset: [0.35, -0.2, 1.55],
          radius: 1.35,
        },
      ],
    },
  ],
  anims: {
    idle: {
      fps: 6,
      frames: 6,
      pose(t) {
        const phase = t * Math.PI * 2;
        const a = Math.sin(phase);
        const b = Math.cos(phase);
        return {
          cluster: { pos: [0, a * 0.4, 0] },
          sacTop: { pos: [a * 0.6, b * 0.5, 0], scale: [1 + a * 0.12, 1 - a * 0.08, 1] },
          sacMid: { pos: [-b * 0.6, a * 0.5, 0], scale: [1 + b * 0.12, 1 - b * 0.08, 1] },
          sacLow: { pos: [b * 0.5, -a * 0.6, 0], scale: [1 - a * 0.1, 1 + a * 0.12, 1] },
        };
      },
    },
    ready: {
      fps: 10,
      frames: 4,
      pose(_t, frame) {
        const s = [1.16, 0.9, 1.18, 0.94][frame] ?? 1;
        const dx = [0.6, -0.5, 0.8, -0.4][frame] ?? 0;
        return {
          cluster: { pos: [dx * 0.6, 0, 0] },
          sacTop: { pos: [dx, 0.4, 0.5], scale: [s, s, 1] },
          sacMid: { pos: [-dx, -0.4, 0.5], scale: [2 - s, 2 - s, 1] },
          sacLow: { pos: [dx * 0.8, -0.5, 0.5], scale: [s, s, 1] },
        };
      },
    },
  },
};

export const BUILTIN_SPRITE_RIGS: Record<string, BakerRigDef> = {
  mourn: MOURN_RIG,
  wallcrawler: WALLCRAWLER_RIG,
  dummy: DUMMY_RIG,
  archer: ARCHER_RIG,
  gunner: GUNNER_RIG,
  vise: VISE_RIG,
  'vise-nest': VISE_NEST_RIG,
  'adventurer-poc': ADVENTURER_HUMANOID_RIG,
};
