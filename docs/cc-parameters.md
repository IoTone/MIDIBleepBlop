# CC Parameters

How a lens developer exposes a specific MIDI Control Change (CC) on a specific channel as a typed, scaled, smoothed parameter that drives a visual — without writing event-handler boilerplate.

## Scope

In scope for v1 of CC parameters:

- **Lens-side ergonomics for reading CCs.** Declarative binding of `(channel, controller)` to a scene property or to a typed parameter another script consumes.
- **Lens-side ergonomics for sending CCs.** Throttled, deduplicated `setValue` from anywhere in the scene.
- **Discovery.** Programmatic enumeration of CCs that have arrived on a channel.
- **Named constants.** Replace magic numbers (`cc=1`) with `CC.MOD_WHEEL`.

Explicitly out of scope (v2 candidates):

- **14-bit CC** (MSB + LSB pairing for high-resolution controllers). Doable inside the existing API surface as `CCParam14` later.
- **RPN / NRPN** (Registered / Non-Registered Parameter Numbers). Niche; deferred.
- **MIDI Polyphonic Expression (MPE) CC behaviour.** MPE has channel-rotation semantics that complicate per-channel CC binding; out of scope.
- **CC recording / playback as part of MIDI files** — covered separately in `midi-files.md`.

## Current state

The plumbing for *handling* CCs is mostly there in `packages/core`:

| Already shipped | Where |
|---|---|
| Receive event per CC: `client.on('cc', m => ...)` | `MidiClient` |
| Change-only observation: `client.onCCChange(ch, cc, h)` | `MidiClient` |
| Current value query: `client.ccValue(ch, cc)` | `MidiClient` |
| Per-channel state tracking | `MidiState` |
| Send: `client.sendCC(ch, cc, value)` | `MidiClient` |
| Diagnostic readout of latest CC | Tester Lens `DiagnosticPanel` |

What's missing for an ergonomic "expose a CC parameter" experience:

1. **Discovery.** The lens doesn't know which CCs to watch unless hand-coded.
2. **Declarative binding.** Currently requires writing an event handler to drive a visual.
3. **Value scaling.** CC is 0–127 raw; visuals want 0.0–1.0 or a custom range.
4. **Smoothing.** Hardware controllers jitter; raw values produce twitchy visuals.
5. **Named constants.** Magic numbers in lens code obscure intent.
6. **Send-side throttling.** Sending one CC per animation frame floods the bridge with redundant writes.

## Architecture

Three layers, each independently useful and shippable:

```
┌─────────────────────────────────────────────┐
│ Layer 1: core (pure TS)                     │
│   - CC named constants                      │
│   - MidiClient.observedCCs(channel)         │
│   - 14-bit pairing helper (v2)              │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│ Layer 2: lens RECEIVE bindings (.lspkg)     │
│   - CCParam       (the typed handle)        │
│   - CCBindToProperty (declarative wiring)   │
│   - CCDashboard   (diagnostic readout)      │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ Layer 3: lens SEND ergonomics (.lspkg)      │
│   - CCSender      (throttled setValue API)  │
└─────────────────────────────────────────────┘
```

Layer 1 is pure-TS and fully testable in vitest with `MockTransport`. Layers 2 and 3 are `@component` wrappers around the existing `MidiClient` API — no changes needed to the wire protocol, bridge, or transport.

## API sketches

### Layer 1 — Core additions

```typescript
// packages/core/src/cc-constants.ts
export const CC = {
  BANK_SELECT_MSB:  0,
  MOD_WHEEL:        1,
  BREATH:           2,
  FOOT:             4,
  PORTAMENTO_TIME:  5,
  DATA_ENTRY_MSB:   6,
  VOLUME:           7,
  BALANCE:          8,
  PAN:             10,
  EXPRESSION:      11,
  EFFECT_1:        12,
  EFFECT_2:        13,
  GENERAL_PURPOSE_1: 16,
  GENERAL_PURPOSE_2: 17,
  GENERAL_PURPOSE_3: 18,
  GENERAL_PURPOSE_4: 19,

  SUSTAIN_PEDAL:   64,
  PORTAMENTO:      65,
  SOSTENUTO:       66,
  SOFT_PEDAL:      67,
  LEGATO:          68,
  HOLD_2:          69,

  // Sound controllers — synth params, common targets for assignment
  SOUND_VARIATION: 70,
  RESONANCE:       71,
  RELEASE_TIME:    72,
  ATTACK_TIME:     73,
  FILTER_CUTOFF:   74,

  ALL_SOUND_OFF:   120,
  RESET_ALL_CONTROLLERS: 121,
  LOCAL_CONTROL:   122,
  ALL_NOTES_OFF:   123,
} as const;
```

