// ChordSender — auto-plays a major triad on a loop, lens-side.
//
// Proves the SEND direction works end-to-end:
//   lens → ws → bridge → CoreMIDI out → IAC Bus 1 → GarageBand → speaker
//
// Drop this on any SceneObject, wire `Midi` to your MidiClient, hit preview,
// and (with GarageBand listening to IAC Bus 1 on a software-instrument track)
// you should hear a chord every ~1.5 s.
//
// Sends note-offs on destroy so stopping preview doesn't leave hung notes.

import { MidiClientComponent } from './MidiClientComponent';

@component
export class ChordSender extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the bridge connection')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel to send on (0-15)')
  channel: number = 0;

  @input
  @hint('Root note of the major triad. 60 = middle C. Try 48 (low C) or 72 (high C).')
  rootNote: number = 60;

  @input
  @hint('Note velocity, 1-127')
  velocity: number = 90;

  @input
  @hint('Seconds between chord triggers')
  intervalSec: number = 1.5;

  @input
  @hint('How long each chord is held, in seconds (must be < intervalSec)')
  holdSec: number = 1.0;

  private chord: number[] = [];
  private destroyed = false;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
    this.createEvent('OnDestroyEvent').bind(() => this.cleanup());
  }

  private start(): void {
    const client = this.midi?.client;
    if (!client) {
      print('[ChordSender] no MidiClient — is the Midi input wired?');
      return;
    }

    // Major triad: root, major third (+4), perfect fifth (+7).
    this.chord = [this.rootNote, this.rootNote + 4, this.rootNote + 7];

    print(
      '[ChordSender] sending ' +
        this.chord.join(',') +
        ' on ch' +
        String(this.channel) +
        ' every ' +
        String(this.intervalSec) +
        's',
    );

    this.tick();
  }

  private tick(): void {
    if (this.destroyed) return;
    const client = this.midi?.client;
    if (!client) return;

    for (const n of this.chord) client.sendNoteOn(this.channel, n, this.velocity);

    const offEvent = this.createEvent('DelayedCallbackEvent');
    offEvent.bind(() => {
      if (this.destroyed) return;
      const c = this.midi?.client;
      if (!c) return;
      for (const n of this.chord) c.sendNoteOff(this.channel, n);
    });
    offEvent.reset(this.holdSec);

    const nextEvent = this.createEvent('DelayedCallbackEvent');
    nextEvent.bind(() => this.tick());
    nextEvent.reset(this.intervalSec);
  }

  private cleanup(): void {
    this.destroyed = true;
    const client = this.midi?.client;
    if (!client) return;
    for (const n of this.chord) client.sendNoteOff(this.channel, n);
  }
}
