/**
 * Typed event bus. Systems talk to each other through events rather than
 * direct references, which is what lets content (enemies, skills, UI) react
 * to combat without the combat code knowing about them.
 *
 * Consumers declare their event map:
 *
 *   interface GameEvents { hit: { target: Entity; damage: number }; ... }
 *   const events = new EventBus<GameEvents>();
 *   events.on('hit', e => ...);         // e is typed
 *   events.emit('hit', { target, damage: 2 });
 */
export type Unsubscribe = () => void;

export class EventBus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<(data: never) => void>>();

  on<K extends keyof E>(type: K, fn: (data: E[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as (data: never) => void);
    return () => set!.delete(fn as (data: never) => void);
  }

  once<K extends keyof E>(type: K, fn: (data: E[K]) => void): Unsubscribe {
    const off = this.on(type, (data) => {
      off();
      fn(data);
    });
    return off;
  }

  emit<K extends keyof E>(type: K, data: E[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) (fn as (d: E[K]) => void)(data);
  }

  clear(): void {
    this.listeners.clear();
  }
}
