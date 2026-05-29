# Spectacles API Reference

The lens-side API of the MidiBleepBop library — everything a Lens Studio developer imports or wires to send and receive MIDI from a Spectacles lens. For the platform-independent core design see `api.md`; this document is the practical reference for the bundled library and its `@component` building blocks.

## How the library is shipped

The library reaches a lens as a single bundled script plus a set of `@component` wrapper files (see `packaging.md`):

```
MidiBleepBop.lspkg/Scripts/
  MidiBleepBop.ts          ← bundled core + transport + catalog (the importable module)
  MidiClientComponent.ts   ← connection component
  CCParam.ts               ← CC → typed parameter
  DeviceCatalogComponent.ts← per-device CC catalog
  PianoKeyboard.ts         ← generated playable piano
  KeyboardChannelMode.ts   ← virtual-keyboard MIDI input
  ChordSender.ts           ← built-in groove generator
  Devices.ts               ← generated device data (CC-BY-SA-4.0)
```

Import the module surface from `./MidiBleepBop`; reference the components by their class.

```typescript
import { MidiClient, CC, DeviceCatalog } from './MidiBleepBop';
import { MidiClientComponent } from './MidiClientComponent';
```

---

## Module exports (`./MidiBleepBop`)

### MidiClient

The central object. Transport-agnostic; you usually obtain one from `MidiClientComponent.client` rather than constructing it directly.

```typescript
class MidiClient {
  constructor(transport: Transport);

  // Lifecycle
  connect(): Promise<void>;        // resolves on first 'open'
  close(): void;
  readonly connected: boolean;
  readonly state: ConnectionState; // 'connecting' | 'open' | 'closed'

  // Sending
  sendNoteOn(channel: number, note: number, velocity: number): void;
  sendNoteOff(channel: number, note: number, velocity?: number): void;
  sendCC(channel: number, controller: number, value: number): void;
  sendProgramChange(channel: number, program: number): void;
  sendPitchBend(channel: number, value: number): void;        // −8192..8191
  sendChannelPressure(channel: number, pressure: number): void;
  send(msg: MidiMessage): void;
  sendRaw(bytes: Uint8Array): void;

  // Events (every matching incoming message). Returns an unsubscribe fn.
  on(event: 'message' | 'noteOn' | 'noteOff' | 'cc' | 'programChange'
          | 'pitchBend' | 'channelPressure' | 'connect' | 'disconnect',
     handler: (payload) => void): () => void;

  // State queries (cheap; safe in an update loop)
  heldNotes(channel?: number): number[];
  ccValue(channel: number, controller: number): number | undefined;
  programNumber(channel: number): number | undefined;
  pitchBend(channel: number): number;
  channelPressure(channel: number): number;

  // Change observation (fires only when the tracked value changes)
  onCCChange(channel: number, controller: number,
             handler: (value: number, previous: number | undefined) => void): () => void;
  onAnyCCChange(channel: number,
                handler: (controller: number, value: number, previous: number | undefined) => void): () => void;
  onNoteHeld(channel: number, note: number,
             handler: (held: boolean, velocity: number) => void): () => void;
  onProgramChange(channel: number, handler: (program: number) => void): () => void;

  // Discovery
  observedCCs(channel: number): number[]; // sorted controllers seen so far
}
```

Channels are 0-indexed (0–15); channel `0` maps to MIDI channel 1 on the wire.

### Message types

```typescript
type MidiMessage =
  | { type: 'noteOn';          channel; note; velocity }
  | { type: 'noteOff';         channel; note; velocity }
  | { type: 'cc';              channel; controller; value }   // type alias: CCMessage
  | { type: 'programChange';   channel; program }
  | { type: 'pitchBend';       channel; value }               // −8192..8191
  | { type: 'channelPressure'; channel; pressure }
  | { type: 'polyPressure';    channel; note; pressure }
  | { type: 'raw';             bytes: Uint8Array };

function parseMessage(bytes: Uint8Array): MidiMessage;   // always succeeds (raw fallback)
function encodeMessage(msg: MidiMessage): Uint8Array;
```

