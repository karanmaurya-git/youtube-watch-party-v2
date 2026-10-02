import { randomUUID } from 'node:crypto';
import { ROLES, DEFAULT_OPTIONS, LIMITS, CLOSE, isPrivileged } from './constants.js';
import { Participant } from './Participant.js';
import { encode } from './protocol.js';

const ROLE_ORDER = { [ROLES.HOST]: 0, [ROLES.MODERATOR]: 1, [ROLES.PARTICIPANT]: 2 };
const PRIVILEGED_ROLES = [ROLES.HOST, ROLES.MODERATOR];

/**
 * One active watch room (in memory). Owns the participants, the authoritative playback
 * state, pending control requests and chat history. Every outgoing broadcast goes through
 * broadcast / broadcastExcept / broadcastToPrivileged so a Redis Pub/Sub layer could later
 * be added in one place.
 */
export class Room {
  constructor({ roomId, hostId, playback = {}, options = {}, onEmpty, onHostChange }) {
    this.roomId = roomId;
    this.hostId = String(hostId);
    this.createdAt = Date.now();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onEmpty = onEmpty || (() => {});
    this.onHostChange = onHostChange || (() => {});

    this.participants = new Map(); // userId -> Participant
    this.kicked = new Set(); // userIds removed by the host (blocked until the room is recreated)
    this.pendingRequests = new Map(); // requestId -> request
    this.chatHistory = [];
    this.evictTimer = null;
    this.closed = false;

    this.playback = {
      videoId: playback.videoId ?? null,
      isPlaying: false,
      currentTime: playback.currentTime ?? 0,
      updatedAt: Date.now(),
    };
  }

  // ---------- broadcasting ----------

  broadcast(type, payload) {
    const data = encode(type, payload); // serialize once, send to everyone
    for (const p of this.participants.values()) p.sendRaw(data);
  }

  broadcastExcept(excludeUserId, type, payload) {
    const data = encode(type, payload);
    for (const p of this.participants.values()) {
      if (p.userId !== excludeUserId) p.sendRaw(data);
    }
  }

  broadcastToPrivileged(type, payload) {
    const data = encode(type, payload);
    for (const p of this.participants.values()) {
      if (isPrivileged(p.role)) p.sendRaw(data);
    }
  }

  // ---------- membership ----------

  getParticipant(userId) {
    return this.participants.get(userId);
  }

  isKicked(userId) {
    return this.kicked.has(userId);
  }

  hasHost() {
    return [...this.participants.values()].some((p) => p.role === ROLES.HOST);
  }

