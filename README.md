# midi-bleep-bop

A MIDI library that lets you generate MIDI notes from different platforms — including a Snap Spectacles lens — and play them on real synths. It's a repository of experiments with one goal: let creative artists turn their favorite platform into a MIDI controller for any device.

<img width="800" height="600" alt="midi-bleep-bop example" src="https://github.com/user-attachments/assets/ecbc5e9f-c4be-4803-86d6-90a94a577753" />

## How it works

A Spectacles lens can't reach MIDI hardware directly, so notes travel over WebSocket to a small bridge process on a companion computer, which speaks to the OS MIDI subsystem:

```
Spectacles lens ──ws/wss──► bridge (Node or Bun) ──► CoreMIDI / ALSA / WinMM ──► synth
                  binary                              (per-channel routing)
```

- **MIDI transports:** WebSocket (done), BLE (future — blocked by a Lens Studio limitation, see `docs/architecture.md`).
- **Bridge hosts:** macOS (primary), Linux, Windows.
- **Controllers:** Snap Spectacles '24.

## What's in here

| Piece | Path | What it is |
|---|---|---|
| Core library | `packages/core` | Pure-TS MIDI types, state tracking, `MidiClient`, CC helpers. |
| WebSocket transports | `packages/transport-node`, `packages/transport-spectacles-ws` | Node and Lens Studio WebSocket transports. |
| Device catalog | `packages/catalog` | Per-device CC catalogs (KORG Volca line) from pencilresearch/midi. |
| Bridge | `bridge/` | Node/Bun WebSocket ↔ OS MIDI bridge with per-channel output routing. |
| Lens library | `lens/MidiBleepBop.lspkg` | Bundled library + `@component`s (piano keyboard, CC params, groove generator, device catalog). |
| Tester lens | `lens/TesterLens` | Example components and scene recipe. |
| Examples | `examples/` | Node CLIs for end-to-end testing. |

## Quick start

```bash
# 1. Install (npm workspaces)
npm install

# 2. Build + test
npm run build
npm test

# 3. Run the bridge against a MIDI device (see what's available with --list)
node bridge/dist/cli.js --list
node bridge/dist/cli.js --device "IAC Driver Bus 1"

# 4. Send test notes
node examples/dist/chord-press.js ws://127.0.0.1:8765
```

For the lens side, build the bundle and follow the wiring recipe:

```bash
npm run build:lens     # regenerate lens/MidiBleepBop.lspkg/Scripts/MidiBleepBop.ts
```

…then see [docs/tester-ux.md](docs/tester-ux.md) and [docs/spectacles-api.md](docs/spectacles-api.md).

## Documentation

**Guides**
- [Bridge setup & platform notes](docs/bridge.md) — install, per-OS BLE-MIDI, channel routing, known issues (macOS / Linux / Windows).
- [Grooves & multi-channel setup](docs/grooves.md) — the built-in generators (acid, house, trance) and routing channels to instruments.
- [Tester lens UX](docs/tester-ux.md) — building the piano / drum / sequencer modes in Lens Studio.
- [Dependencies & tools](docs/dependencies.md) — everything needed to build, run, and debug.

**Reference**
- [Spectacles API](docs/spectacles-api.md) — the lens-side library: `MidiClient`, transports, components.
- [Core API](docs/api.md) — the platform-independent core surface.
- [Wire protocol](docs/wire-protocol.md) — the WebSocket ↔ MIDI byte protocol.

**Design**
- [Architecture](docs/architecture.md) — overall shape, transports, constraints.
- [Packaging & distribution](docs/packaging.md) — npm packages and the `.lspkg`.
- [Device catalog](docs/device-catalog.md) — per-device CC data pipeline.
- [CC parameters](docs/cc-parameters.md) — exposing CCs as typed, smoothed parameters.
- [MIDI files](docs/midi-files.md) — playing/visualizing `.mid` content (planned).

**Lens packages**
- [MidiBleepBop.lspkg README](lens/MidiBleepBop.lspkg/README.md) — finishing the asset package in Lens Studio.
- [TesterLens README](lens/TesterLens/README.md) — the example components.

## License

Code is [MIT](LICENSE.md). The device-catalog data (`packages/catalog/devices/`, `vendor/`) is CC-BY-SA-4.0 from [pencilresearch/midi](https://github.com/pencilresearch/midi) — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
