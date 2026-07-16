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
import { prettyCode, prettyButton, type ActionGame, type Action } from '../defs';
import { Player } from './player';

/**
 * NPCs: friendly actors you talk to. An NpcDef is a sprite, a greeting
 * conversation, and optionally a shop. Interaction is proximity + the
 * interact key (E/F), with a floating prompt when in range.
 */
export interface NpcDef {
  name: string;
  sprite: LoadedSprite;
  /** Animation to render (default: idle). */
  anim?: string;
  /** Conversation played on interact. */
  greet: string;
  /** Shop opened when a choice labeled with `shopChoice` is picked. */
  shop?: string;
  /** The choice label that opens the shop (default: starts with 'show'). */
  shopChoice?: string;
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

  private talk(): void {
    if (this.type === 'spawner') {
      const p = this.world.first(Player);
      if (p) this.game.scenes.push(new SpawnerScene(this.game, p, this.collision));
      return;
    }
    this.game.scenes.push(
      new DialogueScene<Action>(this.game, this.def.greet, {
        confirm: 'confirm',
        up: 'up',
        down: 'down',
        blip: () => this.game.feel.sfx.play('blip'),
        onEnd: (choice) => this.onDialogueEnd(choice),
      }),
    );
  }

  private onDialogueEnd(choice?: ConversationChoice): void {
    if (!choice || !this.def.shop) return;
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

/** Importing this module registers the NPCs. */
export function registerNpcs(): void {}
