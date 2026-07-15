/**
 * Pipe Manager — Audio and data pipes to FFmpeg
 *
 * MicAudioPipe:      Continuous PCM16 mono 48000 Hz → FFmpeg pipe:5
 * VolumeControlPipe: Continuous f32le stereo 48000 Hz → FFmpeg pipe:6
 *
 * Both write silence when no real data is available, ensuring FFmpeg
 * always has input and never stalls waiting for data.
 *
 * ── Key design decisions ────────────────────────────────────────────────────
 *
 * Drift-compensated scheduler (replaces setInterval)
 *   setInterval fires with ±5–15 ms jitter in Node.js. At 48 kHz that is
 *   enough irregular data flow to create audible clicks at FFmpeg's pipe:5
 *   input. We replace it with a setTimeout loop that measures actual elapsed
 *   time (process.hrtime.bigint) and adjusts the next delay to compensate.
 *   Over time this converges to the target interval with <1 ms average drift.
 *
 * Soft silence on buffer underrun
 *   When the ring buffer is empty the old code did out.fill(0) — a hard cut
 *   to silence that creates a click at the zero-crossing. Instead we
 *   remember the last written sample and ramp it to zero over ~5 ms (256
 *   samples at 48 kHz) before sustaining silence. The reverse (silence→audio)
 *   is handled naturally by FFmpeg's acompressor.
 *
 * Ring buffer
 *   A flat Uint8Array with power-of-two capacity lets us use bitwise AND
 *   for the modulo operation — faster than the % operator for hot-path
 *   byte copies.
 */

import { config } from "../engine/config-service";

// ── MicAudioPipe ──────────────────────────────────────────────────────────────

export class MicAudioPipe {
  // Chunk = 20 ms of PCM16 mono at 48 kHz = 48000 * 0.020 * 2 = 1920 bytes
  static readonly INTERVAL_MS  = config.micChunkIntervalMs;
  static readonly CHUNK_FRAMES = Math.floor(config.micSampleRate * (config.micChunkIntervalMs / 1000));
  static readonly CHUNK_BYTES  = MicAudioPipe.CHUNK_FRAMES * 2; // Int16 = 2 bytes
  // Ring buffer: 4 seconds capacity, rounded up to the next power of two for fast masking
  private static readonly _RAW_CAP = config.micSampleRate * 2 * 4;
  static readonly CAPACITY = (() => {
    let p = 1;
    while (p < MicAudioPipe._RAW_CAP) p <<= 1;
    return p;
  })();
  private static readonly _MASK = MicAudioPipe.CAPACITY - 1;

  private buf: Buffer;
  private writePos = 0;
  private readPos  = 0;
  private _timeoutId: NodeJS.Timeout | null = null;

  // Soft-silence fade state
  private _lastSample   = 0; // last Int16 value written to FFmpeg
  private _underrunFrames = 0; // how many frames we have been in underrun

  // Fade-out ramp length: 5 ms = 240 frames at 48 kHz
  private static readonly _FADE_FRAMES = Math.floor(config.micSampleRate * 0.005);

  constructor() {
    this.buf = Buffer.alloc(MicAudioPipe.CAPACITY);
  }

  feed(pcm: Buffer): void {
    const cap  = MicAudioPipe.CAPACITY;
    const mask = MicAudioPipe._MASK;
    // Drop oldest bytes if the producer is faster than the consumer
    if (this.writePos - this.readPos + pcm.byteLength > cap) {
      this.readPos = this.writePos - cap + pcm.byteLength;
    }
    for (let i = 0; i < pcm.byteLength; i++) {
      this.buf[(this.writePos + i) & mask] = pcm[i];
    }
    this.writePos += pcm.byteLength;
  }

