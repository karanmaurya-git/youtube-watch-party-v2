import { ACTIONS, CLOSE, LIMITS, ROLES, can, isPrivileged } from './constants.js';
import { sendError } from './protocol.js';
import { RateLimiter } from '../utils/rateLimiter.js';
import { normalizeRoomCode } from '../utils/roomCode.js';
import { parseVideoId } from '../utils/youtube.js';
import * as roomService from '../services/roomService.js';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses, validates and authorizes every incoming WebSocket message, then delegates to
 * Room. Check order for every protected event:
 *   authenticated (ticket) -> in a room -> role allowed -> payload valid -> mutate -> broadcast
 */
export class MessageHandler {
  constructor({ roomManager, persistence = roomService }) {
    this.roomManager = roomManager;
    this.persistence = persistence;
    this.handlers = {
      join_room: this.joinRoom,
      leave_room: this.leaveRoom,
      request_sync: this.requestSync,
      play: (ctx, p) => this.controlPlayback(ctx, 'play', p),
      pause: (ctx, p) => this.controlPlayback(ctx, 'pause', p),
      seek: (ctx, p) => this.controlPlayback(ctx, 'seek', p),
      change_video: (ctx, p) => this.controlPlayback(ctx, 'change_video', p),
      request_play: (ctx, p) => this.requestAction(ctx, 'play', p),
      request_pause: (ctx, p) => this.requestAction(ctx, 'pause', p),
      request_seek: (ctx, p) => this.requestAction(ctx, 'seek', p),
      request_change_video: (ctx, p) => this.requestAction(ctx, 'change_video', p),
      approve_request: (ctx, p) => this.resolveRequest(ctx, p, true),
      reject_request: (ctx, p) => this.resolveRequest(ctx, p, false),
      assign_role: this.assignRole,
      remove_participant: this.removeParticipant,
      transfer_host: this.transferHost,
      chat_message: this.chatMessage,
    };
  }

  /** `session` comes from the validated ticket: userId/username/roomId are server-decided. */
  handleConnection(ws, session) {
    const ctx = {
      ws,
      session,
      room: null,
      participant: null,
      limiter: new RateLimiter(LIMITS.MESSAGES_PER_SECOND, 1000),
      queue: Promise.resolve(), // messages from one socket are processed strictly in order
    };

    const joinTimer = setTimeout(() => {
      if (!ctx.participant) ws.close(CLOSE.JOIN_TIMEOUT, 'join_room required');
    }, LIMITS.JOIN_TIMEOUT_MS);
    joinTimer.unref?.();

    ws.on('message', (data) => {
      if (!ctx.limiter.allow()) return sendError(ws, 'RATE_LIMITED', 'Too many messages, slow down');
      ctx.queue = ctx.queue.then(() => this.process(ctx, data));
      return undefined;
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (ctx.room && ctx.participant) ctx.room.disconnect(ctx.participant, ws);
    });
    ws.on('error', (err) => console.error('WebSocket error', err.message));
  }

  async process(ctx, data) {
    const { ws } = ctx;
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return sendError(ws, 'INVALID_JSON', 'Message must be valid JSON');
    }
    if (!isPlainObject(message) || typeof message.type !== 'string') {
      return sendError(ws, 'INVALID_MESSAGE', 'Message must look like { "type": string, "payload": object }');
    }
    if (message.payload !== undefined && !isPlainObject(message.payload)) {
      return sendError(ws, 'INVALID_MESSAGE', 'payload must be an object');
    }
    const handler = Object.hasOwn(this.handlers, message.type) ? this.handlers[message.type] : null;
    if (!handler) return sendError(ws, 'UNKNOWN_EVENT', `Unknown event type: ${message.type}`);

