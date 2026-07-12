import { Entity, Actor, Team } from './entity';

export type System = (dt: number, world: World) => void;

/**
 * The World owns all live entities and runs the update/render cycle.
 * Spawns and removals are deferred to the end of the update so iteration
 * is always safe. Systems are plain functions run after entity updates —
 * the extension point for cross-cutting logic (spawner directors, status
 * effects, ambient particles...).
 */
export class World {
  private entities: Entity[] = [];
  private toAdd: Entity[] = [];
  systems: System[] = [];

  spawn<T extends Entity>(e: T): T {
    e.world = this;
    this.toAdd.push(e);
    return e;
  }

  /** All live entities (do not mutate). */
  all(): readonly Entity[] {
    return this.entities;
  }

  /** Live actors, optionally filtered by team. */
  actors(team?: Team): Actor[] {
    const out: Actor[] = [];
    for (const e of this.entities) {
      if (e instanceof Actor && !e.dead && (team === undefined || e.team === team)) out.push(e);
    }
    return out;
  }

  /** First live entity of a class (e.g. the player). */
  first<T extends Entity>(cls: new (...args: never[]) => T): T | undefined {
    for (const e of this.entities) {
      if (e instanceof cls && !e.dead) return e;
    }
    return undefined;
  }

  count(pred?: (e: Entity) => boolean): number {
    if (!pred) return this.entities.length;
    let n = 0;
    for (const e of this.entities) if (pred(e)) n++;
    return n;
  }

  update(dt: number): void {
    // Flush spawns from last frame first so new entities update this frame.
    if (this.toAdd.length) {
      this.entities.push(...this.toAdd);
      this.toAdd.length = 0;
    }
    for (const e of this.entities) {
      if (!e.dead) e.update(dt);
    }
    for (const s of this.systems) s(dt, this);
    // Remove the dead.
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i].dead) {
        this.entities[i].onRemove();
        this.entities.splice(i, 1);
      }
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const sorted = [...this.entities].sort((a, b) => a.layer - b.layer);
    for (const e of sorted) {
      if (!e.dead) e.render(g);
    }
  }

  clear(): void {
    for (const e of this.entities) e.onRemove();
    this.entities.length = 0;
    this.toAdd.length = 0;
  }
}
