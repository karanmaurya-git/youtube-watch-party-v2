import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const signToken = (userId) =>
  jwt.sign({ sub: String(userId) }, env.jwtSecret, { expiresIn: env.jwtExpire });

/** Returns the user id stored in the token, or null if the token is invalid/expired. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret).sub;
  } catch {
    return null;
  }
}
