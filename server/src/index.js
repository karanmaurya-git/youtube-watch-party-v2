import http from 'node:http';
import { env, validateEnv } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { TicketService } from './services/ticketService.js';
import { RoomManager } from './websocket/RoomManager.js';
import { setupWebSocket } from './websocket/index.js';

validateEnv();
await connectDB(env.mongoUri);

const ticketService = new TicketService();
const roomManager = new RoomManager();
const server = http.createServer(createApp({ roomManager, ticketService }));
const wss = setupWebSocket({ server, roomManager, ticketService });

server.listen(env.port, () => console.log(`Server listening on port ${env.port} (${env.nodeEnv})`));

async function shutdown() {
  console.log('Shutting down...');
  wss.close();
  roomManager.shutdown();
  ticketService.close();
  server.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
