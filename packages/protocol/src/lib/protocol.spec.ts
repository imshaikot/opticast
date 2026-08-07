import { describe, expect, it } from 'vitest';

import {
  BASE45_ALPHABET,
  DEFAULT_STREAM_CONFIG,
  EC_LEVELS,
  FrameKind,
  StreamAssembler,
  WrongPinError,
  base45Decode,
  base45Encode,
  base45EncodedLength,
  buildPlaybackSequence,
  buildStream,
  decodeFrame,
  encodeFrame,
  estimateStream,
  fromBase64,
  interleavedOrder,
  maxPayloadBytes,
  sha256Hex,
  toBase64,
  utf8Encode,
  wideBase45CapacityBytes,
  wideBase45Decode,
  wideBase45Encode,
  wideBase45EncodedLength,
  WIDE_MAX_INDEX,
  type StreamConfig,
} from '../index.js';

function pseudoRandomBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

/** Plain coding and one barcode per frame, so counting barcodes counts frames. */
const TEST_CONFIG: StreamConfig = {
  ...DEFAULT_STREAM_CONFIG,
  payloadBytes: 64,
  metadataRepeatEvery: 5,
  coding: 'plain',
  tile: 1,
};

// PBKDF2 is intentionally slow in production; tests use a token count.
const TEST_ITERATIONS = 100;

describe('base45', () => {
  it('round-trips byte arrays of both parities', () => {
    for (const length of [0, 1, 2, 3, 15, 16, 255, 1000, 1001]) {
      const input = pseudoRandomBytes(length, length + 7);
      const decoded = base45Decode(base45Encode(input));
      expect(decoded, `length ${length}`).not.toBeNull();
      expect(Array.from(decoded as Uint8Array), `length ${length}`).toEqual(
        Array.from(input)
      );
    }
  });

  it('emits only characters from the QR alphanumeric charset', () => {
    const encoded = base45Encode(pseudoRandomBytes(2048, 42));
    for (const char of encoded) {
      expect(BASE45_ALPHABET.includes(char), `char ${char}`).toBe(true);
    }
  });

  it('covers every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(Array.from(base45Decode(base45Encode(all)) as Uint8Array)).toEqual(
      Array.from(all)
    );
  });

  it('predicts its own encoded length', () => {
    for (const length of [0, 1, 2, 3, 100, 101]) {
      expect(base45Encode(pseudoRandomBytes(length)).length).toBe(
        base45EncodedLength(length)
      );
    }
  });

  it('rejects malformed input instead of throwing', () => {
    expect(base45Decode('A')).toBeNull(); // length % 3 === 1
    expect(base45Decode('!!!')).toBeNull(); // outside the alphabet
    expect(base45Decode(':::')).toBeNull(); // decodes above 0xffff
  });
});

describe('wide base45', () => {
  it('round-trips every group and remainder size', () => {
    // 0..40 crosses three full 13-byte groups and every remainder length.
    for (let length = 0; length <= 40; length++) {
      const input = pseudoRandomBytes(length, length + 11);
      const decoded = wideBase45Decode(wideBase45Encode(input));
      expect(decoded, `length ${length}`).not.toBeNull();
      expect(Array.from(decoded as Uint8Array), `length ${length}`).toEqual(
        Array.from(input)
      );
    }
  });

  it('emits only characters from the QR alphanumeric charset', () => {
    const encoded = wideBase45Encode(pseudoRandomBytes(2048, 43));
    for (const char of encoded) {
      expect(BASE45_ALPHABET.includes(char), `char ${char}`).toBe(true);
    }
  });

  it('predicts its own encoded length, and capacity inverts it', () => {
    for (const length of [0, 1, 12, 13, 14, 25, 26, 700, 701]) {
      const chars = wideBase45Encode(pseudoRandomBytes(length)).length;
      expect(chars).toBe(wideBase45EncodedLength(length));
      expect(wideBase45CapacityBytes(chars)).toBeGreaterThanOrEqual(length);
    }
  });

  it('beats classic base45 by the ~2.6% the grouping promises', () => {
    const bytes = 13 * 100;
    expect(wideBase45EncodedLength(bytes)).toBe(1900);
    expect(base45EncodedLength(bytes)).toBe(1950);
  });

  it('rejects malformed input instead of throwing', () => {
    // Character counts no byte length produces: 1, 4, 7, 10, 13, 16 mod 19.
    expect(wideBase45Decode('0')).toBeNull();
    expect(wideBase45Decode('0000')).toBeNull();
    // Overflowing groups: not canonical.
    expect(wideBase45Decode(':'.repeat(19))).toBeNull();
    expect(wideBase45Decode('::')).toBeNull();
    expect(wideBase45Decode('!'.repeat(19))).toBeNull();
  });
});