### CC constants

`CC` is an object of named standard controllers — use it instead of magic numbers.

```typescript
import { CC } from './MidiBleepBop';
client.sendCC(0, CC.FILTER_CUTOFF, 90);   // CC 74
```

Common members: `MOD_WHEEL` (1), `BREATH` (2), `VOLUME` (7), `PAN` (10), `EXPRESSION` (11), `SUSTAIN_PEDAL` (64), `RESONANCE` (71), `FILTER_CUTOFF` (74), `ALL_NOTES_OFF` (123), and ~30 more.

### CCMapper

Pure scaling + exponential smoothing for a single CC value. Backs `CCParam`; usable directly.

```typescript
class CCMapper {
  constructor(opts?: { inputMin?; inputMax?; outputMin?; outputMax?; smoothingFactor? });
  update(rawValue: number): boolean;   // returns true if scaled output changed
  current(): number;                   // raw 0-127
  scaled(): number;                    // smoothed + mapped to [outputMin, outputMax]
  reset(): void;
}
```

### DeviceCatalog

Per-device CC knowledge (parameter names, ranges, defaults). Data is CC-BY-SA-4.0 (see `THIRD-PARTY-NOTICES.md`).

```typescript
class DeviceCatalog {
  constructor(device: Device);
  static fromJSON(json: string): DeviceCatalog;
  byCC(cc: number): Parameter | undefined;
  byName(name: string): Parameter | undefined;  // case-insensitive
  cc(name: string): number | undefined;
  sections(): string[];
  parameters(section?: string): Parameter[];
  isKnownCC(cc: number): boolean;
  inRange(cc: number, value: number): boolean;
}
```

### SpectaclesWebSocketTransport

The transport `MidiClientComponent` builds for you. Construct directly only for custom setups.

```typescript
class SpectaclesWebSocketTransport implements Transport {
  constructor(options: {
    url: string;                  // ws:// (dev) or wss:// (publishable) — NOT localhost
    internetModule?: unknown;     // pass require('LensStudio:InternetModule')
    log?: (msg: string) => void;  // pass (m) => print(m) for visible logs
    schedule?: Schedule | null;   // backed by DelayedCallbackEvent; null disables reconnect
    reconnect?: boolean;
    reconnectMaxMs?: number;
  });
}
```

---

## Component reference

All components are Lens Studio `@component`s. Wire `@input`s in the inspector.

### MidiClientComponent

Owns the WebSocket connection. One per scene; every other component shares its `client`.

| Input | Type | Default | Notes |
|---|---|---|---|
| `bridgeUrl` | string | `ws://192.168.1.100:8765` | Your dev machine's LAN IP. **Not** `localhost`. |
| `autoConnect` | boolean | `true` | Connect on awake. |

Public: `client: MidiClient | null` — read it from other scripts after awake.

### CCParam

Binds one `(channel, controller)` to a smoothed, scaled value. Optionally resolves the controller by name via a wired device catalog.

| Input | Type | Default | Notes |
|---|---|---|---|
| `midi` | MidiClientComponent | — | required |
| `channel` | number | 0 | |
| `controller` | number | 1 | used unless `parameterName` resolves |
| `device` | DeviceCatalogComponent | (none) | optional |
| `parameterName` | string | `''` | resolves to a CC via the catalog when set |
| `inputMin` / `inputMax` | number | 0 / 127 | raw range |
| `outputMin` / `outputMax` | number | 0 / 1 | mapped range |
| `smoothingFactor` | number | 0 | 0 = instant, ~0.9 = heavy EMA |

Public methods: `current()`, `scaled()`, `onChange(handler)`, `resolvedCC` (getter).

### DeviceCatalogComponent

Loads a bundled device by slug and exposes it as a `DeviceCatalog`.

| Input | Type | Default | Notes |
|---|---|---|---|
| `deviceSlug` | string | `korg-volca-bass` | a slug from `Devices.ts` (`DEVICE_SLUGS`) |

