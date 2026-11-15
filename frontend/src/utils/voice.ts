/**
 * Local natural voice synthesis (Kokoro-82M), audio transcription (Faster-Whisper),
 * and Silero VAD (Voice Activity Detection) for fully automatic hands-free speech.
 */
import type { MicVAD } from '@ricky0123/vad-web';
import { fetchWithAuth, readJson } from './api';

let playbackContext: AudioContext | null = null;
let playbackAnalyser: AnalyserNode | null = null;
let playbackBufferSource: AudioBufferSourceNode | null = null;
let playbackFreqData: Uint8Array<ArrayBuffer> | null = null;
let playbackTimeData: Uint8Array<ArrayBuffer> | null = null;
let isAudioPlaying = false;

function getPlaybackContext(): AudioContext {
  if (!playbackContext) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    playbackContext = new AudioCtx();
  }
  return playbackContext;
}

export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getPlaybackContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

// Global user gesture listener to automatically unlock AudioContext on first interaction
if (typeof window !== 'undefined') {
  const onGesture = () => {
    void unlockAudio();
    if (playbackContext && playbackContext.state === 'running') {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      window.removeEventListener('touchstart', onGesture, true);
    }
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  window.addEventListener('touchstart', onGesture, true);
}

export function readPlaybackEnergy(): number {
  if (!isAudioPlaying || !playbackAnalyser || !playbackFreqData || !playbackTimeData) return 0;

  playbackAnalyser.getByteFrequencyData(playbackFreqData);
  playbackAnalyser.getByteTimeDomainData(playbackTimeData);

  // 1. Vocal formant energy (bins 1 to 24 in 128-bin FFT at ~44.1kHz -> ~100Hz to 3500Hz)
  let freqSum = 0;
  const maxBin = Math.min(24, playbackFreqData.length);
  for (let i = 1; i < maxBin; i++) {
    freqSum += playbackFreqData[i];
  }
  const freqAvg = freqSum / (maxBin - 1) / 255; // 0.0 to 1.0

  // 2. Time-domain RMS (instantaneous waveform amplitude)
  let timeSum = 0;
  for (let i = 0; i < playbackTimeData.length; i++) {
    const val = (playbackTimeData[i] - 128) / 128;
    timeSum += val * val;
  }
  const rms = Math.sqrt(timeSum / playbackTimeData.length); // 0.0 to ~0.5

  // Combined real vocal energy envelope: peaks sharply on syllables and drops on pauses
  const rawEnergy = freqAvg * 0.75 + Math.min(1.0, rms * 4.2) * 0.25;
  return Math.max(0, Math.min(1.0, rawEnergy * 1.45));
}

let speaking: {
  controller: AbortController;
  audio?: HTMLAudioElement;
  url?: string;
  allowBargeIn?: boolean;
} | null = null;

export function isBargeInAllowed(): boolean {
  if (speaking && speaking.allowBargeIn === false) return false;
  return isBargeInEnabled();
}
export function stopSpeaking():void {
  const previous = speaking;
  speaking = null;
  const wasPlaying = isAudioPlaying;
  isAudioPlaying = false;
  if (playbackBufferSource) {
    playbackBufferSource.onended = null;
    try {
      playbackBufferSource.stop();
    } catch { /* already stopped or not yet started */ }
    playbackBufferSource.disconnect();
    playbackBufferSource = null;
  }
  if (playbackAnalyser) {
    try {
      playbackAnalyser.disconnect();
    } catch { /* already disconnected */ }
    playbackAnalyser = null;
  }
  playbackFreqData = null;
  playbackTimeData = null;

  if (typeof window !== 'undefined' && wasPlaying) {
    window.dispatchEvent(new CustomEvent('oracle_speech_ended'));
  }

  if (previous) {
    previous.controller.abort();
    if (previous.audio) {
      previous.audio.onended = null;
      previous.audio.onerror = null;
      previous.audio.onplay = null;
      previous.audio.pause?.();
      previous.audio.src = '';
    }
    if (previous.url) URL.revokeObjectURL(previous.url);
  }
  window.speechSynthesis?.cancel();
}

export function isSpeakingActive(): boolean {
  return isAudioPlaying || Boolean(speaking?.audio?.paused === false) || Boolean(window.speechSynthesis?.speaking);
}

export function isBargeInEnabled(): boolean {
  return localStorage.getItem('oracle_barge_in') !== 'false';
}

export function setBargeInEnabled(enabled: boolean): void {
  localStorage.setItem('oracle_barge_in', String(enabled));
}

export function isLocalFastPathEnabled(): boolean {
  return localStorage.getItem('oracle_local_fast_path') !== 'false';
}

export function setLocalFastPathEnabled(enabled: boolean): void {
  localStorage.setItem('oracle_local_fast_path', String(enabled));
}
export function getSpeechSpeed(): number {
  const saved = Number(localStorage.getItem('oracle_voice_speed') || '1');
  return Number.isFinite(saved) ? Math.max(0.75, Math.min(1.25, saved)) : 1;
}

export function isNoiseReductionEnabled(): boolean {
  return localStorage.getItem('oracle_noise_reduction') !== 'false';
}

export function setNoiseReductionEnabled(enabled: boolean): void {
  localStorage.setItem('oracle_noise_reduction', String(enabled));
}

/**
 * Real-time digital signal processing (DSP) acoustic filter:
 * 1. DC offset removal
 * 2. 85Hz High-pass IIR filtering (attenuates HVAC rumble, desk thumps, 50/60Hz AC hum)
 * 3. Soft noise gating for stationary background noise (air conditioning, computer fans)
 * 4. Dynamic speech peak leveling
 */
export function applyAcousticFilter(samples: Float32Array): Float32Array {
  if (samples.length < 160) return samples;
  const filtered = new Float32Array(samples.length);

  // 1. DC offset removal
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  const dcMean = sum / samples.length;

  // 2. High-pass filter at ~85Hz (fs = 16000Hz, alpha = 0.967)
  const alpha = 0.967;
  let prevIn = samples[0] - dcMean;
  let prevOut = prevIn;
  filtered[0] = prevOut;
  for (let i = 1; i < samples.length; i++) {
    const currIn = samples[i] - dcMean;
    const currOut = alpha * (prevOut + currIn - prevIn);
    filtered[i] = currOut;
    prevIn = currIn;
    prevOut = currOut;
  }

  // 3. Frame-based soft noise gating for stationary noise floor
  const frameSize = 320; // 20 ms
  const numFrames = Math.floor(filtered.length / frameSize);
  if (numFrames >= 3) {
    const energies: number[] = new Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      let energy = 0;
      const offset = f * frameSize;
      for (let j = 0; j < frameSize; j++) {
        const val = filtered[offset + j];
        energy += val * val;
      }
      energies[f] = Math.sqrt(energy / frameSize);
    }

    const sorted = energies.slice().sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(numFrames * 0.15)] || 0.001;
    const gateThreshold = Math.max(0.004, noiseFloor * 1.8);

    for (let f = 0; f < numFrames; f++) {
      const e = energies[f];
      const gain = e >= gateThreshold ? 1.0 : Math.max(0.2, (e - noiseFloor) / Math.max(1e-4, gateThreshold - noiseFloor));
      const offset = f * frameSize;
      for (let j = 0; j < frameSize; j++) {
        filtered[offset + j] *= gain;
      }
    }
  }

  return filtered;
}

