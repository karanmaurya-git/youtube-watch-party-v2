import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestServer, registerUser, createRoom, getTicket, joinAs, TestClient, api,
} from './helpers/testServer.js';
import { getFakeRoomRecord } from './helpers/fakeModels.js';

let srv;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = '9bZkp7q19f0';

/** Host creates a room and a participant joins it. */
async function hostAndParticipant() {
  const host = await registerUser(srv.baseUrl, 'Host');
  const roomId = await createRoom(srv.baseUrl, host.token);
  const a = await joinAs(srv, 'Host', roomId, host.token);
  const b = await joinAs(srv, 'Bob', roomId);
  return { roomId, host: a, bob: b };
}

describe('connection and authentication', () => {
  it('rejects a WebSocket without a ticket or with a bad ticket (401)', async () => {
    await expect(new TestClient(srv.wsUrl, 'nope').opened).rejects.toThrow('HTTP 401');
    await expect(new TestClient(srv.wsUrl, '').opened).rejects.toThrow('HTTP 401');
  });

  it('tickets are single-use', async () => {
    const user = await registerUser(srv.baseUrl, 'Once');
    const roomId = await createRoom(srv.baseUrl, user.token);
    const ticket = await getTicket(srv.baseUrl, user.token, roomId);
    const first = new TestClient(srv.wsUrl, ticket);
    await first.opened;
    await expect(new TestClient(srv.wsUrl, ticket).opened).rejects.toThrow('HTTP 401');
    first.close();
  });

  it('expired tickets are rejected', async () => {
    const user = await registerUser(srv.baseUrl, 'Late');
    const roomId = await createRoom(srv.baseUrl, user.token);
    const ticket = srv.ticketService.issue({ userId: user.user.id, username: 'Late', roomId });
    srv.ticketService.tickets.get(ticket).expiresAt = Date.now() - 1;
    await expect(new TestClient(srv.wsUrl, ticket).opened).rejects.toThrow('HTTP 401');
  });

  it('a ticket cannot be used to join a different room', async () => {
    const user = await registerUser(srv.baseUrl, 'Mixed');
    const roomA = await createRoom(srv.baseUrl, user.token);
    const roomB = await createRoom(srv.baseUrl, user.token);
    const client = new TestClient(srv.wsUrl, await getTicket(srv.baseUrl, user.token, roomA));
    await client.opened;
    client.send('join_room', { roomId: roomB });
    expect((await client.waitFor('error')).code).toBe('ROOM_MISMATCH');
    client.close();
  });

  it('the creator joins as Host, the next user as Participant', async () => {
    const { host, bob } = await hostAndParticipant();
    expect(host.joined.you.role).toBe('host');
    expect(bob.joined.you.role).toBe('participant');
    const userJoined = await host.client.waitFor('user_joined');
    expect(userJoined.username).toBe('Bob');
    expect(userJoined.participants.map((p) => p.role)).toEqual(['host', 'participant']);
  });

  it('answers malformed JSON, bad shapes and unknown events with structured errors', async () => {
    const { host } = await hostAndParticipant();
    host.client.sendRaw('{not json');
    expect((await host.client.waitFor('error')).code).toBe('INVALID_JSON');
    host.client.sendRaw(JSON.stringify([1, 2]));
    expect((await host.client.waitFor('error')).code).toBe('INVALID_MESSAGE');
    host.client.send('format_disk');
    expect((await host.client.waitFor('error')).code).toBe('UNKNOWN_EVENT');
  });

  it('rejects messages before join_room', async () => {
    const user = await registerUser(srv.baseUrl, 'Eager');
    const roomId = await createRoom(srv.baseUrl, user.token);
    const client = new TestClient(srv.wsUrl, await getTicket(srv.baseUrl, user.token, roomId));
    await client.opened;
    client.send('play');
    expect((await client.waitFor('error')).code).toBe('NOT_IN_ROOM');
    client.close();
  });
});

