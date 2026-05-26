// MidiClientComponent — Lens Studio @component wrapper around MidiClient +
// SpectaclesWebSocketTransport. Drop this onto a SceneObject (or use the
// MidiClient prefab) and read `.client` from your own scripts.

import {
  MidiClient,
  SpectaclesWebSocketTransport,
  type Cancel,
  type Schedule,
} from './MidiBleepBop';

@component
export class MidiClientComponent extends BaseScriptComponent {
  @input
  @hint('WebSocket URL of the bridge. NOT localhost — Spectacles resolves that to itself. Use your dev machine\'s LAN IP, e.g. ws://192.168.1.100:8765')
  bridgeUrl: string = 'ws://192.168.1.100:8765';

  @input
  @hint('Automatically connect on onAwake')
  autoConnect: boolean = true;

  /** Public; other scripts read this to subscribe to MIDI events. */
  client: MidiClient | null = null;

  private transport: SpectaclesWebSocketTransport | null = null;

  onAwake(): void {
    const schedule: Schedule = (callback, delayMs): Cancel => {
      const ev = this.createEvent('DelayedCallbackEvent');
      ev.bind(() => callback());
      ev.reset(delayMs / 1000);
      return () => ev.cancel();
    };

    this.transport = new SpectaclesWebSocketTransport({
      url: this.bridgeUrl,
      schedule,
    });

    this.client = new MidiClient(this.transport);

    if (this.autoConnect) {
      this.client.connect().catch((e: unknown) => {
        print('[MidiBleepBop] connect failed: ' + String(e));
      });
    }

    this.createEvent('OnDestroyEvent').bind(() => {
      this.client?.close();
    });
  }
}
