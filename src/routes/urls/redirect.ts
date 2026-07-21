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

router.get('/:shortCode', async (req: Request, res: Response) => {
  const shortUrl = req.params.shortCode as string;
  if (!shortUrl) {
    return res.status(404).json({ error: `Need shortUrl in query` });
  }

  try {
    const redisGetUrlCache = await getUrlCache(shortUrl);
    if (redisGetUrlCache) {
      // Analytics writes → best-effort is often fine, queue + retries if you care
      sendClickToRedisQueue({
        ip_address: 'ip_address1',
        user_agent: 'user_agent1',
        referrer: 'referrer1',
        url_id: redisGetUrlCache.urlId,
      });
      return res.redirect(redisGetUrlCache.longUrl);
    }
    // User-facing reads → fail fast, clear error, let the client retry.
    // findUnique (not findFirst) since short_url is a unique index — same result, but makes the
    // lookup strategy explicit and lets Prisma use the unique-index-backed query path.
    const savedUrl = await prisma.url.findUnique({
      where: { short_url: shortUrl },
    });
    if (savedUrl) {
      // savedUrl.id is a bigint (Url.id) — stringify before it crosses a JSON boundary (Redis
      // cache, click queue payload), since JSON.stringify throws on raw bigint values.
      const urlId = savedUrl.id.toString();
      const data: RedisShortUrlLookup = { longUrl: savedUrl.long_url, urlId };
      sendClickToRedisQueue({
        ip_address: 'ip_address1',
        user_agent: 'user_agent1',
        referrer: 'referrer1',
        url_id: urlId,
      });
      setUrlCache(shortUrl, data);
      return res.redirect(savedUrl.long_url);
    }
    return res.status(404).json({ error: 'Short url not found' });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
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
