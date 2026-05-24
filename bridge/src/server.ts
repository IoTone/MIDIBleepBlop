import { createServer, type Server as HttpServer } from 'node:http';
import express, { type Express } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { MidiIO, MidiInput, MidiOutput } from './midi.js';

export interface BridgeServerOptions {
  port: number;
  inputPattern: string;
  outputPattern: string;
  midi: MidiIO;
  onLog?: (level: 'info' | 'error' | 'debug', msg: string) => void;
}

export interface BridgeServerStartInfo {
  port: number;
  inputName: string;
  outputName: string;
}

export class BridgeServer {
  private readonly app: Express = express();
  private httpServer: HttpServer | undefined;
  private wss: WebSocketServer | undefined;
  private input: MidiInput | undefined;
  private output: MidiOutput | undefined;
  private startedAt: Date | undefined;
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly options: BridgeServerOptions) {
    this.registerBuiltInRoutes();
  }

  /**
   * The underlying Express app. Exposed so future features (file serving,
   * playback control) can register additional routes without modifying this
   * class. Routes registered here run on the same port as the WebSocket.
   */
  get express(): Express {
    return this.app;
  }

  async start(): Promise<BridgeServerStartInfo> {
    this.input = await this.options.midi.openInput(this.options.inputPattern);
    this.output = await this.options.midi.openOutput(this.options.outputPattern);

    this.input.onData((bytes) => {
      for (const client of this.clients) {
        if (client.readyState !== client.OPEN) continue;
        client.send(bytes, { binary: true });
      }
    });

    const httpServer = createServer(this.app);
    this.httpServer = httpServer;

    // ws is attached in noServer mode so Express owns the HTTP server.
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
        if (!this.output) return;
        const buf = Array.isArray(data) ? Buffer.concat(data) : (data as Buffer);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        if (bytes.length === 0) return;
        if ((bytes[0]! & 0x80) === 0) {
          this.log('debug', `dropping non-status frame (first byte: 0x${bytes[0]!.toString(16)})`);
          return;
        }
        this.output.send(bytes);
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
    return { port, inputName: this.input.name, outputName: this.output.name };
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
      // Available since Node 18.2, supported in Bun. Under Bun, closeAllConnections
      // already takes the server down, so close() reports "Server is not running" —
      // treat that as success.
      this.httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
    await this.input?.close();
    await this.output?.close();
  }

  private registerBuiltInRoutes(): void {
    this.app.get('/status', (_req, res) => {
      res.json({
        ok: this.input !== undefined && this.output !== undefined,
        startedAt: this.startedAt?.toISOString() ?? null,
        clients: this.clients.size,
        input: this.input?.name ?? null,
        output: this.output?.name ?? null,
      });
    });
  }

  private log(level: 'info' | 'error' | 'debug', msg: string): void {
    this.options.onLog?.(level, msg);
  }
}
