import {
  Actor,
  Registry,
  applyGravity,
  moveAndCollide,
  drawText,
  DialogueScene,
  type ConversationChoice,
  type CollisionSource,
  type LoadedSprite,
} from '@engine/index';
import { blit, merchantSprite } from '../content/sprites';
import { COLORS } from '../content/palette';
import { ShopScene } from '../scenes/shop';
import { SpawnerScene } from '../scenes/spawner';
import { prettyCode, prettyButton, menuLine, type ActionGame, type Action } from '../defs';
import { Player } from './player';

/**
 * NPCs: friendly actors you talk to. An NpcDef is a sprite, a greeting
 * conversation, and optionally a shop. Interaction is proximity + the
 * interact key (E/F), with a floating prompt when in range.
 */
/** What an NPC's hooks get to work with. */
export interface NpcCtx {
  game: ActionGame;
  player: Player;
  npc: Npc;
}

export interface NpcDef {
  name: string;
  /** Validate per-room instance props before spawning. */
  validateProps?(props: Record<string, unknown>, path: string): void;
  sprite: LoadedSprite;
  /** Animation to render (default: idle). */
  anim?: string;
  /** Conversation played on interact — or a picker (quest states, moods). */
  greet: string | ((ctx: NpcCtx) => string);
  /** Shop opened when a choice labeled with `shopChoice` is picked. */
  shop?: string;
  /** The choice label that opens the shop (default: starts with 'show'). */
  shopChoice?: string;
  /** Service hook: runs with whatever choice ended the dialogue (healing,
   * upgrades, quest accept/turn-in...). Runs before the shop check. */
  onChoice?(choice: ConversationChoice, ctx: NpcCtx): void;
}

export const npcs = new Registry<NpcDef>('npc');

export function defineNpc(id: string, def: NpcDef): void {
  npcs.register(id, def);
}

const INTERACT_RANGE = 22;

export class Npc extends Actor {
  team = 'neutral' as const;
  def: NpcDef;

  constructor(
    public readonly type: string,
    private game: ActionGame,
    private collision: CollisionSource,
    x: number,
    y: number,
  ) {
    super();
    this.def = npcs.get(type);
    this.w = this.def.sprite.hitbox.w;
    this.h = this.def.sprite.hitbox.h;
    this.x = x;
    this.y = y;
    this.layer = 2;
  }

  private playerNear(): Player | null {
    const p = this.world.first(Player);
    if (!p || p.hp <= 0) return null;
    const dx = Math.abs(p.cx - this.cx);
    const dy = Math.abs(p.cy - this.cy);
    return dx < INTERACT_RANGE && dy < 24 ? p : null;
  }

  update(dt: number): void {
    this.tickTimers(dt);
    applyGravity(this, dt);
    moveAndCollide(this, dt, this.collision);

    const p = this.playerNear();
    if (p && this.game.input.consumePress('interact')) {
      this.facing = p.cx > this.cx ? 1 : -1;
      this.talk();
    }
  }

  /** Hook context (player is the live one; talk() only runs when near). */
  private ctx(): NpcCtx | null {
    const player = this.world.first(Player);
    return player ? { game: this.game, player, npc: this } : null;
  }

  private talk(): void {
    if (this.type === 'spawner') {
      const p = this.world.first(Player);
      if (p) this.game.scenes.push(new SpawnerScene(this.game, p, this.collision));
      return;
    }
    const ctx = this.ctx();
    if (!ctx) return;
    const greet = typeof this.def.greet === 'function' ? this.def.greet(ctx) : this.def.greet;
    this.game.scenes.push(
      new DialogueScene<Action>(this.game, greet, {
        confirm: 'confirm',
        up: 'up',
        down: 'down',
        choiceLineHeight: menuLine(10),
        blip: () => this.game.feel.sfx.play('blip'),
        onEnd: (choice) => this.onDialogueEnd(choice),
      }),
    );
  }

