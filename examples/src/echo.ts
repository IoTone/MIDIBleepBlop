// Connect to a running bridge and print every incoming MIDI message.
// Useful as a "is this bridge actually receiving from my MIDI gear?" smoke test.
//
// Usage: node dist/echo.js [ws://host:port]

import { MidiClient } from '@midi-bleep-bop/core';
import { NodeTransport } from '@midi-bleep-bop/transport-node';

const url = process.argv[2] ?? 'ws://127.0.0.1:8765';

const client = new MidiClient(new NodeTransport({ url }));

client.on('connect', () => process.stdout.write(`connected to ${url}\n`));
client.on('disconnect', () => process.stdout.write(`disconnected from ${url}\n`));

client.on('message', (m) => {
  switch (m.type) {
    case 'noteOn':
      process.stdout.write(`  noteOn   ch${m.channel} note=${m.note} vel=${m.velocity}\n`);
      break;
    case 'noteOff':
      process.stdout.write(`  noteOff  ch${m.channel} note=${m.note} vel=${m.velocity}\n`);
      break;
    case 'cc':
      process.stdout.write(`  cc       ch${m.channel} cc=${m.controller} val=${m.value}\n`);
      break;
    case 'programChange':
      process.stdout.write(`  pgm      ch${m.channel} program=${m.program}\n`);
      break;
    case 'pitchBend':
      process.stdout.write(`  bend     ch${m.channel} value=${m.value}\n`);
      break;
    case 'channelPressure':
      process.stdout.write(`  pressure ch${m.channel} value=${m.pressure}\n`);
      break;
    case 'polyPressure':
      process.stdout.write(`  poly     ch${m.channel} note=${m.note} pressure=${m.pressure}\n`);
      break;
    case 'raw': {
      const hex = Array.from(m.bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
      process.stdout.write(`  raw      ${hex}\n`);
      break;
    }
  }
});

process.on('SIGINT', () => {
  process.stdout.write('\nclosing\n');
  client.close();
  process.exit(0);
});
