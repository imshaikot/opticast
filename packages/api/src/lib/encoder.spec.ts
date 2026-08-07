import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_STREAM_CONFIG,
  StreamAssembler,
  estimateStream,
  type StreamConfig,
  type StreamRecord,
} from '@opticast/protocol';
import jsQR from 'jsqr';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runEncodeJob } from './encoder.js';
import { getFfmpegPath } from './ffmpeg.js';
import { StreamStore } from './store.js';

/**
 * The end-to-end claim: barcodes rendered into an H.264 video read back out of
 * it and rebuild the original file. Decoded at reduced resolution on purpose,
 * as a stand-in for camera distance.
 */

let ffmpegAvailable = false;
let workDir = '';

beforeAll(async () => {
  ffmpegAvailable = (await getFfmpegPath()) !== null;
  workDir = await mkdtemp(path.join(tmpdir(), 'opticast-test-'));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

function deterministicBytes(length: number, seed = 1): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

/**
 * `tile` splits each frame into an N×N grid first, because jsQR finds one
 * symbol per image. Note what `side` then means: a code occupies `side / tile`
 * pixels, so a 2×2 video at 540 puts each symbol at 270px, not 540.
 */
function readBarcodesFromVideo(
  ffmpeg: string,
  videoPath: string,
  side: number,
  tile = 1
): Promise<{ decoded: string[]; frames: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-vf',
        `scale=${side}:${side}:flags=bilinear`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed (${code}): ${stderr}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const frameBytes = side * side * 4;
      const cell = Math.floor(side / tile);
      const decoded: string[] = [];
      let frames = 0;

      for (let offset = 0; offset + frameBytes <= buffer.length; offset += frameBytes) {
        frames++;
        const pixels = new Uint8ClampedArray(
          buffer.buffer,
          buffer.byteOffset + offset,
          frameBytes
        );

        for (let row = 0; row < tile; row++) {
          for (let col = 0; col < tile; col++) {
            if (tile === 1) {
              const result = jsQR(pixels, side, side);
              if (result) decoded.push(result.data);
              continue;
            }
            const crop = new Uint8ClampedArray(cell * cell * 4);
            for (let y = 0; y < cell; y++) {
              const from = ((row * cell + y) * side + col * cell) * 4;
              crop.set(pixels.subarray(from, from + cell * 4), y * cell * 4);
            }
            const result = jsQR(crop, cell, cell);
            if (result) decoded.push(result.data);
          }
        }
      }
      resolve({ decoded, frames });
    });
  });
}

async function encode(
  data: Buffer,
  pin: string | null,
  config: StreamConfig,
  name: string
): Promise<{ store: StreamStore; record: StreamRecord }> {
  const store = new StreamStore(path.join(workDir, name));
  await store.init();

  const now = new Date().toISOString();
  const record: StreamRecord = {
    id: name,
    status: 'queued',
    config,
    encrypted: pin !== null,
    createdAt: now,
    updatedAt: now,
    originalName: `${name}.bin`,
    originalSize: data.length,
    mime: 'application/octet-stream',
    progress: { stage: 'queued', ratio: 0, framesRendered: 0, framesTotal: 0 },
  };
  await store.put(record);
  await runEncodeJob(
    { record, data, pin, config, declaredMime: 'application/octet-stream' },
    store
  );

  const updated = store.get(name);
  if (!updated) throw new Error('record vanished');
  return { store, record: updated };
}

