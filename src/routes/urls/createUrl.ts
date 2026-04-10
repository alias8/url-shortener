import { Request, Response, Router } from 'express';
import { getJwtToken } from '../../utils/db/user';
import { prisma } from '../../db/prisma';
import crypto from 'crypto';

const router = Router();

interface CreateShortUrlRequest {
  longUrl: string;
}

router.post('/', async (req: Request, res: Response) => {
  const { longUrl } = req.body as CreateShortUrlRequest;
  if (!longUrl) {
    return res.status(404).json({ error: `Need url in query` });
  }
  const jwtToken = getJwtToken(req, res);
  if (!jwtToken) {
    return res.status(404).json({ error: `Bad jwt` });
  }
  const userId = jwtToken.userId;
  try {
    const shortUrl = await getShortUrl(longUrl);
    const savedUrl = await prisma.url.create({
      data: { long_url: longUrl, short_url: shortUrl, owner_id: userId },
    });
    res.json({ shortUrl: savedUrl.short_url });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function getShortUrl(longUrl: string, count: number = 0) {
  if (count > 10) {
    throw Error(`Too many recursions in getting short url ${longUrl}`);
  }
  const shortUrl = crypto.createHash('md5').update(`${longUrl}${count}`).digest('hex').slice(0, 6);
  const exists =
    (await prisma.url.count({
      where: { short_url: shortUrl },
    })) > 0;
  if (exists) {
    return await getShortUrl(longUrl, count + 1);
  } else {
    return shortUrl;
  }
}

export default router;
