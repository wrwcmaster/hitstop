import { resolveAnim, sprite, epx, placeBody } from '@engine/index';
import { drawHeldWeapon, drawWeaponTrail, weaponVisuals, rebuildSpriteWeapon } from '@game/content/weapon-visuals';
import { weapons, weaponTypeOf, allAttacks } from '@game/content/weapons';
import { KNIGHT_ANIMS, baseKnight } from '@game/content/sprites';
import { Player } from '@game/actors/player';
import '@game/content/items';
import '@game/content/classes';
import '@game/content/skills';
import '@game/content/skilltree';
import { geometryOf, type SpriteDocument } from './document';

export interface CompositeOptions {
  weapon: string;
  move: string;
  body: string;
  gear: boolean;
  trail: boolean;
  hitbox: boolean;
}
export interface CompositeState {
  file: SpriteDocument;
  animName: string;
  fileName: string;
  version: number;
}

export function movesOf(weaponId: string): { key: string; label: string; def: ReturnType<typeof allAttacks>[number] }[] {
  const type = weaponTypeOf(weapons.get(weaponId));
  const out: { key: string; label: string; def: ReturnType<typeof allAttacks>[number] }[] = [];
  type.attacks.forEach((def, i) => out.push({ key: `combo${i}`, label: `combo ${i + 1}`, def }));
  for (const key of ['aerial', 'plunge', 'upper', 'dashAttack'] as const) {
    const def = type[key];
    if (def) out.push({ key, label: key === 'dashAttack' ? 'dash' : key, def });
  }
  return out;
}

