import { rand, sign, tintOf, itemDef, ballisticVelocity, ballisticLob } from '@engine/index';
import { defineMonster, Monster, type MonsterDef } from './monster';
import { shootArrow, shootBullet, muzzleFlash, ARROW_GRAVITY, BULLET_GRAVITY } from '../content/ballistics';
import { drawBow } from '../content/weapon-visuals';
import { SLIME1, SLIME2, BAT1, BAT2, PIKE1, PIKE2, CHEST, TEXEL, blit, slimeSprite, batSprite, pikeSprite, chestSprite } from '../content/sprites';
import { COLORS } from '../content/palette';
import { Player } from './player';

/**
 * The built-in bestiary. Each entry is the proof-of-extensibility: data +
 * a couple of small callbacks. Add your own in a new file and import it
 * from main.ts (or see docs/adding-content.md).
 */

/**
 * Y of a hover point that keeps a flier clear of the water: the surface
 * just below column `x`, minus the flier's height. Returns Infinity when
 * there's no water below (so callers can `Math.min` it with a free target).
 */
function waterlineAbove(m: Monster, x: number): number {
  const waterAt = m.collision.waterAt;
  if (!waterAt) return Infinity;
  const cx = x + m.w / 2;
  for (let y = m.y; y < m.y + 420; y += 4) {
    if (waterAt.call(m.collision, cx, y)) return y - m.h - 4;
  }
  return Infinity;
}

// The training yard's target. Not a fight: it cannot hurt her, cannot
// move, and pays nothing — it exists so the first swing of the game has
// something to land on and the hit feedback (flash, numbers, gibs) can
// do the actual teaching.
defineMonster('dummy', {
  hp: 60, damage: 0, w: 12, h: 20, score: 0, xp: 0,
  colors: [COLORS.gold, COLORS.steelDark, COLORS.steel],
  noContactDamage: true,
  init(m) {
    m.mass = 8; // a stake in the ground shrugs off knockback
  },
  update(m) {
    m.vx = 0;
  },
  draw(g, m) {
    const flash = m.flashT > 0;
    const post = flash ? COLORS.white : COLORS.steelDark;
    const head = flash ? COLORS.white : COLORS.gold;
    g.fillStyle = post;
    g.fillRect(m.x + 5, m.y + 6, 2, 14);          // stake
    g.fillRect(m.x, m.y + 8, 12, 2);              // crossbar arms
    g.fillStyle = head;
    g.fillRect(m.x + 3, m.y, 6, 6);               // burlap head
    g.fillStyle = post;
    g.fillRect(m.x + 4, m.y + 2, 1, 1);           // stitched eyes
    g.fillRect(m.x + 7, m.y + 2, 1, 1);
  },
});

defineMonster('slime', {
  hp: 60, damage: 12, w: slimeSprite.hitbox.w, h: slimeSprite.hitbox.h, score: 100,
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
    blit(g, m.img(m.onGround ? SLIME1 : SLIME2), m.x - slimeSprite.hitbox.x, m.y - slimeSprite.hitbox.y);
  },
});

defineMonster('bat', {
  hp: 40, damage: 10, w: batSprite.hitbox.w, h: batSprite.hitbox.h, score: 150, flies: true,
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
    // Weave toward a point bobbing above the player's head — but never
    // chase below the waterline: a point in water is clamped to just above
    // the surface, so a swimming knight is safe from bats.
    const tx = player.cx - m.w / 2;
    let ty = player.y - 14 + Math.sin(m.animT * 4 + (m.state.phase as number)) * 10;
    ty = Math.min(ty, waterlineAbove(m, tx));
    m.vx += sign(tx - m.x) * 160 * dt;
    m.vy += sign(ty - m.y) * 160 * dt;
    // If the wings dip in anyway (near the edge), beat hard upward.
    if ((m.collision.submersion?.({ x: m.x, y: m.y + m.h - 2, w: m.w, h: 2 }) ?? 0) > 0) {
      m.vy = Math.min(m.vy, -70);
    }
    const sp = Math.hypot(m.vx, m.vy);
    const max = 85;
    if (sp > max) {
      m.vx *= max / sp;
      m.vy *= max / sp;
    }
  },
  draw(g, m) {
    const frame = Math.floor(m.animT * 8) % 2 ? BAT1 : BAT2;
    blit(g, m.img(frame), m.x - batSprite.hitbox.x, m.y - batSprite.hitbox.y);
  },
});

