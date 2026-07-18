import {
  Actor,
  Registry,
  applyGravity,
  moveAndCollide,
  drawText,
  DialogueScene,
  t,
  type ConversationChoice,
  type CollisionSource,
  type LoadedSprite,
} from '@engine/index';
import { blit, merchantSprite } from '../content/sprites';
import { COLORS } from '../content/palette';
import { ShopScene } from '../scenes/shop';
import { SpawnerScene } from '../scenes/spawner';
import { prettyCode, prettyButton, menuLine, type ActionGame, type Action } from '../defs';
import { Player, nearestPlayer } from './player';
import { healer, forge, questGiver } from './npc-roles';

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
  /** Shop opened when a choice with `action: 'shop'` is picked. */
  shop?: string;
  /** Service hook: runs with whatever choice ended the dialogue (healing,
   * upgrades, quest accept/turn-in...). Reacts to `choice.action`, not the
   * display label. Runs before the shop check. */
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
    // Only the locally-driven knight can talk — dialogue and shops live on
    // this screen. A net guest's knight walks past NPCs without prompts.
    const p = nearestPlayer(this.world, this.cx, this.cy);
    if (!p || !p.isLocal) return null;
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

  /** Hook context (player is the talking knight; talk() only runs when near). */
  private ctx(): NpcCtx | null {
    const player = nearestPlayer(this.world, this.cx, this.cy);
    return player?.isLocal ? { game: this.game, player, npc: this } : null;
  }

  private talk(): void {
    if (this.type === 'spawner') {
      const p = this.ctx()?.player;
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
    if (this.def.shop && choice.action === 'shop') {
      const p = this.ctx()?.player;
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
      return t('TALK');
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

/* ---- the town: roles are data, built from reusable behaviours ---- */

/** Upgrade costs per forge level (cap = length). */
export const FORGE_COSTS = [30, 60, 90];

defineNpc('healer', healer({
  name: 'HEALER',
  sprite: merchantSprite,
  greet: 'healer-greet',
  cost: 10,
}));

defineNpc('blacksmith', forge({
  name: 'BLACKSMITH',
  sprite: merchantSprite,
  greet: 'blacksmith-greet',
  costs: FORGE_COSTS,
}));

defineNpc('elder', questGiver({
  name: 'ELDER',
  sprite: merchantSprite,
  quest: 'cull-slimes',
  stages: { offer: 'elder-offer', progress: 'elder-progress', complete: 'elder-complete', done: 'elder-done' },
}));

/** Importing this module registers the NPCs. */
export function registerNpcs(): void {}
