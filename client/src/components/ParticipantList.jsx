import RoleBadge from './RoleBadge.jsx';

export default function ParticipantList({ participants, me, send }) {
  const isHost = me?.role === 'host';

  function confirmThen(message, action) {
    if (window.confirm(message)) action();
  }

  return (
    <ul className="people">
      {participants.map((p) => {
        const isMe = p.userId === me?.userId;
        return (
          <li key={p.userId} className="person">
            <div className="person-info">
              <span className="person-name">
                {p.username}
                {isMe && <span className="you"> (you)</span>}
              </span>
              <RoleBadge role={p.role} />
            </div>
            {isHost && !isMe && (
              <div className="person-actions">
                {p.role === 'participant' ? (
                  <button type="button" className="btn btn-small" onClick={() => send('assign_role', { userId: p.userId, role: 'moderator' })}>
                    Make moderator
                  </button>
                ) : (
                  <button type="button" className="btn btn-small" onClick={() => send('assign_role', { userId: p.userId, role: 'participant' })}>
                    Make participant
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => confirmThen(`Make ${p.username} the host? You will become a participant.`, () => send('transfer_host', { userId: p.userId }))}
                >
                  Make host
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  onClick={() => confirmThen(`Remove ${p.username} from the room?`, () => send('remove_participant', { userId: p.userId }))}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
