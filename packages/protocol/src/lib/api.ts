import type { StreamConfig, StreamMetadata } from './types.js';

export type StreamStatus = 'queued' | 'encoding' | 'ready' | 'failed';

export interface StreamJobProgress {
  stage: 'queued' | 'hashing' | 'encrypting' | 'rendering' | 'muxing' | 'done';
  /** 0..1 across the whole job. */
  ratio: number;
  framesRendered: number;
  framesTotal: number;
}

export interface StreamRecord {
  id: string;
  status: StreamStatus;
  config: StreamConfig;
  encrypted: boolean;
  createdAt: string;
  updatedAt: string;
  progress: StreamJobProgress;
  /** Present once the job reaches `ready`. */
  metadata?: StreamMetadata;
  /** Bytes of the produced mp4. */
  videoSize?: number;
  durationSec?: number;
  error?: string;
  originalName: string;
  originalSize: number;
  mime: string;
}

export interface CreateStreamResponse {
  stream: StreamRecord;
}

export interface ListStreamsResponse {
  streams: StreamRecord[];
}

export interface ApiErrorResponse {
  error: string;
  details?: string;
}

export interface CapabilitiesResponse {
  maxUploadBytes: number;
  defaults: StreamConfig;
  /** Max payload bytes per frame, keyed by EC level. */
  maxPayloadBytes: Record<string, number>;
  ffmpegAvailable: boolean;
}
