import { concatBytes, utf8Decode } from './bytes.js';
import {
  SUPPORTED_COMPRESSIONS,
  decompressPayload,
  type Compression,
} from './compress.js';
import { decryptWithPin, sha256Hex } from './crypto.js';
import { FountainDecoder, symbolsNeededFor } from './fountain.js';
import { FrameKind, decodeFrame } from './frame.js';
import {
  SUPPORTED_CODINGS,
  SUPPORTED_ENCODINGS,
  type Coding,
  type Encoding,
  type StreamMetadata,
} from './types.js';

export type IngestResult =
  /** Not one of our barcodes — a foreign QR wandered into view. */
  | { status: 'ignored' }
  /** A barcode we already hold. Expected constantly: video repeats frames. */
  | { status: 'duplicate'; index: number }
  | { status: 'metadata'; metadata: StreamMetadata }
  | { status: 'data'; index: number; received: number; total: number }
  /** Structurally valid but unusable, e.g. a frame from a different stream. */
  | { status: 'rejected'; reason: string };

export interface AssemblerStats {
  scans: number;
  accepted: number;
  duplicates: number;
  ignored: number;
  rejected: number;
}

export interface AssemblerProgress {
  received: number;
  total: number;
  /** 0..1. Zero until the metadata frame arrives and `total` is known. */
  ratio: number;
  bytesReceived: number;
  /**
   * Fountain only. Deliberately not what the progress bar tracks: peeling
   * recovers almost nothing until it avalanches, so a bar driven by this would
   * sit at zero and then snap to done.
   */
  blocksResolved: number;
}

/**
 * Recently-seen raw barcode strings, skipping the Base45 decode for the
 * repeats the camera hands back constantly. Full strings rather than hashes: a
 * 32-bit collision would silently discard a frame never actually received. The
 * authoritative deduplication is the frame-index map below.
 */
const RECENT_WINDOW = 8;

/**
 * Collects barcodes off the camera and rebuilds the original file. Driven
 * purely by the frame index in each header, never by arrival order.
 */
export class StreamAssembler {
  private readonly frames = new Map<number, Uint8Array>();
  private readonly recentRaw: string[] = [];
  private recentCursor = 0;
  private bytesReceived = 0;

  /** Built once the metadata frame names a fountain stream and its block count. */
  private fountain: FountainDecoder | null = null;

  /** Fountain symbols seen before the metadata frame, keyed by ESI. */
  private readonly pendingFountain = new Map<number, Uint8Array>();

  metadata: StreamMetadata | null = null;

  /** Set when a stream is readable but not decodable by this build. */
  unsupported: string | null = null;

  readonly stats: AssemblerStats = {
    scans: 0,
    accepted: 0,
    duplicates: 0,
    ignored: 0,
    rejected: 0,
  };

  /** Exact under `plain`; under `fountain` an estimate, so a target not a criterion. */
  get total(): number {
    const transport = this.metadata?.transport;
    if (!transport) return 0;
    return transport.coding === 'fountain'
      ? symbolsNeededFor(transport.frames)
      : transport.frames;
  }

  get received(): number {
    if (this.fountain) return this.fountain.received;
    if (this.pendingFountain.size > 0) return this.pendingFountain.size;
    return this.frames.size;
  }

  get isComplete(): boolean {
    if (this.metadata === null) return false;
    if (this.fountain) return this.fountain.isComplete;
    return this.frames.size === this.total && this.total > 0;
  }

  get progress(): AssemblerProgress {
    const total = this.total;
    const received = this.received;
    const complete = this.isComplete;
    return {
      received,
      total,
      // Held below 1 until it really is done: a fountain scan can pass the
      // estimate and still need a few more symbols.
      ratio: complete ? 1 : total > 0 ? Math.min(received / total, 0.99) : 0,
      bytesReceived: this.bytesReceived,
      blocksResolved: this.fountain?.resolved ?? this.frames.size,
    };
  }

