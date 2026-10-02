import { describe, it, expect, vi, afterEach } from 'vitest';
import { Room } from '../src/websocket/Room.js';
import { ROLES, ACTIONS, can } from '../src/websocket/constants.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(d) { this.sent.push(JSON.parse(d)); }, close: vi.fn() });
const makeRoom = (opts = {}) => new Room({ roomId: 'ABC123', hostId: 'host', options: opts });
const rooms = [];
const track = (room) => (rooms.push(room), room);
afterEach(() => rooms.splice(0).forEach((r) => r.destroy()));

describe('permission matrix', () => {
  it('lets Host and Moderator control playback, not Participant', () => {
    expect(can(ROLES.HOST, ACTIONS.CONTROL_PLAYBACK)).toBe(true);
    expect(can(ROLES.MODERATOR, ACTIONS.CONTROL_PLAYBACK)).toBe(true);
    expect(can(ROLES.PARTICIPANT, ACTIONS.CONTROL_PLAYBACK)).toBe(false);
  });
  it('lets Moderator resolve requests but not manage roles/members/host', () => {
    expect(can(ROLES.MODERATOR, ACTIONS.RESOLVE_REQUESTS)).toBe(true);
    for (const a of [ACTIONS.MANAGE_ROLES, ACTIONS.REMOVE_PARTICIPANT, ACTIONS.TRANSFER_HOST]) {
      expect(can(ROLES.MODERATOR, a)).toBe(false);
      expect(can(ROLES.PARTICIPANT, a)).toBe(false);
      expect(can(ROLES.HOST, a)).toBe(true);
    }
  });
  it('only Participants can send requests', () => {
    expect(can(ROLES.PARTICIPANT, ACTIONS.REQUEST_CONTROL)).toBe(true);
    expect(can(ROLES.HOST, ACTIONS.REQUEST_CONTROL)).toBe(false);
  });
});

describe('playback math', () => {
  it('advances time while playing and freezes while paused', () => {
    const room = track(makeRoom());
    room.applyPlayback('change_video', { videoId: 'dQw4w9WgXcQ' }, 1000);
    expect(room.getExpectedTime(1000)).toBe(0);
    expect(room.getExpectedTime(11_000)).toBe(10); // playing: +10s
    room.applyPlayback('pause', {}, 11_000);
    expect(room.getExpectedTime(99_000)).toBe(10); // paused: frozen
    room.applyPlayback('seek', { time: 80 }, 20_000);
    expect(room.getExpectedTime(30_000)).toBe(80); // seek while paused stays paused
    room.applyPlayback('play', {}, 30_000);
    expect(room.getExpectedTime(35_000)).toBe(85);
  });
});

describe('roles and host succession', () => {
  it('first join by the creator is Host; others are Participants', () => {
    const room = track(makeRoom());
    expect(room.join({ userId: 'host', username: 'H', ws: fakeWs() }).participant.role).toBe(ROLES.HOST);
    expect(room.join({ userId: 'a', username: 'A', ws: fakeWs() }).participant.role).toBe(ROLES.PARTICIPANT);
  });

  it('transferHost swaps roles atomically (old Host becomes Participant)', () => {
    const room = track(makeRoom());
    room.join({ userId: 'host', username: 'H', ws: fakeWs() });
    room.join({ userId: 'a', username: 'A', ws: fakeWs() });
    room.transferHost('a');
    expect(room.getParticipant('host').role).toBe(ROLES.PARTICIPANT);
    expect(room.getParticipant('a').role).toBe(ROLES.HOST);
    expect([...room.participants.values()].filter((p) => p.role === ROLES.HOST)).toHaveLength(1);
  });

  it('promotes the longest-present Moderator when the Host leaves', async () => {
    const room = track(makeRoom());
    room.join({ userId: 'host', username: 'H', ws: fakeWs() });
    room.join({ userId: 'p1', username: 'P1', ws: fakeWs() });
    room.join({ userId: 'm1', username: 'M1', ws: fakeWs() });
    room.assignRole('m1', ROLES.MODERATOR);
    room.removeParticipant('host', 'left');
    expect(room.getParticipant('m1').role).toBe(ROLES.HOST);
    expect(room.hostId).toBe('m1');
  });

  it('falls back to the longest-present Participant when there is no Moderator', () => {
    const room = track(makeRoom());
    room.join({ userId: 'host', username: 'H', ws: fakeWs() });
    room.join({ userId: 'p1', username: 'P1', ws: fakeWs() });
    room.join({ userId: 'p2', username: 'P2', ws: fakeWs() });
    room.removeParticipant('host', 'left');
    expect(room.getParticipant('p1').role).toBe(ROLES.HOST);
  });
});

describe('control requests', () => {
  it('keeps one pending request per user and type (new replaces old)', () => {
    const room = track(makeRoom());
    room.join({ userId: 'host', username: 'H', ws: fakeWs() });
    const { participant } = room.join({ userId: 'a', username: 'A', ws: fakeWs() });
    room.createRequest(participant, 'play', {});
    room.createRequest(participant, 'play', {});
    expect(room.getPendingRequests()).toHaveLength(1);
  });

  it('does not change playback until approved', () => {
    const room = track(makeRoom());
    const host = room.join({ userId: 'host', username: 'H', ws: fakeWs() }).participant;
    const { participant } = room.join({ userId: 'a', username: 'A', ws: fakeWs() });
    room.applyPlayback('change_video', { videoId: 'dQw4w9WgXcQ' });
    room.applyPlayback('pause', {});
    const request = room.createRequest(participant, 'play', {});
    expect(room.playback.isPlaying).toBe(false);
    room.resolveRequest(request.id, host, true);
    expect(room.playback.isPlaying).toBe(true);
  });

  it('expires after the TTL', async () => {
    const room = track(makeRoom({ requestTtlMs: 30 }));
    room.join({ userId: 'host', username: 'H', ws: fakeWs() });
    const { participant } = room.join({ userId: 'a', username: 'A', ws: fakeWs() });
    room.createRequest(participant, 'pause', {});
    await new Promise((r) => setTimeout(r, 80));
    expect(room.getPendingRequests()).toHaveLength(0);
  });

  it('clears a user\'s requests when they leave', () => {
    const room = track(makeRoom());
    room.join({ userId: 'host', username: 'H', ws: fakeWs() });
    const { participant } = room.join({ userId: 'a', username: 'A', ws: fakeWs() });
    room.createRequest(participant, 'pause', {});
    room.removeParticipant('a', 'left');
    expect(room.getPendingRequests()).toHaveLength(0);
  });
});
