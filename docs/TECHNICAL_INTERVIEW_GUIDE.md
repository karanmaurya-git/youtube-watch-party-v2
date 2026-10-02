# Technical interview guide

Short, honest answers you can build on. Read the code behind each one so you can point at it.

**Why React and Vite?** React for a UI driven by server state (participants, requests, chat re-render when events arrive). Vite for a fast dev server and a simple static build that Vercel can host.

**Why Node and Express?** One language across client and server, and Node's event loop suits many mostly-idle WebSocket connections. Express handles the small REST surface (auth, rooms, tickets).

**Why MongoDB?** Room and user data are small documents with no joins. The TTL index also cleans up abandoned rooms automatically. Active room state is not in MongoDB because it changes too fast.

**Why WebSockets, and why not Socket.IO?** Sync needs the server to push updates the instant they happen; polling would add delay and load. The assignment asks for WebSockets, so I used the native browser `WebSocket` and the `ws` library. Trade-off: no built-in rooms, acknowledgements or auto-reconnect, so I wrote rooms (`Room`/`RoomManager`), heartbeat, and reconnection with backoff myself.

**How does `ws` work here?** A `WebSocketServer` in `noServer` mode. The HTTP server's `upgrade` event fires when a browser asks to switch to WebSocket; I validate the ticket and origin there and only then call `handleUpgrade`. Each connection emits `message` and `close` events.

**How does the YouTube IFrame API work?** I load `iframe_api`, create a `YT.Player`, and call `loadVideoById`, `cueVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `getCurrentTime`. There is no "seek" event, so seeks are only sent from my own slider.

**How does synchronization work?** The server keeps `{videoId, isPlaying, currentTime, updatedAt}` and broadcasts `sync_state` on every change. Clients compute `expected = currentTime + (now - updatedAt)/1000` while playing. Late joiners get `sync_state` right after joining.

**How is drift corrected?** Every 5 seconds the client compares its player time to the expected time and seeks only if it is more than 1.5 s off. Seeking constantly would cause stutter. The server clock offset comes from `serverTime` in `sync_state`; it ignores network latency, so accuracy is about one round trip.

**How do you prevent event loops?** The player is driven only by server state. When I apply a remote update I set `isRemoteActionRef` so the resulting `onStateChange` is ignored, and the player callbacks never send to the server; only my custom controls do.

**How does JWT authentication work?** Login returns a signed JWT (`sub` = user id). The client sends it as `Authorization: Bearer` on REST calls and middleware verifies it and loads the user. Passwords are bcrypt hashed. Logout just discards the token because JWTs are stateless.

**How does WebSocket authentication work?** Browsers can't set headers on `new WebSocket`, and a JWT in the URL would leak in logs. So the client trades its JWT for a ticket: random, 30 s, single use, bound to user and room, kept in memory. It is checked and deleted during the upgrade.

**How does RBAC work, and why validate on the backend?** `constants.js` maps role to allowed actions; `MessageHandler` checks it on every event, with identity taken from the ticket, never from the message. Anyone can open dev tools and send any WebSocket message, so UI hiding is not security.

**How does Host transfer work?** `Room.transferHost` demotes the old Host and promotes the target in one synchronous step, so there is never zero or two Hosts, then broadcasts `host_transferred`. If the Host leaves for good, the longest-present Moderator (else Participant) is promoted.

**How does participant approval work?** A participant's `request_*` event creates a pending request visible only to Host/Moderators. `approve_request` applies the action as if a privileged user did it; reject, expiry (60 s) or the user leaving just discards it. A request never changes playback by itself.

**How does MongoDB store room data?** A `Room` document: code, hostId, video id, last time, `lastActiveAt` (TTL index, 7 days). It is written on create, video change, host change and when an empty room is unloaded, never on play/pause/seek.

**What is the disconnect grace period for?** A refresh drops the socket. Removing the user immediately would lose their role, so the seat is kept for 45 s and a reconnect (with a fresh ticket) restores it.

**How does deployment work, and why Vercel and Render?** Vercel serves the static React build from its CDN. Render runs a long-lived Node process, which WebSockets need (serverless functions can't hold sockets open). MongoDB Atlas hosts the database. `CLIENT_URL` on the server must match the Vercel origin exactly for CORS and the WebSocket origin check.

**How would you scale to 1,000+ users? What would Redis solve?** One process holds all rooms today. With several instances, a user on instance 1 wouldn't see a broadcast made on instance 2. Redis Pub/Sub would carry room events between instances, and tickets/membership would move to Redis. Mongoose already pools connections. I haven't built this and I don't claim the MVP scales to that load.

**Limitations of the current architecture?** Single instance; tickets and kicked lists are in memory; JWT in localStorage; clock offset ignores latency; after a restart a room waits for its creator to regain Host; not tested against a real MongoDB or in a real browser during development.

**Trade-offs or issues I ran into (be ready to tell one):** autoplay policies block unmuted playback for late joiners, so there is a "Click to join the stream" button; the YouTube player fires events for changes my code made, hence `isRemoteActionRef`; tickets are single use, so every reconnect needs a new one.
