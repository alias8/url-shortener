import { Request, Response, Router } from 'express';
import { getJwtToken } from '../../utils/db/user';
import { prisma } from '../../db/prisma';
import { backOff } from 'exponential-backoff';
import { encodeId } from '../../utils/shortCode';

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
    // short_url is derived from a reserved id (see src/utils/shortCode.ts), which is a bijection —
    // collisions are structurally impossible, unlike the old md5-slice(6) scheme (only 16^6 ~16.7M
    // possible codes). backOff here just covers transient DB errors, not collision retries.
    const savedUrl = await backOff(
      async () => {
        const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
          SELECT nextval(pg_get_serial_sequence('"Url"', 'id')) AS nextval
        `;
        return prisma.url.create({
          data: {
            id: nextval,
            long_url: longUrl,
            short_url: encodeId(nextval),
            owner_id: userId,
          },
        });
      },
      {
        numOfAttempts: 5,
        startingDelay: 50,
      },
    );
    res.json({ shortUrl: savedUrl.short_url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

export default router;
