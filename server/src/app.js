import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { allowedOrigins, env } from './config/env.js';
import { AppError } from './utils/errors.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createAuthController } from './controllers/authController.js';
import { createRoomController } from './controllers/roomController.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createRoomRoutes } from './routes/roomRoutes.js';

/** Builds the Express app. Kept separate from index.js so tests can use it without listening. */
export function createApp({ roomManager, ticketService }) {
  const app = express();
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header = non-browser client (curl, health checks); browsers must be allow-listed.
        if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
        return callback(new AppError('Origin not allowed', 403));
      },
    })
  );
  app.use(express.json({ limit: '10kb' }));

  app.get('/', (_req, res) => res.json({ success: true, message: 'YouTube Watch Party API' }));
  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'Server is running' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.nodeEnv === 'test' ? 10_000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' },
  });

  app.use('/api/auth', authLimiter, createAuthRoutes(createAuthController({ ticketService, roomManager })));
  app.use('/api/rooms', createRoomRoutes(createRoomController({ roomManager })));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
