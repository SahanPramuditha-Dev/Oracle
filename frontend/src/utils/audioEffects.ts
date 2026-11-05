/**
 * Procedural UI sound effects (Earcons) using the Web Audio API.
 * 100% offline, zero external audio asset dependencies, zero network latency.
 */

class SoundEffectsManager {
  private ctx: AudioContext | null = null;
  private isMuted = false;

  private getContext(): AudioContext | null {
    if (this.isMuted) return null;
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  /**
   * Futuristic, two-tone rising chime (D5 -> A5 with soft harmonic shimmer).
   * Played immediately when "Hey Oracle" wake word is triggered.
   */
  playWakeChime(volume = 0.22): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Note 1: D5 (587.33 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(volume, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.28);

      // Note 2: A5 (880 Hz) - slightly delayed
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08);

      // Soft crystalline harmonic overtone (1760 Hz)
      const oscHarmonic = ctx.createOscillator();
      const gainHarmonic = ctx.createGain();
      oscHarmonic.type = 'triangle';
      oscHarmonic.frequency.setValueAtTime(1760, now + 0.08);

      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(volume * 0.9, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      gainHarmonic.gain.setValueAtTime(0, now + 0.08);
      gainHarmonic.gain.linearRampToValueAtTime(volume * 0.18, now + 0.1);
      gainHarmonic.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      oscHarmonic.connect(gainHarmonic);
      gainHarmonic.connect(ctx.destination);

      osc2.start(now + 0.08);
      osc2.stop(now + 0.48);
      oscHarmonic.start(now + 0.08);
      oscHarmonic.stop(now + 0.48);
    } catch (e) {
      console.warn('Wake chime playback fault:', e);
    }
  }

  /**
   * Soft rising frequency sweep when activating VAD or Wake-Word modes.
   */
  playActivateTone(volume = 0.12): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {
      // ignore
    }
  }

  /**
   * Soft descending tone when speech finishes recording and begins transcribing.
   */
  playAcknowledgeTone(volume = 0.12): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    } catch {
      // ignore
    }
  }
}

export const soundEffects = new SoundEffectsManager();