describe('playback synchronization (Host -> Participant)', () => {
  it('syncs change_video, play, pause and seek to the other client', async () => {
    const { host, bob } = await hostAndParticipant();

    host.client.send('change_video', { url: `https://youtu.be/${VIDEO_A}?t=5` });
    let state = await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    expect(state).toMatchObject({ videoId: VIDEO_A, isPlaying: true, currentTime: 0 });
    expect(state.updatedAt).toBeTypeOf('number');
    expect(state.serverTime).toBeTypeOf('number');

    host.client.send('pause');
    state = await bob.client.waitFor('sync_state', (s) => s.isPlaying === false);
    expect(state.videoId).toBe(VIDEO_A);

    host.client.send('seek', { time: 80 });
    state = await bob.client.waitFor('sync_state', (s) => s.currentTime === 80);
    expect(state.isPlaying).toBe(false);

    host.client.send('play');
    state = await bob.client.waitFor('sync_state', (s) => s.isPlaying === true);
    expect(state.currentTime).toBe(80);
  });

  it('server ignores a client-supplied updatedAt', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A, updatedAt: 1 });
    const state = await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    expect(state.updatedAt).toBeGreaterThan(1_000_000_000_000);
  });

  it('rejects invalid URLs and invalid seek times', async () => {
    const { host } = await hostAndParticipant();
    host.client.send('change_video', { url: 'https://example.com/video' });
    expect((await host.client.waitFor('error')).code).toBe('INVALID_VIDEO');
    host.client.send('change_video', { videoId: VIDEO_A });
    await host.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    host.client.send('seek', { time: -5 });
    expect((await host.client.waitFor('error')).code).toBe('INVALID_PAYLOAD');
    host.client.send('seek', { time: 'soon' });
    expect((await host.client.waitFor('error')).code).toBe('INVALID_PAYLOAD');
  });

  it('a late joiner receives the current video, time and play state', async () => {
    const { roomId, host } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    host.client.send('seek', { time: 50 });
    await new Promise((r) => setTimeout(r, 100));
    const late = await joinAs(srv, 'Late', roomId);
    const received = late.client.messages.find((m) => m.type === 'sync_state').payload;
    expect(received.videoId).toBe(VIDEO_A);
    expect(received.isPlaying).toBe(true);
    const expected = received.currentTime + (received.serverTime - received.updatedAt) / 1000;
    expect(expected).toBeGreaterThanOrEqual(50);
    expect(expected).toBeLessThan(55);
  });

  it('a late joiner in a paused room stays paused at the right time', async () => {
    const { roomId, host } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_B });
    host.client.send('seek', { time: 33 });
    host.client.send('pause');
    await new Promise((r) => setTimeout(r, 120));
    const late = await joinAs(srv, 'Late2', roomId);
    const received = late.client.messages.filter((m) => m.type === 'sync_state').pop().payload;
    expect(received).toMatchObject({ videoId: VIDEO_B, isPlaying: false });
    expect(received.currentTime).toBeCloseTo(33, 0);
  });
});

describe('RBAC enforced on the server', () => {
  it('a Participant cannot play/pause/seek/change_video, and room state is untouched', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);

    for (const [type, payload] of [['play'], ['pause'], ['seek', { time: 99 }], ['change_video', { videoId: VIDEO_B }]]) {
      bob.client.send(type, payload);
      const err = await bob.client.waitFor('error');
      expect(err.code).toBe('FORBIDDEN');
    }
    expect(await host.client.expectNone('sync_state', 150)).toHaveLength(0);
  });

  it('a Participant cannot assign roles, remove users, or transfer host', async () => {
    const { host, bob } = await hostAndParticipant();
    const hostId = host.joined.you.userId;
    bob.client.send('assign_role', { userId: hostId, role: 'participant' });
    expect((await bob.client.waitFor('error')).code).toBe('FORBIDDEN');
    bob.client.send('remove_participant', { userId: hostId });
    expect((await bob.client.waitFor('error')).code).toBe('FORBIDDEN');
    bob.client.send('transfer_host', { userId: bob.joined.you.userId });
    expect((await bob.client.waitFor('error')).code).toBe('FORBIDDEN');
    expect(await host.client.expectNone('role_assigned')).toHaveLength(0);
    expect(await host.client.expectNone('host_transferred')).toHaveLength(0);
  });

  it('the Host promotes a Participant to Moderator, who can then control playback', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('assign_role', { userId: bob.joined.you.userId, role: 'moderator' });
    const assigned = await bob.client.waitFor('role_assigned');
    expect(assigned).toMatchObject({ role: 'moderator', username: 'Bob' });
    expect(assigned.participants.find((p) => p.username === 'Bob').role).toBe('moderator');
    await host.client.waitFor('role_assigned');

    bob.client.send('change_video', { videoId: VIDEO_A });
    const state = await host.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    expect(state.isPlaying).toBe(true);
  });

  it('a Moderator still cannot assign roles, remove users, or transfer host', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('assign_role', { userId: bob.joined.you.userId, role: 'moderator' });
    await bob.client.waitFor('role_assigned');
    const hostId = host.joined.you.userId;
    bob.client.send('remove_participant', { userId: hostId });
    expect((await bob.client.waitFor('error')).code).toBe('FORBIDDEN');
    bob.client.send('transfer_host', { userId: bob.joined.you.userId });
    expect((await bob.client.waitFor('error')).code).toBe('FORBIDDEN');
  });

  it('the Host cannot target themselves or hand out the host role via assign_role', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('assign_role', { userId: host.joined.you.userId, role: 'participant' });
    expect((await host.client.waitFor('error')).code).toBe('INVALID_TARGET');
    host.client.send('remove_participant', { userId: host.joined.you.userId });
    expect((await host.client.waitFor('error')).code).toBe('INVALID_TARGET');
    host.client.send('assign_role', { userId: bob.joined.you.userId, role: 'host' });
    expect((await host.client.waitFor('error')).code).toBe('INVALID_PAYLOAD');
  });
});

