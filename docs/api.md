# Public API

All types and classes below live in `packages/core` and are re-exported from the package root. Transport implementations live in sibling packages and implement the `Transport` interface.

> **v1 scope:** the only Spectacles-side transport that ships is `SpectaclesWebSocketTransport`, which connects the lens to a node bridge over WebSocket. Direct BLE-MIDI is documented in `architecture.md` as future work but not implemented — Lens Studio's BLE central API lacks `createBond()`, which blocks all commercial BLE-MIDI hardware.

## Messages

`MidiMessage` is a discriminated union. Every variant has `channel: number` (0–15) where applicable. Note numbers are 0–127, velocities and CCs are 0–127, pitch bend is a signed int in the range −8192..8191 (centered at 0).

```typescript
export type MidiMessage =
  | { type: 'noteOn';          channel: number; note: number; velocity: number }
  | { type: 'noteOff';         channel: number; note: number; velocity: number }
  | { type: 'cc';              channel: number; controller: number; value: number }
  | { type: 'programChange';   channel: number; program: number }
  | { type: 'pitchBend';       channel: number; value: number }
  | { type: 'channelPressure'; channel: number; pressure: number }
  | { type: 'polyPressure';    channel: number; note: number; pressure: number }
  | { type: 'raw';             bytes: Uint8Array };          // sysex, MTC, clock, etc.
```

Low-level codec utilities (for the bridge, advanced users, debugging):

```typescript
export function parseMessage(bytes: Uint8Array): MidiMessage;
export function encodeMessage(msg: MidiMessage): Uint8Array;
```

`parseMessage` always succeeds — unknown or malformed input becomes `{ type: 'raw', bytes }`.

## Transport interface

The contract every transport must satisfy. Three methods, two callbacks. Anyone can write one.

```typescript
export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface Transport {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onStateChange(handler: (state: ConnectionState) => void): void;
  close(): void;
}
```

The interface deliberately presents **one MIDI message per call**, regardless of the underlying wire protocol. A future transport that speaks a multi-message protocol (such as BLE-MIDI, where one GATT packet can carry several messages with timestamps) would handle framing internally and emit one parsed MIDI message per `onMessage` invocation.

Shipped implementations (v1):

| Package | Class | Use |
|---|---|---|
| `packages/core` | `MockTransport` | Tests. Has `simulateMessage(bytes)` and inspectable `sent: Uint8Array[]`. |
| `packages/transport-node` | `NodeTransport` | Tests + node CLIs + the bridge if it ever needs a client. Reconnects with backoff. |
| `packages/transport-spectacles-ws` | `SpectaclesWebSocketTransport` | Lens ↔ bridge. Wraps `InternetModule.createWebSocket`. Reconnects with backoff. |

Reconnect logic lives in each transport, not in `MidiClient`. Backoff defaults: 500ms → 1s → 2s → 5s, capped at 5s.

### `SpectaclesWebSocketTransport`

```typescript
export class SpectaclesWebSocketTransport implements Transport {
  constructor(options: {
    url: string;                           // e.g. 'ws://192.168.1.100:8765'  (NOT localhost — see below)
    reconnect?: boolean;                   // default true
    reconnectMaxMs?: number;               // default 5000
  });
}
```

The constructor calls `require("LensStudio:InternetModule")` and sets `binaryType = "blob"`. Each `onmessage` event from the underlying socket is decoded via `await event.data.bytes()` and surfaced as `Uint8Array` to the registered handler.

> **`localhost` does not work.** Spectacles resolves `localhost` and `127.0.0.1` to the glasses themselves, not your dev machine. Use the dev machine's actual LAN IP (`ws://192.168.x.x:port`), or a public tunnel like ngrok for `wss://` if you need to publish.

## MidiClient

```typescript
export class MidiClient {
  constructor(transport: Transport);

  // Lifecycle
  connect(): Promise<void>;                                   // resolves on first 'open'
  close(): void;
  readonly connected: boolean;
  readonly state: ConnectionState;

  // Sending
  sendNoteOn(channel: number, note: number, velocity: number): void;
  sendNoteOff(channel: number, note: number, velocity?: number): void;
  sendCC(channel: number, controller: number, value: number): void;
  sendProgramChange(channel: number, program: number): void;
  sendPitchBend(channel: number, value: number): void;        // −8192..8191
  sendChannelPressure(channel: number, pressure: number): void;
  send(msg: MidiMessage): void;                                // generic dispatch
  sendRaw(bytes: Uint8Array): void;                            // escape hatch

  // Events — every incoming message of the matching type
  on(event: 'message',         handler: (msg: MidiMessage) => void): Unsubscribe;
  on(event: 'noteOn',          handler: (msg: NoteOn) => void): Unsubscribe;
  on(event: 'noteOff',         handler: (msg: NoteOff) => void): Unsubscribe;
  on(event: 'cc',              handler: (msg: CC) => void): Unsubscribe;
  on(event: 'programChange',   handler: (msg: ProgramChange) => void): Unsubscribe;
  on(event: 'pitchBend',       handler: (msg: PitchBend) => void): Unsubscribe;
  on(event: 'connect',         handler: () => void): Unsubscribe;
  on(event: 'disconnect',      handler: () => void): Unsubscribe;

  // State queries — cheap, safe to call from a per-frame update loop
  heldNotes(channel?: number): number[];                       // omit channel = all channels
  ccValue(channel: number, controller: number): number | undefined;
  programNumber(channel: number): number | undefined;
  pitchBend(channel: number): number;                          // default 0
  channelPressure(channel: number): number;                    // default 0

  // State observation — fires only when the tracked value *changes*
  onCCChange(channel: number, controller: number,
             handler: (value: number, previous: number | undefined) => void): Unsubscribe;
  onNoteHeld(channel: number, note: number,
             handler: (held: boolean, velocity: number) => void): Unsubscribe;
  onProgramChange(channel: number,
                  handler: (program: number) => void): Unsubscribe;
}

type Unsubscribe = () => void;
```

