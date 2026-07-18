import { drawText, textWidth, Minimap, t } from '@engine/index';
import { Monster } from '../../actors/monster';
import { Pickup } from '../../actors/pickup';
import { COLORS } from '../../content/palette';
import {
  HEART,
  HEART_EMPTY,
  MANA_PIP,
  MANA_PIP_EMPTY,
  ICON_COIN,
  ICON_KEY,
  TEXEL,
  blit,
} from '../../content/sprites';
import { quests } from '../../content/quests';
import type { PlayHost } from './host';

/** A keyed door in the current room, for the floating gate marker. */
export interface GateMarker {
  x: number;
  y: number;
  keyId: string;
}

/** The scene state the HUD reads each frame (it owns none of it). */
export interface HudView {
  score: number;
  combo: number;
  comboT: number;
  banner: string;
  bannerT: number;
  /** Center-top label: "WAVE 3" or the room name. */
  label: string;
  /** Free-running clock for idle wobble. */
  uiT: number;
}

/**
 * All in-game screen-space drawing: vitals, purse, level, statuses, the
 * swallowed prompt, score, minimap, boss bar, combo meter, banners — plus
 * the world-space gate marker. Pure rendering; state lives in the scene.
 */
export class Hud {
  constructor(private host: PlayHost) {}

  render(g: CanvasRenderingContext2D, view: HudView, minimap: Minimap, boss: Monster | null): void {
    const gm = this.host.game;
    const p = this.host.player;
    // Underwater: a cool blue veil over the whole view sells the depth.
    if (p && p.submersion > 0.55) {
      g.fillStyle = 'rgba(40,90,180,0.16)';
      g.fillRect(0, 0, gm.width, gm.height);
    }
    if (p) {
      for (let i = 0; i < p.maxHp; i++) {
        blit(g, i < p.hp ? HEART : HEART_EMPTY, 6 + i * 9, 6);
      }
      for (let i = 0; i < p.maxMp; i++) {
        blit(g, i < p.mp ? MANA_PIP : MANA_PIP_EMPTY, 7 + i * 7, 15);
      }
      // Skill readiness: fireball cooldown wedge next to the mana row.
      const cdMax = 1.1;
      const cd = p.skills.cooldownLeft('fireball');
      const ready = p.skills.ready('fireball');
      const sx = 10 + p.maxMp * 7;
      drawText(g, 'C', sx, 15, ready ? COLORS.gold : COLORS.steelDark);
      if (cd > 0) {
        g.fillStyle = COLORS.steelDark;
        g.fillRect(sx, 21, Math.round(5 * (cd / cdMax)), 1);
      }
      // Purse.
      blit(g, ICON_COIN, 6, 23);
      drawText(g, String(p.gold), 14, 24, COLORS.gold);
      // Level + class + XP bar (+ a nudge when skill points are waiting).
      drawText(g, t('LV {n}', { n: p.progression.level }), 6, 33, COLORS.white);
      drawText(g, t(p.classDef.name), 6, 42, p.classDef.color);
      g.fillStyle = '#07070d';
      g.fillRect(28, 34, 32, 3);
      g.fillStyle = COLORS.gold;
      g.fillRect(28, 34, Math.round(32 * p.progression.fraction), 3);
      if (p.progression.skillPoints > 0 && Math.floor(p.animT * 2) % 2 === 0) {
        drawText(g, `${p.progression.skillPoints} SP - ESC`, 64, 33, COLORS.gold);
      }
      // Active buffs/debuffs: chip + remaining-time sliver.
      let by = 51; // below the class tag

      // Breath: air bubbles appear only while the meter is in play.
      if (p.air < 1) {
        for (let i = 0; i < 6; i++) {
          const filled = p.air * 6 > i + 0.5;
          g.fillStyle = filled ? COLORS.blue : COLORS.navyLight;
          g.fillRect(6 + i * 6, by, 4, 4);
          if (filled) {
            g.fillStyle = COLORS.white;
            g.fillRect(7 + i * 6, by + 1, 1, 1);
          }
        }
        by += 8;
      }
      for (const s of p.statuses.list()) {
        g.fillStyle = s.def.color;
        g.fillRect(6, by, 4, 4);
        drawText(g, s.def.name, 13, by, s.def.color);
        g.fillStyle = s.def.color;
        g.fillRect(13, by + 6, Math.round(textWidth(s.def.name) * s.fraction), 1);
        by += 10;
      }
      // Active quests: name + progress, gold once ready to turn in.
      for (const [qid, n] of p.quests.active) {
        const q = quests.get(qid);
        const ready = n >= q.kill.count;
        drawText(
          g,
          `${q.name} ${Math.min(n, q.kill.count)}/${q.kill.count}${ready ? ' !' : ''}`,
          6, by, ready ? COLORS.gold : COLORS.steel,
        );
        by += 8;
      }
      // Swallowed: the escape prompt IS the HUD priority.
      if (p.fsm.is('swallowed')) {
        drawText(g, t('MASH TO ESCAPE!'), gm.width / 2, 84, COLORS.white, 2, 'center');
        const w = 60;
        const x = gm.width / 2 - w / 2;
        g.fillStyle = '#07070d';
        g.fillRect(x - 1, 97, w + 2, 5);
        g.strokeStyle = COLORS.purple;
        g.strokeRect(x - 1.5, 96.5, w + 3, 6);
        g.fillStyle = COLORS.white;
        g.fillRect(x, 98, Math.round(w * Math.min(1, p.escapeN / p.escapeNeed)), 3);
      }
    }
    drawText(g, t('SCORE {n}', { n: view.score }), gm.width - 6, 7, COLORS.white, 1, 'right');
    drawText(g, view.label, gm.width / 2, 7, COLORS.steel, 1, 'center');
    this.renderMinimap(g, minimap);
    if (boss) this.renderBossBar(g, boss);
    if (view.combo >= 2) {
      drawText(g, t('COMBO X{n}', { n: view.combo }), gm.width / 2, 18, COLORS.gold, 1, 'center');
      g.fillStyle = COLORS.gold;
      g.fillRect(Math.round(gm.width / 2 - 15), 26, Math.round((30 * view.comboT) / 2), 2);
    }
    if (view.bannerT > 0) drawText(g, view.banner, gm.width / 2, 58, COLORS.white, 3, 'center');
  }

