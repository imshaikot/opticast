import { deflateSync, inflateSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';

/**
 * Compression runs **before encryption** — AES-GCM output is indistinguishable
 * from random and will not compress. `deflate` is raw (no wrapper: the GCM tag
 * and the metadata SHA-256 already cover integrity). The zstd *compressor* is
 * injected by the caller that has one, since importing `node:zlib` here would
 * break the scanner's Metro bundle; only the pure-JS decoder lives here.
 */
export type Compression = 'none' | 'deflate' | 'zstd';

export const COMPRESSIONS: readonly Compression[] = ['none', 'deflate', 'zstd'];

/** Kept separate from `COMPRESSIONS` so an unknown codec fails loudly. */
export const SUPPORTED_COMPRESSIONS: readonly Compression[] = [
  'none',
  'deflate',
  'zstd',
];

export interface Compressors {
  zstd?: (data: Uint8Array) => Uint8Array;
}

export interface CompressionResult {
  data: Uint8Array;
  method: Compression;
}

/** Below this saving the result costs a scanner an inflate pass for no frames. */
const MIN_SAVING = 0.02;

/**
 * Compresses when that helps, and says which codec did. DEFLATE on already
 * compressed input returns *more* bytes than it was given, so the result is
 * kept only when it actually wins.
 */
export function compressPayload(
  data: Uint8Array,
  compressors?: Compressors
): CompressionResult {
  if (data.length < 256) return { data, method: 'none' };

  let best: CompressionResult = { data, method: 'none' };
  const consider = (candidate: Uint8Array, method: Compression) => {
    if (candidate.length < best.data.length) best = { data: candidate, method };
  };

  // Each codec is an optimisation; one failing must never fail the upload.
  try {
    consider(deflateSync(data, { level: 9 }), 'deflate');
  } catch {
    // fall through to whatever else is on offer
  }
  if (compressors?.zstd) {
    try {
      consider(compressors.zstd(data), 'zstd');
    } catch {
      // ditto
    }
  }

  if (best.data.length > data.length * (1 - MIN_SAVING)) {
    return { data, method: 'none' };
  }
  return best;
}

/** `expectedLength` comes from the metadata, so the buffer is allocated once. */
export function decompressPayload(
  data: Uint8Array,
  method: Compression,
  expectedLength: number
): Uint8Array {
  if (method === 'none') return data;
  if (method === 'deflate') {
    return inflateSync(data, { out: new Uint8Array(expectedLength) });
  }
  if (method === 'zstd') {
    return zstdDecompress(data, new Uint8Array(expectedLength));
  }
  throw new Error(`Unsupported compression: ${method}`);
}
