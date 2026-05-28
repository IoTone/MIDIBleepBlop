import { MidiClient } from '@midi-bleep-bop/core';
import { NodeTransport } from '@midi-bleep-bop/transport-node';

const url = 'ws://127.0.0.1:8765';
const CH = 0; // our ch0 = MIDI channel 1 = Volca Keys default
const VEL = 100;
const scale = [60, 62, 64, 65, 67, 69, 71, 72]; // C D E F G A B C
const noteMs = 350;

const c = new MidiClient(new NodeTransport({ url, reconnect: false }));
await c.connect();
process.stdout.write('connected; playing C major scale on ch0 -> Volca Keys\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const n of scale) {
  c.sendNoteOn(CH, n, VEL);
  process.stdout.write('  note ' + n + '\n');
  await sleep(noteMs);
  c.sendNoteOff(CH, n);
  await sleep(40);
}
for (const n of scale) c.sendNoteOff(CH, n);
await sleep(100);
c.close();
process.stdout.write('done\n');
process.exit(0);
