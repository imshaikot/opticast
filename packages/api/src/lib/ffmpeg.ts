import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { MediaInfo } from '@opticast/protocol';

const execFileAsync = promisify(execFile);

/**
 * Resolution order: `FFMPEG_PATH`/`FFPROBE_PATH`, then `ffmpeg-static`, then
 * `PATH`. `ffmpeg-static` ships no ffprobe, hence the graceful probe fallback.
 */

let ffmpegPathPromise: Promise<string | null> | null = null;
let ffprobePathPromise: Promise<string | null> | null = null;

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function onPath(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [binary]);
    const resolved = stdout.trim();
    return resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

async function resolveFfmpegPath(): Promise<string | null> {
  const override = process.env.FFMPEG_PATH;
  if (override && (await isExecutable(override))) return override;

  try {
    const mod = (await import('ffmpeg-static')) as unknown as {
      default?: string | null;
    };
    const staticPath = mod.default;
    if (staticPath && (await isExecutable(staticPath))) return staticPath;
  } catch {
    // ffmpeg-static is optional; fall through to PATH.
  }

  return onPath('ffmpeg');
}

async function resolveFfprobePath(): Promise<string | null> {
  const override = process.env.FFPROBE_PATH;
  if (override && (await isExecutable(override))) return override;
  return onPath('ffprobe');
}

export function getFfmpegPath(): Promise<string | null> {
  ffmpegPathPromise ??= resolveFfmpegPath();
  return ffmpegPathPromise;
}

export function getFfprobePath(): Promise<string | null> {
  ffprobePathPromise ??= resolveFfprobePath();
  return ffprobePathPromise;
}

export async function requireFfmpeg(): Promise<string> {
  const path = await getFfmpegPath();
  if (!path) {
    throw new Error(
      'ffmpeg was not found. Install it, or set FFMPEG_PATH to point at a binary.'
    );
  }
  return path;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

/**
 * Best-effort. Returns `undefined` for non-media files and for any failure —
 * this only enriches the metadata and must never fail an encode.
 */
export async function probeMedia(filePath: string): Promise<MediaInfo | undefined> {
  const ffprobe = await getFfprobePath();
  if (!ffprobe) return undefined;

  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const streams = parsed.streams ?? [];
    const primary =
      streams.find((s) => s.codec_type === 'video') ??
      streams.find((s) => s.codec_type === 'audio');
    if (!primary) return undefined;

    const durationRaw = parsed.format?.duration ?? primary.duration;
    const duration = durationRaw ? Number.parseFloat(durationRaw) : Number.NaN;

    const info: MediaInfo = {};
    if (primary.width) info.width = primary.width;
    if (primary.height) info.height = primary.height;
    if (Number.isFinite(duration)) info.durationSec = Number(duration.toFixed(3));
    if (primary.codec_name) info.codec = primary.codec_name;

    return Object.keys(info).length > 0 ? info : undefined;
  } catch {
    return undefined;
  }
}
