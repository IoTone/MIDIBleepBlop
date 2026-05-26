# Device Catalog

How a lens author gets per-device knowledge — "what CCs does my NTS-1 actually respond to, what do they mean, what are their valid ranges?" — wired into the library so they can author correctly without memorizing the device manual.

## Scope

In scope for v1:

- **Per-device CC catalogs** sourced from the community-maintained [pencilresearch/midi](https://github.com/pencilresearch/midi) repository.
- **Runtime API** for looking up parameters by CC number or by name.
- **Validation helpers** — "does CC 99 do anything on this device?" answerable at dev time.
- **Lens integration** so a `CCParam` can be bound by parameter name instead of CC number.
- **Opt-in packaging** — lens authors choose which devices to bundle into their `.lspkg`.

Explicitly out of scope (v2+ candidates):

- **NRPN support.** The catalog data includes NRPN columns; we preserve them in JSON but the library doesn't act on them.
- **Sysex parameter dumps.** Some devices expose deep parameters only via sysex; out of scope.
- **`usage` field structured parsing.** The `usage` column is free-text ("`0: Off; 1: On`", "`0: ADSR; 25: AHR; 50: AR`"); v1 stores it raw. Future versions can layer typed enum parsers.
- **Automatic catalog updates from upstream.** Refreshing is a manual `npm run refresh-catalog` step, not a CI loop.
- **User-contributed catalog additions inside this repo.** Contributions belong upstream at pencilresearch/midi.

## Data source

[pencilresearch/midi](https://github.com/pencilresearch/midi) is a community-curated database of MIDI CC and NRPN implementations across ~70 manufacturers (KORG, Moog, Arturia, Behringer, Roland, Elektron, …) and growing.

### Schema (per `template.csv`)

```
manufacturer, device, section, parameter_name, parameter_description,
cc_msb, cc_lsb, cc_min_value, cc_max_value, cc_default_value,
nrpn_msb, nrpn_lsb, nrpn_min_value, nrpn_max_value, nrpn_default_value,
orientation, notes, usage
```

Real samples:

```csv
KORG,NTS-1,Envelope Generator,Type,Selects the amplitude EG type,14,,0,127,,,,,,0-based,,0: ADSR; 25: AHR; 50: AR; 75: AR loop; 127: Open
KORG,NTS-1,Tremolo,Depth,,20,,0,127,,,,,,0-based,,
Moog,Matriarch,,MOD Wheel,,1,,0,127,,,,,,0-based,,
Moog,Matriarch,,Glide Time,,5,,0,127,,,,,,0-based,,
Lofty,Trundler,Amp,Pan,Pans between left to right channel,66,,0,127,64,1,3,0,16383,8192,centered,Left..Centered..Right,0~127: Pan amount
```

Notable fields:
- `section` groups parameters (Oscillator, Filter, Envelope Generator, …).
- `orientation` is `0-based` (sliders 0→max) or `centered` (knobs −half→+half) — matters for visualizations.
- `cc_default_value` is the "neutral" position; often empty when not meaningful.
- `usage` is rich free-text describing value semantics; we keep it raw.

### License

Data is **CC-BY-SA-4.0** (Creative Commons Attribution-ShareAlike 4.0). Including it in our distribution requires:
- Attribution to pencilresearch/midi maintainers (`THIRD-PARTY-NOTICES.md`).
- Share-alike: derivative datasets (our JSON-encoded form) are also CC-BY-SA-4.0.

This is compatible with most code licenses — the *data files* are under CC-BY-SA, the *library code* using them is under the project's existing license.

## Current state

The library currently has:

| Already shipped | Where |
|---|---|
| Generic CC sending/receiving | `MidiClient` |
| Named standard CCs (`CC.MOD_WHEEL`, `CC.FILTER_CUTOFF`, …) | `packages/core/src/cc-constants.ts` |
| `CCParam` for binding a single CC to a typed handle | `lens/MidiBleepBop.lspkg/Scripts/CCParam.ts` |
| Per-channel CC discovery (`observedCCs`, `onAnyCCChange`) | `MidiClient` |

What's missing for "set up a device correctly":

1. **Device awareness.** The library doesn't know the difference between sending CC 71 to a Korg NTS-1 (= Resonance) vs to a Moog Matriarch (= different function).
2. **Validation.** No way to say "this device doesn't respond to CC 99 at all" — silent failure today.
3. **Discovery by intent.** Authors have to look up "what's the CC for Filter Cutoff on my synth?" in the manual.
4. **Default values.** When a session starts, what CCs should be initialized to what?
5. **Range semantics.** Many parameters have non-default ranges (e.g., a switch is effectively 0/127, a centered knob's "neutral" is 64).

## Architecture

Three layers, each independently shippable. Parallel to the `midi-files.md` and `cc-parameters.md` patterns.

```
┌─────────────────────────────────────────────────────────┐
│ Layer A: Data pipeline (build-time)                     │
│   - vendor pencilresearch/midi CSVs                     │
│   - scripts/build-catalog.mjs: CSV → JSON normalization │
│   - per-device JSON files (Korg-NTS-1.json, ...)        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Layer B: Runtime API (packages/catalog, pure TS)        │
│   - Parameter / Device types                            │
│   - DeviceCatalog class (lookup / validate / enumerate) │
│   - Unit-tested in vitest                               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Layer C: Lens integration (.lspkg)                      │
│   - DeviceCatalogComponent (wraps a Device JSON asset)  │
│   - CCParam.parameterName (resolves via catalog)        │
│   - CCDashboard humanized labels                        │
│   - Optional dev-mode CC validation                     │
└─────────────────────────────────────────────────────────┘
```

Layer A is tooling. Layer B is pure TS, fully testable in vitest. Layer C is `@component` wrappers — thin glue.

## Repository layout

```
midi-bleep-bop/
├── vendor/
│   └── pencilresearch-midi/        ← snapshot of upstream CSVs
├── packages/
│   └── catalog/
│       ├── devices/                ← generated, committed JSON (one per device)
│       │   ├── Korg-NTS-1.json
│       │   ├── Moog-Matriarch.json
│       │   └── ...
│       ├── src/
│       │   ├── types.ts            ← Parameter, Device interfaces
│       │   ├── catalog.ts          ← DeviceCatalog class
│       │   └── index.ts
│       ├── test/
│       └── package.json
├── scripts/
│   ├── build-catalog.mjs           ← CSV → JSON converter
│   └── refresh-catalog.mjs         ← pulls upstream into vendor/
├── THIRD-PARTY-NOTICES.md          ← CC-BY-SA-4.0 attribution
└── lens/MidiBleepBop.lspkg/
    └── Scripts/
        └── DeviceCatalogComponent.ts (new in Layer C)
```

`packages/catalog` is **separate from `packages/core`**: a lens author who doesn't care about device specifics never pulls in catalog code or data.

## API sketches

### Layer A — Build pipeline

`scripts/build-catalog.mjs`:

- Walks `vendor/pencilresearch-midi/<Manufacturer>/<Device>.csv`.
- Parses each CSV with a forgiving reader (handles empty cells, quoted strings, the occasional encoding quirk).
- Normalizes each row to a `Parameter` JSON object:
  - Empty cells → `null` (never `""`).
  - Numeric strings → numbers; failure to parse → `null`.
  - `orientation` validated against `'0-based' | 'centered'`; fallback to `'0-based'`.
  - `usage` and `notes` kept as raw strings or `null`.
  - NRPN columns preserved as a nested `nrpn` object or `null`.
- Emits one JSON file per device into `packages/catalog/devices/`.
- Generates `packages/catalog/devices/index.json` listing every device with its slug + filename.

The JSON files are **committed**, not regenerated at install time. This avoids a build dependency on a CSV parser at consumer install time and lets contributors review catalog diffs in PRs.

### Layer B — Runtime API

```typescript
// packages/catalog/src/types.ts

export type Orientation = '0-based' | 'centered';

export interface Parameter {
  section: string | null;
  name: string;
  description: string | null;
  cc: number | null;                              // cc_msb
  ccRange: { min: number; max: number };          // defaults to {0, 127} if missing
  ccDefault: number | null;
  orientation: Orientation;
  usage: string | null;                           // raw free-text
  notes: string | null;
  /** Preserved for v2 NRPN support; library doesn't act on this in v1. */
  nrpn: {
    msb: number;
    lsb: number;
    range: { min: number; max: number };
    default: number | null;
  } | null;
}

export interface Device {
  manufacturer: string;       // "KORG"
  device: string;             // "NTS-1"
  slug: string;               // "korg-nts-1"  (lowercase, hyphenated, filesystem-safe)
  parameters: Parameter[];
}
```

```typescript
// packages/catalog/src/catalog.ts

export class DeviceCatalog {
  constructor(public readonly device: Device);

  /** Look up by CC number. Returns the first matching parameter (or undefined). */
  byCC(cc: number): Parameter | undefined;

  /** Look up by parameter name. Case-insensitive; whitespace-tolerant. */
  byName(name: string): Parameter | undefined;

  /** Convenience: returns the CC number for a named parameter (or undefined). */
  cc(name: string): number | undefined;

  /** Distinct section names, sorted. */
  sections(): string[];

  /** Parameters in a section, or all parameters if section is omitted. */
  parameters(section?: string): Parameter[];

  /** True if at least one parameter on this device maps to `cc`. */
  isKnownCC(cc: number): boolean;

  /** True if `value` is within the CC's documented range. */
  inRange(cc: number, value: number): boolean;
}
```

Both `byCC` and `byName` are O(1) lookups (built from index Maps on construction).

### Layer C — Lens integration

**Loading note (revised during Layer C implementation).** Lens Studio does **not** expose `Asset.TextAsset` or any equivalent for reading static text files at runtime — the only string-asset-like APIs (`RemoteMediaModule.loadResourceAsString`) require a `DynamicResource` from a URL fetch or Blob, not an embedded project file. So instead of importing a JSON asset, the catalog data is **bundled into the lens as TypeScript constants** via an auto-generated `Devices.ts`. The `DeviceCatalogComponent` picks a device by slug.

```typescript
// Auto-generated by scripts/build-catalog.mjs:
// lens/MidiBleepBop.lspkg/Scripts/Devices.ts
import type { Device } from './MidiBleepBop';
export const DEVICES: Record<string, Device> = {
  "korg-volca-bass": { /* ... */ },
  "korg-volca-beats": { /* ... */ },
  // ...
};
export const DEVICE_SLUGS: string[] = Object.keys(DEVICES).sort();
```

```typescript
// lens/MidiBleepBop.lspkg/Scripts/DeviceCatalogComponent.ts

@component
export class DeviceCatalogComponent extends BaseScriptComponent {
  @input
  @hint('Device slug. Available slugs are listed in Devices.ts (DEVICE_SLUGS).')
  deviceSlug: string = 'korg-volca-bass';

  catalog: DeviceCatalog | null = null;

  onAwake() {
    const data = DEVICES[this.deviceSlug];
    if (data) this.catalog = new DeviceCatalog(data);
  }
}
```

Trade-off: every device in the bundled `Devices.ts` ships with the lens whether referenced or not. For the v1 Volca set (8 devices, ~40KB) this is negligible. Users who want to slim down can hand-edit `Devices.ts` and delete unused entries — the file is auto-generated but not auto-loaded, so manual edits survive until the next `npm run build:catalog`.

`CCParam` gains two optional inputs:

```typescript
@component
export class CCParam extends BaseScriptComponent {
  @input midi: MidiClientComponent;

  @input
  @hint('Optional. If wired, parameterName resolves the CC number via the catalog.')
  device: DeviceCatalogComponent | null = null;

  @input channel: number = 0;

  // Either explicit:
  @input controller: number = 1;

  // ...or named (takes precedence when device is wired and parameterName resolves):
  @input parameterName: string = '';

  // ... existing range / smoothing fields ...

  /** The CC number actually bound (after parameterName resolution). */
  readonly resolvedCC: number;
}
```

Resolution order at runtime:
1. If `device` is wired, `device.catalog` is loaded, AND `parameterName` non-empty → look up via `catalog.cc(parameterName)`.
2. If lookup succeeds → use that CC.
3. If lookup fails OR any condition above is false → fall back to `controller`. Logs to `print()` in dev so the author sees mismatches.

`CCDashboard` (when shipped, per `cc-parameters.md`) shows humanized names if a catalog is wired.

Optional dev-mode validation lives in `MidiClient` as a method, not the default path:

```typescript
client.validateAgainst(catalog).onIssue((issue) => print(issue));
// issue: { kind: 'unknown-cc', cc: 99, channel: 0 }
//        { kind: 'out-of-range', cc: 7, value: 200, channel: 0 }
```

Off by default; intended for development.

## Phased build order

| # | Step | Where | Status |
|---|---|---|---|
| 1 | Vendor pencilresearch/midi CSVs + `build-catalog.mjs` | `vendor/`, `scripts/` | ✅ Shipped — KORG Volca line (8 devices, 122 parameters) |
| 2 | `Parameter`, `Device`, `DeviceCatalog` + vitest suite | `packages/catalog` | ✅ Shipped — 25 tests |
| 3 | Lens bundle updated to include catalog types | `scripts/build-lens.mjs` | ✅ Shipped — `DeviceCatalog` available in `MidiBleepBop.ts` |
| 3b | Auto-generated `Devices.ts` map (replaces TextAsset path) | `scripts/build-catalog.mjs` | ✅ Shipped |
| 4 | `DeviceCatalogComponent` | `.lspkg` | ✅ Shipped |
| 5 | `CCParam.parameterName` integration | `.lspkg` | ✅ Shipped |
| 6 | Dev-mode validation API on `MidiClient` | `packages/core` | Pending |
| 7 | Catalog browser CLI / web page | `scripts/`, optional | Pending |

Steps 1–2 land first because they're tooling + pure-TS — fully testable on desktop, no Lens Studio in the loop. Steps 4–5 are the headline lens-author UX win.

## Decisions baked into this design

| Decision | Reason |
|---|---|
| Vendor (snapshot), don't submodule | Controlled snapshots, no submodule friction; refresh script keeps it ergonomic |
| Commit generated JSON | Catalog diffs are reviewable in PRs; no CSV parser at install time |
| Catalog in separate `packages/catalog`, not `packages/core` | Lens authors who don't want device-specific behavior pay zero cost |
| Per-device JSON files (not one big monolith) | Opt-in packaging: only ship the devices a given lens targets |
| Keep `usage` field raw | Free-text parsing is brittle; v2 can layer typed enums on top |
| Preserve NRPN data in JSON | Future-friendly; small data tax now, no re-vendoring later |
| Slug naming: `manufacturer-device` lowercase hyphenated | Filesystem-safe; canonical names retained in object fields |
| Case-insensitive name lookup | Hardware manuals are inconsistent ("Filter Cutoff" vs "filter cutoff") |
| Devices opt in to the lens bundle | Full catalog could be MBs; lens authors pick what they need |
| Dev-mode validation off by default | Production lenses shouldn't pay a per-send lookup cost |

## License & attribution

- All catalog data files (CSV in `vendor/`, generated JSON in `packages/catalog/devices/`) are licensed CC-BY-SA-4.0 — same as upstream.
- `THIRD-PARTY-NOTICES.md` at the repo root credits the pencilresearch/midi project and maintainers.
- Each generated JSON file includes a top-level `_source` field pointing back to the upstream CSV path for traceability.
- The library code (TypeScript) remains under the project's existing license — CC-BY-SA applies only to the data.

## What this enables

```typescript
// Lens-side authoring with a catalog:

@input midi: MidiClientComponent;
@input nts1: DeviceCatalogComponent;     // points to Korg-NTS-1 JSON

@input filterCutoff: CCParam;            // device = nts1, parameterName = "Filter Cutoff"

onAwake() {
  this.filterCutoff.onChange((value) => {
    this.cube.getTransform().setLocalScale(new vec3(value, value, value));
  });

  // Send back to the synth — name-based, no CC numbers in lens code
  // (works because CCParam knows the resolved cc number)
}
```

And in the inspector, **`parameterName: "Filter Cutoff"`** is what the author types — no memorizing that NTS-1 maps cutoff to CC 43.

## What this does *not* require

- No changes to the WebSocket wire protocol.
- No changes to the bridge.
- No changes to existing `MidiClient`, `CCParam`, or `MidiClientComponent` APIs beyond one additive optional input on `CCParam`.
- No required dependency on the catalog package — lens authors who don't import it never pay for it.
- No changes to existing tests; all new functionality covered by new vitest cases in `packages/catalog/test/`.

All net-new surface lives in `packages/catalog/` and `lens/MidiBleepBop.lspkg/Scripts/DeviceCatalogComponent.ts`. Build-time tooling lives in `scripts/`. Vendored data lives in `vendor/`.
