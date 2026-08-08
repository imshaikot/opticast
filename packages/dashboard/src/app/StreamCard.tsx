import type { StreamRecord } from '@opticast/protocol';
import { useState } from 'react';

import { deleteStream, videoUrl } from './api';
import { formatBytes, formatDuration, formatTimestamp } from './format';
import { RetroPlayer } from './RetroPlayer';

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
    <article className={`frame card status-${stream.status}`}>
      <span className="frame-title">STREAM {stream.id.slice(0, 8)}</span>
      <span className="frame-tag">{stream.encrypted ? 'AES-256' : 'NO PIN'}</span>

      <header className="card-head">
        <div>
          <h3 className="card-name">{stream.originalName}</h3>
          <p className="card-meta">
            {formatBytes(stream.originalSize)} · {stream.mime} ·{' '}
            {formatTimestamp(stream.createdAt)}
          </p>
        </div>
        <span className={`badge badge-${stream.status}`}>{stream.status}</span>
      </header>

      {inFlight && (
        <div className="progress">
          <div className="meter">
            <span style={{ width: `${Math.round(stream.progress.ratio * 100)}%` }} />
          </div>
          <small>
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
            <div className="wide">
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
            <RetroPlayer
              src={videoUrl(stream.id)}
              label={`${stream.config.width}px · ${stream.metadata.transport.fps} fps`}
            />
          ) : (
            <button type="button" onClick={() => setShowPlayer(true)}>
              ▶ Play for scanning
            </button>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      <footer className="card-foot">
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
