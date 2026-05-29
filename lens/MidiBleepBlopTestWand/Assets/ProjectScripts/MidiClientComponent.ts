// SPDX-License-Identifier: MIT
// MidiClientComponent — Lens Studio @component wrapper around MidiClient +
// SpectaclesWebSocketTransport. Drop this onto a SceneObject (or use the
// MidiClient prefab) and read `.client` from your own scripts.
//
// IMPORTANT: this component resolves LensStudio:InternetModule and supplies a
// `print`-based logger to the transport. Lens Studio exposes `require` and
// `print` as module-scope globals — NOT on globalThis — so the transport can't
// reach them itself. We resolve them here (where they work) and inject them.

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
    print('[MidiClientComponent] onAwake — url=' + this.bridgeUrl + ' autoConnect=' + String(this.autoConnect));

    const schedule: Schedule = (callback, delayMs): Cancel => {
      const ev = this.createEvent('DelayedCallbackEvent');
      ev.bind(() => callback());
      ev.reset(delayMs / 1000);
      return () => ev.cancel();
    };

    // Resolve the InternetModule here, where the Lens Studio `require` global is
    // in scope, and inject it into the transport along with a print-based log.
    let internetModule: unknown;
    try {
      internetModule = require('LensStudio:InternetModule');
      print('[MidiClientComponent] InternetModule resolved');
    } catch (e) {
      print('[MidiClientComponent] FAILED to resolve InternetModule: ' + String(e));
    }

    this.transport = new SpectaclesWebSocketTransport({
      url: this.bridgeUrl,
      internetModule: internetModule as never,
      log: (msg: string) => print(msg),
      schedule,
    });

    this.client = new MidiClient(this.transport);

    this.client.on('connect', () => print('[MidiClientComponent] connected to ' + this.bridgeUrl));
    this.client.on('disconnect', () => print('[MidiClientComponent] disconnected'));

    if (this.autoConnect) {
      this.client.connect().catch((e: unknown) => {
        print('[MidiClientComponent] connect() rejected: ' + String(e));
      });
    }

    this.createEvent('OnDestroyEvent').bind(() => {
      this.client?.close();
    });
  }
}
