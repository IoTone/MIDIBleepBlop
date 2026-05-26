// CCMapper — pure-TS scaling + smoothing primitive for a single CC stream.
//
// Owned by `CCParam` (the Lens Studio @component) but implemented here so the
// math is unit-testable without Lens Studio in the loop.
//
//   raw  ∈ [inputMin, inputMax]   (typically 0..127 for a CC)
//   smoothed  ← EMA toward raw on each update()
//   scaled    ∈ [outputMin, outputMax]   (linear map of clamped smoothed)
//
// `smoothingFactor` is the EMA coefficient: 0 = no smoothing (smoothed == raw),
// values approaching 1 retain more history per update (laggier). Values are
// clamped to [0, 0.999) — exactly 1 would freeze the smoothed value.

export interface CCMapperOptions {
  inputMin?: number;
  inputMax?: number;
  outputMin?: number;
  outputMax?: number;
  smoothingFactor?: number;
}

export class CCMapper {
  readonly inputMin: number;
  readonly inputMax: number;
  readonly outputMin: number;
  readonly outputMax: number;
  readonly smoothingFactor: number;

  private _raw: number;
  private _smoothed: number;
  private _hasValue = false;

  constructor(opts: CCMapperOptions = {}) {
    this.inputMin = opts.inputMin ?? 0;
    this.inputMax = opts.inputMax ?? 127;
    this.outputMin = opts.outputMin ?? 0;
    this.outputMax = opts.outputMax ?? 1;
    this.smoothingFactor = Math.max(0, Math.min(0.999, opts.smoothingFactor ?? 0));
    this._raw = this.inputMin;
    this._smoothed = this.inputMin;
  }

  /**
   * Push a new raw value (typically a CC value, 0-127). Returns true if the
   * scaled output changed enough to be observable.
   */
  update(rawValue: number): boolean {
    this._raw = rawValue;
    const prevScaled = this.scaled();
    if (!this._hasValue) {
      this._smoothed = rawValue;
      this._hasValue = true;
    } else if (this.smoothingFactor === 0) {
      this._smoothed = rawValue;
    } else {
      // Exponential moving average: smoothed ← α·smoothed + (1-α)·raw
      const a = this.smoothingFactor;
      this._smoothed = a * this._smoothed + (1 - a) * rawValue;
    }
    return this.scaled() !== prevScaled;
  }

  /** Most recent raw input. Returns inputMin if update() has never been called. */
  current(): number {
    return this._raw;
  }

  /** Smoothed + scaled value in [outputMin, outputMax]. Clamped on output. */
  scaled(): number {
    const span = this.inputMax - this.inputMin;
    if (span === 0) return this.outputMin;
    const norm = (this._smoothed - this.inputMin) / span;
    const clamped = norm < 0 ? 0 : norm > 1 ? 1 : norm;
    return this.outputMin + clamped * (this.outputMax - this.outputMin);
  }

  /** Reset to the unobserved state. Smoothed and raw both revert to inputMin. */
  reset(): void {
    this._raw = this.inputMin;
    this._smoothed = this.inputMin;
    this._hasValue = false;
  }
}
