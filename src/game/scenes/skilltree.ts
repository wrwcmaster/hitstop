import {
  type Scene,
  drawPanel,
  drawText,
  t,
  treeNodeDef,
  clamp,
} from '@engine/index';
import { classes } from '../content/classes';
import { COLORS } from '../content/palette';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';

/**
 * The skill tree screen, one small tree per class. A header row of class
 * tabs sits above the grid: left/right there browses the other classes'
 * trees, confirm on an inactive tab *becomes* that class (free,
 * non-destructive — every class keeps its unlocks; see Player.setClass).
 * Nodes unlock only in the active class's tree.
 */
export class SkillTreeScene implements Scene {
  /** Which class's tree is on screen (index into classes.ids()). */
  private view: number;
  private branch = 0;
  /** Selected tier; -1 selects the class tab header. */
  private tier = 0;
  private message = '';
  private messageT = 0;
  private blinkT = 0;
  private classIds = classes.ids();

  constructor(
    private game: ActionGame,
    private player: Player,
  ) {
    this.view = Math.max(0, this.classIds.indexOf(player.classId));
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private get viewedId(): string {
    return this.classIds[this.view];
  }

  private get viewedDef() {
    return classes.get(this.viewedId);
  }

  private get grid(): string[][] {
    return this.viewedDef.grid;
  }

  private get selectedId(): string | null {
    if (this.tier < 0) return null;
    return this.grid[this.branch][this.tier] ?? null;
  }

  /** Panel + node grid geometry, shared by render and tap hit-testing. */
  private layout() {
    const gm = this.game;
    const branches = this.grid.length;
    const tallest = Math.max(...this.grid.map((b) => b.length));
    const bw = Math.max(220, branches * 110);
    const bh = 96 + tallest * 34;
    const x = (gm.width - bw) / 2;
    const y = (gm.height - bh) / 2;
    const colW = bw / branches;
    return { bw, bh, x, y, colW, nodeW: 62, nodeH: 20, topY: y + 52, gapY: 34, tabY: y + 20 };
  }

  private nodeRect(b: number, tr: number): { x: number; y: number; w: number; h: number } {
    const L = this.layout();
    const cx = L.x + L.colW * b + L.colW / 2;
    return { x: cx - L.nodeW / 2, y: L.topY + tr * L.gapY, w: L.nodeW, h: L.nodeH };
  }

  private say(msg: string): void {
    this.message = msg;
    this.messageT = 2;
  }

  /** Confirm on the header: become the viewed class. */
  private tryBecome(): void {
    const p = this.player;
    if (this.viewedId === p.classId) {
      this.say(t('Already your calling'));
      this.game.sfx.play('denied');
      return;
    }
    p.setClass(this.viewedId);
    this.game.sfx.play('unlock');
    this.game.feel.flash(0.15, this.viewedDef.color);
    this.say(t('{name} now walks this road', { name: t(this.viewedDef.name) }));
  }

  private tryUnlock(): void {
    const p = this.player;
    const id = this.selectedId;
    if (!id) {
      this.tryBecome();
      return;
    }
    if (this.viewedId !== p.classId) {
      this.say(t('Change class to walk this path'));
      this.game.sfx.play('denied');
      return;
    }
    if (p.tree.has(id)) {
      this.say(t('Already learned'));
      this.game.sfx.play('denied');
      return;
    }
    if (!p.tree.reachable(id)) {
      this.say(t('Learn the node above first'));
      this.game.sfx.play('denied');
      return;
    }
    if (p.tree.unlock(id, p.progression, { game: this.game, player: p })) {
      this.game.sfx.play('unlock');
      this.say(t('{name} LEARNED!', { name: t(treeNodeDef(id).name) }));
      this.game.feel.flash(0.15, COLORS.gold);
    } else {
      this.say(t('Not enough skill points'));
      this.game.sfx.play('denied');
    }
  }

  private switchView(dir: number): void {
    this.view = (this.view + dir + this.classIds.length) % this.classIds.length;
    this.branch = 0;
    this.tier = Math.min(this.tier, 0);
    this.game.sfx.play('menuMove');
  }

  /** Tap: tabs switch/become; a node tap selects, a second tap learns. */
  private tapAt(px: number, py: number): void {
    const L = this.layout();
    // The tab strip: thirds of the panel width.
    if (py > L.tabY - 8 && py < L.tabY + 12) {
      const third = (px - L.x) / L.bw;
      if (third > 0.66) return this.switchView(1);
      if (third < 0.33) return this.switchView(-1);
      if (this.tier === -1) this.tryBecome();
      else { this.tier = -1; this.game.sfx.play('menuMove'); }
      return;
    }
    for (let b = 0; b < this.grid.length; b++) {
      for (let tr = 0; tr < this.grid[b].length; tr++) {
        const r = this.nodeRect(b, tr);
        // Pad the hit zone toward the row gap so thumbs land.
        if (px < r.x - 8 || px > r.x + r.w + 8 || py < r.y - 6 || py > r.y + r.h + 6) continue;
        if (this.branch === b && this.tier === tr) {
          this.tryUnlock();
        } else {
          this.branch = b;
          this.tier = tr;
          this.game.sfx.play('menuMove');
        }
        return;
      }
    }
  }

  update(dt: number): void {
    this.blinkT += dt;
    this.messageT = Math.max(0, this.messageT - dt);
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel')) {
      this.game.sfx.play('menuClose');
      this.game.scenes.pop();
      return;
    }
    if (input.consumePress('left')) {
      if (this.tier < 0) this.switchView(-1);
      else {
        this.branch = clamp(this.branch - 1, 0, this.grid.length - 1);
        this.tier = clamp(this.tier, 0, this.grid[this.branch].length - 1);
        this.game.sfx.play('menuMove');
      }
    }
    if (input.consumePress('right')) {
      if (this.tier < 0) this.switchView(1);
      else {
        this.branch = clamp(this.branch + 1, 0, this.grid.length - 1);
        this.tier = clamp(this.tier, 0, this.grid[this.branch].length - 1);
        this.game.sfx.play('menuMove');
      }
    }
    if (input.consumePress('up')) {
      this.tier = Math.max(-1, this.tier - 1);
      this.game.sfx.play('menuMove');
    }
    if (input.consumePress('down')) {
      this.tier = clamp(this.tier + 1, -1, this.grid[this.branch].length - 1);
      this.game.sfx.play('menuMove');
    }
    if (input.consumePress('confirm')) this.tryUnlock();
    const tap = input.consumeTap();
    if (tap) this.tapAt(tap.x, tap.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const p = this.player;
    const def = this.viewedDef;
    const active = this.viewedId === p.classId;
    const { bw, bh, x, y, colW, nodeW, nodeH, gapY, tabY } = this.layout();
    g.fillStyle = 'rgba(7,7,13,0.7)';
    g.fillRect(0, 0, gm.width, gm.height);
    drawPanel(g, x, y, bw, bh);
    drawText(g, t('SKILL TREE'), gm.width / 2, y + 7, COLORS.gold, 1, 'center');
    drawText(g, `LV ${p.progression.level}`, x + 12, y + 8, COLORS.white);
    drawText(g, `SP ${p.progression.skillPoints}`, x + bw - 12, y + 8, COLORS.gold, 1, 'right');

    // Class tabs: "< MAGE >", gold-boxed when it's your class, with the
    // header cursor when selected.
    const tabSel = this.tier === -1;
    drawText(g, '<', x + 16, tabY, COLORS.steel, 1, 'center');
    drawText(g, '>', x + bw - 16, tabY, COLORS.steel, 1, 'center');
    drawText(g, t(def.name), gm.width / 2, tabY, active ? def.color : COLORS.steel, 1, 'center');
    if (tabSel && Math.floor(this.blinkT * 4) % 2 === 0) {
      g.strokeStyle = def.color;
      g.strokeRect(gm.width / 2 - 62.5, tabY - 4.5, 125, 15);
    }

    this.grid.forEach((branchNodes, b) => {
      const cx = x + colW * b + colW / 2;
      drawText(g, t(def.branchNames[b]), cx, y + 38, COLORS.steelDark, 1, 'center');
      branchNodes.forEach((id, tier) => {
        const nd = treeNodeDef(id);
        const { x: nx, y: ny } = this.nodeRect(b, tier);
        const owned = active ? p.tree.has(id) : this.ownedDormant(id);

        // Connector to the node above.
        if (tier > 0) {
          const prevOwned = active ? p.tree.has(branchNodes[tier - 1]) : this.ownedDormant(branchNodes[tier - 1]);
          g.strokeStyle = prevOwned ? def.color : COLORS.navyLight;
          g.beginPath();
          g.moveTo(cx, ny - gapY + nodeH);
          g.lineTo(cx, ny);
          g.stroke();
        }

        const canBuy = active && p.tree.available(id, p.progression.skillPoints);
        const reachable = active && p.tree.reachable(id);

        // Node box: owned = class-color fill, buyable = white border,
        // reachable-but-poor = steel, locked/foreign = dark.
        g.fillStyle = owned ? def.color : '#0d1026';
        g.fillRect(nx, ny, nodeW, nodeH);
        g.strokeStyle = owned ? def.color : canBuy ? COLORS.white : reachable ? COLORS.steelDark : COLORS.navyLight;
        g.lineWidth = 1;
        g.strokeRect(nx + 0.5, ny + 0.5, nodeW - 1, nodeH - 1);

        const textColor = owned ? '#07070d' : canBuy ? COLORS.white : reachable ? COLORS.steel : COLORS.steelDark;
        drawText(g, t(nd.name), cx, ny + 4, textColor, 1, 'center');
        drawText(g, owned ? t('OWNED') : `${nd.cost} SP`, cx, ny + 12, owned ? '#07070d' : COLORS.steelDark, 1, 'center');

        // Selection cursor.
        if (b === this.branch && tier === this.tier && Math.floor(this.blinkT * 4) % 2 === 0) {
          g.strokeStyle = COLORS.gold;
          g.strokeRect(nx - 2.5, ny - 2.5, nodeW + 5, nodeH + 5);
        }
      });
    });

    // Detail strip: class blurb on the header, node description on a
    // node, flash messages over either.
    const descY = y + bh - 22;
    g.strokeStyle = COLORS.navyLight;
    g.beginPath();
    g.moveTo(x + 8, descY - 5);
    g.lineTo(x + bw - 8, descY - 5);
    g.stroke();
    if (this.messageT > 0) {
      drawText(g, this.message, gm.width / 2, descY, COLORS.gold, 1, 'center');
    } else if (this.tier === -1) {
      const hint = active ? t(def.desc) : t('Z: become a {name}', { name: t(def.name) });
      drawText(g, hint, gm.width / 2, descY, active ? COLORS.steel : def.color, 1, 'center');
    } else {
      const sel = this.selectedId;
      drawText(g, sel ? t(treeNodeDef(sel).desc) : '', gm.width / 2, descY, COLORS.steel, 1, 'center');
    }
    drawText(g, t('Z: learn - up: class - Esc: back'), gm.width / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
  }

  /** Is a node owned in a *dormant* class's remembered tree? */
  private ownedDormant(id: string): boolean {
    return (this.player.snapshotTrees()[this.viewedId] ?? []).includes(id);
  }
}
