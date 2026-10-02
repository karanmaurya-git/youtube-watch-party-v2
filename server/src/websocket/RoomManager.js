import { Room } from './Room.js';
import { DEFAULT_OPTIONS } from './constants.js';
import * as roomService from '../services/roomService.js';

/** Owns all active (in-memory) rooms and loads/unloads them from MongoDB. */
export class RoomManager {
  constructor({ options = {}, persistence = roomService } = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.persistence = persistence;
    this.rooms = new Map();
    this.loading = new Map(); // roomId -> Promise, so two joins don't load the same room twice
  }

  createRoom({ roomId, hostId, playback }) {
    const room = new Room({
      roomId,
      hostId,
      playback,
      options: this.options,
      onEmpty: (r) => this.scheduleEviction(r),
      onHostChange: (r) => this.persistHost(r),
    });
    this.rooms.set(roomId, room);
    this.scheduleEviction(room); // evicted again if nobody joins
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /** Memory first; otherwise rehydrate from MongoDB (paused, at the last saved video/time). */
  async getOrLoadRoom(roomId) {
    const active = this.rooms.get(roomId);
    if (active) return active;
    if (this.loading.has(roomId)) return this.loading.get(roomId);

    const loadPromise = (async () => {
      const record = await this.persistence.findRoom(roomId);
      if (!record) return null;
      return this.createRoom({
        roomId,
        hostId: record.hostId,
        playback: { videoId: record.videoId, currentTime: record.currentTime },
      });
    })().finally(() => this.loading.delete(roomId));

    this.loading.set(roomId, loadPromise);
    return loadPromise;
  }

  /** Removes a room for good (host deleted it) and disconnects everyone inside. */
  closeRoom(roomId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    this.rooms.delete(roomId);
    room.close(message);
    return true;
  }

  scheduleEviction(room) {
    clearTimeout(room.evictTimer);
    room.evictTimer = setTimeout(() => this.evict(room), this.options.emptyRoomMs);
    room.evictTimer.unref?.();
  }

  cancelEviction(room) {
    clearTimeout(room.evictTimer);
    room.evictTimer = null;
  }

  /** Frees memory for an empty room. The MongoDB record stays so the link keeps working. */
  async evict(room) {
    if (room.participants.size > 0 || this.rooms.get(room.roomId) !== room) return;
    this.rooms.delete(room.roomId);
    room.destroy();
    try {
      await this.persistence.saveSnapshot(room.roomId, {
        videoId: room.playback.videoId,
        currentTime: room.getExpectedTime(),
        hostId: room.hostId,
      });
    } catch (err) {
      console.error(`Failed to save room ${room.roomId}`, err);
    }
  }

  async persistHost(room) {
    try {
      await this.persistence.saveHost(room.roomId, room.hostId);
    } catch (err) {
      console.error(`Failed to save host for ${room.roomId}`, err);
    }
  }

  shutdown() {
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
