# Bridge

The bridge is a small process that translates between the WebSocket wire protocol (see `wire-protocol.md`) and the host OS's MIDI subsystem. It runs on **macOS, Linux, or Windows**, under **Node.js or Bun** — the lens code never knows which.

Internally it's a single HTTP server (Express) that serves both the WebSocket upgrade (for live MIDI) and small REST endpoints (`/status` today; `/play`, `/files` once `midi-files.md` is implemented). One port, one process.

## What the bridge does and does not do

**Does:**

- Listens for WebSocket connections on a configured port.
- Opens one MIDI input and one MIDI output via JZZ (cross-platform, backed by the native `jazz-midi` binding).
- For each connected client: forwards incoming MIDI bytes → client; forwards client-sent bytes → MIDI output.

**Does not:**

- Pair, bond, or discover Bluetooth devices. **The OS handles BLE-MIDI pairing; the bridge just opens whatever MIDI ports the OS exposes to it.**
- Implement BLE-MIDI packet framing. By the time a BLE-MIDI message reaches the OS-level MIDI port, the OS subsystem has already stripped BLE-MIDI headers and presented clean MIDI bytes.
- Run on the Spectacles. The bridge runs on a companion computer on the same network.

## Installation

### Node.js (default)

All platforms:

```
npx @midi-bleep-bop/bridge --device "WIDI Master"
```

This downloads and runs the bridge without installing it globally. JZZ pulls in `jazz-midi` as a native dependency.

**Windows-specific install note:** if `npm install` fails to compile `jazz-midi`, install Microsoft's *Desktop development with C++* workload from Visual Studio Build Tools (or the standalone Build Tools for Visual Studio installer). Recent versions of `jazz-midi` ship prebuilt binaries for the common Node/arch combinations, so most users should not hit this.

### Bun (alternative)

Bun is a Node-compatible runtime with faster startup and a smaller memory footprint. The bridge runs on Bun unchanged — it's a single binary install, no build tools needed:

```
curl -fsSL https://bun.sh/install | bash      # macOS / Linux
# or: powershell -c "irm bun.sh/install.ps1 | iex"   (Windows)

bunx @midi-bleep-bop/bridge --device "WIDI Master"
```

`bunx` is Bun's equivalent of `npx` and supports the same `--device` / `--list` / `--port` flags as the Node CLI; the published `bin` script runs under either runtime.

**Bun + `jazz-midi` compatibility.** `jazz-midi` is an N-API native module. Verified loading and enumerating MIDI devices under Bun 1.3.14 on macOS — `bunx @midi-bleep-bop/bridge --list` returns the same device list as the Node equivalent. If a future `jazz-midi` release breaks Bun compatibility the failure mode is loud (an import error on startup), and falling back to Node is one command.

**Performance note.** For the live MIDI path the dominant latency is the network and the OS MIDI subsystem; Bun vs Node makes ~milliseconds of difference at process startup but almost none during steady-state operation. The reason to prefer Bun is operational simplicity (single-binary install, no build tools for native deps in many cases), not throughput.

**Smoke test.** `scripts/bun-smoke.mjs` in the repo runs the same end-to-end check against either runtime — boots `BridgeServer` with a mock MIDI IO, hits `/status` over HTTP, opens a WebSocket, forwards a frame, and shuts down. Useful when validating a new Bun release:

```
node scripts/bun-smoke.mjs        # baseline
bun scripts/bun-smoke.mjs         # Bun
```

## End-to-end test through real CoreMIDI (macOS, IAC loopback)

`scripts/iac-loopback.mjs` exercises the *entire* stack — including the `jazz-midi` N-API binding, which the vitest suite (using `MockMidiIO`) bypasses. The script opens macOS's IAC Driver as both bridge input and output, connects a WebSocket client, sends a `noteOn`, and asserts that the same `noteOn` comes back through the WS after looping through CoreMIDI:

```
WS client → bridge → CoreMIDI out → IAC bus → CoreMIDI in → bridge → WS client
```

