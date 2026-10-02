import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const stripSlash = (url) => (url || '').replace(/\/+$/, '');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpire: process.env.JWT_EXPIRE || '7d',
  clientUrl: stripSlash(process.env.CLIENT_URL || 'http://localhost:5173'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
};

export const isProd = env.nodeEnv === 'production';

/** Origins allowed for CORS and for the WebSocket upgrade request. */
export function allowedOrigins() {
  const list = [env.clientUrl];
  if (!isProd) list.push('http://localhost:5173', 'http://127.0.0.1:5173');
  return list;
}

export function validateEnv() {
  const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