defineMonster('brute', {
  hp: 160, damage: 28, w: 22, h: 13, score: 400, mass: 2.2,
  colors: [COLORS.red, COLORS.redDark, COLORS.gold],
  drops: [
    { id: 'potion', chance: 0.45 },
    { id: 'mana-orb', chance: 0.3 },
    { id: 'great-sword', chance: 0.35 }, // skipped by PlayScene once owned
    { id: 'iron-helmet', chance: 0.2 },   // same
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
  hp: 240, damage: 22, w: 26, h: 16, score: 600, mass: 3,
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
  onPlayerContact(m, player) {
    if (ladenDevourer(m) || (m.state.digestCd as number) > 0) return true;
    const weaponId = player.equipment.get('weapon');
    if (weaponId) {
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
      m.game.combat.hit(player, {
        damage: 22, targets: 'player', attacker: m,
        strength: 0.5, knockback: m.facing * 120, popY: -100,
        colors: [COLORS.purple, COLORS.white],
      });
      m.state.digestCd = 1.5;
    }
    return true;
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
          damage: 8, targets: 'player', attacker: m,
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
      // The tell: shiver in place before the lunge — drawn, not simulated.
      const wt = m.state.modeT as number;
      m.tremorX = Math.floor(wt * 30) % 2 ? Math.sin(wt * 60) * 0.6 : 0;
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

/**
 * Pike: the thing that hunts in the deep. Lives in water and never
 * leaves it — lazy figure-eights around its home pool until a knight
 * gets wet, then a fast straight rush. On land you are safe; in the
 * water you are prey.
 */
defineMonster('pike', {
  hp: 60, damage: 16, w: pikeSprite.hitbox.w, h: pikeSprite.hitbox.h, score: 220, xp: 14, flies: true,
  colors: [COLORS.green, COLORS.greenDark, COLORS.white],
  drops: [
    { id: 'coin', chance: 0.6 },
    { id: 'mana-orb', chance: 0.25 },
  ],
  init(m) {
    m.state.phase = rand(0, 9);
    m.state.homeX = m.x;
    m.state.homeY = m.y;
  },
  update(m, dt) {
    const t = m.animT + (m.state.phase as number);
    const target = m.player as unknown as { cx: number; cy: number; submersion: number } | undefined;
    const hunting = !!target && target.submersion > 0.25;
    if (hunting) {
      m.vx += sign(target.cx - m.cx) * 260 * dt;
      m.vy += sign(target.cy - m.cy) * 200 * dt;
    } else {
      // Idle: drift a slow figure-eight around home.
      const hx = (m.state.homeX as number) + Math.sin(t * 0.8) * 30;
      const hy = (m.state.homeY as number) + Math.sin(t * 1.6) * 10;
      m.vx += sign(hx - m.x) * 60 * dt;
      m.vy += sign(hy - m.y) * 60 * dt;
    }
    // Never leave the water: if the next beat of travel would surface,
    // steer hard back toward home depth instead.
    const look = { x: m.x + m.vx * 0.25, y: m.y + m.vy * 0.25, w: m.w, h: m.h };
    if ((m.collision.submersion?.(look) ?? 0) < 0.7) {
      m.vx += sign((m.state.homeX as number) - m.x) * 200 * dt;
      m.vy += sign((m.state.homeY as number) - m.y) * 300 * dt;
    }
    const sp = Math.hypot(m.vx, m.vy);
    const max = hunting ? 115 : 35;
    if (sp > max) {
      m.vx *= max / sp;
      m.vy *= max / sp;
    }
    if (Math.abs(m.vx) > 2) m.facing = m.vx > 0 ? 1 : -1;
  },
  draw(g, m) {
    const frame = m.img(Math.floor(m.animT * 6) % 2 ? PIKE1 : PIKE2);
    g.save();
    if (m.facing === -1) {
      g.translate(m.cx * 2, 0);
      g.scale(-1, 1);
    }
    blit(g, frame, m.x - pikeSprite.hitbox.x, m.y - pikeSprite.hitbox.y);
    g.restore();
  },
});

/**
 * Treasure chest: a stationary breakable. It fights back with nothing —
 * crack it open (two hits) and the deep pays out. Registered as a
 * monster so strikes, drops, and the placeables palette all come free.
 */
function chestDef(drops: NonNullable<MonsterDef['drops']>, healing = false): MonsterDef {
  return {
    hp: 40, damage: 0, w: chestSprite.hitbox.w, h: chestSprite.hitbox.h, score: 50, xp: 0,
    noContactDamage: true,
    // A cracked-open chest is a change to the room, not a defeated foe:
    // it stays open when you come back, so the deep pays out once.
    persistent: true,
    colors: healing ? [COLORS.red, COLORS.white, COLORS.gold] : [COLORS.gold, COLORS.white],
    drops,
    draw(g, m) {
      blit(g, m.img(CHEST), m.x - chestSprite.hitbox.x, m.y - chestSprite.hitbox.y);
      if (!healing) return;
      // A tiny field-medicine cross makes the guaranteed potion cache
      // readable before the player commits to breaking it open.
      const x = Math.round(m.x + m.w / 2);
      const y = Math.round(m.y + m.h / 2);
      g.fillStyle = COLORS.white;
      g.fillRect(x - 3, y - 2, 6, 4);
      g.fillStyle = COLORS.red;
      g.fillRect(x - 2, y - 1, 4, 2);
      g.fillRect(x - 1, y - 2, 2, 4);
    },
  };
}

defineMonster('chest', chestDef([
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 1 },
    { id: 'coin', chance: 0.8 },
    { id: 'potion', chance: 0.5 },
    { id: 'mana-orb', chance: 0.5 },
]));

defineMonster('healing-chest', {
  ...chestDef([{ id: 'potion', chance: 1 }], true),
  displayName: 'HEALING CACHE',
});

/* ---- the ballistic shooters ---- */

const CLOAK = '#3f5e3a';
const CLOAK_DARK = '#2a4027';
const WOOD = '#8a6b3f';

/** Seconds the archer holds its draw before loosing — the telegraph
 * window, and what the bow's visible pull-back is measured against. */
const ARCHER_AIM = 0.45;

/**
 * The archer: keeps its distance and lobs real ballistic arrows — the
 * same solver-aimed, gravity-arced shots the player's bow fires, aimed
 * with a touch of lead on a moving knight. The draw-back is the
 * telegraph: when the bow comes up, move.
 */
defineMonster('archer', {
  telegraphs: ['aim'], // the drawn bow / raised gun IS the warning
  hp: 60, damage: 18, w: 12, h: 17, score: 350,
  rangedAt: 300, // it looses at anything inside this
  colors: [CLOAK, CLOAK_DARK, WOOD],
  drops: [
    { id: 'coin', chance: 0.5 },
    { id: 'hunting-bow', chance: 0.25 }, // skipped by PlayScene once owned
  ],
  init(m) {
    m.state.cd = rand(0.8, 1.8);
    m.state.aim = 0;
  },
  update(m, dt) {
    const p = m.player;
    m.state.cd = Math.max(0, (m.state.cd as number) - dt);
    if (!p || p.hp <= 0) return;
    const dx = p.cx - m.cx;
    const dy = p.cy - m.cy;
    const dist = Math.hypot(dx, dy);
    m.facing = (sign(dx) || 1) as 1 | -1;

    if ((m.state.aim as number) > 0) {
      // Drawn: hold still, then loose at where the knight will be.
      m.vx *= 0.8;
      m.state.aim = (m.state.aim as number) - dt;
      if ((m.state.aim as number) <= 0) {
        const lead = 0.22; // seconds of knight-motion to lead by
        const tx = dx + p.vx * lead;
        const v = ballisticVelocity(tx, dy, 320, ARROW_GRAVITY)
          ?? ballisticLob(tx, dy, ARROW_GRAVITY, 70);
        shootArrow(m.game, m.collision, {
          x: m.cx + m.facing * 5, y: m.y + 4, vx: v.vx, vy: v.vy,
          damage: 18, targets: 'player', attacker: m,
        });
        m.game.feel.sfx.play('bow');
        m.state.mode = undefined;
        m.state.cd = rand(2, 2.6);
      }
      return;
    }
    // Positioning: close to bow range, but never let the knight close in.
    if (dist > 240) m.vx += m.facing * 90 * dt;
    else if (dist < 90) m.vx -= m.facing * 110 * dt;
    else m.vx *= 0.85;
    m.vx = Math.max(-40, Math.min(40, m.vx));
    if ((m.state.cd as number) <= 0 && dist < 300) {
      m.state.aim = ARCHER_AIM;
      // Name the draw. It is already the visible telegraph — the bow
      // comes up — so say so where an agent can read it too.
      m.state.mode = 'aim';
    }
  },
  draw(g, m) {
    const f = m.facing;
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    const flash = m.flashT > 0;
    const cloak = flash ? '#ffffff' : CLOAK;
    const dark = flash ? '#ffffff' : CLOAK_DARK;
    // Cloak: a tapering hooded figure, swaying slightly.
    const sway = Math.sin(m.animT * 3) * 0.5;
    g.fillStyle = dark;
    g.fillRect(x + 1, y + 6, 10, 11); // robe
    g.fillStyle = cloak;
    g.fillRect(x + 2, y + 2, 8, 6); // hood
    g.fillRect(x + 3 + sway, y + 8, 7, 8); // chest wrap
    g.fillStyle = '#0e0e16';
    g.fillRect(x + (f === 1 ? 6 : 2), y + 4, 4, 2); // hood shadow (eyes)
    // The bow — the same shared renderer the knight's bow uses. Aiming
    // pulls the string back over the telegraph window, arrow nocked, so
    // "a bow being drawn" reads identically friend or foe.
    const aim = m.state.aim as number;
    const pull = aim > 0 ? 1 - aim / ARCHER_AIM : 0;
    const bx = x + (f === 1 ? 11 : 1);
    g.save();
    g.translate(bx, y + 9);
    if (f === -1) g.scale(-1, 1);
    drawBow(g, { pull, arrow: aim > 0, ...(flash && { tint: '#ffffff' }) });
    g.restore();
  },
});

/**
 * The gunner: a powder-keg imp with a long musket. Stands its ground,
 * levels the barrel (the glint is the telegraph), and cracks off a
 * fast, nearly-flat bullet. Long reload — punish it.
 */
defineMonster('gunner', {
  telegraphs: ['aim'], // the drawn bow / raised gun IS the warning
  hp: 80, damage: 26, w: 13, h: 14, score: 450,
  rangedAt: 320, // levels the musket at anything near-flat inside this
  colors: [COLORS.redDark, COLORS.steel, COLORS.gold],
  drops: [
    { id: 'coin', chance: 0.6 },
    { id: 'flintlock', chance: 0.2 }, // skipped by PlayScene once owned
  ],
  init(m) {
    m.state.cd = rand(1.2, 2.2);
    m.state.aim = 0;
  },
  update(m, dt) {
    const p = m.player;
    m.state.cd = Math.max(0, (m.state.cd as number) - dt);
    if (!p || p.hp <= 0) return;
    const dx = p.cx - m.cx;
    const dy = p.cy - m.cy;
    m.facing = (sign(dx) || 1) as 1 | -1;
    m.vx *= 0.8; // it holds its ground

    if ((m.state.aim as number) > 0) {
      m.state.aim = (m.state.aim as number) - dt;
      if ((m.state.aim as number) <= 0) {
        // Nearly flat: aim straight at the knight, tiny drop en route.
        const v = ballisticVelocity(dx, dy, 620, BULLET_GRAVITY)
          ?? { vx: m.facing * 620, vy: 0 };
        shootBullet(m.game, m.collision, {
          x: m.cx + m.facing * 8, y: m.cy - 1, vx: v.vx, vy: v.vy,
          damage: 26, targets: 'player', attacker: m,
        });
        muzzleFlash(m.game, m.cx + m.facing * 9, m.cy - 1, m.facing, 'bullet');
        m.state.mode = undefined;
        m.vx -= m.facing * 60; // the kick
        m.state.cd = rand(2.6, 3.4);
      }
      return;
    }
    // Only levels the musket at a target it can plausibly hit: near-flat.
    if ((m.state.cd as number) <= 0 && Math.abs(dx) < 320 && Math.abs(dy) < 60) {
      m.state.mode = 'aim';
      m.state.aim = 0.5;
    }
  },
  draw(g, m) {
    const f = m.facing;
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    const flash = m.flashT > 0;
    // A squat red imp in a powder-stained coat.
    g.fillStyle = flash ? '#ffffff' : COLORS.redDark;
    g.fillRect(x + 2, y + 4, 9, 10); // body
    g.fillStyle = flash ? '#ffffff' : COLORS.red;
    g.fillRect(x + 3, y + 1, 7, 5); // head
    g.fillStyle = '#0e0e16';
    g.fillRect(x + (f === 1 ? 7 : 3), y + 3, 3, 1); // scowl
    g.fillStyle = flash ? '#ffffff' : COLORS.gold;
    g.fillRect(x + 3, y + 9, 7, 1); // bandolier
    // The musket, leveled while aiming (the barrel glints).
    const aiming = (m.state.aim as number) > 0;
    const gy = y + (aiming ? 6 : 8);
    g.fillStyle = flash ? '#ffffff' : COLORS.steel;
    if (f === 1) g.fillRect(x + 8, gy, 11, 1.5);
    else g.fillRect(x - 6, gy, 11, 1.5);
    g.fillStyle = flash ? '#ffffff' : WOOD;
    g.fillRect(x + (f === 1 ? 6 : 5), gy, 2, 2.5); // stock
    if (aiming && Math.floor(m.animT * 12) % 2 === 0) {
      g.fillStyle = COLORS.white;
      g.fillRect(x + (f === 1 ? 18 : -6), gy - 0.5, 1.5, 1.5); // sight glint
    }
  },
});

/* ---------------- the Riven ---------------- */

/** Is the stone beside `m` on `side` too slick to hold? Same question the
 * knight's hands ask (Player.slickOn) through the same engine query, so
 * the wall means one thing for everyone who touches it. */
function slickBeside(m: Monster, side: -1 | 1): boolean {
  return m.collision.traitAt?.(
    { x: side < 0 ? m.x - 3 : m.x + m.w, y: m.y + 2, w: 3, h: m.h - 4 },
    'slick',
  ) ?? false;
}

/** Is there wall at all on `side` (something to hold)? */
function wallBeside(m: Monster, side: -1 | 1): boolean {
  const probe = { x: side < 0 ? m.x - 3 : m.x + m.w, y: m.y + 2, w: 3, h: m.h - 4 };
  for (const s of m.collision.solidsNear(probe)) {
    if (s.oneWay) continue;
    if (probe.x < s.x + s.w && probe.x + probe.w > s.x && probe.y < s.y + s.h && probe.y + probe.h > s.y) {
      return true;
    }
  }
  return false;
}

/**
 * THE WALLCRAWLER — the Riven's teacher.
 *
 * It owns the walls you cannot yet hold, and it climbs them in front of
 * you: hand over hand up gripstone, and REFUSING slick panels, which it
 * reaches, recoils from, and works around. Nothing announces the rule;
 * the creature demonstrates it, so by the time Wall Grip is in your
 * hands you have already read a dozen walls. When the knight comes level
 * with it, it drops off the wall and lunges — the only time it is easy
 * to reach, which is the bargain the region keeps making.
 */
defineMonster('wallcrawler', {
  hp: 70, damage: 14, w: 14, h: 12, score: 220, flies: true,
  colors: ['#5b7fa8', '#8fb6d6', COLORS.white],
  drops: [
    { id: 'coin', chance: 0.5 },
    { id: 'mana-orb', chance: 0.25 },
  ],
  validateProps(props, path) {
    if (props.side !== undefined && props.side !== 'left' && props.side !== 'right') {
      throw new Error(`${path}.side: expected "left" or "right"`);
    }
  },
  init(m) {
    // Which wall this one lives on; the room may say, else it looks.
    const want = m.props?.side;
    m.state.side = want === 'right' ? 1 : want === 'left' ? -1 : (wallBeside(m, -1) ? -1 : 1);
    m.state.climb = -1; // start upward
    m.state.lungeT = 0;
    m.state.balkT = 0;
  },
  update(m, dt) {
    const side = m.state.side as -1 | 1;
    m.facing = side < 0 ? 1 : -1; // back to the wall, face the shaft
    const player = m.player;

    // Mid-lunge: a thrown body, gravity-free but committed.
    if ((m.state.lungeT as number) > 0) {
      m.state.lungeT = (m.state.lungeT as number) - dt;
      if ((m.state.lungeT as number) <= 0) {
        m.vx = 0;
        m.vy = 0;
      }
      return;
    }

    // Balking at a slick panel: it hangs, gropes, and turns back. The
    // pause is the whole point — a climb visibly refusing to continue.
    if ((m.state.balkT as number) > 0) {
      m.state.balkT = (m.state.balkT as number) - dt;
      m.vx = 0;
      m.vy = 0;
      if ((m.state.balkT as number) <= 0) m.state.climb = -(m.state.climb as number);
      return;
    }

    // Off the wall entirely (a lunge that missed, a broken hold): find
    // the nearest wall again rather than floating in the shaft.
    if (!wallBeside(m, side)) {
      if (wallBeside(m, -side as -1 | 1)) m.state.side = -side;
      else {
        m.vx = side * 40;
        m.vy = 12;
        return;
      }
    }

    // Level with the knight and close enough to matter: let go and lunge.
    if (player && player.hp > 0) {
      const dy = Math.abs(player.cy - m.cy);
      const dx = (player.cx - m.cx) * side;
      if (dy < 12 && dx < 0 && Math.abs(player.cx - m.cx) < 110) {
        m.state.lungeT = 0.55;
        m.vx = -side * 190;
        m.vy = -30;
        m.game.feel.sfx.play('slash');
        return;
      }
    }

    // Ordinary business: climb, hugging the wall, tracking the knight's
    // height so the shaft always has something moving in it.
    const dir = m.state.climb as -1 | 1;
    const ahead = { x: m.x, y: dir < 0 ? m.y - 6 : m.y + m.h, w: m.w, h: 6 };
    if (m.collision.traitAt?.(ahead, 'slick') || slickBeside(m, side)) {
      // The hold it was reaching for is glass. Recoil, then work back.
      m.state.balkT = 0.7;
      m.vx = 0;
      m.vy = 0;
      m.game.feel.burst(m.cx, m.cy, 3, { color: '#8fb6d6', speed: 30, life: 0.25, drag: 4 });
      return;
    }
    m.vy = dir * 34;
    m.vx = side * 26; // press into the wall so contact is never lost
    if (player && Math.abs(player.cy - m.cy) > 40) m.state.climb = player.cy < m.cy ? -1 : 1;
  },
  draw(g, m) {
    const side = (m.state.side as number) ?? 1;
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    const balking = (m.state.balkT as number) > 0;
    const body = m.flashT > 0 ? COLORS.white : '#3f5f85';
    g.fillStyle = body;
    g.fillRect(x + 2, y + 2, m.w - 4, m.h - 4);
    // Gripping limbs: four hooks on the wall side, splayed on the other.
    g.fillStyle = m.flashT > 0 ? COLORS.white : '#8fb6d6';
    const wallX = side < 0 ? x : x + m.w - 2;
    for (let i = 0; i < 4; i++) {
      const ly = y + 1 + i * 3;
      const reach = balking ? 3 + Math.sin(m.animT * 14 + i) * 2 : 2 + ((Math.floor(m.animT * 6) + i) % 2);
      g.fillRect(side < 0 ? wallX - reach : wallX, ly, reach + 2, 2);
    }
    // Two cold eyes, watching the shaft it does not have to share.
    g.fillStyle = m.flashT > 0 ? COLORS.white : COLORS.gold;
    const ex = side < 0 ? x + m.w - 5 : x + 3;
    g.fillRect(ex, y + 4, 2, 2);
    g.fillRect(ex, y + 8, 2, 2);
  },
});

/** Importing this module registers the built-in enemies. */
export function registerEnemies(): void {}
