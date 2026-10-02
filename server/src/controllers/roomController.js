import { AppError } from '../utils/errors.js';
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode.js';
import { createRoomRecord, deleteRoomRecord, findRoom, listRoomsByHost } from '../services/roomService.js';

export function createRoomController({ roomManager }) {
  return {
    async create(req, res) {
      // Retry on the (very unlikely) collision with an existing code.
      let code;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateRoomCode();
        if (!roomManager.getRoom(candidate) && !(await findRoom(candidate))) {
          code = candidate;
          break;
        }
      }
      if (!code) throw new AppError('Could not generate a room code, try again', 500);

      const record = await createRoomRecord({ roomCode: code, hostId: req.user.id });
      roomManager.createRoom({ roomId: record.roomId, hostId: record.hostId });
      res.status(201).json({ success: true, room: { roomId: record.roomId, hostId: record.hostId } });
    },

    async get(req, res) {
      const roomId = normalizeRoomCode(req.params.roomId);
      if (!roomId) throw new AppError('Invalid room code', 400);

      const active = roomManager.getRoom(roomId);
      const record = active ? null : await findRoom(roomId);
      if (!active && !record) throw new AppError('Room not found', 404);

      res.json({
        success: true,
        room: {
          roomId,
          hostId: active ? active.hostId : record.hostId,
          videoId: active ? active.playback.videoId : record.videoId,
          participantCount: active ? active.participants.size : 0,
        },
      });
    },

    // Only the CURRENT host may delete. Everyone inside is told and disconnected.
    async remove(req, res) {
      const roomId = normalizeRoomCode(req.params.roomId);
      if (!roomId) throw new AppError('Invalid room code', 400);

      const active = roomManager.getRoom(roomId);
      const record = active ? null : await findRoom(roomId);
      if (!active && !record) throw new AppError('Room not found', 404);

      const hostId = active ? active.hostId : record.hostId;
      if (hostId !== req.user.id) throw new AppError('Only the host can delete this room', 403);

      await deleteRoomRecord(roomId);
      roomManager.closeRoom(roomId, 'The host closed this room.');
      res.json({ success: true, message: 'Room deleted' });
    },

    async list(req, res) {
      const rooms = await listRoomsByHost(req.user.id);
      res.json({
        success: true,
        rooms: rooms.map((r) => ({ roomId: r.roomId, videoId: r.videoId, createdAt: r.createdAt })),
      });
    },
  };
}
