import { utf8Encode } from './bytes.js';
import { compressPayload, type Compressors } from './compress.js';
import { encryptWithPin, sha256Hex, DEFAULT_PBKDF2_ITERATIONS } from './crypto.js';
import {
  encodeSymbol,
  planFountain,
  symbolCountFor,
  toBlocks,
} from './fountain.js';
import {
  FrameKind,
  chunkPayload,
  encodeFrame,
  frameCountFor,
  maxPayloadBytes,
} from './frame.js';
import type { MediaInfo, StreamConfig, StreamMetadata } from './types.js';

export interface BuildStreamInput {
  id: string;
  fileName: string;
  mime: string;
  data: Uint8Array;
  /** Omit or pass an empty string to publish the stream unencrypted. */
  pin?: string | null;
  config: StreamConfig;
  media?: MediaInfo;
  /** ISO timestamp; injected so callers stay deterministic in tests. */
  createdAt: string;
  iterations?: number;
  /** Native compressors from the environment. Omitting them costs ratio, not correctness. */
  compressors?: Compressors;
}

export interface BuiltStream {
  metadata: StreamMetadata;
  metadataFrame: string;
  dataFrames: string[];
}

export function validateConfig(config: StreamConfig): void {
  const ceiling = maxPayloadBytes(config.ec);
  if (config.payloadBytes < 1 || config.payloadBytes > ceiling) {
    throw new Error(
      `payloadBytes must be between 1 and ${ceiling} for EC level ${config.ec}`
    );
  }
  if (config.width < 64 || config.width > 4096) {
    throw new Error('width must be between 64 and 4096');
  }
  if (config.fps < 1 || config.fps > 60) {
    throw new Error('fps must be between 1 and 60');
  }
  if (config.frameRepeat < 1 || config.frameRepeat > 30) {
    throw new Error('frameRepeat must be between 1 and 30');
  }
  if (!Number.isInteger(config.tile) || config.tile < 1 || config.tile > 6) {
    throw new Error('tile must be a whole number between 1 and 6');
  }
  if (config.metadataRepeatEvery < 0) {
    throw new Error('metadataRepeatEvery must be 0 or greater');
  }
  if (config.margin < 0 || config.margin > 16) {
    throw new Error('margin must be between 0 and 16');
  }
  if (config.order !== 'sequential' && config.order !== 'interleaved') {
    throw new Error("order must be 'sequential' or 'interleaved'");
  }
  if (config.coding !== 'plain' && config.coding !== 'fountain') {
    throw new Error("coding must be 'plain' or 'fountain'");
  }
  if (!(config.redundancy >= 1) || config.redundancy > 10) {
    throw new Error('redundancy must be between 1 and 10');
  }
}

/**
 * Turns a file into the barcode texts that make up a stream. The whole file is
 * encrypted as one AES-GCM message *before* chunking, so the tag covers the
 * entire payload and the scanner cannot decrypt until every frame is in.
 */
export async function buildStream(input: BuildStreamInput): Promise<BuiltStream> {
  validateConfig(input.config);

  const { config, data } = input;
  // Hashed before anything is done to it, so the far-end check covers the
  // original file rather than whatever this pipeline turned it into.
  const plaintextHash = sha256Hex(data);
  const usePin = typeof input.pin === 'string' && input.pin.length > 0;

  // Compress first: ciphertext is indistinguishable from random and will not
  // compress, so the reverse order would save nothing.
  const compressed = compressPayload(data, input.compressors);

  const { ciphertext, info } = usePin
    ? await encryptWithPin(
        compressed.data,
        input.pin as string,
        input.iterations ?? DEFAULT_PBKDF2_ITERATIONS
      )
    : { ciphertext: compressed.data, info: null };

  const fountain = config.coding === 'fountain';

  // Under `plain` a chunk is a frame. Under `fountain` these are the *inputs*
  // to the code and are never transmitted directly.
  const blockCount = frameCountFor(ciphertext.length, config.payloadBytes);
  const chunks = fountain ? [] : chunkPayload(ciphertext, config.payloadBytes);
  const symbolCount = fountain ? symbolCountFor(blockCount, config.redundancy) : 0;

  const metadata: StreamMetadata = {
    v: 1,
    id: input.id,
    file: {
      name: input.fileName,
      size: data.length,
      mime: input.mime,
      sha256: plaintextHash,
      compression: compressed.method,
      compressedSize: compressed.data.length,
    },
    ...(input.media ? { media: input.media } : {}),
    transport: {
      symbology: 'qr',
      encoding: 'base45w',
      ec: config.ec,
      coding: config.coding,
      frames: blockCount,
      ...(fountain ? { symbols: symbolCount } : {}),
      payloadBytes: config.payloadBytes,
      fps: config.fps,
      symbolRate: (config.fps / config.frameRepeat) * config.tile * config.tile,
      cipherSize: ciphertext.length,
    },
    encryption: info,
    createdAt: input.createdAt,
  };

  const metadataFrame = encodeFrame(
    FrameKind.Metadata,
    0,
    utf8Encode(JSON.stringify(metadata))
  );

  const dataFrames = fountain
    ? buildFountainFrames(ciphertext, blockCount, symbolCount, config.payloadBytes)
    : chunks.map((chunk, index) => encodeFrame(FrameKind.Data, index, chunk));

  return { metadata, metadataFrame, dataFrames };
}

