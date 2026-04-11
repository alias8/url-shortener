import { redis } from '../server';

export const REDIS_CLICKS_QUEUE_KEY = 'clicks_queue';
const REDIS_CLICKS_PROCESSING_KEY = 'clicks_processing';

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

// Instead of blpop — atomically moves to processing list
export async function getNextClick(): Promise<ClickDataInRedis | null> {
  const value = await redis.brpoplpush(REDIS_CLICKS_QUEUE_KEY, REDIS_CLICKS_PROCESSING_KEY, 5);
  return value ? JSON.parse(value) : null;
}

// Call this after successful Postgres write
export async function acknowledgeClick(value: ClickDataInRedis) {
  await redis.lrem(REDIS_CLICKS_PROCESSING_KEY, 1, JSON.stringify(value));
}

// Call this on startup to recover any crashed in-flight items
export async function requeueStalledClicks() {
  let item: string | null;
  while ((item = await redis.lpop(REDIS_CLICKS_PROCESSING_KEY)) !== null) {
    await redis.rpush(REDIS_CLICKS_QUEUE_KEY, item);
  }
}
