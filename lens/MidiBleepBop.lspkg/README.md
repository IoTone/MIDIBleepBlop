# MidiBleepBop.lspkg

The shippable Lens Studio asset package. Contains the MIDI client library and a `@component` wrapper for use inside lens scripts.

## Contents

- `Scripts/MidiBleepBop.ts` — auto-generated bundle of `packages/core` + `packages/transport-spectacles-ws`. **Do not edit by hand** — regenerate via `npm run build:lens` from the repo root.
- `Scripts/MidiClientComponent.ts` — `@component` wrapper exposing `bridgeUrl` / `autoConnect` inspector inputs.
- `Prefabs/MidiClient.prefab` — drop-in scene object (must be created inside Lens Studio; see below).
- `lens-package.json` — package metadata.

## Finishing this package inside Lens Studio (one-time)

This repo can't generate Lens Studio's binary `.prefab` or `.lspkg` formats. To produce a distributable asset package you need Lens Studio in hand:

1. Open Lens Studio (5.9 or newer).
2. Create or open a project.
3. **Resources panel → import** both `Scripts/MidiBleepBop.ts` and `Scripts/MidiClientComponent.ts`.
4. Add an empty SceneObject; attach `MidiClientComponent` to it. Set the inputs you want as defaults.
5. **Drag the SceneObject into the Resources panel** to save it as a Prefab, named `MidiClient`.
6. Move both scripts and the prefab into a folder named `MidiBleepBop`.
7. **Right-click the folder → Export as Custom Component / Package**, save as `MidiBleepBop.lspkg`.

The exported `.lspkg` is what you ship.

## Updating the bundled library

Whenever `packages/core` or `packages/transport-spectacles-ws` changes:

```
npm run build:lens
```

…then re-import `Scripts/MidiBleepBop.ts` into the Lens Studio project and re-export the `.lspkg`.

## Using it in your own lens

After importing the published `.lspkg` into your project:

```typescript
import { MidiClientComponent } from 'MidiBleepBop.lspkg/Scripts/MidiClientComponent';

@component
export class MyVisuals extends BaseScriptComponent {
  @input midi: MidiClientComponent;

  onAwake() {
    const c = this.midi.client;
    if (!c) return;
    c.on('noteOn', (m) => { /* react to MIDI */ });
    c.onCCChange(0, 1, (value) => { /* react to modwheel changes */ });
  }
}
```

See `docs/api.md` in the repo root for the full `MidiClient` API.
