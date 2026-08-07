import path from 'node:path';

import {
  CODINGS,
  DEFAULT_STREAM_CONFIG,
  EC_LEVELS,
  FRAME_ORDERS,
  maxPayloadBytes,
  type Coding,
  type EcLevel,
  type FrameOrder,
  type StreamConfig,
} from '@opticast/protocol';

export const HOST = process.env.HOST ?? 'localhost';
export const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), '.data');

/** Low on purpose: a barcode video trades size for playback time. */
export const MAX_UPLOAD_BYTES = process.env.MAX_UPLOAD_BYTES
  ? Number(process.env.MAX_UPLOAD_BYTES)
  : 10 * 1024 * 1024;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function readNumber(
  raw: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be a whole number`);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

/** As `readNumber`, but fractional. */
function readFloat(
  raw: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (value < min || value > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

/** Multipart form fields arrive as strings; this validates and coerces them. */
export function parseStreamConfig(body: Record<string, unknown>): StreamConfig {
  const ecRaw = (body['ec'] as string | undefined) ?? DEFAULT_STREAM_CONFIG.ec;
  if (!EC_LEVELS.includes(ecRaw as EcLevel)) {
    throw new ValidationError(`ec must be one of ${EC_LEVELS.join(', ')}`);
  }
  const ec = ecRaw as EcLevel;

  const orderRaw = (body['order'] as string | undefined) ?? DEFAULT_STREAM_CONFIG.order;
  if (!FRAME_ORDERS.includes(orderRaw as FrameOrder)) {
    throw new ValidationError(`order must be one of ${FRAME_ORDERS.join(', ')}`);
  }

  const codingRaw =
    (body['coding'] as string | undefined) ?? DEFAULT_STREAM_CONFIG.coding;
  if (!CODINGS.includes(codingRaw as Coding)) {
    throw new ValidationError(`coding must be one of ${CODINGS.join(', ')}`);
  }

  const config: StreamConfig = {
    ec,
    order: orderRaw as FrameOrder,
    coding: codingRaw as Coding,
    redundancy: readFloat(
      body['redundancy'],
      'redundancy',
      DEFAULT_STREAM_CONFIG.redundancy,
      1,
      10
    ),
    width: readNumber(body['width'], 'width', DEFAULT_STREAM_CONFIG.width, 64, 4096),
    fps: readNumber(body['fps'], 'fps', DEFAULT_STREAM_CONFIG.fps, 1, 60),
    payloadBytes: readNumber(
      body['payloadBytes'],
      'payloadBytes',
      DEFAULT_STREAM_CONFIG.payloadBytes,
      1,
      maxPayloadBytes(ec)
    ),
    margin: readNumber(body['margin'], 'margin', DEFAULT_STREAM_CONFIG.margin, 0, 16),
    metadataRepeatEvery: readNumber(
      body['metadataRepeatEvery'],
      'metadataRepeatEvery',
      DEFAULT_STREAM_CONFIG.metadataRepeatEvery,
      0,
      10_000
    ),
    frameRepeat: readNumber(
      body['frameRepeat'],
      'frameRepeat',
      DEFAULT_STREAM_CONFIG.frameRepeat,
      1,
      30
    ),
    tile: readNumber(body['tile'], 'tile', DEFAULT_STREAM_CONFIG.tile, 1, 6),
  };

  return config;
}

export function parsePin(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const pin = String(raw);
  if (pin.length < 4 || pin.length > 32) {
    throw new ValidationError('PIN must be between 4 and 32 characters');
  }
  return pin;
}
