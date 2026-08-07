import {
  mediaKindOf,
  type MediaKind,
  type StreamMetadata,
} from '@opticast/protocol';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { recordCompleted, removeEntry, streamDirectory } from './fileRegistry';

export interface ReceivedFile {
  /** Registry id — the stream's plaintext SHA-256. */
  id: string;
  uri: string;
  name: string;
  mime: string;
  size: number;
  kind: MediaKind;
}

/** Characters that are illegal or awkward in a filename, plus control codes. */
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f:*?"<>|]/g;

/**
 * The name arrives inside a barcode and is entirely attacker-controlled, so
 * only the final path segment is kept and leading dots go with it. Nothing can
 * escape the directory or land as a hidden file. Keep it that way.
 */
export function safeFileName(raw: string): string {
  const lastSegment = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = lastSegment
    .replace(UNSAFE_FILENAME_CHARS, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'received.bin';
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
};

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tiff',
  'tif',
  'dng',
  'avif',
]);
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  '3gp',
  'avi',
]);

/**
 * `saveToLibraryAsync` classifies an asset purely by path extension, whatever
 * its content, so the MIME-derived extension is appended when the declared
 * name disagrees or carries none.
 */
export function ensureExtension(name: string, mime: string): string {
  const kind = mediaKindOf(mime);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';

  if (kind === 'image') {
    if (IMAGE_EXTENSIONS.has(ext)) return name;
    return `${name}.${EXTENSION_BY_MIME[mime] ?? 'jpg'}`;
  }
  if (kind === 'video') {
    if (VIDEO_EXTENSIONS.has(ext)) return name;
    return `${name}.${EXTENSION_BY_MIME[mime] ?? 'mp4'}`;
  }
  if (ext === '' && EXTENSION_BY_MIME[mime])
    return `${name}.${EXTENSION_BY_MIME[mime]}`;
  return name;
}

/** Writes to permanent per-stream storage and records it in the registry. */
export function writeReceivedFile(
  bytes: Uint8Array,
  metadata: StreamMetadata,
): ReceivedFile {
  const id = metadata.file.sha256;
  const name = ensureExtension(
    safeFileName(metadata.file.name),
    metadata.file.mime,
  );
  const file = new File(streamDirectory(id), name);

  if (file.exists) file.delete();
  file.create();
  file.write(bytes);

  const received: ReceivedFile = {
    id,
    uri: file.uri,
    name,
    mime: metadata.file.mime,
    size: bytes.length,
    kind: mediaKindOf(metadata.file.mime),
  };
  recordCompleted(id, received);
  return received;
}

export function discardReceivedFile(received: ReceivedFile): void {
  removeEntry(received.id);
}

export type SaveOutcome =
  | { status: 'saved-to-library' }
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/**
 * Photos and videos go to the media library; everything else through the share
 * sheet, the only way a sandboxed app can hand off an arbitrary file.
 */
export async function saveReceivedFile(
  received: ReceivedFile,
): Promise<SaveOutcome> {
  let libraryFailure: string | null = null;

  if (received.kind === 'image' || received.kind === 'video') {
    try {
      // Write-only: saving needs iOS's "Add Photos Only" grant, and asking for
      // read/write makes an add-only user come back as denied.
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (permission.granted) {
        await MediaLibrary.saveToLibraryAsync(received.uri);
        return { status: 'saved-to-library' };
      }
      // Refused: fall through to sharing rather than dead-ending.
    } catch (error) {
      libraryFailure = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'failed',
        message: libraryFailure ?? 'Sharing is not available on this device',
      };
    }

    await Sharing.shareAsync(received.uri, {
      mimeType: received.mime,
      dialogTitle: `Save ${received.name}`,
    });
    return { status: 'shared' };
  } catch (error) {
    return {
      status: 'failed',
      message:
        libraryFailure ??
        (error instanceof Error ? error.message : String(error)),
    };
  }
}
