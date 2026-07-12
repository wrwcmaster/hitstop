import { rand, sign, tintOf } from '@engine/index';
import { defineMonster } from './monster';
import { SLIME1, SLIME2, BAT1, BAT2 } from '../content/sprites';
import { COLORS } from '../content/palette';

/**
 * The built-in bestiary. Each entry is the proof-of-extensibility: data +
 * a couple of small callbacks. Add your own in a new file and import it
 * from main.ts (or see docs/adding-content.md).
 */

defineMonster('slime', {
  hp: 3, damage: 1, w: 12, h: 7, score: 100,
  colors: [COLORS.green, COLORS.greenDark, COLORS.greenLight],
  drops: [
    { id: 'coin', chance: 0.4 },
    { id: 'potion', chance: 0.06 },
  ],
  init(m) {
    m.state.hopT = rand(0.6, 1.6);
  },
  update(m, dt) {
    m.vx *= Math.pow(0.01, dt);
    if (m.onGround) {
      m.state.hopT = (m.state.hopT as number) - dt;
      if ((m.state.hopT as number) <= 0) {
        const player = m.player;
        const d = player && player.cx > m.cx ? 1 : -1;
        m.vy = -190;
        m.vx = d * rand(55, 85);
        m.state.hopT = rand(0.9, 1.7);
      }
    }
  },
  draw(g, m) {
    g.drawImage(m.img(m.onGround ? SLIME1 : SLIME2), Math.round(m.x), Math.round(m.y));
  },
});

defineMonster('bat', {
  hp: 2, damage: 1, w: 12, h: 6, score: 150, flies: true,
  colors: [COLORS.purple, COLORS.purpleLight, COLORS.white],
  drops: [
    { id: 'coin', chance: 0.4 },
    { id: 'mana-orb', chance: 0.3 },
  ],
  init(m) {
    m.state.phase = rand(0, 9);
  },
  update(m, dt) {
    const player = m.player;
    if (!player) return;
    // Weave toward a point bobbing above the player's head.
    const tx = player.cx - m.w / 2;
    const ty = player.y - 14 + Math.sin(m.animT * 4 + (m.state.phase as number)) * 10;
    m.vx += sign(tx - m.x) * 160 * dt;
    m.vy += sign(ty - m.y) * 160 * dt;
    const sp = Math.hypot(m.vx, m.vy);
    const max = 85;
    if (sp > max) {
      m.vx *= max / sp;
      m.vy *= max / sp;
    }
  },
  draw(g, m) {
    const frame = Math.floor(m.animT * 8) % 2 ? BAT1 : BAT2;
    g.drawImage(m.img(frame), Math.round(m.x), Math.round(m.y));
  },
});

defineMonster('brute', {
  hp: 8, damage: 1, w: 22, h: 13, score: 400, mass: 2.2,
  colors: [COLORS.red, COLORS.redDark, COLORS.gold],
  drops: [
    { id: 'potion', chance: 0.45 },
    { id: 'mana-orb', chance: 0.3 },
    { id: 'great-sword', chance: 0.35 }, // skipped by PlayScene once owned
    { id: 'iron-charm', chance: 0.2 },   // same
  ],
  init(m) {
    m.state.hopT = 1.2;
    m.state.landPop = false;
  },
  update(m, dt) {
    m.vx *= Math.pow(0.01, dt);
    if (!m.onGround) return;
    if (m.state.landPop) {
      m.state.landPop = false;
      m.game.feel.shake(0.25);
      m.game.feel.burst(m.cx, m.y + m.h, 8, {
        color: COLORS.navyLight, speed: 70, life: 0.3,
        angle: -Math.PI / 2, spread: 2.6, drag: 3,
      });
    }
    m.state.hopT = (m.state.hopT as number) - dt;
    if ((m.state.hopT as number) <= 0) {
      const player = m.player;
      const d = player && player.cx > m.cx ? 1 : -1;
      m.vy = -240;
      m.vx = d * 55;
      m.state.hopT = rand(1.4, 2.4);
      m.state.landPop = true;
    }
  },
  draw(g, m) {
    const img = m.onGround ? SLIME1 : SLIME2;
    const drawn = m.flashT > 0 ? m.img(img) : tintOf(img, COLORS.red, 0.55);
    g.save();
    g.translate(Math.round(m.x), Math.round(m.y - 1));
    g.scale(22 / 12, 2);
    g.drawImage(drawn, 0, 0);
    g.restore();
  },
});

/** Importing this module registers the built-in enemies. */
export function registerEnemies(): void {}
