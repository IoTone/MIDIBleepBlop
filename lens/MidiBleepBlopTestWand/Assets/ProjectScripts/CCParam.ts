// CCParam — a typed handle to one MIDI CC on one channel.
//
// Listens to a specific (channel, controller) on a MidiClientComponent, applies
// optional input/output range mapping and EMA smoothing, and exposes the
// resulting value via .current() (raw 0-127) and .scaled() (mapped). Other
// scripts can take a `@input cc: CCParam` and read its current scaled value or
// subscribe to changes via .onChange(...).
//
// The math lives in CCMapper (in MidiBleepBop.ts, vendored from packages/core)
// so it's unit-tested in vitest separately. This file is a thin Lens Studio
// @component wrapper that wires events.

import { CCMapper } from './MidiBleepBop';
import { DeviceCatalogComponent } from './DeviceCatalogComponent';
import { MidiClientComponent } from './MidiClientComponent';

type Unsubscribe = () => void;

@component
export class CCParam extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the bridge connection')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel (0-15)')
  channel: number = 0;

  @input
  @hint('CC number (0-127). Common: 1=ModWheel, 7=Volume, 11=Expression, 74=FilterCutoff. Overridden by parameterName if a device catalog is wired.')
  controller: number = 1;

  @input
  @hint('Optional. If wired, parameterName resolves the controller via the device catalog.')
  device: DeviceCatalogComponent | null = null;

  @input
  @hint('Optional. Name of the parameter on the wired device (e.g. "LFO rate", "Filter Cutoff"). Case-insensitive. Falls back to `controller` if blank or unresolved.')
  parameterName: string = '';

  @input
  @hint('Raw input minimum (typically 0)')
  inputMin: number = 0;

  @input
  @hint('Raw input maximum (typically 127)')
  inputMax: number = 127;

  @input
  @hint('Scaled output minimum')
  outputMin: number = 0;

  @input
  @hint('Scaled output maximum')
  outputMax: number = 1;

  @input
  @hint('Exponential moving average factor. 0 = instant (no smoothing). ~0.9 = very smooth.')
  smoothingFactor: number = 0;

  private mapper: CCMapper | null = null;
  private changeListeners: Array<(mapped: number, raw: number) => void> = [];
  private resolvedController: number = 0;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  /** Most recent raw CC value (0-127). Returns inputMin before any value arrives. */
  current(): number {
    return this.mapper ? this.mapper.current() : this.inputMin;
  }

  /** Smoothed + mapped value in [outputMin, outputMax]. Returns outputMin before any value arrives. */
  scaled(): number {
    return this.mapper ? this.mapper.scaled() : this.outputMin;
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(handler: (mapped: number, raw: number) => void): Unsubscribe {
    this.changeListeners.push(handler);
    return () => {
      const i = this.changeListeners.indexOf(handler);
      if (i >= 0) this.changeListeners.splice(i, 1);
    };
  }

  /** The CC number this CCParam is bound to (after resolving parameterName against the device catalog if wired). */
  get resolvedCC(): number {
    return this.resolvedController;
  }

  private start(): void {
    const client = this.midi?.client;
    if (!client) {
      print('[CCParam] no MidiClient — is the Midi input wired?');
      return;
    }

    this.resolvedController = this.resolveController();

    this.mapper = new CCMapper({
      inputMin: this.inputMin,
      inputMax: this.inputMax,
      outputMin: this.outputMin,
      outputMax: this.outputMax,
      smoothingFactor: this.smoothingFactor,
    });

    // Seed from any value already observed before we attached.
    const initial = client.ccValue(this.channel, this.resolvedController);
    if (initial !== undefined) this.mapper.update(initial);

    client.onCCChange(this.channel, this.resolvedController, (value: number) => {
      if (!this.mapper) return;
      const changed = this.mapper.update(value);
      if (!changed) return;
      const mapped = this.mapper.scaled();
      const raw = this.mapper.current();
      for (const h of this.changeListeners) h(mapped, raw);
    });
  }

  private resolveController(): number {
    const named = this.parameterName.trim();
    if (named.length === 0 || !this.device || !this.device.catalog) {
      return this.controller;
    }
    const resolved = this.device.catalog.cc(named);
    if (resolved === undefined) {
      print(
        '[CCParam] parameterName "' +
          named +
          '" not found on ' +
          this.device.catalog.device.manufacturer +
          ' ' +
          this.device.catalog.device.device +
          '; falling back to controller=' +
          String(this.controller),
      );
      return this.controller;
    }
    print(
      '[CCParam] resolved "' +
        named +
        '" → CC ' +
        String(resolved) +
        ' on ' +
        this.device.catalog.device.manufacturer +
        ' ' +
        this.device.catalog.device.device,
    );
    return resolved;
  }
}
