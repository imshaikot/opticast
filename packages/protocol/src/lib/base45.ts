/**
 * Base45 (RFC 9285). Its alphabet is exactly the QR *alphanumeric* charset, so
 * a payload encodes at 5.5 bits/char instead of the 8 bits/char byte mode
 * costs — ~29% more payload per symbol than base64.
 */

export const BASE45_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const BASE45_LOOKUP = /* @__PURE__ */ (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < BASE45_ALPHABET.length; i++) {
    table[BASE45_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function base45EncodedLength(byteLength: number): number {
  return ((byteLength / 2) | 0) * 3 + (byteLength % 2 === 1 ? 2 : 0);
}

export function base45CapacityBytes(charBudget: number): number {
  const pairs = (charBudget / 3) | 0;
  const leftover = charBudget - pairs * 3;
  return pairs * 2 + (leftover >= 2 ? 1 : 0);
}

export function base45Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    const n = bytes[i] * 256 + bytes[i + 1];
    const c = n % 45;
    const d = ((n / 45) | 0) % 45;
    const e = ((n / 2025) | 0) % 45;
    out += BASE45_ALPHABET[c] + BASE45_ALPHABET[d] + BASE45_ALPHABET[e];
  }
  if (i < bytes.length) {
    const n = bytes[i];
    out += BASE45_ALPHABET[n % 45] + BASE45_ALPHABET[(n / 45) | 0];
  }
  return out;
}

/** Returns `null` for anything that is not well-formed Base45. */
export function base45Decode(text: string): Uint8Array | null {
  const len = text.length;
  if (len % 3 === 1) return null;

  const out = new Uint8Array(((len / 3) | 0) * 2 + (len % 3 === 2 ? 1 : 0));
  let pos = 0;
  let i = 0;

  for (; i + 2 < len; i += 3) {
    const c = BASE45_LOOKUP[text.charCodeAt(i)];
    const d = BASE45_LOOKUP[text.charCodeAt(i + 1)];
    const e = BASE45_LOOKUP[text.charCodeAt(i + 2)];
    if (c < 0 || d < 0 || e < 0) return null;
    const n = c + d * 45 + e * 2025;
    if (n > 0xffff) return null;
    out[pos++] = n >> 8;
    out[pos++] = n & 0xff;
  }

  if (i < len) {
    const c = BASE45_LOOKUP[text.charCodeAt(i)];
    const d = BASE45_LOOKUP[text.charCodeAt(i + 1)];
    if (c < 0 || d < 0) return null;
    const n = c + d * 45;
    if (n > 0xff) return null;
    out[pos++] = n;
  }

  return out;
}

/**
 * Wide-group Base45: 13 bytes into 19 characters instead of the RFC's 2-into-3,
 * which lifts alphanumeric utilisation from 97.0% to 99.5%.
 *
 * The conversion is byte-array long division in plain 32-bit integer arithmetic
 * (every intermediate stays under 11 520) — no floats, no `Math.*`, no BigInt,
 * because V8 and Hermes must produce identical strings. Every trailing-group
 * length is distinct and never 19, so the byte count is recoverable from the
 * character count alone; impossible counts are rejected, never guessed at.
 */

const WIDE_GROUP_BYTES = 13;
const WIDE_GROUP_CHARS = 19;

/** Characters for a trailing group of k bytes: smallest n with 45^n >= 256^k. */
const WIDE_REMAINDER_CHARS = [0, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] as const;

/** Bytes carried by a trailing group of r characters; -1 marks impossible lengths. */
const WIDE_REMAINDER_BYTES = /* @__PURE__ */ (() => {
  const table = new Int8Array(WIDE_GROUP_CHARS).fill(-1);
  WIDE_REMAINDER_CHARS.forEach((chars, bytes) => (table[chars] = bytes));
  return table;
})();

export function wideBase45EncodedLength(byteLength: number): number {
  const groups = (byteLength / WIDE_GROUP_BYTES) | 0;
  return (
    groups * WIDE_GROUP_CHARS + WIDE_REMAINDER_CHARS[byteLength - groups * WIDE_GROUP_BYTES]
  );
}

export function wideBase45CapacityBytes(charBudget: number): number {
  const groups = (charBudget / WIDE_GROUP_CHARS) | 0;
  const leftover = charBudget - groups * WIDE_GROUP_CHARS;
  let remainder = 0;
  for (let k = WIDE_REMAINDER_CHARS.length - 1; k >= 0; k--) {
    if (WIDE_REMAINDER_CHARS[k] <= leftover) {
      remainder = k;
      break;
    }
  }
  return groups * WIDE_GROUP_BYTES + remainder;
}

/** Destroys `work[start..start+byteCount)` by repeated division by 45. */
function encodeWideGroup(
  work: Uint8Array,
  start: number,
  byteCount: number,
  charCount: number
): string {
  let out = '';
  for (let digit = 0; digit < charCount; digit++) {
    let rem = 0;
    for (let i = start; i < start + byteCount; i++) {
      const v = rem * 256 + work[i];
      work[i] = (v / 45) | 0;
      rem = v % 45;
    }
    out += BASE45_ALPHABET[rem];
  }
  return out;
}

export function wideBase45Encode(bytes: Uint8Array): string {
  // The division consumes its input, so work on a copy.
  const work = bytes.slice();
  let out = '';
  let offset = 0;
  for (; offset + WIDE_GROUP_BYTES <= work.length; offset += WIDE_GROUP_BYTES) {
    out += encodeWideGroup(work, offset, WIDE_GROUP_BYTES, WIDE_GROUP_CHARS);
  }
  const remainder = work.length - offset;
  if (remainder > 0) {
    out += encodeWideGroup(work, offset, remainder, WIDE_REMAINDER_CHARS[remainder]);
  }
  return out;
}

/** Returns false on a character outside the alphabet or an overflowing group. */
function decodeWideGroup(
  text: string,
  charStart: number,
  charCount: number,
  out: Uint8Array,
  start: number,
  byteCount: number
): boolean {
  const end = start + byteCount;
  for (let digit = charCount - 1; digit >= 0; digit--) {
    let carry = BASE45_LOOKUP[text.charCodeAt(charStart + digit)];
    if (carry < 0) return false;
    for (let i = end - 1; i >= start; i--) {
      const v = out[i] * 45 + carry;
      out[i] = v & 0xff;
      carry = v >>> 8;
    }
    if (carry !== 0) return false;
  }
  return true;
}

/** Returns `null` for anything that is not well-formed wide Base45. */
export function wideBase45Decode(text: string): Uint8Array | null {
  const groups = (text.length / WIDE_GROUP_CHARS) | 0;
  const leftover = text.length - groups * WIDE_GROUP_CHARS;
  const remainderBytes = WIDE_REMAINDER_BYTES[leftover];
  if (remainderBytes < 0) return null;

  const out = new Uint8Array(groups * WIDE_GROUP_BYTES + remainderBytes);
  for (let g = 0; g < groups; g++) {
    if (
      !decodeWideGroup(
        text,
        g * WIDE_GROUP_CHARS,
        WIDE_GROUP_CHARS,
        out,
        g * WIDE_GROUP_BYTES,
        WIDE_GROUP_BYTES
      )
    ) {
      return null;
    }
  }
  if (
    remainderBytes > 0 &&
    !decodeWideGroup(
      text,
      groups * WIDE_GROUP_CHARS,
      leftover,
      out,
      groups * WIDE_GROUP_BYTES,
      remainderBytes
    )
  ) {
    return null;
  }
  return out;
}
