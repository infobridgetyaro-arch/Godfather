/**
 * PCM Sender Worklet — Float32 → Int16 with soft clip + TPDF dither
 *
 * Runs in the Audio Worklet thread (128-sample blocks at the AudioContext
 * sample rate, nominally 48 000 Hz ≈ 2.67 ms/block).
 *
 * Improvements over a naïve Int16 cast:
 *
 *  Soft clip at ±0.99
 *    The dynamics compressor and gain node earlier in the chain can
 *    occasionally push samples past ±1.0. A hard Math.max/min clamp would
 *    introduce phase-coherent distortion at full-scale transients.
 *    Instead we soft-clip with a smooth cubic saturation curve, which
 *    rolls off gracefully rather than hard-limiting.
 *
 *  TPDF dither
 *    Triangular Probability Density Function dither adds exactly ±1 LSB of
 *    spectrally-flat noise before quantisation. This eliminates "granulation
 *    noise" (the faint buzzing caused by correlated quantisation error in
 *    low-level signals) and linearises the quantiser's effective response.
 *    The added noise is ~-90 dBFS RMS — inaudible in practice but critical
 *    for perceptual transparency in quiet passages.
 *
 *  First-order noise shaping
 *    The dither is first-order error-feedback shaped: the quantisation error
 *    from the previous sample is subtracted before the next conversion. This
 *    shifts quantisation noise energy toward higher frequencies (away from
 *    voice/music fundamentals) while keeping the total noise power the same.
 */
class PCMSenderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._err = 0; // quantisation error for first-order noise shaping
  }

  /**
   * Smooth cubic soft-clip transfer function.
   * Stays linear up to ±0.9, then rolls off to ±1.0 at the limit.
   * Much lower harmonic distortion than a hard clamp at the same ceiling.
   */
  static _softClip(x) {
    const limit = 0.99;
    if (x >= limit) return limit;
    if (x <= -limit) return -limit;
    // Cubic saturation zone between 0.9 and 0.99
    const knee = 0.90;
    if (x > knee) {
      const t = (x - knee) / (limit - knee); // 0→1 in the knee
      return knee + (limit - knee) * (1.5 * t - 0.5 * t * t * t);
    }
    if (x < -knee) {
      const t = (-x - knee) / (limit - knee);
      return -(knee + (limit - knee) * (1.5 * t - 0.5 * t * t * t));
    }
    return x;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channelData = input[0];
    const pcm = new Int16Array(channelData.length);

    for (let i = 0; i < channelData.length; i++) {
      // 1. Soft-clip to prevent hard digital clipping
      const clipped = PCMSenderProcessor._softClip(channelData[i]);

      // 2. First-order noise-shaped TPDF dither
      //    Two independent uniform samples → triangular distribution
      const r1 = Math.random() - 0.5;
      const r2 = Math.random() - 0.5;
      const dither = (r1 + r2) / 32768; // ±1 LSB amplitude

      // 3. Apply noise shaping: subtract previous quantisation error
      const shaped = clipped + dither - this._err;

      // 4. Quantise to Int16
      const quantised = Math.round(shaped * 32767);
      const clamped = quantised < -32768 ? -32768 : quantised > 32767 ? 32767 : quantised;
      pcm[i] = clamped;

      // 5. Compute quantisation error for next sample's shaping
      this._err = clamped / 32767 - shaped;
    }

    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("pcm-sender-processor", PCMSenderProcessor);
