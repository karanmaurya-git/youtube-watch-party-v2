import { useCallback, useState } from 'react';

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'info') => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return { toasts, push };
}
