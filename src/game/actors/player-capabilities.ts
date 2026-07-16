/** Runtime capabilities granted by content (skill trees, gear, quests). */
export class PlayerCapabilities {
  private enabled = new Set<string>();
  private modifiers = new Map<string, number>();

  enable(id: string): void {
    this.enabled.add(id);
  }

  has(id: string): boolean {
    return this.enabled.has(id);
  }

  setModifier(id: string, value: number): void {
    if (!Number.isFinite(value)) throw new Error(`player modifier "${id}": expected a finite number`);
    this.modifiers.set(id, value);
  }

  modifier(id: string, fallback: number): number {
    return this.modifiers.get(id) ?? fallback;
  }
}
