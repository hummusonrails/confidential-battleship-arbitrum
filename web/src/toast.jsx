import { useEffect, useState } from 'react';

// Toasts appear instantly, stay for their duration (1 s, 2 s for wins), then fade over 300 ms. Newest on top.
let listeners = [];
let nextId = 0;

export function toast(text, { win = false, duration = win ? 2000 : 1000 } = {}) {
  const item = { id: nextId++, text, win, duration };
  listeners.forEach((listener) => listener(item));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const listener = (item) => {
      setItems((prev) => [item, ...prev]);
      setTimeout(() => setItems((prev) => prev.map((t) => (t.id === item.id ? { ...t, fading: true } : t))), item.duration);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== item.id)), item.duration + 300);
    };
    listeners.push(listener);
    return () => { listeners = listeners.filter((l) => l !== listener); };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast${t.win ? ' win' : ''}${t.fading ? ' fade' : ''}`}>{t.text}</div>)}
    </div>
  );
}
