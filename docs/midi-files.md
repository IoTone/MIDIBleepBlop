# MIDI Files

How `.mid` / `.midi` (Standard MIDI File, SMF) content reaches the lens, what it's parsed for, and how it composes with the live transport.

## Scope

In scope for v1 of the MIDI-file story:

- **Playback** — drive notes to a synth from a pre-recorded song.
- **Visualization** — render a piano roll, lookahead cues, scrub controls.
- **Loading** — both bridge-served (dev) and HTTPS-fetched (published lens) sources.

Explicitly out of scope:

- **Authoring / recording to file.** Reverse direction; v2.
- **MIDI 2.0 / SMPTE timecode files / Karaoke `.kar` / RMID containers.** Standard SMF 0/1 only.
- **General audio playback.** This is MIDI, not audio.

## The two layers

"Handle MIDI files" splits cleanly into two independent concerns. They compose well but neither requires the other.

### Layer A — Bridge plays the file, lens listens as live MIDI

The bridge already speaks the MIDI wire protocol (see `wire-protocol.md`). If the bridge reads an SMF file and dispatches its events at the right times, every event arrives at the lens **exactly like live performance**. The lens needs zero new code; the wire protocol does not change.

```
.mid file ──► bridge (parses + schedules + sends to MIDI out)
                │
                │   live MIDI events also forwarded to WS clients
                ▼
              lens (existing MidiClient — sees noteOn / noteOff like any other source)
```

**What gets added:**

- Bridge dependency on `jzz-midi-smf` (SMF parser/player in the JZZ ecosystem; same maintainers as JZZ).
- Bridge CLI: `--play <file>` (auto-play on start) and/or HTTP `POST /play` with a body specifying file path.
- Bridge HTTP `POST /stop` to halt playback.

**What does not change:**

- The lens. `MidiClient` already handles incoming events; it has no idea whether they came from a human or a file.
- The MIDI wire protocol. File events flow through it unchanged.

**When this is enough on its own:** when the lens only needs to *react* to MIDI (light up a key as it sounds, flash on noteOn, drive a scrubbing wave from velocity). No lookahead, no scrub UI, no "what's coming in 2 seconds."

### Layer B — Lens fetches, parses, schedules, sends

For piano roll, lookahead cues, scrubbing, tempo manipulation, or any UI that depends on *seeing the song*, the lens needs the full structure ahead of time.

```
.mid file (HTTPS URL or bridge static file endpoint)
   │
   │   fetch
   ▼
 lens — SMF parser → Song (typed: tracks, notes with absolute times, tempo map)
   │
   │   SongPlayer.play() schedules MidiClient.sendNoteOn/Off at the right ticks
   ▼
 bridge — receives notes via existing WS, plays them on the MIDI out
```

**What gets added:**

- A TypeScript SMF parser in `packages/core` (port or vendor a small permissive lib; ~6 KB minified).
- A `Song` type in `packages/core` (tracks, notes with absolute beat / wall-clock times, tempo map, time signatures).
- A `SongPlayer` class in `packages/core` — takes a `Song`, a `MidiClient` to send to, and the same pluggable `schedule` primitive the transport uses. Supports `play()`, `pause()`, `seek(beat)`, `setTempoScale(x)`.
- Static file serving on the bridge: `--songs-dir <path>` exposes `GET /files/<name>` (10 lines).

**What does not change:**

- The MIDI wire protocol. `SongPlayer` calls existing `MidiClient.sendNoteOn` etc.; the bridge forwards bytes as today.
- The bridge's MIDI plumbing. Files served via HTTP, events arrive via WS — separate concerns on the same port.

**When this is needed:** piano roll, lookahead, "tap to start," speed adjustment, anything where the lens needs to know about notes before they sound.

### Layers compose; they don't conflict

| Need | Use |
|---|---|
| Quick demo, no UI | Layer A only |
| Visualization, no scrubbing | Layer B (parses for visuals) + Layer A (bridge for audio) — only if you can't have the lens drive audio |
| Visualization with full scrub / tempo control | Layer B only — lens is the timing master |

When both layers run together against the same file you'd get double-triggers. The recommendation: if the lens has parsed the song (Layer B is active), the lens is the playback authority. Layer A is the "lens doesn't know about MIDI files" path.

## Why files go over HTTP, not the MIDI WebSocket

The MIDI wire protocol is byte-per-frame with no framing on top. Mixing in opaque file bytes would force one of:

- Text frames for control (slow, ugly).
- A framing layer (adds complexity and a parsing burden on every connection).
- Magic-byte prefix conventions (fragile, easy to misread as a MIDI status byte).

The bridge is already an HTTP server (the WS upgrade runs on top of HTTP). Adding a couple of REST-y endpoints for control and a static file path costs almost nothing and keeps the MIDI WS pure.

The lens already does HTTP via `InternetModule.fetch` — no new SDK surface to learn.

## Where files live