  /** Feed one raw barcode string straight from the camera. */
  ingest(raw: string): IngestResult {
    this.stats.scans++;

    if (this.isRecent(raw)) {
      this.stats.duplicates++;
      return { status: 'duplicate', index: -1 };
    }
    this.remember(raw);

    const frame = decodeFrame(raw);
    if (!frame) {
      this.stats.ignored++;
      return { status: 'ignored' };
    }

    if (frame.kind === FrameKind.Metadata) {
      return this.ingestMetadata(frame.payload);
    }

    if (frame.kind === FrameKind.Fountain) {
      return this.ingestFountain(frame.index, frame.payload);
    }

    if (this.frames.has(frame.index)) {
      this.stats.duplicates++;
      return { status: 'duplicate', index: frame.index };
    }

    if (this.metadata && frame.index >= this.metadata.transport.frames) {
      this.stats.rejected++;
      return { status: 'rejected', reason: `Frame ${frame.index} is out of range` };
    }

    // `payload` is a view onto the decoded buffer; copy so it stays valid.
    const copy = new Uint8Array(frame.payload.length);
    copy.set(frame.payload);
    this.frames.set(frame.index, copy);
    this.bytesReceived += copy.length;
    this.stats.accepted++;

    return {
      status: 'data',
      index: frame.index,
      received: this.frames.size,
      total: this.total,
    };
  }

  /**
   * Symbols arriving before the metadata frame are buffered and replayed once
   * the block count is known. That is the normal path, not an edge case.
   */
  private ingestFountain(esi: number, payload: Uint8Array): IngestResult {
    const decoder = this.fountain;

    if (!decoder) {
      if (this.pendingFountain.has(esi)) {
        this.stats.duplicates++;
        return { status: 'duplicate', index: esi };
      }
      const copy = new Uint8Array(payload.length);
      copy.set(payload);
      this.pendingFountain.set(esi, copy);
      this.stats.accepted++;
      return {
        status: 'data',
        index: esi,
        received: this.pendingFountain.size,
        total: this.total,
      };
    }

    if (!decoder.add(esi, payload)) {
      this.stats.duplicates++;
      return { status: 'duplicate', index: esi };
    }

    this.stats.accepted++;
    this.recountFountainBytes();
    return { status: 'data', index: esi, received: decoder.received, total: this.total };
  }

  /**
   * Reports recovered bytes, not scanned bytes — a fountain stream carries
   * `redundancy` times as many payload bytes as the file has.
   */
  private recountFountainBytes(): void {
    const transport = this.metadata?.transport;
    if (!transport || !this.fountain) return;
    this.bytesReceived = Math.min(
      this.fountain.resolved * transport.payloadBytes,
      transport.cipherSize
    );
  }

  private ingestMetadata(payload: Uint8Array): IngestResult {
    let parsed: StreamMetadata;
    try {
      parsed = JSON.parse(utf8Decode(payload)) as StreamMetadata;
    } catch {
      this.stats.rejected++;
      return { status: 'rejected', reason: 'Metadata frame was not valid JSON' };
    }

    if (parsed?.v !== 1 || !parsed.transport || !parsed.file) {
      this.stats.rejected++;
      return { status: 'rejected', reason: 'Unsupported metadata format' };
    }

    // Frames self-describe their version, so this does not *route* decoding —
    // it exists so a stream from a future build fails with a sentence.
    const encoding: Encoding = parsed.transport.encoding ?? 'base45';
    if (!SUPPORTED_ENCODINGS.includes(encoding)) {
      this.stats.rejected++;
      this.unsupported = `This stream is ${encoding}-encoded and this app cannot read it. Update the scanner.`;
      return { status: 'rejected', reason: this.unsupported };
    }

    // Absent means a stream from before `coding` existed, which was plain.
    const coding: Coding = parsed.transport.coding ?? 'plain';
    if (!SUPPORTED_CODINGS.includes(coding)) {
      this.stats.rejected++;
      this.unsupported = `This stream is ${coding}-coded and this app cannot decode it. Update the scanner.`;
      return { status: 'rejected', reason: this.unsupported };
    }
    parsed.transport.coding = coding;

    const compression: Compression = parsed.file.compression ?? 'none';
    if (!SUPPORTED_COMPRESSIONS.includes(compression)) {
      this.stats.rejected++;
      this.unsupported = `This stream is ${compression}-compressed and this app cannot decompress it. Update the scanner.`;
      return { status: 'rejected', reason: this.unsupported };
    }
    parsed.file.compression = compression;

    if (this.metadata && this.metadata.id !== parsed.id) {
      // The camera drifted onto a different stream; frames already held belong
      // to the previous file.
      this.reset();
    }

    this.metadata = parsed;
    this.stats.accepted++;

    if (parsed.transport.coding === 'fountain' && !this.fountain) {
      this.fountain = new FountainDecoder(
        parsed.transport.frames,
        parsed.transport.payloadBytes
      );
      for (const [esi, symbol] of this.pendingFountain) {
        this.fountain.add(esi, symbol);
      }
      this.pendingFountain.clear();
      this.recountFountainBytes();
    }

    return { status: 'metadata', metadata: parsed };
  }

