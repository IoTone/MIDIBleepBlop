#!/usr/bin/env node
import { Command } from 'commander';
import { JzzMidiIO } from './midi.js';
import { BridgeServer } from './server.js';

const program = new Command();
program
  .name('midi-bleep-bop-bridge')
  .description('WebSocket ↔ OS MIDI bridge for midi-bleep-bop')
  .option('-p, --port <n>', 'WebSocket port', '8765')
  .option('-d, --device <pattern>', 'MIDI device name substring (used for both input and output)')
  .option('-i, --input <pattern>', 'MIDI input device name substring (overrides --device)')
  .option('-o, --output <pattern>', 'MIDI output device name substring (overrides --device)')
  .option('-l, --log <level>', 'log level: off | error | info | debug', 'info')
  .option('--list', 'list available MIDI devices and exit')
  .parse();

const opts = program.opts<{
  port: string;
  device?: string;
  input?: string;
  output?: string;
  log: string;
  list?: boolean;
}>();

const log = (level: 'info' | 'error' | 'debug', msg: string): void => {
  const ranks = { off: 0, error: 1, info: 2, debug: 3 } as const;
  const threshold = ranks[opts.log as keyof typeof ranks] ?? ranks.info;
  const rank = ranks[level];
  if (rank > threshold) return;
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`[${level}] ${msg}\n`);
};

const midi = new JzzMidiIO();

if (opts.list) {
  const { inputs, outputs } = await midi.listDevices();
  process.stdout.write('Inputs:\n');
  for (const n of inputs) process.stdout.write(`  ${n}\n`);
  process.stdout.write('\nOutputs:\n');
  for (const n of outputs) process.stdout.write(`  ${n}\n`);
  process.exit(0);
}

const inputPattern = opts.input ?? opts.device;
const outputPattern = opts.output ?? opts.device;
if (!inputPattern || !outputPattern) {
  process.stderr.write('error: --device (or both --input and --output) is required.\n');
  process.stderr.write('Run with --list to see available devices.\n');
  process.exit(2);
}

const port = Number.parseInt(opts.port, 10);
if (!Number.isFinite(port) || port < 1 || port > 65535) {
  process.stderr.write(`error: invalid --port "${opts.port}"\n`);
  process.exit(2);
}

const server = new BridgeServer({
  port,
  inputPattern,
  outputPattern,
  midi,
  onLog: log,
});

try {
  const info = await server.start();
  log('info', `bridge listening on ws://0.0.0.0:${info.port}`);
  log('info', `MIDI input:  ${info.inputName}`);
  log('info', `MIDI output: ${info.outputName}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const shutdown = async (): Promise<void> => {
  log('info', 'shutting down');
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
