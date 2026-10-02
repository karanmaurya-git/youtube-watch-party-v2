import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRoomSocket } from '../hooks/useRoomSocket.js';
import { useToasts } from '../hooks/useToasts.js';
import { isPrivileged } from '../utils/format.js';
import PlayerPanel from '../components/PlayerPanel.jsx';
import ParticipantList from '../components/ParticipantList.jsx';
import RequestsPanel from '../components/RequestsPanel.jsx';
import Chat from '../components/Chat.jsx';
import RoomTicket from '../components/RoomTicket.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import Toasts from '../components/Toasts.jsx';

const STATUS_TEXT = { connected: 'Connected', connecting: 'Connecting', reconnecting: 'Reconnecting' };

export default function Watch() {
  const roomId = useParams().roomId.toUpperCase();
  const navigate = useNavigate();
  const { toasts, push } = useToasts();
  const [tab, setTab] = useState('people');

  const { state, send, leave } = useRoomSocket(roomId, { onToast: push });
  const { status, me, participants, sync, chat, requests, myRequests } = state;
  const privileged = isPrivileged(me?.role);

  function handleLeave() {
    leave();
    navigate('/');
  }

  if (['removed', 'replaced', 'closed', 'error'].includes(status)) {
    const titles = { removed: 'You were removed from this room', replaced: 'Room open in another tab', closed: 'This room was closed', error: "Can't open this room" };
    return (
      <main className="notice-page">
        <h1>{titles[status]}</h1>
        <p>{state.errorText}</p>
        <Link className="btn btn-primary" to="/">Back to your rooms</Link>
      </main>
    );
  }

  return (
    <div className="watch">
      <header className="watch-header">
        <Link to="/" className="brand" onClick={leave}>Watch Party</Link>
        <RoomTicket roomId={roomId} onCopied={push} />
        <div className="watch-header-right">
          <span className={`status status-${status}`}>{STATUS_TEXT[status] || status}</span>
          {me && <RoleBadge role={me.role} />}
          <button type="button" className="btn btn-small" onClick={handleLeave}>Leave room</button>
        </div>
      </header>

      {!me ? (
        <p className="joining">Joining room...</p>
      ) : (
        <div className="watch-body">
          <div className="stage">
            <PlayerPanel sync={sync} canControl={privileged} send={send} />
          </div>

          <aside className="sidebar">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
                People ({participants.length})
              </button>
              <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
                Requests{privileged && requests.length > 0 ? ` (${requests.length})` : ''}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
                Chat
              </button>
            </div>
            <div className="tab-body">
              {tab === 'people' && <ParticipantList participants={participants} me={me} send={send} />}
              {tab === 'requests' && <RequestsPanel privileged={privileged} requests={requests} myRequests={myRequests} send={send} />}
              {tab === 'chat' && <Chat messages={chat} me={me} send={send} />}
            </div>
          </aside>
        </div>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
