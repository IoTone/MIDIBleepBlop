#!/usr/bin/env node
// GarageBand audio verification — drives a chord progression through the bridge
// into GarageBand via IAC, so you can hear the full stack work end-to-end.
//
//   chord-press loop → bridge → CoreMIDI out → IAC Bus 1 → GarageBand soft instrument → speaker
//
// This is the audible companion to scripts/iac-loopback.mjs. That script proves
// the bytes round-trip; this one proves the bytes actually drive a real DAW
// into producing sound.
//
// One-time setup:
//
//   IAC (if not already done — same as iac-loopback.mjs):
//     1. Audio MIDI Setup → Window → Show MIDI Studio
//     2. Double-click IAC Driver, check "Device is online", ensure "Bus 1" exists
//
//   GarageBand:
//     1. Open GarageBand → choose "Empty Project" → Software Instrument
//     2. Pick any instrument (Grand Piano works well to verify)
//     3. Click the track once so it's selected — GarageBand auto-listens to all
//        MIDI inputs (including IAC Bus 1) on the selected software-instrument track
//     4. Make sure your output volume is up
//
// Then:
//
//   node scripts/garageband-play.mjs        # or: bun scripts/garageband-play.mjs
//
// Ctrl+C to stop. The script will send all-notes-off on shutdown so you don't
// leave hung notes in GarageBand.

import { BridgeServer } from '../bridge/dist/server.js';
import { JzzMidiIO } from '../bridge/dist/midi.js';
import { MidiClient } from '../packages/core/dist/index.js';
import { NodeTransport } from '../packages/transport-node/dist/index.js';

const log = (msg) => process.stdout.write(msg + '\n');
const fail = (msg) => {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(1);
};

const CHANNEL = 0;
const VELOCITY = 80;
const CHORD_HOLD_MS = 1500;
const GAP_MS = 200;

// I–vi–IV–V in C major
const PROGRESSION = [
  { name: 'C  major  ', notes: [60, 64, 67] },
  { name: 'A  minor  ', notes: [57, 60, 64] },
  { name: 'F  major  ', notes: [53, 57, 60] },
  { name: 'G  major  ', notes: [55, 59, 62] },
];

const midi = new JzzMidiIO();
const { inputs, outputs } = await midi.listDevices();

const matcher = /IAC|Bus/i;
const iacInputName = inputs.find((n) => matcher.test(n));
const iacOutputName = outputs.find((n) => matcher.test(n));

if (!iacInputName || !iacOutputName) {
  log('');
  log('IAC Driver not configured — see scripts/iac-loopback.mjs for setup steps.');
  log('');
  log(`Currently visible inputs:  ${inputs.length ? inputs.join(', ') : '(none)'}`);
  log(`Currently visible outputs: ${outputs.length ? outputs.join(', ') : '(none)'}`);
  process.exit(1);
}

log(`Using IAC port: input="${iacInputName}", output="${iacOutputName}"`);

const server = new BridgeServer({
  port: 0,
  inputPattern: iacInputName,
  outputPattern: iacOutputName,
  midi,
});

const info = await server.start();
log(`✓ bridge started on port ${info.port}`);

const client = new MidiClient(
  new NodeTransport({ url: `ws://127.0.0.1:${info.port}`, reconnect: false }),
);
await client.connect();
log(`✓ WS client connected`);
log('');
log('GarageBand checklist:');
log('  • Project open with a Software Instrument track');
log('  • Track selected (highlighted) so GarageBand monitors its MIDI input');
log('  • Output volume up');
log('');
log('Playing I–vi–IV–V in C major. Press Ctrl+C to stop.');
log('');

let stopped = false;

const allNotesOff = () => {
  for (const ch of PROGRESSION) for (const n of ch.notes) client.sendNoteOff(CHANNEL, n);
};

const cleanup = async () => {
  if (stopped) return;
  stopped = true;
  log('');
  log('Stopping (all-notes-off)…');
  allNotesOff();
  // give the noteOff packets a moment to actually flush through CoreMIDI
  await new Promise((r) => setTimeout(r, 100));
  client.close();
  await server.stop();
  log('Bridge stopped.');
  process.exit(0);
};

process.on('SIGINT', () => void cleanup());
process.on('SIGTERM', () => void cleanup());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

while (!stopped) {
  for (const chord of PROGRESSION) {
    if (stopped) break;
    log(`♪ ${chord.name}  ${chord.notes.join(' ')}`);
    for (const n of chord.notes) client.sendNoteOn(CHANNEL, n, VELOCITY);
    await sleep(CHORD_HOLD_MS);
    for (const n of chord.notes) client.sendNoteOff(CHANNEL, n);
    await sleep(GAP_MS);
  }
}