```typescript
// MidiClient — new method
class MidiClient {
  // ... existing API ...

  /** Returns the controller numbers (0-127) that have been seen on this channel. */
  observedCCs(channel: number): number[];

  /** Fires whenever any CC value on the channel changes (including first sight). */
  onAnyCCChange(
    channel: number,
    handler: (controller: number, value: number, previous: number | undefined) => void,
  ): Unsubscribe;
}
```

Both are additive; existing `onCCChange(ch, cc, h)` continues to work.

### Layer 2 — Lens receive bindings

```typescript
// CCParam.ts — a typed handle to a single (channel, controller).
@component
export class CCParam extends BaseScriptComponent {
  @input midi: MidiClientComponent;

  @input
  @hint('MIDI channel (0-15)')
  channel: number = 0;

  @input
  @hint('CC number (0-127). Common: 1=ModWheel, 7=Volume, 11=Expression, 74=FilterCutoff.')
  controller: number = 1;

  // Range mapping
  @input inputMin:  number = 0;
  @input inputMax:  number = 127;
  @input outputMin: number = 0;
  @input outputMax: number = 1;

  // Smoothing: 0 = instant (raw), 0.9 = heavy exponential moving average.
  @input
  @hint('Exponential moving average factor. 0 = no smoothing, ~0.9 = very smooth (laggy).')
  smoothingFactor: number = 0;

  /** Raw current value, 0-127. Returns inputMin when no CC has been received yet. */
  current(): number;

  /** Smoothed + mapped value (outputMin..outputMax). */
  scaled(): number;

  /** Observable change. `mapped` is the scaled+smoothed value, `raw` is 0-127. */
  onChange(handler: (mapped: number, raw: number) => void): Unsubscribe;
}
```

```typescript
// CCBindToProperty.ts — declarative "wire CC to a SceneObject property".
// Lets a developer add a visual binding with zero TypeScript.
@component
export class CCBindToProperty extends BaseScriptComponent {
  @input source: CCParam;
  @input target: SceneObject;

  @input
  @hint('What to drive. Supported: scale-uniform | scale-x | scale-y | scale-z | ' +
        'position-x | position-y | position-z | rotation-x | rotation-y | rotation-z')
  property: string = 'scale-uniform';

  // Baseline applied when CC = inputMin; the scaled value is added on top.
  @input baseValue: number = 1.0;
}
```

```typescript
// CCDashboard.ts — diagnostic: show every observed CC on a channel.
//   ch0  cc1=64  cc11=120  cc74=42
@component
export class CCDashboard extends BaseScriptComponent {
  @input midi: MidiClientComponent;
  @input channel: number = 0;
  @input output: Text;

  @input
  @hint('Maximum number of CCs to show (most-recently-touched first)')
  maxRows: number = 8;
}
```

### Layer 3 — Lens send ergonomics

```typescript
// CCSender.ts — converts numeric inputs into CC traffic, throttled.
@component
export class CCSender extends BaseScriptComponent {
  @input midi: MidiClientComponent;
  @input channel: number = 0;
  @input controller: number = 1;

  @input
  @hint('Minimum ms between sent CCs. Hardware controllers send ~50/sec at full tilt.')
  minIntervalMs: number = 20;

  @input
  @hint('Drop the send if the value is unchanged since the last sent CC')
  dedupe: boolean = true;

  /** Push a value; clamped to 0-127, throttled, deduped. */
  setValue(value: number): void;

  /** Convenience: accepts a 0.0-1.0 input and maps to 0-127. */
  setNormalised(value: number): void;
}
```

## Why each layer is the right primitive

| Layer / piece | Why it earns its place |
|---|---|
| `CC.*` constants | Replaces magic numbers in lens code; cheap; standard across the MIDI ecosystem. |
| `observedCCs(channel)` | Lets a developer answer "what's my DAW sending?" without exhaustively writing observers for all 128 controllers. |
| `CCParam` | Isolates the per-CC concerns (channel, controller, scaling, smoothing) in one inspector unit. Other scripts depend on `CCParam`, not on `MidiClient` directly. |
| `CCBindToProperty` | The zero-script path. Common case is "make this thing move with this knob"; no reason to write a handler. |
| `CCSender` | The mirror of `CCParam` for the send direction. Other scripts that *compute* CC values (a gesture, an animation curve) shouldn't care about throttling. |
| `CCDashboard` | Empirical discovery during dev — saves explaining "I don't see anything because the source sends on cc 71, not 1." |

