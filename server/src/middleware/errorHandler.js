import { AppError } from '../utils/errors.js';
import { isProd } from '../config/env.js';

export function notFound(_req, res) {
  res.status(404).json({ success: false, message: 'Route not found' });
}

// Express 5 forwards errors thrown in async handlers here automatically.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ success: false, message: 'Invalid request body' });
  }
  console.error(err);
  return res.status(500).json({
    success: false,
    message: isProd ? 'Internal server error' : err.message,
  });
}
