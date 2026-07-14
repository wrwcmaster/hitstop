import { AudioBus } from './bus';
import { Registry } from '../core/registry';

/**
 * Pattern-based chip-tune sequencer. Zero assets: songs are step
 * patterns of note names played on oscillator tracks (plus 'noise' for
 * percussion), scheduled ahead of time against the AudioContext clock —
 * the standard lookahead scheduler, immune to frame drops.
 *
 * Tracks may have different lengths (polymeter loops are free). Songs
 * live in a registry like every other kind of content.
 */
export interface SongTrack {
  /** Oscillator type, or 'noise' / drum types for percussion hits. */
  wave: OscillatorType | 'noise' | 'kick' | 'snare' | 'hihat';
  volume: number;
  /** One entry per step: 'C4' / 'D#3' plays, '-' rests, 'x' = noise hit. */
  steps: string[];
  /** Note length as a fraction of the step (default 0.9; staccato < 1). */
  gate?: number;
}

export interface SongDef {
  bpm: number;
  /** Steps per beat (2 = 8th notes, 4 = 16ths). Default 2. */
  div?: number;
  tracks: SongTrack[];
}

export const songs = new Registry<SongDef>('song');

export function defineSong(id: string, def: SongDef): void {
  songs.register(id, def);
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' / 'D#3' → Hz (A4 = 440). */
export function noteHz(name: string): number {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) return 0;
  const semi = NOTE_INDEX[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
}

const LOOKAHEAD = 0.18; // seconds scheduled ahead
const TICK_MS = 60;

export class Music {
  /** Currently requested song id (may be pending until audio unlocks). */
  current: string | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextStepTime = 0;
  private noiseBuf: AudioBuffer | null = null;

  constructor(private bus: AudioBus) {
    bus.onUnlock(() => {
      if (this.current) this.startScheduler();
    });
  }

  /** Start (or switch to) a song. No-op if it's already playing. */
  play(id: string): void {
    if (this.current === id) return;
    songs.get(id); // validate early
    this.current = id;
    if (this.bus.ac) this.startScheduler();
  }

  stop(): void {
    this.current = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.step = 0;
    this.nextStepTime = this.bus.ac!.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const ac = this.bus.ac;
    if (!ac || !this.current) return;
    const def = songs.get(this.current);
    const stepDur = 60 / def.bpm / (def.div ?? 2);
    while (this.nextStepTime < ac.currentTime + LOOKAHEAD) {
      this.scheduleStep(def, this.step, this.nextStepTime, stepDur);
      this.step++;
      this.nextStepTime += stepDur;
    }
  }

  private scheduleStep(def: SongDef, step: number, when: number, stepDur: number): void {
    for (const track of def.tracks) {
      const cell = track.steps[step % track.steps.length];
      if (!cell || cell === '-') continue;
      const dur = stepDur * (track.gate ?? 0.9);
      if (track.wave === 'noise') {
        this.noiseHit(when, dur, track.volume);
      } else if (track.wave === 'kick') {
        this.kick(when, dur, track.volume);
      } else if (track.wave === 'snare') {
        this.snare(when, dur, track.volume);
      } else if (track.wave === 'hihat') {
        this.hihat(when, dur, track.volume);
      } else {
        this.note(track.wave, noteHz(cell), when, dur, track.volume);
      }
    }
  }

  private note(wave: OscillatorType, hz: number, when: number, dur: number, vol: number): void {
    const ac = this.bus.ac!;
    const out = this.bus.musicOut!;
    if (hz <= 0) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = wave;
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  private getNoiseBuffer(): AudioBuffer {
    const ac = this.bus.ac!;
    if (!this.noiseBuf) {
      const n = Math.floor(ac.sampleRate * 0.5);
      this.noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    }
    return this.noiseBuf;
  }

  private noiseHit(when: number, dur: number, vol: number): void {
    const ac = this.bus.ac!;
    const out = this.bus.musicOut!;
    const s = ac.createBufferSource();
    s.buffer = this.getNoiseBuffer();
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, when);
    s.connect(g);
    g.connect(out);
    s.start(when);
    s.stop(when + Math.min(dur, 0.08));
  }

  private kick(when: number, dur: number, vol: number): void {
    const ac = this.bus.ac!;
    const out = this.bus.musicOut!;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(0.01, when + dur);
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + dur + 0.01);
  }

  private snare(when: number, dur: number, vol: number): void {
    const ac = this.bus.ac!;
    const out = this.bus.musicOut!;
    
    // Tone sweep
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, when);
    o.frequency.exponentialRampToValueAtTime(100, when + dur * 0.5);
    og.gain.setValueAtTime(vol * 0.4, when);
    og.gain.exponentialRampToValueAtTime(0.001, when + dur * 0.5);
    o.connect(og);
    og.connect(out);
    o.start(when);
    o.stop(when + dur * 0.5 + 0.01);

    // Noise component
    const s = ac.createBufferSource();
    s.buffer = this.getNoiseBuffer();
    const g = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    g.gain.setValueAtTime(vol * 0.8, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    s.connect(filter);
    filter.connect(g);
    g.connect(out);
    s.start(when);
    s.stop(when + dur + 0.01);
  }

  private hihat(when: number, dur: number, vol: number): void {
    const ac = this.bus.ac!;
    const out = this.bus.musicOut!;
    const s = ac.createBufferSource();
    s.buffer = this.getNoiseBuffer();
    const g = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    s.connect(filter);
    filter.connect(g);
    g.connect(out);
    s.start(when);
    s.stop(when + dur + 0.01);
  }
}