describe('encode -> video -> decode round trip', () => {
  it('rebuilds an encrypted file byte-for-byte from the rendered video', async () => {
    if (!ffmpegAvailable) {
      console.warn('ffmpeg not available — skipping round-trip test');
      return;
    }

    const ffmpeg = (await getFfmpegPath()) as string;
    const original = deterministicBytes(9_000, 7);
    const pin = '482913';

    const { store, record } = await encode(
      original,
      pin,
      { ...DEFAULT_STREAM_CONFIG, metadataRepeatEvery: 10, coding: 'plain', tile: 1 },
      'roundtrip'
    );

    expect(record.status, record.error ?? 'no error').toBe('ready');
    expect(record.metadata).toBeDefined();
    expect(record.metadata?.encryption).not.toBeNull();

    const { decoded, frames } = await readBarcodesFromVideo(
      ffmpeg,
      store.videoPath(record.id),
      540
    );

    const expected = estimateStream(original.length, record.config, true);
    expect(frames).toBe(expected.totalVideoFrames);
    expect(decoded.length).toBe(frames);

    const assembler = new StreamAssembler();
    for (const text of decoded) assembler.ingest(text);

    expect(assembler.metadata?.file.name).toBe('roundtrip.bin');
    expect(assembler.isComplete).toBe(true);

    const rebuilt = await assembler.finalize(pin);
    expect(Buffer.from(rebuilt).equals(original)).toBe(true);
  });

  it('produces a video whose barcodes all decode at the default config', async () => {
    if (!ffmpegAvailable) return;

    const ffmpeg = (await getFfmpegPath()) as string;
    const config = DEFAULT_STREAM_CONFIG;
    const { store, record } = await encode(
      deterministicBytes(4_000, 21),
      null,
      config,
      'plain'
    );

    expect(record.status, record.error ?? 'no error').toBe('ready');

    // Full render width: the default tiles 2x2, so each code is already at
    // half the frame.
    const { decoded, frames } = await readBarcodesFromVideo(
      ffmpeg,
      store.videoPath(record.id),
      config.width,
      config.tile
    );

    // One unreadable cell here means `payloadBytes` or `tile` is too dense.
    expect(decoded.length).toBe(frames * config.tile * config.tile);

    const assembler = new StreamAssembler();
    for (const text of decoded) assembler.ingest(text);
    expect(assembler.isComplete).toBe(true);
    expect(assembler.stats.ignored).toBe(0);
  });

  it('lays four distinct barcodes into every frame when tiling', async () => {
    if (!ffmpegAvailable) return;

    const ffmpeg = (await getFfmpegPath()) as string;
    const config = { ...DEFAULT_STREAM_CONFIG, tile: 2, metadataRepeatEvery: 0 };
    const { store, record } = await encode(
      deterministicBytes(20_000, 22),
      null,
      config,
      'tiled'
    );

    expect(record.status, record.error ?? 'no error').toBe('ready');

    const { decoded, frames } = await readBarcodesFromVideo(
      ffmpeg,
      store.videoPath(record.id),
      config.width,
      2
    );

    // Four *different* barcodes, not one symbol repeated into its neighbours.
    expect(decoded.length).toBe(frames * 4);
    // All but the last: the tail is padded to a whole grid with metadata.
    for (let i = 0; i < decoded.length - 4; i += 4) {
      expect(new Set(decoded.slice(i, i + 4)).size, `frame ${i / 4}`).toBe(4);
    }

    const untiled = estimateStream(20_000, { ...config, tile: 1 }, false);
    expect(frames).toBe(Math.ceil(untiled.totalVideoFrames / 4));

    const assembler = new StreamAssembler();
    for (const text of decoded) assembler.ingest(text);
    expect(assembler.isComplete).toBe(true);
  });

  it('rebuilds a fountain stream after losing a quarter of the frames', async () => {
    if (!ffmpegAvailable) return;

    const ffmpeg = (await getFfmpegPath()) as string;
    const original = deterministicBytes(60_000, 5);
    const pin = '990011';

    const config = { ...DEFAULT_STREAM_CONFIG, coding: 'fountain' as const, redundancy: 1.6 };
    const { store, record } = await encode(original, pin, config, 'fountain');

    expect(record.status, record.error ?? 'no error').toBe('ready');
    expect(record.metadata?.transport.coding).toBe('fountain');

    const { decoded } = await readBarcodesFromVideo(
      ffmpeg,
      store.videoPath(record.id),
      config.width,
      config.tile
    );

    // Drop a deterministic quarter, seeded so a failure is reproducible.
    let state = 20260806;
    const survived = decoded.filter(() => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296 >= 0.25;
    });
    expect(survived.length).toBeLessThan(decoded.length);

    const assembler = new StreamAssembler();
    for (const text of survived) {
      if (assembler.ingest(text) && assembler.isComplete) break;
    }

    expect(
      assembler.isComplete,
      `only ${assembler.progress.blocksResolved} of ${record.metadata?.transport.frames} blocks recovered`
    ).toBe(true);

    const rebuilt = await assembler.finalize(pin);
    expect(Buffer.from(rebuilt).equals(original)).toBe(true);
  });

  it('records a failure on the stream instead of throwing', async () => {
    const { record } = await encode(
      deterministicBytes(100, 3),
      null,
      { ...DEFAULT_STREAM_CONFIG, payloadBytes: 4096 },
      'invalid'
    );

    expect(record.status).toBe('failed');
    expect(record.error).toMatch(/payloadBytes/);
  });
});