describe('control requests', () => {
  it('a request reaches only Host/Moderators and changes nothing until approved', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    const carol = await joinAs(srv, 'Carol', roomId);
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    host.client.send('pause');
    await bob.client.waitFor('sync_state', (s) => s.isPlaying === false);

    bob.client.send('request_play');
    const ack = await bob.client.waitFor('request_ack');
    const created = await host.client.waitFor('request_created');
    expect(created).toMatchObject({ id: ack.id, type: 'play', username: 'Bob' });
    expect(await carol.client.expectNone('request_created')).toHaveLength(0);
    expect(await host.client.expectNone('sync_state')).toHaveLength(0);

    host.client.send('approve_request', { requestId: created.id });
    const state = await carol.client.waitFor('sync_state', (s) => s.isPlaying === true);
    expect(state.videoId).toBe(VIDEO_A);
    const resolved = await bob.client.waitFor('request_resolved');
    expect(resolved).toMatchObject({ status: 'approved', type: 'play' });
  });

  it('rejecting a request does nothing to playback', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);

    bob.client.send('request_pause');
    const created = await host.client.waitFor('request_created');
    host.client.send('reject_request', { requestId: created.id });
    expect((await bob.client.waitFor('request_resolved')).status).toBe('rejected');
    expect(await bob.client.expectNone('sync_state')).toHaveLength(0);
  });

  it('request_seek and request_change_video apply the requested values on approval', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);

    bob.client.send('request_seek', { time: 120 });
    host.client.send('approve_request', { requestId: (await host.client.waitFor('request_created')).id });
    expect((await bob.client.waitFor('sync_state', (s) => s.currentTime === 120)).currentTime).toBe(120);

    await new Promise((r) => setTimeout(r, 2100)); // request rate limit: 1 per 2s
    bob.client.send('request_change_video', { url: `https://www.youtube.com/watch?v=${VIDEO_B}` });
    host.client.send('approve_request', { requestId: (await host.client.waitFor('request_created', (r) => r.type === 'change_video')).id });
    expect((await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_B)).currentTime).toBe(0);
  });

  it('a Participant cannot approve their own request; a Moderator can approve', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    const mod = await joinAs(srv, 'Mod', roomId);
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    host.client.send('assign_role', { userId: mod.joined.you.userId, role: 'moderator' });
    await mod.client.waitFor('role_assigned');

    bob.client.send('request_pause');
    const created = await mod.client.waitFor('request_created');
    bob.client.send('approve_request', { requestId: created.id });
    expect((await bob.client.waitFor('error')).code).toBe('FORBIDDEN');
    mod.client.send('approve_request', { requestId: created.id });
    expect((await bob.client.waitFor('sync_state', (s) => s.isPlaying === false)).isPlaying).toBe(false);
  });

  it('expires after the TTL and is rate limited', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    bob.client.send('request_pause');
    await host.client.waitFor('request_created');
    bob.client.send('request_play');
    expect((await bob.client.waitFor('error')).code).toBe('RATE_LIMITED');
    expect((await bob.client.waitFor('request_resolved')).status).toBe('expired');
  });

  it('Host/Moderator cannot send requests', async () => {
    const { host } = await hostAndParticipant();
    host.client.send('request_play');
    expect((await host.client.waitFor('error')).code).toBe('FORBIDDEN');
  });
});

