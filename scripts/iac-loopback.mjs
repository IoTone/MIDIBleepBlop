#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// IAC closed-loop end-to-end test.
//
// Opens macOS's IAC Driver as both input and output on the bridge, connects a
// WebSocket client, sends a MIDI noteOn, and verifies the same noteOn comes
// back through the WebSocket — having traversed:
//
//   WS client → bridge → CoreMIDI out → IAC bus → CoreMIDI in → bridge → WS client
//
// Unlike the vitest suite (which uses MockMidiIO), this exercises real
// JzzMidiIO and the jazz-midi N-API binding. Useful for catching regressions
// in JZZ versions, OS permission changes, or Bun/Node native-module gaps.
//
// One-time setup required:
//   1. Open Audio MIDI Setup (/Applications/Utilities/)
//   2. Window → Show MIDI Studio
//   3. Double-click "IAC Driver"
//   4. Check "Device is online"; ensure at least one port exists (default: "Bus 1")
//
// If IAC isn't configured, this script prints a setup hint and exits 0 —
// not a failure, just an unconfigured environment.
//
// Runs under both Node and Bun: `node scripts/iac-loopback.mjs` / `bun ...`.

import { BridgeServer } from '../bridge/dist/server.js';
import { JzzMidiIO } from '../bridge/dist/midi.js';
import { MidiClient } from '../packages/core/dist/index.js';
import { NodeTransport } from '../packages/transport-node/dist/index.js';

const log = (msg) => process.stdout.write(msg + '\n');
const fail = (msg) => {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(1);
};

const midi = new JzzMidiIO();
const { inputs, outputs } = await midi.listDevices();

// Look for IAC Driver in both directions. macOS names them "IAC Driver Bus 1",
// "IAC Driver Bus 2", etc. We accept either "IAC" or "Bus" in the name to
// tolerate user-renamed ports.
const matcher = /IAC|Bus/i;
const iacInputName = inputs.find((n) => matcher.test(n));
const iacOutputName = outputs.find((n) => matcher.test(n));

if (!iacInputName || !iacOutputName) {
  log('');
  log('IAC Driver not configured. To enable it (one-time setup):');
  log('  1. Open Audio MIDI Setup (/Applications/Utilities/)');
  log('  2. Window → Show MIDI Studio');
  log('  3. Double-click "IAC Driver"');
  log('  4. Check "Device is online" and ensure at least one port exists');
  log('  5. Apply, close, and re-run this script');
  log('');
  log(`Currently visible inputs:  ${inputs.length ? inputs.join(', ') : '(none)'}`);
  log(`Currently visible outputs: ${outputs.length ? outputs.join(', ') : '(none)'}`);
  log('');
  log('Skipping (not a failure — IAC is opt-in).');
  process.exit(0);
}

log(`Using IAC port: input="${iacInputName}", output="${iacOutputName}"`);

const server = new BridgeServer({
  port: 0,
  inputPattern: iacInputName,
  outputPattern: iacOutputName,
  midi,
});

let cleanup = async () => {};

try {
  const info = await server.start();
  log(`✓ bridge started on port ${info.port}`);

  const client = new MidiClient(
    new NodeTransport({ url: `ws://127.0.0.1:${info.port}`, reconnect: false }),
  );
  cleanup = async () => {
    client.close();
    await server.stop();
  };

  await client.connect();
  log(`✓ WS client connected to bridge`);

  const TEST_CHANNEL = 0;
  const TEST_NOTE = 60;
  const TEST_VEL = 100;
  const TIMEOUT_MS = 2000;

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `timeout: noteOn ch${TEST_CHANNEL} note=${TEST_NOTE} did not loop back within ${TIMEOUT_MS}ms`,
          ),
        ),
      TIMEOUT_MS,
    );
    client.on('noteOn', (m) => {
      if (m.channel === TEST_CHANNEL && m.note === TEST_NOTE && m.velocity === TEST_VEL) {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });

  client.sendNoteOn(TEST_CHANNEL, TEST_NOTE, TEST_VEL);
  log(`→ sent noteOn ch${TEST_CHANNEL} note=${TEST_NOTE} vel=${TEST_VEL}`);

  const m = await received;
  log(`← received noteOn ch${m.channel} note=${m.note} vel=${m.velocity}`);
  log(`✓ closed loop verified through CoreMIDI IAC`);

  // Send a corresponding noteOff to leave the bus clean (some apps listening to
  // IAC could otherwise hold the note until they're closed).
  client.sendNoteOff(TEST_CHANNEL, TEST_NOTE);

  await cleanup();
  log('');
  log(
    `All IAC loopback checks passed on ${typeof Bun !== 'undefined' ? 'Bun ' + Bun.version : 'Node ' + process.version}.`,
  );
  process.exit(0);
} catch (e) {
  await cleanup();
  fail(e?.message ?? String(e));
}
