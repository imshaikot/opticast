import {
  DEFAULT_STREAM_CONFIG,
  EC_LEVELS,
  estimateStream,
  minimumRedundancy,
  type CapabilitiesResponse,
  type Coding,
  type EcLevel,
  type FrameOrder,
  type StreamConfig,
} from '@opticast/protocol';
import { compressPayload } from '@opticast/protocol';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { createStream } from './api';
import { formatBytes, formatDuration, formatRate } from './format';

interface Props {
  capabilities: CapabilitiesResponse | null;
  onCreated: () => void;
}

export function CreateStreamForm({ capabilities, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pin, setPin] = useState('');
  const [config, setConfig] = useState<StreamConfig>(DEFAULT_STREAM_CONFIG);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxPayload = capabilities?.maxPayloadBytes[config.ec] ?? 2250;
  const maxUpload = capabilities?.maxUploadBytes ?? 10 * 1024 * 1024;

  /**
   * Compressed size of the chosen file, or null while it is being worked out.
   * Computed once per file rather than inside the estimate, which would
   * re-deflate on every keystroke in the config form.
   */
  const [encodedBytes, setEncodedBytes] = useState<number | null>(null);

  useEffect(() => {
    if (!file) {
      setEncodedBytes(null);
      return;
    }
    let current = true;
    setEncodedBytes(null);
    file
      .arrayBuffer()
      .then((buffer) => {
        if (!current) return;
        // No compressors: the browser has no native zstd, so this is the
        // DEFLATE size — conservative, never optimistic.
        setEncodedBytes(compressPayload(new Uint8Array(buffer)).data.length);
      })
      .catch(() => current && setEncodedBytes(file.size));
    return () => {
      current = false;
    };
  }, [file]);

  // The same function the server uses, so the preview cannot drift.
  const estimate = useMemo(
    () =>
      file
        ? estimateStream(file.size, config, pin.length > 0, encodedBytes ?? undefined)
        : null,
    [file, config, pin, encodedBytes]
  );

  // The encoder silently raises redundancy below the decodability floor.
  const floorRedundancy = estimate ? minimumRedundancy(estimate.sourceBlocks) : 0;
  const redundancyRaised =
    config.coding === 'fountain' && config.redundancy < floorRedundancy;

  // Where the decode-rate measurement in types.ts stops being 100%.
  const codeTooSmall = config.width / config.tile < 480;

  const payloadTooLarge = config.payloadBytes > maxPayload;
  const fileTooLarge = file !== null && file.size > maxUpload;
  const pinInvalid = pin.length > 0 && (pin.length < 4 || pin.length > 32);

  const set = <K extends keyof StreamConfig>(key: K, value: StreamConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await createStream({ file, pin, config });
      setFile(null);
      setPin('');
      // A file input is uncontrolled, so clearing state is not enough.
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const blocked =
    !file || submitting || payloadTooLarge || fileTooLarge || pinInvalid;

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>New stream</h2>

      <label className="field">
        <span>File</span>
        <input
          ref={fileInputRef}
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {file && (
          <small className={fileTooLarge ? 'warn' : 'muted'}>
            {file.name} · {formatBytes(file.size)}
            {fileTooLarge && ` — over the ${formatBytes(maxUpload)} limit`}
          </small>
        )}
      </label>

      <label className="field">
        <span>PIN</span>
        <input
          type="password"
          value={pin}
          placeholder="Leave empty to publish unencrypted"
          onChange={(event) => setPin(event.target.value)}
          autoComplete="off"
        />
        <small className={pinInvalid ? 'warn' : 'muted'}>
          {pinInvalid
            ? 'PIN must be 4-32 characters'
            : pin
              ? 'Frames are AES-256-GCM encrypted; the scanner will prompt for this.'
              : 'No PIN means anyone who scans the video gets the file.'}
        </small>
      </label>

      <div className="grid">
        <label className="field">
          <span>Width (px)</span>
          <input
            type="number"
            min={64}
            max={4096}
            step={2}
            value={config.width}
            onChange={(e) => set('width', Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Frames per second</span>
          <input
            type="number"
            min={1}
            max={60}
            value={config.fps}
            onChange={(e) => set('fps', Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Payload bytes / frame</span>
          <input
            type="number"
            min={1}
            max={maxPayload}
            value={config.payloadBytes}
            onChange={(e) => set('payloadBytes', Number(e.target.value))}
          />
          <small className={payloadTooLarge ? 'warn' : 'muted'}>
            Max {maxPayload} at EC {config.ec}. Higher is faster but harder to scan.
          </small>
        </label>

        <label className="field">
          <span>Error correction</span>
          <select
            value={config.ec}
            onChange={(e) => set('ec', e.target.value as EcLevel)}
          >
            {EC_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
                {level === 'L' ? ' — most data' : ''}
                {level === 'H' ? ' — most robust' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Quiet zone (modules)</span>
          <input
            type="number"
            min={0}
            max={16}
            value={config.margin}
            onChange={(e) => set('margin', Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span>Repeat metadata every</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={config.metadataRepeatEvery}
            onChange={(e) => set('metadataRepeatEvery', Number(e.target.value))}
          />
          <small className="muted">
            0 disables. Lets a scanner join mid-playback.
          </small>
        </label>

        <label className="field">
          <span>Hold each frame for</span>
          <input
            type="number"
            min={1}
            max={30}
            value={config.frameRepeat}
            onChange={(e) => set('frameRepeat', Number(e.target.value))}
          />
          <small className="muted">Video frames. Raise for slow cameras.</small>
        </label>

        <label className="field">
          <span>Barcodes per frame</span>
          <select
            value={config.tile}
            onChange={(e) => set('tile', Number(e.target.value))}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 — single code' : `${n * n} — ${n}×${n} grid`}
              </option>
            ))}
          </select>
          <small className={codeTooSmall ? 'warn' : 'muted'}>
            {Math.floor(config.width / config.tile)}px per code.
            {codeTooSmall
              ? ' Below ~480px codes start failing at any distance.'
              : ' Costs no extra playback time — the frame is mostly empty.'}
          </small>
        </label>

        <label className="field">
          <span>Coding</span>
          <select
            value={config.coding}
            onChange={(e) => set('coding', e.target.value as Coding)}
          >
            <option value="fountain">Fountain — scans in one pass</option>
            <option value="plain">Plain — shortest video</option>
          </select>
          <small className="muted">
            Fountain frames are interchangeable, so a scan stops as soon as it
            has enough of them instead of hunting the last few.
          </small>
        </label>

        {config.coding === 'fountain' && (
          <label className="field">
            <span>Redundancy</span>
            <input
              type="number"
              min={1}
              max={10}
              step={0.1}
              value={config.redundancy}
              onChange={(e) => set('redundancy', Number(e.target.value))}
            />
            <small className={redundancyRaised ? 'warn' : 'muted'}>
              {redundancyRaised
                ? `Raised to ${floorRedundancy.toFixed(2)} — below that this many blocks may never decode.`
                : 'Symbols rendered per source block. Higher survives a worse camera.'}
            </small>
          </label>
        )}

        <label className="field">
          <span>Frame order</span>
          <select
            value={config.order}
            onChange={(e) => set('order', e.target.value as FrameOrder)}
          >
            <option value="sequential">Sequential — file order</option>
            <option value="interleaved">Interleaved — shuffled</option>
          </select>
          <small className="muted">
            Shuffling does not reduce the number of passes a scan needs — it
            only relabels which frames a pass misses. Sequential keeps gaps
            contiguous, so you can seek back to them.
          </small>
        </label>
      </div>

      {estimate && (
        <div className="estimate">
          <div>
            <strong>{estimate.dataFrames.toLocaleString()}</strong>
            <span>
              {config.coding === 'fountain'
                ? `symbols · ${estimate.sourceBlocks.toLocaleString()} blocks`
                : 'data frames'}
            </span>
          </div>
          <div>
            <strong>{estimate.totalVideoFrames.toLocaleString()}</strong>
            <span>video frames</span>
          </div>
          <div>
            <strong>{formatDuration(estimate.durationSec)}</strong>
            <span>playback</span>
          </div>
          <div>
            <strong>{formatRate(estimate.bytesPerSecond)}</strong>
            <span>throughput</span>
          </div>
          <div>
            <strong>{estimate.symbolRate.toFixed(1)}/s</strong>
            <span>frames shown</span>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={blocked}>
        {submitting ? 'Uploading…' : 'Create stream'}
      </button>
    </form>
  );
}
