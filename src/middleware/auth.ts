import jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { JwtToken } from '../types/express';
import { WebSocket } from 'ws';
import http from 'http';
import { URL } from 'node:url';
import { asUserId, UserId } from '../types/user';

interface PublicRoutes {
  method: string;
  path?: string;
  regex?: RegExp;
}
const PUBLIC_ROUTES: PublicRoutes[] = [
  { path: '/users/login', method: 'POST' },
  { path: '/users/register', method: 'POST' },
  { regex: new RegExp('^\\/[a-z0-9]+$', 'i'), method: 'GET' }, // the GET /:shortCode path
];

export const authenticateJwtToken = (req: Request, res: Response, next: NextFunction) => {
  const isPublic = PUBLIC_ROUTES.some((r) => {
    if (r.path === req.path && r.method === req.method) {
      return true;
    }
    return !!(r.regex?.test(req.path) && r.method === req.method);
  });
  if (isPublic) return next();
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <token>"
  if (!token) return res.status(401).json({ message: 'Access denied: No token provided' });

  try {
    const decodedJwtToken = jwt.verify(token, process.env.JWT_SECRET!);
    if (typeof decodedJwtToken !== 'string' && decodedJwtToken !== undefined) {
      req.jwtToken = decodedJwtToken as JwtToken;
      next();
    } else {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

export function getUserIdFromWebsocket(
  ws: WebSocket,
  req: http.IncomingMessage,
): false | { userId: UserId } {
  const { url } = req;
  if (!url) {
    console.error(`No url in websocket req, closing connection`);
    ws.close();
    return false;
  }
  const myUrl = new URL(url, 'http://localhost:3000');
  const jwtToken = myUrl.searchParams.get('token');
  if (!jwtToken) {
    console.error(`Jwt token not present in url`);
    return false;
  }

  try {
    const decodedToken = jwt.verify(jwtToken, process.env.JWT_SECRET!);
    if (typeof decodedToken !== 'string' && decodedToken !== undefined) {
      const { userId } = decodedToken as JwtToken;
      return { userId: asUserId(userId) };
    }
    return false;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(`Error during websocket connection ${message}`);
    return false;
  }
}
