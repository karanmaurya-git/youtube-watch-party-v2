import { useEffect, useRef, useState } from 'react';

const formatClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function Chat({ messages, me, send }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function submit(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    if (send('chat_message', { message })) setText('');
  }

  return (
    <div className="chat">
      <ul className="chat-list" ref={listRef}>
        {messages.length === 0 && <li className="empty">No messages yet. Say something about the video.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`chat-message${m.userId === me?.userId ? ' mine' : ''}`}>
            <div className="chat-meta">
              <strong>{m.username}</strong>
              <time>{formatClock(m.timestamp)}</time>
            </div>
            {/* Rendered as plain text by React, so chat can't inject HTML. */}
            <p>{m.message}</p>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message the room" aria-label="Message" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
