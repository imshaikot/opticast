import {
  mediaKindOf,
  type MediaKind,
  type StreamMetadata,
} from '@opticast/protocol';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Keyed by the stream's plaintext SHA-256 rather than its stream id, so
 * re-encoding the same file updates one entry instead of accumulating them.
 */
export interface RegistryEntry {
  /** Hex SHA-256 of the original file — stable across re-encodes. */
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: MediaKind;
  encrypted: boolean;
  status: 'in-progress' | 'completed';
  /** Last observed scan ratio, 0..1. Always 1 for completed entries. */
  progress: number;
  /** `file://` URI of the stored file. Null until the scan completes. */
  path: string | null;
  updatedAt: string;
}

interface RegistryDocument {
  v: 1;
  entries: RegistryEntry[];
}

export function storageRoot(): Directory {
  const dir = new Directory(Paths.document, 'opticast');
  if (!dir.exists) migrateLegacyRoot(dir);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Installs that predate the opticast rename keep their files under
 * Documents/share-stream. Move the tree once, then patch the stored
 * `file://` URIs, which embed the old directory name.
 */
function migrateLegacyRoot(dir: Directory): void {
  try {
    const legacy = new Directory(Paths.document, 'share-stream');
    if (!legacy.exists) return;
    legacy.move(dir);
    const registry = new File(dir, 'registry.json');
    if (registry.exists)
      registry.write(
        registry.textSync().replaceAll('/share-stream/', '/opticast/'),
      );
  } catch {
    // Best-effort: a failed migration costs old files a re-scan, not the app.
  }
}

/**
 * One directory per stream (first 8 hash chars), so two files sharing a display
 * name cannot clobber each other while the visible filename stays as sent.
 */
export function streamDirectory(id: string): Directory {
  const dir = new Directory(storageRoot(), id.slice(0, 8));
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function registryFile(): File {
  return new File(storageRoot(), 'registry.json');
}

function readDocument(): RegistryDocument {
  try {
    const file = registryFile();
    if (!file.exists) return { v: 1, entries: [] };
    const parsed = JSON.parse(file.textSync()) as RegistryDocument;
    if (parsed.v !== 1 || !Array.isArray(parsed.entries))
      throw new Error('bad shape');
    return parsed;
  } catch {
    // A corrupt registry must never brick the app; the files are still on disk.
    return { v: 1, entries: [] };
  }
}

function writeDocument(doc: RegistryDocument): void {
  try {
    const file = registryFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(doc));
  } catch {
    // Persistence is best-effort.
  }
}

/** In-progress first, then most recently touched. */
export function listRegistry(): RegistryEntry[] {
  return readDocument().entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'in-progress' ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** A completed entry is never downgraded by a rescan of the same file. */
export function trackInProgress(
  metadata: StreamMetadata,
  progress: number,
): void {
  const doc = readDocument();
  const id = metadata.file.sha256;
  const existing = doc.entries.find((entry) => entry.id === id);
  if (existing?.status === 'completed') return;

  const entry: RegistryEntry = {
    id,
    name: metadata.file.name,
    size: metadata.file.size,
    mime: metadata.file.mime,
    kind: mediaKindOf(metadata.file.mime),
    encrypted: metadata.encryption !== null,
    status: 'in-progress',
    progress: Math.min(Math.max(progress, existing?.progress ?? 0), 0.99),
    path: null,
    updatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, entry);
  else doc.entries.push(entry);
  writeDocument(doc);
}

export function recordCompleted(
  id: string,
  details: { name: string; size: number; mime: string; uri: string },
): void {
  const doc = readDocument();
  const entry: RegistryEntry = {
    id,
    name: details.name,
    size: details.size,
    mime: details.mime,
    kind: mediaKindOf(details.mime),
    encrypted: doc.entries.find((e) => e.id === id)?.encrypted ?? false,
    status: 'completed',
    progress: 1,
    path: details.uri,
    updatedAt: new Date().toISOString(),
  };
  const index = doc.entries.findIndex((e) => e.id === id);
  if (index >= 0) doc.entries[index] = entry;
  else doc.entries.push(entry);
  writeDocument(doc);
}

/** Drops the entry and, for completed files, the stored bytes with it. */
export function removeEntry(id: string): void {
  const doc = readDocument();
  const entry = doc.entries.find((e) => e.id === id);
  if (!entry) return;

  if (entry.path) {
    try {
      const dir = new Directory(storageRoot(), id.slice(0, 8));
      if (dir.exists) dir.delete();
    } catch {
      // Drop the entry regardless.
    }
  }

  doc.entries = doc.entries.filter((e) => e.id !== id);
  writeDocument(doc);
}

/** The path inside the documents folder, without the sandbox prefix. */
export function displayPath(uri: string): string {
  const decoded = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  const marker = '/Documents/';
  const at = decoded.indexOf(marker);
  return at >= 0 ? `Documents/${decoded.slice(at + marker.length)}` : decoded;
}