### Events vs. state vs. observations — when to use which

| API | Fires when | Use for |
|---|---|---|
| `on('cc', ...)` | Every incoming CC message | Audit logs, recording, instrument-agnostic relays |
| `ccValue(ch, n)` | Never (it's a getter) | Continuous visuals: scale a model by current modwheel value, every frame |
| `onCCChange(ch, n, ...)` | Only when the value actually changes | UI meters, change-driven side effects |

The distinction matters because MIDI controllers spam CC values continuously. An event-style listener fires hundreds of times a second; a change-style listener fires only when the user actually moves the knob.

## Usage examples

### Lens — WebSocket to a bridge

```typescript
import { MidiClient } from 'MidiBleepBop';
import { SpectaclesWebSocketTransport } from 'MidiBleepBop/transports';

@component
export class PianoVisualizer extends BaseScriptComponent {
  @input bridgeUrl: string = 'ws://192.168.1.100:8765';   // your LAN IP, NOT localhost
  @input keyboard: SceneObject;

  private client!: MidiClient;
  private keys: SceneObject[] = [];

  async onAwake() {
    for (let i = 0; i < this.keyboard.getChildrenCount(); i++) {
      this.keys.push(this.keyboard.getChild(i));
    }

    const transport = new SpectaclesWebSocketTransport({ url: this.bridgeUrl });
    this.client = new MidiClient(transport);
    await this.client.connect();

    this.client.on('noteOn',  (m) => this.setKey(m.note, true,  m.velocity / 127));
    this.client.on('noteOff', (m) => this.setKey(m.note, false, 0));
    this.client.onCCChange(0, 1, (value) => { /* modwheel */ });
  }

  private setKey(note: number, on: boolean, intensity: number) {
    const key = this.keys[note - 21];
    if (!key) return;
    // ... update visual
  }
}
```

### Desktop test (pure TS, no Lens Studio, no bridge)

```typescript
import { MidiClient, MockTransport, encodeMessage } from 'midi-bleep-bop';

test('tracks held notes from incoming noteOn/noteOff', () => {
  const t = new MockTransport();
  const c = new MidiClient(t);

  t.simulateMessage(encodeMessage({ type: 'noteOn',  channel: 0, note: 60, velocity: 100 }));
  t.simulateMessage(encodeMessage({ type: 'noteOn',  channel: 0, note: 64, velocity: 100 }));
  expect(c.heldNotes(0)).toEqual([60, 64]);

  t.simulateMessage(encodeMessage({ type: 'noteOff', channel: 0, note: 60, velocity: 0 }));
  expect(c.heldNotes(0)).toEqual([64]);
});

test('onCCChange fires only on actual changes', () => {
  const t = new MockTransport();
  const c = new MidiClient(t);
  const seen: number[] = [];
  c.onCCChange(0, 1, (v) => seen.push(v));

  t.simulateMessage(encodeMessage({ type: 'cc', channel: 0, controller: 1, value: 64 }));
  t.simulateMessage(encodeMessage({ type: 'cc', channel: 0, controller: 1, value: 64 })); // dup
  t.simulateMessage(encodeMessage({ type: 'cc', channel: 0, controller: 1, value: 65 }));
  expect(seen).toEqual([64, 65]);
});
```

### Integration test against a real bridge + real MIDI hardware

```typescript
import { MidiClient } from 'midi-bleep-bop';
import { NodeTransport } from 'midi-bleep-bop/transport-node';

const c = new MidiClient(new NodeTransport('ws://localhost:8765'));   // node, localhost fine here
await c.connect();

c.sendNoteOn(0, 60, 100);
await sleep(300);
c.sendNoteOff(0, 60);
```

## API stability

Versioning follows semver from v1.0.0. Pre-1.0 the public surface above is subject to change without notice; favor the high-level methods over `send`/`sendRaw` to minimize churn.
