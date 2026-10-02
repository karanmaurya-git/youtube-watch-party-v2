import axios from 'axios';
import { API_URL } from './config.js';

export const STORAGE_KEY = 'watch-party-auth';

export const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
};

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const session = readSession();
  if (session?.token) config.headers.Authorization = `Bearer ${session.token}`;
  return config;
});

// An expired/invalid token on a protected call means the session is over.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const url = error.config?.url || '';
    const isAuthForm = url.includes('/auth/login') || url.includes('/auth/register');
    if (error.response?.status === 401 && !isAuthForm) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

export const errorMessage = (error) =>
  error.response?.data?.message || (error.request ? 'Cannot reach the server. Try again in a moment.' : error.message);

export const register = (data) => api.post('/auth/register', data).then((r) => r.data);
export const login = (data) => api.post('/auth/login', data).then((r) => r.data);
export const logout = () => api.post('/auth/logout').catch(() => {});
export const createRoom = () => api.post('/rooms').then((r) => r.data.room);
export const listRooms = () => api.get('/rooms').then((r) => r.data.rooms);
export const deleteRoom = (roomId) => api.delete(`/rooms/${roomId}`).then((r) => r.data);
export const getRoom = (roomId) => api.get(`/rooms/${roomId}`).then((r) => r.data.room);
export const getWsTicket = (roomId) => api.post('/auth/ws-ticket', { roomId }).then((r) => r.data.ticket);

export default api;
