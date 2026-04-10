import { Request, Response, Router } from 'express';
import { prisma } from '../../db/prisma';
import { redisPublish } from '../../server';

const router = Router();
const ONE_DAY = 60 * 60 * 24;
router.get('/:shortCode', async (req: Request, res: Response) => {
  const shortUrl = req.params.shortCode as string;
  if (!shortUrl) {
    return res.status(404).json({ error: `Need shortUrl in query` });
  }
  const redisCache = await redisPublish.get(shortUrl);
  if (redisCache) {
    return res.redirect(redisCache);
  }
  try {
    const savedUrl = await prisma.url.findFirst({
      where: { short_url: shortUrl },
    });
    if (savedUrl) {
      redisPublish.set(shortUrl, savedUrl.long_url, 'EX', ONE_DAY);
      return res.redirect(savedUrl.long_url);
    }
    return res.status(404).json({ error: 'Short url not found' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
