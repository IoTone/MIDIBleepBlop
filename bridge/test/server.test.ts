import { MidiClient } from '@midi-bleep-bop/core';
import { NodeTransport } from '@midi-bleep-bop/transport-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MidiIO, MidiInput, MidiOutput } from '../src/midi.js';
import { BridgeServer } from '../src/server.js';

class MockInput implements MidiInput {
  readonly name = 'mock-input';
  private handler: ((bytes: Uint8Array) => void) | undefined;

  onData(handler: (bytes: Uint8Array) => void): void {
    this.handler = handler;
  }

  emit(bytes: Uint8Array): void {
    this.handler?.(bytes);
  }

  close(): void {
    // no-op
  }
}

class MockOutput implements MidiOutput {
  readonly sent: Uint8Array[] = [];
  constructor(readonly name: string) {}

  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }

  close(): void {
    // no-op
  }
}

class MockMidiIO implements MidiIO {
  readonly input = new MockInput();
  // One distinct output per pattern opened, so routing can be asserted.
  readonly outputs = new Map<string, MockOutput>();

  async listDevices(): Promise<{ inputs: string[]; outputs: string[] }> {
    return {
      inputs: [this.input.name],
      outputs: ['mock', 'USB MIDI Interface', 'IAC Driver Bus 1'],
    };
  }
  async openInput(): Promise<MidiInput> {
    return this.input;
  }
  async openOutput(pattern: string): Promise<MidiOutput> {
    let out = this.outputs.get(pattern);
    if (!out) {
      out = new MockOutput(pattern);
      this.outputs.set(pattern, out);
    }
    return out;
  }

  /** The default ('mock') output — convenience for tests that don't use routing. */
  get output(): MockOutput {
    return this.outputs.get('mock')!;
  }
  out(pattern: string): MockOutput {
    return this.outputs.get(pattern)!;
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('BridgeServer end-to-end with MockMidiIO', () => {
  let server: BridgeServer;
  let midi: MockMidiIO;
  let port: number;

  beforeEach(async () => {
    midi = new MockMidiIO();
    server = new BridgeServer({
      port: 0,
      inputPattern: 'mock',
      outputPattern: 'mock',
      midi,
    });
    const info = await server.start();
    port = info.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('forwards client-sent MIDI bytes to the MIDI output', async () => {
    const client = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    await client.connect();
    client.sendNoteOn(0, 60, 100);
    await waitFor(() => midi.output.sent.length > 0);
    expect(midi.output.sent).toEqual([new Uint8Array([0x90, 60, 100])]);
    client.close();
  });

  it('forwards incoming MIDI to all connected clients', async () => {
    const a = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    const b = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    await Promise.all([a.connect(), b.connect()]);

    const seenA: number[] = [];
    const seenB: number[] = [];
    a.on('noteOn', (m) => seenA.push(m.note));
    b.on('noteOn', (m) => seenB.push(m.note));

    midi.input.emit(new Uint8Array([0x90, 64, 100]));

    await waitFor(() => seenA.length > 0 && seenB.length > 0);
    expect(seenA).toEqual([64]);
    expect(seenB).toEqual([64]);

    a.close();
    b.close();
  });

  it('drops malformed (non-status-byte-leading) frames silently', async () => {
    const client = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    await client.connect();
    client.sendRaw(new Uint8Array([0x40, 0x50])); // first byte has no high bit
    // give the server a tick to process
    await new Promise((r) => setTimeout(r, 50));
    expect(midi.output.sent).toEqual([]);
    client.close();
  });

  it('exposes GET /status reporting input/output/clients', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      startedAt: string | null;
      clients: number;
      input: string | null;
      output: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.input).toBe('mock-input');
    expect(body.output).toBe('mock');
    expect(typeof body.startedAt).toBe('string');
    expect(body.clients).toBe(0);
  });

  it('GET /status reflects active client count', async () => {
    const client = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    await client.connect();
    // small delay to let the connection register on the server side
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    const body = (await res.json()) as { clients: number };
    expect(body.clients).toBe(1);
    client.close();
  });
});

describe('BridgeServer per-channel output routing', () => {
  let server: BridgeServer;
  let midi: MockMidiIO;
  let port: number;

  beforeEach(async () => {
    midi = new MockMidiIO();
    server = new BridgeServer({
      port: 0,
      inputPattern: 'mock',
      outputPattern: 'IAC Driver Bus 1', // default output
      routes: [{ channel: 0, pattern: 'USB MIDI Interface' }], // ch0 → Volca
      midi,
    });
    const info = await server.start();
    port = info.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('routes channel 0 to its mapped output and other channels to the default', async () => {
    const client = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    await client.connect();

    client.sendNoteOn(0, 60, 100); // ch0 → USB MIDI Interface
    client.sendNoteOn(1, 64, 100); // ch1 → default (IAC)

    await waitFor(
      () => midi.out('USB MIDI Interface').sent.length > 0 && midi.out('IAC Driver Bus 1').sent.length > 0,
    );

    expect(midi.out('USB MIDI Interface').sent).toEqual([new Uint8Array([0x90, 60, 100])]);
    expect(midi.out('IAC Driver Bus 1').sent).toEqual([new Uint8Array([0x91, 64, 100])]);
    client.close();
  });

  it('sends channel-less system messages to the default output', async () => {
    const client = new MidiClient(new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false }));
    await client.connect();

    client.sendRaw(new Uint8Array([0xf8])); // MIDI clock — no channel → default
    await waitFor(() => midi.out('IAC Driver Bus 1').sent.length > 0);
    expect(midi.out('IAC Driver Bus 1').sent).toEqual([new Uint8Array([0xf8])]);
    expect(midi.out('USB MIDI Interface').sent).toEqual([]);
    client.close();
  });

  it('reports routes in GET /status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    const body = (await res.json()) as {
      output: string;
      routes: Array<{ channel: number; output: string }>;
    };
    expect(body.output).toBe('IAC Driver Bus 1');
    expect(body.routes).toEqual([{ channel: 0, output: 'USB MIDI Interface' }]);
  });
});
