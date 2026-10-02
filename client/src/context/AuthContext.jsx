import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(api.readSession);

  const save = useCallback((data) => {
    const next = { token: data.token, user: data.user };
    localStorage.setItem(api.STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user || null,
      isAuthenticated: Boolean(session?.token),
      login: async (credentials) => save(await api.login(credentials)),
      register: async (details) => save(await api.register(details)),
      logout: async () => {
        await api.logout();
        localStorage.removeItem(api.STORAGE_KEY);
        setSession(null);
      },
    }),
    [session, save]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
