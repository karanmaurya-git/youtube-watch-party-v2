export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const ROLE_LABEL = { host: 'Host', moderator: 'Moderator', participant: 'Participant' };
export const isPrivileged = (role) => role === 'host' || role === 'moderator';

export function describeRequest(request) {
  switch (request.type) {
    case 'play':
      return 'Play the video';
    case 'pause':
      return 'Pause the video';
    case 'seek':
      return `Jump to ${formatTime(request.payload?.time)}`;
    case 'change_video':
      return `Switch video (${request.payload?.videoId})`;
    default:
      return request.type;
  }
}