describe('base64 helpers', () => {
  it('round-trips and matches Node for known values', () => {
    for (const length of [0, 1, 2, 3, 17, 256]) {
      const input = pseudoRandomBytes(length, length + 3);
      expect(Array.from(fromBase64(toBase64(input)))).toEqual(Array.from(input));
      expect(toBase64(input)).toBe(Buffer.from(input).toString('base64'));
    }
  });
});

describe('frames', () => {
  it('round-trips a data frame', () => {
    const payload = pseudoRandomBytes(800, 9);
    const decoded = decodeFrame(encodeFrame(FrameKind.Data, 12345, payload));
    expect(decoded).not.toBeNull();
    expect(decoded?.kind).toBe(FrameKind.Data);
    expect(decoded?.index).toBe(12345);
    expect(Array.from(decoded?.payload as Uint8Array)).toEqual(Array.from(payload));
  });

  it('survives the largest index a v2 frame can carry, and refuses beyond', () => {
    const decoded = decodeFrame(
      encodeFrame(FrameKind.Data, WIDE_MAX_INDEX, new Uint8Array([1]))
    );
    expect(decoded?.index).toBe(WIDE_MAX_INDEX);
    // Must be an encode-time error, never silent truncation.
    expect(() => encodeFrame(FrameKind.Data, WIDE_MAX_INDEX + 1, new Uint8Array([1]))).toThrow(
      /uint24/
    );
  });

  it('encodes data frames as v2 and metadata as v1', () => {
    const payload = pseudoRandomBytes(700, 21);
    const v2 = encodeFrame(FrameKind.Data, 5, payload);
    const v1Chars = base45EncodedLength(10 + payload.length);
    expect(v2.length).toBe(9 + wideBase45EncodedLength(payload.length));
    expect(v2.length).toBeLessThan(v1Chars * 0.98);

    // Metadata stays classic so a scanner older than the video can read it.
    const meta = encodeFrame(FrameKind.Metadata, 0, payload);
    expect(meta.length).toBe(base45EncodedLength(10 + payload.length));
    expect(base45Decode(meta)).not.toBeNull();
  });

  it('ignores foreign barcodes rather than throwing', () => {
    expect(decodeFrame('HTTPS://EXAMPLE.COM')).toBeNull();
    expect(decodeFrame('')).toBeNull();
    expect(decodeFrame(base45Encode(new Uint8Array([1, 2, 3])))).toBeNull();
    // Right length, wrong magic.
    expect(decodeFrame(base45Encode(new Uint8Array(12)))).toBeNull();
  });

  it('reports a payload ceiling that actually fits a version-40 symbol', () => {
    for (const ec of EC_LEVELS) {
      const max = maxPayloadBytes(ec);
      const encoded = encodeFrame(FrameKind.Data, 0, pseudoRandomBytes(max, 5));
      const capacity = { L: 4296, M: 3391, Q: 2420, H: 1852 }[ec];
      expect(encoded.length, `EC ${ec}`).toBeLessThanOrEqual(capacity);
    }
  });
});

