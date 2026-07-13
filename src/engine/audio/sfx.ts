import { AudioBus } from './bus';

/**
 * Zero-asset synthesized sound effects via WebAudio.
 *
 * Two primitives — a pitch-sweeping oscillator (`tone`) and a decaying
 * noise burst (`hiss`) — cover a surprising range of retro SFX. Sounds
 * are registered by id so content refers to them by name and designers
 * can re-register/override without touching gameplay code.
 *
 * Plays through the AudioBus's sfx channel; volume lives on the bus.
 */
export type SoundFn = (sfx: Sfx) => void;

export class Sfx {
  private sounds = new Map<string, SoundFn>();

  constructor(public bus: AudioBus) {}

  /** Kept for callers that only hold the Sfx: unlocks the whole bus. */
  unlock(): void {
    this.bus.unlock();
  }

  /** Back-compat volume knob: the sfx channel on the bus. */
  get volume(): number {
    return this.bus.getVolume('sfx');
  }

  set volume(v: number) {
    this.bus.setVolume('sfx', v);
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
    const ac = this.bus.ac;
    const out = this.bus.sfxOut;
    if (!ac || !out) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** White-noise burst with linear decay. Impacts, slides, explosions. */
  hiss(dur: number, vol: number): void {
    const ac = this.bus.ac;
    const out = this.bus.sfxOut;
    if (!ac || !out) return;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource();
    const g = ac.createGain();
    s.buffer = buf;
    g.gain.value = vol;
    s.connect(g);
    g.connect(out);
    s.start();
  }

  /** Delayed tone helper for little two-note jingles. */
  toneAt(delayMs: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
    setTimeout(() => this.tone(f0, f1, dur, type, vol), delayMs);
  }
}
