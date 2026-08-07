import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { StreamRecord } from '@opticast/protocol';

/** Flat-file store: records in one JSON index, videos beside it. */
export class StreamStore {
  private readonly records = new Map<string, StreamRecord>();
  /** Serialises index writes so concurrent jobs cannot interleave them. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  get root(): string {
    return this.dataDir;
  }

  private get indexPath(): string {
    return path.join(this.dataDir, 'streams.json');
  }

  streamDir(id: string): string {
    return path.join(this.dataDir, 'streams', id);
  }

  videoPath(id: string): string {
    return path.join(this.streamDir(id), 'video.mp4');
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.dataDir, 'streams'), { recursive: true });
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as StreamRecord[];
      for (const record of parsed) {
        // A job that was mid-flight when the process died can never resume.
        if (record.status === 'encoding' || record.status === 'queued') {
          record.status = 'failed';
          record.error = 'Server restarted while this stream was encoding';
        }
        this.records.set(record.id, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  list(): StreamRecord[] {
    return [...this.records.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  get(id: string): StreamRecord | undefined {
    return this.records.get(id);
  }

  async put(record: StreamRecord): Promise<StreamRecord> {
    this.records.set(record.id, record);
    await this.persist();
    return record;
  }

  async update(
    id: string,
    patch: Partial<StreamRecord>,
    options: { persist?: boolean } = {}
  ): Promise<StreamRecord | undefined> {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    const next: StreamRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, next);
    // Progress ticks skip the disk write; only state transitions are durable.
    if (options.persist !== false) await this.persist();
    return next;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.records.delete(id)) return false;
    await rm(this.streamDir(id), { recursive: true, force: true });
    await this.persist();
    return true;
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const snapshot = JSON.stringify([...this.records.values()], null, 2);
      const temp = `${this.indexPath}.tmp`;
      // Write-then-rename so a crash mid-write cannot truncate the index.
      await writeFile(temp, snapshot, 'utf8');
      const { rename } = await import('node:fs/promises');
      await rename(temp, this.indexPath);
    });
    return this.writeChain;
  }
}
