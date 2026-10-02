import { describeRequest } from '../utils/format.js';

const STATUS_TEXT = {
  pending: 'Waiting for the host',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Replaced',
};

export default function RequestsPanel({ privileged, requests, myRequests, send }) {
  if (privileged) {
    if (requests.length === 0) {
      return <p className="empty">No pending requests. When a participant asks to play, pause, seek or switch video, it shows up here.</p>;
    }
    return (
      <ul className="requests">
        {requests.map((r) => (
          <li key={r.id} className="request">
            <div>
              <strong>{r.username}</strong>
              <span className="request-text">{describeRequest(r)}</span>
            </div>
            <div className="request-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => send('approve_request', { requestId: r.id })}>
                Approve
              </button>
              <button type="button" className="btn btn-small" onClick={() => send('reject_request', { requestId: r.id })}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (myRequests.length === 0) {
    return <p className="empty">You can't control playback directly. Use the buttons under the video to ask the host or a moderator.</p>;
  }
  return (
    <ul className="requests">
      {myRequests.map((r) => (
        <li key={r.id} className="request">
          <div>
            <strong>{describeRequest(r)}</strong>
            <span className={`request-status status-${r.status}`}>{STATUS_TEXT[r.status]}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
