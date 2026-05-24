export type NoteOn = { type: 'noteOn'; channel: number; note: number; velocity: number };
export type NoteOff = { type: 'noteOff'; channel: number; note: number; velocity: number };
export type CC = { type: 'cc'; channel: number; controller: number; value: number };
export type ProgramChange = { type: 'programChange'; channel: number; program: number };
export type PitchBend = { type: 'pitchBend'; channel: number; value: number };
export type ChannelPressure = { type: 'channelPressure'; channel: number; pressure: number };
export type PolyPressure = { type: 'polyPressure'; channel: number; note: number; pressure: number };
export type Raw = { type: 'raw'; bytes: Uint8Array };

export type MidiMessage =
  | NoteOn
  | NoteOff
  | CC
  | ProgramChange
  | PitchBend
  | ChannelPressure
  | PolyPressure
  | Raw;

export function parseMessage(bytes: Uint8Array): MidiMessage {
  if (bytes.length === 0) return { type: 'raw', bytes };

  const status = bytes[0]!;
  if ((status & 0x80) === 0) return { type: 'raw', bytes };

  const channel = status & 0x0f;
  const kind = status & 0xf0;

  switch (kind) {
    case 0x80:
      if (bytes.length < 3) return { type: 'raw', bytes };
      return { type: 'noteOff', channel, note: bytes[1]!, velocity: bytes[2]! };

    case 0x90: {
      if (bytes.length < 3) return { type: 'raw', bytes };
      const note = bytes[1]!;
      const velocity = bytes[2]!;
      if (velocity === 0) return { type: 'noteOff', channel, note, velocity: 0 };
      return { type: 'noteOn', channel, note, velocity };
    }

    case 0xa0:
      if (bytes.length < 3) return { type: 'raw', bytes };
      return { type: 'polyPressure', channel, note: bytes[1]!, pressure: bytes[2]! };

    case 0xb0:
      if (bytes.length < 3) return { type: 'raw', bytes };
      return { type: 'cc', channel, controller: bytes[1]!, value: bytes[2]! };

    case 0xc0:
      if (bytes.length < 2) return { type: 'raw', bytes };
      return { type: 'programChange', channel, program: bytes[1]! };

    case 0xd0:
      if (bytes.length < 2) return { type: 'raw', bytes };
      return { type: 'channelPressure', channel, pressure: bytes[1]! };

    case 0xe0: {
      if (bytes.length < 3) return { type: 'raw', bytes };
      const value = (bytes[1]! | (bytes[2]! << 7)) - 8192;
      return { type: 'pitchBend', channel, value };
    }

    default:
      return { type: 'raw', bytes };
  }
}

export function encodeMessage(msg: MidiMessage): Uint8Array {
  switch (msg.type) {
    case 'noteOn':
      return new Uint8Array([0x90 | (msg.channel & 0x0f), msg.note & 0x7f, msg.velocity & 0x7f]);
    case 'noteOff':
      return new Uint8Array([0x80 | (msg.channel & 0x0f), msg.note & 0x7f, msg.velocity & 0x7f]);
    case 'cc':
      return new Uint8Array([0xb0 | (msg.channel & 0x0f), msg.controller & 0x7f, msg.value & 0x7f]);
    case 'programChange':
      return new Uint8Array([0xc0 | (msg.channel & 0x0f), msg.program & 0x7f]);
    case 'pitchBend': {
      const v = (msg.value + 8192) & 0x3fff;
      return new Uint8Array([0xe0 | (msg.channel & 0x0f), v & 0x7f, (v >> 7) & 0x7f]);
    }
    case 'channelPressure':
      return new Uint8Array([0xd0 | (msg.channel & 0x0f), msg.pressure & 0x7f]);
    case 'polyPressure':
      return new Uint8Array([0xa0 | (msg.channel & 0x0f), msg.note & 0x7f, msg.pressure & 0x7f]);
    case 'raw':
      return msg.bytes;
  }
}
