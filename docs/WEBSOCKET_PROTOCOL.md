# WebSocket protocol

## Connection

```text
wss://YOUR-SERVER.onrender.com/?ticket=<ticket>
```

1. Get a ticket: `POST /api/auth/ws-ticket` with `Authorization: Bearer <JWT>` and body `{ "roomId": "ABC234" }`.
2. Ticket: random, 30 s TTL, single use, bound to one user and one room, kept in server memory.
3. If the ticket is missing, unknown, used or expired the upgrade is refused with HTTP 401. A bad `Origin` gets HTTP 403.
4. After connecting, send `join_room` within 10 seconds or the server closes the socket (code 4008).
5. **Request a fresh ticket for every connect and reconnect**: a used ticket cannot be reused.

## Message format

Every message, both directions:

```json
{ "type": "play", "payload": {} }
```

`payload` must be an object (it may be omitted). Max 16 KB per message.

## Client to server

| type | payload | Allowed for |
|---|---|---|
| `join_room` | `{ roomId }` (must equal the ticket's room) | any authenticated user |
| `leave_room` | `{}` | member |
| `request_sync` | `{}` | member |
| `play`, `pause` | `{}` | Host, Moderator |
| `seek` | `{ time }` seconds, number 0..86400 | Host, Moderator |
| `change_video` | `{ url }` or `{ videoId }` (watch, youtu.be, embed, shorts, live, or 11-char id) | Host, Moderator |
| `request_play`, `request_pause` | `{}` | Participant |
| `request_seek` | `{ time }` | Participant |
| `request_change_video` | `{ url }` or `{ videoId }` | Participant |
| `approve_request`, `reject_request` | `{ requestId }` | Host, Moderator |
| `assign_role` | `{ userId, role: "moderator" \| "participant" }` | Host (not on self) |
| `remove_participant` | `{ userId }` | Host (not on self) |
| `transfer_host` | `{ userId }` | Host (not to self) |
| `chat_message` | `{ message }` 1-500 chars after trim | any member |

## Server to client

| type | payload | Sent to |
|---|---|---|
| `room_joined` | `{ roomId, you: {userId, username, role, joinedAt}, participants, chat, requests, reconnected }` | the joiner |
| `sync_state` | `{ videoId, isPlaying, currentTime, updatedAt, serverTime }` | room (after changes), the joiner (on join), requester of `request_sync` |
| `user_joined` | `{ userId, username, role, participants }` | everyone except the joiner |
| `user_left` | `{ userId, username, reason: "left" \| "timeout", participants }` | room |
| `role_assigned` | `{ userId, username, role, participants }` | room |
| `participant_removed` | `{ userId, username, participants }` | room |
| `removed_from_room` | `{ roomId, message }` | the removed user (then the socket closes with 4001) |
| `room_closed` | `{ roomId, message }` | everyone in the room, when the Host deletes it (sockets then close with 4005) |
| `host_transferred` | `{ oldHostId, newHostId, newHostName, reason: "transfer" \| "succession", participants }` | room |
| `request_ack` | request | the requester |
| `request_created` | `{ id, userId, username, type, payload, createdAt }` | Host and Moderators only |
| `request_list` | `{ requests }` | a user who just became Host/Moderator |
| `request_resolved` | `{ requestId, type, status: "approved" \| "rejected" \| "expired" \| "cancelled", requesterId, resolvedBy }` | Host/Moderators and the requester |
| `chat_message` | `{ id, userId, username, message, timestamp }` | room |
| `error` | `{ code, message }` | the sender only |

`participants` is always the full list `[{ userId, username, role, joinedAt }]`, ordered Host, Moderators, Participants, so the UI can simply render it.

Request `type` values: `play`, `pause`, `seek`, `change_video`.

## Validation order for protected events

```text
authenticated (ticket) -> in a room -> role allows the action -> payload valid -> state change -> broadcast
```

## Error codes

| code | Meaning |
|---|---|
| `INVALID_JSON` | not valid JSON |
| `INVALID_MESSAGE` | wrong shape (needs `type` string and `payload` object) |
| `UNKNOWN_EVENT` | unsupported `type` |
| `NOT_IN_ROOM` | send `join_room` first / you were removed |
| `ALREADY_JOINED` | already in a room on this socket |
| `ROOM_MISMATCH` | `join_room` room differs from the ticket's room |
| `ROOM_NOT_FOUND` | room is neither in memory nor in MongoDB (socket closes with 4004) |
| `REMOVED` | you were removed from this room (socket closes with 4001) |
| `FORBIDDEN` | your role cannot do this |
| `INVALID_PAYLOAD` | bad field values (seek time, role, chat length) |
| `INVALID_VIDEO` | not a valid YouTube URL/id |
| `NO_VIDEO` | no video is loaded yet |
| `INVALID_TARGET` | acting on yourself |
| `TARGET_NOT_FOUND` | that user is not in the room |
| `REQUEST_NOT_FOUND` | request already resolved/expired |
| `RATE_LIMITED` | too many messages/requests/chats |
| `INTERNAL_ERROR` | unexpected server error |

## Close codes

| code | Meaning | Client should |
|---|---|---|
| 1000 | normal / left room | not reconnect |
| 4001 | removed by the host | not reconnect |
| 4002 | replaced by a newer connection from the same user | not reconnect |
| 4004 | room not found | not reconnect |
| 4005 | the Host deleted the room | not reconnect |
| 4008 | no `join_room` within 10 s | reconnect |
| others | network drop | reconnect with backoff and a fresh ticket |