describe('buildStream + StreamAssembler', () => {
  const baseInput = {
    id: 'test-stream',
    fileName: 'hello.bin',
    mime: 'application/octet-stream',
    createdAt: '2026-01-01T00:00:00.000Z',
    iterations: TEST_ITERATIONS,
  };

  it('round-trips an encrypted file', async () => {
    const data = pseudoRandomBytes(5000, 11);
    const built = await buildStream({
      ...baseInput,
      data,
      pin: '4821',
      config: TEST_CONFIG,
    });

    expect(built.metadata.encryption).not.toBeNull();
    expect(built.metadata.file.sha256).toBe(sha256Hex(data));
    // GCM appends a 16-byte tag.
    expect(built.metadata.transport.cipherSize).toBe(data.length + 16);

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    expect(assembler.metadata?.id).toBe('test-stream');

    for (const frame of built.dataFrames) assembler.ingest(frame);
    expect(assembler.isComplete).toBe(true);

    const result = await assembler.finalize('4821');
    expect(Array.from(result)).toEqual(Array.from(data));
  });

  it('round-trips an unencrypted file and needs no PIN', async () => {
    const data = pseudoRandomBytes(300, 12);
    const built = await buildStream({ ...baseInput, data, config: TEST_CONFIG });

    expect(built.metadata.encryption).toBeNull();
    expect(built.metadata.transport.cipherSize).toBe(data.length);

    const assembler = new StreamAssembler();
    for (const frame of [built.metadataFrame, ...built.dataFrames]) {
      assembler.ingest(frame);
    }
    expect(Array.from(await assembler.finalize())).toEqual(Array.from(data));
  });

  it('rejects the wrong PIN with WrongPinError', async () => {
    const data = pseudoRandomBytes(200, 13);
    const built = await buildStream({
      ...baseInput,
      data,
      pin: '1234',
      config: TEST_CONFIG,
    });

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames) assembler.ingest(frame);

    await expect(assembler.finalize('9999')).rejects.toBeInstanceOf(WrongPinError);
  });

  it('handles frames arriving out of order, duplicated, and before the metadata', async () => {
    const data = pseudoRandomBytes(1000, 14);
    const built = await buildStream({
      ...baseInput,
      data,
      pin: '0000',
      config: TEST_CONFIG,
    });

    const assembler = new StreamAssembler();

    // Data frames land first — the scanner joined mid-playback.
    const shuffled = [...built.dataFrames].reverse();
    for (const frame of shuffled) assembler.ingest(frame);
    expect(assembler.metadata).toBeNull();
    expect(assembler.received).toBe(built.dataFrames.length);

    for (const frame of built.dataFrames) assembler.ingest(frame);
    assembler.ingest(built.metadataFrame);

    expect(assembler.isComplete).toBe(true);
    expect(assembler.stats.duplicates).toBeGreaterThan(0);
    expect(assembler.stats.accepted).toBe(built.dataFrames.length + 1);

    expect(Array.from(await assembler.finalize('0000'))).toEqual(Array.from(data));
  });

  it('deduplicates a barcode repeated back-to-back, as the camera sees it', async () => {
    const data = pseudoRandomBytes(500, 15);
    const built = await buildStream({ ...baseInput, data, config: TEST_CONFIG });

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames) {
      for (let i = 0; i < 6; i++) assembler.ingest(frame);
    }

    expect(assembler.received).toBe(built.dataFrames.length);
    expect(assembler.stats.accepted).toBe(built.dataFrames.length + 1);
    expect(assembler.stats.duplicates).toBe(built.dataFrames.length * 5);
  });

  it('reports progress and missing frames while incomplete', async () => {
    const data = pseudoRandomBytes(1000, 16);
    const built = await buildStream({ ...baseInput, data, config: TEST_CONFIG });

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames.slice(0, 3)) assembler.ingest(frame);

    const progress = assembler.progress;
    expect(progress.total).toBe(built.dataFrames.length);
    expect(progress.received).toBe(3);
    expect(progress.ratio).toBeCloseTo(3 / built.dataFrames.length);
    expect(assembler.missingIndices(5)).toEqual([3, 4, 5, 6, 7]);
    expect(assembler.isComplete).toBe(false);
    await expect(assembler.finalize()).rejects.toThrow(/incomplete/i);
  });

  it('starts over when the camera drifts onto a different stream', async () => {
    const first = await buildStream({
      ...baseInput,
      data: pseudoRandomBytes(200, 17),
      config: TEST_CONFIG,
    });
    const second = await buildStream({
      ...baseInput,
      id: 'other-stream',
      data: pseudoRandomBytes(200, 18),
      config: TEST_CONFIG,
    });

    const assembler = new StreamAssembler();
    assembler.ingest(first.metadataFrame);
    for (const frame of first.dataFrames) assembler.ingest(frame);
    expect(assembler.isComplete).toBe(true);

    assembler.ingest(second.metadataFrame);
    expect(assembler.metadata?.id).toBe('other-stream');
    expect(assembler.received).toBe(0);
  });

  it('rejects a payload larger than the EC level can carry', async () => {
    await expect(
      buildStream({
        ...baseInput,
        data: pseudoRandomBytes(10, 19),
        config: { ...TEST_CONFIG, ec: 'H', payloadBytes: maxPayloadBytes('H') + 1 },
      })
    ).rejects.toThrow(/payloadBytes must be between/);
  });
});

