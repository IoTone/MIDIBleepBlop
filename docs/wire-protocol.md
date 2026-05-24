# Wire Protocol

This document describes the **WebSocket wire protocol** used by `SpectaclesWebSocketTransport` ↔ `bridge`. It is the only wire protocol this project defines.

The other transport (`SpectaclesBleTransport`) speaks the published [BLE-MIDI 1.0 spec](https://www.midi.org/specifications/midi-transports-specifications/bluetooth-le-midi) directly to the hardware; that protocol is not redefined here, and is handled entirely inside the BLE transport implementation. From `MidiClient`'s perspective both transports look the same.

## Connection

- **Transport:** WebSocket. `wss://` for production / publishable lenses, `ws://` for dev (Lens Studio Experimental APIs flag required for `ws://`).
- **Path:** Any. The bridge ignores the path and treats every connection identically. Reserved for future routing (`/in/0`, `/out/0`) — clients should connect to `/` for v1.
- **Subprotocols:** None. No `Sec-WebSocket-Protocol` negotiation.
- **Auth:** None in v1. Bridge binds to LAN; security is "trust your network." A future revision may add a static bearer token in a query param.

### Reaching the bridge from the lens

> **`localhost` and `127.0.0.1` do not work.** On Spectacles, those addresses resolve to the glasses themselves, not your dev machine. This is the single most common point of confusion.

Valid bridge URLs:

| URL form | Use case | Notes |
|---|---|---|
| `ws://192.168.x.x:8765` | Local LAN dev | Requires Experimental APIs flag. Find IP via `ifconfig` / `ipconfig`. Breaks on every DHCP renewal. |
| `wss://abcd1234.ngrok.app` | Dev with TLS, or remote dev machine | Works without the experimental flag, eligible for publication. Token costs ngrok credits. |
| `wss://midi-bridge.example.com` | Production with a public bridge host | Real DNS + Let's Encrypt cert. |

The bridge does not care about scheme; it terminates TLS itself only if configured with cert paths.

## Framing

**One MIDI message per WebSocket binary frame.** No length prefix, no framing protocol on top. The WebSocket frame boundary *is* the MIDI message boundary.

- Frame type: **binary**. Text frames are ignored.
- Frame contents: the raw MIDI status byte followed by its data bytes. Same byte sequence you would write to a serial MIDI port.
- No timestamps. Latency is implicitly "as fast as the path allows."

### Binary frame reception on Spectacles

The Spectacles `WebSocket` only supports `binaryType = "blob"` — `"arraybuffer"` is **not** available (per `StudioLib.d.ts`). Decoding an inbound binary frame therefore looks like:

```typescript
socket.binaryType = 'blob';
socket.onmessage = async (event) => {
  if (event.data instanceof Blob) {
    const bytes = await event.data.bytes();   // Uint8Array — note the await
    handleMidi(bytes);
  }
};
```

This async unwrap is hidden inside `SpectaclesWebSocketTransport` so `MidiClient` consumers don't see it. Bridge implementations targeting other clients (browsers, node) can use `arraybuffer` if they prefer.

### Examples

| MIDI event | Frame bytes (hex) |
|---|---|
| Note on, channel 1, note 60, velocity 100 | `90 3C 64` |
| Note off, channel 1, note 60 | `80 3C 00` |
| CC, channel 1, controller 1, value 64 | `B0 01 40` |
| Program change, channel 1, program 5 | `C0 05` |
| Pitch bend, channel 1, centered | `E0 00 40` |
| Channel pressure, channel 1, value 64 | `D0 40` |
| MIDI clock tick | `F8` |
| Start of sysex (1-frame, complete) | `F0 ... F7` |

### Why not JSON

JSON adds 5–10× overhead and forces both ends to parse a string per message. For continuous CC streams (modwheel, expression, MPE) this becomes the bottleneck before MIDI does. Raw bytes are the same primitive the BLE-MIDI spec uses minus its timestamp header, so the bridge becomes a near-trivial relay.

## Direction

Full-duplex. The same byte format goes in both directions:

- **Client → bridge:** "send this to the MIDI output."
- **Bridge → client:** "this just arrived from the MIDI input."

There is no in-band direction tag because direction is implicit in which socket end is sending. A client that wants both behaviors gets them on a single connection.

## Running status

Not supported. Every frame must begin with a status byte. The bridge will reject (drop + log) any frame whose first byte has the high bit clear (`< 0x80`). This keeps the parser stateless on both ends.

## Sysex

Supported but constrained:

- A sysex message must fit in **one** WebSocket frame. The frame begins with `F0` and ends with `F7`. Multi-frame sysex is not supported in v1.
- Practical upper bound: the bridge accepts up to **64 KB** per frame. Beyond that the connection is closed with a protocol error.
- The lens-side `MidiClient` exposes sysex only via `sendRaw` and the `'message'` event with `type: 'raw'`. No high-level sysex API.

## Realtime / single-byte messages

`F8` (clock), `FA` (start), `FB` (continue), `FC` (stop), `FE` (active sensing), `FF` (reset) each travel as a single-byte binary frame. They are surfaced to the high-level API only as `{ type: 'raw', bytes: Uint8Array(1) }`.

## Connection lifecycle

| Event | Bridge behavior | Client behavior (`SpectaclesWebSocketTransport`) |
|---|---|---|
| Client connects | Begin forwarding configured MIDI input → this client. | Emit `connect`. |
| Client disconnects | Stop forwarding to this client. Other clients unaffected. | Begin reconnect backoff: 0.5s, 1s, 2s, 5s, capped. |
| Bridge restarts | All clients dropped. | Same backoff path. |
| Bridge MIDI device disappears | Bridge drops to "no input" state but keeps WS connections open. | Continue receiving nothing until the device returns. |

There is no application-level ping. WebSocket keepalive pings are sufficient; clients should not implement their own.

## Errors

The bridge does not send error frames. Anything that looks malformed is dropped and logged on the bridge side. If a client repeatedly sends invalid data (>100 bad frames in 10s), the bridge closes the connection with code `1008` (policy violation).

## Versioning

This document describes **wire protocol v1**. Future versions may negotiate via `Sec-WebSocket-Protocol`. Until then, clients and bridges that follow this document interoperate without version negotiation.

## Out of scope (v1)

- **Multiple MIDI devices on one bridge.** Bridge handles one input and one output, both configured at startup.
- **Device discovery / enumeration via the wire.** Clients do not ask the bridge what devices are available.
- **Timestamps / look-ahead scheduling.** No way to request "play this at T+50ms."
- **Sysex fragmentation.** One sysex per frame, ≤64 KB.
- **Authentication.** Bridge trusts the LAN.

Each of these is straightforwardly addable later within the existing framing — they would all surface as new message types or sideband control frames negotiated via subprotocol, not as a breaking change to the byte-per-frame core.
