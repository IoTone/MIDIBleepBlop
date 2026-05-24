# Architecture

## Goal

A MIDI client library for Snap Spectacles 24 lenses, written in TypeScript, with most logic testable on a desktop without Lens Studio in the loop. Distributed as a Lens Studio asset package so other developers can drop it into their own lenses and have a working two-way MIDI connection to real hardware in a few clicks.

## What changed during design exploration

Two findings reshaped the design space:

1. **Spectacles exposes `Bluetooth.BluetoothCentralModule`** with full GATT scan/connect/services/characteristics support, suggesting direct BLE-MIDI from the lens might be possible. (Discovered in `StudioLib.d.ts` in `/Users/dkords/dev/projects/iotj/WebSocketPlayground`.)

2. **But that BLE API lacks `createBond()`** — so peripherals that require bonding will silently hang on notification subscription. (Documented in `/Users/dkords/dev/projects/iotone/Spectacles-SkywriterBLE.git/DESIGN.md` §8, where the team had to switch from the Apple Magic Keyboard to a custom-firmware M5Cardputer with `ESP_LE_AUTH_NO_BOND` to get HID notifications working.)

   Commercial BLE-MIDI hardware — WIDI Master included — requires bonding. So direct BLE-MIDI from a Spectacles lens to off-the-shelf gear is **not viable today**. It's only feasible against custom-firmware peripherals with bonding disabled.

**Decision for v1:** ship a single transport — `SpectaclesWebSocketTransport` paired with a node bridge. Direct BLE-MIDI is captured as future work (see end of this doc); no code lands for it in v1.

## Constraints that shape the design

| Constraint | Source | Implication |
|---|---|---|
| Lens Studio's BLE central API does not expose `createBond()` | `Spectacles-SkywriterBLE.git/DESIGN.md` §8 | Direct BLE-MIDI to bonding-required hardware (i.e., almost all commercial BLE-MIDI devices) is not viable in v1. WebSocket bridge is the only working path. |
| Spectacles supports BLE only, no Classic Bluetooth | Same source | Non-BLE wireless MIDI hardware is unreachable regardless of transport. |
| No raw UDP sockets | Spectacles SDK | OSC and similar are off the table. |
| `ws://` requires Experimental APIs flag and blocks publishing | Spectacles SDK | Dev uses `ws://`, publishable lenses need `wss://`. |
| `WebSocket.binaryType` only accepts `"blob"`, not `"arraybuffer"` | Spectacles SDK | Inbound binary is async: `await event.data.bytes()`. |
| `localhost` / `127.0.0.1` resolve to *the glasses*, not the dev machine | Observed in WebSocketPlayground | Bridge URL must be the dev machine's LAN IP, or a public tunnel. |
| Lens Studio TS runtime has no `process`, no Node APIs, no `node_modules` | Lens Studio | Library core must be pure, dependency-free TypeScript. |

## Shape

```
┌─────────────┐    wss/ws       ┌──────────────┐    OS MIDI       ┌────────────────────┐
│  Spectacles │  binary frames  │   bridge     │  in + out        │ Host MIDI subsystem│
│    lens     │ ◄─────────────► │ (node + jzz) │ ◄──────────────► │                    │
│             │                 │              │                  │ macOS: CoreMIDI    │
│  MidiClient │                 │              │                  │ Linux: ALSA / PW   │
│      │      │                 │              │                  │ Windows: WinMM/RT  │
│      ▼      │                 │              │                  │                    │
│  Spectacles │                 │              │                  │ ┌────────────────┐ │
│  WSTransport│                 │              │                  │ │ WIDI / USB MIDI│ │
└─────────────┘                 └──────────────┘                  │ │ DAW / soft synth│ │
                                                                  └─┴────────────────┴─┘
```

The bridge runs on **macOS, Linux, or Windows**. The wire protocol and the lens are host-agnostic; per-OS differences (especially how a BLE-MIDI device is exposed as a MIDI port to the bridge) are entirely on the bridge side. See `bridge.md` for the per-OS setup.

The same `core` package runs in three contexts:

1. **Lens runtime** — paired with `SpectaclesWebSocketTransport`.
2. **Bridge process** — uses the core's codec utilities but not `MidiClient`; the bridge is a protocol translator between WebSocket and CoreMIDI.
3. **Desktop tests** — paired with `MockTransport` (in-memory) or `NodeTransport` (real `ws` to a running bridge).

## Why transport-agnostic

`MidiClient` knows nothing about WebSockets or Spectacles. It accepts an opaque `Transport` whose entire contract is "give me one parsed MIDI message, take one parsed MIDI message." Every interesting behavior — state tracking, event emission, change observation — lives above this seam and is testable with a one-page mock.

Why this matters even with a single shipped transport:

- A failing test never depends on a running bridge, a paired WIDI, or even Lens Studio.
- The seam is exactly where a future BLE transport (or any other transport) would slot in without touching the rest of the library.
- The bridge can reuse the core's message codec without inheriting a connection model that doesn't fit its server-side role.