describe('playback sequence', () => {
  const seqInput = {
    id: 's',
    fileName: 'f.bin',
    mime: 'application/octet-stream',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const lcg = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  it('leads with metadata and re-broadcasts it on the configured interval', async () => {
    const built = await buildStream({
      ...seqInput,
      data: pseudoRandomBytes(64 * 12, 20),
      config: TEST_CONFIG,
    });

    const sequence = buildPlaybackSequence(
      built.metadataFrame,
      built.dataFrames,
      TEST_CONFIG
    );

    expect(built.dataFrames).toHaveLength(12);
    expect(sequence[0]).toBe(built.metadataFrame);
    const metadataPositions = sequence
      .map((frame, i) => (frame === built.metadataFrame ? i : -1))
      .filter((i) => i >= 0);
    expect(metadataPositions).toEqual([0, 6, 12]);
    expect(sequence).toHaveLength(15);
  });

  it('holds each barcode for frameRepeat video frames', async () => {
    const config: StreamConfig = {
      ...TEST_CONFIG,
      frameRepeat: 3,
      metadataRepeatEvery: 0,
    };
    const built = await buildStream({
      ...seqInput,
      data: pseudoRandomBytes(64 * 2, 21),
      config,
    });

    const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);
    expect(sequence).toHaveLength((1 + 2) * 3);
    expect(sequence.slice(0, 3)).toEqual(Array(3).fill(built.metadataFrame));
  });

  it('keeps file order under the sequential setting', async () => {
    const config: StreamConfig = { ...TEST_CONFIG, order: 'sequential' };
    const built = await buildStream({ ...seqInput, data: pseudoRandomBytes(64 * 12, 23), config });

    const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);
    expect(sequence.filter((f) => f !== built.metadataFrame)).toEqual(built.dataFrames);
  });

  it('interleaving emits every data frame exactly once, in a different order', async () => {
    const config: StreamConfig = { ...TEST_CONFIG, order: 'interleaved' };
    const built = await buildStream({ ...seqInput, data: pseudoRandomBytes(64 * 40, 24), config });

    const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);
    const data = sequence.filter((f) => f !== built.metadataFrame);

    // A permutation, not a resampling: same multiset, different order.
    expect([...data].sort()).toEqual([...built.dataFrames].sort());
    expect(data).not.toEqual(built.dataFrames);
    // Length must not move, or `estimateStream` and the render loop disagree.
    expect(sequence).toHaveLength(
      buildPlaybackSequence(built.metadataFrame, built.dataFrames, {
        ...config,
        order: 'sequential',
      }).length
    );
  });

  it('interleaves deterministically per stream', async () => {
    const config: StreamConfig = { ...TEST_CONFIG, order: 'interleaved' };
    const data = pseudoRandomBytes(64 * 40, 25);
    const build = (id: string) => buildStream({ ...seqInput, id, data, config });

    const a = await build('stream-a');
    const again = await build('stream-a');
    const b = await build('stream-b');

    const order = (built: Awaited<ReturnType<typeof build>>) =>
      buildPlaybackSequence(built.metadataFrame, built.dataFrames, config).map((f) =>
        built.dataFrames.indexOf(f)
      );

    expect(order(again)).toEqual(order(a));
    expect(order(b)).not.toEqual(order(a));
  });

  it('does not change how many passes a lossy scan needs', () => {
    // Loss is a function of slot, and a permutation is a bijection slots ->
    // indices, so both orders leave the same number of frames outstanding.
    const total = 512;
    const shuffled = interleavedOrder(total, 0xc0ffee);
    const identity = Array.from({ length: total }, (_, i) => i);

    const passesToComplete = (slotToIndex: number[], seed: number): number => {
      const random = lcg(seed);
      const held = new Set<number>();
      let passes = 0;
      while (held.size < total && passes < 200) {
        passes++;
        const phase = Math.floor(random() * total);
        const dropped = new Set<number>();
        for (let burst = 0; burst < 6; burst++) {
          const start = Math.floor(random() * total);
          for (let k = 0; k < total * 0.03; k++) dropped.add((start + k) % total);
        }
        for (let slot = 0; slot < total; slot++) {
          if (!dropped.has((slot + phase) % total)) held.add(slotToIndex[slot]);
        }
      }
      return passes;
    };

    for (const seed of [1, 2, 3, 4, 5]) {
      expect(passesToComplete(shuffled, seed), `seed ${seed}`).toBe(
        passesToComplete(identity, seed)
      );
    }
  });
});

