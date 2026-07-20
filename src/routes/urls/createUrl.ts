import { Request, Response, Router } from 'express';
import { getJwtToken } from '../../utils/db/user';
import { prisma } from '../../db/prisma';
import crypto from 'crypto';
import { backOff } from 'exponential-backoff';

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
    // The DB's unique constraint on short_url is the real source of truth, not a pre-check —
    // two servers can otherwise both see a code as free and race to insert it. Each retry
    // (whether from a collision or a transient DB error) generates a fresh candidate code.
    let attempt = 0;
    const savedUrl = await backOff(
      () =>
        prisma.url.create({
          data: {
            long_url: longUrl,
            short_url: getShortUrlCandidate(longUrl, attempt++),
            owner_id: userId,
          },
        }),
      {
        numOfAttempts: 10,
        startingDelay: 50,
      },
    );
    res.json({ shortUrl: savedUrl.short_url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

function getShortUrlCandidate(longUrl: string, attempt: number): string {
  return crypto.createHash('md5').update(`${longUrl},${attempt}`).digest('hex').slice(0, 6);
}

export default router;
