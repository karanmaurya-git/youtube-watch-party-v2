import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret', BCRYPT_ROUNDS: '4', CLIENT_URL: 'http://localhost:5173' },
    testTimeout: 10000,
  },
});
