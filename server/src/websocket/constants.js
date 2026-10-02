export const ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
});

export const ACTIONS = Object.freeze({
  CONTROL_PLAYBACK: 'control_playback', // play / pause / seek / change video
  RESOLVE_REQUESTS: 'resolve_requests', // approve / reject participant requests
  MANAGE_ROLES: 'manage_roles', // assign role
  REMOVE_PARTICIPANT: 'remove_participant',
  TRANSFER_HOST: 'transfer_host',
  CHAT: 'chat',
  REQUEST_CONTROL: 'request_control',
});

// The one place that defines who may do what. The backend checks this on every event.
const PERMISSIONS = {
  [ROLES.HOST]: new Set([
    ACTIONS.CONTROL_PLAYBACK,
    ACTIONS.RESOLVE_REQUESTS,
    ACTIONS.MANAGE_ROLES,
    ACTIONS.REMOVE_PARTICIPANT,
    ACTIONS.TRANSFER_HOST,
    ACTIONS.CHAT,
  ]),
  [ROLES.MODERATOR]: new Set([
    ACTIONS.CONTROL_PLAYBACK,
    ACTIONS.RESOLVE_REQUESTS,
    ACTIONS.CHAT,
  ]),
  [ROLES.PARTICIPANT]: new Set([ACTIONS.CHAT, ACTIONS.REQUEST_CONTROL]),
};

export const can = (role, action) => Boolean(PERMISSIONS[role]?.has(action));
export const isPrivileged = (role) => can(role, ACTIONS.CONTROL_PLAYBACK);

export const CLOSE = Object.freeze({
  NORMAL: 1000,
  REMOVED: 4001,
  REPLACED: 4002,
  ROOM_NOT_FOUND: 4004,
  ROOM_CLOSED: 4005,
  JOIN_TIMEOUT: 4008,
});

export const LIMITS = Object.freeze({
  MAX_MESSAGE_BYTES: 16 * 1024,
  MAX_CHAT_LENGTH: 500,
  CHAT_HISTORY: 50,
  MAX_SEEK_SECONDS: 24 * 60 * 60,
  MESSAGES_PER_SECOND: 40,
  JOIN_TIMEOUT_MS: 10_000,
  HEARTBEAT_MS: 30_000,
});

// Tunable in tests via RoomManager options.
export const DEFAULT_OPTIONS = Object.freeze({
  disconnectGraceMs: 45_000,
  emptyRoomMs: 60_000,
  requestTtlMs: 60_000,
});
