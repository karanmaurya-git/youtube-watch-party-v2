import { vi } from 'vitest';

// Every test file uses fake models instead of a real MongoDB connection.
vi.mock('../src/models/User.js', async () => ({ default: (await import('./helpers/fakeModels.js')).FakeUser }));
vi.mock('../src/models/Room.js', async () => ({ default: (await import('./helpers/fakeModels.js')).FakeRoom }));
