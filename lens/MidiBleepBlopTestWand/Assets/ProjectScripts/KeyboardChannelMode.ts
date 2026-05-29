// SPDX-License-Identifier: MIT
// KeyboardChannelMode — turn the lens's virtual keyboard into a monophonic
// MIDI controller using Ableton's standard computer-keyboard mapping.
//
//   Home row:  a s d f g h j k l  →  C D E F G A B C(+1) D(+1)
//   Upper row: w e t y u   o p     →  C# D# F# G# A#   C#(+1) D#(+1)
//   z / x     →  octave − / +
//   c / v     →  velocity −20 / +20  (clamped to 1..127)
//
// Tap notes on the virtual keyboard → sendNoteOn → schedule sendNoteOff after
// `noteHoldMs`. Monophonic by design (text input is one keypress at a time;
// holding keys isn't expressible in this model).
//
// Wiring: call `open()` from your existing keyboard-open UI and `close()` from
// the close UI. No built-in buttons — the component just provides the methods.
// Status text (optional) shows current octave / velocity for feedback.

import { MidiClientComponent } from './MidiClientComponent';

// Semitone offset above the bottom-of-current-octave C for each Ableton-mapped key.
function offsetForKey(ch: string): number | undefined {
  switch (ch) {
    case 'a': return 0;   // C
    case 's': return 2;   // D
    case 'd': return 4;   // E
    case 'f': return 5;   // F
    case 'g': return 7;   // G
    case 'h': return 9;   // A
    case 'j': return 11;  // B
    case 'k': return 12;  // C  (+1 octave)
    case 'l': return 14;  // D  (+1 octave)
    case 'w': return 1;   // C#
    case 'e': return 3;   // D#
    case 't': return 6;   // F#
    case 'y': return 8;   // G#
    case 'u': return 10;  // A#
    case 'o': return 13;  // C# (+1 octave)
    case 'p': return 15;  // D# (+1 octave)
    default: return undefined;
  }
}

@component
export class KeyboardChannelMode extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the bridge connection')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel to send on (0-15)')
  channel: number = 0;

  @input
  @hint('Starting octave. Default 3 = A on the home row plays MIDI C3 (60), Ableton convention.')
  startOctave: number = 3;

  @input
  @hint('Starting velocity, 1-127')
  startVelocity: number = 64;

  @input
  @hint('How long each tapped note is held before note-off, in ms')
  noteHoldMs: number = 200;

  @input
  @hint('Optional Text to show "Octave: 3  Vel: 64" — updates on octave/velocity changes')
  statusText: Text | null = null;

  private octave: number = 0;
  private velocity: number = 64;
  private heldNotes: Set<number> = new Set();
  private lastTextLength: number = 0;
  private isKeyboardOpen: boolean = false;
  private options: TextInputSystem.KeyboardOptions | null = null;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
    this.createEvent('OnDestroyEvent').bind(() => this.cleanup());
  }

  /** Open the virtual keyboard and start mapping keystrokes to MIDI. */
  open(): void {
    if (this.isKeyboardOpen) return;
    if (!this.options) this.options = this.buildOptions();
    this.options.initialText = '';
    this.lastTextLength = 0;
    global.textInputSystem.requestKeyboard(this.options);
    this.isKeyboardOpen = true;
  }

  /** Dismiss the virtual keyboard. Held notes are flushed automatically. */
  close(): void {
    if (!this.isKeyboardOpen) return;
    global.textInputSystem.dismissKeyboard();
    // onKeyboardStateChanged(false) handles flush; do it here too as defense.
    this.isKeyboardOpen = false;
    this.flushHeldNotes();
  }

  /** Current octave (signed; 3 = middle / Ableton C3). */
  getOctave(): number {
    return this.octave;
  }

  /** Current send velocity, 1-127. */
  getVelocity(): number {
    return this.velocity;
  }

  private start(): void {
    this.octave = this.startOctave;
    this.velocity = this.clampVelocity(this.startVelocity);
    this.refreshStatus();
  }

  private buildOptions(): TextInputSystem.KeyboardOptions {
    const opts = new TextInputSystem.KeyboardOptions();
    opts.enablePreview = false;
    opts.keyboardType = TextInputSystem.KeyboardType.Text;
    opts.returnKeyType = TextInputSystem.ReturnKeyType.Done;

    opts.onTextChanged = (text: string, _range: vec2): void => {
      this.handleTextChange(text);
    };
    opts.onKeyboardStateChanged = (isOpen: boolean): void => {
      this.isKeyboardOpen = isOpen;
      if (!isOpen) {
        this.flushHeldNotes();
        this.lastTextLength = 0;
      }
    };
    opts.onError = (error: number, description: string): void => {
      print('[KeyboardChannelMode] keyboard error: ' + String(error) + ' — ' + description);
    };
    return opts;
  }

  private handleTextChange(text: string): void {
    // Only fire on growth — backspace shrinks `text` and we just resync.
    if (text.length > this.lastTextLength) {
      const newChars = text.substring(this.lastTextLength);
      for (let i = 0; i < newChars.length; i++) {
        this.handleChar(newChars.charAt(i));
      }
    }
    this.lastTextLength = text.length;
  }

  private handleChar(rawCh: string): void {
    const ch = rawCh.toLowerCase();

    if (ch === 'z') { this.octave--; this.refreshStatus(); return; }
    if (ch === 'x') { this.octave++; this.refreshStatus(); return; }
    if (ch === 'c') { this.velocity = this.clampVelocity(this.velocity - 20); this.refreshStatus(); return; }
    if (ch === 'v') { this.velocity = this.clampVelocity(this.velocity + 20); this.refreshStatus(); return; }

    const offset = offsetForKey(ch);
    if (offset === undefined) return;

    // Ableton numbers octaves so that C3 = MIDI 60: midi = (octave + 2) * 12 + offset.
    const note = (this.octave + 2) * 12 + offset;
    if (note < 0 || note > 127) return;

    const client = this.midi ? this.midi.client : null;
    if (!client) return;

    client.sendNoteOn(this.channel, note, this.velocity);
    this.heldNotes.add(note);

    const offEvent = this.createEvent('DelayedCallbackEvent');
    offEvent.bind(() => {
      if (!this.heldNotes.has(note)) return;
      const c = this.midi ? this.midi.client : null;
      if (!c) return;
      c.sendNoteOff(this.channel, note);
      this.heldNotes.delete(note);
    });
    offEvent.reset(this.noteHoldMs / 1000);
  }

  private flushHeldNotes(): void {
    const client = this.midi ? this.midi.client : null;
    if (!client) {
      this.heldNotes.clear();
      return;
    }
    for (const note of this.heldNotes) client.sendNoteOff(this.channel, note);
    this.heldNotes.clear();
  }

  private clampVelocity(v: number): number {
    if (v < 1) return 1;
    if (v > 127) return 127;
    return v;
  }

  private refreshStatus(): void {
    if (!this.statusText) return;
    this.statusText.text =
      'Octave: ' + String(this.octave) + '  Vel: ' + String(this.velocity);
  }

  private cleanup(): void {
    this.flushHeldNotes();
  }
}
