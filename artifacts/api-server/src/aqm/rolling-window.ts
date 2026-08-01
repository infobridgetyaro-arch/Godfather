export class RollingWindow {
  private samples: Array<{ v: number; ts: number }> = [];
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 120_000) {
    this.maxAgeMs = maxAgeMs;
  }

  push(value: number): void {
    const now = Date.now();
    this.samples.push({ v: value, ts: now });
    const cutoff = now - this.maxAgeMs;
    let i = 0;
    while (i < this.samples.length && this.samples[i].ts < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  average(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    const window = this.samples.filter((s) => s.ts >= cutoff);
    if (window.length < 2) return 1.0;
    return window.reduce((sum, s) => sum + s.v, 0) / window.length;
  }

  count(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    return this.samples.filter((s) => s.ts >= cutoff).length;
  }

  last(): number | null {
    return this.samples.length > 0
      ? this.samples[this.samples.length - 1].v
      : null;
  }

  min(windowMs: number): number | null {
    const cutoff = Date.now() - windowMs;
    const window = this.samples.filter((s) => s.ts >= cutoff);
    if (window.length === 0) return null;
    return Math.min(...window.map((s) => s.v));
  }

  max(windowMs: number): number | null {
    const cutoff = Date.now() - windowMs;
    const window = this.samples.filter((s) => s.ts >= cutoff);
    if (window.length === 0) return null;
    return Math.max(...window.map((s) => s.v));
  }

  /**
   * Returns the trend over the window by comparing the first half average
   * against the second half average.
   * "improving" = value is going up, "degrading" = going down, "stable" = ±3%.
   */
  trend(windowMs: number): "improving" | "stable" | "degrading" {
    const cutoff = Date.now() - windowMs;
    const window = this.samples.filter((s) => s.ts >= cutoff);
    if (window.length < 4) return "stable";
    const mid = Math.floor(window.length / 2);
    const firstHalf = window.slice(0, mid);
    const secondHalf = window.slice(mid);
    const firstAvg = firstHalf.reduce((s, e) => s + e.v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, e) => s + e.v, 0) / secondHalf.length;
    if (firstAvg === 0) return "stable";
    const delta = (secondAvg - firstAvg) / firstAvg;
    if (delta > 0.03) return "improving";
    if (delta < -0.03) return "degrading";
    return "stable";
  }

  clear(): void {
    this.samples = [];
  }
}
