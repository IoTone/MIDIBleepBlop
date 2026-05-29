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

## Suggested channel plan

A clean convention that maps onto a Logic/MainStage multi-instrument set or the bridge's `--route`:

| Channel | Role | Example source |
|---|---|---|
| 0 | Bass | ChordSender `acid` / `trance`, or PianoKeyboard |
| 1 | Chords/pads | ChordSender `house` |
| 9 | Drums | (future) DrumChannelMode |
| 2–8 | Lead / extra | PianoKeyboard, KeyboardChannelMode |

Pick channels per source, route them to instruments via Option A or B, and the lens stays a single connection regardless of how many grooves you layer.
