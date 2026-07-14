import { rand, sign, tintOf, itemDef } from '@engine/index';
import { defineMonster, Monster } from './monster';
import { SLIME1, SLIME2, BAT1, BAT2, TEXEL, blit } from '../content/sprites';
import { COLORS } from '../content/palette';
import { Player } from './player';

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
    blit(g, m.img(m.onGround ? SLIME1 : SLIME2), m.x, m.y);
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
    blit(g, m.img(frame), m.x, m.y);
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
    g.translate(Math.round(m.x * 4) / 4, Math.round((m.y - 1) * 4) / 4);
    g.scale(22 / 12, 2);
    g.drawImage(drawn, 0, 0, drawn.width / TEXEL, drawn.height / TEXEL);
    g.restore();
  },
});

/** A Devourer still carrying swallowed gear (until it's killed). */
function ladenDevourer(m: Monster): boolean {
  const s = m.state.stolenItems;
  return Array.isArray(s) && s.length > 0;
}

/**
 * THE DEVOURER: doesn't bite — it swallows. It creeps close, shivers
 * (the tell), lunges, and on contact gulps the player down: everything
 * you have equipped is swallowed with you, and your health ticks away
 * until you mash free. It then turns sluggish, weighed down by its loot;
 * kill THAT one to get your gear back.
 */
defineMonster('devourer', {
  hp: 12, damage: 1, w: 26, h: 16, score: 600, mass: 3,
  noContactDamage: true, // its "attack" is the swallow, not a touch
  colors: [COLORS.purple, COLORS.purpleLight, COLORS.white],
  drops: [
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 0.6 },
    { id: 'mana-orb', chance: 0.4 },
  ],
  init(m) {
    m.state.mode = 'creep';
    m.state.modeT = 0;
    m.state.digestCd = 0;
    m.state.victim = false;
    m.state.biteT = 0;
  },
  update(m, dt) {
    const player = m.player as Player | undefined;
    m.state.digestCd = Math.max(0, (m.state.digestCd as number) - dt);
    m.state.modeT = (m.state.modeT as number) + dt;

    /* Digesting: crawl slowly, chew every 1.2s until the player breaks out. */
    if (m.state.victim) {
      const held = player?.swallowedBy === m && player.hp > 0;
      if (!held || !player) {
        m.state.victim = false;
        return;
      }
      m.vx *= Math.pow(0.02, dt);
      m.state.biteT = (m.state.biteT as number) - dt;
      if ((m.state.biteT as number) <= 0) {
        m.state.biteT = 1.2;
        m.game.combat.hit(player, {
          damage: 1, targets: 'player', attacker: m,
          strength: 0.35, knockback: 0, popY: 0,
          colors: [COLORS.purple, COLORS.white],
        });
      }
      return;
    }

    const mode = m.state.mode as string;
    if (!player || player.hp <= 0) {
      m.vx *= Math.pow(0.05, dt);
      return;
    }
    const dist = player.cx - m.cx;
    m.facing = dist > 0 ? 1 : -1;
    // A laden beast (still carrying your gear) is sluggish and satiated:
    // it crawls slower and won't gulp again until it's been killed.
    const laden = ladenDevourer(m);

    if (mode === 'creep') {
      // Slow, hungry approach — slower still when weighed down by loot.
      if (m.onGround) m.vx = m.facing * (laden ? 15 : 28);
      if (!laden && Math.abs(dist) < 46 && m.onGround && (m.state.digestCd as number) <= 0) {
        m.state.mode = 'windup';
        m.state.modeT = 0;
        m.vx = 0;
      }
    } else if (mode === 'windup') {
      // The tell: shiver in place before the lunge.
      if (Math.floor((m.state.modeT as number) * 30) % 2) m.x += Math.sin((m.state.modeT as number) * 60) * 0.6;
      if ((m.state.modeT as number) > 0.45) {
        m.state.mode = 'lunge';
        m.state.modeT = 0;
        m.vy = -150;
        m.vx = m.facing * 190;
        m.game.feel.sfx.play('dash');
      }
    } else if (mode === 'lunge') {
      if ((m.state.modeT as number) > 0.25 && m.onGround) {
        m.state.mode = 'creep';
        m.state.modeT = 0;
      }
    }

    // The gulp: any overlap while it's hungry (a laden one is satiated).
    if (!laden && (m.state.digestCd as number) <= 0 &&
        player.x < m.x + m.w && player.x + player.w > m.x &&
        player.y < m.y + m.h && player.y + player.h > m.y) {
      const weaponId = player.equipment.get('weapon');
      if (weaponId) {
        // Swallow weapon only!
        player.equipment.unequip('weapon');
        player.inventory.remove(weaponId, player.inventory.count(weaponId));
        player.syncStats();
        
        m.state.stolenItems = [weaponId];
        m.state.digestCd = 3;
        m.vx = 0;
        
        m.game.feel.hitstop(0.08);
        m.game.feel.flash(0.2, COLORS.purple);
        m.game.feel.sfx.play('gulp');
        m.game.feel.text(player.cx, player.y - 16, 'WEAPON SWALLOWED!', COLORS.red);
      } else {
        // If already disarmed, touch deals normal contact damage!
        m.game.combat.hit(player, {
          damage: 1, targets: 'player', attacker: m,
          strength: 0.5, knockback: m.facing * 120, popY: -100,
          colors: [COLORS.purple, COLORS.white],
        });
        m.state.digestCd = 1.5; // brief breather before next contact hit
      }
    }
  },
  draw(g, m) {
    const img = m.onGround ? SLIME1 : SLIME2;
    const digesting = m.state.victim as boolean;
    const laden = ladenDevourer(m);
    // Bulging while it holds something (swallowed gear).
    const bulge = digesting || laden;
    const pulse = bulge ? 1 + Math.sin(m.animT * 6) * 0.08 : 1;
    // Laden with loot reads gold-tinged; an empty hunter stays deep purple.
    const base = m.flashT > 0
      ? m.img(img)
      : laden
        ? tintOf(tintOf(img, COLORS.purple, 0.5), COLORS.gold, 0.28)
        : tintOf(img, COLORS.purple, 0.55);
    g.save();
    g.translate(Math.round(m.cx * 4) / 4, Math.round((m.y + m.h) * 4) / 4);
    g.scale((26 / 12) * pulse, (16 / 7) * (bulge ? 1.12 : 1));
    g.drawImage(base, -6, -7, base.width / TEXEL, base.height / TEXEL);
    g.restore();
    if (laden) {
      // Draw the actual weapon floating and swaying inside the slimy body
      const stolen = m.state.stolenItems as string[] | undefined;
      const itemId = stolen?.[0];
      if (itemId) {
        const def = itemDef(itemId);
        const icon = def?.icon;
        if (icon) {
          g.save();
          g.globalAlpha = 0.75;
          g.translate(Math.round(m.cx), Math.round(m.cy) + Math.sin(m.animT * 4) * 2);
          g.rotate(Math.sin(m.animT * 2) * 0.25);
          g.drawImage(icon, -icon.width / TEXEL / 2, -icon.height / TEXEL / 2, icon.width / TEXEL, icon.height / TEXEL);
          g.restore();
        }
      }
    }
  },
});

/** Importing this module registers the built-in enemies. */
export function registerEnemies(): void {}
