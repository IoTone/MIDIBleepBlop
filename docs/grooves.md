# Grooves & Multi-Channel Setup

`ChordSender` is a built-in groove generator for the lens — a quick way to drive a synth without playing the piano by hand. It plays one of four patterns on a loop, on one MIDI channel. This doc covers the patterns and how to run several at once across channels and instruments.

## The patterns

Set `ChordSender.pattern` in the inspector. One `ChordSender` = one pattern on one channel; add several components to layer grooves.

| `pattern` | What it plays | Aim it at | Suggested |
|---|---|---|---|
| `triad` | A major triad from `rootNote`, held and repeated. | Any | `rootNote` 60, `bpm` ~100 |
| `acid` | 16th-note A-minor 303-style bassline: root pulse with octave jumps and color notes (C/E/G), plucky gate. | A bass synth (Volca Bass) | `bpm` ~130 |
| `house` | Off-beat 7th-chord stabs Am7 → Dm7 → Em7 → Cmaj7 on the "and" of each beat, mid register. | A pad/chord synth | `bpm` ~122 |
| `trance` | Driving quarter-note bass pulse (A A A) with an octave lift on beat 4. Locks with a four-on-the-floor kick. | A bass synth | `bpm` ~138 |

Shared inputs: `channel`, `bpm`, `velocity`, and `transpose` (semitones, applied to `acid`/`house`/`trance` so you can change key). `autoPlay` starts it on awake; otherwise call `play()` / `stop()`.

The note data lives in constants at the top of `ChordSender.ts` (`ACID_STEPS`, `HOUSE_STEPS`, `TRANCE_STEPS`) — edit them to change the riff. For example, the trance constant has a comment showing how to switch the quarter-note pulse to a classic rolling off-beat bass.

## Running several grooves at once

Each `ChordSender` sends on its own `channel`. To play, say, an acid bass and house chords together, add two components on two channels:

| Component | `pattern` | `channel` |
|---|---|---|
| ChordSender (bass) | `acid` | 0 |
| ChordSender (chords) | `house` | 1 |

Both share the one `MidiClientComponent`, so there's still a single bridge connection. The channel number decides which instrument hears each groove.

## Getting each channel to a different instrument

The channel only matters at the destination. Two ways to split channels to instruments:

### Option A — one host splits by channel (recommended for software)

Point the bridge at a single output and let a channel-aware host route internally:

```
node bridge/dist/cli.js --device "IAC Driver Bus 1"
```

Then in **Logic Pro**, **MainStage**, or **AU Lab** (not GarageBand — it's omni and can't split channels), assign track/instrument 1 to MIDI channel 1, instrument 2 to channel 2, etc. Acid (channel 0 → MIDI ch 1) plays the bass instrument; house (channel 1 → MIDI ch 2) plays the chord instrument.

### Option B — the bridge fans channels to different outputs

When instruments live on different ports — e.g. a hardware Volca Bass on a USB interface plus a software synth on IAC — use the bridge's `--route` (see `bridge.md`):

```
node bridge/dist/cli.js \
  --device "IAC Driver Bus 1" \        # default output
  --route "0=USB MIDI Interface"       # channel 0 → Volca Bass
```

Now the acid bass (channel 0) goes to the Volca over the USB interface, and the house chords (channel 1, unmapped) go to IAC → your software synth. One bridge, one lens connection.

## Ableton Live setup

Ableton **never appears in the bridge's `--list`** — it's a MIDI consumer, not a MIDI port. You connect them with a **virtual MIDI bus**: the bridge sends to the bus, and Live listens on the bus. Run the bridge on the **same machine as Live** (the MIDI side is local; the Spectacles still reach it over the LAN).

### 1. Create a virtual MIDI bus

- **macOS:** open **Audio MIDI Setup** → Window → **MIDI Studio** → double-click **IAC Driver** → check **"Device is online."** (Bus 1 exists by default.)
- **Windows:** install **loopMIDI** (Tobias Erichsen, free) from <https://www.tobias-erichsen.de/software/loopmidi.html> and create a port, e.g. "loopMIDI Port". There's no IAC on Windows.

### 2. Point the bridge at the bus

```
node bridge/dist/cli.js --device "IAC Driver Bus 1"     # macOS
node bridge/dist/cli.js --device "loopMIDI Port"        # Windows
```

Confirm the exact name with `node bridge/dist/cli.js --list`. If the bus doesn't appear, the virtual driver isn't online — re-check step 1.

### 3. Enable the input in Live

In **Preferences → Link/Tempo/MIDI** (Live 10) → **MIDI Ports**, find the **Input** row for your bus (IAC Driver (Bus 1) / loopMIDI Port) and turn **Track = On**. Enable **Remote** too if you want to map knobs to controls.

### 4. One track per channel (this is how Live splits the grooves)

Live 10 routes one input *port* to a track, but each track can filter to a single **MIDI channel** — so several tracks all listening to the same bus, filtered to different channels, give you true multitimbral playback that GarageBand can't. Remember the bridge's channel is 0-indexed: **channel 0 = MIDI ch 1**.

| Track | MIDI From | Channel | Monitor | Plays |
|---|---|---|---|---|
| Bass | IAC Driver (Bus 1) | Ch. 1 | In | acid / trance (bridge ch 0) |
| Chords | IAC Driver (Bus 1) | Ch. 2 | In | house (bridge ch 1) |

For each track: set **MIDI From** to the bus, pick the **channel** in the second dropdown, set **Monitor: In**, and **arm** the track (record-enable). Drop an instrument on each.

### 5. Sanity check

With the bridge running and pointed at the bus, fire test notes:

```bash
node examples/dist/chord-press.js ws://127.0.0.1:8765
```

An armed track shows incoming MIDI in its meter and plays its instrument. From the lens, two `ChordSender`s on channels 0 and 1 land on the Bass and Chords tracks respectively — the same single-bridge, single-connection setup as Option A, with Live doing the channel split.

## Suggested channel plan

A clean convention that maps onto a Logic/MainStage multi-instrument set or the bridge's `--route`:

| Channel | Role | Example source |
|---|---|---|
| 0 | Bass | ChordSender `acid` / `trance`, or PianoKeyboard |
| 1 | Chords/pads | ChordSender `house` |
| 9 | Drums | (future) DrumChannelMode |
| 2–8 | Lead / extra | PianoKeyboard, KeyboardChannelMode |

Pick channels per source, route them to instruments via Option A or B, and the lens stays a single connection regardless of how many grooves you layer.
