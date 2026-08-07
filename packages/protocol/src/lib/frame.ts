import {
  base45Decode,
  base45Encode,
  wideBase45CapacityBytes,
  wideBase45Decode,
  wideBase45Encode,
} from './base45.js';
import { QR_ALNUM_CAPACITY_V40, type EcLevel } from './types.js';

/**
 * Wire format. **v1** — the metadata frame and every frame of older streams,
 * RFC 9285 Base45 throughout:
 *
 *   offset  size  field
 *   0       2     magic 'SS'
 *   2       1     protocol version (1)
 *   3       1     kind (0 = metadata, 1 = data, 2 = fountain)
 *   4       4     frame index, uint32 big-endian
 *   8       2     payload length, uint16 big-endian
 *   10      n     payload
 *
 * **v2** — data and fountain frames. A 6-byte header in classic Base45 (9
 * characters, three self-contained triplets) then the payload in wide Base45:
 *
 *   offset  size  field
 *   0       2     magic 'SS'
 *   2       1     version << 4 | kind
 *   3       3     frame index, uint24 big-endian
 *   6+      n     payload (wide Base45, appended as text after the header)
 *
 * The metadata frame stays v1 forever: it is the one always-readable channel,
 * so a scanner older than the video can still explain itself.
 */

// The 'SS' magic predates the opticast rename. It is wire format, not
// branding: every existing stream carries it, so it must not track the name.
export const FRAME_MAGIC_0 = 0x53; // 'S'
export const FRAME_MAGIC_1 = 0x53; // 'S'
export const FRAME_VERSION = 1;
export const FRAME_VERSION_WIDE = 2;
export const FRAME_HEADER_BYTES = 10;
export const WIDE_HEADER_BYTES = 6;
export const WIDE_HEADER_CHARS = 9;
export const WIDE_MAX_INDEX = 0xffffff;

export const FrameKind = {
  Metadata: 0,
  Data: 1,
  Fountain: 2,
} as const;

export type FrameKindValue = (typeof FrameKind)[keyof typeof FrameKind];

export interface DecodedFrame {
  kind: FrameKindValue;
  index: number;
  payload: Uint8Array;
}

/** Metadata frames encode as v1, everything else as v2. */
export function encodeFrame(
  kind: FrameKindValue,
  index: number,
  payload: Uint8Array
): string {
  if (kind !== FrameKind.Metadata) return encodeWideFrame(kind, index, payload);

  if (payload.length > 0xffff) {
    throw new Error(`Frame payload too large: ${payload.length} bytes`);
  }
  const buf = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  buf[0] = FRAME_MAGIC_0;
  buf[1] = FRAME_MAGIC_1;
  buf[2] = FRAME_VERSION;
  buf[3] = kind;
  buf[4] = (index >>> 24) & 0xff;
  buf[5] = (index >>> 16) & 0xff;
  buf[6] = (index >>> 8) & 0xff;
  buf[7] = index & 0xff;
  buf[8] = (payload.length >>> 8) & 0xff;
  buf[9] = payload.length & 0xff;
  buf.set(payload, FRAME_HEADER_BYTES);
  return base45Encode(buf);
}

function encodeWideFrame(
  kind: FrameKindValue,
  index: number,
  payload: Uint8Array
): string {
  if (index > WIDE_MAX_INDEX) {
    throw new Error(`Frame index ${index} exceeds the uint24 a v2 frame carries`);
  }
  const header = new Uint8Array(WIDE_HEADER_BYTES);
  header[0] = FRAME_MAGIC_0;
  header[1] = FRAME_MAGIC_1;
  header[2] = (FRAME_VERSION_WIDE << 4) | kind;
  header[3] = (index >>> 16) & 0xff;
  header[4] = (index >>> 8) & 0xff;
  header[5] = index & 0xff;
  return base45Encode(header) + wideBase45Encode(payload);
}

/**
 * Returns `null` for anything that is not one of our frames — a foreign QR, a
 * truncated read, or a future version. Callers treat that as "ignore this".
 */
export function decodeFrame(text: string): DecodedFrame | null {
  if (text.length < WIDE_HEADER_CHARS) return null;
  const head = base45Decode(text.slice(0, WIDE_HEADER_CHARS));
  if (!head || head[0] !== FRAME_MAGIC_0 || head[1] !== FRAME_MAGIC_1) return null;

  if (head[2] >>> 4 === FRAME_VERSION_WIDE) {
    const kind = head[2] & 0x0f;
    if (kind !== FrameKind.Data && kind !== FrameKind.Fountain) return null;
    const payload = wideBase45Decode(text.slice(WIDE_HEADER_CHARS));
    if (!payload) return null;
    return {
      kind: kind as FrameKindValue,
      index: (head[3] << 16) | (head[4] << 8) | head[5],
      payload,
    };
  }

  if (head[2] !== FRAME_VERSION) return null;

  const bytes = base45Decode(text);
  if (!bytes || bytes.length < FRAME_HEADER_BYTES) return null;

  const kind = bytes[3];
  if (
    kind !== FrameKind.Metadata &&
    kind !== FrameKind.Data &&
    kind !== FrameKind.Fountain
  ) {
    return null;
  }

  const index = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  const length = (bytes[8] << 8) | bytes[9];
  if (FRAME_HEADER_BYTES + length > bytes.length) return null;

  return {
    kind: kind as FrameKindValue,
    index,
    payload: bytes.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length),
  };
}

/** Largest v2 payload that still fits a single QR symbol at this EC level. */
export function maxPayloadBytes(ec: EcLevel): number {
  return wideBase45CapacityBytes(QR_ALNUM_CAPACITY_V40[ec] - WIDE_HEADER_CHARS);
}

export function chunkPayload(data: Uint8Array, payloadBytes: number): Uint8Array[] {
  if (payloadBytes <= 0) throw new Error('payloadBytes must be positive');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += payloadBytes) {
    chunks.push(data.subarray(offset, Math.min(offset + payloadBytes, data.length)));
  }
  return chunks;
}

export function frameCountFor(byteLength: number, payloadBytes: number): number {
  return Math.ceil(byteLength / payloadBytes);
}