  /**
   * Frame indices still outstanding, capped so the UI never renders a huge
   * list. Empty for a fountain stream: no particular symbol is outstanding.
   */
  missingIndices(limit = 50): number[] {
    if (this.fountain || this.metadata?.transport.coding === 'fountain') return [];
    const missing: number[] = [];
    for (let i = 0; i < this.total && missing.length < limit; i++) {
      if (!this.frames.has(i)) missing.push(i);
    }
    return missing;
  }

  /**
   * Reassemble, decrypt and verify. Throws `WrongPinError` on a bad PIN and a
   * plain `Error` when the reassembled bytes fail their SHA-256 check.
   */
  async finalize(pin?: string | null): Promise<Uint8Array> {
    const metadata = this.metadata;
    if (!metadata) throw new Error('Metadata frame has not been scanned yet');
    if (!this.isComplete) {
      throw new Error(
        this.fountain
          ? `Stream is incomplete: ${this.fountain.resolved} of ${this.fountain.total} blocks recovered from ${this.fountain.received} symbols`
          : `Stream is incomplete: ${this.frames.size} of ${this.total} frames`
      );
    }

    let ciphertext: Uint8Array;
    if (this.fountain) {
      ciphertext = this.fountain.assemble(metadata.transport.cipherSize);
    } else {
      const ordered: Uint8Array[] = [];
      for (let i = 0; i < this.total; i++) {
        const chunk = this.frames.get(i);
        if (!chunk) throw new Error(`Missing frame ${i}`);
        ordered.push(chunk);
      }
      ciphertext = concatBytes(...ordered);
    }

    if (ciphertext.length !== metadata.transport.cipherSize) {
      throw new Error(
        `Reassembled ${ciphertext.length} bytes but expected ${metadata.transport.cipherSize}`
      );
    }

    let payload: Uint8Array;
    if (metadata.encryption) {
      if (!pin) throw new Error('This stream is encrypted and needs a PIN');
      payload = await decryptWithPin(ciphertext, pin, metadata.encryption);
    } else {
      payload = ciphertext;
    }

    // Unwinds the encoder exactly: compress -> encrypt -> chunk.
    const plaintext = decompressPayload(
      payload,
      metadata.file.compression ?? 'none',
      metadata.file.size
    );

    if (sha256Hex(plaintext) !== metadata.file.sha256) {
      throw new Error('Checksum mismatch — the reassembled file is corrupt');
    }

    return plaintext;
  }

  reset(): void {
    this.frames.clear();
    this.pendingFountain.clear();
    this.fountain = null;
    this.recentRaw.length = 0;
    this.recentCursor = 0;
    this.bytesReceived = 0;
    this.metadata = null;
    this.unsupported = null;
    this.stats.scans = 0;
    this.stats.accepted = 0;
    this.stats.duplicates = 0;
    this.stats.ignored = 0;
    this.stats.rejected = 0;
  }

  private isRecent(raw: string): boolean {
    for (let i = 0; i < this.recentRaw.length; i++) {
      if (this.recentRaw[i] === raw) return true;
    }
    return false;
  }

  private remember(raw: string): void {
    if (this.recentRaw.length < RECENT_WINDOW) {
      this.recentRaw.push(raw);
      return;
    }
    this.recentRaw[this.recentCursor] = raw;
    this.recentCursor = (this.recentCursor + 1) % RECENT_WINDOW;
  }
}
