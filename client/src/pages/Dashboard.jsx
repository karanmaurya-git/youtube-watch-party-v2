import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { createRoom, deleteRoom, errorMessage, getRoom, listRooms } from '../services/api.js';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listRooms().then(setRooms).catch(() => {});
  }, []);

  async function handleCreate() {
    setError('');
    setBusy(true);
    try {
      const room = await createRoom();
      navigate(`/watch/${room.roomId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function handleJoin(event) {
    event.preventDefault();
    setError('');
    const roomId = code.trim().toUpperCase();
    try {
      await getRoom(roomId); // quick check so a typo shows an error here instead of in the room
      navigate(`/watch/${roomId}`);
    } catch (err) {
      setError(err.response?.status === 404 ? 'No room with that code. Check it and try again.' : errorMessage(err));
    }
  }

  async function handleDelete(roomId) {
    const ok = window.confirm(`Delete room ${roomId}?\n\nEveryone inside will be disconnected, and this can't be undone.`);
    if (!ok) return;
    setError('');
    try {
      await deleteRoom(roomId);
      setRooms((list) => list.filter((r) => r.roomId !== roomId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">Watch Party</span>
        <div className="topbar-right">
          <span className="muted">{user?.name}</span>
          <button type="button" className="btn btn-small" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="dashboard">
        <h1>Hi {user?.name}, what are we watching?</h1>
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="dash-grid">
          <section className="dash-card">
            <h2>Start a room</h2>
            <p>You'll be the host and control playback. Share the code and friends can join.</p>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={busy}>
              {busy ? 'Creating...' : 'Create room'}
            </button>
          </section>

          <form className="dash-card" onSubmit={handleJoin}>
            <h2>Join a room</h2>
            <p>Enter the 6-character code you were given.</p>
            <div className="inline-form">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABC123"
                aria-label="Room code"
                className="code-input"
              />
              <button type="submit" className="btn btn-primary" disabled={code.trim().length !== 6}>Join room</button>
            </div>
          </form>
        </div>

        {rooms.length > 0 && (
          <section className="my-rooms">
            <h2>Your rooms</h2>
            <ul>
              {rooms.map((room) => (
                <li key={room.roomId}>
                  <span className="code-chip">{room.roomId}</span>
                  <Link to={`/watch/${room.roomId}`}>Open room</Link>
                  <button type="button" className="btn btn-small btn-danger row-delete" onClick={() => handleDelete(room.roomId)} aria-label={`Delete room ${room.roomId}`}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
