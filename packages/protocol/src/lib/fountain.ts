/**
 * LT fountain coding. Each symbol is the XOR of a pseudo-random subset of the K
 * source blocks, derived from the symbol's ESI rather than transmitted — so
 * **the encoder and the decoder must derive identical sets or nothing decodes**.
 * Everything here is integer-only for that reason: `Math.log`, `Math.sqrt` and
 * `Math.random` are implementation-approximated, and this runs on V8 in the
 * encoder and Hermes in the scanner.
 */

const WEIGHT_SCALE = 1 << 20;

/**
 * Ripple size as the rational multiple `RIPPLE_NUM/RIPPLE_DEN` of sqrt(K),
 * folding the robust soliton's `c·ln(K/δ)` into one constant. 3/10 won the
 * sweep in `fountain.spec.ts`; a wrong value still decodes correctly and just
 * costs a third more video, so the overhead test is what guards it.
 */
const RIPPLE_NUM = 3;
const RIPPLE_DEN = 10;

const SPIKE_WEIGHT = 3;

export interface FountainPlan {
  blocks: number;
  /** Cumulative integer weights; `cumulative[d-1]` covers degrees 1..d. */
  cumulative: number[];
  total: number;
}

function integerSqrt(n: number): number {
  let root = 0;
  while ((root + 1) * (root + 1) <= n) root++;
  return root;
}

/** Robust soliton distribution for K source blocks, in integer arithmetic. */
export function planFountain(blocks: number): FountainPlan {
  if (blocks < 1) throw new Error('planFountain needs at least one block');

  const weights = new Array<number>(blocks).fill(0);

  weights[0] = Math.ceil(WEIGHT_SCALE / blocks);
  for (let d = 2; d <= blocks; d++) {
    weights[d - 1] = Math.floor(WEIGHT_SCALE / (d * (d - 1)));
  }

  const ripple = Math.max(1, Math.floor((RIPPLE_NUM * integerSqrt(blocks)) / RIPPLE_DEN));
  const spike = Math.max(1, Math.floor(blocks / ripple));
  for (let d = 1; d < spike && d <= blocks; d++) {
    weights[d - 1] += Math.floor((WEIGHT_SCALE * ripple) / (d * blocks));
  }
  if (spike <= blocks) {
    weights[spike - 1] += Math.floor((WEIGHT_SCALE * ripple * SPIKE_WEIGHT) / blocks);
  }

  const cumulative = new Array<number>(blocks);
  let running = 0;
  for (let i = 0; i < blocks; i++) {
    running += weights[i];
    cumulative[i] = running;
  }

  return { blocks, cumulative, total: running };
}

/** splitmix32 — every operation it uses is exactly specified by the language. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** Uniform integer in `[0, bound)`. Rejection, not modulo, which skews low values. */
function boundedRandom(next: () => number, bound: number): number {
  const limit = Math.floor(0x100000000 / bound) * bound;
  let value = next();
  while (value >= limit) value = next();
  return value % bound;
}

function sampleDegree(next: () => number, plan: FountainPlan): number {
  const target = boundedRandom(next, plan.total);
  let low = 0;
  let high = plan.cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (plan.cumulative[mid] > target) high = mid;
    else low = mid + 1;
  }
  return low + 1;
}

/**
 * The source blocks a symbol covers. Seeded off the ESI and nothing else, so
 * both ends derive the same set.
 */
export function neighboursFor(esi: number, plan: FountainPlan): number[] {
  const next = makeRandom(esi);
  const degree = Math.min(sampleDegree(next, plan), plan.blocks);

  if (degree >= plan.blocks) {
    return Array.from({ length: plan.blocks }, (_, i) => i);
  }

  const chosen = new Set<number>();
  while (chosen.size < degree) {
    chosen.add(boundedRandom(next, plan.blocks));
  }
  return Array.from(chosen).sort((a, b) => a - b);
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] ^= source[i];
}

/**
 * Splits `data` into K equal-length blocks, zero-padding the last. Equal length
 * is required: symbols are XORs, and the true length travels in the metadata.
 */
export function toBlocks(data: Uint8Array, blockBytes: number): Uint8Array[] {
  const count = Math.max(1, Math.ceil(data.length / blockBytes));
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const block = new Uint8Array(blockBytes);
    block.set(data.subarray(i * blockBytes, Math.min((i + 1) * blockBytes, data.length)));
    blocks.push(block);
  }
  return blocks;
}

export function encodeSymbol(
  blocks: Uint8Array[],
  esi: number,
  plan: FountainPlan
): Uint8Array {
  const symbol = new Uint8Array(blocks[0].length);
  for (const index of neighboursFor(esi, plan)) xorInto(symbol, blocks[index]);
  return symbol;
}

