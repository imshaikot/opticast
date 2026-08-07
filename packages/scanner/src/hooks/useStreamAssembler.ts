import {
  StreamAssembler,
  type AssemblerStats,
  type StreamMetadata,
} from '@opticast/protocol';
import { useCallback, useRef, useState } from 'react';

/**
 * How often scan progress reaches React state. Re-rendering on every barcode
 * is enough to starve the scanning pipeline, so the assembler lives in a ref
 * and absorbs every scan synchronously.
 */
const UI_THROTTLE_MS = 120;

/**
 * Accepts the capture-rate estimate averages over. A rolling window, not a
 * session average, so the readout answers "is it keeping up *now*".
 */
const RATE_WINDOW = 32;

export interface ScanProgress {
  metadata: StreamMetadata | null;
  received: number;
  total: number;
  ratio: number;
  bytesReceived: number;
  complete: boolean;
  stats: AssemblerStats;
  /** New frames captured per second, averaged over the recent window. */
  captureRate: number;
  /** Fountain only: source blocks recovered so far. */
  blocksResolved: number;
  /** Non-null when waiting longer cannot help. See `StreamAssembler.unsupported`. */
  unsupported: string | null;
}

const EMPTY_PROGRESS: ScanProgress = {
  metadata: null,
  received: 0,
  total: 0,
  ratio: 0,
  bytesReceived: 0,
  complete: false,
  stats: { scans: 0, accepted: 0, duplicates: 0, ignored: 0, rejected: 0 },
  captureRate: 0,
  blocksResolved: 0,
  unsupported: null,
};

export interface UseStreamAssembler {
  progress: ScanProgress;
  /** Feed a raw barcode string. Returns true once the stream is complete. */
  ingest: (raw: string) => boolean;
  /** Reassemble, decrypt and verify. Throws on a bad PIN or checksum. */
  finalize: (pin: string | null) => Promise<Uint8Array>;
  reset: () => void;
}

export function useStreamAssembler(): UseStreamAssembler {
  const assemblerRef = useRef<StreamAssembler>(undefined as never);
  assemblerRef.current ??= new StreamAssembler();

  const [progress, setProgress] = useState<ScanProgress>(EMPTY_PROGRESS);
  const lastPushRef = useRef(0);
  // Written on every accepted barcode, so it lives in a ref like the assembler.
  const acceptTimesRef = useRef<number[]>([]);
  const acceptCursorRef = useRef(0);

  const captureRate = useCallback((): number => {
    const times = acceptTimesRef.current;
    if (times.length < 2) return 0;
    let oldest = Infinity;
    let newest = 0;
    for (const t of times) {
      if (t < oldest) oldest = t;
      if (t > newest) newest = t;
    }
    const span = newest - oldest;
    if (span < 1) return 0;
    return ((times.length - 1) * 1000) / span;
  }, []);

  const pushSnapshot = useCallback(() => {
    const assembler = assemblerRef.current;
    const snapshot = assembler.progress;
    setProgress({
      metadata: assembler.metadata,
      received: snapshot.received,
      total: snapshot.total,
      ratio: snapshot.ratio,
      bytesReceived: snapshot.bytesReceived,
      complete: assembler.isComplete,
      // Copied because `stats` is mutated in place on the hot path.
      stats: { ...assembler.stats },
      captureRate: captureRate(),
      blocksResolved: snapshot.blocksResolved,
      unsupported: assembler.unsupported,
    });
  }, [captureRate]);

  const ingest = useCallback(
    (raw: string): boolean => {
      const assembler = assemblerRef.current;
      const result = assembler.ingest(raw);

      const complete = assembler.isComplete;
      const now = Date.now();
      const throttled = now - lastPushRef.current >= UI_THROTTLE_MS;

      if (result.status === 'duplicate') return false;

      // An ignored barcode is normally a foreign QR. The exception is a known
      // stream that has yielded nothing: there the ignored count is the only
      // evidence that the video and this build disagree on the frame format.
      if (result.status === 'ignored') {
        const stuck = assembler.metadata !== null && assembler.received === 0;
        if (!stuck || !throttled) return false;
      }

      // Only data frames count: metadata re-broadcasts carry no file content.
      if (result.status === 'data') {
        const times = acceptTimesRef.current;
        if (times.length < RATE_WINDOW) {
          times.push(now);
        } else {
          times[acceptCursorRef.current] = now;
          acceptCursorRef.current = (acceptCursorRef.current + 1) % RATE_WINDOW;
        }
      }

      // These change the UI materially, so they bypass the throttle.
      if (
        complete ||
        result.status === 'metadata' ||
        result.status === 'rejected' ||
        throttled
      ) {
        lastPushRef.current = now;
        pushSnapshot();
      }

      return complete;
    },
    [pushSnapshot]
  );

  const finalize = useCallback(
    (pin: string | null) => assemblerRef.current.finalize(pin),
    []
  );

  const reset = useCallback(() => {
    assemblerRef.current.reset();
    lastPushRef.current = 0;
    acceptTimesRef.current = [];
    acceptCursorRef.current = 0;
    setProgress(EMPTY_PROGRESS);
  }, []);

  return { progress, ingest, finalize, reset };
}
