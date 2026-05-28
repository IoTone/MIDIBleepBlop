# Tester Lens UX

A richer Tester Lens that turns the Spectacles into an actual playable MIDI control surface — one panel per channel, three interaction modes, all built on SpectaclesUIKit and the library we've shipped so far.

## Scope

In scope for v1:

- **Per-channel panels** that can independently run one of three modes.
- **Keyboard mode** — text-input driven, Ableton key-map, monophonic. *Built first.*
- **Drum mode** — N tap pads per channel, each mapped to a configurable note. *Built second.*
- **Sequencer mode** — 16-step note sequence + N CC sliders (catalog-aware). *Built last (or deferred).*
- **Multi-channel concurrent** — different modes on different channels in the same lens scene.
- **SpectaclesUIKit** for all UI primitives.
- **Live editing** — all controls (octave, velocity, BPM, step toggles, CC sliders) can be changed while playing without restarting.

Out of scope (later):

- **Polyphonic keyboard input** — Lens Studio's text input is one-key-at-a-time; chords need a different input model.
- **Pinch/grab on rendered 3D piano keys** — possible future enhancement.
- **Pattern save/load** — current state lives only while the lens runs.
- **Tempo sync to external MIDI clock** — sequencer uses internal clock only.
- **Per-step note picker** — v1 sequencer plays one configured note on active steps; per-step notes is a v2.

## Background

### Ableton's computer-keyboard MIDI mode (the reference)

