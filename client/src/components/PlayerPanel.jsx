import { useEffect, useRef, useState } from 'react';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer.js';
import { formatTime } from '../utils/format.js';

/**
 * Video + custom controls. The native YouTube controls are off and a shield sits on top of
 * the iframe, so the only way to act is through these controls. Participants' controls send
 * requests; Host/Moderator controls send real playback events. The server decides either way.
 */
export default function PlayerPanel({ sync, canControl, send }) {
  const mountRef = useRef(null);
  const { ready, error, blocked, time, applyRemote, resume } = useYouTubePlayer(mountRef);
  const [scrub, setScrub] = useState(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (ready && sync) applyRemote(sync);
  }, [ready, sync, applyRemote]);

  const hasVideo = Boolean(sync?.videoId);
  const isPlaying = Boolean(sync?.isPlaying);
  const duration = time.duration || 0;

  function togglePlay() {
    if (!hasVideo) return;
    const action = isPlaying ? 'pause' : 'play';
    send(canControl ? action : `request_${action}`);
  }

  // Seek is sent once, when the slider is released, never on every drag tick.
  function commitSeek() {
    if (scrub === null) return;
    send(canControl ? 'seek' : 'request_seek', { time: scrub });
    setScrub(null);
  }

  function submitVideo(event) {
    event.preventDefault();
    if (!url.trim()) return;
    if (send(canControl ? 'change_video' : 'request_change_video', { url: url.trim() })) setUrl('');
  }

  return (
    <section className="player-panel">
      <div className="player-frame">
        <div ref={mountRef} className="player-mount" />
        <div
          className={`player-shield${canControl && hasVideo ? ' clickable' : ''}`}
          onClick={canControl ? togglePlay : undefined}
        />
        {!hasVideo && (
          <div className="player-message">
            <strong>No video yet</strong>
            <span>{canControl ? 'Paste a YouTube link below to start.' : 'Waiting for the host to pick a video.'}</span>
          </div>
        )}
        {error && (
          <div className="player-message player-error">
            <strong>{error}</strong>
            <span>{canControl ? 'Pick another video below.' : 'Ask the host to pick another video.'}</span>
          </div>
        )}
        {blocked && (
          <button type="button" className="join-stream" onClick={resume}>
            Click to join the stream
          </button>
        )}
      </div>

      <div className="controls">
        <button type="button" className="btn btn-primary" onClick={togglePlay} disabled={!hasVideo}>
          {canControl ? (isPlaying ? 'Pause' : 'Play') : isPlaying ? 'Request pause' : 'Request play'}
        </button>
        <span className="time">{formatTime(scrub ?? time.current)}</span>
        <input
          className="seek"
          type="range"
          min="0"
          max={Math.max(duration, 1)}
          step="1"
          value={Math.min(scrub ?? time.current, Math.max(duration, 1))}
          disabled={!hasVideo}
          aria-label={canControl ? 'Seek' : 'Request a seek'}
          onChange={(e) => setScrub(Number(e.target.value))}
          onMouseUp={commitSeek}
          onTouchEnd={commitSeek}
          onKeyUp={commitSeek}
        />
        <span className="time">{formatTime(duration)}</span>
      </div>
      {!canControl && hasVideo && <p className="hint">Only the host and moderators control playback. Your buttons send them a request.</p>}

      <form className="video-form" onSubmit={submitVideo}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link"
          aria-label="YouTube link"
        />
        <button type="submit" className="btn" disabled={!url.trim()}>
          {canControl ? 'Change video' : 'Suggest video'}
        </button>
      </form>
    </section>
  );
}
