import 'dotenv/config';
import http from 'http';
import app from './app';
import { Redis } from 'ioredis';
import { backOff } from 'exponential-backoff';
import { prisma } from './db/prisma';
import { acknowledgeClick, getNextClick, requeueStalledClicks } from './utils/redisClickQueue';

const port = process.env.PORT ?? 3000;

// All server instances share the same Redis server. Used for the short-URL cache
// (see routes/urls/redirect.ts) and the click-tracking queue (see utils/redisClickQueue.ts).
export const redis = new Redis(); // defaults to localhost:6379; set REDIS_URL for remote

const server = http.createServer(app);
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

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
