/**
 * Scenes are the top-level states of the game: title screen, a playable
 * room, pause menu, game over. Exactly one scene is active at a time.
 */
export interface Scene {
  /** Called when the scene becomes active. */
  enter?(): void;
  /** Called when another scene replaces this one. */
  exit?(): void;
  /** Fixed-timestep update. */
  update(dt: number): void;
  /** Render into the game's pixel context. */
  render(ctx: CanvasRenderingContext2D): void;
  /** Real-time frame hook (runs even during hitstop). See LoopHooks.frame. */
  frame?(realDt: number): void;
}

export class SceneManager {
  private current: Scene | null = null;

  get active(): Scene | null {
    return this.current;
  }

  switch(scene: Scene): void {
    this.current?.exit?.();
    this.current = scene;
    scene.enter?.();
  }

  update(dt: number): void {
    this.current?.update(dt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.current?.render(ctx);
  }

  frame(realDt: number): void {
    this.current?.frame?.(realDt);
  }
}
