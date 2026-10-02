import { AppError } from '../utils/errors.js';
import { verifyToken } from '../utils/token.js';
import { findUserById } from '../services/userService.js';

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token && verifyToken(token);
  if (!userId) throw new AppError('Authentication required', 401);

  const user = await findUserById(userId);
  if (!user) throw new AppError('Authentication required', 401);

  req.user = { id: String(user._id), name: user.name, email: user.email };
  next();
}