  private onDialogueEnd(choice?: ConversationChoice): void {
    if (!choice) return;
    const ctx = this.ctx();
    if (ctx) this.def.onChoice?.(choice, ctx);
    if (!this.def.shop) return;
    const opens = this.def.shopChoice
      ? choice.label === this.def.shopChoice
      : choice.label.toUpperCase().startsWith('SHOW');
    if (opens) {
      const p = this.world.first(Player);
      if (p) this.game.scenes.push(new ShopScene(this.game, p, this.def.shop));
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const sprite = this.def.sprite;
    blit(
      g,
      sprite.frame(this.def.anim ?? 'idle'),
      this.x - sprite.hitbox.x,
      this.y - sprite.hitbox.y,
    );
    if (this.playerNear()) {
      // Floating interact prompt, labelled for whatever the player is using.
      const bob = Math.sin(this.animT * 4) * 1.5;
      drawText(g, this.promptLabel(), this.cx, this.y - 10 + bob, COLORS.gold, 1, 'center');
    }
  }

  /** What to press to interact, for the current device: a gamepad button
   * if one's connected, the on-screen button on touch, else the key. */
  private promptLabel(): string {
    const pad = this.game.pad;
    if (pad?.connected) {
      const b = pad.buttonsFor('interact')[0];
      return b != null ? prettyButton(b) : 'Y';
    }
    if (typeof window !== 'undefined' && !window.matchMedia('(pointer: fine)').matches) {
      return 'TALK';
    }
    const code = this.game.input.codesFor('interact')[0];
    return code ? prettyCode(code) : 'E';
  }
}

/* ---------------- the cast ---------------- */

defineNpc('merchant', {
  name: 'MERCHANT',
  sprite: merchantSprite,
  greet: 'merchant-greet',
  shop: 'merchant',
});

defineNpc('spawner', {
  name: 'SPAWNER',
  sprite: merchantSprite,
  greet: '',
});

/* ---- the town ---- */

defineNpc('healer', {
  name: 'HEALER',
  sprite: merchantSprite,
  greet: 'healer-greet',
  onChoice(choice, { game, player }) {
    if (!choice.label.startsWith('Heal me')) return;
    if (player.hp >= player.maxHp && player.mp >= player.maxMp) {
      game.feel.text(player.cx, player.y - 10, 'ALREADY WHOLE', COLORS.steel);
      return;
    }
    if (player.gold < 10) {
      game.feel.text(player.cx, player.y - 10, 'NOT ENOUGH GOLD', COLORS.red);
      game.sfx.play('denied');
      return;
    }
    player.gold -= 10;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    game.feel.sfx.play('heal');
    game.feel.flash(0.15, COLORS.red);
    game.feel.burst(player.cx, player.cy, 14, {
      color: [COLORS.red, COLORS.white], speed: 50, life: 0.6, grav: -70, drag: 3,
    });
    game.feel.text(player.cx, player.y - 10, 'HEALED', COLORS.red);
  },
});

/** Upgrade costs per forge level (cap = length). */
export const FORGE_COSTS = [30, 60, 90];

defineNpc('blacksmith', {
  name: 'BLACKSMITH',
  sprite: merchantSprite,
  greet: 'blacksmith-greet',
  onChoice(choice, { game, player }) {
    if (!choice.label.startsWith('Upgrade')) return;
    if (player.forgeLevel >= FORGE_COSTS.length) {
      game.feel.text(player.cx, player.y - 10, 'NOTHING LEFT TO TEACH THIS BLADE', COLORS.steel);
      return;
    }
    const cost = FORGE_COSTS[player.forgeLevel];
    if (player.gold < cost) {
      game.feel.text(player.cx, player.y - 10, `NEED ${cost} GOLD`, COLORS.red);
      game.sfx.play('denied');
      return;
    }
    player.gold -= cost;
    player.forgeLevel++;
    player.applyForge();
    game.feel.sfx.play('unlock');
    game.feel.flash(0.15, COLORS.gold);
    game.feel.burst(player.cx, player.cy - 6, 16, {
      color: [COLORS.gold, COLORS.white], speed: 90, life: 0.5, drag: 3,
    });
    game.feel.text(player.cx, player.y - 12, `FORGED +${player.forgeLevel}`, COLORS.gold, 2);
  },
});

defineNpc('elder', {
  name: 'ELDER',
  sprite: merchantSprite,
  // The greeting tracks the quest: offer → progress → complete → done.
  greet: ({ player }) => {
    const q = player.quests;
    if (q.done.has('cull-slimes')) return 'elder-done';
    if (!q.started('cull-slimes')) return 'elder-offer';
    return q.isComplete('cull-slimes') ? 'elder-complete' : 'elder-progress';
  },
  onChoice(choice, { game, player }) {
    if (choice.label === 'I will help.') {
      player.quests.start('cull-slimes');
      game.feel.text(player.cx, player.y - 10, 'QUEST ACCEPTED', COLORS.gold);
      game.sfx.play('menuSelect');
      return;
    }
    if (choice.label === 'Claim reward.') {
      const def = player.quests.turnIn('cull-slimes');
      if (!def) return;
      player.gold += def.reward.gold ?? 0;
      for (const id of def.reward.items ?? []) player.inventory.add(id);
      game.feel.sfx.play('levelup');
      game.feel.flash(0.2, COLORS.gold);
      game.feel.text(player.cx, player.y - 12, `+${def.reward.gold} GOLD`, COLORS.gold, 2);
    }
  },
});

/** Importing this module registers the NPCs. */
export function registerNpcs(): void {}
