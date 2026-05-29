// SPDX-License-Identifier: MIT
export {
  encodeMessage,
  parseMessage,
  type CCMessage,
  type ChannelPressure,
  type MidiMessage,
  type NoteOff,
  type NoteOn,
  type PitchBend,
  type PolyPressure,
  type ProgramChange,
  type Raw,
} from './messages.js';

export { ChannelState, MidiState } from './state.js';

export {
  MockTransport,
  type ConnectionState,
  type Transport,
} from './transport.js';

export { MidiClient, type Unsubscribe } from './client.js';

export { CC, type CCName, type CCNumber } from './cc-constants.js';
export { CCMapper, type CCMapperOptions } from './cc-mapper.js';
