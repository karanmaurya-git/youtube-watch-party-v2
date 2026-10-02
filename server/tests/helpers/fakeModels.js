// In-memory stand-ins for the Mongoose models so tests run without a MongoDB server.
// They implement only the methods the services use.
let counter = 0;
const nextId = () => String(++counter).padStart(24, '0');
const users = new Map();
const rooms = new Map();

export const FakeUser = {
  async create(data) {
    const doc = { _id: nextId(), ...data, createdAt: new Date() };
    users.set(doc._id, doc);
    return doc;
  },
  async findOne(query) {
    return [...users.values()].find((u) => u.email === query.email) || null;
  },
  async findById(id) {
    return users.get(String(id)) || null;
  },
};

export const FakeRoom = {
  async create(data) {
    const doc = { _id: nextId(), currentVideoId: null, currentTime: 0, isPlaying: false, createdAt: new Date(), ...data };
    rooms.set(doc.roomCode, doc);
    return doc;
  },
  async findOne(query) {
    return rooms.get(query.roomCode) || null;
  },
  find(query) {
    const result = [...rooms.values()].filter((r) => String(r.hostId) === String(query.hostId));
    const chain = {
      sort: () => chain,
      limit: () => chain,
      lean: () => chain,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  },
  async deleteOne(query) {
    return { deletedCount: rooms.delete(query.roomCode) ? 1 : 0 };
  },
  async updateOne(query, update) {
    const doc = rooms.get(query.roomCode);
    if (doc) Object.assign(doc, update.$set);
    return { matchedCount: doc ? 1 : 0 };
  },
};

export const getFakeRoomRecord = (code) => rooms.get(code);
