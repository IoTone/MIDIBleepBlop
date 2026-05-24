# Packaging & Distribution

How the library reaches a lens developer who has never seen this repo.

## Top-level layout

```
midi-bleep-bop/
├── packages/
│   ├── core/                          ← pure TS, published as @midi-bleep-bop/core
│   ├── transport-node/                ← published as @midi-bleep-bop/transport-node
│   └── transport-spectacles-ws/       ← bundled into the .lspkg, not on npm
├── bridge/                            ← node executable, @midi-bleep-bop/bridge
├── examples/                          ← reference node CLIs, not published
├── lens/
│   ├── MidiBleepBop.lspkg/            ← THE SHIPPABLE ASSET PACKAGE
│   └── TesterLens/                    ← dev harness, not shipped
├── docs/                              ← these files
└── mac/                               ← existing experiments (legacy, kept for reference)
```

Two distinct distribution targets:

1. **npm** — `core`, `transport-node`, `bridge` (anyone building a node MIDI tool can use these).
2. **`MidiBleepBop.lspkg`** — the asset package a lens developer drops into Lens Studio.

These are kept in sync: the `lspkg`'s `Scripts/` directory is **built** from `packages/core` + `packages/transport-spectacles-ws` by a build step that vendors them into TS files Lens Studio can load. Lens Studio cannot import from `node_modules`, so vendoring is not optional.

## What the asset package contains

```
MidiBleepBop.lspkg/
├── Scripts/
│   ├── MidiBleepBop.ts                ← bundled core + transport-spectacles-ws (single file)
│   └── MidiClientComponent.ts         ← @component wrapper exposing inputs in the inspector
├── Prefabs/
│   └── MidiClient.prefab              ← scene object with MidiClientComponent attached
└── lens-package.json                  ← Lens Studio metadata (name, version, deps)
```

**Single bundled script** rather than a tree of files. Two reasons: (1) keeps the import path stable (`import { MidiClient } from 'MidiBleepBop'`); (2) avoids the Lens Studio TS compiler reaching into intra-package relative imports we cannot test outside Lens Studio.

The `MidiClientComponent` is the only piece that knows about Lens Studio's `@component` decorator and `BaseScriptComponent`. It exposes:

```typescript
@component
export class MidiClientComponent extends BaseScriptComponent {
  @input bridgeUrl: string = 'ws://192.168.1.100:8765';     // NOT localhost
  @input autoConnect: boolean = true;

  readonly client!: MidiClient;        // accessible to other scripts

  async onAwake() {
    const t = new SpectaclesWebSocketTransport({ url: this.bridgeUrl });
    this.client = new MidiClient(t);
    if (this.autoConnect) await this.client.connect();
  }
}
```

This keeps the `MidiClient` class itself free of Lens Studio types so it stays testable on the desktop. The component is a thin wrapper.

## How an end user consumes the package

1. Download `MidiBleepBop.lspkg` (from a GitHub release; eventually from the Snap Asset Library).
2. In Lens Studio: **Assets → Import → choose the file**. Package shows up under Packages.
3. From the package's `Prefabs/`, drag `MidiClient` into the scene hierarchy. It appears as a scene object with the `MidiClientComponent` already attached.
4. In the inspector, set `bridgeUrl` to your dev machine's LAN IP (e.g. `ws://192.168.1.100:8765`). **Do not use `localhost` or `127.0.0.1`** — Spectacles will resolve those to the glasses, not your computer. Find your IP with `ifconfig` (mac/linux) or `ipconfig` (windows).
5. From your own script, get a reference to the component and use its `client`:

   ```typescript
   @input midiBridge: MidiClientComponent;

   onAwake() {
     this.midiBridge.client.on('noteOn', (m) => { /* visuals */ });
   }
   ```

