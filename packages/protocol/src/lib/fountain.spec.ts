import { describe, expect, it } from 'vitest';

import {
  FountainDecoder,
  encodeSymbol,
  minimumRedundancy,
  neighboursFor,
  planFountain,
  symbolCountFor,
  toBlocks,
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

function shuffled(count: number, seed: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const BLOCK_BYTES = 500;

/** Feeds symbols in the given order and reports how many it took to decode. */
function decodeWith(
  data: Uint8Array,
  blockCount: number,
  order: number[]
): { used: number; rebuilt: Uint8Array | null } {
  const blocks = toBlocks(data, BLOCK_BYTES);
  const plan = planFountain(blockCount);
  const decoder = new FountainDecoder(blockCount, BLOCK_BYTES);

  let used = 0;
  for (const esi of order) {
    used++;
    decoder.add(esi, encodeSymbol(blocks, esi, plan));
    if (decoder.isComplete) {
      return { used, rebuilt: decoder.assemble(data.length) };
    }
  }
  return { used, rebuilt: null };
}

describe('fountain neighbour derivation', () => {
  it('is a pure function of the ESI and block count', () => {
    const plan = planFountain(500);
    for (const esi of [0, 1, 7, 4242, 65_535, 1_000_000]) {
      expect(neighboursFor(esi, plan)).toEqual(neighboursFor(esi, planFountain(500)));
    }
  });

  it('produces sorted, distinct, in-range neighbours', () => {
    const blocks = 300;
    const plan = planFountain(blocks);
    for (let esi = 0; esi < 400; esi++) {
      const neighbours = neighboursFor(esi, plan);
      expect(neighbours.length).toBeGreaterThan(0);
      expect(neighbours.length).toBeLessThanOrEqual(blocks);
      expect(new Set(neighbours).size, `esi ${esi} repeated a block`).toBe(
        neighbours.length
      );
      for (let i = 1; i < neighbours.length; i++) {
        expect(neighbours[i]).toBeGreaterThan(neighbours[i - 1]);
      }
      expect(Math.min(...neighbours)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...neighbours)).toBeLessThan(blocks);
    }
  });

  it('covers every block across enough symbols', () => {
    // A block no symbol touches can never be recovered, however long the video
    // runs — a decodability property, not a statistical nicety.
    const blocks = 200;
    const plan = planFountain(blocks);
    const covered = new Set<number>();
    for (let esi = 0; esi < symbolCountFor(blocks, 1.6); esi++) {
      for (const index of neighboursFor(esi, plan)) covered.add(index);
    }
    expect(covered.size).toBe(blocks);
  });

  it('leans on low degrees, as the soliton distribution intends', () => {
    // Degree-1 symbols start the peel; without them the decoder never gets going.
    const plan = planFountain(1000);
    let degreeOne = 0;
    const samples = 4000;
    for (let esi = 0; esi < samples; esi++) {
      if (neighboursFor(esi, plan).length === 1) degreeOne++;
    }
    expect(degreeOne).toBeGreaterThan(samples * 0.005);
    expect(degreeOne).toBeLessThan(samples * 0.2);
  });
});

describe('fountain round trip', () => {
  it('rebuilds the exact bytes from symbols in a shuffled order', () => {
    for (const blockCount of [1, 2, 17, 200]) {
      const data = pseudoRandomBytes(blockCount * BLOCK_BYTES - 13, blockCount + 1);
      const pool = symbolCountFor(blockCount, 4);
      const { rebuilt } = decodeWith(data, blockCount, shuffled(pool, blockCount * 31));

      expect(rebuilt, `blockCount ${blockCount} failed to decode`).not.toBeNull();
      expect(Array.from(rebuilt as Uint8Array), `blockCount ${blockCount}`).toEqual(
        Array.from(data)
      );
    }
  });

  it('trims the padding off a file that does not fill its last block', () => {
    const data = pseudoRandomBytes(BLOCK_BYTES * 3 + 1, 9);
    const blockCount = 4;
    const { rebuilt } = decodeWith(data, blockCount, shuffled(symbolCountFor(blockCount, 4), 5));
    expect(rebuilt?.length).toBe(data.length);
    expect(Array.from(rebuilt as Uint8Array)).toEqual(Array.from(data));
  });

  it('ignores a symbol it already holds', () => {
    const blockCount = 40;
    const data = pseudoRandomBytes(blockCount * BLOCK_BYTES, 3);
    const blocks = toBlocks(data, BLOCK_BYTES);
    const plan = planFountain(blockCount);
    const decoder = new FountainDecoder(blockCount, BLOCK_BYTES);

    expect(decoder.add(11, encodeSymbol(blocks, 11, plan))).toBe(true);
    expect(decoder.add(11, encodeSymbol(blocks, 11, plan))).toBe(false);
    expect(decoder.received).toBe(1);
  });

  it('decodes from any subset, not from particular symbols', () => {
    const blockCount = 150;
    const data = pseudoRandomBytes(blockCount * BLOCK_BYTES, 21);
    const pool = symbolCountFor(blockCount, 3);

    for (const seed of [1, 2, 3, 4, 5]) {
      const { rebuilt } = decodeWith(data, blockCount, shuffled(pool, seed * 977));
      expect(Array.from(rebuilt as Uint8Array), `seed ${seed}`).toEqual(Array.from(data));
    }
  });
});

describe('fountain overhead', () => {
  it('decodes from close to the block count, not a multiple of it', () => {
    // Guards the tuned constants in fountain.ts: a bad distribution still
    // decodes correctly and just quietly costs a third more video.
    const blockCount = 1000;
    const data = pseudoRandomBytes(blockCount * BLOCK_BYTES, 42);
    const pool = symbolCountFor(blockCount, 3);

    const ratios: number[] = [];
    for (let trial = 0; trial < 8; trial++) {
      const { used, rebuilt } = decodeWith(data, blockCount, shuffled(pool, trial * 7919 + 1));
      expect(rebuilt, `trial ${trial} failed to decode`).not.toBeNull();
      ratios.push(used / blockCount);
    }

    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(mean, `mean overhead was ${mean.toFixed(3)}`).toBeLessThan(1.25);
    expect(Math.max(...ratios)).toBeLessThan(1.5);
  });

  it('demands more redundancy of small streams than large ones', () => {
    // A stream below the floor is undecodable, not merely slow.
    expect(minimumRedundancy(20)).toBeGreaterThan(minimumRedundancy(1000));
    expect(minimumRedundancy(20)).toBeGreaterThan(3);
    expect(minimumRedundancy(2000)).toBeLessThan(1.7);
  });

  it('raises a redundancy that would render an undecodable stream', () => {
    expect(symbolCountFor(20, 1.1)).toBe(Math.ceil(20 * minimumRedundancy(20)));
    // …and leaves a sufficient one alone.
    expect(symbolCountFor(2000, 3)).toBe(6000);
  });

  it('decodes reliably at the floor it advertises', () => {
    for (const blockCount of [20, 50, 200]) {
      const data = pseudoRandomBytes(blockCount * BLOCK_BYTES, blockCount);
      const pool = symbolCountFor(blockCount, 1);
      let decoded = 0;
      const trials = 12;
      for (let trial = 0; trial < trials; trial++) {
        const { rebuilt } = decodeWith(data, blockCount, shuffled(pool, trial * 313 + 7));
        if (rebuilt) decoded++;
      }
      expect(decoded, `blockCount ${blockCount} decoded ${decoded}/${trials}`).toBe(trials);
    }
  });
});
