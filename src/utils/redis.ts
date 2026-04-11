import { redis } from '../server';

export function publishToRedis(channel: string, message: object): void {
  redis.publish(channel, JSON.stringify(message));
}
