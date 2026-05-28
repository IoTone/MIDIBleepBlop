// ChordSender — plays a major triad on a loop, lens-side. A send-direction
// test helper: lens → ws → bridge → CoreMIDI out → IAC → GarageBand → speaker.
//
// Auto-play is OFF by default so it never surprise-plays. Either tick `autoPlay`
// in the inspector, or call play() / stop() from your own UI to drive it.
//
// Sends note-offs on stop/destroy so you never leave hung notes.

import { MidiClientComponent } from './MidiClientComponent';

@component
export class ChordSender extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the bridge connection')
  midi!: MidiClientComponent;

  @input
  @hint('If true, the chord loop starts automatically on awake. Default false — call play() to start.')
  autoPlay: boolean = false;

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
  private running = false;
  private destroyed = false;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.autoPlay) this.play();
    });
    this.createEvent('OnDestroyEvent').bind(() => this.cleanup());
  }

  /** Start the chord loop. Idempotent — calling again while running is a no-op. */
  play(): void {
    if (this.running || this.destroyed) return;
    const client = this.midi ? this.midi.client : null;
    if (!client) {
      print('[ChordSender] no MidiClient — is the Midi input wired?');
      return;
    }
    // Major triad: root, major third (+4), perfect fifth (+7).
    this.chord = [this.rootNote, this.rootNote + 4, this.rootNote + 7];
    this.running = true;
    print(
      '[ChordSender] play ' +
        this.chord.join(',') +
        ' on ch' +
        String(this.channel) +
        ' every ' +
        String(this.intervalSec) +
        's',
    );
    this.tick();
  }

  /** Stop the loop and release any held notes. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    const client = this.midi ? this.midi.client : null;
    if (!client) return;
    for (const n of this.chord) client.sendNoteOff(this.channel, n);
    print('[ChordSender] stopped');
  }

  private tick(): void {
    if (!this.running || this.destroyed) return;
    const client = this.midi ? this.midi.client : null;
    if (!client) return;

    for (const n of this.chord) client.sendNoteOn(this.channel, n, this.velocity);

    const offEvent = this.createEvent('DelayedCallbackEvent');
    offEvent.bind(() => {
      const c = this.midi ? this.midi.client : null;
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
    this.running = false;
    const client = this.midi ? this.midi.client : null;
    if (!client) return;
    for (const n of this.chord) client.sendNoteOff(this.channel, n);
  }
}