describe('tiling', () => {
  const tiled = (tile: number): StreamConfig => ({
    ...TEST_CONFIG,
    tile,
    metadataRepeatEvery: 0,
  });

  const build = (config: StreamConfig, blocks: number) =>
    buildStream({
      id: 't',
      fileName: 'f.bin',
      mime: 'application/octet-stream',
      createdAt: '2026-01-01T00:00:00.000Z',
      // Incompressible, so the block count is predictable.
      data: pseudoRandomBytes(64 * blocks, 50),
      config,
    });

  it('pads the run to whole grids so no frame is part blank', async () => {
    const config = tiled(2);
    // 6 data frames + 1 metadata = 7 barcodes, not a multiple of 4.
    const built = await build(config, 6);
    const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);

    expect(built.dataFrames).toHaveLength(6);
    expect(sequence).toHaveLength(8);
    expect(sequence.length % 4).toBe(0);
    // Padding is metadata, not blanks.
    expect(sequence[7]).toBe(built.metadataFrame);
    for (const frame of built.dataFrames) {
      expect(sequence.filter((f) => f === frame)).toHaveLength(1);
    }
  });

  it('repeats whole grids, never a barcode into its own neighbour', async () => {
    const config = { ...tiled(2), frameRepeat: 2 };
    const built = await build(config, 3);
    const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);

    expect(sequence).toHaveLength(8);
    const first = sequence.slice(0, 4);
    const second = sequence.slice(4, 8);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it('divides the video frame count by the grid', () => {
    const single = estimateStream(64 * 40, tiled(1), false);
    const quad = estimateStream(64 * 40, tiled(2), false);

    expect(quad.dataFrames).toBe(single.dataFrames);
    expect(quad.totalVideoFrames).toBe(Math.ceil(single.totalVideoFrames / 4));
    expect(quad.durationSec).toBeLessThan(single.durationSec);
    expect(quad.symbolRate).toBe(single.symbolRate * 4);
  });

  it('agrees with what buildPlaybackSequence actually produces', async () => {
    for (const tile of [1, 2, 3]) {
      const config = tiled(tile);
      const built = await build(config, 40);
      const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);
      const estimate = estimateStream(64 * 40, config, false);

      expect(estimate.barcodes, `tile ${tile}`).toBe(sequence.length);
      expect(estimate.totalVideoFrames, `tile ${tile}`).toBe(
        sequence.length / (tile * tile)
      );
    }
  });
});