describe('host management', () => {
  it('removes a participant: they are notified, disconnected, and cannot rejoin', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    host.client.send('remove_participant', { userId: bob.joined.you.userId });
    expect((await bob.client.waitFor('removed_from_room')).roomId).toBe(roomId);
    const removed = await host.client.waitFor('participant_removed');
    expect(removed.participants).toHaveLength(1);
    expect(await bob.client.closed).toBe(4001);

    bob.client.send('play'); // socket is closed; nothing can come back
    const res = await api(srv.baseUrl, '/auth/ws-ticket', { method: 'POST', token: bob.auth.token, body: { roomId } });
    expect(res.status).toBe(403);
  });

  it('transfers host: old Host becomes Participant, new Host gains control', async () => {
    const { host, bob } = await hostAndParticipant();
    host.client.send('transfer_host', { userId: bob.joined.you.userId });
    const event = await bob.client.waitFor('host_transferred');
    expect(event).toMatchObject({ oldHostId: host.joined.you.userId, newHostId: bob.joined.you.userId, reason: 'transfer' });
    const roles = Object.fromEntries(event.participants.map((p) => [p.username, p.role]));
    expect(roles).toEqual({ Bob: 'host', Host: 'participant' });

    host.client.send('change_video', { videoId: VIDEO_A });
    expect((await host.client.waitFor('error')).code).toBe('FORBIDDEN');
    bob.client.send('change_video', { videoId: VIDEO_A });
    await host.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
  });

  it('promotes a successor when the Host leaves', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    const carol = await joinAs(srv, 'Carol', roomId);
    host.client.send('assign_role', { userId: carol.joined.you.userId, role: 'moderator' });
    await carol.client.waitFor('role_assigned');
    host.client.send('leave_room');
    const left = await bob.client.waitFor('user_left');
    expect(left.reason).toBe('left');
    const event = await bob.client.waitFor('host_transferred');
    expect(event).toMatchObject({ newHostId: carol.joined.you.userId, reason: 'succession' });
  });
});

describe('disconnect grace period and reconnection', () => {
  it('a reconnect within the grace period restores role and state with a fresh ticket', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    host.client.send('assign_role', { userId: bob.joined.you.userId, role: 'moderator' });
    await bob.client.waitFor('role_assigned');
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);

    bob.client.close();
    await bob.client.closed;
    expect(await host.client.expectNone('user_left', 100)).toHaveLength(0); // seat is kept

    const again = await joinAs(srv, 'Bob', roomId, bob.auth.token); // new ticket, same user
    expect(again.joined).toMatchObject({ reconnected: true });
    expect(again.joined.you.role).toBe('moderator');
    expect(again.client.messages.find((m) => m.type === 'sync_state').payload.videoId).toBe(VIDEO_A);
    expect(await host.client.expectNone('user_left', 500)).toHaveLength(0); // grace timer was cleared
  });

  it('removes the participant once the grace period expires', async () => {
    const { host, bob } = await hostAndParticipant();
    bob.client.close();
    const left = await host.client.waitFor('user_left', () => true, 1500);
    expect(left).toMatchObject({ username: 'Bob', reason: 'timeout' });
    expect(left.participants).toHaveLength(1);
  });

  it('a second connection from the same user replaces the first', async () => {
    const { roomId, bob } = await hostAndParticipant();
    const second = await joinAs(srv, 'Bob', roomId, bob.auth.token);
    expect(await bob.client.closed).toBe(4002);
    expect(second.joined.reconnected).toBe(true);
  });
});

describe('chat', () => {
  it('delivers chat inside the room and never to another room', async () => {
    const { host, bob } = await hostAndParticipant();
    const other = await hostAndParticipant();

    bob.client.send('chat_message', { message: '  Nice video!  ' });
    const msg = await host.client.waitFor('chat_message');
    expect(msg).toMatchObject({ message: 'Nice video!', username: 'Bob' });
    expect(msg.timestamp).toBeTypeOf('number');
    expect(await other.host.client.expectNone('chat_message')).toHaveLength(0);
    expect(await other.bob.client.expectNone('chat_message')).toHaveLength(0);
  });

  it('validates and rate limits chat', async () => {
    const { bob } = await hostAndParticipant();
    bob.client.send('chat_message', { message: '   ' });
    expect((await bob.client.waitFor('error')).code).toBe('INVALID_PAYLOAD');
    bob.client.send('chat_message', { message: 'x'.repeat(501) });
    expect((await bob.client.waitFor('error')).code).toBe('INVALID_PAYLOAD');
    for (let i = 0; i < 6; i += 1) bob.client.send('chat_message', { message: `m${i}` });
    expect((await bob.client.waitFor('error', (e) => e.code === 'RATE_LIMITED')).code).toBe('RATE_LIMITED');
  });

  it('late joiners get recent chat history', async () => {
    const { roomId, bob } = await hostAndParticipant();
    bob.client.send('chat_message', { message: 'history' });
    await bob.client.waitFor('chat_message');
    const late = await joinAs(srv, 'Late', roomId);
    expect(late.joined.chat.map((m) => m.message)).toContain('history');
  });

});

