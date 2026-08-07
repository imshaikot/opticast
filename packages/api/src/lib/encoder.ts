import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { constants as zlibConstants, zstdCompressSync } from 'node:zlib';

import {
  buildPlaybackSequence,
  buildStream,
  type StreamConfig,
  type StreamRecord,
} from '@opticast/protocol';

import { probeMedia, requireFfmpeg } from './ffmpeg.js';
import { barcodeColors } from './palette.js';
import { planQr, planScale, renderQrPng } from './qr.js';
import type { StreamStore } from './store.js';

const PROGRESS_EVERY_FRAMES = 25;

export interface EncodeJobInput {
  record: StreamRecord;
  data: Buffer;
  pin: string | null;
  config: StreamConfig;
  /** MIME reported by the client, used as a fallback when sniffing fails. */
  declaredMime: string;
}

async function detectMime(data: Buffer, declared: string): Promise<string> {
  try {
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(data);
    if (detected?.mime) return detected.mime;
  } catch {
    // Sniffing is an optimisation; the declared type is still usable.
  }
  return declared && declared !== 'application/octet-stream'
    ? declared
    : 'application/octet-stream';
}

/**
 * Sniff MIME -> probe media -> encrypt and chunk into barcode texts -> render
 * each as a tiny PNG -> pipe those into ffmpeg. PNGs are streamed into stdin,
 * so a 20k-frame stream never materialises 20k files.
 */
export async function runEncodeJob(
  input: EncodeJobInput,
  store: StreamStore
): Promise<void> {
  const { record, data, pin, config } = input;
  const id = record.id;
  const dir = store.streamDir(id);
  await mkdir(dir, { recursive: true });

  const sourcePath = path.join(dir, 'source.tmp');

  try {
    await store.update(id, {
      status: 'encoding',
      progress: { stage: 'hashing', ratio: 0, framesRendered: 0, framesTotal: 0 },
    });

    const mime = await detectMime(data, input.declaredMime);

    // ffprobe needs a real path, so the upload lands on disk briefly.
    await writeFile(sourcePath, data);
    const media = await probeMedia(sourcePath);

    await store.update(id, {
      mime,
      progress: { stage: 'encrypting', ratio: 0.02, framesRendered: 0, framesTotal: 0 },
    });

    const built = await buildStream({
      id,
      fileName: record.originalName,
      mime,
      data: new Uint8Array(data),
      pin,
      config,
      media,
      createdAt: record.createdAt,
      // Level 19: this runs once on a server and every saved byte is paid back
      // across thousands of barcodes.
      compressors: {
        zstd: (bytes) =>
          new Uint8Array(
            zstdCompressSync(bytes, {
              params: { [zlibConstants.ZSTD_c_compressionLevel]: 19 },
            })
          ),
      },
    });

    const sequence = buildPlaybackSequence(
      built.metadataFrame,
      built.dataFrames,
      config
    );

    const qrPlan = planQr(built.metadataFrame, built.dataFrames, config.ec, config.margin);
    const scalePlan = planScale(qrPlan, config.width, config.tile);

    await store.update(id, {
      metadata: built.metadata,
      progress: {
        stage: 'rendering',
        ratio: 0.05,
        framesRendered: 0,
        framesTotal: sequence.length,
      },
    });

    await renderToVideo({
      sequence,
      qrPlan,
      scalePlan,
      fps: config.fps,
      frameRepeat: config.frameRepeat,
      outputPath: store.videoPath(id),
      onProgress: (framesRendered) => {
        // Not awaited: progress must never throttle the render loop.
        void store.update(
          id,
          {
            progress: {
              stage: 'rendering',
              ratio: 0.05 + 0.9 * (framesRendered / sequence.length),
              framesRendered,
              framesTotal: sequence.length,
            },
          },
          { persist: false }
        );
      },
    });

    const videoStat = await stat(store.videoPath(id));

    await store.update(id, {
      status: 'ready',
      videoSize: videoStat.size,
      // `sequence` counts barcodes; a tiled frame holds several of them.
      durationSec: sequence.length / (config.tile * config.tile) / config.fps,
      progress: {
        stage: 'done',
        ratio: 1,
        framesRendered: sequence.length,
        framesTotal: sequence.length,
      },
    });
  } catch (error) {
    await store.update(id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await rm(sourcePath, { force: true });
  }
}

interface RenderInput {
  sequence: string[];
  qrPlan: ReturnType<typeof planQr>;
  scalePlan: ReturnType<typeof planScale>;
  fps: number;
  frameRepeat: number;
  outputPath: string;
  onProgress: (framesRendered: number) => void;
}

async function renderToVideo(input: RenderInput): Promise<void> {
  const { sequence, scalePlan, fps, outputPath } = input;
  const ffmpeg = await requireFfmpeg();
  const perFrame = scalePlan.tile * scalePlan.tile;

  const filter = [
    // Runs before any upscale, so the grid stays on the module grid. `color`
    // must be set: the default fills unused cells with black, which a detector
    // reads as a dark blob beside the codes.
    ...(scalePlan.tile > 1
      ? [`tile=${scalePlan.tile}x${scalePlan.tile}:color=white`]
      : []),
    // Integer nearest-neighbour keeps module edges sharp.
    `scale=${scalePlan.scaledSide}:${scalePlan.scaledSide}:flags=neighbor`,
    `pad=${scalePlan.outputSide}:${scalePlan.outputSide}:(ow-iw)/2:(oh-ih)/2:white`,
  ].join(',');

  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'image2pipe',
      // `tile` consumes `perFrame` inputs per output frame, so the input must
      // arrive that much faster to land on the requested fps.
      '-framerate', String(fps * perFrame),
      '-i', 'pipe:0',
      '-vf', filter,
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      // Biases the encoder toward preserving sharp edges.
      '-tune', 'stillimage',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 8192) stderr = stderr.slice(-8192);
  });

  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });

  // If ffmpeg exits early the pipe breaks; surface its stderr, not EPIPE.
  child.stdin.on('error', () => undefined);

  try {
    // The palette drifts per barcode, so only consecutive repeats are ever
    // byte-identical — which is exactly what a `frameRepeat` run is.
    let cachedKey: string | null = null;
    let cachedPng: Buffer | null = null;

    for (let i = 0; i < sequence.length; i++) {
      const text = sequence[i];
      const colors = barcodeColors(i - (i % input.frameRepeat));
      const key = `${colors.dark}:${text}`;

      let png: Buffer;
      if (key === cachedKey && cachedPng) {
        png = cachedPng;
      } else {
        png = await renderQrPng(text, input.qrPlan, colors);
        cachedKey = key;
        cachedPng = png;
      }

      if (!child.stdin.write(png)) {
        await once(child.stdin, 'drain');
      }
      if (child.exitCode !== null) break;

      if ((i + 1) % PROGRESS_EVERY_FRAMES === 0) input.onProgress(i + 1);
    }

    child.stdin.end();
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  const code = await exited;
  if (code !== 0) {
    throw new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || 'no output'}`);
  }
}