describe('compression', () => {
  const base = {
    id: 'z',
    fileName: 'f.bin',
    mime: 'application/octet-stream',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('round-trips compressible data through the whole pipeline', async () => {
    // Highly repetitive, so DEFLATE has something to work with.
    const data = new Uint8Array(20_000);
    for (let i = 0; i < data.length; i++) data[i] = i % 7;

    const built = await buildStream({ ...base, data, config: TEST_CONFIG });
    expect(built.metadata.file.compression).toBe('deflate');
    expect(built.metadata.file.compressedSize).toBeLessThan(data.length / 4);
    expect(built.dataFrames.length).toBeLessThan(Math.ceil(data.length / 64) / 4);

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames) assembler.ingest(frame);
    expect(Array.from(await assembler.finalize())).toEqual(Array.from(data));
  });

  it('leaves incompressible data alone rather than growing it', async () => {
    // Random bytes: DEFLATE returns slightly more than it was given.
    const data = pseudoRandomBytes(20_000, 51);
    const built = await buildStream({ ...base, data, config: TEST_CONFIG });

    expect(built.metadata.file.compression).toBe('none');
    expect(built.metadata.file.compressedSize).toBe(data.length);

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames) assembler.ingest(frame);
    expect(Array.from(await assembler.finalize())).toEqual(Array.from(data));
  });

  it('compresses before encrypting, not after', async () => {
    // Same payload with and without a PIN: both must shrink by the same amount.
    const data = new Uint8Array(20_000);
    for (let i = 0; i < data.length; i++) data[i] = i % 7;

    const plain = await buildStream({ ...base, data, config: TEST_CONFIG });
    const encrypted = await buildStream({
      ...base,
      data,
      pin: '4821',
      config: TEST_CONFIG,
      iterations: TEST_ITERATIONS,
    });

    expect(encrypted.metadata.file.compression).toBe('deflate');
    // The GCM tag is the only difference between the two ciphertexts.
    expect(encrypted.metadata.transport.cipherSize).toBe(
      plain.metadata.transport.cipherSize + 16
    );

    const assembler = new StreamAssembler();
    assembler.ingest(encrypted.metadataFrame);
    for (const frame of encrypted.dataFrames) assembler.ingest(frame);
    expect(Array.from(await assembler.finalize('4821'))).toEqual(Array.from(data));
  });

  it('still decodes a stream from before compression existed', async () => {
    const data = pseudoRandomBytes(640, 52);
    const built = await buildStream({ ...base, data, config: TEST_CONFIG });

    const legacy = JSON.parse(JSON.stringify(built.metadata)) as typeof built.metadata;
    delete (legacy.file as { compression?: string }).compression;
    delete (legacy.file as { compressedSize?: number }).compressedSize;
    const frame = encodeFrame(FrameKind.Metadata, 0, utf8Encode(JSON.stringify(legacy)));

    const assembler = new StreamAssembler();
    expect(assembler.ingest(frame).status).toBe('metadata');
    expect(assembler.unsupported).toBeNull();
    for (const dataFrame of built.dataFrames) assembler.ingest(dataFrame);
    expect(Array.from(await assembler.finalize())).toEqual(Array.from(data));
  });

  it('uses zstd when the environment offers a compressor that wins', async () => {
    // The API injects node:zlib's zstd; the same wiring, minus the app.
    const { zstdCompressSync, constants } = await import('node:zlib');
    const data = new Uint8Array(20_000);
    for (let i = 0; i < data.length; i++) data[i] = i % 7;

    const built = await buildStream({
      ...base,
      data,
      config: TEST_CONFIG,
      compressors: {
        zstd: (bytes) =>
          new Uint8Array(
            zstdCompressSync(bytes, {
              params: { [constants.ZSTD_c_compressionLevel]: 19 },
            })
          ),
      },
    });
    expect(built.metadata.file.compression).toBe('zstd');

    // The pure-JS decoder the scanner ships has to read what native zstd wrote.
    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames) assembler.ingest(frame);
    expect(Array.from(await assembler.finalize())).toEqual(Array.from(data));
  });

  it('says so when a stream uses a compression this build cannot undo', async () => {
    const built = await buildStream({
      ...base,
      data: pseudoRandomBytes(640, 53),
      config: TEST_CONFIG,
    });

    const future = JSON.parse(JSON.stringify(built.metadata)) as typeof built.metadata;
    (future.file as { compression: string }).compression = 'brotli';
    const frame = encodeFrame(FrameKind.Metadata, 0, utf8Encode(JSON.stringify(future)));

    const assembler = new StreamAssembler();
    expect(assembler.ingest(frame).status).toBe('rejected');
    expect(assembler.unsupported).toMatch(/brotli/);
  });
});

