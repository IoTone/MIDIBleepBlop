import { describe, expect, it } from 'vitest';
import { MidiState } from '../src/state.js';

describe('MidiState', () => {
  it('tracks held notes per channel', () => {
    const s = new MidiState();
    s.apply({ type: 'noteOn', channel: 0, note: 60, velocity: 100 });
    s.apply({ type: 'noteOn', channel: 0, note: 64, velocity: 100 });
    s.apply({ type: 'noteOn', channel: 1, note: 72, velocity: 100 });
    expect(s.heldNotes(0)).toEqual([60, 64]);
    expect(s.heldNotes(1)).toEqual([72]);
    expect(s.heldNotes()).toEqual([60, 64, 72]);
  });

  it('releases held notes on noteOff', () => {
    const s = new MidiState();
    s.apply({ type: 'noteOn', channel: 0, note: 60, velocity: 100 });
    s.apply({ type: 'noteOff', channel: 0, note: 60, velocity: 0 });
    expect(s.heldNotes(0)).toEqual([]);
  });

  it('tracks last CC value per controller', () => {
    const s = new MidiState();
    s.apply({ type: 'cc', channel: 0, controller: 1, value: 64 });
    s.apply({ type: 'cc', channel: 0, controller: 7, value: 100 });
    s.apply({ type: 'cc', channel: 0, controller: 1, value: 80 });
    expect(s.get(0)?.cc.get(1)).toBe(80);
    expect(s.get(0)?.cc.get(7)).toBe(100);
  });

  it('tracks program, pitch bend, channel pressure', () => {
    const s = new MidiState();
    s.apply({ type: 'programChange', channel: 0, program: 5 });
    s.apply({ type: 'pitchBend', channel: 0, value: 4096 });
    s.apply({ type: 'channelPressure', channel: 0, pressure: 90 });
    expect(s.get(0)?.program).toBe(5);
    expect(s.get(0)?.pitchBend).toBe(4096);
    expect(s.get(0)?.channelPressure).toBe(90);
  });

  it('ignores raw messages without throwing', () => {
    const s = new MidiState();
    expect(() => s.apply({ type: 'raw', bytes: new Uint8Array([0xf8]) })).not.toThrow();
  });

  it('exposes 16 channels, returns undefined for out-of-range', () => {
    const s = new MidiState();
    expect(s.get(0)).toBeDefined();
    expect(s.get(15)).toBeDefined();
    expect(s.get(16)).toBeUndefined();
  });
});
