// SPDX-License-Identifier: MIT
// Thin abstraction over JZZ so the bridge can be tested without real MIDI hardware.

export interface MidiInput {
  readonly name: string;
  onData(handler: (bytes: Uint8Array) => void): void;
  close(): Promise<void> | void;
}

export interface MidiOutput {
  readonly name: string;
  send(bytes: Uint8Array): void;
  close(): Promise<void> | void;
}

export interface MidiIO {
  listDevices(): Promise<{ inputs: string[]; outputs: string[] }>;
  openInput(pattern: string): Promise<MidiInput>;
  openOutput(pattern: string): Promise<MidiOutput>;
}

export class DeviceNotFoundError extends Error {
  constructor(
    public readonly kind: 'input' | 'output',
    public readonly pattern: string,
    public readonly available: string[],
  ) {
    super(
      `No MIDI ${kind} device matched "${pattern}". Available: ${available.length === 0 ? '(none)' : available.join(', ')}`,
    );
    this.name = 'DeviceNotFoundError';
  }
}

interface JzzInfo {
  inputs: Array<{ name: string }>;
  outputs: Array<{ name: string }>;
}

interface JzzPort {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(handler: (msg: any) => void): JzzPort;
  send(bytes: number[]): void;
  close(): Promise<unknown>;
}

interface JzzModule {
  info(): JzzInfo;
  openMidiIn(name: string): Promise<JzzPort>;
  openMidiOut(name: string): Promise<JzzPort>;
}

export class JzzMidiIO implements MidiIO {
  private jzz: JzzModule | undefined;

  private async getJzz(): Promise<JzzModule> {
    if (this.jzz) return this.jzz;
    // Dynamic import so the bridge package can be type-checked / unit-tested without jzz installed.
    const mod = (await import('jzz')) as unknown as { default: () => JzzModule };
    this.jzz = mod.default();
    return this.jzz;
  }

  async listDevices(): Promise<{ inputs: string[]; outputs: string[] }> {
    const jzz = await this.getJzz();
    const info = jzz.info();
    return {
      inputs: info.inputs.map((i) => i.name),
      outputs: info.outputs.map((o) => o.name),
    };
  }

  async openInput(pattern: string): Promise<MidiInput> {
    const jzz = await this.getJzz();
    const { inputs } = await this.listDevices();
    const name = inputs.find((n) => n.toLowerCase().includes(pattern.toLowerCase()));
    if (!name) throw new DeviceNotFoundError('input', pattern, inputs);

    const port = await jzz.openMidiIn(name);

    return {
      name,
      onData(handler) {
        port.connect((msg: unknown) => {
          // JZZ messages are array-like / have iterable bytes
          const bytes = new Uint8Array(msg as number[]);
          handler(bytes);
        });
      },
      async close() {
        await port.close();
      },
    };
  }

  async openOutput(pattern: string): Promise<MidiOutput> {
    const jzz = await this.getJzz();
    const { outputs } = await this.listDevices();
    const name = outputs.find((n) => n.toLowerCase().includes(pattern.toLowerCase()));
    if (!name) throw new DeviceNotFoundError('output', pattern, outputs);

    const port = await jzz.openMidiOut(name);

    return {
      name,
      send(bytes) {
        port.send(Array.from(bytes));
      },
      async close() {
        await port.close();
      },
    };
  }
}
