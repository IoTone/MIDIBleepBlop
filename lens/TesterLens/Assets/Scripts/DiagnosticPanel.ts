// DiagnosticPanel — Tester Lens diagnostic readout.
//
// Wires a MidiClientComponent (from the MidiBleepBop library) to a set of
// Text components, so you can see at a glance:
//   • whether the lens is connected to the bridge
//   • the most recent MIDI event received
//   • which notes are currently held
//   • the last CC change
//   • a rolling count of all messages received
//
// All readouts (except messageCount) are filtered by the `channel` input.
// Set `channel` to -1 to monitor every channel.

import { MidiClientComponent } from './MidiClientComponent';
import type { MidiMessage } from './MidiBleepBop';

@component
export class DiagnosticPanel extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the connection (drop the MidiClient prefab here)')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel to monitor (0–15). Set to -1 to monitor all channels.')
  channel: number = 0;

  @input
  @hint('Text component showing connection state (connecting / open / closed)')
  statusText!: Text;

  @input
  @hint('Text component showing the most recent MIDI event')
  lastEventText!: Text;

  @input
  @hint('Text component showing the list of currently held notes on the monitored channel')
  heldNotesText!: Text;

  @input
  @hint('Text component showing the most recent CC change')
  lastCCText!: Text;

  @input
  @hint('Text component showing a rolling count of total incoming messages')
  messageCountText!: Text;

  private messageCount = 0;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  private start(): void {
    const client = this.midi.client;
    if (!client) {
      this.setText(this.statusText, 'ERROR: no MidiClient on the wired component');
      return;
    }

    this.setText(this.statusText, client.state);
    this.setText(this.lastEventText, '(waiting…)');
    this.setText(this.heldNotesText, '(none held)');
    this.setText(this.lastCCText, '(none)');
    this.setText(this.messageCountText, '0');

    client.on('connect', () => this.setText(this.statusText, 'open'));
    client.on('disconnect', () => this.setText(this.statusText, 'closed'));

    client.on('message', (m: MidiMessage) => {
      this.messageCount++;
      this.setText(this.messageCountText, String(this.messageCount));
    });

    client.on('noteOn', (m) => {
      if (!this.passes(m.channel)) return;
      this.setText(this.lastEventText, this.fmtNote('noteOn', m.channel, m.note, m.velocity));
      this.refreshHeldNotes();
    });

    client.on('noteOff', (m) => {
      if (!this.passes(m.channel)) return;
      this.setText(this.lastEventText, this.fmtNote('noteOff', m.channel, m.note, m.velocity));
      this.refreshHeldNotes();
    });

    client.on('cc', (m) => {
      if (!this.passes(m.channel)) return;
      this.setText(this.lastEventText, `cc       ch${m.channel} cc=${m.controller} val=${m.value}`);
      this.setText(this.lastCCText, `ch${m.channel} cc=${m.controller} val=${m.value}`);
    });

    client.on('programChange', (m) => {
      if (!this.passes(m.channel)) return;
      this.setText(this.lastEventText, `pgm      ch${m.channel} program=${m.program}`);
    });

    client.on('pitchBend', (m) => {
      if (!this.passes(m.channel)) return;
      this.setText(this.lastEventText, `bend     ch${m.channel} value=${m.value}`);
    });

    client.on('channelPressure', (m) => {
      if (!this.passes(m.channel)) return;
      this.setText(this.lastEventText, `pressure ch${m.channel} value=${m.pressure}`);
    });
  }

  private passes(eventChannel: number): boolean {
    return this.channel < 0 || this.channel > 15 || eventChannel === this.channel;
  }

  private refreshHeldNotes(): void {
    const client = this.midi.client;
    if (!client) return;
    const held =
      this.channel >= 0 && this.channel <= 15
        ? client.heldNotes(this.channel)
        : client.heldNotes();
    this.setText(this.heldNotesText, held.length === 0 ? '(none held)' : held.join(' '));
  }

  private fmtNote(label: string, channel: number, note: number, velocity: number): string {
    const labelPadded = (label + '        ').slice(0, 8);
    return `${labelPadded} ch${channel} note=${note} vel=${velocity}`;
  }

  private setText(target: Text | undefined, value: string): void {
    if (!target) return;
    target.text = value;
  }
}
