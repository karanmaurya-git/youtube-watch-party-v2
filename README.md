# YouTube Watch Party

Watch YouTube together in real time. Create a room, share the code, and everyone's player plays, pauses, seeks and switches video at the same moment. Roles decide who can control playback, and the server enforces them.

- **Live app:** `https://YOUR-APP.vercel.app` (placeholder, add your Vercel URL after deploying)
- **API:** `https://YOUR-SERVER.onrender.com/api`
- **WebSocket:** `wss://YOUR-SERVER.onrender.com`

> Render's free tier sleeps after inactivity. The first request can take 30-60 seconds, so open the API URL once before a demo.

## Features

- Register, log in, log out (JWT, bcrypt-hashed passwords)
- Create a room (you become Host), share a 6-character code or `/watch/CODE` link, join by code
- Synchronized play, pause, seek and change video, with a server-authoritative playback state
- Late joiners and reconnecting users land at the correct video, time and play state
- Roles: **Host**, **Moderator**, **Participant**, enforced on the backend for every event
- Host can promote/demote, remove participants, and transfer the Host role; automatic Host succession if the Host leaves
- Participants send **control requests** (play, pause, seek, change video) that a Host or Moderator approves or rejects
- Live participant list with roles
- The Host can delete a room from the dashboard; everyone inside is told and disconnected
- Room chat, connection status, toasts
- Reconnection with a 45-second grace period that keeps your seat and role

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, React Router, Axios, YouTube IFrame Player API, native browser `WebSocket` |
| Backend | Node.js, Express 5, `ws` (native WebSockets, no Socket.IO), JWT, bcryptjs, Helmet, CORS |
| Database | MongoDB with Mongoose (MongoDB Atlas in production) |
| Tests | Vitest, Supertest, real `ws` clients |
| Deploy | Vercel (client), Render (server), MongoDB Atlas |

## Architecture in one picture

```text
React (Vite)
  |-- REST (Axios) ------> Express ----> MongoDB (users, rooms)
  |
  '-- WebSocket (wss) ---> ws server (same HTTP server as Express)
                              |
                         MessageHandler   parse, validate, authorize
                              |
                         RoomManager      active rooms in memory
                              |
                           Room           participants, playback state, requests, chat
                              |
                         Participant      userId, username, role, socket
```

REST handles accounts, creating rooms and issuing WebSocket tickets. Everything real-time goes over one WebSocket per user. More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/WEBSOCKET_PROTOCOL.md](docs/WEBSOCKET_PROTOCOL.md).

## Roles and permissions

| Action | Host | Moderator | Participant |
|---|:-:|:-:|:-:|
| Play / pause / seek / change video | yes | yes | no (sends a request) |
| Approve or reject requests | yes | yes | no |
| Assign roles | yes | no | no |
| Remove participants | yes | no | no |
| Transfer Host | yes | no | no |
| Chat | yes | yes | yes |

Rules: the room creator is Host; joiners are Participants; a Host cannot target themselves; the `host` role only changes through transfer or succession; removed users cannot rejoin that room.

## How synchronization works

The server stores `{ videoId, isPlaying, currentTime, updatedAt }` for each room, and `updatedAt` is always set by the server. Everyone computes where the video should be:

```text
expected = isPlaying ? currentTime + (now - updatedAt) / 1000 : currentTime
```

Clients correct their player only when more than 1.5 seconds off, checked every 5 seconds, so nobody seeks constantly. The client estimates the server clock offset from `serverTime` in each `sync_state`. To avoid event loops, the player is only driven by server state; an `isRemoteActionRef` flag marks changes the client made itself, and the client never sends events from raw YouTube player callbacks, only from its own controls.

## Local setup

Requirements: Node.js 18+ and a MongoDB database (a free MongoDB Atlas cluster works).

```bash
# 1. Server
cd server
cp .env.example .env        # fill in MONGODB_URI and JWT_SECRET
npm install
npm run dev                 # http://localhost:5000

# 2. Client (new terminal)
cd client
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Open two browser windows (one normal, one private) and register two users to try roles and sync.

### Environment variables

Server (`server/.env`):

| Variable | Example | Notes |
|---|---|---|
| `PORT` | `5000` | Render sets this automatically |
| `NODE_ENV` | `development` | `production` on Render |
| `MONGODB_URI` | `mongodb+srv://...` | required |
| `JWT_SECRET` | long random string | required |
| `JWT_EXPIRE` | `7d` | |
| `CLIENT_URL` | `http://localhost:5173` | exact frontend origin, no trailing slash; used for CORS and the WebSocket origin check |

Client (`client/.env`):

| Variable | Example |
|---|---|
| `VITE_API_URL` | `http://localhost:5000/api` |
| `VITE_WS_URL` | `ws://localhost:5000` (no `/api`, no path) |

## API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | no | create account, returns JWT |
| POST | `/api/auth/login` | no | log in, returns JWT |
| POST | `/api/auth/logout` | no | stateless; the client drops its token |
| POST | `/api/auth/ws-ticket` | JWT | body `{ roomId }`; returns a 30s single-use WebSocket ticket |
| GET | `/api/rooms` | JWT | rooms you created |
| POST | `/api/rooms` | JWT | create a room |
| DELETE | `/api/rooms/:roomId` | JWT (current Host only) | delete a room; everyone inside gets `room_closed` and is disconnected |
| GET | `/api/rooms/:roomId` | JWT | look up a room |
| GET | `/api/health` | no | `{ "success": true, "message": "Server is running" }` |

