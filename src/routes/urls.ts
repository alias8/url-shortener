import { Router } from 'express';
import createUrlRouter from './urls/createUrl';

const router = Router();

router.use('/create', createUrlRouter);

export default router;