## Component breakdown (v1)

### `packages/core` (pure TS, no deps)

| File | Responsibility |
|---|---|
| `messages.ts` | `MidiMessage` discriminated union; `parseMessage(bytes)` and `encodeMessage(msg)`. |
| `state.ts` | `ChannelState` — held notes, last CC values, program, pitch bend, channel pressure. Updated by `MidiClient` as messages arrive. |
| `transport.ts` | `Transport` interface and `MockTransport` (in-memory implementation for tests). |
| `client.ts` | `MidiClient` — composes transport + state + event emitter; exposes the public API. |
| `index.ts` | Re-exports. |

### `packages/transport-node`

Thin wrapper around the `ws` package. Used by tests and example node CLIs. Implements `Transport`. ~50 lines.

### `packages/transport-spectacles-ws`

Wrapper around `InternetModule.createWebSocket`. Handles `Blob → Uint8Array` decode in `onmessage`. Reconnect backoff. ~80 lines. Bundled into the `.lspkg`.

### `bridge/`

Standalone node process. WS server on a configured port + JZZ for OS-level MIDI I/O. For each connected client: subscribe to the configured MIDI input and forward bytes to that client; on incoming WS message, forward bytes to the configured MIDI output. Does **not** use `MidiClient` — it works at the byte level and uses only the `messages.ts` codec for logging/debugging.

Cross-platform: JZZ wraps `jazz-midi`, which targets CoreMIDI on macOS, ALSA/PipeWire on Linux, and WinMM/WinRT MIDI on Windows. The bridge code itself is identical across OSes; what varies is how BLE-MIDI hardware reaches the OS MIDI subsystem in the first place (CoreMIDI's built-in Bluetooth Configuration on macOS; PipeWire or BlueALSA on Linux; the Korg BLE-MIDI driver on Windows). Per-OS instructions live in `bridge.md`.

### `lens/MidiBleepBop.lspkg`

The shippable asset package. Contains:

- `Scripts/` — bundled `core` + `transport-spectacles-ws` as Lens-Studio-compatible TS files.
- `Prefabs/` — `MidiClient` prefab with the WebSocket transport pre-wired (see `packaging.md`).

### `lens/TesterLens/`

A full Lens Studio project that consumes `MidiBleepBop.lspkg` and demonstrates the WebSocket transport with real visualizations. Dev harness; not shipped.

## WebSocket transport constraints

- `ws://` requires Experimental APIs flag; `wss://` doesn't.
- Bridge URL must be a routable address — **`localhost` does not work**.
- Binary frames arrive as `Blob` and require `await event.data.bytes()` — the transport's `onMessage` is async-aware.
- Latency = WiFi RTT + bridge processing + CoreMIDI; typically 5–15 ms on a clean LAN, with occasional jitter spikes.

## What is explicitly out of scope (v1)

- **Direct BLE-MIDI transport.** Blocked by Lens Studio's lack of `createBond()`. See "Future work" below.
- **Sysex.** WebSocket transport passes raw `F0…F7` through one-per-frame. No high-level sysex API.
- **Sample-accurate timing / MIDI clock as first-class.** Clock bytes (`0xF8`) pass through as `raw`. The library does not derive tempo or schedule events.
- **MPE.** Channel-rotation logic is not built in; users can read raw per-channel state and build it themselves.
- **Bridge auto-discovery.** Bridge URL is a single configured string.

## Future work

### Direct BLE-MIDI transport (post-v1)

Would slot in as `SpectaclesBleTransport` implementing the existing `Transport` interface, wrapping `Bluetooth.BluetoothCentralModule` and speaking BLE-MIDI 1.0 packet framing internally.

**Blocker:** Lens Studio's BLE central API does not expose `createBond()`. Notifications hang indefinitely if the peripheral requires bonding. Commercial BLE-MIDI devices (WIDI Master, mio devices, most synths) all require bonding.

**Viable only with custom-firmware peripherals** that disable bonding (e.g., ESP32 running a BLE-MIDI implementation with `ESP_LE_AUTH_NO_BOND`). The SkywriterBLE project demonstrated this pattern with an M5Cardputer for HID — the same approach would work for MIDI.

Re-evaluate if/when Snap exposes a `createBond()`-equivalent in a future Lens Studio release.

### Other deferred items

- **Snap Asset Library submission.** Currently `.lspkg` distributed via GitHub releases.
- **Auto-discovery of the bridge from the lens.** Bridge URL is configured by hand.
- **Multi-device support per bridge.** v1 bridge handles one input and one output.

## Open decisions

- **Monorepo (npm workspaces) vs single package.** Recommendation: workspaces, for clean transport separation and per-transport deps.
- **Example prefabs in `.lspkg` scope.** Recommendation: ship one `MidiClient` prefab; put richer demos in `TesterLens/`.
