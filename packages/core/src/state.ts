// SPDX-License-Identifier: MIT
import type { MidiMessage } from './messages.js';

export class ChannelState {
  readonly heldNotes = new Map<number, number>();
  readonly cc = new Map<number, number>();
  program: number | undefined = undefined;
  pitchBend = 0;
  channelPressure = 0;
}

export class MidiState {
  private readonly channels: ChannelState[] = [];

  constructor() {
    for (let i = 0; i < 16; i++) this.channels.push(new ChannelState());
  }

  get(channel: number): ChannelState | undefined {
    return this.channels[channel];
  }

  apply(msg: MidiMessage): void {
    if (msg.type === 'raw') return;
    const ch = this.channels[msg.channel];
    if (!ch) return;

    switch (msg.type) {
      case 'noteOn':
        ch.heldNotes.set(msg.note, msg.velocity);
        break;
      case 'noteOff':
        ch.heldNotes.delete(msg.note);
        break;
      case 'cc':
        ch.cc.set(msg.controller, msg.value);
        break;
      case 'programChange':
        ch.program = msg.program;
        break;
      case 'pitchBend':
        ch.pitchBend = msg.value;
        break;
      case 'channelPressure':
        ch.channelPressure = msg.pressure;
        break;
      case 'polyPressure':
        break;
    }
  }

  heldNotes(channel?: number): number[] {
    if (channel !== undefined) {
      const ch = this.channels[channel];
      return ch ? [...ch.heldNotes.keys()].sort((a, b) => a - b) : [];
    }
    const all: number[] = [];
    for (const ch of this.channels) all.push(...ch.heldNotes.keys());
    return [...new Set(all)].sort((a, b) => a - b);
  }
}
