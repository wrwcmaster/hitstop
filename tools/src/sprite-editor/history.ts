import type { SpriteDocument } from './document';

/** Owns document snapshots only; selection, rendering, and status messages belong to the UI. */
export class SpriteHistory {
  private past: SpriteDocument[] = [];
  private future: SpriteDocument[] = [];

  constructor(private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('history limit must be a positive integer');
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  /** Capture the state before an edit. A new branch always invalidates redo. */
  checkpoint(document: SpriteDocument): void {
    this.future.length = 0;
    const previous = this.past.at(-1);
    if (previous && JSON.stringify(previous) === JSON.stringify(document)) return;
    this.past.push(structuredClone(document));
    if (this.past.length > this.limit) this.past.shift();
  }

  undo(document: SpriteDocument): SpriteDocument | null {
    return this.transfer(this.past, this.future, document);
  }

  redo(document: SpriteDocument): SpriteDocument | null {
    return this.transfer(this.future, this.past, document);
  }

  private transfer(from: SpriteDocument[], to: SpriteDocument[], document: SpriteDocument): SpriteDocument | null {
    const snapshot = from.pop();
    if (!snapshot) return null;
    to.push(structuredClone(document));
    return snapshot;
  }
}
