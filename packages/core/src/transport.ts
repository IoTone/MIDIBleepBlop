// SPDX-License-Identifier: MIT
export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface Transport {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onStateChange(handler: (state: ConnectionState) => void): void;
  close(): void;
}

export class MockTransport implements Transport {
  readonly sent: Uint8Array[] = [];
  private messageHandler: ((data: Uint8Array) => void) | undefined;
  private stateHandler: ((state: ConnectionState) => void) | undefined;
  private currentState: ConnectionState = 'open';

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateHandler = handler;
    handler(this.currentState);
  }

  close(): void {
    this.setState('closed');
  }

  // Test helpers

  simulateMessage(data: Uint8Array): void {
    this.messageHandler?.(data);
  }

  setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateHandler?.(state);
  }
}
