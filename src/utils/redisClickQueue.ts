import { redis } from '../server';
import { REDIS_CLICKS_QUEUE_KEY } from '../routes/urls/redirect';

export interface ClickDataInRedis {
  ip_address: string;
  user_agent: string;
  referrer: string;
  url_id: string;
}

export function sendClickToRedisQueue(data: ClickDataInRedis) {
  redis.rpush(REDIS_CLICKS_QUEUE_KEY, JSON.stringify(data));
}
export async function getClickQueueCacheNextItem(): Promise<ClickDataInRedis | null> {
  const result = await redis.blpop(REDIS_CLICKS_QUEUE_KEY, 5);
  return result ? JSON.parse(result[1]) : null;
}
