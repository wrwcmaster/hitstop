import { drawText, frameAt, whiteOf, tintOf, clamp } from '@engine/index';
import { baseKnight, KNIGHT_TAG_ANIMS } from '../content/sprites';
import { gearLayers, DEBUG_ANCHORS } from '../content/gear-visuals';
import { COLORS } from '../content/palette';
import { IMPACT_DROP_PLUNGE } from '../content/weapons';
import {
  drawHeldWeaponTag, drawEmbeddedHeldWeaponTag, drawWeaponTrail, drawNeutralTrail, heldWeaponAttachmentSlot,
  heldWeaponGripRenderTag, heldWeaponHands,
  type HeldWeaponCtx,
} from '../content/weapon-visuals';
import { orderedPlayerRenderTags } from '../content/render-tags';
import { PLAYER_TUNING } from './player-tuning';
import type { Player } from './player';
import { shouldSuppressHeldWeapon } from './player-render-policy';

/**
 * How the knight is drawn — the whole picture, from body English to the
 * held weapon to the parry crescent. Split from player.ts so the state
 * machine file stays about what she DOES; nothing here mutates her, and
 * the co-op guest gets identical remote knights for free because puppets
 * are real Players rendered by this same function.
 */
/**
 * Procedural body English, layered on top of squash & stretch so each
 * action reads distinctly even though the sprite set is tiny. Returns a
 * horizontal shear (upper body lean; negative leans the head toward +x),
 * a pixel offset, and extra scale. Anchored at the feet in render.
 */
function bodyPose(p: Player): { shear: number; ox: number; oy: number; sx: number; sy: number } {
  const f = p.facing;

  if (p.fsm.is('dash')) {
    // Streak: head thrown ahead of the trailing feet.
    return { shear: -f * 0.34, ox: f * 1.5, oy: 0, sx: 1, sy: 1 };
  }

  if (p.fsm.is('attack')) {
    const prog = clamp(p.fsm.t / p.attackDur, 0, 1);
    const attack = p.attackDef;
    if (!attack) return { shear: 0, ox: 0, oy: 0, sx: 1, sy: 1 };
    // Authored attack art already carries the coil, swing, and recovery.
    // Procedurally shearing those frames would pose the same action twice.
    if (p.animSet.right[attack.animation]) {
      return { shear: 0, ox: 0, oy: 0, sx: 1, sy: 1 };
    }
    const mag = attack.bodyWeight;
    let shear: number;
    let ox: number;
    if (prog < attack.active[0]) {
      const w = prog / attack.active[0]; // wind up: coil back
      shear = f * 0.22 * mag * w;
      ox = -f * 2 * mag * w;
    } else if (prog < attack.active[1]) {
      const s = (prog - attack.active[0]) / (attack.active[1] - attack.active[0]);
      shear = (f * 0.22 - f * 0.52 * s) * mag;
      ox = (-f * 2 + f * 5 * s) * mag;
    } else {
      const r = (prog - attack.active[1]) / (1 - attack.active[1]);
      shear = -f * 0.3 * mag * (1 - r);
      ox = f * 3 * mag * (1 - r);
    }
    const oy = -attack.lift * Math.sin(prog * Math.PI);
    return { shear, ox, oy, sx: 1, sy: 1 };
  }

  if (p.fsm.is('cast')) {
    const prog = clamp(p.fsm.t / p.castDur, 0, 1);
    const k = prog < 0.3 ? prog / 0.3 : 1 - (prog - 0.3) / 0.7; // snap back, ease out
    return { shear: f * 0.26 * k, ox: -f * 2 * k, oy: -k, sx: 1, sy: 1 };
  }

  if (p.fsm.is('parry')) {
    // A braced guard: weight settled back, blade shoulder forward.
    const k = clamp(1 - p.fsm.t / (PLAYER_TUNING.parryWindow + PLAYER_TUNING.parryRecovery), 0, 1);
    return { shear: -f * 0.18 * k, ox: -f * 1.5 * k, oy: 0, sx: 1, sy: 1 };
  }

  // move / air: lean into horizontal motion; stretch on a fast rise,
  // pinch slightly on the fall — a subtle jump arc.
  // The authored run cycle owns grounded locomotion now. Do not shear its
  // carefully aligned frames based on velocity; procedural posing remains
  // useful in the air, where the sprite set has less motion information.
  if (p.onGround) return { shear: 0, ox: 0, oy: 0, sx: 1, sy: 1 };

  const shear = -clamp(p.vx / 900, -0.18, 0.18);
  const sy = 1 + clamp(-p.vy / 1600, -0.06, 0.1);
  return { shear, ox: 0, oy: 0, sx: 2 - sy, sy };
}

