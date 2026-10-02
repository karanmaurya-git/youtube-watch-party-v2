import { useCallback, useEffect, useRef, useState } from 'react';

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const DRIFT_SECONDS = 1.5; // only correct when we are further off than this
const ERROR_TEXT = {
  2: 'This video link is not valid.',
  5: 'This video cannot be played in the embedded player.',
  100: 'This video was removed or is private.',
  101: 'The owner does not allow this video to be embedded.',
  150: 'The owner does not allow this video to be embedded.',
};

let apiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
    });
  }
  return apiPromise;
}

/** Where the video should be right now, from the server's authoritative state. */
export function expectedTime(sync) {
  if (!sync) return 0;
  if (!sync.isPlaying) return sync.currentTime;
  return sync.currentTime + (Date.now() + sync.offset - sync.updatedAt) / 1000;
}

/**
 * Wraps the YouTube IFrame API. The player is only ever driven by server state.
 * `isRemoteActionRef` marks changes WE made so the resulting player events are not mistaken
 * for a user's own action (event-loop prevention). The hook never sends anything itself.
 */
export function useYouTubePlayer(mountRef) {
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const syncRef = useRef(null);
  const loadedVideoRef = useRef(null);
  const isRemoteActionRef = useRef(false);
  const remoteTimerRef = useRef(null);
  const autoplayTimerRef = useRef(null);
  const blockedRef = useRef(false);
  const applyRef = useRef(() => {});

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlockedState] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });

  const setBlocked = useCallback((value) => {
    blockedRef.current = value;
    setBlockedState(value);
  }, []);

  const runRemote = useCallback((fn) => {
    isRemoteActionRef.current = true;
    clearTimeout(remoteTimerRef.current);
    try {
      fn();
    } finally {
      remoteTimerRef.current = setTimeout(() => {
        isRemoteActionRef.current = false;
      }, 800);
    }
  }, []);

  /** Makes the local player match the server state (video, position, play/pause). */
  const applyRemote = useCallback(
    (sync) => {
      const player = playerRef.current;
      if (!player || !readyRef.current || !sync) return;
      syncRef.current = sync;
      if (!sync.videoId) return;

      const target = Math.max(0, expectedTime(sync));
      runRemote(() => {
        if (loadedVideoRef.current !== sync.videoId) {
          loadedVideoRef.current = sync.videoId;
          setError(null);
          const args = { videoId: sync.videoId, startSeconds: target };
          if (sync.isPlaying) player.loadVideoById(args);
          else player.cueVideoById(args);
        } else {
          if (Math.abs(player.getCurrentTime() - target) > (sync.isPlaying ? DRIFT_SECONDS : 0.3)) {
            player.seekTo(target, true);
          }
          if (sync.isPlaying) player.playVideo();
          else player.pauseVideo();
        }
      });

      // Browsers can block autoplay for users who haven't interacted yet.
      clearTimeout(autoplayTimerRef.current);
      if (sync.isPlaying) {
        autoplayTimerRef.current = setTimeout(() => {
          const state = player.getPlayerState?.();
          const stuck = state !== STATE.PLAYING && state !== STATE.BUFFERING && syncRef.current?.isPlaying;
          setBlocked(Boolean(stuck));
        }, 1800);
      } else {
        setBlocked(false);
      }
    },
    [runRemote, setBlocked]
  );
  applyRef.current = applyRemote;

  // Create the player once.
  useEffect(() => {
    let destroyed = false;
    let player = null;
    const mount = mountRef.current;

    loadYouTubeApi().then((YT) => {
      if (destroyed || !mount) return;
      const el = document.createElement('div');
      mount.appendChild(el);
      player = new YT.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            setReady(true);
          },
          onStateChange: (event) => {
            // Ignore changes we caused. Anything else (e.g. a stray local pause) is
            // undone by re-applying the server state. We never broadcast from here.
            if (isRemoteActionRef.current) return;
            const sync = syncRef.current;
            if (!sync?.videoId) return;
            if ((event.data === STATE.PAUSED && sync.isPlaying) || (event.data === STATE.PLAYING && !sync.isPlaying)) {
              setTimeout(() => applyRef.current(syncRef.current), 300);
            }
          },
          onError: (event) => setError(ERROR_TEXT[event.data] || 'The video could not be played.'),
        },
      });
      playerRef.current = player;
    });

    return () => {
      destroyed = true;
      readyRef.current = false;
      playerRef.current = null;
      loadedVideoRef.current = null;
      clearTimeout(remoteTimerRef.current);
      clearTimeout(autoplayTimerRef.current);
      try {
        player?.destroy();
      } catch {
        /* player may already be gone */
      }
      mount?.replaceChildren();
    };
  }, [mountRef]);

  // Progress display (twice a second).
  useEffect(() => {
    if (!ready) return undefined;
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player?.getCurrentTime) return;
      const current = player.getCurrentTime();
      const duration = player.getDuration();
      setTime((prev) => (Math.abs(prev.current - current) > 0.4 || prev.duration !== duration ? { current, duration } : prev));
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  // Drift correction: every 5s compare against the server-computed time, and only seek if far off.
  useEffect(() => {
    if (!ready) return undefined;
    const id = setInterval(() => {
      const sync = syncRef.current;
      const player = playerRef.current;
      if (!sync?.videoId || !player || isRemoteActionRef.current) return;
      const state = player.getPlayerState();
      const target = expectedTime(sync);
      if (sync.isPlaying) {
        if ((state === STATE.PAUSED || state === STATE.CUED) && !blockedRef.current) {
          applyRef.current(sync);
        } else if (state === STATE.PLAYING && Math.abs(player.getCurrentTime() - target) > DRIFT_SECONDS) {
          runRemote(() => player.seekTo(target, true));
        }
      } else if (state === STATE.PLAYING) {
        applyRef.current(sync);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [ready, runRemote]);

  /** Called from a click: a user gesture lets the browser start playback. */
  const resume = useCallback(() => {
    setBlocked(false);
    if (syncRef.current) applyRemote(syncRef.current);
  }, [applyRemote, setBlocked]);

  return { ready, error, blocked, time, applyRemote, resume };
}
