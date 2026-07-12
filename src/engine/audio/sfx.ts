/**
 * Zero-asset synthesized sound effects via WebAudio.
 *
 * Two primitives — a pitch-sweeping oscillator (`tone`) and a decaying
 * noise burst (`hiss`) — cover a surprising range of retro SFX. Sounds
 * are registered by id so content refers to them by name and designers
 * can re-register/override without touching gameplay code.
 *
 * The AudioContext can only start after a user gesture; call `unlock()`
 * from any input handler (Game wires this automatically).
 */
export type SoundFn = (sfx: Sfx) => void;

export class Sfx {
  private ac: AudioContext | null = null;
  private sounds = new Map<string, SoundFn>();
  volume = 1;

  unlock(): void {
    if (!this.ac) {
      try {
        this.ac = new AudioContext();
      } catch {
        /* no audio available; stay silent */
      }
    }
    if (this.ac?.state === 'suspended') void this.ac.resume();
  }

  define(id: string, fn: SoundFn): void {
    this.sounds.set(id, fn);
  }

  play(id: string): void {
    const fn = this.sounds.get(id);
    if (!fn) {
      console.warn(`[sfx] unknown sound "${id}"`);
      return;
    }
    fn(this);
  }

  /** Oscillator sweeping from f0 to f1 Hz over `dur` seconds. */
  tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.ac) return;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    const t = this.ac.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** White-noise burst with linear decay. Impacts, slides, explosions. */
  hiss(dur: number, vol: number): void {
    if (!this.ac) return;
    const n = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, n, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ac.createBufferSource();
    const g = this.ac.createGain();
    s.buffer = buf;
    g.gain.value = vol * this.volume;
    s.connect(g);
    g.connect(this.ac.destination);
    s.start();
  }

  /** Delayed tone helper for little two-note jingles. */
  toneAt(delayMs: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
    setTimeout(() => this.tone(f0, f1, dur, type, vol), delayMs);
  }
}
