/**
 * The audio mixer: one AudioContext with three gain stages —
 *
 *   sources → sfxGain ─┐
 *   music   → musicGain ├→ masterGain → speakers
 *
 * Sfx and Music both play through it; volume settings are just gain
 * values here, so a settings menu never touches the sound code.
 * Browsers require a user gesture before audio starts: call `unlock()`
 * from any input handler (Game wires this), and use `onUnlock` to start
 * music that was requested before audio existed.
 */
export class AudioBus {
  ac: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private volumes = { master: 1, music: 1, sfx: 1 };
  private unlockListeners: (() => void)[] = [];
  private unlocked = false;

  unlock(): void {
    if (!this.ac) {
      try {
        this.ac = new AudioContext();
        this.masterGain = this.ac.createGain();
        this.musicGain = this.ac.createGain();
        this.sfxGain = this.ac.createGain();
        this.musicGain.connect(this.masterGain);
        this.sfxGain.connect(this.masterGain);
        this.masterGain.connect(this.ac.destination);
        this.applyVolumes();
      } catch {
        return; // no audio available; stay silent
      }
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      for (const fn of this.unlockListeners) fn();
    }
  }

  /** Runs once, after the first successful unlock (start pending music here). */
  onUnlock(fn: () => void): void {
    if (this.unlocked) fn();
    else this.unlockListeners.push(fn);
  }

  get sfxOut(): AudioNode | null {
    return this.sfxGain;
  }

  get musicOut(): AudioNode | null {
    return this.musicGain;
  }

  /** Channel volumes, 0..1. Persisted by the game's settings store. */
  setVolume(channel: 'master' | 'music' | 'sfx', v: number): void {
    this.volumes[channel] = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  getVolume(channel: 'master' | 'music' | 'sfx'): number {
    return this.volumes[channel];
  }

  private applyVolumes(): void {
    if (this.masterGain) this.masterGain.gain.value = this.volumes.master;
    if (this.musicGain) this.musicGain.gain.value = this.volumes.music;
    if (this.sfxGain) this.sfxGain.gain.value = this.volumes.sfx;
  }
}
