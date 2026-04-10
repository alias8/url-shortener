import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { getJwtToken, getUserByUsername } from '../../utils/db/user';
import jwt from 'jsonwebtoken';
import { JwtToken } from '../../types/express';
import { prisma } from '../../db/prisma';

const router = Router();

interface CreateShortUrlRequest {
  originalUrl: string;
}

router.post('/', async (req: Request, res: Response) => {
  const originalUrl  = req.query.originalUrl
  if(!originalUrl) {
    res.status(404).json({ error: `Need url in query` });
  }
  const jwtToken = getJwtToken(req, res)
  if(!jwtToken) {
    return res.status(404).json({ error: `Bad jwt` });
  }
  const userId = jwtToken.userId
  try {
    const shortUrl =    prisma.url.create({
      data: { username, password_hash },
    });

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const payload: JwtToken = { userId: user.user_id };
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '24h' });
    res.json({ token });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
