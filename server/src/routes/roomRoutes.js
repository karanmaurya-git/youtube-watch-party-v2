import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function createRoomRoutes(controller) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:roomId', controller.get);
  router.delete('/:roomId', controller.remove);
  return router;
}
