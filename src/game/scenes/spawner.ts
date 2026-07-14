import {
  type Scene,
  Menu,
  drawPanel,
  drawText,
  type CollisionSource,
} from '@engine/index';
import { COLORS } from '../content/palette';
import type { ActionGame, Action } from '../defs';
import type { Player } from '../actors/player';
import { Monster } from '../actors/monster';
import { Pickup } from '../actors/pickup';

/**
 * A dev/test panel overlay for spawning items, enemies, and bosses in the test room.
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
    this.menu = new Menu<Action>([
      { label: 'SLIME', onSelect: () => this.spawnMonster('slime') },
      { label: 'BAT', onSelect: () => this.spawnMonster('bat') },
      { label: 'BRUTE', onSelect: () => this.spawnMonster('brute') },
      { label: 'DEVOURER', onSelect: () => this.spawnMonster('devourer') },
      { label: 'BACK', onSelect: () => this.showMainMenu() },
    ], { up: 'up', down: 'down', confirm: 'confirm' });
  }

  private showBossesMenu(): void {
    this.subMenu = 'bosses';
    this.menu = new Menu<Action>([
      { label: 'SLIME KING', onSelect: () => this.spawnMonster('slime-king') },
      { label: 'BACK', onSelect: () => this.showMainMenu() },
    ], { up: 'up', down: 'down', confirm: 'confirm' });
  }

  private showItemsMenu(): void {
    this.subMenu = 'items';
    this.menu = new Menu<Action>([
      { label: 'RUSTY SWORD', onSelect: () => this.spawnItem('rusty-sword') },
      { label: 'GREAT SWORD', onSelect: () => this.spawnItem('great-sword') },
      { label: 'IRON CHARM', onSelect: () => this.spawnItem('iron-charm') },
      { label: 'STEEL ARMOR', onSelect: () => this.spawnItem('steel-armor') },
      { label: 'POTION', onSelect: () => this.spawnItem('potion') },
      { label: 'HASTE DRAUGHT', onSelect: () => this.spawnItem('haste-draught') },
      { label: 'BACK', onSelect: () => this.showMainMenu() },
    ], { up: 'up', down: 'down', confirm: 'confirm' });
  }

  private spawnMonster(type: string): void {
    const p = this.player;
    // Spawn 32px in front of player
    const sx = p.cx + p.facing * 32;
    const sy = p.y;
    
    const m = this.game.world.spawn(new Monster(type, this.game, this.tilemap, sx, sy));
    this.game.feel.burst(m.cx, m.cy, 12, { color: m.def.colors, speed: 70, life: 0.35, drag: 3 });
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
    const bw = 200;
    const bh = 130;
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

    this.menu.render(g, x + 24, y + 26, { width: bw - 48, lineHeight: 11 });
    drawText(g, 'Esc: back / exit', gm.width / 2, y + bh - 10, COLORS.steelDark, 1, 'center');
  }
}
