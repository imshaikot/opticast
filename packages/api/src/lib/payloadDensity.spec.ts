import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_STREAM_CONFIG,
  buildStream,
  type EcLevel,
  type StreamConfig,
  type StreamRecord,
} from '@opticast/protocol';
import jsQR from 'jsqr';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runEncodeJob } from './encoder.js';
import { getFfmpegPath } from './ffmpeg.js';
import { planQr, planScale } from './qr.js';
import { StreamStore } from './store.js';

/**
 * The measurement behind `DEFAULT_STREAM_CONFIG.payloadBytes`. Renders a real
 * video per candidate, then decodes every frame back out at progressively
 * harsher downscales standing in for camera distance.
 *
 * It reports the **fraction of downscales that decode**, not the rate at a few
 * fixed ones. All frames share one QR geometry, so any single (payload, scale)
 * pair is all-or-nothing and a handful of fixed scales measures which ones
 * happened to land on the module grid. The fraction over a band is the
 * per-frame capture probability `p` a camera at that distance gets.
 *
 * Skipped by default. Run with `yarn measure:payload` and paste the table into
 * `protocol/src/lib/types.ts`.
 */

const ENABLED = process.env.MEASURE_PAYLOAD === '1';

const RENDER_WIDTH = 1080;

/**
 * Stepped finely and at a size that is not a neat divisor of the render width,
 * so the sweep does not itself land on a privileged set of scale factors.
 */
const SIDE_STEP = 22;
const MIN_SIDE = 220;
const MAX_SIDE = 1080;

/** Band edges, in decode pixels: [near, mid, far]. */
const BANDS: Array<[string, number, number]> = [
  ['near', 760, 1080],
  ['mid', 480, 760],
  ['far', 220, 480],
];

const PAYLOADS = [400, 500, 600, 700, 800, 1000, 1200];

const FRAMES_PER_CANDIDATE = 6;

let ffmpeg: string | null = null;
let workDir = '';

beforeAll(async () => {
  ffmpeg = await getFfmpegPath();
  workDir = await mkdtemp(path.join(tmpdir(), 'opticast-measure-'));
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

function decodeRate(
  ffmpegPath: string,
  videoPath: string,
  side: number
): Promise<{ decoded: number; frames: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error',
        '-i', videoPath,
        // Bilinear, not neighbour: a sensor integrates, it does not point-sample.
        '-vf', `scale=${side}:${side}:flags=bilinear`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
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
      let decoded = 0;
      let frames = 0;
      for (let offset = 0; offset + frameBytes <= buffer.length; offset += frameBytes) {
        frames++;
        const pixels = new Uint8ClampedArray(
          buffer.buffer,
          buffer.byteOffset + offset,
          frameBytes
        );
        if (jsQR(pixels, side, side)) decoded++;
      }
      resolve({ decoded, frames });
    });
  });
}

async function renderCandidate(
  config: StreamConfig,
  name: string
): Promise<{ store: StreamStore; record: StreamRecord }> {
  const data = deterministicBytes(config.payloadBytes * FRAMES_PER_CANDIDATE, 7);
  const store = new StreamStore(path.join(workDir, name));
  await store.init();

  const now = '2026-01-01T00:00:00.000Z';
  const record: StreamRecord = {
    id: name,
    status: 'queued',
    config,
    encrypted: false,
    createdAt: now,
    updatedAt: now,
    originalName: `${name}.bin`,
    originalSize: data.length,
    mime: 'application/octet-stream',
    progress: { stage: 'queued', ratio: 0, framesRendered: 0, framesTotal: 0 },
  };
  await store.put(record);
  await runEncodeJob(
    { record, data, pin: null, config, declaredMime: 'application/octet-stream' },
    store
  );

  const updated = store.get(name);
  if (!updated) throw new Error('record vanished');
  return { store, record: updated };
}