describe('deleting a room', () => {
  const del = (roomId, token) => api(srv.baseUrl, `/rooms/${roomId}`, { method: 'DELETE', token });

  it('closes a live room: everyone is told and disconnected, and the room is gone', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    expect((await del(roomId, host.auth.token)).status).toBe(200);

    const closed = await bob.client.waitFor('room_closed');
    expect(closed.roomId).toBe(roomId);
    await host.client.waitFor('room_closed');
    expect(await bob.client.closed).toBe(4005);
    expect(await host.client.closed).toBe(4005);

    expect(srv.roomManager.getRoom(roomId)).toBeUndefined();
    expect(getFakeRoomRecord(roomId)).toBeUndefined();
    const ticket = await api(srv.baseUrl, '/auth/ws-ticket', { method: 'POST', token: bob.auth.token, body: { roomId } });
    expect(ticket.status).toBe(404);

    // The old grace/eviction timers must not bring the deleted room back.
    await new Promise((r) => setTimeout(r, 800));
    expect(srv.roomManager.getRoom(roomId)).toBeUndefined();
    expect(getFakeRoomRecord(roomId)).toBeUndefined();
  });

  it('only the current host can delete; a Participant or a Moderator cannot', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    expect((await del(roomId, bob.auth.token)).status).toBe(403);
    host.client.send('assign_role', { userId: bob.joined.you.userId, role: 'moderator' });
    await bob.client.waitFor('role_assigned');
    expect((await del(roomId, bob.auth.token)).status).toBe(403);
    expect(srv.roomManager.getRoom(roomId)).toBeDefined();
    expect(getFakeRoomRecord(roomId)).toBeDefined();
  });

  it('after a host transfer, only the new host can delete', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    host.client.send('transfer_host', { userId: bob.joined.you.userId });
    await bob.client.waitFor('host_transferred');
    expect((await del(roomId, host.auth.token)).status).toBe(403);
    expect((await del(roomId, bob.auth.token)).status).toBe(200);
    expect(getFakeRoomRecord(roomId)).toBeUndefined();
  });
});

describe('persistence and room lifecycle', () => {
  it('rehydrates an unloaded room from the database (paused, last video and time)', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    host.client.send('seek', { time: 42 });
    await bob.client.waitFor('sync_state', (s) => s.currentTime === 42);
    host.client.send('pause');
    await bob.client.waitFor('sync_state', (s) => s.isPlaying === false);
    host.client.close();
    bob.client.close();

    await vi_waitUntil(() => !srv.roomManager.getRoom(roomId), 3000); // grace (300ms) + empty (400ms)
    const record = getFakeRoomRecord(roomId);
    expect(record).toMatchObject({ currentVideoId: VIDEO_A, isPlaying: false });
    expect(record.currentTime).toBeCloseTo(42, 0);

    const back = await joinAs(srv, 'Host', roomId, host.auth.token);
    expect(back.joined.you.role).toBe('host'); // the creator regains Host
    const state = back.client.messages.find((m) => m.type === 'sync_state').payload;
    expect(state).toMatchObject({ videoId: VIDEO_A, isPlaying: false });
    expect(state.currentTime).toBeCloseTo(42, 0);
  });

  it('only persists on video change, not on play/pause/seek', async () => {
    const { roomId, host, bob } = await hostAndParticipant();
    host.client.send('change_video', { videoId: VIDEO_A });
    await bob.client.waitFor('sync_state', (s) => s.videoId === VIDEO_A);
    const before = { ...getFakeRoomRecord(roomId) };
    host.client.send('seek', { time: 10 });
    host.client.send('pause');
    await bob.client.waitFor('sync_state', (s) => s.isPlaying === false);
    expect(getFakeRoomRecord(roomId).currentTime).toBe(before.currentTime);
  });

  it('returns ROOM_NOT_FOUND for a room that does not exist anywhere', async () => {
    const user = await registerUser(srv.baseUrl, 'Ghost');
    const roomId = await createRoom(srv.baseUrl, user.token);
    const ticket = srv.ticketService.issue({ userId: user.user.id, username: 'Ghost', roomId: 'ZZZZZ9' });
    const client = new TestClient(srv.wsUrl, ticket);
    await client.opened;
    client.send('join_room', { roomId: 'ZZZZZ9' });
    expect((await client.waitFor('error')).code).toBe('ROOM_NOT_FOUND');
    expect(await client.closed).toBe(4004);
    expect(roomId).toBeTruthy();
  });
});

async function vi_waitUntil(fn, timeout) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