export function renderPlayer(p: Player, g: CanvasRenderingContext2D): void {
  // Name tag (multiplayer): who is this knight. Drawn before the
  // i-frame blink so the tag holds steady while the body strobes.
  if (p.name) drawText(g, p.name, p.cx, p.y - 4, COLORS.steel, 1, 'center');
  // I-frame blink (god mode holds i-frames but shouldn't strobe).
  if (p.invulnT > 0 && !p.godMode && !p.fsm.is('dead') && Math.floor(p.invulnT * 20) % 2) return;

  const set = p.facing === 1 ? p.animSet.right : p.animSet.left;
  let anim = 'air';
  if (p.onGround) anim = Math.abs(p.vx) > 8 ? 'run' : 'idle';
  else if (p.vy < -35 && set.rise) anim = 'rise';
  else if (p.vy > 45 && set.fall) anim = 'fall';
  let animT = p.animT;
  const authoredAttack = p.fsm.is('attack') && p.attackDef
    ? set[p.attackDef.animation]
    : undefined;
  if (authoredAttack && p.attackDef) {
    anim = p.attackDef.animation;
    // Attack timing belongs to the move, not the world's locomotion clock.
    // Spread every authored pose across the move and hold the final frame at 1.
    const progress = clamp(p.fsm.t / p.attackDur, 0, 1);
    const directedProgress = p.attackDef.frameDirection === -1 ? 1 - progress : progress;
    animT = Math.min(directedProgress, 0.999999) * authoredAttack.frames.length / authoredAttack.fps;
  }
  let img = frameAt(set, anim, animT);
  if (p.flashT > 0) img = whiteOf(img);

  // Entity coordinates describe the collision box. Sprite geometry maps
  // its draw origin onto that box, allowing transparent overhangs without
  // changing physics.
  const cx = p.x - baseKnight.hitbox.x + baseKnight.w / 2;
  const by = p.y - baseKnight.hitbox.y + baseKnight.h;
  const dh = baseKnight.h;
  const dw = baseKnight.w;

  const q = (v: number) => Math.round(v * 4) / 4;
  if (p.fsm.is('dead')) {
    // Keel over and fade.
    g.save();
    g.translate(q(cx), q(by - 4));
    g.rotate(p.facing * (Math.PI / 2) * Math.min(1, p.deadT * 3));
    g.globalAlpha = Math.max(0, 1 - Math.max(0, p.deadT - 0.8));
    g.drawImage(img, -dw / 2, -dh * 0.7, dw, dh);
    g.restore();
    g.globalAlpha = 1;
    return;
  }

  // Squash & stretch + per-action body English, anchored at the feet.
  const pose = bodyPose(p);
  const baseSy = p.squash;
  const baseSx = 1 + (1 - baseSy) * 0.7;
  const sx = baseSx * pose.sx;
  const sy = baseSy * pose.sy;
  g.save();
  
  const isSwallowed = p.fsm.is('swallowed');
  if (isSwallowed) {
    g.globalAlpha = 0.9; // keep player highly visible
    // Pain shiver translation
    const shiverX = Math.sin(p.animT * 50) * 0.8;
    const shiverY = Math.cos(p.animT * 50) * 0.8;
    g.translate(q(cx + pose.ox + shiverX), q(by + pose.oy + shiverY));
  } else {
    g.translate(q(cx + pose.ox), q(by + pose.oy));
  }
  
  g.scale(sx, sy);
  if (pose.shear) g.transform(1, 0, pose.shear, 1, 0, 0);
  const animObj = p.animSet.right[anim];
  const frameIdx = animObj
    ? (animObj.loop === false
      ? Math.min(Math.floor(animT * animObj.fps), animObj.frames.length - 1)
      : Math.floor(animT * animObj.fps) % animObj.frames.length)
    : 0;
  const bodyAnchor = (name: string): { x: number; y: number } | undefined => {
    const anchor = baseKnight.anchor?.(name, anim, frameIdx);
    if (!anchor) return undefined;
    // Sprite points are authored in the right-facing sheet. Individual
    // weapon visuals already mirror by `ctx.facing`, exactly like their art.
    return { x: anchor.x - dw / 2, y: anchor.y - dh };
  };
  
  const equippedGear = gearLayers(p.equipment);
  const drawBodyTag = (tag: string): void => {
    const tagged = KNIGHT_TAG_ANIMS.get(tag);
    if (!tagged) return;
    let layerImg = frameAt(p.facing === 1 ? tagged.right : tagged.left, anim, animT);
    if (p.flashT > 0) layerImg = whiteOf(layerImg);
    else if (isSwallowed) layerImg = tintOf(layerImg, COLORS.red, 0.55);
    g.drawImage(layerImg, -dw / 2, -dh, dw, dh);
  };

  const drawGear = (): void => {
    if (p.flashT > 0 || isSwallowed) return;
    const f = p.facing;
    for (const [, visual] of equippedGear) {
      const layerSet = f === 1 ? visual.anims.right : visual.anims.left;
      const gearAnim = layerSet[anim] ? anim : layerSet.idle ? 'idle' : Object.keys(layerSet)[0];
      if (!gearAnim) continue;
      const layerImg = frameAt(layerSet, gearAnim, animT);
      const anchor = visual.anchors?.[gearAnim]?.[frameIdx] ?? { x: 0, y: 0, angle: 0 };

      g.save();
      g.translate(anchor.x * f, anchor.y);
      if (anchor.angle) g.rotate(anchor.angle * f);
      g.drawImage(layerImg, -dw / 2, -dh, dw, dh);
      if (DEBUG_ANCHORS) {
        g.fillStyle = '#ff0000';
        g.fillRect(-1, -1, 2, 2);
      }
      g.restore();
    }
  };

  const weapon = p.weapon;
  const weaponSlot = baseKnight.slot?.(heldWeaponAttachmentSlot(weapon.visual));
  const weaponCtx: HeldWeaponCtx = {
      facing: p.facing,
      anim,
      frame: frameIdx,
      animT,
      bodyW: dw,
      bodyH: dh,
      frontHand: bodyAnchor(weaponSlot?.anchor ?? 'frontHand'),
      rearHand: bodyAnchor('rearHand'),
      attack: p.fsm.is('attack')
        ? {
            progress: Math.min(1, p.fsm.t / p.attackDur),
            def: p.attackDef!,
          }
        : undefined,
      charge: p.fsm.is('draw') ? p.charge.progress : undefined,
      // The two moves the KNIGHT owns rather than her steel. A weapon
      // with nothing to say about them keeps its idle pose, which is
      // exactly what every melee visual already does.
      carry: p.fsm.is('shockwave')
        ? 'stomp'
        : p.fsm.is('attack') && p.attackDef?.aim === 'down'
          ? 'plunge'
          : undefined,
  };

  const grip = equippedGear.flatMap(([, visual]) => visual.grip ? [visual.grip] : []).at(-1)
    ?? { outline: '#171625', fill: '#684037', highlight: '#9a5b45' };
  const drawGrip = (anchor: { x: number; y: number } | undefined): void => {
    if (!anchor) return;
    const x = anchor.x * p.facing;
    const y = anchor.y;
    g.fillStyle = grip.outline;
    g.fillRect(x - 0.75, y - 0.65, 1.5, 1.3);
    g.fillStyle = grip.fill;
    g.fillRect(x - 0.5, y - 0.4, 1, 0.85);
    g.fillStyle = grip.highlight;
    g.fillRect(x + (p.facing > 0 ? 0.1 : -0.35), y - 0.35, 0.3, 0.3);
  };

  // Every body and attachment layer contributes to one shared render band.
  // The registry is the only z-order; local layer order is merely the stable
  // tie-breaker within a tag. That lets a real authored hand cover a weapon.
  const renderTags = orderedPlayerRenderTags();
  const bodyTags = new Set(baseKnight.tags());
  const bodyOverlayTag = [...renderTags].reverse().find((tag) => bodyTags.has(tag));
  const gripRenderTag = heldWeaponGripRenderTag(weapon.visual);
  // A move may request authored weapon-in-body art while the installed body
  // lacks that animation (custom sheets only promise idle/run/air). In that
  // case the body stays on locomotion art, so the ordinary held weapon must
  // remain visible. Suppress it only when this body actually supplied the
  // authored attack frames selected above.
  const embeddedHeldObject = shouldSuppressHeldWeapon(
    p.attackDef?.embeddedHeldObject,
    Boolean(authoredAttack),
  );
  for (const tag of renderTags) {
    drawBodyTag(tag);
    if (tag === bodyOverlayTag) {
      drawGear();
      if (isSwallowed && p.swallowedBy) {
        p.swallowedBy.def.swallow?.drawPlayerOverlay?.(g, p.swallowedBy, p, dw, dh);
      }
      if (p.flashT <= 0 && p.equipment.get('charm')) renderCharm(g, dh);
    }
    if (p.flashT <= 0) {
      if (embeddedHeldObject) drawEmbeddedHeldWeaponTag(g, weapon.visual, weaponCtx, tag);
      else drawHeldWeaponTag(g, weapon.visual, weaponCtx, tag);
    }
    if (p.flashT <= 0 && !embeddedHeldObject && tag === gripRenderTag) {
      for (const hand of heldWeaponHands(weapon.visual, p.fsm.is('draw'))) {
        drawGrip(hand === 'front' ? weaponCtx.frontHand : weaponCtx.rearHand);
      }
    }
  }
  g.restore();
  g.globalAlpha = 1;

  if (p.fsm.is('attack') && p.renderTrail) {
    const weapon = p.weapon;
    const trailCtx = {
      x: cx,
      y: by - dh * 0.45,
      facing: p.facing,
      colors: [...weapon.colors],
      attack: {
        progress: Math.min(1, p.fsm.t / p.attackDur),
        def: p.attackDef!,
      },
    };
    // Impact Drop's fallback belongs to the knight, not the steel, so
    // it draws its own arc — a bow registers no trail, and routing it
    // through the weapon visual left a damaging plunge with nothing on
    // screen to read.
    if (p.attackDef === IMPACT_DROP_PLUNGE) drawNeutralTrail(g, trailCtx);
    else drawWeaponTrail(g, weapon.visual, trailCtx);
  }

  // Guard flash: a bright crescent in front while the parry window is
  // open — the readable "now" of the deflect.
  if (p.fsm.is('parry') && p.parrying) {
    const gx = cx + p.facing * 7;
    const gy = by - dh * 0.5;
    g.save();
    g.globalAlpha = 0.5 + 0.3 * Math.sin(p.animT * 40);
    g.strokeStyle = COLORS.white;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(gx, gy, 7, p.facing === 1 ? -1.1 : Math.PI + 1.1, p.facing === 1 ? 1.1 : Math.PI - 1.1);
    g.stroke();
    g.globalAlpha = 1;
    g.restore();
  }
  // Riposte charge: a small gold spark orbiting the blade hand.
  if (p.riposteT > 0 && !p.fsm.is('parry')) {
    const a = p.animT * 8;
    g.fillStyle = COLORS.gold;
    g.fillRect(Math.round(cx + p.facing * 6 + Math.cos(a) * 3), Math.round(by - dh * 0.55 + Math.sin(a) * 3), 1.5, 1.5);
  }
}

/** A small charm glint on the chest when a charm is worn. */
function renderCharm(g: CanvasRenderingContext2D, dh: number): void {
  const cy = -Math.round(dh * 0.5);
  g.fillStyle = COLORS.gold;
  g.fillRect(-1, cy, 2, 2);
  g.fillStyle = COLORS.white;
  g.fillRect(0, cy, 1, 1);
}