export async function speakWithKokoro(
  text: string,
  options?: {
    voice?: string;
    speed?: number;
    allowBargeIn?: boolean;
    onStart?: (info?: { duration?: number; audio?: HTMLAudioElement }) => void;
    onEnd?: () => void;
    onError?: (error: unknown) => void;
  }
): Promise<void> {
  stopSpeaking();
  const cleaned = text.replace(/[*#`_~]/g, '').trim();
  if (!cleaned) {
    options?.onEnd?.();
    return;
  }
  const run: NonNullable<typeof speaking> = {
    controller: new AbortController(),
    allowBargeIn: options?.allowBargeIn ?? true
  };
  speaking = run;

  try {
    const response = await fetchWithAuth('/api/v1/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleaned.slice(0, 1800),
        voice: options?.voice || localStorage.getItem('oracle_voice_persona') || 'af_heart',
        speed: options?.speed ?? getSpeechSpeed()
      }),
      signal: run.controller.signal
    });

    if (!response.ok) {
      await readJson(response);
      options?.onEnd?.();
      return;
    }

    const blob = await response.blob();
    if (speaking !== run || run.controller.signal.aborted) return;

    const ctx = getPlaybackContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    if (speaking !== run || run.controller.signal.aborted) return;

    // Responsive vocal frequency extraction graph
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.25;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    playbackBufferSource = source;
    playbackAnalyser = analyser;
    playbackFreqData = new Uint8Array(analyser.frequencyBinCount);
    playbackTimeData = new Uint8Array(analyser.fftSize);
    // Fake element wrapper for legacy callers expecting audio.duration
    run.audio = { duration: audioBuffer.duration } as HTMLAudioElement;

    source.onended = () => {
      if (speaking === run) {
        stopSpeaking();
        options?.onEnd?.();
      }
    };

    const gestures = new AbortController();
    run.controller.signal.addEventListener('abort', () => gestures.abort(), { once: true });
    const startPlayback = () => {
      if (speaking !== run || isAudioPlaying || ctx.state !== 'running') return;
      gestures.abort();
      source.start(0);
      isAudioPlaying = true;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('oracle_speech_started', { detail: { text: cleaned } }));
      }
      options?.onStart?.({ duration: audioBuffer.duration });
    };
    if (ctx.state === 'running') {
      startPlayback();
    } else {
      const resumeOnGesture = () => void ctx.resume().then(startPlayback).catch(() => {});
      ctx.addEventListener('statechange', startPlayback, { signal: gestures.signal });
      resumeOnGesture();
      for (const event of ['pointerdown', 'keydown', 'touchstart']) {
        window.addEventListener(event, resumeOnGesture, { capture: true, signal: gestures.signal });
      }
    }
  } catch (error) {
    if (speaking === run && !run.controller.signal.aborted) {
      stopSpeaking();
      options?.onError?.(error);
      options?.onEnd?.();
    }
  }
}

