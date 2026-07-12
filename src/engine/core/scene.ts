/**
 * Scenes are the top-level states of the game: title screen, a playable
 * room, pause menu, game over, a conversation.
 *
 * Scenes live on a STACK. The top scene gets updates; every scene still
 * renders (bottom-up), which is what makes overlays work: push a pause
 * menu and the frozen world stays visible underneath it. `switch`
 * replaces the whole stack for hard transitions (title → game).
 */
export interface Scene {
  /** Called when the scene becomes part of the stack. */
  enter?(): void;
  /** Called when the scene leaves the stack. */
  exit?(): void;
  /** Fixed-timestep update. Only the TOP scene is updated. */
  update(dt: number): void;
  /** Render into the game's pixel context. All stacked scenes render, bottom-up. */
  render(ctx: CanvasRenderingContext2D): void;
  /** Real-time frame hook (runs even during hitstop, for every stacked scene). */
  frame?(realDt: number): void;
}

export class SceneManager {
  private stack: Scene[] = [];

  /** The scene currently receiving updates. */
  get top(): Scene | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Replace the entire stack (hard transition). */
  switch(scene: Scene): void {
    for (let i = this.stack.length - 1; i >= 0; i--) this.stack[i].exit?.();
    this.stack = [scene];
    scene.enter?.();
  }

  /** Overlay a scene (pause menu, dialogue). The world below stops updating but keeps rendering. */
  push(scene: Scene): void {
    this.stack.push(scene);
    scene.enter?.();
  }

  /** Remove the top scene. */
  pop(): void {
    const s = this.stack.pop();
    s?.exit?.();
  }

  /** Pop until `scene` is on top (or the stack is empty). */
  popTo(scene: Scene): void {
    while (this.stack.length && this.top !== scene) this.pop();
  }

  update(dt: number): void {
    this.top?.update(dt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const s of this.stack) s.render(ctx);
  }

  frame(realDt: number): void {
    for (const s of this.stack) s.frame?.(realDt);
  }
}
