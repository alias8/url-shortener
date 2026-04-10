import { Request, Response, Router } from 'express';
import { prisma } from '../../db/prisma';

const router = Router();

router.get('/:shortCode', async (req: Request, res: Response) => {
  const shortUrl = req.params.shortCode as string;
  if (!shortUrl) {
    return res.status(404).json({ error: `Need shortUrl in query` });
  }
  try {
    const savedUrl = await prisma.url.findFirst({
      where: { short_url: shortUrl },
    });
    if (savedUrl) {
      return res.redirect(savedUrl.long_url);
    }
    return res.status(404).json({ error: 'Short url not found' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