One-time setup (script prints these instructions if it can't find IAC):

1. Open **Audio MIDI Setup** (`/Applications/Utilities/`).
2. **Window → Show MIDI Studio**.
3. Double-click **IAC Driver**.
4. Check **Device is online**; ensure at least one port exists (default name: `Bus 1`).

Then run via npm scripts:

```
npm run test:iac        # under Node
npm run test:iac:bun    # under Bun
```

On an unconfigured machine the script prints the setup hint and exits `0` — it's opt-in and intentionally non-fatal so it can be wired into CI without blocking environments where IAC isn't available.

This is the highest-confidence "the bridge really works" check available without a paired BLE-MIDI device.

## Audible verification through GarageBand (macOS)

`scripts/garageband-play.mjs` is the audible companion to `iac-loopback.mjs` — same plumbing, but instead of asserting bytes round-trip, it sends a chord progression that you hear through a real DAW. Useful for the first-time "does this actually work?" sanity check.

```
chord-press loop → bridge → CoreMIDI out → IAC Bus 1 → GarageBand soft instrument → speaker
```

Run it:

```
npm run play:gb
```

The script prints a GarageBand checklist on startup. Setup:

1. IAC enabled (same one-time step as the loopback test above).
2. GarageBand → **Empty Project** → **Software Instrument** → pick any instrument.
3. The track must be **selected** (highlighted) so GarageBand monitors its MIDI input.

You should hear I–vi–IV–V in C major looping at ~7 seconds per cycle. Ctrl+C stops cleanly with all-notes-off so no hung notes are left in the DAW.

Note that this is **not** a closed-loop byte test — GarageBand doesn't route MIDI back out, so we can only verify "did sound come out" with human ears. Logic Pro and Reaper can do a true closed loop via two IAC buses (track-level MIDI output routing); we don't ship a script for that today.

## Per-OS BLE-MIDI setup

For non-BLE MIDI hardware (USB controllers, audio interfaces with DIN MIDI, DAWs, software synths) the bridge sees them through the OS's normal MIDI device list — no extra setup beyond plugging in the device. **The OS-specific work below is only needed when you want a BLE-MIDI device (e.g., WIDI Master) to appear as a MIDI port the bridge can open.**

### macOS

CoreMIDI handles BLE-MIDI natively. One-time setup:

1. Open **Audio MIDI Setup** (in `/Applications/Utilities/`).
2. **Window → Show MIDI Studio**.
3. Double-click the **Bluetooth** icon.
4. Find your BLE-MIDI device in the list, click **Connect**.
5. Once connected, the device appears as both a MIDI input and a MIDI output in CoreMIDI.

Now run the bridge:

```
npx @midi-bleep-bop/bridge --device "WIDI Master"
```

If the device disconnects (out of range, power-cycled), the bridge keeps running with the port temporarily silent; reconnect via Audio MIDI Setup and it resumes.

### Linux

Linux has no built-in BLE-MIDI bridging; you need a userspace component that exposes the BLE device as an ALSA MIDI port. Two viable paths in 2026:

**Path A — PipeWire (recommended on modern distros).** PipeWire 0.3.65+ with WirePlumber has native BLE-MIDI support; on Ubuntu 24.04, Fedora 39+, Arch, or any current PipeWire distro this is the simplest option.

1. Verify your PipeWire version: `pipewire --version` (need ≥ 0.3.65).
2. Pair the BLE-MIDI device once via `bluetoothctl`:
   ```
   bluetoothctl
   power on
   scan on
   pair <MAC>          # MAC from scan output
   trust <MAC>
   connect <MAC>
   ```
3. PipeWire will expose the device as a MIDI port visible to ALSA-aware applications.
4. Verify with `aconnect -l` — you should see the BLE-MIDI device listed.

**Path B — BlueALSA** (for older / lighter setups). [`bluez-alsa`](https://github.com/arkq/bluez-alsa) registers BLE-MIDI as ALSA sequencer ports. Install per the project's README; the workflow afterward is the same as Path A (pair via `bluetoothctl`, verify with `aconnect -l`).

Once a path is set up:

```
npx @midi-bleep-bop/bridge --device "WIDI"
```

JZZ uses RtMidi's ALSA backend, which sees the BLE-MIDI device exactly like any other ALSA MIDI device.

**Known gotcha:** BLE timing jitter is real on Linux. PipeWire allows tuning a constant-latency buffer to trade latency for jitter reduction (`api.bluez.midi.latency` in the WirePlumber config). Default is usually fine for visualizations; bump it up if you see dropped/duplicated events.

### Windows

Windows does not handle BLE-MIDI out of the box (the in-box MIDI service is being modernized in Windows 11 24H2+ but driver/app compatibility is still in transition as of mid-2026). The de-facto solution remains **Korg's free BLE-MIDI Driver**.

1. Download the [KORG BLE-MIDI Driver](https://www.korg.com/us/support/download/driver/1/305/2886/) (works for WIDI Master, microKEY Air, and any standards-compliant BLE-MIDI device, not just Korg gear).
2. Install the `.exe`. Verify in Device Manager → Sound, video and game controllers.
3. Launch the driver's pairing utility, scan, select your device, and pair.
4. Device now appears as a MIDI port to WinMM/WinRT.

For WIDI devices specifically: ensure firmware is v0.1.3.7 or later, and set the WIDI's BLE role to **Force Peripheral** via the WIDI app (paired via phone). Otherwise it may advertise as a central and Windows won't see it.

Then run the bridge:

```
npx @midi-bleep-bop/bridge --device "WIDI Master"
```

JZZ uses RtMidi's WinMM backend; the BLE device is indistinguishable from a USB MIDI controller at this layer.

**Future-state note:** Windows 11's new MIDI Services (MIDI 2.0 stack) brings native BLE-MIDI without third-party drivers. DAWs are slowly migrating; once Windows MIDI Services is the default and JZZ/RtMidi target it via WinRT MIDI, the Korg-driver step will become unnecessary. Until then, treat the Korg driver as the standard path.

## CLI reference

```
@midi-bleep-bop/bridge [options]
  --port <n>             WebSocket + HTTP port (default 8765)
  --input <pattern>      MIDI input device name substring (default: prompt)
  --output <pattern>     MIDI output device name substring (default: same as --input)
  --device <pattern>     Shorthand for --input=X --output=X
  --list                 List available MIDI devices and exit
  --log <level>          off | error | info | debug (default info)
  --tls-cert <path>      Optional cert for serving wss://
  --tls-key  <path>      Optional key  for serving wss://
```

`--list` is the first step when troubleshooting — it shows exactly what JZZ sees on the host OS. If your BLE-MIDI device doesn't appear here, the OS-level pairing isn't done; revisit the per-OS section above.

A `bridge.config.json` discovered in the working directory provides the same options for non-CLI invocations.

## HTTP endpoints

The bridge runs an Express HTTP server on the same port as the WebSocket. Current endpoints:

| Method | Path | Returns | Purpose |
|---|---|---|---|
| GET | `/status` | `{ ok, startedAt, clients, input, output }` | Health check + quick visibility into who's connected and which devices are open |

Planned (see `midi-files.md`):

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/play` | `{ file }` or `{ url }` | Start playing an SMF file through the MIDI output |
| POST | `/stop` | — | Halt playback |
| GET | `/files` | `[...names]` | List `.mid` files in the bridge's songs directory |
| GET | `/files/<name>` | file bytes | Serve a `.mid` file for lens-side fetch + parse |

The Express app is exposed as `BridgeServer#express` so additional routes can be registered by callers embedding the bridge as a library, without modifying `BridgeServer` itself.

Quick smoke test:

```
curl http://127.0.0.1:8765/status
# {"ok":true,"startedAt":"2026-05-23T...","clients":0,"input":"WIDI Master","output":"WIDI Master"}
```

## Same bridge, same lens, any OS

The wire protocol is host-agnostic. A lens developed against a macOS bridge will work unchanged against a Linux or Windows bridge, and vice versa. The `MidiClientComponent` inspector input is just a URL string; the lens never knows the OS on the other side.

This means a publish-ready lens can document "point this at any bridge — Mac, Linux, or Windows" without per-OS lens branching.

## Troubleshooting (cross-OS)

| Symptom | Likely cause | Check |
|---|---|---|
| Lens can't connect at all | `localhost` in lens URL, wrong LAN IP, or firewall blocking the WS port | Use the host's actual LAN IP; allow inbound on `--port` in the OS firewall |
| Lens connects, no MIDI flowing | Bridge can't open the named device | `--list` shows what JZZ sees; check the `--device` pattern matches |
| BLE device not in `--list` | OS-level BLE-MIDI pairing missing/failed | Re-do the per-OS setup; verify with the OS tool (`aconnect -l` on Linux, Audio MIDI Setup on macOS, Device Manager on Windows) |
| Connects, drops, reconnects | BLE link quality | Move closer, reduce 2.4 GHz interference, on Linux tune the PipeWire BLE-MIDI latency knob |
| `jazz-midi` fails to install on Windows | Missing C++ build tools | Install VS Build Tools (Desktop development with C++ workload) |
| `jazz-midi` import error under Bun | Bun's N-API compatibility gap for this binding | Fall back to Node (`npx` instead of `bunx`); track the binding's Bun support upstream |
| `/status` returns nothing / curl hangs | Wrong port or firewall blocks inbound HTTP | The HTTP and WebSocket share `--port`; if the lens can't reach `ws://`, `curl` to `http://` will fail too |

## What the bridge does *not* do that you might expect

- **It does not advertise itself.** No mDNS, no broadcast, no discovery. Lenses need the bridge's IP configured manually. This is partly because Spectacles doesn't expose mDNS resolution anyway.
- **It does not multiplex MIDI devices.** One in, one out per bridge process. Run multiple bridges on different ports if you need that.
- **It does not authenticate clients.** Anyone on the LAN with the bridge URL can send MIDI. Bind to a non-public network or run behind a tunnel that does auth.
- **It does not transcode timing.** No look-ahead scheduling, no jitter smoothing on the WS path (BLE jitter smoothing on Linux is delegated to PipeWire).

Sources:
- [PipeWire MIDI documentation](https://docs.pipewire.org/page_midi.html)
- [PipeWire 0.3.65 Adds Bluetooth MIDI Support](https://9to5linux.com/pipewire-0-3-65-adds-bluetooth-midi-support-alsa-plugin-improvements)
- [BlueALSA](https://github.com/arkq/bluez-alsa)
- [KORG BLE-MIDI Driver](https://www.korg.com/us/support/download/driver/1/305/2886/)
- [WIDI Master: Start Guide](https://www.cme-pro.com/widi-master-start-guide-bluetooth-midi/)
- [JZZ.js MIDI library](https://github.com/jazz-soft/JZZ)
