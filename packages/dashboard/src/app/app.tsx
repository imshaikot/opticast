import type { CapabilitiesResponse, StreamRecord } from '@opticast/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCapabilities, fetchStreams } from './api';
import { CreateStreamForm } from './CreateStreamForm';
import { StreamCard } from './StreamCard';

const ACTIVE_POLL_MS = 700;
const IDLE_POLL_MS = 8000;

export function App() {
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Held in a ref so the polling effect does not restart on every tick.
  const hasActiveRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchStreams();
      setStreams(next);
      hasActiveRef.current = next.some(
        (stream) => stream.status === 'queued' || stream.status === 'encoding'
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, hasActiveRef.current ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  return (
    <div className="app">
      <header className="masthead">
        <h1>opticast</h1>
        <p className="muted">
          Encode any file into a video of encrypted 2D barcodes, then scan it back
          with the phone app.
        </p>
        {capabilities && !capabilities.ffmpegAvailable && (
          <p className="error">
            ffmpeg was not found on the server — encoding will fail. Install it or
            set <code>FFMPEG_PATH</code>.
          </p>
        )}
      </header>

      <main className="layout">
        <CreateStreamForm capabilities={capabilities} onCreated={refresh} />

        <section className="streams">
          <h2>Streams</h2>
          {error && <p className="error">{error}</p>}
          {!loaded && <p className="muted">Loading…</p>}
          {loaded && streams.length === 0 && !error && (
            <p className="muted">No streams yet. Upload a file to make one.</p>
          )}
          {streams.map((stream) => (
            <StreamCard key={stream.id} stream={stream} onChanged={refresh} />
          ))}
        </section>
      </main>
    </div>
  );
}

export default App;