Joining and leaving a room happens over the WebSocket, not REST.

## WebSocket events

Messages are `{ "type": "...", "payload": { ... } }`. Full payloads and permissions are in [docs/WEBSOCKET_PROTOCOL.md](docs/WEBSOCKET_PROTOCOL.md).

- Client to server: `join_room`, `leave_room`, `request_sync`, `play`, `pause`, `seek`, `change_video`, `request_play`, `request_pause`, `request_seek`, `request_change_video`, `approve_request`, `reject_request`, `assign_role`, `remove_participant`, `transfer_host`, `chat_message`
- Server to client: `room_joined`, `sync_state`, `user_joined`, `user_left`, `role_assigned`, `participant_removed`, `removed_from_room`, `room_closed`, `host_transferred`, `request_ack`, `request_created`, `request_list`, `request_resolved`, `chat_message`, `error`

## Tests

```bash
cd server
npm test
```

76 tests: URL parsing, the permission matrix, playback math, host succession, request lifecycle, REST (register, login, protected routes, rooms, tickets, health), and real two-client WebSocket flows (sync, RBAC rejections, approvals, removal, host transfer, room deletion, reconnect, chat isolation, room rehydration).

The tests use in-memory fakes for the two Mongoose models, so they run without a database. They do not exercise a real MongoDB; see [Known limitations](#known-limitations).

## Deployment

**MongoDB Atlas:** create a free cluster, a database user, and allow network access (for Render, `0.0.0.0/0` or Render's outbound IPs). Copy the connection string into `MONGODB_URI`.

**Render (server):** New Web Service from your repo.

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRE=7d`, `CLIENT_URL=https://YOUR-APP.vercel.app`
- Health check path: `/api/health`

Render supports WebSockets on the same port, so the app works over `wss://` with no extra setup. Do not hardcode the port; the server reads `process.env.PORT`.

**Vercel (client):** import the repo.

- Root directory: `client`
- Build command: `npm run build`, output directory: `dist`
- Environment: `VITE_API_URL=https://YOUR-SERVER.onrender.com/api`, `VITE_WS_URL=wss://YOUR-SERVER.onrender.com`
- `client/vercel.json` rewrites all paths to `index.html` so `/watch/ABC234` links work.

Deploy the server first, then set `CLIENT_URL` to the real Vercel URL (exact, without a trailing slash) and redeploy. A wrong `CLIENT_URL` shows up as CORS errors and failed WebSocket connections.

## Project structure

```text
client/src/   components/ pages/ hooks/ context/ services/ utils/
server/src/   config/ controllers/ middleware/ models/ routes/ services/ websocket/ utils/
server/tests/ unit, REST and real-WebSocket tests
docs/         architecture, protocol, requirements checklist, interview guide
```

## Design decisions and trade-offs

- **Server-authoritative state.** Clients never decide playback; the server validates, updates and broadcasts. This is what makes late joiners and role enforcement simple.
- **Native `ws`, no Socket.IO.** Lighter and matches the assignment; the cost is writing heartbeat, reconnect and room logic ourselves (done in `Room`, `RoomManager` and `useRoomSocket`).
- **WebSocket tickets.** The browser cannot set headers on `new WebSocket()`, and a long-lived JWT in a URL leaks into logs. A 30-second, single-use ticket bound to one user and one room is safe to put in the URL.
- **In-memory active rooms, MongoDB for durable data.** Fast real-time path; rooms survive restarts because they are saved on create, video change and host change, and when an empty room is unloaded; they are removed when the Host deletes them. They are not saved on every play/pause/seek.
- **Empty rooms are unloaded from memory after 60 seconds, but kept in MongoDB** (auto-deleted after 7 days idle by a TTL index). Joining a saved room loads it back paused at the last saved video and time, and the creator regains Host.
- **Grace period on disconnect (45 s)** so a page refresh does not lose your role.

## Scaling notes

This is a single-instance design: active room state and tickets live in one Node process. To scale out, run several instances behind a load balancer and add Redis Pub/Sub so a broadcast on one instance reaches users connected to the others (Socket.IO's Redis adapter does not apply here; with `ws` you publish room events to a Redis channel yourself). Tickets and room membership would also move to Redis. All broadcasts already go through `Room.broadcast()`, `broadcastExcept()` and `broadcastToPrivileged()`, so that layer would be added in one place. The current MVP does not claim to support 1,000+ users.

## Known limitations

- Not verified against a real MongoDB or in a real browser during development (see [docs/REQUIREMENTS_CHECKLIST.md](docs/REQUIREMENTS_CHECKLIST.md)).
- Single server instance; rooms and tickets are lost if the process restarts (rooms reload from MongoDB, tickets just have to be requested again).
- After a server restart, a room whose creator is not the first to return has no Host until the creator joins.
- The kicked-users list is in memory, so it resets when the room is unloaded.
- The JWT is stored in `localStorage` (simple, but exposed to XSS); httpOnly cookies would be safer.
- Clock offset is estimated from one message and ignores network latency, so sync is accurate to roughly the network round-trip time.
- Chat is not saved beyond the last 50 messages kept in memory.

## Future improvements

Redis Pub/Sub and multiple instances, httpOnly cookie sessions, persisted chat, host-configurable moderator permissions, screenshots/demo video.

## Author

Add your name here.