function drawAttackBox(
  g: CanvasRenderingContext2D,
  def: ReturnType<typeof allAttacks>[number],
  body: { x: number; y: number; w: number; h: number },
  progress: number,
): void {
  const hb = def.hitbox;
  const aim = def.aim ?? 'forward';
  const cx = body.x + body.w / 2;
  const rect = aim === 'down'
    ? { x: cx - hb.w / 2, y: body.y + body.h + hb.forward, w: hb.w, h: hb.h }
    : aim === 'up'
      ? { x: cx - hb.w / 2, y: body.y - hb.forward - hb.h, w: hb.w, h: hb.h }
      : { x: body.x + body.w + hb.forward, y: body.y + body.h / 2 - hb.h / 2 + hb.y, w: hb.w, h: hb.h };
  const live = progress > def.active[0] && progress < def.active[1];
  g.save();
  g.strokeStyle = live ? '#ff4444' : '#566c86';
  g.globalAlpha = live ? 0.9 : 0.45;
  g.lineWidth = 0.5;
  g.strokeRect(rect.x + 0.25, rect.y + 0.25, rect.w - 0.5, rect.h - 0.5);
  if (live) {
    g.fillStyle = '#ff4444';
    g.globalAlpha = 0.15;
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  g.restore();
}

/** Equip exactly `id` in `slot`, adding to the bag on first use. */
function ensureEquipped(p: Player, slot: string, id: string | null): void {
  if (p.equipment.get(slot) === id) return;
  if (id === null) {
    p.equipment.unequip(slot);
  } else {
    if (!p.inventory.has(id)) p.inventory.add(id);
    p.equipment.equip(id);
  }
  p.syncStats();
}

/** Game-renderer adapter for the editor. Owns preview caches, never DOM controls. */
export class CompositePreview {
  private posePlayer: Player | null = null;
  private posePlayerError = '';
  private rebuiltVersion = -1;
  get bakedVersion(): number { return this.rebuiltVersion; }
  private getPosePlayer(): Player | null {
    if (this.posePlayer || this.posePlayerError) return this.posePlayer;
    try {
      const noop = () => {};
      const stubSfx = { play: noop };
      const stubGame = {
        input: { held: () => false, pressed: () => false, consumePress: () => false, axis: () => 0 },
        sfx: stubSfx,
        feel: { text: noop, impact: noop, shake: noop, sfx: stubSfx, particles: { burst: noop, clear: noop } },
        events: { emit: noop, on: () => noop },
        world: { actors: () => [], all: () => [], spawn: (e: unknown) => e },
        // beginAttack opens a strike on state entry; a hit-nothing stub.
        combat: { strike: () => ({ apply: () => [] }), hit: noop },
        camera: { x: 0, y: 0 },
      } as unknown as ConstructorParameters<typeof Player>[0];
      const stubCollision = {
        tileSize: 8,
        worldW: 10000,
        worldH: 10000,
        bounds: { x: 0, y: 0, w: 10000, h: 10000 },
        *solidsNear() { /* nothing to collide with */ },
        waterAt: () => false,
        submersion: () => 0,
        hazardAt: () => 0,
        groundY: () => 10000,
        tileAt: () => '',
      } as unknown as ConstructorParameters<typeof Player>[1];
      this.posePlayer = new Player(stubGame, stubCollision, 0, 0);
    } catch (e) {
      this.posePlayerError = String(e);
    }
    return this.posePlayer;
  }

  render(pctx: CanvasRenderingContext2D, preview: HTMLCanvasElement, t: number, state: CompositeState, options: CompositeOptions): boolean {
    try {
      return this.renderFrame(pctx, preview, t, state, options);
    } catch (error) {
      // A malformed in-progress edit must be visible, not a silently missing weapon.
      // Reset the canvas too: the renderer may have failed inside nested transforms.
      preview.width = preview.width;
      pctx.fillStyle = '#b13e53';
      pctx.font = '11px monospace';
      pctx.fillText(`preview failed: ${String(error).slice(0, 70)}`, 6, 16);
      return true;
    }
  }

  private renderFrame(pctx: CanvasRenderingContext2D, preview: HTMLCanvasElement, t: number, state: CompositeState, options: CompositeOptions): boolean {
    const { file, animName, version, fileName } = state;
    const weaponId = options.weapon;
    if (!weaponId) return false;
    const a = resolveAnim(file, animName)!;
    if (this.rebuiltVersion !== version) {
      rebuildSpriteWeapon(fileName.replace(/\.json$/, ''), file);
      this.rebuiltVersion = version;
    }

    const wdef = weapons.get(weaponId);
    const moves = movesOf(weaponId);
    // A move is a candidate when its animation is the one on screen — or
    // when its animation is MISSING from the sheet and the screen shows
    // 'attack', the pattern it falls back to in game. So the base swing
    // still previews every un-arted move via the selector, and a move
    // gains its own art the moment its animation exists.
    const sheetHas = (name: string) => !!weaponVisuals.get(wdef.visual).animations?.includes(name);
    const candidates = moves.filter((m) =>
      m.def.animation === animName || (animName === 'attack' && !sheetHas(m.def.animation)));
    const wantKey = options.move;
    const move = candidates.find((m) => m.key === wantKey) ?? candidates[0];
    const atkDef = move?.def;
    // Long moves are time-compressed. The plunge's 0.9s duration is a
    // MAXIMUM — in play the landing cuts it short — so previewed raw it
    // is three-quarters of a second of nothing moving. Compression sweeps
    // the full progress on a shorter wall clock; every trail and pose
    // clock is a fraction of progress, so the whole move scales together.
    // The label owns up to it with an xN tag.
    const ATTACK_PREVIEW_CAP = 0.5;
    const realDur = atkDef?.duration ?? 0;
    const speedup = realDur > ATTACK_PREVIEW_CAP ? realDur / ATTACK_PREVIEW_CAP : 1;
    const moveTag = move ? ` [${move.label}${speedup > 1 ? ` x${speedup.toFixed(1)}` : ''}]` : '';
    // When the previewed anim isn't one this weapon attacks WITH, say
    // where the attack lives instead of only that it's absent.
    const noAttackHint = atkDef
      ? ''
      : `  (attacks play on: ${[...new Set(moves.map((m) => m.def.animation))].join(', ') || 'none'})`;

    const fps = a.fps;
    const animCycle = a.frames.length / fps;
    const dur = Math.min(realDur, ATTACK_PREVIEW_CAP);
    const cycle = Math.max(animCycle, dur + 0.35);
    const tIn = t % cycle;
    const pose = atkDef && tIn <= dur
      ? { progress: Math.min(1, tIn / dur), def: atkDef }
      : undefined;

    const bodySel = options.body;

    // Game parity: the game draws a world pixel at 8 screen px (ZOOM 4 x
    // WORLD_ZOOM 2), and judging attack art at any other size is judging
    // different art. The viewport is trimmed to what the widest swing (the
    // dash trail, ~24px around the origin) actually needs, and the side
    // panel widens while the composite is active to hold it.
    const SCALE = 8;
    const VW = 52, VH = 42;
    const fx = VW / 2, fy = 34;
    preview.width = VW * SCALE;
    preview.height = VH * SCALE;
    pctx.imageSmoothingEnabled = false;
    pctx.fillStyle = '#0a0c1c';
    pctx.fillRect(0, 0, preview.width, preview.height);
    pctx.save();
    pctx.scale(SCALE, SCALE);
    // Ground line, so the feet anchor reads.
    pctx.fillStyle = '#1f2a57';
    pctx.fillRect(0, fy, VW, 1);

    // The full player: everything Player.render owns — body-english,
    // gear layers, held weapon, trail — posed at this progress.
    if (bodySel === 'player') {
      const p = this.getPosePlayer();
      if (p) {
        ensureEquipped(p, 'weapon', weaponId);
        const gearOn = options.gear;
        ensureEquipped(p, 'helmet', gearOn ? 'iron-helmet' : null);
        ensureEquipped(p, 'armor', gearOn ? 'steel-armor' : null);
        p.facing = 1;
        p.animT = tIn;
        p.renderTrail = options.trail;
        p.poseAttack(pose ? pose.def : null, pose ? pose.progress : 0);
        if (!placeBody(p, fx - p.w / 2, fy - p.h, p.collision)) {
          throw new Error('Cannot place preview player');
        }
        try {
          p.render(pctx);
        } catch (e) {
          this.posePlayerError = String(e);
        }
        // The player's own box math is the truth; draw straight from it.
        if (pose && options.hitbox) {
          drawAttackBox(pctx, pose.def, { x: p.x, y: p.y, w: p.w, h: p.h }, pose.progress);
        }
        pctx.restore();
        pctx.fillStyle = '#ffcd75';
        pctx.font = '11px monospace';
        pctx.fillText(
          this.posePlayerError
            ? 'player render failed: ' + this.posePlayerError.slice(0, 40)
            : `${animName}${moveTag} + ${weaponId} (full player)${noAttackHint}`,
          6, preview.height - 6,
        );
        return true;
      }
      // Construction failed: fall back to the sheet body, but say why.
      pctx.restore();
      pctx.fillStyle = '#b13e53';
      pctx.font = '11px monospace';
      pctx.fillText('player unavailable: ' + this.posePlayerError.slice(0, 44), 6, preview.height - 6);
      return true;
    }

    // Body: the sheet being edited, or the registered knight when the
    // edited sheet is the weapon itself. Draw size comes from the sprite's
    // DECLARED geometry (knight art is 35x63 cells drawn at 10x18), never
    // from the baked image — the game scales exactly the same way.
    let bodyImg: HTMLCanvasElement;
    let frame: number;
    let dw: number;
    let dh: number;
    if (bodySel === 'knight') {
      const set = KNIGHT_ANIMS.right;
      const ka = set[animName] ?? set.idle;
      frame = ka.loop === false
        ? Math.min(Math.floor(tIn * ka.fps), ka.frames.length - 1)
        : Math.floor(tIn * ka.fps) % ka.frames.length;
      bodyImg = ka.frames[frame];
      dw = baseKnight.w;
      dh = baseKnight.h;
    } else {
      frame = a.loop === false
        ? Math.min(Math.floor(tIn * fps), a.frames.length - 1)
        : Math.floor(tIn * fps) % a.frames.length;
      const rows = a.frames[frame];
      bodyImg = sprite(file.hd === false ? rows : epx(epx(rows)), file.palette);
      const geo = geometryOf(file, rows);
      dw = geo.w;
      dh = geo.h;
    }

    pctx.save();
    pctx.translate(fx, fy);
    pctx.drawImage(bodyImg, -dw / 2, -dh, dw, dh);
    // The weapon draw needs an animation its sheet actually has; outside
    // an attack pose, fall back to idle rather than throwing mid-paint.
    const known = weaponVisuals.get(wdef.visual).animations;
    const weaponAnim = !known || known.includes(animName) ? animName : 'idle';
    drawHeldWeapon(pctx, wdef.visual, {
      facing: 1, anim: weaponAnim, frame, animT: tIn,
      bodyW: dw, bodyH: dh, attack: pose,
    });
    pctx.restore();

    if (pose && options.trail) {
      drawWeaponTrail(pctx, wdef.visual, {
        x: fx, y: fy - dh * 0.45, facing: 1,
        colors: [...wdef.colors], attack: pose,
      });
    }
    // dw/dh are the sprite's DECLARED physical dims (see above), which is
    // the body the game's box math would use.
    if (pose && options.hitbox) {
      drawAttackBox(pctx, pose.def, { x: fx - dw / 2, y: fy - dh, w: dw, h: dh }, pose.progress);
    }
    pctx.restore();

    pctx.fillStyle = '#ffcd75';
    pctx.font = '11px monospace';
    pctx.fillText(
      `${animName}${moveTag} + ${weaponId}${noAttackHint}`,
      6, preview.height - 6,
    );
    return true;
  }
}
