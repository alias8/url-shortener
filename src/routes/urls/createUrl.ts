import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { getJwtToken, getUserByUsername } from '../../utils/db/user';
import jwt from 'jsonwebtoken';
import { JwtToken } from '../../types/express';
import { prisma } from '../../db/prisma';

const router = Router();

interface CreateShortUrlRequest {
  longUrl: string;
}

router.post('/', async (req: Request, res: Response) => {
  const longUrl  = req.query.originalUrl
  if(!longUrl || typeof longUrl != 'string') {
    return res.status(404).json({ error: `Need url in query` });
  }
  const jwtToken = getJwtToken(req, res)
  if(!jwtToken) {
    return res.status(404).json({ error: `Bad jwt` });
  }
  const userId = jwtToken.userId
  const shortUrl = "" // hash something
  try {
    const shortUrl =    prisma.url.create({
      data: { longUrl },
    });
    res.json({ shortUrl });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
