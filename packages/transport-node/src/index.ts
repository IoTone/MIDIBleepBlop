// SPDX-License-Identifier: MIT
import type { ConnectionState, Transport } from '@midi-bleep-bop/core';
import WebSocket from 'ws';

export interface NodeTransportOptions {
  url: string;
  reconnect?: boolean;
  reconnectMaxMs?: number;
}

export class NodeTransport implements Transport {
  private socket: WebSocket | undefined;
  private messageHandler: ((data: Uint8Array) => void) | undefined;
  private stateHandler: ((state: ConnectionState) => void) | undefined;
  private currentState: ConnectionState = 'closed';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly options: NodeTransportOptions) {
    this.openSocket();
  }

  send(data: Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(data, { binary: true });
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.setState('closed');
  }

  private openSocket(): void {
    this.setState('connecting');
    const socket = new WebSocket(this.options.url);
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.setState('open');
    });

    socket.on('message', (data, isBinary) => {
      if (!this.messageHandler) return;
      if (!isBinary) return;
      // ws gives us a Buffer; normalize to a fresh Uint8Array
      const buf = Array.isArray(data) ? Buffer.concat(data) : (data as Buffer);
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      this.messageHandler(bytes);
    });

    socket.on('error', () => {
      // surface state via 'close', which always fires after an error
    });

    socket.on('close', () => {
      this.socket = undefined;
      if (this.closed) return;
      // Always surface a 'closed' transition so consumers see disconnect events.
      this.setState('closed');
      if (this.options.reconnect === false) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const max = this.options.reconnectMaxMs ?? 5000;
    const backoffs = [500, 1000, 2000, 5000];
    const delay = Math.min(backoffs[Math.min(this.reconnectAttempt, backoffs.length - 1)]!, max);
    this.reconnectAttempt++;
    this.setState('connecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closed) this.openSocket();
    }, delay);
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateHandler?.(state);
  }
}
