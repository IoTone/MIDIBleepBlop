import { describe, expect, it } from 'vitest';
import { CCMapper } from '../src/cc-mapper.js';

describe('CCMapper — defaults', () => {
  it('defaults to 0..127 in, 0..1 out, no smoothing', () => {
    const m = new CCMapper();
    expect(m.inputMin).toBe(0);
    expect(m.inputMax).toBe(127);
    expect(m.outputMin).toBe(0);
    expect(m.outputMax).toBe(1);
    expect(m.smoothingFactor).toBe(0);
  });

  it('returns inputMin (raw) and outputMin (scaled) before any update', () => {
    const m = new CCMapper();
    expect(m.current()).toBe(0);
    expect(m.scaled()).toBe(0);
  });
});

describe('CCMapper — linear scaling', () => {
  it('maps 0..127 to 0..1 by default', () => {
    const m = new CCMapper();
    m.update(0);
    expect(m.scaled()).toBe(0);
    m.update(127);
    expect(m.scaled()).toBe(1);
    m.update(64);
    expect(m.scaled()).toBeCloseTo(64 / 127);
  });

  it('respects custom input range', () => {
    const m = new CCMapper({ inputMin: 32, inputMax: 96 });
    m.update(32);
    expect(m.scaled()).toBe(0);
    m.update(96);
    expect(m.scaled()).toBe(1);
    m.update(64);
    expect(m.scaled()).toBe(0.5);
  });

  it('respects custom output range', () => {
    const m = new CCMapper({ outputMin: -1, outputMax: 1 });
    m.update(0);
    expect(m.scaled()).toBe(-1);
    m.update(127);
    expect(m.scaled()).toBe(1);
    m.update(64);
    expect(m.scaled()).toBeCloseTo(-1 + 2 * (64 / 127));
  });

  it('clamps output below inputMin and above inputMax', () => {
    const m = new CCMapper({ inputMin: 32, inputMax: 96 });
    m.update(0);
    expect(m.scaled()).toBe(0);
    m.update(127);
    expect(m.scaled()).toBe(1);
  });

  it('inputMin == inputMax collapses to outputMin', () => {
    const m = new CCMapper({ inputMin: 50, inputMax: 50, outputMin: 0.5 });
    m.update(100);
    expect(m.scaled()).toBe(0.5);
  });
});

describe('CCMapper — smoothing', () => {
  it('factor 0 = instant: smoothed equals raw', () => {
    const m = new CCMapper({ smoothingFactor: 0 });
    m.update(64);
    expect(m.scaled()).toBeCloseTo(64 / 127);
    m.update(127);
    expect(m.scaled()).toBe(1);
  });

  it('factor > 0 lags toward target', () => {
    const m = new CCMapper({ smoothingFactor: 0.5 });
    // First update establishes baseline (no smoothing on first sight)
    m.update(0);
    expect(m.scaled()).toBe(0);
    // Now we step toward 127. EMA: smoothed = 0.5 * 0 + 0.5 * 127 = 63.5
    m.update(127);
    expect(m.scaled()).toBeCloseTo(63.5 / 127);
    // Step again toward 127: smoothed = 0.5 * 63.5 + 0.5 * 127 = 95.25
    m.update(127);
    expect(m.scaled()).toBeCloseTo(95.25 / 127);
  });

  it('factor 0.999 maxes out without freezing (never exactly 1)', () => {
    const m = new CCMapper({ smoothingFactor: 1.0 }); // ctor clamps to 0.999
    expect(m.smoothingFactor).toBeLessThan(1);
    m.update(0);
    m.update(127);
    // 0.999 * 0 + 0.001 * 127 — moves a tiny amount
    expect(m.scaled()).toBeGreaterThan(0);
    expect(m.scaled()).toBeLessThan(0.01);
  });

  it('factor below 0 is clamped to 0', () => {
    const m = new CCMapper({ smoothingFactor: -1 });
    expect(m.smoothingFactor).toBe(0);
  });
});

describe('CCMapper — update return value', () => {
  it('reports scaled-value change on each meaningful update', () => {
    const m = new CCMapper();
    expect(m.update(64)).toBe(true);
    expect(m.update(64)).toBe(false); // same raw → same scaled → no change
    expect(m.update(65)).toBe(true);
  });
});

describe('CCMapper — reset', () => {
  it('returns to unobserved state', () => {
    const m = new CCMapper();
    m.update(100);
    expect(m.current()).toBe(100);
    m.reset();
    expect(m.current()).toBe(0);
    expect(m.scaled()).toBe(0);
    // First update after reset doesn't smooth from previous value
    m.update(127);
    expect(m.current()).toBe(127);
    expect(m.scaled()).toBe(1);
  });
});
