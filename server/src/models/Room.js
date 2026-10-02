import mongoose from 'mongoose';

const ROOM_TTL_SECONDS = 7 * 24 * 60 * 60;

const roomSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, unique: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    currentVideoId: { type: String, default: null },
    isPlaying: { type: Boolean, default: false },
    currentTime: { type: Number, default: 0 },
    // Rooms nobody touched for 7 days are deleted automatically by MongoDB (TTL index).
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

roomSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: ROOM_TTL_SECONDS });

export default mongoose.model('Room', roomSchema);
