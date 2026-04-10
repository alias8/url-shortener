import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import logger from 'morgan';
import cookieParser from 'cookie-parser';
import createError, { HttpError } from 'http-errors';

import usersRouter from './routes/users';
import urlRouter from './routes/urls';
import { authenticateJwtToken } from './middleware/auth';
import getRedirectUrlRouter from './routes/urls/redirect';

export const app = express();

app.use(cors());
app.use(logger('dev'));
app.use(express.json());
app.use(cookieParser());
app.use(authenticateJwtToken);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/users', usersRouter);
app.use('/urls', urlRouter);
app.use('/', getRedirectUrlRouter); // Must be before the auth

// 404 handler
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404));
});

// error handler
app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.status || 500).json({ error: err.message });
});

export default app;
