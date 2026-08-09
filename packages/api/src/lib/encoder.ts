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
import { planQr, planScale, renderQrPng, type ScalePlan } from './qr.js';
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

/**
 * The bad-TV look. Every effect is luminance-safe by construction: decoders
 * binarize on luma with a local threshold, so chroma is free to bleed
 * (`chromashift`, chroma-heavy `noise`) and luma may only be *modulated* —
 * thin scanlines, low-amplitude snow, a soft additive hum bar, a gentle
 * vignette — never geometrically displaced or blurred, which is what actually
 * kills a barcode. Amplitudes were chosen against the driver's `sweep`
 * (near/mid/far shares within noise of a clean render; see the constants'
 * limits below) — re-run it before turning any of these up.
 *
 * The chain runs between the upscale and the `pad`, so the border stays pure
 * white: the driver's content-box detection and the bezel look both depend on
 * that. The hum bar starts fully off-screen at t=0 for the same reason — the
 * box is measured on the first frame.
 */
const TV_LOOK = {
  /** Chroma-plane shift in px. Luma untouched, so any value scans; keep it a
   * fringe, not a smear. */
  chromaShiftPx: 6,
  /** 1px dark line per module row (the period is `moduleSize`, so the raster
   * sits on the module grid and cannot beat against it under downscale — a
   * module is a fat CRT pixel). Opacity is the scan-relevant knob: it
   * subtracts straight from the light-module margin. */
  scanlineOpacity: 0.12,
  /** Temporal uniform noise, 0-100. Luma amplitude is what erodes decode
   * margin (measurably, even at 3), so the "snow" lives entirely in chroma,
   * which decoders discard. */
  lumaNoise: 0,
  /** High because yuv420p subsampling and x264's chroma smoothing eat most
   * of it; this is what's left after they do. */
  chromaNoise: 36,
  /** Peak alpha of the additive hum bar — worst-case local contrast loss. */
  humBarAlpha: 0.13,
  /** Chroma-only gain. Makes the snow and the fringing read on screen, and
   * leans on the palette's hue drift. Luma untouched. */
  saturation: 1.25,
  /** Bar height and sweep period as fractions of the screen side / seconds. */
  humBarHeightFrac: 1 / 7,
  humBarPeriodSec: 3.5,
  /** Vignette angle. Corner luma falloff is cos^4 of this — PI/14 costs ~9%
   * at the extreme corners, where the corner finder patterns live. */
  vignetteAngle: 'PI/14',
  /** Brightness flicker amplitude (of full scale) and frequency. */
  flickerAmplitude: 0.015,
  flickerHz: 0.7,
};

function tvLookEnabled(): boolean {
  // Escape hatch for measurement: attribute a decode-rate change to the look
  // itself by re-encoding with OPTICAST_VIDEO_LOOK=clean.
  return process.env.OPTICAST_VIDEO_LOOK !== 'clean';
}

/** The lavfi source for the hum bar: a soft-edged warm-white band, alpha
 * shaped by a raised cosine so the overlay has no hard edge to alias. */
function humBarSource(scalePlan: ScalePlan, fps: number): string {
  const barH = Math.round(scalePlan.scaledSide * TV_LOOK.humBarHeightFrac);
  return [
    `color=c=white:s=${scalePlan.scaledSide}x${barH}:r=${fps}`,
    'format=rgba',
    `geq=r=255:g=244:b=224:a='${TV_LOOK.humBarAlpha}*255*(0.5-0.5*cos(2*PI*Y/${barH}))'`,
  ].join(',');
}

function buildFilterGraph(scalePlan: ScalePlan, fps: number): string[] {
  const upscale = [
    // Runs before any upscale, so the grid stays on the module grid. `color`
    // must be set: the default fills unused cells with black, which a detector
    // reads as a dark blob beside the codes.
    ...(scalePlan.tile > 1
      ? [`tile=${scalePlan.tile}x${scalePlan.tile}:color=white`]
      : []),
    // Integer nearest-neighbour keeps module edges sharp.
    `scale=${scalePlan.scaledSide}:${scalePlan.scaledSide}:flags=neighbor`,
  ];
  const pad = `pad=${scalePlan.outputSide}:${scalePlan.outputSide}:(ow-iw)/2:(oh-ih)/2:white`;

  if (!tvLookEnabled()) {
    return ['-vf', [...upscale, pad].join(',')];
  }

  const barH = Math.round(scalePlan.scaledSide * TV_LOOK.humBarHeightFrac);
  const sweep = scalePlan.scaledSide + barH;
  const barSpeed = (sweep / TV_LOOK.humBarPeriodSec).toFixed(2);

  const screen = [
    ...upscale,
    // Full-resolution chroma while the analog effects run; the output's
    // yuv420p subsampling happens once, at the end.
    'format=yuv444p',
    `chromashift=cbh=${TV_LOOK.chromaShiftPx}:crh=-${TV_LOOK.chromaShiftPx}`,
    `drawgrid=w=iw:h=${Math.max(2, scalePlan.moduleSize)}:t=1:c=black@${TV_LOOK.scanlineOpacity}`,
    // Seeded so re-rendering a stream produces identical frames — and so a
    // sweep A/B measures the effect, not the noise filter's RNG.
    `noise=all_seed=97:c0s=${TV_LOOK.lumaNoise}:c0f=t+u:c1s=${TV_LOOK.chromaNoise}:c1f=t+u:c2s=${TV_LOOK.chromaNoise}:c2f=t+u`,
  ].join(',');

  const composite = [
    // `mod` keeps the bar cycling; `- barH` starts it fully off-screen.
    `overlay=x=0:y='mod(t*${barSpeed},${sweep})-${barH}':shortest=1`,
    'format=yuv444p',
    `vignette=a=${TV_LOOK.vignetteAngle}`,
    `eq=brightness='${TV_LOOK.flickerAmplitude}*sin(2*PI*${TV_LOOK.flickerHz}*t)':saturation=${TV_LOOK.saturation}:eval=frame`,
    pad,
  ].join(',');

  return [
    '-filter_complex',
    `[0:v]${screen}[screen];[screen][1:v]${composite}[out]`,
    '-map', '[out]',
  ];
}

async function renderToVideo(input: RenderInput): Promise<void> {
  const { sequence, scalePlan, fps, outputPath } = input;
  const ffmpeg = await requireFfmpeg();
  const perFrame = scalePlan.tile * scalePlan.tile;

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
      ...(tvLookEnabled()
        ? ['-f', 'lavfi', '-i', humBarSource(scalePlan, fps)]
        : []),
      ...buildFilterGraph(scalePlan, fps),
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
