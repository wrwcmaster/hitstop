import { clamp, drawText, textWidth, tiles, type TriggerDef } from '@engine/index';
import { COLORS } from '../../content/palette';
import type { DoorOpening } from './door-transition';

/** Read-only presentation inputs; rendering cannot move an actor or change a room. */
export interface DoorSignView {
  player: { cx: number } | null;
  bounds: { worldW: number; worldH: number };
  camera: { x: number; y: number; viewW: number; viewH: number };
  triggers: readonly TriggerDef[];
  label: (door: TriggerDef) => string;
}

export function renderDoorSigns(ctx: CanvasRenderingContext2D, state: DoorSignView): void {
  const p = state.player;
  const worldW = state.bounds.worldW;
  const viewLeft = state.camera.x;
  const viewRight = viewLeft + state.camera.viewW;
  for (const z of state.triggers) {
    if (z.event !== 'door') continue;
    const doorX = z.x + z.w / 2;
    const label = state.label(z);
    const words = label.split(/\s+/);
    let lines = [label];
    if (textWidth(label) > 48 && words.length > 1) {
      let split = 1;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 1; i < words.length; i++) {
        const left = words.slice(0, i).join(' ');
        const right = words.slice(i).join(' ');
        const score = Math.max(textWidth(left), textWidth(right));
        if (score < best) {
          best = score;
          split = i;
        }
      }
      lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    }
    // Edge doors and scrolling rooms can put the authored door centre
    // outside the readable viewport. Clamp by the actual widest line,
    // not a fixed margin, so no destination name can be clipped.
    const halfWidth = Math.max(...lines.map((line) => textWidth(line))) / 2;
    const left = Math.max(0, viewLeft) + halfWidth + 2;
    const right = Math.min(worldW, viewRight) - halfWidth - 2;
    const textX = left <= right ? clamp(doorX, left, right) : (left + right) / 2;
    const near = p ? Math.abs(p.cx - doorX) < 70 : false;
    const besidePortal = (state.triggers).some((other) => (
      other.event === 'portal'
      && Math.abs((other.x + other.w / 2) - doorX) < 70
      && Math.abs((other.y + other.h / 2) - (z.y + z.h / 2)) < 70
    ));
    ctx.globalAlpha = near ? 1 : 0.45;
    const lineHeight = 8;
    // Above the doorway by preference — but a ceiling door's "above" is
    // outside the room, and the frame no longer extends past the roof to
    // cover for it. Clamp into the room the same way the line above
    // clamps horizontally, so the sign drops below the lintel instead
    // of demanding a strip of void to live in.
    const top = Math.max(0, state.camera.y) + 2;
    const bottom = Math.min(state.bounds.worldH, state.camera.y + state.camera.viewH)
      - lines.length * lineHeight - 2;
    const wanted = z.y - 9 - (lines.length - 1) * lineHeight - (besidePortal ? 14 : 0);
    const textY = top <= bottom ? clamp(wanted, top, bottom) : wanted;
    lines.forEach((line, index) => {
      drawText(ctx, line, textX, textY + index * lineHeight, near ? COLORS.gold : COLORS.steel, 1, 'center');
    });
    ctx.globalAlpha = 1;
  }
}


export function renderDoorOpening(ctx: CanvasRenderingContext2D, o: DoorOpening | undefined, ts: number, duration: number): void {
  if (!o) return;
  const p = clamp(1 - o.left / duration, 0, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(o.x, o.y, o.w, o.h);
  ctx.clip();
  ctx.fillStyle = '#07070d';
  ctx.fillRect(o.x, o.y, o.w, o.h);
  const lift = Math.round(p * (o.h + ts));
  const gate = tiles.get('gate');
  for (let i = 0; i * ts < o.h + ts; i++) {
    gate.draw?.(ctx, o.x, o.y + i * ts - lift, ts, 0, i);
  }
  ctx.restore();
}

export function renderDoorPrompt(ctx: CanvasRenderingContext2D, z: TriggerDef, key: string, dest: string, time: number): void {
  const label = key ? `${key}  ${dest}` : dest;
  const bob = Math.sin(time * 4) * 1.5;
  drawText(ctx, label, z.x + z.w / 2, z.y - 6 + bob, COLORS.gold, 1, 'center');
}
