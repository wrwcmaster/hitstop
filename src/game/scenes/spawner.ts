import {
  type Scene,
  Menu,
  drawPanel,
  drawText,
  items,
  itemDef,
  type CollisionSource,
} from '@engine/index';
import { COLORS } from '../content/palette';
import { menuLine, type ActionGame, type Action } from '../defs';
import type { Player } from '../actors/player';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';
import { placeablesIn, type Placeable } from '../content/placeables';

/**
 * A dev/test panel overlay for spawning items, enemies, and bosses in the
 * test room. Menus are built from the placeables and item registries, so
 * new content shows up here automatically.
 */
export class SpawnerScene implements Scene {
  private menu!: Menu<Action>;
  private subMenu: 'main' | 'monsters' | 'bosses' | 'items' = 'main';

  constructor(
    private game: ActionGame,
    private player: Player,
    private tilemap: CollisionSource,
  ) {
    this.showMainMenu();
  }

  enter(): void {
    this.game.sfx.play('menuOpen');
  }

  private showMainMenu(): void {
    this.subMenu = 'main';
    this.menu = new Menu<Action>([
      {
        label: 'SPAWN MONSTERS',
        onSelect: () => this.showMonstersMenu(),
      },
      {
        label: 'SPAWN BOSSES',
        onSelect: () => this.showBossesMenu(),
      },
      {
        label: 'SPAWN ITEMS',
        onSelect: () => this.showItemsMenu(),
      },
      {
        label: 'CLEAR ALL SPAWNS',
        onSelect: () => this.clearSpawns(),
      },
      {
        label: 'EXIT',
        onSelect: () => this.close(),
      },
    ], { up: 'up', down: 'down', confirm: 'confirm' });
  }

  private showMonstersMenu(): void {
    this.subMenu = 'monsters';
    this.menu = this.placeableMenu(placeablesIn('enemy'));
  }

  private showBossesMenu(): void {
    this.subMenu = 'bosses';
    this.menu = this.placeableMenu(placeablesIn('boss'));
  }

  /** One menu entry per placeable of a category, plus BACK. */
  private placeableMenu(list: [string, Placeable][]): Menu<Action> {
    return new Menu<Action>([
      ...list.map(([id, p]) => ({
        label: p.label,
        onSelect: () => this.spawnPlaceable(id, p),
      })),
      { label: 'BACK', onSelect: () => this.showMainMenu() },
    ], { up: 'up', down: 'down', confirm: 'confirm' });
  }

  private showItemsMenu(): void {
    this.subMenu = 'items';
    // Every non-instant item is spawnable (instants like coins are dull here).
    const spawnable = items.ids().filter((id) => itemDef(id).kind !== 'instant');
    this.menu = new Menu<Action>([
      ...spawnable.map((id) => ({
        label: itemDef(id).name,
        onSelect: () => this.spawnItem(id),
      })),
      { label: 'BACK', onSelect: () => this.showMainMenu() },
    ], { up: 'up', down: 'down', confirm: 'confirm' });
  }

  private spawnPlaceable(id: string, p: Placeable): void {
    const player = this.player;
    // Drop it 32px in front of the player, feet on the player's ground line.
    const e = { type: id, x: player.cx + player.facing * 32 - p.w / 2, y: player.y + player.h - p.h };
    p.spawn({ game: this.game, tilemap: this.tilemap, flags: new Set() }, e);
    this.game.feel.burst(e.x + p.w / 2, e.y + p.h / 2, 12, { color: p.colors, speed: 70, life: 0.35, drag: 3 });
    this.game.sfx.play('buy');

    if (this.subMenu === 'monsters') this.showMonstersMenu();
    else if (this.subMenu === 'bosses') this.showBossesMenu();
  }

  private spawnItem(itemId: string): void {
    const p = this.player;
    const sx = p.cx + p.facing * 32;
    const sy = p.y - 8;

    this.game.world.spawn(new Pickup(itemId, this.game, this.tilemap, sx, sy));
    this.game.sfx.play('buy');

    this.showItemsMenu();
  }

  private clearSpawns(): void {
    for (const a of this.game.world.actors()) {
      if (a instanceof Monster || a instanceof Pickup) {
        a.dead = true;
      }
    }
    this.game.sfx.play('kill');
    this.showMainMenu();
  }

  private close(): void {
    this.game.sfx.play('menuClose');
    this.game.scenes.pop();
  }

  update(dt: number): void {
    const input = this.game.input;
    if (input.consumePress('menu') || input.consumePress('cancel')) {
      if (this.subMenu !== 'main') {
        this.game.sfx.play('menuClose');
        this.showMainMenu();
      } else {
        this.close();
      }
      return;
    }
    this.menu.update(input);
    const t = input.consumeTap();
    if (t) this.menu.tapAt(t.x, t.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    const lh = menuLine(11);
    const bw = 200;
    const bh = Math.min(gm.height - 16, 52 + this.menu.entries.length * lh);
    const x = (gm.width - bw) / 2;
    const y = (gm.height - bh) / 2;

    g.fillStyle = 'rgba(7, 7, 13, 0.6)';
    g.fillRect(0, 0, gm.width, gm.height);

    drawPanel(g, x, y, bw, bh);
    
    let title = 'TEST ROOM MENU';
    if (this.subMenu === 'monsters') title = 'SPAWN MONSTER';
    else if (this.subMenu === 'bosses') title = 'SPAWN BOSS';
    else if (this.subMenu === 'items') title = 'SPAWN ITEM';

    drawText(g, title, gm.width / 2, y + 8, COLORS.gold, 2, 'center');

    this.menu.render(g, x + 24, y + 26, { width: bw - 48, lineHeight: lh });
    drawText(g, 'Esc: back / exit', gm.width / 2, y + bh - 10, COLORS.steelDark, 1, 'center');
  }
}
