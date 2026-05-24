import { describe, expect, it, vi } from 'vitest';
import { MidiClient } from '../src/client.js';
import { encodeMessage } from '../src/messages.js';
import { MockTransport } from '../src/transport.js';

describe('MidiClient — sending', () => {
  it('sendNoteOn writes the right bytes via the transport', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    c.sendNoteOn(0, 60, 100);
    expect(t.sent).toEqual([new Uint8Array([0x90, 60, 100])]);
  });

  it('sendNoteOff writes 0x80 with default velocity 0', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    c.sendNoteOff(0, 60);
    expect(t.sent).toEqual([new Uint8Array([0x80, 60, 0])]);
  });

  it('sendCC, sendProgramChange, sendPitchBend, sendChannelPressure all encode correctly', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    c.sendCC(0, 1, 64);
    c.sendProgramChange(0, 5);
    c.sendPitchBend(0, 0);
    c.sendChannelPressure(0, 90);
    expect(t.sent).toEqual([
      new Uint8Array([0xb0, 1, 64]),
      new Uint8Array([0xc0, 5]),
      new Uint8Array([0xe0, 0x00, 0x40]),
      new Uint8Array([0xd0, 90]),
    ]);
  });

  it('send(msg) dispatches generic messages', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    c.send({ type: 'noteOn', channel: 0, note: 60, velocity: 100 });
    expect(t.sent).toEqual([new Uint8Array([0x90, 60, 100])]);
  });

  it('sendRaw passes through untouched', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    c.sendRaw(new Uint8Array([0xf8]));
    expect(t.sent).toEqual([new Uint8Array([0xf8])]);
  });
});

describe('MidiClient — events', () => {
  it('emits noteOn / noteOff / cc / programChange / pitchBend / channelPressure', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    const seen: string[] = [];

    c.on('noteOn', (m) => seen.push(`on:${m.note}`));
    c.on('noteOff', (m) => seen.push(`off:${m.note}`));
    c.on('cc', (m) => seen.push(`cc:${m.controller}=${m.value}`));
    c.on('programChange', (m) => seen.push(`pgm:${m.program}`));
    c.on('pitchBend', (m) => seen.push(`pb:${m.value}`));
    c.on('channelPressure', (m) => seen.push(`pressure:${m.pressure}`));

    t.simulateMessage(encodeMessage({ type: 'noteOn', channel: 0, note: 60, velocity: 100 }));
    t.simulateMessage(encodeMessage({ type: 'noteOff', channel: 0, note: 60, velocity: 0 }));
    t.simulateMessage(encodeMessage({ type: 'cc', channel: 0, controller: 1, value: 64 }));
    t.simulateMessage(encodeMessage({ type: 'programChange', channel: 0, program: 5 }));
    t.simulateMessage(encodeMessage({ type: 'pitchBend', channel: 0, value: 4096 }));
    t.simulateMessage(encodeMessage({ type: 'channelPressure', channel: 0, pressure: 90 }));

    expect(seen).toEqual(['on:60', 'off:60', 'cc:1=64', 'pgm:5', 'pb:4096', 'pressure:90']);
  });

  it('emits message for every incoming message including raw', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    const types: string[] = [];
    c.on('message', (m) => types.push(m.type));

    t.simulateMessage(new Uint8Array([0x90, 60, 100]));
    t.simulateMessage(new Uint8Array([0xf8]));
    expect(types).toEqual(['noteOn', 'raw']);
  });

  it('unsubscribe handler stops firing', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    const fn = vi.fn();
    const off = c.on('noteOn', fn);
    t.simulateMessage(new Uint8Array([0x90, 60, 100]));
    off();
    t.simulateMessage(new Uint8Array([0x90, 60, 100]));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('MidiClient — state queries', () => {
  it('heldNotes reflects incoming noteOn/noteOff', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    t.simulateMessage(new Uint8Array([0x90, 60, 100]));
    t.simulateMessage(new Uint8Array([0x90, 64, 100]));
    expect(c.heldNotes(0)).toEqual([60, 64]);
    t.simulateMessage(new Uint8Array([0x80, 60, 0]));
    expect(c.heldNotes(0)).toEqual([64]);
  });

  it('ccValue returns the latest value or undefined', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    expect(c.ccValue(0, 1)).toBeUndefined();
    t.simulateMessage(new Uint8Array([0xb0, 1, 64]));
    expect(c.ccValue(0, 1)).toBe(64);
    t.simulateMessage(new Uint8Array([0xb0, 1, 80]));
    expect(c.ccValue(0, 1)).toBe(80);
  });

  it('pitchBend defaults to 0', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    expect(c.pitchBend(0)).toBe(0);
    t.simulateMessage(new Uint8Array([0xe0, 0x00, 0x60]));
    expect(c.pitchBend(0)).toBe(4096);
  });
});

describe('MidiClient — state observations', () => {
  it('onCCChange fires only on actual value changes', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    const seen: Array<{ v: number; prev: number | undefined }> = [];
    c.onCCChange(0, 1, (v, prev) => seen.push({ v, prev }));

    t.simulateMessage(new Uint8Array([0xb0, 1, 64]));
    t.simulateMessage(new Uint8Array([0xb0, 1, 64])); // dup
    t.simulateMessage(new Uint8Array([0xb0, 1, 65]));
    t.simulateMessage(new Uint8Array([0xb0, 1, 65])); // dup
    t.simulateMessage(new Uint8Array([0xb0, 2, 0])); // different controller
    expect(seen).toEqual([
      { v: 64, prev: undefined },
      { v: 65, prev: 64 },
    ]);
  });

  it('onNoteHeld fires true on first noteOn and false on noteOff (no spurious repeats)', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    const events: Array<{ held: boolean; vel: number }> = [];
    c.onNoteHeld(0, 60, (held, vel) => events.push({ held, vel }));

    t.simulateMessage(new Uint8Array([0x90, 60, 100]));
    t.simulateMessage(new Uint8Array([0x90, 60, 80])); // restrike same note while held — no event
    t.simulateMessage(new Uint8Array([0x80, 60, 0]));
    t.simulateMessage(new Uint8Array([0x80, 60, 0])); // dup release
    expect(events).toEqual([
      { held: true, vel: 100 },
      { held: false, vel: 0 },
    ]);
  });

  it('onProgramChange fires only when program actually changes', () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    const seen: number[] = [];
    c.onProgramChange(0, (p) => seen.push(p));

    t.simulateMessage(new Uint8Array([0xc0, 5]));
    t.simulateMessage(new Uint8Array([0xc0, 5])); // dup
    t.simulateMessage(new Uint8Array([0xc0, 6]));
    expect(seen).toEqual([5, 6]);
  });
});

describe('MidiClient — lifecycle', () => {
  it('connect() resolves immediately if already open', async () => {
    const t = new MockTransport();
    const c = new MidiClient(t);
    await expect(c.connect()).resolves.toBeUndefined();
  });

  it('connect() waits for transport to reach open', async () => {
    const t = new MockTransport();
    t.setState('closed');
    const c = new MidiClient(t);
    const promise = c.connect();
    // intentionally async
    queueMicrotask(() => t.setState('open'));
    await expect(promise).resolves.toBeUndefined();
    expect(c.connected).toBe(true);
  });

  it('emits connect and disconnect', () => {
    const t = new MockTransport();
    t.setState('closed');
    const c = new MidiClient(t);
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    c.on('connect', onConnect);
    c.on('disconnect', onDisconnect);

    t.setState('open');
    t.setState('closed');

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