describe('fountain streams through the assembler', () => {
  const FOUNTAIN_CONFIG: StreamConfig = {
    ...DEFAULT_STREAM_CONFIG,
    payloadBytes: 64,
    metadataRepeatEvery: 20,
    coding: 'fountain',
    redundancy: 2,
    tile: 1,
  };

  const baseInput = {
    id: 'fountain-stream',
    fileName: 'photo.bin',
    mime: 'application/octet-stream',
    createdAt: '2026-01-01T00:00:00.000Z',
    iterations: TEST_ITERATIONS,
  };

  /** Feeds the playback sequence, dropping a deterministic share of barcodes. */
  const scan = (
    frames: string[],
    dropRate: number,
    seed: number
  ): StreamAssembler => {
    const assembler = new StreamAssembler();
    let state = seed >>> 0;
    for (const frame of frames) {
      state = (state * 1664525 + 1013904223) >>> 0;
      if (state / 4294967296 < dropRate) continue;
      assembler.ingest(frame);
      if (assembler.isComplete) break;
    }
    return assembler;
  };

  it('rebuilds the file having missed a fifth of the video', async () => {
    const data = pseudoRandomBytes(64 * 300, 31);
    const built = await buildStream({ ...baseInput, data, pin: '7788', config: FOUNTAIN_CONFIG });
    const sequence = buildPlaybackSequence(
      built.metadataFrame,
      built.dataFrames,
      FOUNTAIN_CONFIG
    );

    expect(built.metadata.transport.coding).toBe('fountain');
    expect(built.metadata.transport.frames).toBe(Math.ceil((data.length + 16) / 64));
    expect(built.metadata.transport.symbols).toBe(built.dataFrames.length);

    const assembler = scan(sequence, 0.2, 4242);
    expect(assembler.isComplete).toBe(true);
    expect(Array.from(await assembler.finalize('7788'))).toEqual(Array.from(data));
  });

  it('finishes in one pass where plain coding would need several', async () => {
    const data = pseudoRandomBytes(64 * 300, 32);
    const dropRate = 0.2;

    const fountain = await buildStream({ ...baseInput, data, config: FOUNTAIN_CONFIG });
    const plain = await buildStream({
      ...baseInput,
      data,
      config: { ...FOUNTAIN_CONFIG, coding: 'plain' },
    });

    const passes = (built: typeof plain, config: StreamConfig): number => {
      const sequence = buildPlaybackSequence(built.metadataFrame, built.dataFrames, config);
      const assembler = new StreamAssembler();
      let state = 99;
      for (let pass = 1; pass <= 20; pass++) {
        for (const frame of sequence) {
          state = (state * 1664525 + 1013904223) >>> 0;
          if (state / 4294967296 < dropRate) continue;
          assembler.ingest(frame);
          if (assembler.isComplete) return pass;
        }
      }
      return Infinity;
    };

    expect(passes(fountain, FOUNTAIN_CONFIG)).toBe(1);
    expect(passes(plain, { ...FOUNTAIN_CONFIG, coding: 'plain' })).toBeGreaterThan(1);
  });

  it('replays symbols buffered before the metadata barcode arrived', async () => {
    const data = pseudoRandomBytes(64 * 120, 33);
    const built = await buildStream({ ...baseInput, data, config: FOUNTAIN_CONFIG });

    const assembler = new StreamAssembler();
    for (const frame of built.dataFrames) assembler.ingest(frame);
    expect(assembler.metadata).toBeNull();
    expect(assembler.received).toBe(built.dataFrames.length);
    expect(assembler.isComplete).toBe(false);

    assembler.ingest(built.metadataFrame);
    expect(assembler.isComplete).toBe(true);
    expect(Array.from(await assembler.finalize())).toEqual(Array.from(data));
  });

  it('reports blocks recovered, and no missing indices', async () => {
    const data = pseudoRandomBytes(64 * 80, 34);
    const built = await buildStream({ ...baseInput, data, config: FOUNTAIN_CONFIG });

    const assembler = new StreamAssembler();
    assembler.ingest(built.metadataFrame);
    for (const frame of built.dataFrames.slice(0, 10)) assembler.ingest(frame);

    const progress = assembler.progress;
    expect(progress.received).toBe(10);
    expect(progress.blocksResolved).toBeLessThan(built.metadata.transport.frames);
    // No particular symbol is outstanding — that is the point of the code.
    expect(assembler.missingIndices()).toEqual([]);
    expect(progress.ratio).toBeLessThan(1);
    await expect(assembler.finalize()).rejects.toThrow(/incomplete/i);
  });

  it('starts over when the camera drifts onto a different fountain stream', async () => {
    const first = await buildStream({
      ...baseInput,
      data: pseudoRandomBytes(64 * 60, 35),
      config: FOUNTAIN_CONFIG,
    });
    const second = await buildStream({
      ...baseInput,
      id: 'other-fountain',
      data: pseudoRandomBytes(64 * 60, 36),
      config: FOUNTAIN_CONFIG,
    });

    const assembler = new StreamAssembler();
    assembler.ingest(first.metadataFrame);
    for (const frame of first.dataFrames) assembler.ingest(frame);
    expect(assembler.isComplete).toBe(true);

    assembler.ingest(second.metadataFrame);
    expect(assembler.metadata?.id).toBe('other-fountain');
    expect(assembler.received).toBe(0);
    expect(assembler.isComplete).toBe(false);
  });
});