## Build order

Each step is independently shippable and demonstrable through the Tester Lens.

| # | Deliverable | Where | Demo / verification |
|---|---|---|---|
| 1 | `CC.*` constants + `observedCCs(ch)` + `onAnyCCChange` | `packages/core` + vitest tests | Existing `DiagnosticPanel` gains a "observed CCs" line |
| 2 | `CCParam` | `lens/MidiBleepBop.lspkg/Scripts/` | Tester Lens scene shows `CCParam.scaled()` as a Text |
| 3 | `CCBindToProperty` | same | Tester Lens cube grows with the modwheel — zero script |
| 4 | `CCSender` | same | Tester Lens example that drives a CC from an in-lens slider / gesture |
| 5 | `CCDashboard` | same | Replace part of `DiagnosticPanel` with the new component |

Step 1 lands first because it's small, fully unit-testable, and gives every later step better ergonomics. Steps 2–3 are the biggest UX win and should land together. Steps 4–5 are nice-to-haves.

## Decisions to confirm before code

| Question | Recommendation | Why |
|---|---|---|
| Default scaling output range | **0.0–1.0** | Matches what visual properties typically consume; one less thing to set in the common case. |
| Smoothing primitive | **Exponential moving average, one factor** | Predictable, one knob, intuitive. Pluggable smoothers are over-design at this stage. |
| `CCBindToProperty.property` representation | **String enum** (`"scale-uniform"`, `"position-y"`, …) | Matches LS inspector affordances (string fields are easy); avoids a structured input that LS can't display nicely. |
| 14-bit CC | **Defer to v2** | ~5% of devs need it; adds 14-bit pair tracking to core state, can ship cleanly later as `CCParam14` without breaking v1. |
| Mapping behaviour | **Clamp output to `[outputMin, outputMax]`** | Predictable; users can extrapolate by setting `inputMax > 127` if they want. |
| Smoothing applied | **In `CCParam`** | Single point of smoothing; downstream consumers always see smoothed values. Bypass with `current()`. |

## Testing strategy

- **Layer 1** — full vitest suite covering: constants exported, `observedCCs` returns sorted unique list, `onAnyCCChange` fires once per real change.
- **Layer 2 `CCParam`** — most of the math (scaling, EMA) lives in a plain helper that's unit-tested in core; the `@component` is a thin wrapper. The wrapper is verified by hand in the Tester Lens.
- **Layer 2 `CCBindToProperty`** — visual; verified by hand. No automated test (would need a Lens Studio harness we don't have).
- **Layer 3 `CCSender`** — throttle / dedupe logic extracted into a pure function in core, unit-tested. `@component` is a thin wrapper.

The pattern is the same as everywhere else in the repo: keep logic in pure TS, keep `@component` wrappers thin.

## What this does *not* require

- No changes to the WebSocket wire protocol.
- No changes to the bridge.
- No changes to existing `MidiClient` send/receive surface (all additions are additive).
- No changes to `transport-spectacles-ws` or `transport-node`.
- No new dependencies.

All net-new code lives in `packages/core` (Layer 1) and `lens/MidiBleepBop.lspkg/Scripts/` (Layers 2 + 3). The bundle script (`scripts/build-lens.mjs`) picks up the new core files automatically.

## What this *enables*

A workflow that makes the lens an instrument:

1. Author drops a `MidiClient` into the scene (already done).
2. Drops a `CCParam`, sets channel + controller (e.g., modwheel on ch0).
3. Drops a `CCBindToProperty`, points it at the cube, picks `scale-uniform`.
4. Hits play. Turning the modwheel on their controller (which arrives via the bridge) makes the cube grow.

Total scripting: zero.

For the send direction:

1. Author wires a `CCSender` to a gesture or animation curve in their own script.
2. Calls `ccSender.setNormalised(handAngle)` from an update loop.
3. GarageBand's modwheel sweeps as their hand moves.

Total scripting: one `setNormalised` call.

That's the bar: "this should be as easy as touching a knob."
