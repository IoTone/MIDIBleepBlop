# Tester Lens

A minimal Lens Studio project that proves the lens-side library actually works against your running bridge. This is the first time the code in `lens/MidiBleepBop.lspkg/Scripts/` gets exercised in a real Lens Studio runtime — everything until now has been TypeScript type-checking only.

## What it verifies

- `SpectaclesWebSocketTransport` loads under the Lens Studio runtime.
- The `Blob → Uint8Array` async decode path works against a real LS WebSocket.
- `MidiClientComponent`'s `DelayedCallbackEvent`-backed `schedule` correctly drives the reconnect path.
- The bundled `MidiBleepBop.ts` works as a Lens Studio module.
- The full chain: bridge → WiFi → Spectacles lens → on-glass visual update.

## Prerequisites

1. **Bridge running** against some MIDI device (IAC for desktop testing, WIDI for real synths):
   ```
   npm run play:gb       # easiest — sends a chord progression on loop through IAC
   # or, after starting the bridge yourself:
   node bridge/dist/cli.js --device "IAC Driver Bus 1" --log debug
   node examples/dist/chord-press.js
   ```
2. **Lens Studio 5.9 or later** (BLE/WebSocket APIs require this; we target 5.10).
3. **Dev machine's LAN IP** — `ifconfig | grep "inet "` on macOS. Spectacles cannot reach `localhost`/`127.0.0.1`.
4. **Spectacles paired** to Lens Studio, if you want to push to glasses (preview-only is fine for first verification).

## Files in this repo

```
lens/TesterLens/
└── Assets/Scripts/
    ├── DiagnosticPanel.ts      ← text readout of connection state, last event, held notes, CC
    └── NoteCubeFlash.ts        ← scales a cube up while any note is held
```

These two scripts are the only Tester-Lens-specific code; the rest of the project (scene graph, prefab wiring, Text components) is constructed once inside Lens Studio.

## Building the project in Lens Studio (one-time)

### 1. Create the project

1. Open Lens Studio.
2. **File → New Project → Spectacles → Blank**.
3. Save the project as `TesterLens.esproj` *inside* `lens/TesterLens/` in this repo. The scripts you'll reference live alongside under `Assets/Scripts/`.

### 2. Import the library scripts

The simplest dev workflow is to drop the library's TypeScript files directly into the project (avoids rebuilding a `.lspkg` after every library change):

1. **Resources panel** → right-click → **Import Files**.
2. Select both `lens/MidiBleepBop.lspkg/Scripts/MidiBleepBop.ts` and `lens/MidiBleepBop.lspkg/Scripts/MidiClientComponent.ts`.
3. Also import `lens/TesterLens/Assets/Scripts/DiagnosticPanel.ts` and `NoteCubeFlash.ts`.

All four should appear under Resources after compilation. Watch the TypeScript Status panel (**Window → Utilities → TypeScript Status**) for compile errors.

> If you'd rather consume the published library: import `MidiBleepBop.lspkg` as a package instead (see `lens/MidiBleepBop.lspkg/README.md`). Direct file imports are faster during library development; the `.lspkg` workflow is what end users will use.

### 3. Build the scene

In the **Scene Hierarchy** panel, add the following SceneObjects:

| Object | Purpose | Components |
|---|---|---|
| `MidiClient` | The library's connection component | Attach `MidiClientComponent` script |
| `DiagnosticPanel` | Holds the diagnostic logic | Attach `DiagnosticPanel` script |
| `Status` | Connection status text | `Text` component |
| `LastEvent` | Most recent MIDI event | `Text` |
| `HeldNotes` | Currently held notes | `Text` |
| `LastCC` | Last CC change | `Text` |
| `MessageCount` | Rolling message counter | `Text` |
| `FlashCube` *(optional)* | Visual confirmation | A `Cube` mesh + `NoteCubeFlash` script |

Lay the text objects out as a vertical stack in front of the camera; they're for debugging, not aesthetics.

