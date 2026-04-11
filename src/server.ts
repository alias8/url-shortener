import 'dotenv/config';
import http from 'http';
import app from './app';
import { Server } from 'ws';
import { Redis } from 'ioredis';
import { backOff } from 'exponential-backoff';
import { WebsocketConnectionManager } from './WebsocketConnectionManager';
import { RedisIncomingMessageService } from './services/messageService/RedisIncomingMessageService';
import { WebSocketIncomingMessageService } from './services/messageService/WebSocketIncomingMessageService';
import { setupWebsocketAndRedisEventWiring } from './websocketAndRedisEventWiring';
import { prisma } from './db/prisma';
import { acknowledgeClick, getNextClick, requeueStalledClicks } from './utils/redisClickQueue';

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

let SHUTDOWN_FLAG = false;
// Graceful shutdown — closes HTTP server and Redis connections before exiting
function shutdown() {
  console.log('Shutting down...');
  SHUTDOWN_FLAG = true;
  server.close(() => {
    console.log('HTTP server closed');
    Promise.all([redis.quit()]).then(() => {
      console.log('Redis connections closed');
      process.exit(0);
    });
  });
}

async function startWorker() {
  await requeueStalledClicks(); // recover from previous crash

  while (true) {
    const result = await getNextClick();
    if (result) {
      /*
       * This pattern protects against the situation where prisma crashed after we picked off the value
       * from redis. We want to make sure the value is always saved somewhere before we delete it.
       * If we just did a standard blpop, that value is not in redis and not in postgres, so if postgres
       * or this expressjs server crashes, that value is lost.
       * */
      try {
        await backOff(() => prisma.click.create({ data: result }));
        await acknowledgeClick(result); // only remove after successful write
      } catch (e) {
        // Move to dead letter queue, Amazon SQS or something
      }
    }
    if (SHUTDOWN_FLAG) break;
  }
}

startWorker().then();

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