/** ESIs are consecutive: the numbering carries no meaning beyond being the seed. */
function buildFountainFrames(
  ciphertext: Uint8Array,
  blockCount: number,
  symbolCount: number,
  blockBytes: number
): string[] {
  const blocks = toBlocks(ciphertext, blockBytes);
  const plan = planFountain(blockCount);
  const frames: string[] = [];
  for (let esi = 0; esi < symbolCount; esi++) {
    frames.push(encodeFrame(FrameKind.Fountain, esi, encodeSymbol(blocks, esi, plan)));
  }
  return frames;
}

/** mulberry32 — deterministic, so re-encoding a stream reproduces the video. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the metadata text: stable per stream, distinct across streams. */
function seedFromText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Playback order of the data frames when `config.order` is `interleaved`. */
export function interleavedOrder(count: number, seed: number): number[] {
  const order = new Array<number>(count);
  for (let i = 0; i < count; i++) order[i] = i;

  const random = mulberry32(seed);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

/**
 * Expands the barcodes into the exact sequence to pipe at the renderer: data
 * frames in `config.order`, metadata re-broadcast every `metadataRepeatEvery`,
 * padded to whole `tile x tile` grids, then each *grid* held for `frameRepeat`
 * video frames. Repeating individual barcodes instead would drop one symbol
 * into adjacent cells of a frame a camera reads in a single exposure.
 *
 * The metadata cadence is counted in slots, not data indices, so the rendered
 * length is identical under either order and `estimateStream` stays accurate.
 */
export function buildPlaybackSequence(
  metadataFrame: string,
  dataFrames: string[],
  config: StreamConfig
): string[] {
  const order =
    config.order === 'interleaved'
      ? interleavedOrder(dataFrames.length, seedFromText(metadataFrame))
      : null;

  const barcodes: string[] = [metadataFrame];
  for (let i = 0; i < dataFrames.length; i++) {
    if (
      config.metadataRepeatEvery > 0 &&
      i > 0 &&
      i % config.metadataRepeatEvery === 0
    ) {
      barcodes.push(metadataFrame);
    }
    barcodes.push(dataFrames[order ? order[i] : i]);
  }

  // Fill the final grid with metadata rather than blanks: free, and useful to a
  // scanner joining at the very end.
  const perFrame = config.tile * config.tile;
  while (barcodes.length % perFrame !== 0) barcodes.push(metadataFrame);

  if (config.frameRepeat === 1) return barcodes;

  const sequence: string[] = [];
  for (let start = 0; start < barcodes.length; start += perFrame) {
    const grid = barcodes.slice(start, start + perFrame);
    for (let repeat = 0; repeat < config.frameRepeat; repeat++) {
      sequence.push(...grid);
    }
  }
  return sequence;
}

export interface StreamEstimate {
  /** Chunks under `plain`, symbols under `fountain`. */
  dataFrames: number;
  /** Source blocks to recover. Equals `dataFrames` under `plain`. */
  sourceBlocks: number;
  metadataFrames: number;
  /** Barcodes piped at the renderer, after padding and `frameRepeat`. */
  barcodes: number;
  totalVideoFrames: number;
  durationSec: number;
  cipherSize: number;
  bytesPerSecond: number;
  symbolRate: number;
}

/**
 * Up-front estimate for the dashboard preview. Pass `encodedBytes` (the length
 * after compression) when it is known — otherwise a text file previews as a
 * video several times longer than the one that gets rendered.
 */
export function estimateStream(
  byteLength: number,
  config: StreamConfig,
  encrypted: boolean,
  encodedBytes?: number
): StreamEstimate {
  const cipherSize = (encodedBytes ?? byteLength) + (encrypted ? 16 : 0);
  const sourceBlocks = frameCountFor(cipherSize, config.payloadBytes);
  // `symbolCountFor` applies the decodability floor, so this is what will
  // actually be rendered rather than what was asked for.
  const dataFrames =
    config.coding === 'fountain'
      ? symbolCountFor(sourceBlocks, config.redundancy)
      : sourceBlocks;
  const metadataFrames =
    1 +
    (config.metadataRepeatEvery > 0
      ? Math.max(0, Math.ceil(dataFrames / config.metadataRepeatEvery) - 1)
      : 0);
  // Mirrors buildPlaybackSequence: pad to whole grids, then repeat each grid.
  const perFrame = config.tile * config.tile;
  const padded = Math.ceil((dataFrames + metadataFrames) / perFrame) * perFrame;
  const barcodes = padded * config.frameRepeat;
  const totalVideoFrames = barcodes / perFrame;
  const durationSec = totalVideoFrames / config.fps;
  return {
    dataFrames,
    sourceBlocks,
    metadataFrames,
    barcodes,
    totalVideoFrames,
    durationSec,
    cipherSize,
    // Measured against the *original* file, not its compressed stand-in.
    bytesPerSecond: durationSec > 0 ? byteLength / durationSec : 0,
    symbolRate: (config.fps / config.frameRepeat) * config.tile * config.tile,
  };
}
