import { MidiClient } from '@midi-bleep-bop/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { NodeTransport } from '../src/index.js';

// Spin up a tiny in-process WS server that loops binary frames back to the sender.
// This is the test-only stand-in for the real bridge.

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for predicate'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('NodeTransport against a real WebSocket server', () => {
  let server: WebSocketServer;
  let port: number;
  let lastClient: WebSocket | undefined;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => server.once('listening', r));
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('expected address object');
    port = addr.port;

    server.on('connection', (ws) => {
      lastClient = ws;
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        ws.send(data, { binary: true });
      });
    });
  });

  afterEach(async () => {
    lastClient = undefined;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('connects, sends, loops back via MidiClient', async () => {
    const t = new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: false });
    const c = new MidiClient(t);
    await c.connect();

    const seen: Array<{ note: number; vel: number }> = [];
    c.on('noteOn', (m) => seen.push({ note: m.note, vel: m.velocity }));

    c.sendNoteOn(0, 60, 100);
    await waitFor(() => seen.length > 0);
    expect(seen).toEqual([{ note: 60, vel: 100 }]);

    c.close();
  });

  it('reconnects after the server drops the client', async () => {
    const t = new NodeTransport({ url: `ws://127.0.0.1:${port}`, reconnect: true, reconnectMaxMs: 100 });
    const c = new MidiClient(t);
    await c.connect();

    let disconnects = 0;
    let connects = 0;
    c.on('disconnect', () => disconnects++);
    c.on('connect', () => connects++);

    // Force the server side to close the existing connection
    lastClient?.close();

    await waitFor(() => disconnects >= 1 && connects >= 1, 3000);
    expect(disconnects).toBeGreaterThanOrEqual(1);
    expect(connects).toBeGreaterThanOrEqual(1);

    // Verify a fresh message round-trips after reconnect
    const seen: number[] = [];
    c.on('cc', (m) => seen.push(m.value));
    c.sendCC(0, 1, 64);
    await waitFor(() => seen.length > 0);
    expect(seen).toEqual([64]);

    c.close();
  });
});
