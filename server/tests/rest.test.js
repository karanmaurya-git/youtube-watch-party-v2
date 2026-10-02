import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { TicketService } from '../src/services/ticketService.js';
import { RoomManager } from '../src/websocket/RoomManager.js';

let app;
let roomManager;
let ticketService;

beforeAll(() => {
  ticketService = new TicketService();
  roomManager = new RoomManager();
  app = createApp({ roomManager, ticketService });
});
afterAll(() => {
  roomManager.shutdown();
  ticketService.close();
});

const credentials = { name: 'Karan', email: 'karan@test.dev', password: 'password123' };

describe('health', () => {
  it('GET /api/health returns 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Server is running' });
  });
});

describe('auth', () => {
  it('registers a user, hashes the password, and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/register').send(credentials);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toEqual({ id: expect.any(String), name: 'Karan', email: 'karan@test.dev' });
    expect(res.body.user.password).toBeUndefined();

    const { findUserByEmail } = await import('../src/services/userService.js');
    const stored = await findUserByEmail('karan@test.dev');
    expect(stored.password).not.toBe(credentials.password);
    expect(stored.password).toMatch(/^\$2[aby]\$/); // bcrypt hash
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app).post('/api/auth/register').send(credentials);
    expect(res.status).toBe(409);
  });

  it('rejects invalid registration input with 400', async () => {
    expect((await request(app).post('/api/auth/register').send({ ...credentials, email: 'nope' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ ...credentials, email: 'a@b.co', password: 'short' })).status).toBe(400);
  });

  it('logs in with the right password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong password and unknown email with 401', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: credentials.email, password: 'wrong-password' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.dev', password: 'password123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });
});

describe('protected routes and rooms', () => {
  let token;
  beforeAll(async () => {
    token = (await request(app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password })).body.token;
  });

  it('requires a valid token', async () => {
    expect((await request(app).get('/api/rooms')).status).toBe(401);
    expect((await request(app).post('/api/rooms')).status).toBe(401);
    expect((await request(app).post('/api/auth/ws-ticket').send({ roomId: 'ABC234' })).status).toBe(401);
    expect((await request(app).get('/api/rooms').set('Authorization', 'Bearer not-a-token')).status).toBe(401);
  });

  it('creates a room with a unique 6-character code and the creator as host', async () => {
    const a = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`);
    const b = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`);
    expect(a.status).toBe(201);
    expect(a.body.room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(a.body.room.roomId).not.toBe(b.body.room.roomId);
    expect(a.body.room.hostId).toBeTruthy();
  });

  it('looks up a room and lists my rooms', async () => {
    const created = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`);
    const roomId = created.body.room.roomId;
    const got = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${token}`);
    expect(got.status).toBe(200);
    expect(got.body.room.roomId).toBe(roomId);
    expect((await request(app).get('/api/rooms/ZZZZZ9').set('Authorization', `Bearer ${token}`)).status).toBe(404);
    expect((await request(app).get('/api/rooms/bad').set('Authorization', `Bearer ${token}`)).status).toBe(400);

    const list = await request(app).get('/api/rooms').set('Authorization', `Bearer ${token}`);
    expect(list.body.rooms.some((r) => r.roomId === roomId)).toBe(true);
  });

  it('only the host can delete a room, and it disappears everywhere', async () => {
    const auth = (t) => ({ Authorization: `Bearer ${t}` });
    const other = (await request(app).post('/api/auth/register').send({ name: 'Other', email: 'other@test.dev', password: 'password123' })).body.token;
    const roomId = (await request(app).post('/api/rooms').set(auth(token))).body.room.roomId;

    expect((await request(app).delete(`/api/rooms/${roomId}`)).status).toBe(401);
    expect((await request(app).delete('/api/rooms/bad').set(auth(token))).status).toBe(400);
    expect((await request(app).delete('/api/rooms/ZZZZZ9').set(auth(token))).status).toBe(404);
    expect((await request(app).delete(`/api/rooms/${roomId}`).set(auth(other))).status).toBe(403);
    expect((await request(app).get(`/api/rooms/${roomId}`).set(auth(token))).status).toBe(200);

    expect((await request(app).delete(`/api/rooms/${roomId}`).set(auth(token))).status).toBe(200);
    expect((await request(app).get(`/api/rooms/${roomId}`).set(auth(token))).status).toBe(404);
    const list = await request(app).get('/api/rooms').set(auth(token));
    expect(list.body.rooms.some((r) => r.roomId === roomId)).toBe(false);
  });

  it('issues a ws-ticket only for existing rooms', async () => {
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`)).body.room.roomId;
    const ok = await request(app).post('/api/auth/ws-ticket').set('Authorization', `Bearer ${token}`).send({ roomId });
    expect(ok.status).toBe(200);
    expect(ok.body.ticket).toMatch(/^[a-f0-9]{48}$/);
    const missing = await request(app).post('/api/auth/ws-ticket').set('Authorization', `Bearer ${token}`).send({ roomId: 'ZZZZZ9' });
    expect(missing.status).toBe(404);
  });
});
