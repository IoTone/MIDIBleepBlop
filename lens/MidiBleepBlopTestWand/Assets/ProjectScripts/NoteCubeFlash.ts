// SPDX-License-Identifier: MIT
// NoteCubeFlash — scales a target SceneObject up while any note on the
// monitored channel is being held. The simplest "is MIDI actually arriving in
// 3D space" visual: see a cube grow when you play, shrink when you release.
//
// No material editing required — uses transform scale so it works on whatever
// mesh you drop in. Pairs naturally with the DiagnosticPanel: side-by-side,
// the text shows you what's happening and the cube shows you it's real.

import { MidiClientComponent } from './MidiClientComponent';

@component
export class NoteCubeFlash extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the connection')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel to monitor (0–15). Set to -1 to flash on any channel.')
  channel: number = 0;

  @input
  @hint('The SceneObject to scale up while notes are held')
  target!: SceneObject;

  @input
  @hint('Scale applied when no notes are held')
  restScale: number = 1.0;

  @input
  @hint('Scale applied while at least one note is held')
  flashScale: number = 1.5;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  private start(): void {
    const client = this.midi.client;
    if (!client) return;

    this.applyScale(this.restScale);

    client.on('noteOn', (m) => {
      if (!this.passes(m.channel)) return;
      this.applyScale(this.flashScale);
    });

    client.on('noteOff', (m) => {
      if (!this.passes(m.channel)) return;
      const held =
        this.channel >= 0 && this.channel <= 15
          ? client.heldNotes(this.channel)
          : client.heldNotes();
      if (held.length === 0) this.applyScale(this.restScale);
    });
  }

  private passes(eventChannel: number): boolean {
    return this.channel < 0 || this.channel > 15 || eventChannel === this.channel;
  }

  private applyScale(s: number): void {
    if (!this.target) return;
    this.target.getTransform().setLocalScale(new vec3(s, s, s));
  }
}