async function density(config: StreamConfig): Promise<{ version: number; modules: number; pxPerModule: number }> {
  const built = await buildStream({
    id: 'probe',
    fileName: 'probe.bin',
    mime: 'application/octet-stream',
    data: deterministicBytes(config.payloadBytes * 2, 3),
    config,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const plan = planQr(built.metadataFrame, built.dataFrames, config.ec, config.margin);
  const scale = planScale(plan, config.width);
  return { version: plan.version, modules: plan.modulesWithMargin, pxPerModule: scale.moduleSize };
}

interface Measurement {
  payloadBytes: number;
  version: number;
  modules: number;
  /** Fraction of swept scales that decoded every frame, per band and overall. */
  bands: number[];
  overall: number;
  /** Smallest scale that decoded, ignoring isolated failures above it. */
  minSide: number;
}

describe('payloadBytes decode-rate measurement', () => {
  it.runIf(ENABLED)(
    'measures decode probability against camera distance for each payload',
    async () => {
      if (!ffmpeg) {
        console.warn('ffmpeg not available — cannot measure');
        return;
      }

      const ec: EcLevel = (process.env.MEASURE_EC as EcLevel) ?? DEFAULT_STREAM_CONFIG.ec;
      const sides: number[] = [];
      for (let side = MAX_SIDE; side >= MIN_SIDE; side -= SIDE_STEP) sides.push(side);

      const results: Measurement[] = [];

      for (const payloadBytes of PAYLOADS) {
        const config: StreamConfig = {
          ...DEFAULT_STREAM_CONFIG,
          ec,
          payloadBytes,
          width: RENDER_WIDTH,
          // A metadata frame is a different length from the data frames, and
          // tiling and fountain coding are separate axes that would confound
          // a measurement of symbol density.
          metadataRepeatEvery: 0,
          frameRepeat: 1,
          tile: 1,
          coding: 'plain',
        };

        const { version, modules } = await density(config);
        const { store, record } = await renderCandidate(config, `p${payloadBytes}`);
        expect(record.status, record.error ?? 'no error').toBe('ready');

        const ok = new Map<number, boolean>();
        for (const side of sides) {
          const { decoded, frames } = await decodeRate(
            ffmpeg,
            store.videoPath(record.id),
            side
          );
          ok.set(side, frames > 0 && decoded === frames);
        }

        const fractionIn = (lo: number, hi: number) => {
          const inBand = sides.filter((s) => s >= lo && s < hi);
          if (inBand.length === 0) return 0;
          return inBand.filter((s) => ok.get(s)).length / inBand.length;
        };

        const passing = sides.filter((s) => ok.get(s));

        results.push({
          payloadBytes,
          version,
          modules,
          bands: BANDS.map(([, lo, hi]) => fractionIn(lo, hi)),
          overall: passing.length / sides.length,
          minSide: passing.length > 0 ? Math.min(...passing) : 0,
        });
      }

      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const header = [
        'payload',
        'ver',
        'modules',
        ...BANDS.map(([name, lo, hi]) => `${name} ${lo}-${hi}`),
        'overall',
        'min px',
      ];
      const rows = results.map((r) => [
        String(r.payloadBytes),
        String(r.version),
        String(r.modules),
        ...r.bands.map(pct),
        pct(r.overall),
        r.minSide ? String(r.minSide) : 'none',
      ]);

      const widths = header.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => r[i].length))
      );
      const line = (cells: string[]) =>
        cells.map((c, i) => c.padStart(widths[i])).join('  ');

      console.log(
        [
          '',
          `EC ${ec}, rendered ${RENDER_WIDTH}px, ${sides.length} scales swept ${MAX_SIDE}→${MIN_SIDE}px.`,
          'Each cell: share of decode resolutions in that band where every frame read.',
          'Read it as the per-frame capture probability a camera at that distance gets.',
          '',
          line(header),
          rows.map(line).join('\n'),
          '',
        ].join('\n')
      );

      // Every candidate must decode somewhere, or the render itself is broken.
      for (const r of results) {
        expect(r.minSide, `payload ${r.payloadBytes} never decoded at any scale`).toBeGreaterThan(0);
      }

      // Density has to cost something, or this is not measuring it.
      const first = results[0];
      const last = results[results.length - 1];
      expect(
        last.overall,
        `payload ${last.payloadBytes} scored no worse than ${first.payloadBytes}`
      ).toBeLessThan(first.overall);
    },
    1_800_000
  );
});
