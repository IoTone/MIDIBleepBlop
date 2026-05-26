# TesterLens

A minimal Lens Studio project that exercises the `MidiBleepBop` library end-to-end. The two scripts under `Assets/Scripts/` are committed here; the `.esproj`, scene graph, and resources are constructed once inside Lens Studio following the recipe in `docs/tester-lens.md`.

See `../../docs/tester-lens.md` for the step-by-step setup.

## Scripts

- **`Assets/Scripts/DiagnosticPanel.ts`** — text readout of connection state, last event, held notes, last CC, and message count. Channel-filterable.
- **`Assets/Scripts/NoteCubeFlash.ts`** — scales a target SceneObject up while any note on the monitored channel is held. Optional, useful for "is MIDI really arriving in the 3D scene?" visual confirmation.