6. Enable **Experimental APIs** in lens settings (required while using `ws://`).
7. Start the bridge on your dev machine: `npx @midi-bleep-bop/bridge --port 8765 --device "WIDI Master"`.
8. If using a BLE-MIDI device (e.g. WIDI Master), do the one-time OS-level pairing on the bridge host — this is the only step that varies by OS:
    - **macOS** — open **Audio MIDI Setup → Window → Show MIDI Studio → Bluetooth**, click **Connect** on the device.
    - **Linux** — pair via `bluetoothctl`; on modern distros PipeWire 0.3.65+ exposes BLE-MIDI as an ALSA port automatically. Older setups need [BlueALSA](https://github.com/arkq/bluez-alsa). Verify with `aconnect -l`.
    - **Windows** — install the [KORG BLE-MIDI Driver](https://www.korg.com/us/support/download/driver/1/305/2886/), pair via the driver's utility. Device then shows up in Device Manager under Sound, video and game controllers.
   See `bridge.md` for full per-OS detail and troubleshooting.
9. Press play in Lens Studio's Spectacles preview, or push to glasses.

The bridge supports any MIDI source the host OS exposes — BLE-MIDI hardware (after OS pairing), USB MIDI controllers, DAWs (Logic, Ableton, etc.), software synths (Pianoteq, etc.). The lens never knows what device is on the other end, or what OS the bridge is running on.

## Bridge configuration

The bridge is a separate concern but lens developers will need to run one. Shipping it as `@midi-bleep-bop/bridge` on npm means `npx @midi-bleep-bop/bridge` works without an install on macOS, Linux, or Windows (Windows may need C++ Build Tools the first time `jazz-midi` compiles; see `bridge.md`).

Command-line surface (sketch):

```
@midi-bleep-bop/bridge [options]
  --port <n>             WebSocket port (default 8765)
  --input <pattern>      MIDI input device name substring (default: prompt)
  --output <pattern>     MIDI output device name substring (default: same as --input)
  --list                 List available MIDI devices and exit
  --log <level>          off | error | info | debug (default info)
  --tls-cert <path>      Optional cert for serving wss://
  --tls-key  <path>      Optional key  for serving wss://
```

A small `bridge.config.json` discovered in the working directory provides the same options for non-CLI invocations.

## Tester lens vs. asset package

`lens/TesterLens/` is a full Lens Studio project that *consumes* the asset package. It exists to:

- Exercise the package in real Lens Studio before each release.
- Provide a working, opinionated example a developer can fork.
- Demonstrate more elaborate visualizations (piano keyboard, drum pads, knob meters) than belong in the lean asset package.

It is **not** shipped to end users. The release artifact is `MidiBleepBop.lspkg` plus the npm packages, period.

## Publishability constraints

The shipped Spectacles transport currently depends on APIs that may block lens publication depending on URL scheme:

| Transport config | Blocking flag | Notes |
|---|---|---|
| `SpectaclesWebSocketTransport` with `ws://` | Experimental APIs | Switch to `wss://` to publish. Requires a TLS-fronted bridge or a tunnel. |
| `SpectaclesWebSocketTransport` with `wss://` | None | Publishable. |

The library does not gate based on these — it's the lens author's responsibility to choose a URL scheme that matches their distribution intent.

## Versioning

| Component | Versioning | Notes |
|---|---|---|
| `packages/core` | semver, npm | The source of truth. |
| `packages/transport-node` | semver, npm | Tracks `core` major version. |
| `packages/transport-spectacles-ws` | matches `core` | Not published independently. |
| `bridge/` | semver, npm | Wire-protocol compatible across all 1.x. |
| `MidiBleepBop.lspkg` | matches `core` | Embeds the bundled core + spectacles WS transport at build time. |

A release means: cut a `core` version → rebuild the `.lspkg` so its bundled scripts match → publish npm packages → attach `.lspkg` to a GitHub release.

## Out of scope (v1)

- **Direct BLE-MIDI from the lens.** Blocked by Lens Studio's lack of `createBond()`. See `architecture.md` "Future work" for the post-v1 path.
- **Snap Asset Library submission.** Publishing through the official library has review overhead and template constraints. Shipping via GitHub releases lets us iterate freely; library submission is a v2 concern once the API is stable.
- **Auto-discovery of the bridge from the lens.** Bridge URL is configured by hand. mDNS doesn't work and Spectacles doesn't expose it.
- **Multiple-bridge support in one lens.** One `MidiClientComponent` per scene; multiple instances would work but are untested.
