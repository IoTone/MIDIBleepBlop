# Dependencies & Tools

A complete accounting of what's needed to build, run, and debug this project — split by what gets installed, what's built into the OS, what hardware was used, and what's optional/recommended. Versions are the ones this project was developed and verified against.

## Runtimes

| Tool | Version used | Notes |
|---|---|---|
| **Node.js** | v20.12.0 | Primary runtime for the bridge, tests, and build scripts. |
| **Bun** | 1.3.14 | Optional alternate runtime for the bridge. Installed at `~/.bun/bin/bun`. Verified: CLI, `jazz-midi` N-API, and the full bridge end-to-end (`scripts/bun-smoke.mjs`). |

## npm dependencies

Installed via `npm install` at the repo root (npm workspaces). Production dependencies are what ship/run; dev dependencies are for building and testing.

### Production

| Package | Version | Used by | Purpose |
|---|---|---|---|
| `ws` | ^8.16.0 | transport-node, bridge | WebSocket client/server. |
| `jzz` | ^1.9.6 | bridge | MIDI I/O via CoreMIDI / ALSA / WinMM. Pulls in the native `jazz-midi` (N-API) binding. |
| `commander` | ^12.0.0 | bridge | CLI argument parsing. |
| `express` | ^4.19.0 | bridge | HTTP server (shares the port with the WebSocket; serves `/status` and future `/play`, `/files`). |

### Development

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.4.0 | Compiler / type-checking. |
| `vitest` | ^1.4.0 | Test runner (102 tests). |
| `@types/node` | ^20.11.0 | Node typings. |
| `@types/ws` | ^8.5.10 | `ws` typings. |
| `@types/express` | ^4.17.21 | `express` typings. |

### Native build note

`jazz-midi` is a native N-API module. It ships prebuilt binaries for common Node/arch combos (macOS works out of the box). If a prebuilt binary isn't available it compiles on install — which on **Windows** needs the Visual Studio "Desktop development with C++" workload, and on **Linux** needs `build-essential` + `libasound2-dev`.

## macOS system tools (built in)

Used during development and debugging; no installation required.

| Tool | Purpose |
|---|---|
| **Audio MIDI Setup** | Enabled the **IAC Driver** (virtual MIDI bus) for loopback testing and for feeding software synths. Also where BLE-MIDI devices are paired into CoreMIDI. |
| **IAC Driver** ("IAC Driver Bus 1") | Virtual MIDI loopback. Used by `npm run test:iac` and to route the bridge into GarageBand / Logic / MainStage / AU Lab. |
| **GarageBand** | Software synth used to verify the send direction. Note: it's omni (receives all MIDI channels on the selected track; can't split channels to tracks). |

## Hardware used

| Device | Appears in CoreMIDI as | Notes |
|---|---|---|
| **Bespeco USB-MIDI interface** | "USB MIDI Interface" | USB→DIN MIDI. Exposes both an input and output port. Gotcha: the interface's **OUT** plug goes to the synth's **IN**. |
| **KORG Volca Bass** | (via the USB interface) | Hardware bass synth. Default MIDI channel 1 (= the library's channel 0). |
| **WIDI Master** (BLE-MIDI) | (via OS pairing) | Discussed for the BLE path; reachable via CoreMIDI on macOS after pairing. Direct BLE from the lens is blocked (no `createBond()` on Spectacles) — see `architecture.md`. |

## Lens Studio packages

In the lens project (not npm):

| Package | Purpose |
|---|---|
| **Lens Studio** (5.9+/5.10) | The IDE and Spectacles runtime. |
| **SpectaclesInteractionKit (SIK)** | Interaction system: `Interactable`, `InteractableManipulation`, `ContainerFrame`, interactor rig. Required for `PianoKeyboard` to receive pinch/poke. |
| **SpectaclesUIKit** | UI primitives (`Frame`, `Slider`, `GridLayout`, …) — referenced by the planned drum/sequencer modes (`tester-ux.md`); not yet used. |

## External data

| Source | License | Use |
|---|---|---|
| [pencilresearch/midi](https://github.com/pencilresearch/midi) | CC-BY-SA-4.0 | Per-device CC catalogs (KORG Volca line vendored under `vendor/`). Fetched with the `gh` CLI; see `THIRD-PARTY-NOTICES.md`. |

## Debugging tools used

All built into macOS or already present; none specific to this project.

| Tool | What we used it for |
|---|---|
| `curl` | Hitting the bridge's `GET /status` to confirm it was up and which device/routes were active. |
| `lsof` | Confirming a process was listening on the bridge port (8765). |
| `ifconfig` / `ipconfig getifaddr` | Finding the dev machine's LAN IP (the lens can't use `localhost`). |
| `socketfilterfw` | Checking the macOS application firewall state. |
| `gh` (GitHub CLI) | Fetching the pencilresearch/midi catalog CSVs. |
| **Lens Studio Logger** | Viewing `print()` output from the lens (connection lifecycle, note events, setup CCs). |
| `node scripts/iac-loopback.mjs` | End-to-end MIDI round-trip test through real CoreMIDI. |
| `node scripts/bun-smoke.mjs` | Bridge HTTP+WS smoke test under Node and Bun. |
| `node examples/dist/echo.js` / `chord-press.js` | Sending/receiving test MIDI against the bridge. |

## Optional / recommended (not installed here)

Mentioned during the work but not required for the current setup.

| Tool | When you'd want it |
|---|---|
| **Logic Pro** ($200) / **MainStage** ($30) / **AU Lab** (free, Apple) | True multitimbral playback — routing different MIDI channels to different instruments (GarageBand can't). See `grooves.md`. |
| **ngrok** (or any tunnel) | Serving `wss://` so a lens using the bridge can be published (plain `ws://` blocks publishing). |
| **KORG BLE-MIDI Driver** (Windows) | Exposing a BLE-MIDI device as a MIDI port on Windows. |
| **PipeWire 0.3.65+** / **BlueALSA** (Linux) | Exposing a BLE-MIDI device as an ALSA port on Linux. |

## One-time environment setup recap

To reproduce the working setup on a fresh macOS machine:

1. `npm install` at the repo root.
2. Enable the **IAC Driver** in Audio MIDI Setup (for loopback/soft-synth testing).
3. (Optional) install **Bun** for the alternate runtime: `curl -fsSL https://bun.sh/install | bash`.
4. For hardware: connect a USB-MIDI interface (OUT → synth IN) or pair a BLE-MIDI device in Audio MIDI Setup.
5. In Lens Studio: ensure **SpectaclesInteractionKit** is present in the lens project.
