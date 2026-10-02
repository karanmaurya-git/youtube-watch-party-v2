# Requirements checklist

Status key:
- **Tested**: covered by the automated server tests (76 passing).
- **Built, needs browser check**: implemented in the React client; the client compiles (`vite build` passes) but was not exercised in a real browser with the YouTube player.
- **You must do**: needs your accounts or deployment.

## Assignment requirements

| Requirement | Implementation | Status |
|---|---|---|
| Real-time sync (play/pause, seek, video) | Server-authoritative `sync_state` broadcast | Server: Tested. Player behavior: Built, needs browser check |
| Room-based model with codes/links | `POST /api/rooms`, 6-char code, `/watch/CODE` and `/join/CODE` links | Tested (API), Built (UI) |
| YouTube integration | IFrame API hook, URL parsing (watch, youtu.be, embed, shorts) | URL parsing: Tested. Player: Built, needs browser check |
| WebSockets | native `ws` server + browser `WebSocket`, same HTTP server | Tested |
| Role-based access | Host / Moderator / Participant, checked per event on the server | Tested |
| Host assigns roles | `assign_role` (Host only) | Tested |
| Host removes participants | `remove_participant` + kicked list | Tested |
| Host transfers host | `transfer_host`; plus automatic succession | Tested |
| Moderator: play/pause/seek/change video | `CONTROL_PLAYBACK` permission | Tested |
| Participant: watch only | all playback events return `FORBIDDEN` | Tested |
| Backend validates before processing | `MessageHandler.authorize()` | Tested |
| Broadcast role updates | `role_assigned`, `host_transferred`, `participant_removed` | Tested |
| Participant list with roles | `participants` array in every membership/role event, sidebar list | Tested (events), Built (UI) |
| Participant requests approval from admin/mod | `request_*`, `approve_request`, `reject_request` | Tested |
| Change video via pasted URL | `change_video` with URL parsing | Tested |
| Late joiner syncs | `sync_state` after `room_joined` | Tested |
| Host can delete a room (added later) | `DELETE /api/rooms/:roomId`, current Host only; live room closed with `room_closed` | Tested (API and WebSocket); dashboard button Built, needs browser check |
| Chat (bonus) | room-scoped, validated, rate limited, last 50 kept | Tested |
| OOP WebSocket server (bonus) | `Room`, `Participant`, `RoomManager`, `MessageHandler` | Done |
| Persistent rooms (bonus) | MongoDB save + rehydration, TTL cleanup | Logic: Tested with in-memory fakes. Real MongoDB: not tested |
| Authentication (bonus) | register/login, JWT, bcrypt, WebSocket tickets | Tested |
| Transfer host (bonus) | see above | Tested |
| Scalability (bonus) | Documented design only (Redis Pub/Sub, load balancer); not built | Documented |
| Deployed publicly with live URL in README | Instructions and placeholders in README | **You must do** |
| README with setup and URL | `README.md` | Done (add the real URL) |
| Architecture overview | `docs/ARCHITECTURE.md` | Done |
| Demo video or screenshots (optional) | not included | **You must do** (optional) |

## Details from the build prompt

| Item | Status |
|---|---|
| No Socket.IO | Done (`ws` + native `WebSocket` only) |
| Ticket: 30 s, single use, bound to user and room, fresh per reconnect | Tested |
| Disconnect grace 45 s, reconnect restores role, expiry removes | Tested |
| Host succession (Moderator, else Participant) | Tested |
| One socket per user per room (new replaces old) | Tested |
| Empty room evicted after 60 s, reloaded from MongoDB | Tested (fakes) |
| Max 1 pending request per user/type, 60 s expiry, cleared on leave, 1 per 2 s | Tested |
| `request_created` only to Host/Moderators | Tested |
| Moderators can approve/reject | Tested |
| Removed users cannot rejoin | Tested |
| Host cannot target themselves | Tested |
| Server ignores client `updatedAt` | Tested |
| MongoDB written only on create, video change, host change, unload | Tested (no write on seek/pause) |
| Chat isolated per room, validated, rate limited | Tested |
| Malformed JSON / bad shape / unknown event handled | Tested |
| Max message size 16 KB, per-socket flood limit | Built (limit is enforced by `ws`; not covered by a test) |
| Helmet, CORS allow-list, REST auth rate limit | Built (CORS/Helmet not covered by a test) |
| `controls: 0`, `disablekb: 1`, shield overlay for everyone | Built, needs browser check |
| `isRemoteActionRef` event-loop guard, drift correction (5 s / 1.5 s) | Built, needs browser check |
| "Click to join the stream" autoplay overlay | Built, needs browser check |
| Seek emitted on slider release only | Built, needs browser check |
| Player error messages | Built, needs browser check |
| Vercel / Render / Atlas deployment, HTTPS and WSS in production | **You must do** |
| Production CORS with real `CLIENT_URL` | **You must do** |

## Not verified

- Behavior against a real MongoDB (the tests use in-memory fakes; the Mongoose schemas were validated offline, including the TTL index).
- The React UI in a real browser, including YouTube playback, autoplay blocking, and the mobile layout.
- Any production deployment (Vercel, Render, Atlas), `wss://` through Render's proxy, and production CORS.