[Tutorial reference](https://sonicbloom.net/ableton-live-tutorial-computer-keyboard-as-midi-controller/). Mapping:

| Key | Maps to | Notes |
|---|---|---|
| `a` `s` `d` `f` `g` `h` `j` `k` `l` | C, D, E, F, G, A, B, C, D | Home row = white keys, A = C3 (= MIDI 60 in Ableton convention) |
| `w` `e` `t` `y` `u` `o` `p` | C#, D#, F#, G#, A#, C#, D# | Upper row = black keys |
| `z` | Octave − 1 | |
| `x` | Octave + 1 | |
| `c` | Velocity − 20 (clamp ≥ 1) | |
| `v` | Velocity + 20 (clamp ≤ 127) | |

### SpectaclesUIKit primitives we can build on

Confirmed available in `SpectaclesUIKit.lspkg`:

| Component | Use |
|---|---|
| `Frame` | Panel container with backplate / drop-shadow |
| `ScrollWindow` | Vertical scroll list (CC sliders) |
| `GridLayout` | Step grid, drum-pad grid |
| `RectangleButton` / `CapsuleButton` / `RoundButton` | Tap targets |
| `Slider` | CC value sliders |
| `Switch` / `Checkbox` | Step on/off, mode toggles |
| `RadioButton` / `ToggleGroup` / `SwitchToggleGroup` | Mode picker |
| `TextInputField` | Note number input, parameter-name input |
| `Tooltip` | Hover labels |

## Architecture

Each mode is its own **standalone `@component`** — no central manager. Users compose by adding the mode components they want and wiring per-component `channel` + `midi` + (optional) `device`. This matches how `MidiClientComponent` and `CCParam` are designed: composable, channel-scoped, no required orchestrator.

```
Scene
├── MidiClient (one)
├── DeviceCatalogComponent (one or more — different slugs per device)
│
├── KeyboardChannelMode  channel=0  (e.g. for melody synth)
├── DrumChannelMode      channel=9  (e.g. for drum machine)
├── SequencerChannelMode channel=1  device=<VolcaBass>  (e.g. for bass)
│
└── DiagnosticPanel (existing — receive-side visibility)
```

A user who wants the "control surface with multiple channel panels" arranges these in their scene however they like. There's no `TesterControlSurface` root component — the scene tree *is* the control surface.

### Where the scripts live

| Script | Lives in | Why |
|---|---|---|
| `KeyboardChannelMode` | **`lens/MidiBleepBop.lspkg/Scripts/`** | Generic enough to be useful in other lenses; ship with the library. |
| `DrumChannelMode` | **`lens/MidiBleepBop.lspkg/Scripts/`** | Same reasoning. |
| `SequencerChannelMode` | **`lens/MidiBleepBop.lspkg/Scripts/`** | Same reasoning. |
| `TesterControlSurface.prefab` (illustrative scene composition) | `lens/TesterLens/` | The example arrangement of those components; tester-specific. |

This is a shift from the original split — but the modes are useful enough as primitives that hiding them in TesterLens-only would underserve library users.

## Mode 1: Keyboard

The simplest mode. Built first.

### Inputs

```typescript
@component
export class KeyboardChannelMode extends BaseScriptComponent {
  @input midi: MidiClientComponent;
  @input channel: number = 0;

  @input
  @hint('Starting octave. Ableton convention: A on home row = C(octave). Default 3 = middle C.')
  startOctave: number = 3;

  @input
  @hint('Starting velocity, 1-127')
  startVelocity: number = 64;

  @input
  @hint('How long each tap holds the note before sending note-off, in ms')
  noteHoldMs: number = 200;

  // UI inputs
  @input openKeyboardButton: RectangleButton;
  @input statusText: Text;       // shows "Octave: 3  Vel: 64"
}
```

### Behaviour

- Tap `openKeyboardButton` → `global.textInputSystem.requestKeyboard(options)`.
- `onTextChanged(text)` fires on every virtual keypress. Diff `text` vs `previousText`:
  - For each new character at the end:
    - If a mapped letter → compute note, `client.sendNoteOn(...)`, schedule `client.sendNoteOff(...)` after `noteHoldMs`.
    - If `z` / `x` → adjust octave, update status text.
    - If `c` / `v` → adjust velocity, update status text.
    - Else → ignore.
- On keyboard close → flush any still-held notes (send note-offs).

### Limitations (called out so authors aren't surprised)

- **Monophonic.** One note per keystroke, no chord input. Lens Studio's text-input model doesn't expose key-up events, so we can't simulate held keys.
- **Latency.** Virtual-keyboard tap → onTextChanged → noteOn → bridge → IAC → DAW. Expect 20–80 ms perceived latency. Fine for testing, not for live performance.
- **One keyboard at a time.** If multiple `KeyboardChannelMode` components are in the scene, opening the keyboard binds to the *most recent* one. The component listens for `onKeyboardStateChanged` to know when it loses focus.

## Mode 1b: PianoKeyboard (rendered keys — preferred over the virtual keyboard)

The virtual-keyboard approach (Mode 1) is monophonic and clunky. `PianoKeyboard` instead **generates real interactable key meshes** at runtime inside a `ContainerFrame`. Press/release on each key maps to noteOn/noteOff, so it's polyphonic and sustained.

### What it builds per key (programmatically)

For each key in the range, `PianoKeyboard` creates a SceneObject with:

| Component | Created via | Purpose |
|---|---|---|
| `RenderMeshVisual` | `createComponent("Component.RenderMeshVisual")` | The visible key (scaled from a shared cube mesh) |
| `Physics.BodyComponent` | `createComponent("Physics.BodyComponent")`, `dynamic = false` | Static collider for SIK hit-testing (won't fall) |
| `Interactable` | `createComponent(Interactable.getTypeName())` | SIK interaction; gives `onTriggerStart` / `onTriggerEnd` |
| `InteractableManipulation` | `createComponent(InteractableManipulation.getTypeName())` | Present per spec; translation/rotation/scale disabled unless `keysMovable` |
| `InteractableOutlineFeedback` | `createComponent(...getTypeName())` | Highlight on hover/press (`targetOutlineMaterial`, `meshVisuals` set post-create) |
| `InteractableAudioFeedback` | optional | Key-down sound, only if `keyDownAudio` is wired |
| child `Component.Text` | `createComponent("Component.Text")` | 2D label ("C3", "F#3", …) on the key face |

Press → `onTriggerStart` → `client.sendNoteOn(channel, note, velocity)`.
Release → `onTriggerEnd` → `client.sendNoteOff(channel, note)`.

### Why this works at runtime

SIK feedback components read their `@input`s on `OnStartEvent` (inside their `init()`), **not** in `onAwake`. `PianoKeyboard` generates keys in *its* `onAwake` and assigns the feedback inputs synchronously — so by the time the feedback components' `OnStartEvent` fires, the values are already set. `InteractableOutlineFeedback`'s inputs (`targetOutlineMaterial`, `meshVisuals`) are public and assigned directly; `InteractableAudioFeedback`'s track inputs are private `@input`s, assigned through a cast.

### PianoKeyboard wiring (minimized)

The mesh is generated in code via `MeshBuilder`, and key colors are tinted from one optional material. **The only required wiring is `midi`.** Everything else is optional or auto-handled.

**Prerequisite:** the scene must have the **SpectaclesInteractionKit interaction setup** present (the SIK camera / hand-tracking / interactor rig). Without it, `Interactable`s receive no events. If your TestWand scene already responds to pinch/poke on other SIK buttons, you're set.

**Required:**

| `@input` | What to provide |
|---|---|
| `midi` | Your existing `MidiClient` SceneObject |

**Optional (all degrade gracefully if left empty):**

| `@input` | Effect if empty |
|---|---|
| `keyMaterial` | A material cloned + tinted per `whiteColor` / `blackColor`. If empty, keys render with the default material (tint may not apply, so white/black look the same). Recommended: wire any Unlit or PBR material. |
| `containerFrame` | Keys parent under this object instead. Wire a ContainerFrame if you want the whole keyboard grab-movable as a unit. |
| `outlineMaterial` | Outline hover/press feedback is skipped. Wire SIK's outline material to enable it. |
| `keyDownAudio` | No key-press sound. |
| `labelFont` | Labels use the default font. |

**Steps:**

1. Add a SceneObject with the **`PianoKeyboard`** script.
2. Wire `midi` → your `MidiClient`.
3. (Recommended) drop any material into `keyMaterial` so white/black tint applies.
4. Done — mesh, layout, and all per-key components are generated at runtime.

**Inspector settings (all have sensible defaults):**

| Field | Default |
|---|---|
| `channel` | `0` |
| `startNote` | `60` (C3) |
| `keyCount` | `13` (one octave, C→C) |
| `velocity` | `100` |
| `whiteColor` / `blackColor` | light grey / near-black |
| `whiteKeyWidth/Height/Depth` | `2.2 / 9.0 / 1.5` (cm) |
| `blackKeyWidth/Height/Depth` | `1.3 / 5.5 / 1.8` (cm) |
| `keysMovable` | `false` (so pressing a key doesn't drag it) |

**Tuning notes (will likely need on-device adjustment):**
- The 2D label scale/position (`text.size`, the child's local position/scale) is computed to counteract the key's mesh scale, but Text world-sizing is finicky — expect to nudge `text.size` and the label offset once you see it on glasses.
- Layout assumes the keyboard lies in the frame's X (horizontal) × Y (vertical) plane with black keys raised in +Y and forward in +Z. If your frame faces the wearer differently, adjust the `y`/`z` computation in `makeKey`.

## Mode 2: Drum

Built second.

### Inputs

```typescript
@component
export class DrumChannelMode extends BaseScriptComponent {
  @input midi: MidiClientComponent;
  @input channel: number = 9;          // GM drum channel by convention

  @input
  @hint('Number of pads to render (1-8)')
  padCount: number = 4;

  @input
  @hint('Default velocity sent on tap')
  velocity: number = 100;

  @input
  @hint('How long each tap holds before note-off, in ms (drums usually short)')
  noteHoldMs: number = 100;

  // Per-pad notes (LS @input arrays are awkward; expose 8 fields, ignore those beyond padCount).
  // Defaults follow General MIDI percussion: 36 kick, 38 snare, 42 closed hat, 46 open hat,
  // 49 crash, 51 ride, 50 hi tom, 47 mid tom.
  @input note0: number = 36;
  @input note1: number = 38;
  @input note2: number = 42;
  @input note3: number = 46;
  @input note4: number = 49;
  @input note5: number = 51;
  @input note6: number = 50;
  @input note7: number = 47;

  // Optional per-pad labels (else "Pad 0", "Pad 1", …)
  @input label0: string = 'Kick';
  @input label1: string = 'Snare';
  @input label2: string = 'CH';
  @input label3: string = 'OH';
  @input label4: string = 'Crash';
  @input label5: string = 'Ride';
  @input label6: string = 'Hi Tom';
  @input label7: string = 'Mid Tom';

  // UI inputs
  @input padContainer: SceneObject;    // GridLayout placement target
  @input padPrefab: ObjectPrefab;      // RectangleButton-based pad template
}
```

### Behaviour

- On awake, instantiate `padCount` copies of `padPrefab` into `padContainer` via `GridLayout`.
- Each pad's button fires its mapped note on tap (noteOn → schedule noteOff at `noteHoldMs`).
- Tap visual: pad scales up briefly (~80 ms) or flashes via `Visual.color` swap.

### Why per-pad `@input` fields rather than an array

LS inspector handles simple scalar inputs well, array-shaped inputs poorly. 8 numbered fields is more verbose but immediately discoverable in the inspector. Limit is 8 in v1; if more needed, that's a future v2 with a different input model.

## Mode 3: Sequencer

Built last. Most complex.

### Inputs

```typescript
@component
export class SequencerChannelMode extends BaseScriptComponent {
  @input midi: MidiClientComponent;
  @input channel: number = 0;

  @input
  @hint('Optional device catalog for CC mixer auto-population')
  device: DeviceCatalogComponent | null = null;

  // Sequencer config
  @input bpm: number = 120;
  @input
  @hint('16 steps fixed in v1. Note played on active steps.')
  baseNote: number = 60;
  @input baseVelocity: number = 100;
  @input
  @hint('0 = straight 16ths, 100 = full triplet swing')
  swing: number = 0;

  // CC mixer: list of (controller-or-parameterName) to expose as sliders.
  // Semicolon-separated; "name" matches device.catalog.byName(); numeric = raw CC.
  // Example: "Cutoff;Resonance;LFO rate" or "74;71;1"
  @input
  @hint('Semicolon-separated parameter names or CC numbers. If device wired, names resolve via catalog.')
  ccs: string = '';

  // UI inputs
  @input stepGrid: SceneObject;        // GridLayout(8x2) populated with toggle buttons
  @input stepButtonPrefab: ObjectPrefab;
  @input playButton: RectangleButton;
  @input ccSliderContainer: SceneObject;  // ScrollWindow content; populated with sliders
  @input sliderPrefab: ObjectPrefab;
}
```

### Behaviour

- Steps stored in `private steps: boolean[16]`; mutated on toggle-button tap.
- On `playButton` toggle: enable / disable an `UpdateEvent` that advances the step at `bpm`.
- Each tick: if `steps[i]`, send noteOn(baseNote, baseVelocity, channel); schedule noteOff at end of step (or just before next step).
- Swing: even-index steps fire on time; odd-index steps fire at `(stepDurationMs * (1 + swing/200))` offset from the previous even step.
- CC mixer: parse `ccs` string at start. For each entry:
  - If numeric → use as raw CC.
  - Else if device wired → resolve via `device.catalog.cc(entry)`.
  - Else → skip + log.
- For each resolved CC, instantiate a slider; on slider change, throttled `client.sendCC(channel, cc, value)`.

### Live editability

All inputs are read each tick (not just on awake):
- `bpm` change → next tick recalculates interval.
- `baseNote` / `baseVelocity` change → next noteOn picks up the new value.
- Step toggles read live state.
- CC sliders push immediately on user interaction (throttled).

The `ccs` string is parsed once on awake — changing it requires restarting the lens preview. Documented limitation; v2 could watch for changes.

## Build order

| # | Mode | Estimated effort | Demo bar |
|---|---|---|---|
| 1 | Keyboard | Small (~1 component, text input integration, key-map table) | "Open keyboard, tap A → C plays through GarageBand" |
| 2 | Drum | Medium (~1 component + pad prefab + GridLayout instantiation) | "Tap 8 pads → kick/snare/etc. fire in GarageBand" |
| 3 | Sequencer | Large (~1 component + internal clock + step grid + CC sliders + catalog wiring) | "Toggle steps, hit play, hear C major arpeggio; move cutoff slider while playing" |

The first slice (Keyboard) doesn't need any prefab work — just two `@input`s (a button and a text field) the user wires in the inspector. Easy to verify end-to-end before any UIKit prefab investment.

## Concrete TS sketches

### Key map (Mode 1)

```typescript
// Maps an Ableton-convention letter to a semitone offset above C.
// Returns undefined for unmapped letters; the caller handles z/x/c/v separately.
function offsetForKey(ch: string): number | undefined {
  switch (ch.toLowerCase()) {
    // home row — naturals
    case 'a': return 0;    // C
    case 's': return 2;    // D
    case 'd': return 4;    // E
    case 'f': return 5;    // F
    case 'g': return 7;    // G
    case 'h': return 9;    // A
    case 'j': return 11;   // B
    case 'k': return 12;   // C (octave + 1)
    case 'l': return 14;   // D (octave + 1)
    // upper row — sharps
    case 'w': return 1;    // C#
    case 'e': return 3;    // D#
    case 't': return 6;    // F#
    case 'y': return 8;    // G#
    case 'u': return 10;   // A#
    case 'o': return 13;   // C# (octave + 1)
    case 'p': return 15;   // D# (octave + 1)
    default: return undefined;
  }
}
```

### Octave / velocity logic (Mode 1)

```typescript
private octave = this.startOctave;  // 3 = middle (A → C3 = MIDI 60)
private velocity = this.startVelocity;

private handleChar(ch: string): void {
  const c = ch.toLowerCase();
  if (c === 'z') { this.octave--; this.refreshStatus(); return; }
  if (c === 'x') { this.octave++; this.refreshStatus(); return; }
  if (c === 'c') { this.velocity = Math.max(1,   this.velocity - 20); this.refreshStatus(); return; }
  if (c === 'v') { this.velocity = Math.min(127, this.velocity + 20); this.refreshStatus(); return; }

  const offset = offsetForKey(c);
  if (offset === undefined) return;
  const note = this.octave * 12 + offset;  // C3 = octave 3 * 12 = 36... wait
  // Ableton's C3 = MIDI 60. C(octave=N) = (N+2) * 12. So note = (octave + 2) * 12 + offset.
  // We absorb the +2 by exposing `startOctave: 3` meaning "Ableton C3", and internally
  // computing midi note as ((octave + 2) * 12) + offset, clamped to [0, 127].
  this.midi.client?.sendNoteOn(this.channel, midiNote, this.velocity);
  this.scheduleNoteOff(midiNote);
}
```

Note: Ableton octave-naming offsets MIDI by 2 (C3 = 60, not 48). Documented as a footnote in the code.

## Open questions

| Question | Recommendation |
|---|---|
| Modes ship in lspkg or TesterLens-only? | **lspkg.** Reusable in other lenses. |
| Keyboard hold time | **200 ms default, configurable.** Long enough to register, short enough not to block fast playing. |
| Velocity step | **±20, Ableton-default.** No reason to differ. |
| Drum pad count | **4 default, up to 8.** Most kits I've seen on Volca-style hardware sit at 4–8. |
| Per-pad notes in inspector | **8 numbered fields.** Discoverable; awkward for >8 but that's not v1. |
| Sequencer pattern length | **Fixed 16 in v1.** Variable length is a v2. |
| Live editability of `ccs` string | **Parse once at awake, document.** Watching for inspector changes mid-play is overkill. |
| Bring SpectaclesUIKit into the lens | Add `SpectaclesUIKit.lspkg` to the lens's `Packages/` (copy from SkywriterBLE or import via Asset Library). |

## What this requires / does not

Requires:
- SpectaclesUIKit available in the lens's `Packages/` (one-time copy from SkywriterBLE or Asset Library install).
- New `@component` files added to `lens/MidiBleepBop.lspkg/Scripts/`.
- Lens bundle unchanged (these components don't bundle; they ship as `@component` files alongside the bundle).

Does not require:
- Bridge changes.
- Wire protocol changes.
- Core library changes (modes use existing `MidiClientComponent`, `CCParam`, `DeviceCatalogComponent`, `MidiClient.sendNoteOn` / `sendCC`).
- Catalog data changes (Volca catalog already shipped).

## What this enables

For the **author**: drop one component per channel in a Lens Studio scene, hit play, drive a real synth/DAW. No code needed past wiring `@input` slots.

For the **demo**: a single Spectacles lens that lets the wearer play melody on Channel 0 (keyboard), drums on Channel 9 (pads), and a bass sequence on Channel 1 (sequencer with Volca Bass CCs exposed as sliders) — all simultaneously, all changeable live.

For the **library**: a real on-glasses control surface validates the full stack end-to-end in a way the diagnostic lens can't.

## Recommendation

Start with **Mode 1 (Keyboard)**. It's the smallest slice that delivers a complete "play music with your face on" experience and proves the SpectaclesUIKit integration path. The wire-up is two `@input`s (a button and a status text) — no prefab work needed.

Once Keyboard is verified in your lens, Drum is a natural next step because the pad prefab work is the SpectaclesUIKit pattern we'll repeat for the Sequencer. Sequencer last because the clocking and live-edit story benefits from having confidence in the pad prefab pattern first.