### 4. Wire the inputs

Select `MidiClient` and in the Inspector:

- **Bridge Url**: your dev machine's LAN IP, e.g. `ws://192.168.1.100:8765`. **Do not use `localhost`.**
- **Auto Connect**: ✓

Select `DiagnosticPanel` and:

- **Midi**: drag the `MidiClient` SceneObject into this slot.
- **Channel**: `0` (matches what `play:gb` and `chord-press` send). Set to `-1` to monitor every channel.
- **Status Text**, **Last Event Text**, **Held Notes Text**, **Last CC Text**, **Message Count Text**: drag the matching Text SceneObjects into each slot.

If you added `FlashCube`, also select it and wire its `NoteCubeFlash` inputs:

- **Midi**: the `MidiClient` SceneObject.
- **Channel**: same as above.
- **Target**: the `FlashCube` SceneObject itself (or any child mesh you want to scale).
- **Rest Scale / Flash Scale**: defaults are fine (1.0 / 1.5).

### 5. Enable Experimental APIs

**Lens → Project Settings → Experimental APIs** must be enabled while you use `ws://`. (Switch to `wss://` via a tunnel like ngrok if you want to publish; see `docs/bridge.md`.)

## Running it

### Preview in Lens Studio

1. Set the **Device Type Override** (top of the Preview panel) to **Spectacles**.
2. Start your bridge + a note source (e.g. `npm run play:gb`).
3. Press **▶ Play** in the Preview panel.
4. The `Status` text should flip from `connecting` to `open` within ~1 second.
5. As chords play through the bridge, the diagnostic texts update and (if you added it) the cube grows/shrinks.

### Pushing to glasses

1. Connect your Spectacles via the **Pair Spectacles** flow in Lens Studio.
2. **Send to Spectacles** from the toolbar.
3. The lens runs on-device; the bridge URL must be reachable from the glasses (same WiFi as your dev machine).

## Channel filtering

The `channel` input on both `DiagnosticPanel` and `NoteCubeFlash` accepts values `0–15` (filter to that channel) or any value outside that range (typically `-1`) for "monitor all channels."

The default is `0` because both `play:gb` and `examples/chord-press.js` send on channel 0 — so the out-of-the-box experience just works. Set it to a different value when you're testing against a DAW or controller that sends on a specific channel, or to `-1` when you don't yet know what channel the source is using.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Status` stuck on `connecting` | Wrong URL or `localhost` used | Confirm bridge IP via `ifconfig`; LAN IP only |
| `Status` stuck on `closed` immediately | Bridge isn't running, or wrong port | `curl http://<ip>:8765/status` from another terminal — should return JSON |
| `Status` reaches `open` but no events | Bridge isn't seeing MIDI input | `node bridge/dist/cli.js --list` to confirm the MIDI device is visible |
| `Status` reaches `open`, events arrive, but channel doesn't match | Source is sending on a different channel | Set `DiagnosticPanel.channel` to `-1` to see all channels — find the right number |
| Lens Studio TS errors on `MidiBleepBop.ts` import | TypeScript compile is stale | **Window → Utilities → TypeScript Status** then re-save; check that all four scripts compiled |
| `MessageCount` advancing but `LastEvent` not updating | Events are all on a different channel (filtered out) | Set `channel` to `-1` |
| WebSocket connect error in preview | Experimental APIs not enabled | **Lens → Project Settings → Experimental APIs** → ✓ |

## What this *doesn't* test

- BLE-MIDI direct (covered as future work in `architecture.md`).
- Sysex round-tripping (out of scope for v1).
- Sub-frame timing accuracy (no test infrastructure for it yet).
- `wss://` against a TLS-terminated bridge (works in principle; not exercised here).

The bigger demos — piano keyboard with key-illumination, drum pad, CC knob meters — belong in a future "DemoLens" rather than the bare-bones Tester Lens.
