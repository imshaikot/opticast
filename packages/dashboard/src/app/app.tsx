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

  const encoding = streams.some(
    (stream) => stream.status === 'queued' || stream.status === 'encoding'
  );

  return (
    <div className="app">
      <div className="sysbar">
        <b>OPTICAST</b>
        <span>//</span>
        <span>OPTICAL TRANSPORT SYSTEM</span>
        <span className="sysbar-right">
          <i className={`led${encoding ? ' led-on' : ''}`} />
          <span>{encoding ? 'ENCODING' : 'IDLE'}</span>
          <span>·</span>
          <span>
            {streams.length} STREAM{streams.length === 1 ? '' : 'S'}
          </span>
        </span>
      </div>

      <header className="masthead">
        <h1 className="logo">
          OPTICAST
          <span className="caret">_</span>
        </h1>
        <p className="tagline">
          Encode any file into a video of encrypted 2D barcodes, then scan it back
          with the phone app.
        </p>
        <div className="rule" />
        {capabilities && !capabilities.ffmpegAvailable && (
          <div className="alert">
            <span className="alert-tag">! FAULT</span>
            <p>
              ffmpeg was not found on the server — encoding will fail. Install it
              or set <code>FFMPEG_PATH</code>.
            </p>
          </div>
        )}
      </header>

      <main className="layout">
        <CreateStreamForm capabilities={capabilities} onCreated={refresh} />

        <section className="streams">
          <div>
            <div className="section-head">
              <h2>Streams</h2>
              <span className="count">
                {String(streams.length).padStart(3, '0')} REC
              </span>
            </div>
            <div className="rule" />
          </div>
          {error && <p className="error">{error}</p>}
          {!loaded && <p className="readout">LOADING…</p>}
          {loaded && streams.length === 0 && !error && (
            <p className="readout">
              NO STREAMS. UPLOAD A FILE TO MAKE ONE.
              <span className="caret">█</span>
            </p>
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
