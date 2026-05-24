import { describe, expect, it } from 'vitest';
import { encodeMessage, parseMessage, type MidiMessage } from '../src/messages.js';

describe('parseMessage', () => {
  it('parses noteOn', () => {
    expect(parseMessage(new Uint8Array([0x90, 60, 100]))).toEqual({
      type: 'noteOn',
      channel: 0,
      note: 60,
      velocity: 100,
    });
  });

  it('parses noteOn on a high channel', () => {
    expect(parseMessage(new Uint8Array([0x9f, 60, 100]))).toEqual({
      type: 'noteOn',
      channel: 15,
      note: 60,
      velocity: 100,
    });
  });

  it('treats noteOn velocity 0 as noteOff', () => {
    expect(parseMessage(new Uint8Array([0x90, 60, 0]))).toEqual({
      type: 'noteOff',
      channel: 0,
      note: 60,
      velocity: 0,
    });
  });

  it('parses explicit noteOff', () => {
    expect(parseMessage(new Uint8Array([0x80, 60, 64]))).toEqual({
      type: 'noteOff',
      channel: 0,
      note: 60,
      velocity: 64,
    });
  });

  it('parses CC', () => {
    expect(parseMessage(new Uint8Array([0xb0, 1, 64]))).toEqual({
      type: 'cc',
      channel: 0,
      controller: 1,
      value: 64,
    });
  });

  it('parses programChange', () => {
    expect(parseMessage(new Uint8Array([0xc0, 5]))).toEqual({
      type: 'programChange',
      channel: 0,
      program: 5,
    });
  });

  it('parses pitchBend (centered)', () => {
    expect(parseMessage(new Uint8Array([0xe0, 0x00, 0x40]))).toEqual({
      type: 'pitchBend',
      channel: 0,
      value: 0,
    });
  });

  it('parses pitchBend (min)', () => {
    expect(parseMessage(new Uint8Array([0xe0, 0x00, 0x00]))).toEqual({
      type: 'pitchBend',
      channel: 0,
      value: -8192,
    });
  });

  it('parses pitchBend (max)', () => {
    expect(parseMessage(new Uint8Array([0xe0, 0x7f, 0x7f]))).toEqual({
      type: 'pitchBend',
      channel: 0,
      value: 8191,
    });
  });

  it('parses channelPressure', () => {
    expect(parseMessage(new Uint8Array([0xd0, 64]))).toEqual({
      type: 'channelPressure',
      channel: 0,
      pressure: 64,
    });
  });

  it('parses polyPressure', () => {
    expect(parseMessage(new Uint8Array([0xa0, 60, 100]))).toEqual({
      type: 'polyPressure',
      channel: 0,
      note: 60,
      pressure: 100,
    });
  });

  it('falls back to raw for system messages', () => {
    const bytes = new Uint8Array([0xf8]);
    expect(parseMessage(bytes)).toEqual({ type: 'raw', bytes });
  });

  it('falls back to raw for empty input', () => {
    const bytes = new Uint8Array([]);
    expect(parseMessage(bytes)).toEqual({ type: 'raw', bytes });
  });

  it('falls back to raw for truncated messages', () => {
    const bytes = new Uint8Array([0x90, 60]);
    expect(parseMessage(bytes)).toEqual({ type: 'raw', bytes });
  });

  it('falls back to raw when first byte is not a status byte', () => {
    const bytes = new Uint8Array([0x40, 0x50]);
    expect(parseMessage(bytes)).toEqual({ type: 'raw', bytes });
  });
});

describe('encodeMessage', () => {
  const cases: MidiMessage[] = [
    { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
    { type: 'noteOn', channel: 15, note: 60, velocity: 100 },
    { type: 'noteOff', channel: 0, note: 60, velocity: 64 },
    { type: 'cc', channel: 0, controller: 1, value: 64 },
    { type: 'programChange', channel: 0, program: 5 },
    { type: 'pitchBend', channel: 0, value: 0 },
    { type: 'pitchBend', channel: 0, value: -8192 },
    { type: 'pitchBend', channel: 0, value: 8191 },
    { type: 'channelPressure', channel: 0, pressure: 64 },
    { type: 'polyPressure', channel: 0, note: 60, pressure: 100 },
  ];

  for (const msg of cases) {
    it(`round-trips ${msg.type}${'channel' in msg ? ` ch${msg.channel}` : ''}`, () => {
      const bytes = encodeMessage(msg);
      expect(parseMessage(bytes)).toEqual(msg);
    });
  }

  it('round-trips noteOff via velocity-0 noteOn shortcut', () => {
    // sending noteOff with velocity 0 still encodes as 0x80, parses back as noteOff
    const msg: MidiMessage = { type: 'noteOff', channel: 0, note: 60, velocity: 0 };
    const bytes = encodeMessage(msg);
    expect(bytes).toEqual(new Uint8Array([0x80, 60, 0]));
    expect(parseMessage(bytes)).toEqual(msg);
  });
});
