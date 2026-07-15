/**
 * Noise Gate Worklet — smooth gain gating with configurable threshold.
 *
 * Runs in the Audio Worklet thread (128-sample blocks).
 * At 48 000 Hz: 128 samples ≈ 2.67 ms/block.
 *
 * Attack  10 ms  → gate opens  in ~4 blocks  (fast enough for plosives)
 * Release 120 ms → gate closes in ~45 blocks (smooth tail, avoids clipping words)
 *
 * The gain is smoothed with separate attack/release envelopes rather than
 * a hard on/off switch, which eliminates the "zipper noise" that hard-gate
 * implementations produce at the open/close transition.
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "threshold",
        defaultValue: 0.02,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: "k-rate",
      },
    ];
  }

  constructor() {
    super();
    this._gain = 0;
    // Lookahead: hold detected signal for a short window to avoid
    // clipping the attack transient of fast consonants.
    this._holdSamples = 0;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const threshold = parameters.threshold[0];
    const sampleRate = 48000; // matches AudioContext sampleRate

    const blockSec     = 128 / sampleRate;
    const attackStep   = blockSec / 0.010;  // 10 ms attack
    const releaseStep  = blockSec / 0.120;  // 120 ms release (was 80 ms)
    const holdBlocks   = Math.ceil(0.020 / blockSec); // 20 ms hold

    // Detect peak level in this block (RMS is smoother but peak is faster-responding)
    let peak = 0;
    for (let i = 0; i < inp.length; i++) {
      const a = Math.abs(inp[i]);
      if (a > peak) peak = a;
    }

    if (peak > threshold) {
      this._holdSamples = holdBlocks;
      this._gain = Math.min(1, this._gain + attackStep);
    } else if (this._holdSamples > 0) {
      // Hold: keep gate open for a few blocks after signal drops below threshold
      // to avoid clipping the natural decay/reverb tail of each word.
      this._holdSamples--;
      this._gain = Math.min(1, this._gain + attackStep);
    } else {
      this._gain = Math.max(0, this._gain - releaseStep);
    }

    const g = this._gain;
    for (let i = 0; i < inp.length; i++) {
      out[i] = inp[i] * g;
    }
    return true;
  }
}

registerProcessor("noise-gate-processor", NoiseGateProcessor);
