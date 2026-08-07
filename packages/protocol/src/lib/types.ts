import type { Compression } from './compress.js';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export const EC_LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];

export const QR_ALNUM_CAPACITY_V40: Record<EcLevel, number> = {
  L: 4296,
  M: 3391,
  Q: 2420,
  H: 1852,
};

/** Names what the *data frames* use; the metadata frame is always classic base45. */
export type Encoding = 'base45' | 'base45w';

export const ENCODINGS: readonly Encoding[] = ['base45', 'base45w'];

export const SUPPORTED_ENCODINGS: readonly Encoding[] = ['base45', 'base45w'];

export type FrameOrder = 'sequential' | 'interleaved';

export const FRAME_ORDERS: readonly FrameOrder[] = ['sequential', 'interleaved'];

export type Coding = 'plain' | 'fountain';

export const CODINGS: readonly Coding[] = ['plain', 'fountain'];

/**
 * Codings this build can decode. Kept separate from `CODINGS` so a stream from
 * a newer build fails with a message instead of silently dropping every frame.
 */
export const SUPPORTED_CODINGS: readonly Coding[] = ['plain', 'fountain'];

export interface StreamConfig {
  /** Pixel width of the output video. Height matches (frames are square). */
  width: number;
  /** Use values that divide 60 and 120, or the player holds alternate frames longer. */
  fps: number;
  payloadBytes: number;
  ec: EcLevel;
  /** Quiet-zone width in QR modules. Below 2 many scanners fail. */
  margin: number;
  metadataRepeatEvery: number;
  frameRepeat: number;
  /** Barcodes per video frame, as an N×N grid. `width / tile` must stay resolvable. */
  tile: number;
  order: FrameOrder;
  coding: Coding;
  /** Fountain only: symbols per source block. Raised to `minimumRedundancy` when too low. */
  redundancy: number;
}

/**
 * Measured share of 40 decode resolutions that read cleanly, rendered at
 * 1080px — the per-frame capture probability a camera at that density gets:
 *
 *   payload   EC L modules/overall   EC M modules/overall   EC Q modules/overall
 *      400            77 / 100%              85 /  93%              97 /  95%
 *      500            85 /  93%              93 /  95%             109 /  78%
 *      600            89 /  90%             101 /  88%             117 /  85%
 *      700            97 /  95%             109 /  78%             125 /  50%
 *      800           101 /  88%             113 /  83%             133 /  60%
 *
 * Compare along the diagonal, not down the columns: at ~95 modules and ~95%
 * capture, EC L carries 700 B where EC M carries 500 B. Re-run with
 * `yarn measure:payload`; do not raise `payloadBytes` without it.
 */
export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  width: 1080,
  fps: 20,
  payloadBytes: 700,
  ec: 'L',
  margin: 2,
  metadataRepeatEvery: 40,
  frameRepeat: 1,
  tile: 2,
  order: 'sequential',
  coding: 'fountain',
  redundancy: 2,
};

export interface EncryptionInfo {
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** Base64. */
  salt: string;
  /** Base64 AES-GCM nonce (12 bytes). */
  iv: string;
}

export interface FileInfo {
  name: string;
  /** Size of the original plaintext in bytes. */
  size: number;
  mime: string;
  /** Hex SHA-256 of the original plaintext. */
  sha256: string;
  /** Absent means `none` — streams predating compression must keep decoding. */
  compression?: Compression;
  /** Byte length after compression, before encryption. Equals `size` when uncompressed. */
  compressedSize?: number;
}

export interface MediaInfo {
  width?: number;
  height?: number;
  durationSec?: number;
  codec?: string;
}

export interface TransportInfo {
  symbology: 'qr';
  encoding: Encoding;
  ec: EcLevel;
  coding: Coding;
  /** Source blocks. Under `plain` also the data-frame count; under `fountain` see `symbols`. */
  frames: number;
  symbols?: number;
  /** Payload bytes per data frame (the last frame may carry fewer). */
  payloadBytes: number;
  fps: number;
  /** Distinct barcodes shown per second — `fps / frameRepeat * tile²`. */
  symbolRate: number;
  /** Total ciphertext length, including the GCM tag when encrypted. */
  cipherSize: number;
}

/** Contents of the metadata frame. Never encrypted — it is what announces a PIN is needed. */
export interface StreamMetadata {
  v: 1;
  id: string;
  file: FileInfo;
  media?: MediaInfo;
  transport: TransportInfo;
  /** `null` means the payload is not encrypted and no PIN is required. */
  encryption: EncryptionInfo | null;
  createdAt: string;
}

export type MediaKind = 'image' | 'audio' | 'video' | 'other';

export function mediaKindOf(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}
