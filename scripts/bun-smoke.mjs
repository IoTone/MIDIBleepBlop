#!/usr/bin/env bun
// Self-contained smoke test that exercises the bridge end-to-end under whichever
// runtime executes it. Verifies:
//   1. BridgeServer starts (Express + http + ws wire-up)
//   2. GET /status returns expected shape
//   3. A WebSocket client can connect and have its MIDI frame forwarded to the mock MIDI output
// Designed to run under both `node scripts/bun-smoke.mjs` and `bun scripts/bun-smoke.mjs`.

import { BridgeServer } from '../bridge/dist/server.js';
import WebSocket from 'ws';

const midi = {
  input: { name: 'mock-input', _handler: null, onData(h) { this._handler = h; }, close() {} },
  output: { name: 'mock-output', sent: [], send(b) { this.sent.push(b); }, close() {} },
  async listDevices() { return { inputs: ['mock-input'], outputs: ['mock-output'] }; },
  async openInput() { return this.input; },
  async openOutput() { return this.output; },
};

const server = new BridgeServer({
  port: 0,
  inputPattern: 'mock',
  outputPattern: 'mock',
  midi,
});

const fail = (msg) => { process.stderr.write(`FAIL: ${msg}\n`); process.exit(1); };

try {
  const info = await server.start();
  process.stdout.write(`✓ bridge started on port ${info.port}\n`);

  const res = await fetch(`http://127.0.0.1:${info.port}/status`);
  if (res.status !== 200) fail(`/status returned ${res.status}`);
  const body = await res.json();
  if (!body.ok || body.input !== 'mock-input' || body.output !== 'mock-output') {
    fail(`/status body unexpected: ${JSON.stringify(body)}`);
  }
  process.stdout.write(`✓ GET /status ok: ${JSON.stringify(body)}\n`);

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}`);
    ws.on('open', () => {
      ws.send(new Uint8Array([0x90, 60, 100]), { binary: true });
      setTimeout(() => {
        if (midi.output.sent.length !== 1) {
          ws.close();
          return reject(new Error(`expected 1 sent frame, got ${midi.output.sent.length}`));
        }
        const sent = midi.output.sent[0];
        if (sent[0] !== 0x90 || sent[1] !== 60 || sent[2] !== 100) {
          ws.close();
          return reject(new Error(`wrong frame bytes: ${Array.from(sent).join(',')}`));
        }
        ws.close();
        resolve();
      }, 100);
    });
    ws.on('error', reject);
  });
  process.stdout.write(`✓ WS frame forwarded to MIDI output\n`);

  await server.stop();
  process.stdout.write(`✓ bridge stopped cleanly\n`);
  process.stdout.write(`\nAll smoke checks passed on ${typeof Bun !== 'undefined' ? 'Bun ' + Bun.version : 'Node ' + process.version}.\n`);
  process.exit(0);
} catch (e) {
  fail(e?.message ?? String(e));
}