/**
 * Encodes raw 16kHz Float32Array PCM samples into a standard 16-bit mono WAV Blob.
 */
export function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const processed = isNoiseReductionEnabled() ? applyAcousticFilter(samples) : samples;
  const buffer = new ArrayBuffer(44 + processed.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + processed.length * 2, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate (16-bit = 2 bytes/sample)
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, processed.length * 2, true);

  // PCM samples conversion
  let offset = 44;
  for (let i = 0; i < processed.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, processed[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Transcribes any supported audio blob via local Faster-Whisper.
 */
export interface VoiceProfileData {
  f0?: number | null;
  pitch_category?: string | null;
  min_f0?: number | null;
  max_f0?: number | null;
  spectral_centroid?: number | null;
}

export interface NoiseTelemetry {
  currentDb: number;
  noiseFloorDb: number;
  snrDb: number;
  environment: 'quiet' | 'moderate' | 'noisy';
}

/**
 * Transcribes any supported audio blob via local Faster-Whisper.
 */
export async function transcribeAudioBlob(
  audioBlob: Blob,
  signal?: AbortSignal,
  wakeMode = false,
  interim = false,
  onProfile?: (profile: VoiceProfileData) => void
): Promise<string> {
  if (audioBlob.size < 400) return '';
  const contentType = (audioBlob.type || 'audio/wav').split(';')[0];
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, {once: true});
  const timeout = setTimeout(() => controller.abort(new Error('Transcription timed out. Please try again.')), interim ? 5000 : 20000);
  try {
    let res: Response | undefined;
    for (let attempt = 0; attempt < (interim ? 1 : 3); attempt++) {
      res = await fetchWithAuth(`/api/v1/voice/transcribe?mode=${wakeMode ? 'wake' : 'speech'}${interim ? '&interim=true' : ''}${onProfile ? '' : '&profile=false'}`, {
        method: 'POST', headers: {'Content-Type': contentType}, body: audioBlob, signal: controller.signal
      });
      if (interim || res.status !== 429 || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 500));
      controller.signal.throwIfAborted();
    }
    if (!res) throw new Error('Transcription unavailable');
    if (interim && res.status === 429) {
      return '';
    }
    const data = await readJson<{text:string; voice_profile?: VoiceProfileData}>(res);
    if (data.voice_profile && onProfile) {
      onProfile(data.voice_profile);
    }
    return (data.text || '').trim();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export interface VoiceDetectorCallbacks {
  maxSegmentMs?: number;
  onSpeechStart?: () => void;
  onSpeechProgress?: (wavBlob: Blob) => void;
  onSpeechEnd?: (wavBlob: Blob) => void;
  onVADMisfire?: () => void;
  onError?: (err: unknown) => void;
  onSpeechProb?: (prob: number) => void;
  onInputLevel?: (level: number) => void;
  onNoiseTelemetry?: (telemetry: NoiseTelemetry) => void;
}

/**
 * Silero Voice Activity Detector (VAD).
 * Runs completely locally using ONNX WebAssembly, detecting human speech boundaries in real time.
 */
export class SileroVoiceDetector {
  private vad: MicVAD | null = null;
  private isRunning = false;
  private version = 0;
  private callbacks: VoiceDetectorCallbacks;
  private segmentTimer: ReturnType<typeof setTimeout> | undefined;
  private segmentFrames: Float32Array[] = [];
  private segmentOpen = false;
  private lastProgressAt = 0;
  private preSpeechFrames: Float32Array[] = [];
  private lastLevelAt = 0;
  private lastTelemetryAt = 0;
  private smoothedNoiseFloor = 32;
  private segmentFlushed = false;
  private clearSegment() {
    clearTimeout(this.segmentTimer);
    this.segmentFrames = [];
    this.segmentOpen = false;
  }

  constructor(callbacks: VoiceDetectorCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<boolean> {
    if (this.isRunning && this.vad) return true;

    const version=++this.version;
    try {
      const { MicVAD } = await import('@ricky0123/vad-web');
      if (version !== this.version) return false;
      const next = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/vad/',
        ortConfig: (ort) => {
          ort.env.logLevel = 'error';
          ort.env.wasm.numThreads = 1;
        },
        getStream: async () => {
          return await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 16000
            },
            video: false
          });
        },
        positiveSpeechThreshold: 0.35, // lowered: catches soft and distant speech
        negativeSpeechThreshold: 0.25, // kept below positive threshold
        redemptionMs: 800,  // 800ms: enough for natural pauses without swallowing short commands
        minSpeechMs: 150, // allow short commands like 'map', 'stop', 'mute'
        preSpeechPadMs: 400,
        startOnLoad: false,
        onSpeechStart: () => {
          this.clearSegment();
          this.segmentFrames = this.preSpeechFrames.map(frame => frame.slice());
          this.segmentOpen = true;
          this.lastProgressAt = performance.now();
          this.segmentFlushed = false;
          this.segmentTimer = setTimeout(() => {
            if (!this.segmentOpen || version !== this.version) return;
            const length = this.segmentFrames.reduce((sum, frame) => sum + frame.length, 0);
            const samples = new Float32Array(length);
            let offset = 0;
            for (const frame of this.segmentFrames) { samples.set(frame, offset); offset += frame.length; }
            this.clearSegment();
            this.segmentFlushed = true;
            if (length) this.callbacks.onSpeechEnd?.(float32ToWavBlob(samples, 16000));
          }, this.callbacks.maxSegmentMs ?? 30000);
          this.callbacks.onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          const flushed = this.segmentFlushed;
          this.clearSegment();
          this.segmentFlushed = false;
          if (flushed) return;
          const wavBlob = float32ToWavBlob(audio, 16000);
          this.callbacks.onSpeechEnd?.(wavBlob);
        },
        onVADMisfire: () => {
          this.clearSegment();
          this.callbacks.onVADMisfire?.();
        },
        onFrameProcessed: (probs, frame) => {
          this.preSpeechFrames.push(frame.slice());
          if (this.preSpeechFrames.length > 13) this.preSpeechFrames.shift();
          if (performance.now() - this.lastLevelAt >= 80) {
            this.lastLevelAt = performance.now();
            let energy = 0;
            for (const sample of frame) energy += sample * sample;
            const rms = Math.sqrt(energy / frame.length);
            this.callbacks.onInputLevel?.(Math.min(1, rms * 7));

            if (performance.now() - this.lastTelemetryAt >= 120) {
              this.lastTelemetryAt = performance.now();
              const currentDb = Math.round(Math.max(18, Math.min(95, 20 * Math.log10(rms + 1e-5) + 95)));
              if (probs.isSpeech < 0.25) {
                this.smoothedNoiseFloor = this.smoothedNoiseFloor * 0.92 + currentDb * 0.08;
              }
              const noiseFloorDb = Math.round(this.smoothedNoiseFloor || 30);
              const snrDb = Math.max(0, currentDb - noiseFloorDb);
              const environment: 'quiet' | 'moderate' | 'noisy' =
                noiseFloorDb < 38 ? 'quiet' : noiseFloorDb < 52 ? 'moderate' : 'noisy';
              this.callbacks.onNoiseTelemetry?.({ currentDb, noiseFloorDb, snrDb, environment });
            }
          }
          if (this.segmentOpen && this.segmentFrames.length < 1000) this.segmentFrames.push(frame.slice());
          if (this.segmentOpen && this.callbacks.onSpeechProgress && performance.now() - this.lastProgressAt >= 1000) {
            this.lastProgressAt = performance.now();
            const length = this.segmentFrames.reduce((sum, item) => sum + item.length, 0);
            const samples = new Float32Array(length);
            let offset = 0;
            for (const item of this.segmentFrames) { samples.set(item, offset); offset += item.length; }
            this.callbacks.onSpeechProgress(float32ToWavBlob(samples, 16000));
          }
          this.callbacks.onSpeechProb?.(probs.isSpeech);
        }
      });

      if(version!==this.version){await next.destroy();return false;}
      this.vad=next;await next.start();
      if(version!==this.version){await next.destroy();return false;}
      this.isRunning = true;
      return true;
    } catch (err) {
      this.isRunning = false;
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  async pause(): Promise<void> {
    this.clearSegment();
    if (this.vad && this.isRunning) {
      await this.vad.pause();
      this.isRunning = false;
    }
  }

  async resume(): Promise<void> {
    if (this.vad && !this.isRunning) {
      await this.vad.start();
      this.isRunning = true;
    } else if (!this.vad) {
      await this.start();
    }
  }

  async destroy(): Promise<void> {
    this.clearSegment();
    this.version++;
    if (this.vad) {
      try {
        await this.vad.destroy();
      } catch {
        // ignore
      }
      this.vad = null;
      this.isRunning = false;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Fallback / manual Push-to-Talk recorder using browser MediaRecorder.
 */
export class LocalSpeechRecorder {
  private recorder:MediaRecorder|null=null;
  private stream:MediaStream|null=null;
  private controller:AbortController|null=null;
  private version=0;
  private chunks:Blob[]=[];
  private timer:ReturnType<typeof setTimeout>|undefined;
  private partialController: AbortController | null = null;
  private levelContext: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | undefined;
  private stopLevels() {
    clearInterval(this.levelTimer);
    void this.levelContext?.close().catch(() => {});
    this.levelContext = null;
  }
  async start(onPartial?: (text: string) => void, onInputLevel?: (level: number) => void, onLimit?: (limit: 'duration' | 'size') => void):Promise<boolean>{
    this.cancel();const version=this.version;
    const stream=await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000
      },
      video: false
    });
    if(version!==this.version){stream.getTracks().forEach(track=>track.stop());return false;}
    this.stream=stream;
    if (onInputLevel) {
      try {
        const context = new AudioContext();
        this.levelContext = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser(); analyser.fftSize = 256;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        void context.resume().catch(() => {});
        this.levelTimer = setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
          if (version === this.version) onInputLevel(Math.min(1, Math.sqrt(energy / samples.length) * 7));
        }, 80);
      } catch { this.stopLevels(); }
    }
    const mime=['audio/webm','audio/ogg','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    try{const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);this.recorder=recorder;
      const size={bytes:0};
      let lastPartial = performance.now();
      recorder.ondataavailable=event=>{
        if(version!==this.version)return;
        size.bytes+=event.data.size;
        if (size.bytes > 4 * 1024 * 1024) { this.cancel(); onLimit?.('size'); return; }
        if(event.data.size)this.chunks.push(event.data);
        if(onPartial && recorder.state==='recording' && !this.partialController && performance.now()-lastPartial>=550 && size.bytes>=400){
          lastPartial=performance.now();
          const partial=new AbortController(); this.partialController=partial;
          const snapshot=new Blob(this.chunks,{type:recorder.mimeType});
          void transcribeAudioBlob(snapshot,partial.signal,false,true).then(text=>{
            if(version===this.version && !partial.signal.aborted && recorder.state==='recording' && text.trim())onPartial(text);
          }).catch(()=>{}).finally(()=>{if(this.partialController===partial)this.partialController=null;});
        }
      };
      recorder.start(250);
      this.timer = setTimeout(() => {
        if (onLimit) onLimit('duration');
        else this.cancel();
      }, 44000);
      return true;
    }catch(error){this.cancel();throw error;}
  }
  async stopAndTranscribe():Promise<string>{
    const recorder=this.recorder;if(!recorder||recorder.state==='inactive')return '';
    this.partialController?.abort(); this.partialController=null;
    const version=this.version;
    return new Promise((resolve,reject)=>{
      recorder.onstop=async()=>{this.stopLevels();clearTimeout(this.timer);this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
        if(version!==this.version){resolve('');return;}
        this.controller=new AbortController();
        try{const blob=new Blob(this.chunks,{type:recorder.mimeType});this.chunks=[];
          const text=blob.size>=400?await transcribeAudioBlob(blob,this.controller.signal):'';resolve(version===this.version?text:'');
        }catch(error){if(version!==this.version)resolve('');else reject(error);}
      };recorder.stop();
    });
  }
  cancel():void{
    this.stopLevels();
    this.partialController?.abort(); this.partialController=null;
    this.version++;clearTimeout(this.timer);this.controller?.abort();this.controller=null;
    if(this.recorder?.state==='recording')this.recorder.stop();this.recorder=null;
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;this.chunks=[];
  }
}
