import type { StreamRecord } from '@opticast/protocol';
import { useState } from 'react';

import { deleteStream, videoUrl } from './api';
import { formatBytes, formatDuration, formatTimestamp } from './format';

interface Props {
  stream: StreamRecord;
  onChanged: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  hashing: 'Reading file',
  encrypting: 'Encrypting',
  rendering: 'Rendering barcodes',
  muxing: 'Building video',
  done: 'Done',
};

export function StreamCard({ stream, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);

  const inFlight = stream.status === 'queued' || stream.status === 'encoding';

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStream(stream.id);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <article className={`card status-${stream.status}`}>
      <header>
        <div>
          <h3>{stream.originalName}</h3>
          <p className="muted">
            {formatBytes(stream.originalSize)} · {stream.mime} ·{' '}
            {formatTimestamp(stream.createdAt)}
          </p>
        </div>
        <span className={`badge badge-${stream.status}`}>
          {stream.encrypted ? '🔒 ' : ''}
          {stream.status}
        </span>
      </header>

      {inFlight && (
        <div className="progress">
          <div className="progress-bar">
            <span style={{ width: `${Math.round(stream.progress.ratio * 100)}%` }} />
          </div>
          <small className="muted">
            {STAGE_LABELS[stream.progress.stage] ?? stream.progress.stage}
            {stream.progress.framesTotal > 0 &&
              ` — frame ${stream.progress.framesRendered.toLocaleString()} of ${stream.progress.framesTotal.toLocaleString()}`}
          </small>
        </div>
      )}

      {stream.status === 'failed' && (
        <p className="error">{stream.error ?? 'Encoding failed'}</p>
      )}

      {stream.status === 'ready' && stream.metadata && (
        <>
          <dl className="stats">
            <div>
              <dt>Data frames</dt>
              <dd>{stream.metadata.transport.frames.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Playback</dt>
              <dd>{formatDuration(stream.durationSec ?? 0)}</dd>
            </div>
            <div>
              <dt>Video size</dt>
              <dd>{formatBytes(stream.videoSize ?? 0)}</dd>
            </div>
            <div>
              <dt>Per frame</dt>
              <dd>{stream.metadata.transport.payloadBytes} B</dd>
            </div>
            <div>
              <dt>QR</dt>
              <dd>
                {stream.config.width}px · EC {stream.metadata.transport.ec} ·{' '}
                {stream.metadata.transport.fps} fps
              </dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd className="mono">{stream.metadata.file.sha256.slice(0, 16)}…</dd>
            </div>
          </dl>

          {showPlayer ? (
            <video
              className="player"
              src={videoUrl(stream.id)}
              controls
              autoPlay
              loop
              playsInline
            />
          ) : (
            <button type="button" onClick={() => setShowPlayer(true)}>
              ▶ Play for scanning
            </button>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      <footer>
        {stream.status === 'ready' && (
          <a className="link" href={videoUrl(stream.id)} download={`${stream.id}.mp4`}>
            Download mp4
          </a>
        )}
        <button
          type="button"
          className="danger"
          disabled={busy || stream.status === 'encoding'}
          onClick={handleDelete}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