  private renderBossBar(g: CanvasRenderingContext2D, boss: Monster): void {
    const gm = this.host.game;
    const w = 160;
    const x = (gm.width - w) / 2;
    const y = gm.height - 18;
    drawText(g, t(boss.def.displayName ?? 'BOSS'), gm.width / 2, y - 8, COLORS.gold, 1, 'center');
    g.fillStyle = '#07070d';
    g.fillRect(x - 1, y - 1, w + 2, 6);
    g.strokeStyle = COLORS.navyLight;
    g.strokeRect(x - 1.5, y - 1.5, w + 3, 7);
    g.fillStyle = boss.hp <= boss.maxHp / 2 ? COLORS.red : COLORS.green;
    g.fillRect(x, y, Math.round(w * Math.max(0, boss.hp) / boss.maxHp), 4);
  }

  private renderMinimap(g: CanvasRenderingContext2D, minimap: Minimap): void {
    const gm = this.host.game;
    const p = this.host.player;
    const markers: { x: number; y: number; color: string; size?: number }[] = [
      ...gm.world.actors('enemy').map((e) => ({
        x: e.cx, y: e.cy, color: COLORS.red,
        size: e instanceof Monster && e.def.boss ? 2 : 1,
      })),
      ...gm.world
        .all()
        .filter((e): e is Pickup => e instanceof Pickup && !e.dead)
        .map((e) => ({ x: e.x, y: e.y, color: COLORS.gold })),
    ];
    if (p && p.hp > 0) {
      markers.push({ x: p.cx, y: p.cy, color: COLORS.green });
    }
    minimap.render(
      g,
      gm.width - minimap.width - 6,
      16,
      markers,
      { x: gm.camera.x, y: Math.max(0, gm.camera.y), w: gm.camera.viewW, h: gm.camera.viewH },
    );
  }

  /** Floating key over a locked gate (world space): dim until its key is
   * held, then lit — so "the gate now opens" reads at a glance. */
  renderGateMarker(g: CanvasRenderingContext2D, marker: GateMarker | null, uiT: number): void {
    const p = this.host.player;
    if (!marker || !p) return;
    const has = p.inventory.has(marker.keyId);
    const iw = ICON_KEY.width / TEXEL;
    const ih = ICON_KEY.height / TEXEL;
    const bob = Math.sin(uiT * 3) * 1.5;
    g.globalAlpha = has ? 1 : 0.4;
    blit(g, ICON_KEY, marker.x - iw / 2, marker.y - ih - 8 + bob);
    g.globalAlpha = 1;
  }
}
