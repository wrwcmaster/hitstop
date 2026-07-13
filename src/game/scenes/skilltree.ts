import {
  type Scene,
  drawPanel,
  drawText,
  treeNodeDef,
  clamp,
} from '@engine/index';
import { TREE_GRID, BRANCH_NAMES } from '../content/skilltree';
import { COLORS } from '../content/palette';
import type { ActionGame } from '../defs';
import type { Player } from '../actors/player';

/**
 * The skill tree screen: three branches side by side, tiers top to
 * bottom, connectors showing prerequisites. Navigate with arrows,
 * unlock with confirm, close with Esc.
 */
export class SkillTreeScene implements Scene {
  private branch = 0;
  private tier = 0;
  private message = '';
  private messageT = 0;
  private blinkT = 0;

  constructor(
    private game: ActionGame,
    private player: Player,
  ) {}

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private get selectedId(): string {
    return TREE_GRID[this.branch][this.tier];
  }

  private say(msg: string): void {
    this.message = msg;
    this.messageT = 2;
  }

  private tryUnlock(): void {
    const p = this.player;
    const id = this.selectedId;
    if (p.tree.has(id)) {
      this.say('Already learned');
      this.game.sfx.play('denied');
      return;
    }
    if (!p.tree.reachable(id)) {
      this.say('Learn the node above first');
      this.game.sfx.play('denied');
      return;
    }
    if (p.tree.unlock(id, p.progression, { game: this.game, player: p })) {
      this.game.sfx.play('unlock');
      this.say(`${treeNodeDef(id).name} LEARNED!`);
      this.game.feel.flash(0.15, COLORS.gold);
    } else {
      this.say('Not enough skill points');
      this.game.sfx.play('denied');
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
    const move = (db: number, dtier: number) => {
      this.branch = clamp(this.branch + db, 0, TREE_GRID.length - 1);
      this.tier = clamp(this.tier + dtier, 0, TREE_GRID[this.branch].length - 1);
      this.game.sfx.play('menuMove');
    };
    if (input.consumePress('left')) move(-1, 0);
    if (input.consumePress('right')) move(1, 0);
    if (input.consumePress('up')) move(0, -1);
    if (input.consumePress('down')) move(0, 1);
    if (input.consumePress('confirm')) this.tryUnlock();
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const p = this.player;
    const bw = 280;
    const bh = 200;
    const x = (gm.width - bw) / 2;
    const y = (gm.height - bh) / 2;
    g.fillStyle = 'rgba(7,7,13,0.7)';
    g.fillRect(0, 0, gm.width, gm.height);
    drawPanel(g, x, y, bw, bh);
    drawText(g, 'SKILL TREE', gm.width / 2, y + 7, COLORS.gold, 2, 'center');
    drawText(g, `LV ${p.progression.level}`, x + 12, y + 8, COLORS.white);
    drawText(g, `SP ${p.progression.skillPoints}`, x + bw - 12, y + 8, COLORS.gold, 1, 'right');

    const colW = bw / 3;
    const nodeW = 58;
    const nodeH = 20;
    const topY = y + 34;
    const gapY = 34;

    TREE_GRID.forEach((branchNodes, b) => {
      const cx = x + colW * b + colW / 2;
      drawText(g, BRANCH_NAMES[b], cx, y + 22, COLORS.steelDark, 1, 'center');
      branchNodes.forEach((id, t) => {
        const def = treeNodeDef(id);
        const nx = cx - nodeW / 2;
        const ny = topY + t * gapY;

        // Connector to the node above.
        if (t > 0) {
          const owned = p.tree.has(branchNodes[t - 1]);
          g.strokeStyle = owned ? COLORS.gold : COLORS.navyLight;
          g.beginPath();
          g.moveTo(cx, ny - gapY + nodeH);
          g.lineTo(cx, ny);
          g.stroke();
        }

        const owned = p.tree.has(id);
        const canBuy = p.tree.available(id, p.progression.skillPoints);
        const reachable = p.tree.reachable(id);

        // Node box: owned = gold fill, buyable = white border,
        // reachable-but-poor = steel, locked = dark.
        g.fillStyle = owned ? COLORS.gold : '#0d1026';
        g.fillRect(nx, ny, nodeW, nodeH);
        g.strokeStyle = owned ? COLORS.gold : canBuy ? COLORS.white : reachable ? COLORS.steelDark : COLORS.navyLight;
        g.lineWidth = 1;
        g.strokeRect(nx + 0.5, ny + 0.5, nodeW - 1, nodeH - 1);

        const textColor = owned ? '#07070d' : canBuy ? COLORS.white : reachable ? COLORS.steel : COLORS.steelDark;
        drawText(g, def.name, cx, ny + 4, textColor, 1, 'center');
        drawText(g, owned ? 'OWNED' : `${def.cost} SP`, cx, ny + 12, owned ? '#07070d' : COLORS.steelDark, 1, 'center');

        // Selection cursor.
        if (b === this.branch && t === this.tier && Math.floor(this.blinkT * 4) % 2 === 0) {
          g.strokeStyle = COLORS.gold;
          g.strokeRect(nx - 2.5, ny - 2.5, nodeW + 5, nodeH + 5);
        }
      });
    });

    // Detail strip: selected node description / flash messages.
    const sel = treeNodeDef(this.selectedId);
    const descY = y + bh - 22;
    g.strokeStyle = COLORS.navyLight;
    g.beginPath();
    g.moveTo(x + 8, descY - 5);
    g.lineTo(x + bw - 8, descY - 5);
    g.stroke();
    if (this.messageT > 0) {
      drawText(g, this.message, gm.width / 2, descY, COLORS.gold, 1, 'center');
    } else {
      drawText(g, sel.desc, gm.width / 2, descY, COLORS.steel, 1, 'center');
    }
    drawText(g, 'Z: learn - Esc: back', gm.width / 2, y + bh - 11, COLORS.steelDark, 1, 'center');
  }
}
