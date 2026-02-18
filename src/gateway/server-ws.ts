import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('ws-server');

interface WSClient {
  id: string;
  ws: WebSocket;
  connectedAt: number;
}

/**
 * WebSocket server for real-time communication with clients (Web UI, CLI, etc.)
 */
export class GatewayWSServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private clientIdCounter = 0;

  /**
   * Attach WebSocket server to an existing HTTP server.
   */
  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws, req) => {
      const clientId = `client-${++this.clientIdCounter}`;
      const client: WSClient = { id: clientId, ws, connectedAt: Date.now() };
      this.clients.set(clientId, client);

      log.info({ clientId, ip: req.socket.remoteAddress }, 'WebSocket client connected');

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch {
          log.warn({ clientId }, 'Invalid WebSocket message received');
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        log.info({ clientId }, 'WebSocket client disconnected');
      });

      ws.on('error', (err) => {
        log.error({ err, clientId }, 'WebSocket client error');
        this.clients.delete(clientId);
      });

      // Send welcome message
      this.send(clientId, { type: 'connected', clientId });
    });

    log.info('WebSocket server attached');
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(clientId: string, message: Record<string, unknown>): void {
    log.debug({ clientId, type: message.type }, 'WS message received');
    // TODO: Route to appropriate handlers
  }

  /**
   * Send a message to a specific client.
   */
  send(clientId: string, data: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(data: Record<string, unknown>): void {
    const payload = JSON.stringify(data);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }
  }

  /**
   * Get connected client count.
   */
  get clientCount(): number {
    return this.clients.size;
  }
}
