import Room from '../models/Room.js';

const toPlain = (doc) =>
  doc && {
    roomId: doc.roomCode,
    hostId: String(doc.hostId),
    videoId: doc.currentVideoId ?? null,
    currentTime: doc.currentTime ?? 0,
    createdAt: doc.createdAt,
  };

export async function findRoom(roomCode) {
  return toPlain(await Room.findOne({ roomCode }));
}

export async function createRoomRecord({ roomCode, hostId }) {
  return toPlain(await Room.create({ roomCode, hostId }));
}

export const deleteRoomRecord = (roomCode) => Room.deleteOne({ roomCode });

export async function listRoomsByHost(hostId) {
  const docs = await Room.find({ hostId }).sort({ createdAt: -1 }).limit(20).lean();
  return docs.map(toPlain);
}

// Persistence is deliberately sparse: room create, video change, host change, and when an
// empty room is unloaded from memory. Never on play/pause/seek.
export const saveVideo = (roomCode, videoId) =>
  Room.updateOne(
    { roomCode },
    { $set: { currentVideoId: videoId, currentTime: 0, isPlaying: false, lastActiveAt: new Date() } }
  );

export const saveHost = (roomCode, hostId) =>
  Room.updateOne({ roomCode }, { $set: { hostId, lastActiveAt: new Date() } });

export const saveSnapshot = (roomCode, { videoId, currentTime, hostId }) =>
  Room.updateOne(
    { roomCode },
    { $set: { currentVideoId: videoId, currentTime, isPlaying: false, hostId, lastActiveAt: new Date() } }
  );