describe('version mismatch between a stream and a scanner', () => {
  const input = {
    id: 'mismatch',
    fileName: 'f.bin',
    mime: 'application/octet-stream',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('says so when a stream uses a coding this build cannot decode', async () => {
    const built = await buildStream({
      ...input,
      data: pseudoRandomBytes(640, 40),
      config: TEST_CONFIG,
    });

    // A stream from a future build, announcing a coding that does not exist yet.
    const future = JSON.parse(JSON.stringify(built.metadata)) as typeof built.metadata;
    (future.transport as { coding: string }).coding = 'raptorq';
    const frame = encodeFrame(FrameKind.Metadata, 0, utf8Encode(JSON.stringify(future)));

    const assembler = new StreamAssembler();
    const result = assembler.ingest(frame);

    expect(result.status).toBe('rejected');
    expect(assembler.unsupported).toMatch(/raptorq/);
    // It must not look like a scan that is merely going slowly.
    expect(assembler.metadata).toBeNull();
    expect(assembler.progress.ratio).toBe(0);
  });

  it('says so when a stream uses an encoding this build cannot read', async () => {
    const built = await buildStream({
      ...input,
      data: pseudoRandomBytes(640, 44),
      config: TEST_CONFIG,
    });

    const future = JSON.parse(JSON.stringify(built.metadata)) as typeof built.metadata;
    (future.transport as { encoding: string }).encoding = 'base45x';
    const frame = encodeFrame(FrameKind.Metadata, 0, utf8Encode(JSON.stringify(future)));

    const assembler = new StreamAssembler();
    expect(assembler.ingest(frame).status).toBe('rejected');
    expect(assembler.unsupported).toMatch(/base45x/);
  });

  it('treats metadata with no coding field as plain, not as unsupported', async () => {
    // Streams rendered before `coding` existed must keep working.
    const built = await buildStream({
      ...input,
      data: pseudoRandomBytes(640, 41),
      config: TEST_CONFIG,
    });

    const legacy = JSON.parse(JSON.stringify(built.metadata)) as typeof built.metadata;
    delete (legacy.transport as { coding?: string }).coding;
    const frame = encodeFrame(FrameKind.Metadata, 0, utf8Encode(JSON.stringify(legacy)));

    const assembler = new StreamAssembler();
    expect(assembler.ingest(frame).status).toBe('metadata');
    expect(assembler.unsupported).toBeNull();

    for (const dataFrame of built.dataFrames) assembler.ingest(dataFrame);
    expect(assembler.isComplete).toBe(true);
  });

  it('drops a frame kind it does not know rather than misreading it', () => {
    // What an older build does with a fountain symbol: ignore, never accept.
    const unknownKind = 7 as 0 | 1 | 2;
    const frame = encodeFrame(unknownKind, 3, pseudoRandomBytes(64, 42));

    const assembler = new StreamAssembler();
    expect(assembler.ingest(frame).status).toBe('ignored');
    expect(assembler.stats.ignored).toBe(1);
    expect(assembler.received).toBe(0);
  });
});

describe('estimateStream', () => {
  it('agrees with what buildStream actually produces', async () => {
    const data = pseudoRandomBytes(64 * 12, 22);
    const estimate = estimateStream(data.length, TEST_CONFIG, false);
    const built = await buildStream({
      id: 's',
      fileName: 'f.bin',
      mime: 'application/octet-stream',
      createdAt: '2026-01-01T00:00:00.000Z',
      data,
      config: TEST_CONFIG,
    });
    const sequence = buildPlaybackSequence(
      built.metadataFrame,
      built.dataFrames,
      TEST_CONFIG
    );

    expect(estimate.dataFrames).toBe(built.dataFrames.length);
    expect(estimate.totalVideoFrames).toBe(sequence.length);
    expect(estimate.durationSec).toBeCloseTo(sequence.length / TEST_CONFIG.fps);
  });

  it('accounts for the GCM tag when encrypted', () => {
    const plain = estimateStream(1000, TEST_CONFIG, false);
    const encrypted = estimateStream(1000, TEST_CONFIG, true);
    expect(encrypted.cipherSize - plain.cipherSize).toBe(16);
  });
});
