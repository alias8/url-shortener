import { Request, Response, Router } from 'express';
import { prisma } from '../../db/prisma';
import { redis } from '../../server';
import { sendClickToRedisQueue } from '../../utils/redisClickQueue';

const router = Router();
const ONE_DAY = 60 * 60 * 24;

// short_url key will have this value:
export interface RedisShortUrlLookup {
  longUrl: string;
  urlId: string;
}

export const REDIS_CLICKS_QUEUE_KEY = 'clicks_queue';

router.get('/:shortCode', async (req: Request, res: Response) => {
  const shortUrl = req.params.shortCode as string;
  if (!shortUrl) {
    return res.status(404).json({ error: `Need shortUrl in query` });
  }

  try {
    const redisGetUrlCache = await getUrlCache(shortUrl);
    if (redisGetUrlCache) {
      sendClickToRedisQueue({
        ip_address: 'ip_address1',
        user_agent: 'user_agent1',
        referrer: 'referrer1',
        url_id: redisGetUrlCache.urlId,
      });
      return res.redirect(redisGetUrlCache.longUrl);
    }
    const savedUrl = await prisma.url.findFirst({
      where: { short_url: shortUrl },
    });
    if (savedUrl) {
      const data: RedisShortUrlLookup = { longUrl: savedUrl.long_url, urlId: savedUrl.id };
      sendClickToRedisQueue({
        ip_address: 'ip_address1',
        user_agent: 'user_agent1',
        referrer: 'referrer1',
        url_id: savedUrl.id,
      });
      setUrlCache(shortUrl, data);
      return res.redirect(savedUrl.long_url);
    }
    return res.status(404).json({ error: 'Short url not found' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function setUrlCache(shortUrl: string, data: RedisShortUrlLookup) {
  redis.set(shortUrl, JSON.stringify(data), 'EX', ONE_DAY);
}

async function getUrlCache(shortUrl: string): Promise<RedisShortUrlLookup | null> {
  const raw = await redis.get(shortUrl);
  return raw ? JSON.parse(raw) : null;
}

export default router;
