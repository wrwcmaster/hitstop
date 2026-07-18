import { drawText, Menu, t, type Input } from '@engine/index';
import { VERSION, COARSE_POINTER, menuLine, type ActionGame, type Action } from '../../defs';
import { COLORS } from '../../content/palette';
import { KNIGHT_IDLE_SPRITE, TEXEL } from '../../content/sprites';
import { saveStore, newestSave } from '../../save';

/**
 * The title screen: the menu plus its full-screen render. The scene tells
 * it what each entry does; everything visual lives here. Entries are
 * navigable (keys/pad) and tappable (mobile).
 */
export class TitleScreen {
  private menu: Menu<Action>;

  constructor(
    private game: ActionGame,
    actions: {
      newGame(): void;
      continueRun(): void;
      loadGame(): void;
      coop(): void;
      testRoom(): void;
      watchReplay(): void;
      options(): void;
    },
  ) {
    this.menu = new Menu<Action>(
      [
        { label: 'NEW GAME', onSelect: actions.newGame },
        {
          label: 'CONTINUE',
          disabled: () => newestSave() === null,
          onSelect: actions.continueRun,
        },
        {
          label: 'LOAD GAME',
          disabled: () => newestSave() === null,
          onSelect: actions.loadGame,
        },
        { label: 'CO-OP', onSelect: actions.coop },
        { label: 'TEST ROOM', onSelect: actions.testRoom },
        { label: 'WATCH REPLAY', onSelect: actions.watchReplay },
        { label: 'OPTIONS', onSelect: actions.options },
      ],
      { up: 'up', down: 'down', confirm: 'confirm' },
    );
  }

  update(input: Input<Action>): void {
    this.menu.update(input);
    const t = input.consumeTap();
    if (t) this.menu.tapAt(t.x, t.y);
  }

  render(g: CanvasRenderingContext2D): void {
    const gm = this.game;
    g.fillStyle = 'rgba(7,7,13,0.55)';
    g.fillRect(0, 0, gm.width, gm.height);
    g.save();
    const kw = KNIGHT_IDLE_SPRITE.width / TEXEL;
    const kh = KNIGHT_IDLE_SPRITE.height / TEXEL;
    // A compact hero portrait sitting in the band between the subtitle and
    // the menu, so it never overlaps the title text.
    const ks = 1.0;
    const midY = 118;
    g.translate(gm.width / 2 - (kw * ks) / 2, midY - (kh * ks) / 2);
    g.scale(ks, ks);
    g.drawImage(KNIGHT_IDLE_SPRITE, 0, 0, kw, kh);
    g.restore();
    drawText(g, 'HITSTOP', gm.width / 2, 48, COLORS.white, 4, 'center');
    drawText(g, t('Game feel is the foundation'), gm.width / 2, 80, COLORS.steel, 1, 'center');
    // Touch: taller, thumb-sized rows, and no keyboard hints (they'd be
    // wrong — everything here is tappable and the pad has its buttons).
    // Seven entries now — tighter rows so the list clears the hints
    // (desktop) and the screen bottom (touch).
    this.menu.render(g, gm.width / 2 - 24, COARSE_POINTER ? 140 : 146, { lineHeight: menuLine(12), width: 60 });
    if (!COARSE_POINTER) {
      drawText(g, t('Move: Arrows / WASD - Jump: Space'), gm.width / 2, 232, COLORS.steelDark, 1, 'center');
      drawText(g, t('Attack: Z - Dash: X - Parry: F - Skill: C'), gm.width / 2, 242, COLORS.steelDark, 1, 'center');
      drawText(g, t('Z or Enter to select'), gm.width / 2, 254, COLORS.gold, 1, 'center');
    }
    // Small build version, tucked in the corner.
    drawText(g, `v${VERSION}`, gm.width - 6, gm.height - 10, COLORS.steelDark, 1, 'right');
  }
}

/** The game-over overlay. `ready` = the "press any key" gate has elapsed. */
export function renderGameOver(
  g: CanvasRenderingContext2D,
  game: ActionGame,
  view: { score: number; best: number; ready: boolean },
): void {
  g.fillStyle = 'rgba(7,7,13,0.55)';
  g.fillRect(0, 0, game.width, game.height);
  drawText(g, t('GAME OVER'), game.width / 2, 70, COLORS.red, 4, 'center');
  drawText(g, t('SCORE {n}', { n: view.score }), game.width / 2, 110, COLORS.white, 2, 'center');
  drawText(g, t('BEST {n}', { n: view.best }), game.width / 2, 130, COLORS.steel, 1, 'center');
  if (saveStore.exists()) {
    drawText(g, t('You will wake at the last gate'), game.width / 2, 148, COLORS.steel, 1, 'center');
  }
  if (view.ready && Math.floor(performance.now() / 400) % 2) {
    drawText(g, t('Press any key'), game.width / 2, 190, COLORS.gold, 2, 'center');
  }
}
