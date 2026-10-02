import { useCallback, useEffect, useReducer, useRef } from 'react';
import { WS_URL } from '../services/config.js';
import { errorMessage, getWsTicket } from '../services/api.js';
import { isPrivileged } from '../utils/format.js';

// Close codes the server uses to say "do not reconnect".
const CLOSE_REMOVED = 4001;
const CLOSE_REPLACED = 4002;
const CLOSE_NOT_FOUND = 4004;
const CLOSE_ROOM_CLOSED = 4005;

const initialState = {
  status: 'connecting', // connecting | connected | reconnecting | removed | replaced | closed | error
  errorText: '',
  me: null,
  participants: [],
  sync: null,
  chat: [],
  requests: [], // pending requests (Host/Moderator view)
  myRequests: [], // my own requests and their outcome (Participant view)
};

/** The server is the source of truth: our role is always read back from the participant list. */
function withParticipants(state, participants) {
  const self = participants.find((p) => p.userId === state.me?.userId);
  return { ...state, participants, me: self && state.me ? { ...state.me, role: self.role } : state.me };
}

function reducer(state, action) {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status };
    case 'fatal':
      // If the server's message already set this status, keep its text.
      return { ...state, status: action.status, errorText: state.status === action.status ? state.errorText || action.text || '' : action.text || '' };
    case 'joined': {
      const privileged = isPrivileged(action.you.role);
      return {
        ...state,
        status: 'connected',
        me: action.you,
        participants: action.participants,
        chat: action.chat,
        requests: privileged ? action.requests : [],
        myRequests: privileged ? [] : action.requests.map((r) => ({ ...r, status: 'pending' })),
      };
    }
    case 'sync':
      return { ...state, sync: action.sync };
    case 'participants':
      return withParticipants(state, action.participants);
    case 'chat':
      return { ...state, chat: [...state.chat, action.message].slice(-100) };
    case 'request_list':
      return { ...state, requests: action.requests, myRequests: [] };
    case 'request_created':
      return { ...state, requests: [...state.requests.filter((r) => r.id !== action.request.id), action.request] };
    case 'request_ack':
      return { ...state, myRequests: [{ ...action.request, status: 'pending' }, ...state.myRequests].slice(0, 6) };
    case 'request_resolved':
      return {
        ...state,
        requests: state.requests.filter((r) => r.id !== action.requestId),
        myRequests: state.myRequests.map((r) => (r.id === action.requestId ? { ...r, status: action.status } : r)),
      };
    default:
      return state;
  }
}

/**
 * Owns the single native WebSocket for a room: ticket -> connect -> join_room -> messages,
 * with automatic reconnect (fresh ticket every time, because tickets are single-use).
 */
export function useRoomSocket(roomId, { onToast } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(null);
  const callbacks = useRef({ onToast });
  callbacks.current = { onToast };
  const meRef = useRef(null);
  meRef.current = state.me;

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    let retryTimer = null;

    const toast = (text, kind) => callbacks.current.onToast?.(text, kind);

    function handleMessage({ type, payload }) {
      switch (type) {
        case 'room_joined':
          retries = 0;
          dispatch({ type: 'joined', ...payload });
          if (payload.reconnected) toast('Reconnected', 'success');
          break;
        case 'sync_state':
          // offset = how far the server clock is ahead of ours; used to compute the expected time.
          dispatch({ type: 'sync', sync: { ...payload, offset: payload.serverTime - Date.now() } });
          break;
        case 'user_joined':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} joined`);
          break;
        case 'user_left':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} ${payload.reason === 'timeout' ? 'lost connection' : 'left'}`);
          break;
        case 'participant_removed':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} was removed`);
          break;
        case 'role_assigned':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} is now ${payload.role}`);
          break;
        case 'host_transferred':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.newHostName} is now the host`);
          break;
        case 'room_closed':
          dispatch({ type: 'fatal', status: 'closed', text: payload.message });
          break;
        case 'removed_from_room':
          dispatch({ type: 'fatal', status: 'removed', text: payload.message });
          break;
        case 'request_list':
          dispatch({ type: 'request_list', requests: payload.requests });
          break;
        case 'request_created':
          dispatch({ type: 'request_created', request: payload });
          break;
        case 'request_ack':
          dispatch({ type: 'request_ack', request: payload });
          toast('Request sent to the host');
          break;
        case 'request_resolved':
          dispatch({ type: 'request_resolved', ...payload });
          if (payload.requesterId === meRef.current?.userId && payload.status !== 'cancelled') {
            toast(`Your request was ${payload.status}`, payload.status === 'approved' ? 'success' : 'info');
          }
          break;
        case 'chat_message':
          dispatch({ type: 'chat', message: payload });
          break;
        case 'error':
          toast(payload.message, 'error');
          break;
        default:
          break;
      }
    }

    function scheduleRetry() {
      if (cancelled) return;
      retries += 1;
      dispatch({ type: 'status', status: 'reconnecting' });
      retryTimer = setTimeout(connect, Math.min(1000 * 2 ** (retries - 1), 10_000));
    }

    async function connect() {
      if (cancelled) return;
      let ticket;
      try {
        ticket = await getWsTicket(roomId); // fresh single-use ticket for every (re)connect
      } catch (err) {
        const code = err.response?.status;
        if (code === 403 || code === 404 || code === 400) {
          dispatch({ type: 'fatal', status: code === 403 ? 'removed' : 'error', text: errorMessage(err) });
          return;
        }
        scheduleRetry();
        return;
      }
      if (cancelled) return;

      const ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      socketRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
      ws.onmessage = (event) => {
        if (socketRef.current !== ws) return;
        try {
          handleMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Bad message from server', err);
        }
      };
      ws.onclose = (event) => {
        if (socketRef.current === ws) socketRef.current = null;
        if (cancelled) return;
        if (event.code === CLOSE_REMOVED) dispatch({ type: 'fatal', status: 'removed', text: 'You were removed from this room.' });
        else if (event.code === CLOSE_REPLACED) dispatch({ type: 'fatal', status: 'replaced', text: 'This room was opened in another tab.' });
        else if (event.code === CLOSE_ROOM_CLOSED) dispatch({ type: 'fatal', status: 'closed', text: 'The host closed this room.' });
        else if (event.code === CLOSE_NOT_FOUND) dispatch({ type: 'fatal', status: 'error', text: 'Room not found.' });
        else if (event.code !== 1000) scheduleRetry();
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close(1000);
    };
  }, [roomId]);

  const send = useCallback((type, payload = {}) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    callbacks.current.onToast?.('Not connected. Reconnecting...', 'error');
    return false;
  }, []);

  const leave = useCallback(() => {
    send('leave_room');
  }, [send]);

  return { state, send, leave };
}