/** Estimate the progress bar fills toward. Kept slightly pessimistic. */
export function symbolsNeededFor(blocks: number): number {
  return Math.ceil(blocks * 1.08) + 2;
}

/**
 * Correctness floor, not a preference: a video below it is undecodable, and
 * looping replays the same ESIs. Measured success rate given every symbol:
 *
 *      K     x1.4  x1.6  x1.8  x2.0  x2.5  x3.0
 *     20      30%   53%   73%   84%   96%   99%
 *     50      51%   85%   94%   97%  100%  100%
 *    100      74%   94%   98%   99%  100%  100%
 *    200      90%   98%  100%  100%  100%  100%
 *    500      96%  100%  100%  100%  100%  100%
 *   1000     100%  100%  100%  100%  100%  100%
 */
export function minimumRedundancy(blocks: number): number {
  return 1.6 + 60 / Math.max(1, blocks);
}

export function symbolCountFor(blocks: number, redundancy: number): number {
  return Math.ceil(blocks * Math.max(redundancy, minimumRedundancy(blocks)));
}

/** Peeling (belief-propagation) LT decoder. Symbols are folded in as they arrive. */
export class FountainDecoder {
  private readonly plan: FountainPlan;
  private readonly blockBytes: number;
  private readonly blocks: (Uint8Array | null)[];
  private readonly pending = new Map<number, { payload: Uint8Array; remaining: Set<number> }>();
  /** Which pending symbols are still waiting on each unresolved block. */
  private readonly waiting = new Map<number, Set<number>>();
  private readonly seen = new Set<number>();
  private resolvedCount = 0;

  constructor(blocks: number, blockBytes: number) {
    this.plan = planFountain(blocks);
    this.blockBytes = blockBytes;
    this.blocks = new Array<Uint8Array | null>(blocks).fill(null);
  }

  get received(): number {
    return this.seen.size;
  }

  get resolved(): number {
    return this.resolvedCount;
  }

  get total(): number {
    return this.plan.blocks;
  }

  get isComplete(): boolean {
    return this.resolvedCount === this.plan.blocks;
  }

  /** Returns false if this ESI was already held. */
  add(esi: number, payload: Uint8Array): boolean {
    if (this.seen.has(esi)) return false;
    this.seen.add(esi);
    if (this.isComplete) return true;

    // The caller's payload is a view onto a decode buffer, and this one is
    // mutated in place as neighbours are peeled away.
    const working = new Uint8Array(this.blockBytes);
    working.set(payload.subarray(0, this.blockBytes));

    const remaining = new Set<number>();
    for (const index of neighboursFor(esi, this.plan)) {
      const known = this.blocks[index];
      if (known) xorInto(working, known);
      else remaining.add(index);
    }

    if (remaining.size === 0) return true;

    this.pending.set(esi, { payload: working, remaining });
    for (const index of remaining) {
      let set = this.waiting.get(index);
      if (!set) {
        set = new Set<number>();
        this.waiting.set(index, set);
      }
      set.add(esi);
    }

    if (remaining.size === 1) this.peel([esi]);
    return true;
  }

  /** `queue` holds ESIs believed to cover exactly one unknown block. */
  private peel(queue: number[]): void {
    while (queue.length > 0) {
      const esi = queue.pop() as number;
      const symbol = this.pending.get(esi);
      if (!symbol || symbol.remaining.size !== 1) continue;

      const index = symbol.remaining.values().next().value as number;
      this.pending.delete(esi);
      symbol.remaining.clear();

      const dependents = this.waiting.get(index);
      this.waiting.delete(index);

      if (this.blocks[index]) continue;

      this.blocks[index] = symbol.payload;
      this.resolvedCount++;

      if (!dependents) continue;
      for (const other of dependents) {
        if (other === esi) continue;
        const waiter = this.pending.get(other);
        if (!waiter || !waiter.remaining.has(index)) continue;
        xorInto(waiter.payload, symbol.payload);
        waiter.remaining.delete(index);
        if (waiter.remaining.size === 1) queue.push(other);
        else if (waiter.remaining.size === 0) this.pending.delete(other);
      }
    }
  }

  assemble(byteLength: number): Uint8Array {
    if (!this.isComplete) {
      throw new Error(
        `Fountain stream is incomplete: ${this.resolvedCount} of ${this.plan.blocks} blocks`
      );
    }
    const out = new Uint8Array(this.plan.blocks * this.blockBytes);
    for (let i = 0; i < this.plan.blocks; i++) {
      out.set(this.blocks[i] as Uint8Array, i * this.blockBytes);
    }
    return out.subarray(0, byteLength);
  }

  reset(): void {
    this.blocks.fill(null);
    this.pending.clear();
    this.waiting.clear();
    this.seen.clear();
    this.resolvedCount = 0;
  }
}