  startWritingTo(dest: NodeJS.WritableStream): void {
    const chunkBytes  = MicAudioPipe.CHUNK_BYTES;
    const chunkFrames = MicAudioPipe.CHUNK_FRAMES;
    const intervalMs  = MicAudioPipe.INTERVAL_MS;
    const fadeFrames  = MicAudioPipe._FADE_FRAMES;
    const mask        = MicAudioPipe._MASK;

    // Drift-compensated scheduler ────────────────────────────────────────────
    // nextTickNs tracks when the next chunk *should* fire. Each iteration
    // schedules the next setTimeout with (target - now) as the delay, so
    // accumulated jitter is continuously corrected.
    let nextTickNs = process.hrtime.bigint();
    const intervalNs = BigInt(intervalMs * 1_000_000);

    const tick = () => {
      if (!(dest as any).writable) return;

      const available = this.writePos - this.readPos;
      const out = Buffer.allocUnsafe(chunkBytes);

      if (available >= chunkBytes) {
        // ── Normal path: copy chunk from ring buffer ─────────────────────
        for (let i = 0; i < chunkBytes; i++) {
          out[i] = this.buf[(this.readPos + i) & mask];
        }
        this.readPos += chunkBytes;
        // Remember last sample for soft fade-out on next underrun
        this._lastSample = out.readInt16LE(chunkBytes - 2);
        this._underrunFrames = 0;
      } else {
        // ── Underrun path: ramp last sample → silence ────────────────────
        // Avoids the click at the audio→silence boundary by linearly fading
        // the last real sample to zero over `fadeFrames` output frames.
        for (let i = 0; i < chunkFrames; i++) {
          const framesIn = this._underrunFrames + i;
          const t = Math.max(0, 1 - framesIn / fadeFrames);
          // Integer multiply-shift: Math.round(this._lastSample * t)
          const sample = (this._lastSample * t) | 0;
          out.writeInt16LE(sample, i * 2);
        }
        this._underrunFrames += chunkFrames;
      }

      try { (dest as any).write(out); } catch { /* pipe closed — stop will clean up */ }

      // Schedule next tick, compensating for any drift
      nextTickNs += intervalNs;
      const nowNs  = process.hrtime.bigint();
      const delayMs = Math.max(0, Number(nextTickNs - nowNs) / 1_000_000);
      this._timeoutId = setTimeout(tick, delayMs);
    };

    // Align first tick to now + one interval
    nextTickNs += intervalNs;
    const first = process.hrtime.bigint();
    this._timeoutId = setTimeout(tick, Math.max(0, Number(nextTickNs - first) / 1_000_000));
  }

  stop(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }
}

// ── VolumeControlPipe ─────────────────────────────────────────────────────────

export class VolumeControlPipe {
  private gain: number;
  private _timeoutId: NodeJS.Timeout | null = null;

  static readonly INTERVAL_MS  = config.volChunkIntervalMs;
  static readonly CHUNK_FRAMES = Math.floor(config.volSampleRate * (config.volChunkIntervalMs / 1000));
  static readonly CHUNK_BYTES  = VolumeControlPipe.CHUNK_FRAMES * 2 * 4; // f32le stereo

  constructor(initialGain: number) {
    this.gain = Math.max(0, Math.min(1, initialGain));
  }

  setGain(g: number): void { this.gain = Math.max(0, Math.min(1, g)); }
  getGain(): number { return this.gain; }

  startWritingTo(dest: NodeJS.WritableStream): void {
    const frames      = VolumeControlPipe.CHUNK_FRAMES;
    const chunkBytes  = VolumeControlPipe.CHUNK_BYTES;
    const intervalMs  = VolumeControlPipe.INTERVAL_MS;

    let nextTickNs = process.hrtime.bigint();
    const intervalNs = BigInt(intervalMs * 1_000_000);

    const tick = () => {
      if (!(dest as any).writable) return;
      const buf = Buffer.allocUnsafe(chunkBytes);
      const g = this.gain;
      for (let i = 0; i < frames * 2; i++) {
        buf.writeFloatLE(g, i * 4);
      }
      try { (dest as any).write(buf); } catch {}

      nextTickNs += intervalNs;
      const nowNs  = process.hrtime.bigint();
      const delayMs = Math.max(0, Number(nextTickNs - nowNs) / 1_000_000);
      this._timeoutId = setTimeout(tick, delayMs);
    };

    nextTickNs += intervalNs;
    const first = process.hrtime.bigint();
    this._timeoutId = setTimeout(tick, Math.max(0, Number(nextTickNs - first) / 1_000_000));
  }

  stop(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }
}

// ── Global mic distribution ───────────────────────────────────────────────────

const activeMicPipes = new Set<MicAudioPipe>();

export function registerMicPipe(pipe: MicAudioPipe): void {
  activeMicPipes.add(pipe);
}

export function unregisterMicPipe(pipe: MicAudioPipe): void {
  activeMicPipes.delete(pipe);
}

export function feedMicAudio(pcm: Buffer): void {
  activeMicPipes.forEach((p) => p.feed(pcm));
}

export function computeGain(streamMuted: boolean, liveAudioMuted: boolean, vol: number): number {
  if (streamMuted || liveAudioMuted) return 0;
  return Math.max(0, Math.min(1, vol / 100));
}
