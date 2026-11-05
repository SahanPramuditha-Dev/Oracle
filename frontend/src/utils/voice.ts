/**
 * Local natural voice synthesis (Kokoro-82M), audio transcription (Faster-Whisper),
 * and Silero VAD (Voice Activity Detection) for fully automatic hands-free speech.
 */
import { MicVAD } from '@ricky0123/vad-web';
import { fetchWithAuth, readJson } from './api';

let playbackContext: AudioContext | null = null;
let playbackAnalyser: AnalyserNode | null = null;
let playbackSamples: Uint8Array<ArrayBuffer> | null = null;
let playbackSource: MediaElementAudioSourceNode | null = null;
export function readPlaybackEnergy(): number {
  if (!speaking?.audio || speaking.audio.paused || !playbackAnalyser || !playbackSamples) return 0;
  playbackAnalyser.getByteTimeDomainData(playbackSamples);
  let sum = 0;
  for (const sample of playbackSamples) sum += ((sample - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / playbackSamples.length) * 4);
}
function monitorPlayback(audio: HTMLAudioElement) {
  try {
    playbackContext ??= new AudioContext();
    const analyser = playbackContext.createAnalyser();
    analyser.fftSize = 256;
    const source = playbackContext.createMediaElementSource(audio);
    source.connect(playbackContext.destination);
    source.connect(analyser);
    playbackSource = source;
    playbackAnalyser = analyser;
    playbackSamples = new Uint8Array(analyser.fftSize);
    void playbackContext.resume().catch(() => {});
  } catch { /* Playback remains available if audio analysis is unsupported. */ }
}

let speaking: {controller:AbortController;audio?:HTMLAudioElement;url?:string}|null=null;
export function stopSpeaking():void {
  const previous=speaking;speaking=null;
  playbackSource?.disconnect(); playbackSource=null; playbackAnalyser?.disconnect(); playbackAnalyser=null; playbackSamples=null;
  if(previous){previous.controller.abort();if(previous.audio){previous.audio.onended=null;previous.audio.onerror=null;previous.audio.onplay=null;previous.audio.pause();previous.audio.src='';}if(previous.url)URL.revokeObjectURL(previous.url);}
  window.speechSynthesis?.cancel();
}
export async function speakWithKokoro(text:string, options?:{voice?:string;speed?:number;onStart?:()=>void;onEnd?:()=>void;onError?:(error:unknown)=>void}):Promise<void>{
  stopSpeaking();const cleaned=text.replace(/[*#`_~]/g,'').trim();if(!cleaned){options?.onEnd?.();return;}
  const run:NonNullable<typeof speaking>={controller:new AbortController()};speaking=run;
  try{
    const response=await fetchWithAuth('/api/v1/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:cleaned.slice(0,1800),...(options?.voice?{voice:options.voice}:{}),speed:options?.speed??1}),signal:run.controller.signal});
    if(!response.ok){await readJson(response);return;}
    const blob=await response.blob();if(speaking!==run||run.controller.signal.aborted)return;
    run.url=URL.createObjectURL(blob);const audio=new Audio(run.url);run.audio=audio;
    monitorPlayback(audio);
    audio.onplay=()=>{if(speaking===run)options?.onStart?.();};
    audio.onended=()=>{if(speaking===run){stopSpeaking();options?.onEnd?.();}};
    audio.onerror=()=>{if(speaking===run){stopSpeaking();options?.onError?.(new Error('Local audio playback failed.'));options?.onEnd?.();}};
    await audio.play();
  }catch(error){if(speaking===run&&!run.controller.signal.aborted){stopSpeaking();options?.onError?.(error);options?.onEnd?.();}}
}

/**
 * Encodes raw 16kHz Float32Array PCM samples into a standard 16-bit mono WAV Blob.
 */
export function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
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
  view.setUint32(40, samples.length * 2, true);

  // PCM samples conversion
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Transcribes any supported audio blob via local Faster-Whisper.
 */
export async function transcribeAudioBlob(audioBlob: Blob, signal?: AbortSignal): Promise<string> {
  if (audioBlob.size < 400) return '';
  const contentType = (audioBlob.type || 'audio/wav').split(';')[0];
  const res = await fetchWithAuth('/api/v1/voice/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: audioBlob, signal
  });

  const data = await readJson<{text:string}>(res);
  return (data.text || '').trim();
}

export interface VoiceDetectorCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: (wavBlob: Blob) => void;
  onVADMisfire?: () => void;
  onError?: (err: unknown) => void;
  onSpeechProb?: (prob: number) => void;
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

  constructor(callbacks: VoiceDetectorCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.isRunning && this.vad) return;

    const version=++this.version;
    try {
      const next = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/vad/',
        ortConfig: (ort) => {
          ort.env.logLevel = 'error';
          ort.env.wasm.numThreads = 1;
        },
        positiveSpeechThreshold: 0.55,
        negativeSpeechThreshold: 0.35,
        redemptionMs: 650, // 650ms pause before segment is considered ended
        minSpeechMs: 250,  // Ignore short clicks or pops under 250ms
        preSpeechPadMs: 300,
        startOnLoad: false,
        onSpeechStart: () => {
          this.callbacks.onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          const wavBlob = float32ToWavBlob(audio, 16000);
          this.callbacks.onSpeechEnd?.(wavBlob);
        },
        onVADMisfire: () => {
          this.callbacks.onVADMisfire?.();
        },
        onFrameProcessed: (probs) => {
          this.callbacks.onSpeechProb?.(probs.isSpeech);
        }
      });

      if(version!==this.version){await next.destroy();return;}
      this.vad=next;await next.start();
      if(version!==this.version){await next.destroy();return;}
      this.isRunning = true;
    } catch (err) {
      this.isRunning = false;
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  async pause(): Promise<void> {
    if (this.vad && this.isRunning) {
      await this.vad.pause();
      this.isRunning = false;
    }
  }

  async resume(): Promise<void> {
    if (this.vad && !this.isRunning) {
      await this.vad.start();
      this.isRunning = true;
    }
  }

  async destroy(): Promise<void> {
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
  async start():Promise<boolean>{
    this.cancel();const version=this.version;
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    if(version!==this.version){stream.getTracks().forEach(track=>track.stop());return false;}
    this.stream=stream;
    const mime=['audio/webm','audio/ogg','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    try{const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);this.recorder=recorder;
      const size={bytes:0};recorder.ondataavailable=event=>{if(version!==this.version)return;size.bytes+=event.data.size;if(size.bytes>4*1024*1024){this.cancel();return;}if(event.data.size)this.chunks.push(event.data);};
      recorder.start(250);this.timer=setTimeout(()=>this.cancel(),45000);return true;
    }catch(error){this.cancel();throw error;}
  }
  async stopAndTranscribe():Promise<string>{
    const recorder=this.recorder;if(!recorder||recorder.state==='inactive')return '';
    const version=this.version;
    return new Promise((resolve,reject)=>{
      recorder.onstop=async()=>{clearTimeout(this.timer);this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
        if(version!==this.version){resolve('');return;}
        this.controller=new AbortController();
        try{const blob=new Blob(this.chunks,{type:recorder.mimeType});this.chunks=[];
          const text=blob.size>=400?await transcribeAudioBlob(blob,this.controller.signal):'';resolve(version===this.version?text:'');
        }catch(error){if(version!==this.version)resolve('');else reject(error);}
      };recorder.stop();
    });
  }
  cancel():void{
    this.version++;clearTimeout(this.timer);this.controller?.abort();this.controller=null;
    if(this.recorder?.state==='recording')this.recorder.stop();this.recorder=null;
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;this.chunks=[];
  }
}
