import 'dotenv/config';
import http from 'http';
import app from './app';
import { Server } from 'ws';
import { Redis } from 'ioredis';
import { WebsocketConnectionManager } from './WebsocketConnectionManager';
import { RedisIncomingMessageService } from './services/messageService/RedisIncomingMessageService';
import { WebSocketIncomingMessageService } from './services/messageService/WebSocketIncomingMessageService';
import { setupWebsocketAndRedisEventWiring } from './websocketAndRedisEventWiring';

const port = process.env.PORT ?? 3000;

/*
 * Three Redis connections:
 *   redisPublish   — publishing messages to channels
 *   redisSubscribe — subscribing to channels (a subscribed client can't publish)
 *   redisGeo       — general-purpose commands (geo, sorted sets, etc.)
 *
 * All server instances share the same Redis server.
 * WebSocket connection state (userIdToWsConnectionMap) is per-instance only.
 */
export const redis = new Redis(); // defaults to localhost:6379; set REDIS_URL for remote

const server = http.createServer(app);
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

const wss = new Server({ server });

export const connectionManager = new WebsocketConnectionManager();
export const redisIncomingMessageService = new RedisIncomingMessageService();
export const webSocketIncomingMessageService = new WebSocketIncomingMessageService();
wss.on('connection', (ws, req) =>
  connectionManager.handleConnection(ws, req, webSocketIncomingMessageService),
);
setupWebsocketAndRedisEventWiring(redisIncomingMessageService, webSocketIncomingMessageService);

// Graceful shutdown — closes HTTP server and Redis connections before exiting
function shutdown() {
  console.log('Shutting down...');
  server.close(() => {
    console.log('HTTP server closed');
    Promise.all([redis.quit()]).then(() => {
      console.log('Redis connections closed');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
