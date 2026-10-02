import { useState } from 'react';

/** The room code, drawn as a ticket stub. */
export default function RoomTicket({ roomId, onCopied }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const link = `${window.location.origin}/watch/${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      onCopied?.('Invite link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onCopied?.(link);
    }
  }

  return (
    <div className="ticket">
      <div className="ticket-main">
        <span className="ticket-label">Room code</span>
        <span className="ticket-code">{roomId}</span>
      </div>
      <button type="button" className="ticket-stub" onClick={copyLink}>
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
    </div>
  );
}