Public: `catalog: DeviceCatalog | null`.

### PianoKeyboard

Generates a playable piano at runtime (see `tester-ux.md` → PianoKeyboard wiring for the full story).

| Input | Type | Default | Notes |
|---|---|---|---|
| `midi` | MidiClientComponent | — | required |
| `channel` | number | 0 | |
| `whiteKeyMaterial` / `blackKeyMaterial` | Material | (none) | color in the material editor |
| `parentObject` | SceneObject | (none) | parent keys under a ContainerFrame's object |
| `keyDownAudio` | AudioTrackAsset | (none) | optional press sound |
| `audioVolume` | number | 0.5 | press-sound volume 0..1 |
| `labelFont` | Font | (none) | key label font |
| `startNote` | number | 60 | lowest MIDI note (re-stage to change) |
| `octaveShift` | number | 0 | ±whole octaves (re-stage to change) |
| `keyCount` | number | 13 | white + black keys generated |
| `velocity` | number | 100 | |
| `whiteKey*` / `blackKey*` | number | — | per-key dimensions (cm) |
| `keysMovable` | boolean | false | add InteractableManipulation per key |
| `pressDepth` / `pressAnimFactor` | number | 0.6 / 0.35 | depress animation |
| `maxHoldSec` | number | 5 | stuck-note auto-release backstop (0 disables) |
| `heldNotesText` | Text | (none) | shows held note names |
| `octaveText` | Text | (none) | shows octave + range |
| `cc1..4Controller` / `cc1..4Value` | number | -1 / 0 | optional CCs sent once connected |

### KeyboardChannelMode

Turns the lens's virtual keyboard into a monophonic MIDI controller using Ableton's key map (A→C, W/E/T/Y/U sharps, Z/X octave, C/V velocity ±20).

| Input | Type | Default |
|---|---|---|
| `midi` | MidiClientComponent | — |
| `channel` | number | 0 |
| `startOctave` | number | 3 |
| `startVelocity` | number | 64 |
| `noteHoldMs` | number | 200 |
| `statusText` | Text | (none) |

Public methods: `open()`, `close()`, `getOctave()`, `getVelocity()`. Wire your existing keyboard UI to `open()` / `close()`.

### ChordSender

Built-in groove generator for send-direction testing.

| Input | Type | Default | Notes |
|---|---|---|---|
| `midi` | MidiClientComponent | — | required |
| `autoPlay` | boolean | false | start on awake |
| `pattern` | string | `triad` | `triad` \| `acid` \| `house` \| `trance` |
| `channel` | number | 0 | |
| `bpm` | number | 124 | |
| `velocity` | number | 90 | |
| `rootNote` | number | 60 | for `triad` |
| `transpose` | number | 0 | semitones, for `acid`/`house`/`trance` |

Public methods: `play()`, `stop()`. See `grooves.md` for what each pattern plays.

---

## Recipes

**React to incoming MIDI:**
```typescript
@input midi: MidiClientComponent;
onAwake() {
  const c = this.midi.client;
  c?.on('noteOn', (m) => { /* light up note m.note */ });
  c?.onCCChange(0, CC.FILTER_CUTOFF, (v) => { /* drive a visual */ });
}
```

**Send a note:**
```typescript
this.midi.client?.sendNoteOn(0, 60, 100);
```

**Name-based CC via the catalog:**
```typescript
@input device: DeviceCatalogComponent;
const cc = this.device.catalog?.cc('Cutoff EG intensity'); // 48 on Volca Bass
if (cc !== undefined) this.midi.client?.sendCC(0, cc, 90);
```

## Constraints

- `ws://` requires the Experimental APIs flag and cannot be published; use `wss://` (via a tunnel or TLS-fronted bridge) to publish.
- `localhost` / `127.0.0.1` resolve to the glasses, not your dev machine — always use the LAN IP.
- The virtual-keyboard transport details (`binaryType = 'blob'`, async `Blob` decode) are handled inside the transport; you don't deal with them.
