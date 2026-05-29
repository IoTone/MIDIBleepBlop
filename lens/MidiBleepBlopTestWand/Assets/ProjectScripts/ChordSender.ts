// SPDX-License-Identifier: MIT
// ChordSender — a small built-in pattern player for send-direction testing.
// Plays one of several grooves on a loop:
//
//   'triad'  — a major triad from rootNote, held and repeated (the original).
//   'acid'   — a 16th-note A-minor 303-style bassline (octave jumps + color
//              notes, plucky gate). Aim it at a bass synth (Volca Bass ch0).
//   'house'  — off-beat 7th-chord stabs Am7→Dm7→Em7→Cmaj7 on the "and" of each
//              beat, mid register. Aim it at a different channel/synth.
//   'trance' — a driving quarter-note bass pulse with an octave lift on beat 4.
//              Aim it at a bass synth. Pairs with a four-on-the-floor kick.
//
// One ChordSender plays one pattern on one channel — drop two (acid on the
// bass, house on a pad synth) to run both at once. autoPlay (off by default)
// toggles it; or call play() / stop() from your own UI.
//
// Notes are released on stop/destroy and at each step's gate, so nothing hangs.

import { MidiClientComponent } from './MidiClientComponent';

// A-minor 303-style bassline, 16 sixteenth-note steps. Empty = rest.
// A1=33, A2=45, C2=36, E2=40, G1=31.
const ACID_STEPS: number[][] = [
  [33], [33], [45], [33], [], [36], [33], [45],
  [33], [40], [33], [], [31], [33], [45], [33],
];

// House chord stabs on the "and" of each beat (16th grid). Empty = rest.
const HOUSE_STEPS: number[][] = [
  [], [], [57, 60, 64, 67], [],   // Am7 on the "and" of beat 1
  [], [], [62, 65, 69, 72], [],   // Dm7
  [], [], [64, 67, 71, 74], [],   // Em7
  [], [], [60, 64, 67, 71], [],   // Cmaj7
];

// Trance bass: quarter-note root pulse (one note per beat) with an octave lift
// on beat 4. A1 A1 A1 A2. For the classic rolling off-beat trance bass instead,
// change this to 16th steps with notes only on the "and"s: e.g.
//   [],[],[33],[], [],[],[33],[], [],[],[33],[], [],[],[45],[]   (stepBeats 0.25)
const TRANCE_STEPS: number[][] = [[33], [33], [33], [45]];

interface PatternDef {
  stepBeats: number; // duration of one step in beats (0.25 = 16th)
  gate: number; // fraction of a step the notes sound (staccato < 1)
  steps: number[][];
}

@component
export class ChordSender extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the bridge connection')
  midi!: MidiClientComponent;

  @input
  @hint('If true, starts automatically on awake. Default false — call play() to start.')
  autoPlay: boolean = false;

  @input
  @hint('Groove to play: triad | acid | house | trance')
  pattern: string = 'triad';

  @input
  @hint('MIDI channel to send on (0-15)')
  channel: number = 0;

  @input
  @hint('Tempo in BPM')
  bpm: number = 124;

  @input
  @hint('Note velocity, 1-127')
  velocity: number = 90;

  @input
  @hint('Root note for the "triad" pattern. 60 = middle C.')
  rootNote: number = 60;

  @input
  @hint('Semitones to transpose the "acid" / "house" patterns (0 = as written, A minor).')
  transpose: number = 0;

  private running = false;
  private destroyed = false;
  private active: PatternDef | null = null;
  private stepIndex = 0;
  private currentNotes: number[] = [];
  private stepEvent: DelayedCallbackEvent | null = null;
  private gateEvent: DelayedCallbackEvent | null = null;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      if (this.autoPlay) this.play();
    });
    this.createEvent('OnDestroyEvent').bind(() => this.cleanup());
  }

  /** Start the selected pattern. Idempotent while running. */
  play(): void {
    if (this.running || this.destroyed) return;
    const client = this.midi ? this.midi.client : null;
    if (!client) {
      print('[ChordSender] no MidiClient — is the Midi input wired?');
      return;
    }

    this.active = this.buildPattern();
    this.stepIndex = 0;
    this.running = true;

    // Create the two reusable timers once.
    if (!this.stepEvent) {
      this.stepEvent = this.createEvent('DelayedCallbackEvent');
      this.stepEvent.bind(() => this.advance());
    }
    if (!this.gateEvent) {
      this.gateEvent = this.createEvent('DelayedCallbackEvent');
      this.gateEvent.bind(() => this.releaseCurrent());
    }

    print('[ChordSender] play "' + this.pattern + '" on ch' + String(this.channel) + ' @ ' + String(this.bpm) + ' bpm');
    this.advance();
  }

  /** Stop the loop and release any sounding notes. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.stepEvent) this.stepEvent.cancel();
    if (this.gateEvent) this.gateEvent.cancel();
    this.releaseCurrent();
    print('[ChordSender] stopped');
  }

  private buildPattern(): PatternDef {
    if (this.pattern === 'acid') {
      return { stepBeats: 0.25, gate: 0.5, steps: this.transposed(ACID_STEPS) };
    }
    if (this.pattern === 'house') {
      return { stepBeats: 0.25, gate: 0.4, steps: this.transposed(HOUSE_STEPS) };
    }
    if (this.pattern === 'trance') {
      return { stepBeats: 1, gate: 0.6, steps: this.transposed(TRANCE_STEPS) };
    }
    // default: triad
    return {
      stepBeats: 2,
      gate: 0.85,
      steps: [[this.rootNote, this.rootNote + 4, this.rootNote + 7]],
    };
  }

  private transposed(steps: number[][]): number[][] {
    if (this.transpose === 0) return steps;
    return steps.map((s) => s.map((n) => n + this.transpose));
  }

  private advance(): void {
    if (!this.running || !this.active) return;
    const client = this.midi ? this.midi.client : null;
    if (!client) return;

    // Safety: release anything still sounding before the new step.
    this.releaseCurrent();

    const notes = this.active.steps[this.stepIndex];
    for (let i = 0; i < notes.length; i++) client.sendNoteOn(this.channel, notes[i], this.velocity);
    this.currentNotes = notes.slice();

    const beatMs = 60000 / this.bpm;
    const stepMs = beatMs * this.active.stepBeats;
    const gateMs = stepMs * this.active.gate;

    if (this.gateEvent && this.currentNotes.length > 0) this.gateEvent.reset(gateMs / 1000);

    this.stepIndex = (this.stepIndex + 1) % this.active.steps.length;
    if (this.stepEvent) this.stepEvent.reset(stepMs / 1000);
  }

  private releaseCurrent(): void {
    if (this.currentNotes.length === 0) return;
    const client = this.midi ? this.midi.client : null;
    if (client) {
      for (let i = 0; i < this.currentNotes.length; i++) {
        client.sendNoteOff(this.channel, this.currentNotes[i]);
      }
    }
    this.currentNotes = [];
  }

  private cleanup(): void {
    this.destroyed = true;
    this.running = false;
    if (this.stepEvent) this.stepEvent.cancel();
    if (this.gateEvent) this.gateEvent.cancel();
    this.releaseCurrent();
  }
}
