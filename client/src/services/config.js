export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// No path: the ws server is attached directly to the HTTP server.
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';