| Stage | Source | URL shape |
|---|---|---|
| Dev (bridge + lens on same LAN) | A folder the bridge serves | `http://192.168.x.x:8765/files/song.mid` |
| Published lens (still needs bridge for synth output) | Any HTTPS URL the lens has been configured with | `https://cdn.example.com/songs/song.mid` |
| Local-only demo (lens doesn't need synth output) | Same HTTPS pattern | as above |

Authors choose. The library doesn't care; it takes a URL string.

For dev iteration, the bridge's static file endpoint is the lowest-friction story: drop a `.mid` into `~/songs/`, point the lens at the bridge, fetch — no rebuild, no upload.

## Bridge surface additions

Layer A:

```
POST /play           body: { file: "song.mid" } or { url: "https://..." }
POST /stop
GET  /status         returns { playing: bool, file?: string, positionBeats?: number }
```

Layer B (just static files; serving is enough):

```
GET  /files          returns ["a.mid", "b.mid", ...]   (optional, nice-to-have)
GET  /files/<name>   returns the file bytes
```

The bridge gains a `--songs-dir <path>` flag. If unset, the file endpoints 404.

## Lens-side API sketch

In `packages/core`:

```typescript
export interface Song {
  durationBeats: number;
  ppq: number;                          // pulses per quarter (from SMF header)
  tempoMap: Array<{ atBeat: number; bpm: number }>;
  tracks: Track[];
}

export interface Track {
  name?: string;
  channel: number;
  events: SongEvent[];                  // sorted by beat
}

export type SongEvent =
  | { type: 'noteOn';  beat: number; note: number; velocity: number }
  | { type: 'noteOff'; beat: number; note: number; velocity: number }
  | { type: 'cc';      beat: number; controller: number; value: number }
  | { type: 'programChange'; beat: number; program: number };

export function parseSmf(bytes: Uint8Array): Song;

export class SongPlayer {
  constructor(opts: {
    song: Song;
    client: MidiClient;
    schedule: Schedule;                 // same pluggable primitive as the transport
  });

  play(): void;
  pause(): void;
  stop(): void;
  seek(beat: number): void;
  setTempoScale(scale: number): void;   // 1 = normal, 0.5 = half-speed, 2 = double
  readonly positionBeats: number;
  readonly playing: boolean;
}
```

In the `.lspkg`, the existing `MidiClientComponent` gets no changes. A new `SongLoaderComponent` (companion component) handles fetching and playback:

```typescript
@component
export class SongLoaderComponent extends BaseScriptComponent {
  @input songUrl: string = 'http://192.168.1.100:8765/files/song.mid';
  @input midi: MidiClientComponent;
  @input autoPlay: boolean = false;

  song: Song | null = null;
  player: SongPlayer | null = null;
}
```

Other lens scripts read `songLoader.song` for visualization and call `songLoader.player.play()` for playback.

## Suggested build order

1. **Bridge `--play` + `POST /play` / `POST /stop`** (Layer A). Light up "song plays through my lens" with the smallest possible change. Validates the bridge-as-MIDI-source path.
2. **Bridge `--songs-dir` + `GET /files/<name>`** (Layer B prerequisite). Trivial Express-y static serving; ~10 lines.
3. **SMF parser in `core` + tests** against a handful of real `.mid` files (pure data work, fully testable on desktop).
4. **`SongPlayer` in `core` + tests** using `MockTransport` to assert "the right `send` calls happened at the right times" with a fake `schedule`.
5. **`SongLoaderComponent` in `.lspkg`** wrapping fetch + parse + player.
6. **Example lens scene** that loads a song and renders scrolling notes — proves Layer B end-to-end.

Each step is independently shippable; you can stop at any point with a working library.

## Open questions / decisions to revisit

- **Bridge HTTP framework.** v1 bridge uses raw `ws` + Node; adding `--play` and static file serving probably warrants Express or a tiny equivalent. Or we keep `node:http` and route by hand (the surface is small enough — 3 endpoints).
- **SMF parser provenance.** Port `midi-file` (BSD, ~300 lines), vendor it, or write from scratch. Vendoring is cleanest given Lens Studio's no-`node_modules` constraint.
- **Tempo map on lens side.** SMF allows tempo changes via meta-events. v1 should respect them; the parser surfaces a tempo map and `SongPlayer` uses it.
- **Sysex in files.** Same handling as the live transport: opaque `raw` events passed through. No high-level API.

## What this does *not* require

- No changes to `wire-protocol.md`.
- No changes to `architecture.md`'s shape diagram (file traffic uses the existing HTTP surface of the bridge; live MIDI uses the existing WS path).
- No changes to `MidiClient` or the existing transports.

Everything new is additive: bridge gains endpoints, `core` gains `Song` + `parseSmf` + `SongPlayer`, `.lspkg` gains `SongLoaderComponent`. The composition with the existing pieces is via interfaces that already exist.
