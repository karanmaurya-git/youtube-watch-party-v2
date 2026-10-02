# Architecture

## Two channels

```text
React (Vite)
  |-- REST over HTTPS ---> Express ---> MongoDB
  '-- WebSocket (WSS) ---> Node ws ---> RoomManager ---> Room ---> Participant
```

- **REST** is for things that happen once: register, log in, create a room, look up a room, get a WebSocket ticket.
- **WebSocket** is for everything live: join/leave, playback, roles, requests, chat. One socket per user per room.
- The `ws` server is attached to the same Node HTTP server as Express (`noServer` mode plus the `upgrade` event), with no custom path. That is why the production WebSocket URL is just `wss://YOUR-SERVER.onrender.com`.

## Server layout

| Piece | File | Responsibility |
|---|---|---|
| App | `src/app.js` | Express, Helmet, CORS, rate limit, routes (no `listen`, so tests can use it) |
| Entry | `src/index.js` | env check, MongoDB connect, HTTP server, WebSocket setup, graceful shutdown |
| Controllers/routes | `src/controllers`, `src/routes` | auth, rooms, ws-ticket |
| Services | `src/services` | `ticketService` (in-memory tickets), `userService`, `roomService` (all MongoDB access) |
| WebSocket setup | `src/websocket/index.js` | upgrade authentication, heartbeat |
| MessageHandler | `src/websocket/MessageHandler.js` | parse, validate, authorize, delegate |
| RoomManager | `src/websocket/RoomManager.js` | active rooms, load from / unload to MongoDB |
| Room | `src/websocket/Room.js` | participants, roles, playback, requests, chat, broadcasting |
| Participant | `src/websocket/Participant.js` | one user in one room, their socket and rate limiters |
| Permissions | `src/websocket/constants.js` | the single role-to-action table |

## Connection flow

```text
1. Client  POST /api/auth/ws-ticket {roomId}  (Authorization: Bearer JWT)
2. Server  checks the room exists and the user was not removed, returns a 30s single-use ticket
3. Client  new WebSocket("wss://.../?ticket=...")
4. Server  on the HTTP upgrade: checks Origin, consumes the ticket (deleted immediately).
           Invalid/used/expired -> HTTP 401 and no WebSocket is created.
5. Client  send join_room {roomId}   (must match the room the ticket was issued for)
6. Server  loads the room (memory, else MongoDB), adds/re-attaches the participant,
           replies room_joined, then sync_state; broadcasts user_joined to others
```

The server decides `userId`, `username` and `role`. Nothing about identity or permissions is read from client messages.

## Authoritative playback state

```js
{ videoId, isPlaying, currentTime, updatedAt }   // updatedAt = server time of the last change
expected = isPlaying ? currentTime + (now - updatedAt) / 1000 : currentTime
```

- `play`/`pause` freeze or resume from the expected time, `seek` sets `currentTime`, `change_video` resets to 0 and plays.
- Each `sync_state` also carries `serverTime`, so a client can compute `offset = serverTime - Date.now()` and then evaluate `expected` against the server's clock.
- Every 5 seconds a client compares its player to `expected` and seeks only if it is more than 1.5 seconds off.
- Late joiners and reconnecting users get a `sync_state` straight after `room_joined`, so they land on the right frame without any periodic tick messages.

## Event-loop prevention (client)

The YouTube player is only ever driven by server state. When the client applies a remote update it sets `isRemoteActionRef = true` for about 800 ms, so the `onStateChange` events that this causes are ignored. The player callbacks never send anything to the server; only the custom controls do. A shield `div` over the iframe, `controls: 0` and `disablekb: 1` stop users from controlling the video outside those controls. If an unexpected local change happens anyway, the client re-applies the server state.

## RBAC

`constants.js` maps each role to a set of actions. `MessageHandler.authorize()` runs for every event: is the socket in a room, is the user still a member, does the role allow this action, then payload validation, then state change and broadcast. A failure sends a structured `error` to that socket only and changes nothing. UI hiding is only for convenience.

## Control requests

A Participant's `request_*` event creates a pending request in the room (max one per user and type, 60 s expiry, rate limited to 1 per 2 s). It is sent only to Host/Moderators (`request_created`). `approve_request` applies the action exactly as if a privileged user had sent it, then broadcasts `sync_state`. A request never changes playback by itself. Requests are cleared when the user leaves, is removed, or changes role.

## Room lifecycle

```text
POST /api/rooms        -> MongoDB record + in-memory Room (evicted if nobody joins within 60 s)
join_room              -> participant added; eviction cancelled
socket drops           -> 45 s grace, seat and role kept; reconnect with a fresh ticket restores them
grace expires / leave  -> user_left; if it was the Host, succession (below)
room empty for 60 s    -> unloaded from memory, snapshot saved to MongoDB
join later             -> loaded from MongoDB, paused at the saved video/time; creator regains Host
7 days idle            -> MongoDB TTL index deletes the record
DELETE /api/rooms/:id  -> Host only: record deleted, `room_closed` sent, sockets closed (4005), room removed from memory
```

**Host succession:** longest-present Moderator, else longest-present Participant (connected users are preferred). Broadcast as `host_transferred` with `reason: "succession"`.

**Persistence is intentionally sparse:** MongoDB is written on room creation, video change, host change and unload, never on play/pause/seek. The record is removed when the Host deletes the room.

## Connection management

- Malformed JSON, wrong shapes and unknown events return an `error`; the server never crashes on bad input.
- Max message size 16 KB (`ws` `maxPayload`), 40 messages per second per socket.
- Per-user limits: chat 5 per 5 s, requests 1 per 2 s.
- Heartbeat: ping every 30 s, terminate sockets that never answered (also keeps Render's proxy from closing idle connections).
- One active socket per user per room; a new connection replaces the old one (close code 4002).
- Per-socket message queue so messages are handled in order, even though joining is asynchronous.

## Scaling (documented, not built)

```text
              Load balancer
                   |
        -------------------------
        |           |           |
     WS #1        WS #2       WS #3
        |           |           |
        ---------- Redis ---------
                   |
                MongoDB
```

Today one process holds all rooms. For several instances you would add Redis Pub/Sub so room broadcasts reach every instance, move tickets and membership to Redis, and use sticky routing or room-to-instance affinity. Because every broadcast goes through `Room.broadcast()`, `broadcastExcept()` and `broadcastToPrivileged()`, the pub/sub hook goes in one place. Mongoose's default connection pool is used for MongoDB.
