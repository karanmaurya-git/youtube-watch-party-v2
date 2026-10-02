import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function createAuthRoutes(controller) {
  const router = Router();
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/logout', controller.logout);
  router.post('/ws-ticket', requireAuth, controller.createWsTicket);
  return router;
}
