import { WebSocketServer } from 'ws';
import { allowedOrigins } from '../config/env.js';
import { LIMITS } from './constants.js';
import { MessageHandler } from './MessageHandler.js';

function rejectUpgrade(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Attaches a `ws` server to the same HTTP server as Express (no custom path).
 * The upgrade request is authenticated with a one-time ticket BEFORE the WebSocket exists.
 */
export function setupWebSocket({ server, roomManager, ticketService, persistence }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.MAX_MESSAGE_BYTES });
  const handler = new MessageHandler({ roomManager, persistence });

  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins().includes(origin)) return rejectUpgrade(socket, 403, 'Forbidden');

    const ticket = new URL(req.url, 'http://localhost').searchParams.get('ticket');
    const session = ticketService.consume(ticket); // single use: gone after this call
    if (!session) return rejectUpgrade(socket, 401, 'Unauthorized');

    return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, session));
  });

  wss.on('connection', (ws, session) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    handler.handleConnection(ws, session);
  });

  // Heartbeat: ping every 30s, terminate sockets that never answered. Also keeps
  // proxies (Render) from closing idle connections.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
      } else {
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, LIMITS.HEARTBEAT_MS);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
