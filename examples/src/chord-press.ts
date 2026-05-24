// Send a C major triad on channel 1 once per second to a running bridge.
// Useful as a "does the bridge actually drive my synth?" smoke test.
//
// Usage: node dist/chord-press.js [ws://host:port]

import { MidiClient } from '@midi-bleep-bop/core';
import { NodeTransport } from '@midi-bleep-bop/transport-node';

const url = process.argv[2] ?? 'ws://127.0.0.1:8765';

const client = new MidiClient(new NodeTransport({ url }));

const CHORD = [60, 64, 67]; // C major: C, E, G
const CHANNEL = 0;
const VELOCITY = 90;
const HOLD_MS = 400;
const INTERVAL_MS = 1000;

async function main(): Promise<void> {
  await client.connect();
  process.stdout.write(`connected to ${url}\n`);
  process.stdout.write('sending C major every 1s — Ctrl+C to stop\n');

  const press = (): void => {
    for (const note of CHORD) client.sendNoteOn(CHANNEL, note, VELOCITY);
    setTimeout(() => {
      for (const note of CHORD) client.sendNoteOff(CHANNEL, note);
    }, HOLD_MS);
  };

  press();
  const interval = setInterval(press, INTERVAL_MS);

  process.on('SIGINT', () => {
    clearInterval(interval);
    for (const note of CHORD) client.sendNoteOff(CHANNEL, note);
    process.stdout.write('\nclosing\n');
    setTimeout(() => {
      client.close();
      process.exit(0);
    }, 100);
  });
}

main().catch((e) => {
  process.stderr.write(`error: ${String(e)}\n`);
  process.exit(1);
});
