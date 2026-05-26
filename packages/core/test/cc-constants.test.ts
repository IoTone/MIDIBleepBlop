import { describe, expect, it } from 'vitest';
import { CC } from '../src/cc-constants.js';

describe('CC constants', () => {
  it('matches MIDI 1.0 spec for the most-used controllers', () => {
    expect(CC.BANK_SELECT_MSB).toBe(0);
    expect(CC.MOD_WHEEL).toBe(1);
    expect(CC.BREATH).toBe(2);
    expect(CC.VOLUME).toBe(7);
    expect(CC.PAN).toBe(10);
    expect(CC.EXPRESSION).toBe(11);
    expect(CC.SUSTAIN_PEDAL).toBe(64);
    expect(CC.FILTER_CUTOFF).toBe(74);
    expect(CC.RESONANCE).toBe(71);
    expect(CC.ALL_NOTES_OFF).toBe(123);
  });

  it('all values are in valid CC range (0-127)', () => {
    for (const [name, value] of Object.entries(CC)) {
      expect(value, `${name} out of range`).toBeGreaterThanOrEqual(0);
      expect(value, `${name} out of range`).toBeLessThanOrEqual(127);
    }
  });
});