  getParticipantList() {
    return [...this.participants.values()]
      .map((p) => p.toPublic())
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt - b.joinedAt);
  }

  /** Adds a user, or re-attaches a new socket if they are already a member (refresh/reconnect). */
  join({ userId, username, ws }) {
    const existing = this.participants.get(userId);
    if (existing) {
      const oldSocket = existing.ws;
      existing.attach(ws); // clears the disconnect grace timer, keeps the role
      if (oldSocket && oldSocket !== ws) oldSocket.close(CLOSE.REPLACED, 'Replaced by a new connection');
      return { participant: existing, reconnected: true };
    }

    const role = userId === this.hostId && !this.hasHost() ? ROLES.HOST : ROLES.PARTICIPANT;
    const participant = new Participant({ userId, username, role, ws });
    this.participants.set(userId, participant);
    this.broadcastExcept(userId, 'user_joined', {
      userId,
      username,
      role,
      participants: this.getParticipantList(),
    });
    return { participant, reconnected: false };
  }

  /** Socket dropped: keep the seat for a grace period so a refresh doesn't lose the role. */
  disconnect(participant, ws) {
    if (this.closed || participant.ws !== ws) return; // already replaced by a newer socket
    participant.detach();
    clearTimeout(participant.graceTimer);
    participant.graceTimer = setTimeout(
      () => this.removeParticipant(participant.userId, 'timeout'),
      this.options.disconnectGraceMs
    );
    participant.graceTimer.unref?.();
  }

  /** reason: 'left' | 'timeout' | 'removed'. */
  removeParticipant(userId, reason = 'left') {
    const participant = this.participants.get(userId);
    if (!participant) return null;

    clearTimeout(participant.graceTimer);
    this.cancelRequestsFor(userId, 'cancelled');
    this.participants.delete(userId);

    const payload = {
      userId,
      username: participant.username,
      participants: this.getParticipantList(),
    };
    if (reason === 'removed') this.broadcast('participant_removed', payload);
    else this.broadcast('user_left', { ...payload, reason });

    if (participant.role === ROLES.HOST) this.promoteSuccessor();
    if (this.participants.size === 0) this.onEmpty(this);
    return participant;
  }

  /** Host removes someone: tell them, drop them, block them from coming back. */
  kick(userId) {
    const participant = this.participants.get(userId);
    if (!participant) return null;
    this.kicked.add(userId);
    participant.send('removed_from_room', {
      roomId: this.roomId,
      message: 'You were removed from the room by the host',
    });
    this.removeParticipant(userId, 'removed');
    participant.close(CLOSE.REMOVED, 'Removed by host');
    return participant;
  }

  // ---------- roles ----------

  assignRole(userId, role) {
    const participant = this.participants.get(userId);
    if (!participant) return null;
    this.cancelRequestsFor(userId, 'cancelled'); // requests only make sense for plain participants
    participant.role = role;
    this.broadcast('role_assigned', {
      userId,
      username: participant.username,
      role,
      participants: this.getParticipantList(),
    });
    if (isPrivileged(role)) participant.send('request_list', { requests: this.getPendingRequests() });
    return participant;
  }

  /** Atomic swap: nobody is ever Host twice, and the old host becomes a Participant. */
  transferHost(newHostId, reason = 'transfer') {
    const target = this.participants.get(newHostId);
    if (!target) return null;
    const oldHostId = this.hostId;

    this.cancelRequestsFor(newHostId, 'cancelled');
    for (const p of this.participants.values()) {
      if (p.role === ROLES.HOST) p.role = ROLES.PARTICIPANT;
    }
    target.role = ROLES.HOST;
    this.hostId = newHostId;

    this.broadcast('host_transferred', {
      oldHostId,
      newHostId,
      newHostName: target.username,
      reason,
      participants: this.getParticipantList(),
    });
    target.send('request_list', { requests: this.getPendingRequests() });
    this.onHostChange(this);
    return target;
  }

  /** Host left for good: longest-present Moderator, else longest-present Participant. */
  promoteSuccessor() {
    const candidates = [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const pick = (role) =>
      candidates.find((p) => p.role === role && p.connected) || candidates.find((p) => p.role === role);
    const successor = pick(ROLES.MODERATOR) || pick(ROLES.PARTICIPANT);
    if (successor) this.transferHost(successor.userId, 'succession');
  }

  // ---------- playback (server is the source of truth) ----------

  getExpectedTime(now = Date.now()) {
    const { isPlaying, currentTime, updatedAt } = this.playback;
    return isPlaying ? currentTime + (now - updatedAt) / 1000 : currentTime;
  }

  /** `updatedAt` is always generated here, never taken from a client. */
  applyPlayback(type, payload = {}, now = Date.now()) {
    const current = this.playback;
    switch (type) {
      case 'play':
        this.playback = { ...current, currentTime: this.getExpectedTime(now), isPlaying: true, updatedAt: now };
        break;
      case 'pause':
        this.playback = { ...current, currentTime: this.getExpectedTime(now), isPlaying: false, updatedAt: now };
        break;
      case 'seek':
        this.playback = { ...current, currentTime: payload.time, updatedAt: now };
        break;
      case 'change_video':
        this.playback = { videoId: payload.videoId, currentTime: 0, isPlaying: true, updatedAt: now };
        break;
      default:
        throw new Error(`Unknown playback action: ${type}`);
    }
  }

  getSyncPayload(now = Date.now()) {
    return { ...this.playback, serverTime: now };
  }

  broadcastSync() {
    this.broadcast('sync_state', this.getSyncPayload());
  }

  // ---------- control requests ----------

  getPendingRequests() {
    return [...this.pendingRequests.values()].map(Room.publicRequest);
  }

  getRequestsFor(userId) {
    return this.getPendingRequests().filter((r) => r.userId === userId);
  }

  static publicRequest(r) {
    return { id: r.id, userId: r.userId, username: r.username, type: r.type, payload: r.payload, createdAt: r.createdAt };
  }

  /** At most one pending request per user per type; a new one replaces the old. */
  createRequest(participant, type, payload) {
    for (const r of [...this.pendingRequests.values()]) {
      if (r.userId === participant.userId && r.type === type) this.closeRequest(r, 'cancelled');
    }
    const request = {
      id: randomUUID(),
      userId: participant.userId,
      username: participant.username,
      type,
      payload,
      createdAt: Date.now(),
    };
    request.timer = setTimeout(() => this.closeRequest(request, 'expired'), this.options.requestTtlMs);
    request.timer.unref?.();
    this.pendingRequests.set(request.id, request);

    const view = Room.publicRequest(request);
    participant.send('request_ack', view);
    this.broadcastToPrivileged('request_created', view); // only Host/Moderators see requests
    return request;
  }

  closeRequest(request, status, resolvedBy = null) {
    clearTimeout(request.timer);
    this.pendingRequests.delete(request.id);
    const payload = {
      requestId: request.id,
      type: request.type,
      status,
      requesterId: request.userId,
      resolvedBy,
    };
    this.broadcastToPrivileged('request_resolved', payload);
    const requester = this.participants.get(request.userId);
    if (requester && !isPrivileged(requester.role)) requester.send('request_resolved', payload);
  }

  cancelRequestsFor(userId, status) {
    for (const r of [...this.pendingRequests.values()]) {
      if (r.userId === userId) this.closeRequest(r, status);
    }
  }

  /** Approving applies the action exactly as if a privileged user had done it. */
  resolveRequest(requestId, resolver, approve) {
    const request = this.pendingRequests.get(requestId);
    if (!request) return null;
    this.closeRequest(request, approve ? 'approved' : 'rejected', resolver.userId);
    if (approve) {
      this.applyPlayback(request.type, request.payload);
      this.broadcastSync();
    }
    return request;
  }

  // ---------- chat ----------

  addChatMessage(participant, message) {
    const entry = {
      id: randomUUID(),
      userId: participant.userId,
      username: participant.username,
      message,
      timestamp: Date.now(),
    };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > LIMITS.CHAT_HISTORY) this.chatHistory.shift();
    this.broadcast('chat_message', entry);
    return entry;
  }

  // ---------- lifecycle ----------

  /** The host deleted the room: tell everyone, disconnect them, and stop all timers. */
  close(message) {
    this.closed = true;
    this.broadcast('room_closed', { roomId: this.roomId, message });
    for (const p of this.participants.values()) p.close(CLOSE.ROOM_CLOSED, 'Room closed');
    this.destroy();
    this.participants.clear();
  }

  destroy() {
    clearTimeout(this.evictTimer);
    for (const p of this.participants.values()) clearTimeout(p.graceTimer);
    for (const r of this.pendingRequests.values()) clearTimeout(r.timer);
    this.pendingRequests.clear();
  }
}
