import {
  encodeMessage,
  parseMessage,
  type CC,
  type ChannelPressure,
  type MidiMessage,
  type NoteOff,
  type NoteOn,
  type PitchBend,
  type ProgramChange,
} from './messages.js';
import { MidiState } from './state.js';
import type { ConnectionState, Transport } from './transport.js';

export type Unsubscribe = () => void;

type EventPayloads = {
  message: MidiMessage;
  noteOn: NoteOn;
  noteOff: NoteOff;
  cc: CC;
  programChange: ProgramChange;
  pitchBend: PitchBend;
  channelPressure: ChannelPressure;
  connect: void;
  disconnect: void;
};

type EventName = keyof EventPayloads;

export class MidiClient {
  private readonly listeners = new Map<EventName, Set<(payload: unknown) => void>>();
  private readonly ccChangeListeners = new Map<string, Set<(value: number, previous: number | undefined) => void>>();
  private readonly noteHeldListeners = new Map<string, Set<(held: boolean, velocity: number) => void>>();
  private readonly programChangeListeners = new Map<number, Set<(program: number) => void>>();
  private readonly midiState = new MidiState();
  private currentState: ConnectionState = 'closed';
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(private readonly transport: Transport) {
    this.transport.onMessage((bytes) => this.handleIncoming(bytes));
    this.transport.onStateChange((state) => this.handleStateChange(state));
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  get connected(): boolean {
    return this.currentState === 'open';
  }

  connect(): Promise<void> {
    if (this.currentState === 'open') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject });
    });
  }

  close(): void {
    this.transport.close();
  }

  sendNoteOn(channel: number, note: number, velocity: number): void {
    this.send({ type: 'noteOn', channel, note, velocity });
  }

  sendNoteOff(channel: number, note: number, velocity = 0): void {
    this.send({ type: 'noteOff', channel, note, velocity });
  }

  sendCC(channel: number, controller: number, value: number): void {
    this.send({ type: 'cc', channel, controller, value });
  }

  sendProgramChange(channel: number, program: number): void {
    this.send({ type: 'programChange', channel, program });
  }

  sendPitchBend(channel: number, value: number): void {
    this.send({ type: 'pitchBend', channel, value });
  }

  sendChannelPressure(channel: number, pressure: number): void {
    this.send({ type: 'channelPressure', channel, pressure });
  }

  send(msg: MidiMessage): void {
    this.transport.send(encodeMessage(msg));
  }

  sendRaw(bytes: Uint8Array): void {
    this.transport.send(bytes);
  }

  on<E extends EventName>(event: E, handler: (payload: EventPayloads[E]) => void): Unsubscribe {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(handler as (payload: unknown) => void);
    return () => bucket.delete(handler as (payload: unknown) => void);
  }

  heldNotes(channel?: number): number[] {
    return this.midiState.heldNotes(channel);
  }

  ccValue(channel: number, controller: number): number | undefined {
    return this.midiState.get(channel)?.cc.get(controller);
  }

  programNumber(channel: number): number | undefined {
    return this.midiState.get(channel)?.program;
  }

  pitchBend(channel: number): number {
    return this.midiState.get(channel)?.pitchBend ?? 0;
  }

  channelPressure(channel: number): number {
    return this.midiState.get(channel)?.channelPressure ?? 0;
  }

  onCCChange(
    channel: number,
    controller: number,
    handler: (value: number, previous: number | undefined) => void,
  ): Unsubscribe {
    const key = `${channel}:${controller}`;
    let bucket = this.ccChangeListeners.get(key);
    if (!bucket) {
      bucket = new Set();
      this.ccChangeListeners.set(key, bucket);
    }
    bucket.add(handler);
    return () => bucket.delete(handler);
  }

  onNoteHeld(
    channel: number,
    note: number,
    handler: (held: boolean, velocity: number) => void,
  ): Unsubscribe {
    const key = `${channel}:${note}`;
    let bucket = this.noteHeldListeners.get(key);
    if (!bucket) {
      bucket = new Set();
      this.noteHeldListeners.set(key, bucket);
    }
    bucket.add(handler);
    return () => bucket.delete(handler);
  }

  onProgramChange(channel: number, handler: (program: number) => void): Unsubscribe {
    let bucket = this.programChangeListeners.get(channel);
    if (!bucket) {
      bucket = new Set();
      this.programChangeListeners.set(channel, bucket);
    }
    bucket.add(handler);
    return () => bucket.delete(handler);
  }

  private handleIncoming(bytes: Uint8Array): void {
    const msg = parseMessage(bytes);
    const prevState = this.snapshotForChange(msg);
    this.midiState.apply(msg);
    this.emit('message', msg);
    this.emitTyped(msg);
    this.emitStateChanges(msg, prevState);
  }

  private handleStateChange(state: ConnectionState): void {
    const wasOpen = this.currentState === 'open';
    this.currentState = state;

    if (state === 'open') {
      const waiters = this.connectWaiters;
      this.connectWaiters = [];
      for (const w of waiters) w.resolve();
      this.emit('connect', undefined);
    } else if (state === 'closed' && wasOpen) {
      this.emit('disconnect', undefined);
    } else if (state === 'closed') {
      const waiters = this.connectWaiters;
      this.connectWaiters = [];
      for (const w of waiters) w.reject(new Error('Transport closed before connection opened'));
    }
  }

  private emit<E extends EventName>(event: E, payload: EventPayloads[E]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const h of bucket) h(payload);
  }

  private emitTyped(msg: MidiMessage): void {
    switch (msg.type) {
      case 'noteOn':
        this.emit('noteOn', msg);
        break;
      case 'noteOff':
        this.emit('noteOff', msg);
        break;
      case 'cc':
        this.emit('cc', msg);
        break;
      case 'programChange':
        this.emit('programChange', msg);
        break;
      case 'pitchBend':
        this.emit('pitchBend', msg);
        break;
      case 'channelPressure':
        this.emit('channelPressure', msg);
        break;
    }
  }

  private snapshotForChange(msg: MidiMessage): { ccPrev?: number; wasHeld?: boolean; prevProgram?: number } {
    if (msg.type === 'cc') {
      return { ccPrev: this.midiState.get(msg.channel)?.cc.get(msg.controller) };
    }
    if (msg.type === 'noteOn' || msg.type === 'noteOff') {
      return { wasHeld: this.midiState.get(msg.channel)?.heldNotes.has(msg.note) ?? false };
    }
    if (msg.type === 'programChange') {
      return { prevProgram: this.midiState.get(msg.channel)?.program };
    }
    return {};
  }

  private emitStateChanges(
    msg: MidiMessage,
    prev: { ccPrev?: number; wasHeld?: boolean; prevProgram?: number },
  ): void {
    if (msg.type === 'cc') {
      if (prev.ccPrev === msg.value) return;
      const bucket = this.ccChangeListeners.get(`${msg.channel}:${msg.controller}`);
      if (!bucket) return;
      for (const h of bucket) h(msg.value, prev.ccPrev);
      return;
    }

    if (msg.type === 'noteOn') {
      if (prev.wasHeld) return;
      const bucket = this.noteHeldListeners.get(`${msg.channel}:${msg.note}`);
      if (!bucket) return;
      for (const h of bucket) h(true, msg.velocity);
      return;
    }

    if (msg.type === 'noteOff') {
      if (!prev.wasHeld) return;
      const bucket = this.noteHeldListeners.get(`${msg.channel}:${msg.note}`);
      if (!bucket) return;
      for (const h of bucket) h(false, msg.velocity);
      return;
    }

    if (msg.type === 'programChange') {
      if (prev.prevProgram === msg.program) return;
      const bucket = this.programChangeListeners.get(msg.channel);
      if (!bucket) return;
      for (const h of bucket) h(msg.program);
    }
  }
}
