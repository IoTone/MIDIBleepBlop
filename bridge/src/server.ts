// SPDX-License-Identifier: MIT
import { createServer, type Server as HttpServer } from 'node:http';
import express, { type Express } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MidiIO, MidiInput, MidiOutput } from './midi.js';

export interface ChannelRoute {
  /** MIDI channel 0-15. */
  channel: number;
  /** Device name substring for this channel's output. */
  pattern: string;
}

export interface BridgeServerOptions {
  port: number;
  inputPattern: string;
  /** Default output: receives unmapped channels + system (channel-less) messages. */
  outputPattern: string;
  /** Optional per-channel output overrides. */
  routes?: ChannelRoute[];
  midi: MidiIO;
  onLog?: (level: 'info' | 'error' | 'debug', msg: string) => void;
}

export interface BridgeServerStartInfo {
  port: number;
  inputName: string;
  /** The default output's resolved name. */
  outputName: string;
  /** channel → resolved output name, for channels with a route. */
  routedOutputs: Array<{ channel: number; outputName: string }>;
}

export class BridgeServer {
  private readonly app: Express = express();
  private httpServer: HttpServer | undefined;
  private wss: WebSocketServer | undefined;
  private input: MidiInput | undefined;
  private defaultOutput: MidiOutput | undefined;
  // channelOutput[ch] is the output for channel ch (route override or default).
  private readonly channelOutput: Array<MidiOutput | undefined> = new Array(16);
  // All distinct opened outputs, keyed by the pattern used to open them (dedupe).
  private readonly outputsByPattern = new Map<string, MidiOutput>();
  private startedAt: Date | undefined;
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly options: BridgeServerOptions) {
    this.registerBuiltInRoutes();
  }

  get express(): Express {
    return this.app;
  }

  async start(): Promise<BridgeServerStartInfo> {
    this.input = await this.options.midi.openInput(this.options.inputPattern);

    // Default output, then per-channel route outputs (deduped by pattern).
    this.defaultOutput = await this.resolveOutput(this.options.outputPattern);
    for (let ch = 0; ch < 16; ch++) this.channelOutput[ch] = this.defaultOutput;

    const routedOutputs: Array<{ channel: number; outputName: string }> = [];
    for (const route of this.options.routes ?? []) {
      if (route.channel < 0 || route.channel > 15) {
        this.log('error', `ignoring route for out-of-range channel ${route.channel}`);
        continue;
      }
      const out = await this.resolveOutput(route.pattern);
      this.channelOutput[route.channel] = out;
      routedOutputs.push({ channel: route.channel, outputName: out.name });
    }

    this.input.onData((bytes) => {
      for (const client of this.clients) {
        if (client.readyState !== client.OPEN) continue;
        client.send(bytes, { binary: true });
      }
    });

    const httpServer = createServer(this.app);
    this.httpServer = httpServer;

    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;

    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.log('info', `client connected (${this.clients.size} active)`);

      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const buf = Array.isArray(data) ? Buffer.concat(data) : (data as Buffer);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        if (bytes.length === 0) return;
        const status = bytes[0]!;
        if ((status & 0x80) === 0) {
          this.log('debug', `dropping non-status frame (first byte: 0x${status.toString(16)})`);
          return;
        }
        this.outputFor(status).send(bytes);
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.log('info', `client disconnected (${this.clients.size} active)`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(this.options.port, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });

    this.startedAt = new Date();
    const addr = httpServer.address();
    const port = typeof addr === 'string' || !addr ? this.options.port : addr.port;
    return {
      port,
      inputName: this.input.name,
      outputName: this.defaultOutput.name,
      routedOutputs,
    };
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    this.clients.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
    }
    if (this.httpServer) {
      // closeAllConnections forces termination of upgraded sockets that
      // httpServer.close() would otherwise wait on forever (notably under Bun).
      this.httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
    await this.input?.close();
    for (const out of this.outputsByPattern.values()) await out.close();
  }

  // Resolve a status byte to the output its channel routes to. Channel voice
  // messages are 0x80-0xEF (channel = status & 0x0F); system messages (0xF0+)
  // have no channel and go to the default output.
  private outputFor(status: number): MidiOutput {
    if (status >= 0x80 && status <= 0xef) {
      const ch = status & 0x0f;
      return this.channelOutput[ch] ?? this.defaultOutput!;
    }
    return this.defaultOutput!;
  }

  private async resolveOutput(pattern: string): Promise<MidiOutput> {
    const existing = this.outputsByPattern.get(pattern);
    if (existing) return existing;
    const out = await this.options.midi.openOutput(pattern);
    this.outputsByPattern.set(pattern, out);
    return out;
  }

  private registerBuiltInRoutes(): void {
    this.app.get('/status', (_req, res) => {
      const routes: Array<{ channel: number; output: string }> = [];
      for (let ch = 0; ch < 16; ch++) {
        const out = this.channelOutput[ch];
        if (out && out !== this.defaultOutput) routes.push({ channel: ch, output: out.name });
      }
      res.json({
        ok: this.input !== undefined && this.defaultOutput !== undefined,
        startedAt: this.startedAt?.toISOString() ?? null,
        clients: this.clients.size,
        input: this.input?.name ?? null,
        output: this.defaultOutput?.name ?? null,
        routes,
      });
    });
  }

  private log(level: 'info' | 'error' | 'debug', msg: string): void {
    this.options.onLog?.(level, msg);
  }
}
