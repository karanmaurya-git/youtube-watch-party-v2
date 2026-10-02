const OPEN = 1;

export const encode = (type, payload = {}) => JSON.stringify({ type, payload });

/** Sends one message if the socket is open. All outgoing traffic goes through here. */
export function sendRaw(ws, data) {
  if (ws && ws.readyState === OPEN) ws.send(data);
}

export const send = (ws, type, payload) => sendRaw(ws, encode(type, payload));

export const sendError = (ws, code, message) => send(ws, 'error', { code, message });
