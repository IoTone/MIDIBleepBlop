import type { ConnectionState, Transport } from '@midi-bleep-bop/core';

// Lens Studio's WebSocket type is intentionally not pulled in here — the file is
// compiled both for tsc type-checking (where these types don't exist) and for
// embedding into a Lens Studio project. We rely on runtime duck-typing via
// `require("LensStudio:InternetModule")`.
//
// The shape we depend on:
//   internetModule.createWebSocket(url: string): WebSocket
//   WebSocket: { onopen, onclose, onerror, onmessage, send, close, binaryType, readyState }
//   message event: { data: Blob | string }, with Blob.bytes() returning a Promise<Uint8Array>.

interface LSWebSocket {
  binaryType: string;
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: Uint8Array | string): void;
  close(): void;
}

interface LSInternetModule {
  createWebSocket(url: string, protocols?: string | string[]): LSWebSocket;
}

interface LSBlob {
  bytes(): Promise<Uint8Array>;
}

function isBlob(value: unknown): value is LSBlob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { bytes?: unknown }).bytes === 'function'
  );
}

export type Cancel = () => void;
export type Schedule = (callback: () => void, delayMs: number) => Cancel;

export interface SpectaclesWebSocketTransportOptions {
  url: string;
  reconnect?: boolean;
  reconnectMaxMs?: number;
  /**
   * Optional override for the InternetModule. By default the transport calls
   * `require("LensStudio:InternetModule")` lazily on the first connection.
   * Pass a custom module here for tests or for non-Lens-Studio embeddings.
   */
  internetModule?: LSInternetModule;
  /**
   * How to schedule a callback after a delay. Lens Studio does not expose
   * `setTimeout`; the @component wrapper (`MidiClientComponent`) supplies a
   * `schedule` backed by Lens Studio's `DelayedCallbackEvent`. Outside Lens
   * Studio the transport falls back to `globalThis.setTimeout` if present.
   * Setting this to `null` disables reconnect.
   */
  schedule?: Schedule | null;
  /**
   * Optional log function. Defaults to `print` if available (Lens Studio), then
   * `console.log`. Set to `() => {}` to silence.
   */
  log?: (msg: string) => void;
}

export class SpectaclesWebSocketTransport implements Transport {
  private socket: LSWebSocket | undefined;
  private messageHandler: ((data: Uint8Array) => void) | undefined;
  private stateHandler: ((state: ConnectionState) => void) | undefined;
  private currentState: ConnectionState = 'closed';
  private reconnectAttempt = 0;
  private cancelReconnect: Cancel | undefined;
  private closed = false;
  private readonly log: (msg: string) => void;
  private readonly schedule: Schedule | null;

  constructor(private readonly options: SpectaclesWebSocketTransportOptions) {
    this.log = options.log ?? defaultLog;
    this.schedule = options.schedule === undefined ? defaultSchedule() : options.schedule;
    this.openSocket();
  }

  send(data: Uint8Array): void {
    if (!this.socket) return;
    // 1 = OPEN
    if (this.socket.readyState !== 1) return;
    try {
      this.socket.send(data);
    } catch (e) {
      this.log('[midi-bleep-bop] send failed: ' + String(e));
    }
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateHandler = handler;
    handler(this.currentState);
  }

  close(): void {
    this.closed = true;
    if (this.cancelReconnect) {
      this.cancelReconnect();
      this.cancelReconnect = undefined;
    }
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = undefined;
    this.setState('closed');
  }

  private openSocket(): void {
    this.setState('connecting');
    let module = this.options.internetModule;
    if (!module) {
      try {
        // Lens Studio runtime require — intentionally not statically imported.
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        module = (globalThis as { require?: (name: string) => unknown }).require?.(
          'LensStudio:InternetModule',
        ) as LSInternetModule | undefined;
      } catch (e) {
        this.log('[midi-bleep-bop] could not resolve LensStudio:InternetModule: ' + String(e));
      }
    }
    if (!module) {
      this.log('[midi-bleep-bop] InternetModule unavailable; transport stays closed');
      this.setState('closed');
      return;
    }

    let socket: LSWebSocket;
    try {
      socket = module.createWebSocket(this.options.url);
    } catch (e) {
      this.log('[midi-bleep-bop] createWebSocket failed: ' + String(e));
      this.setState('closed');
      if (!this.closed && this.options.reconnect !== false) this.scheduleReconnect();
      return;
    }

    socket.binaryType = 'blob';
    this.socket = socket;

    socket.onopen = (): void => {
      this.reconnectAttempt = 0;
      this.setState('open');
    };

    socket.onmessage = (event: { data: unknown }): void => {
      const data = event.data;
      if (typeof data === 'string') {
        // text frames are ignored at the wire-protocol level
        return;
      }
      if (!isBlob(data)) return;
      data
        .bytes()
        .then((bytes) => {
          if (bytes.length === 0) return;
          this.messageHandler?.(bytes);
        })
        .catch((e: unknown) => {
          this.log('[midi-bleep-bop] failed to decode binary frame: ' + String(e));
        });
    };

    socket.onerror = (event: unknown): void => {
      this.log('[midi-bleep-bop] socket error: ' + String(event));
    };

    socket.onclose = (event: { code: number; reason: string; wasClean: boolean }): void => {
      this.socket = undefined;
      this.log(
        '[midi-bleep-bop] socket closed (code=' +
          String(event.code) +
          ', clean=' +
          String(event.wasClean) +
          ')',
      );
      if (this.closed) return;
      this.setState('closed');
      if (this.options.reconnect === false) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.schedule) return;
    const max = this.options.reconnectMaxMs ?? 5000;
    const backoffs = [500, 1000, 2000, 5000];
    const delay = Math.min(backoffs[Math.min(this.reconnectAttempt, backoffs.length - 1)]!, max);
    this.reconnectAttempt++;
    this.cancelReconnect = this.schedule(() => {
      this.cancelReconnect = undefined;
      if (!this.closed) this.openSocket();
    }, delay);
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateHandler?.(state);
  }
}

function defaultLog(msg: string): void {
  // Prefer Lens Studio's print(); fall back to console.log when running outside.
  const g = globalThis as { print?: (msg: string) => void; console?: { log?: (...args: unknown[]) => void } };
  if (typeof g.print === 'function') {
    g.print(msg);
  } else if (g.console && typeof g.console.log === 'function') {
    g.console.log(msg);
  }
}

function defaultSchedule(): Schedule | null {
  const g = globalThis as {
    setTimeout?: (cb: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  if (typeof g.setTimeout !== 'function' || typeof g.clearTimeout !== 'function') return null;
  return (callback, delayMs) => {
    const handle = g.setTimeout!(callback, delayMs);
    return () => g.clearTimeout!(handle);
  };
}