    try {
      return await handler.call(this, ctx, message.payload ?? {});
    } catch (err) {
      console.error(`Error handling "${message.type}"`, err);
      return sendError(ws, 'INTERNAL_ERROR', 'Something went wrong');
    }
  }

  // ---------- helpers ----------

  /** Returns { room, participant } only if the socket's user is still a member of its room. */
  member(ctx) {
    const { room, participant } = ctx;
    if (!room || !participant || room.getParticipant(participant.userId) !== participant) {
      sendError(ctx.ws, 'NOT_IN_ROOM', 'Join a room first');
      return null;
    }
    return { room, participant };
  }

  /** member() + role check. Returns null (after replying with an error) if either fails. */
  authorize(ctx, action, message) {
    const found = this.member(ctx);
    if (!found) return null;
    if (!can(found.participant.role, action)) {
      sendError(ctx.ws, 'FORBIDDEN', message);
      return null;
    }
    return found;
  }

  /** Validates the payload of a playback action. Returns { payload } or { error: [code, msg] }. */
  validatePlayback(room, type, payload) {
    if (type === 'change_video') {
      const videoId = parseVideoId(payload.videoId ?? payload.url);
      return videoId ? { payload: { videoId } } : { error: ['INVALID_VIDEO', 'Not a valid YouTube URL or video ID'] };
    }
    if (!room.playback.videoId) return { error: ['NO_VIDEO', 'No video is loaded yet'] };
    if (type === 'seek') {
      const time = payload.time;
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > LIMITS.MAX_SEEK_SECONDS) {
        return { error: ['INVALID_PAYLOAD', 'time must be a number of seconds >= 0'] };
      }
      return { payload: { time } };
    }
    return { payload: {} };
  }

  persistVideo(room, type) {
    if (type !== 'change_video') return;
    this.persistence
      .saveVideo(room.roomId, room.playback.videoId)
      .catch((err) => console.error(`Failed to save video for ${room.roomId}`, err));
  }

  /** Target of a host action: must be another member of the same room. */
  target(ctx, payload, room, participant) {
    if (typeof payload.userId !== 'string') {
      sendError(ctx.ws, 'INVALID_PAYLOAD', 'userId is required');
      return null;
    }
    const target = room.getParticipant(payload.userId);
    if (!target) {
      sendError(ctx.ws, 'TARGET_NOT_FOUND', 'That user is not in the room');
      return null;
    }
    if (target.userId === participant.userId) {
      sendError(ctx.ws, 'INVALID_TARGET', 'You cannot do that to yourself');
      return null;
    }
    return target;
  }

  // ---------- membership ----------

  async joinRoom(ctx, payload) {
    if (ctx.participant) return sendError(ctx.ws, 'ALREADY_JOINED', 'Already in a room');

    const roomId = normalizeRoomCode(payload.roomId);
    // The ticket was issued for one specific room; it cannot be used to enter another.
    if (!roomId || roomId !== ctx.session.roomId) {
      return sendError(ctx.ws, 'ROOM_MISMATCH', 'This ticket was issued for a different room');
    }

    const room = await this.roomManager.getOrLoadRoom(roomId);
    if (!room) {
      sendError(ctx.ws, 'ROOM_NOT_FOUND', 'Room not found');
      return ctx.ws.close(CLOSE.ROOM_NOT_FOUND, 'Room not found');
    }
    const { userId, username } = ctx.session;
    if (room.isKicked(userId)) {
      sendError(ctx.ws, 'REMOVED', 'You were removed from this room');
      return ctx.ws.close(CLOSE.REMOVED, 'Removed');
    }

    this.roomManager.cancelEviction(room);
    const { participant, reconnected } = room.join({ userId, username, ws: ctx.ws });
    ctx.room = room;
    ctx.participant = participant;

    participant.send('room_joined', {
      roomId,
      you: participant.toPublic(),
      participants: room.getParticipantList(),
      chat: room.chatHistory,
      requests: isPrivileged(participant.role) ? room.getPendingRequests() : room.getRequestsFor(userId),
      reconnected,
    });
    participant.send('sync_state', room.getSyncPayload()); // late joiners/reconnects land in sync
    return undefined;
  }

  leaveRoom(ctx) {
    const found = this.member(ctx);
    if (!found) return;
    found.room.removeParticipant(found.participant.userId, 'left');
    ctx.room = null;
    ctx.participant = null;
    ctx.ws.close(CLOSE.NORMAL, 'Left room');
  }

  requestSync(ctx) {
    const found = this.member(ctx);
    if (found) found.participant.send('sync_state', found.room.getSyncPayload());
  }

  // ---------- playback ----------

  controlPlayback(ctx, type, payload) {
    const found = this.authorize(ctx, ACTIONS.CONTROL_PLAYBACK, 'Only the Host or a Moderator can control playback');
    if (!found) return;
    const result = this.validatePlayback(found.room, type, payload);
    if (result.error) return sendError(ctx.ws, ...result.error);

    found.room.applyPlayback(type, result.payload);
    found.room.broadcastSync();
    this.persistVideo(found.room, type);
    return undefined;
  }

  // ---------- control requests ----------

  requestAction(ctx, type, payload) {
    const found = this.authorize(ctx, ACTIONS.REQUEST_CONTROL, 'You can control playback directly, no request needed');
    if (!found) return;
    const { room, participant } = found;
    if (!participant.limits.request.allow()) {
      return sendError(ctx.ws, 'RATE_LIMITED', 'Wait a moment before sending another request');
    }
    const result = this.validatePlayback(room, type, payload);
    if (result.error) return sendError(ctx.ws, ...result.error);

    // A request never touches playback. It only waits for a Host/Moderator decision.
    room.createRequest(participant, type, result.payload);
    return undefined;
  }

  resolveRequest(ctx, payload, approve) {
    const found = this.authorize(ctx, ACTIONS.RESOLVE_REQUESTS, 'Only the Host or a Moderator can answer requests');
    if (!found) return;
    if (typeof payload.requestId !== 'string') {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'requestId is required');
    }
    const request = found.room.resolveRequest(payload.requestId, found.participant, approve);
    if (!request) return sendError(ctx.ws, 'REQUEST_NOT_FOUND', 'That request is no longer pending');
    if (approve) this.persistVideo(found.room, request.type);
    return undefined;
  }

  // ---------- host management (Host only) ----------

  assignRole(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.MANAGE_ROLES, 'Only the Host can assign roles');
    if (!found) return;
    if (payload.role !== ROLES.MODERATOR && payload.role !== ROLES.PARTICIPANT) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'role must be "moderator" or "participant"');
    }
    const target = this.target(ctx, payload, found.room, found.participant);
    if (!target || target.role === payload.role) return;
    found.room.assignRole(target.userId, payload.role);
  }

  removeParticipant(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.REMOVE_PARTICIPANT, 'Only the Host can remove participants');
    if (!found) return;
    const target = this.target(ctx, payload, found.room, found.participant);
    if (target) found.room.kick(target.userId);
  }

  transferHost(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.TRANSFER_HOST, 'Only the Host can transfer the Host role');
    if (!found) return;
    const target = this.target(ctx, payload, found.room, found.participant);
    if (target) found.room.transferHost(target.userId);
  }

  // ---------- chat ----------

  chatMessage(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.CHAT, 'You cannot chat in this room');
    if (!found) return;
    const text = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!text || text.length > LIMITS.MAX_CHAT_LENGTH) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', `Message must be 1-${LIMITS.MAX_CHAT_LENGTH} characters`);
    }
    if (!found.participant.limits.chat.allow()) {
      return sendError(ctx.ws, 'RATE_LIMITED', 'You are sending messages too quickly');
    }
    found.room.addChatMessage(found.participant, text);
    return undefined;
  }
}
